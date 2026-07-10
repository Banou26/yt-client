import type {
  ProxyTransport,
  RawHeaders,
  TransferrableResponse,
  WebSocketDataType,
} from '@mercuryworkshop/proxy-transports'
import type { EgressApi } from './protocol'

export const createWebvpnTransport = (remote: Promise<EgressApi>): ProxyTransport => {
  let requestNumber = 0
  const transport: ProxyTransport = {
    ready: false,
    async init() {
      await remote
      transport.ready = true
    },
    async request(
      url: URL,
      method: string,
      body: BodyInit | null,
      headers: RawHeaders,
      signal: AbortSignal | undefined,
    ): Promise<TransferrableResponse> {
      const api = await remote
      if (signal?.aborted) throw signal.reason
      const requestId = `egress:${++requestNumber}`
      const cancel = () => void api.cancelFetch(requestId).catch(() => {})
      signal?.addEventListener('abort', cancel, { once: true })
      const requestHeaders = Object.fromEntries(headers)
      const bytes = body === null ? null : await new Response(body).arrayBuffer()
      let response: Awaited<ReturnType<EgressApi['fetch']>>
      try {
        response = await api.fetch(requestId, url.href, {
          method,
          headers: requestHeaders,
          body: bytes,
          redirect: 'manual',
        })
      } catch (error) {
        signal?.removeEventListener('abort', cancel)
        cancel()
        throw error
      }
      const reader = response.body?.getReader()
      if (!reader) signal?.removeEventListener('abort', cancel)
      const responseBody = reader ? new ReadableStream<Uint8Array>({
        async pull(stream) {
          try {
            const chunk = await reader.read()
            if (chunk.done) {
              signal?.removeEventListener('abort', cancel)
              stream.close()
            } else {
              stream.enqueue(chunk.value)
            }
          } catch (error) {
            signal?.removeEventListener('abort', cancel)
            stream.error(error)
          }
        },
        async cancel(reason) {
          signal?.removeEventListener('abort', cancel)
          cancel()
          await reader.cancel(reason).catch(() => {})
        },
      }) : new ArrayBuffer(0)
      return {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: responseBody,
      }
    },
    connect(
      _url: URL,
      _protocols: string[],
      _headers: RawHeaders,
      _onopen: (protocol: string, extensions: string) => void,
      _onmessage: (data: WebSocketDataType) => void,
      _onclose: (code: number, reason: string) => void,
      onerror: (error: string) => void,
    ) {
      queueMicrotask(() => onerror('yt-client: WebSocket transport is not available'))
      return [() => {}, () => {}]
    },
  }
  return transport
}

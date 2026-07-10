import type {
  ProxyTransport,
  RawHeaders,
  TransferrableResponse,
  WebSocketDataType,
} from '@mercuryworkshop/proxy-transports'
import type { EgressApi } from './protocol'

export const createWebvpnTransport = (remote: Promise<EgressApi>): ProxyTransport => {
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
    ): Promise<TransferrableResponse> {
      const api = await remote
      const requestHeaders = Object.fromEntries(headers)
      const bytes = body === null ? null : await new Response(body).arrayBuffer()
      const response = await api.fetch(url.href, {
        method,
        headers: requestHeaders,
        body: bytes,
        redirect: 'manual',
      })
      return {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: response.body ?? '',
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

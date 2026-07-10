import type { FrameEgressRequest, FrameEgressResponse } from './protocol'

import { FRAME_EGRESS_CONNECT } from './protocol'

type FrameWindow = Window & {
  [FRAME_EGRESS_CONNECT]?: (port: MessagePort) => void
}

let resolvePort: (port: MessagePort) => void = () => {}
const portReady = new Promise<MessagePort>((resolve) => {
  resolvePort = resolve
})
const pending = new Map<number, {
  resolve(response: Extract<FrameEgressResponse, { response: unknown }>['response']): void
  reject(error: unknown): void
}>()
let requestId = 0

if (typeof window !== 'undefined') {
  Object.defineProperty(window as FrameWindow, FRAME_EGRESS_CONNECT, {
    configurable: true,
    value: (port: MessagePort) => {
      port.addEventListener('message', (event) => {
        const message = event.data as FrameEgressResponse
        const request = pending.get(message.id)
        if (!request) {
          void message.response?.body?.cancel()
          return
        }
        pending.delete(message.id)
        if (message.error) request.reject(new Error(message.error))
        else request.resolve(message.response!)
      })
      port.start()
      resolvePort(port)
    },
  })
}

const abortReason = (signal?: AbortSignal) => signal?.reason ?? new DOMException('The operation was aborted', 'AbortError')

export const egressFetch = async (
  url: string,
  options: Extract<FrameEgressRequest, { type: 'fetch' }>['options'],
  signal?: AbortSignal,
) => {
  const port = await portReady
  if (signal?.aborted) throw abortReason(signal)
  const id = ++requestId
  let responseBody: ReadableStreamDefaultReader<Uint8Array> | undefined
  let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined
  let aborted = false
  const cancel = () => {
    if (aborted) return
    aborted = true
    const reason = abortReason(signal)
    port.postMessage({ type: 'cancel', id } satisfies FrameEgressRequest)
    const request = pending.get(id)
    pending.delete(id)
    request?.reject(reason)
    if (bodyController) bodyController.error(reason)
    void responseBody?.cancel(reason).catch(() => {})
  }
  signal?.addEventListener('abort', cancel, { once: true })
  const response = await new Promise<Extract<FrameEgressResponse, { response: unknown }>['response']>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    const message = { type: 'fetch', id, url, options } satisfies FrameEgressRequest
    port.postMessage(message, options.body ? [options.body] : [])
  })
  if (signal?.aborted) {
    cancel()
    throw abortReason(signal)
  }
  if (!response.body) {
    signal?.removeEventListener('abort', cancel)
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
  responseBody = response.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      bodyController = controller
    },
    async pull(controller) {
      try {
        const chunk = await responseBody!.read()
        if (aborted) return
        if (chunk.done) {
          signal?.removeEventListener('abort', cancel)
          controller.close()
        } else {
          controller.enqueue(Uint8Array.from(chunk.value))
        }
      } catch (error) {
        if (!aborted) controller.error(error)
      }
    },
    async cancel(reason) {
      signal?.removeEventListener('abort', cancel)
      if (!aborted) {
        aborted = true
        port.postMessage({ type: 'cancel', id } satisfies FrameEgressRequest)
      }
      await responseBody?.cancel(reason).catch(() => {})
    },
  })
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

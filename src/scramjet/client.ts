import type { FrameApi, FrameRequest, FrameResponse } from '../frame/protocol'

import { ENGINE_READY } from './protocol'

let engine: Promise<FrameApi> | undefined

const createFrameApi = (port: MessagePort): FrameApi => {
  let requestId = 0
  const pending = new Map<number, {
    resolve(value: unknown): void
    reject(reason?: unknown): void
  }>()
  port.addEventListener('message', (event) => {
    const response = event.data as FrameResponse
    document.documentElement.dataset.frameResponse = response.error ? 'error' : 'done'
    const request = pending.get(response.id)
    if (!request) return
    pending.delete(response.id)
    if (response.error) request.reject(new Error(response.error))
    else request.resolve(response.result)
  })
  port.start()

  const call = <Method extends keyof FrameApi>(
    method: Method,
    ...args: Parameters<FrameApi[Method]>
  ) => new Promise<Awaited<ReturnType<FrameApi[Method]>>>((resolve, reject) => {
    const id = ++requestId
    document.documentElement.dataset.frameRequest = method
    pending.set(id, {
      resolve: (value) => resolve(value as Awaited<ReturnType<FrameApi[Method]>>),
      reject,
    })
    port.postMessage({ id, method, args } as FrameRequest)
  })

  return {
    home: (cursor) => call('home', cursor),
    search: (query, cursor) => call('search', query, cursor),
    video: (id) => call('video', id),
    channel: (id, cursor) => call('channel', id, cursor),
    openPlayback: (videoId, maxHeight) => call('openPlayback', videoId, maxHeight),
    requestSegment: (request) => call('requestSegment', request),
    selectVideoFormat: (sessionId, formatKey) => call('selectVideoFormat', sessionId, formatKey),
    closePlayback: (sessionId) => call('closePlayback', sessionId),
  }
}

export const startEngine = () => (engine ??= new Promise((resolve, reject) => {
  const frame = document.createElement('iframe')
  frame.hidden = true
  frame.src = '/__yt_scramjet__/host.html'
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.type !== ENGINE_READY) return
    window.removeEventListener('message', onMessage)
    if (event.data.error) {
      reject(new Error(event.data.error))
      return
    }
    const port = event.ports[0]
    if (!port) {
      reject(new Error('yt-client: frame API port is missing'))
      return
    }
    resolve(createFrameApi(port))
  }
  window.addEventListener('message', onMessage)
  document.body.appendChild(frame)
}))

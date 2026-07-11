import type { FrameApi, FrameProgress, FrameRequest, FrameResponse } from '../frame/protocol'

import { ENGINE_READY } from './protocol'

let engine: Promise<FrameApi> | undefined
let engineFrame: HTMLIFrameElement | undefined
let engineConnection: ReturnType<typeof createFrameApi> | undefined
let engineCleanup: (() => void) | undefined
let engineReject: ((error: Error) => void) | undefined
let engineGeneration = 0

const createFrameApi = (port: MessagePort, onFatal: (error: Error) => void) => {
  let requestId = 0
  let closed = false
  const pending = new Map<number, {
    method: keyof FrameApi
    startedAt: number
    timeout?: ReturnType<typeof setTimeout>
    resolve(value: unknown): void
    reject(reason?: unknown): void
  }>()
  const close = (error: Error) => {
    if (closed) return
    closed = true
    port.close()
    for (const request of pending.values()) {
      clearTimeout(request.timeout)
      request.reject(error)
    }
    pending.clear()
  }
  const fail = (error: Error) => {
    close(error)
    onFatal(error)
  }
  const armTimeout = (id: number, request: typeof pending extends Map<number, infer Value> ? Value : never) => {
    clearTimeout(request.timeout)
    const timeoutMs = request.method === 'requestSegment' ? 20_000 : 90_000
    request.timeout = setTimeout(() => {
      if (!pending.has(id)) return
      const error = new Error(`yt-client: ${request.method} timed out after ${timeoutMs / 1_000}s of inactivity`)
      document.documentElement.dataset.playbackRecovery = error.message
      fail(error)
    }, timeoutMs)
  }
  port.addEventListener('message', (event) => {
    const response = event.data as FrameProgress | FrameResponse
    const request = pending.get(response.id)
    if (!request) return
    if ('progress' in response) {
      document.documentElement.dataset.frameProgress = response.progress
      armTimeout(response.id, request)
      return
    }
    document.documentElement.dataset.frameResponse = response.error ? 'error' : 'done'
    clearTimeout(request.timeout)
    pending.delete(response.id)
    document.documentElement.dataset.frameResponseMs = String(Math.round(performance.now() - request.startedAt))
    if (response.error) request.reject(new Error(response.error))
    else request.resolve(response.result)
  })
  port.addEventListener('messageerror', () => fail(new Error('yt-client: frame API message failed')))
  port.start()

  const call = <Method extends keyof FrameApi>(
    method: Method,
    ...args: Parameters<FrameApi[Method]>
  ) => new Promise<Awaited<ReturnType<FrameApi[Method]>>>((resolve, reject) => {
    if (closed) {
      reject(new Error('yt-client: frame API is closed'))
      return
    }
    const id = ++requestId
    const startedAt = performance.now()
    document.documentElement.dataset.frameRequest = method
    document.documentElement.dataset.frameRequestId = String(id)
    document.documentElement.dataset.frameRequestStartedAt = String(Math.round(startedAt))
    const request = {
      method,
      startedAt,
      resolve: (value: unknown) => resolve(value as Awaited<ReturnType<FrameApi[Method]>>),
      reject,
    }
    pending.set(id, request)
    armTimeout(id, request)
    try {
      port.postMessage({ id, method, args } as FrameRequest)
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  })

  return {
    api: {
      home: (cursor) => call('home', cursor),
      search: (query, cursor) => call('search', query, cursor),
      video: (id) => call('video', id),
      channel: (id, cursor) => call('channel', id, cursor),
      watch: (id) => call('watch', id),
      comments: (videoId, cursor) => call('comments', videoId, cursor),
      openPlayback: (videoId, maxHeight) => call('openPlayback', videoId, maxHeight),
      requestSegment: (request) => call('requestSegment', request),
      cancelSegment: (sessionId, requestId) => call('cancelSegment', sessionId, requestId),
      selectVideoFormat: (sessionId, formatKey) => call('selectVideoFormat', sessionId, formatKey),
      closePlayback: (sessionId) => call('closePlayback', sessionId),
    } satisfies FrameApi,
    close,
  }
}

const invalidateEngine = (generation: number, error: Error) => {
  if (generation !== engineGeneration) return
  engineCleanup?.()
  engineCleanup = undefined
  const connection = engineConnection
  engineConnection = undefined
  connection?.close(error)
  engineReject?.(error)
  engineReject = undefined
  engineFrame?.remove()
  engineFrame = undefined
  engine = undefined
}

export const startEngine = () => {
  if (engine) return engine
  const generation = ++engineGeneration
  engine = new Promise((resolve, reject) => {
    engineReject = reject
    const frame = document.createElement('iframe')
    engineFrame = frame
    frame.hidden = true
    frame.src = '/__yt_scramjet__/host.html'
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.type !== ENGINE_READY) return
      engineCleanup?.()
      engineCleanup = undefined
      if (event.data.error) {
        invalidateEngine(generation, new Error(event.data.error))
        return
      }
      const port = event.ports[0]
      if (!port) {
        invalidateEngine(generation, new Error('yt-client: frame API port is missing'))
        return
      }
      if (generation !== engineGeneration) {
        port.close()
        return
      }
      engineReject = undefined
      engineConnection = createFrameApi(port, (error) => invalidateEngine(generation, error))
      resolve(engineConnection.api)
    }
    window.addEventListener('message', onMessage)
    engineCleanup = () => window.removeEventListener('message', onMessage)
    document.body.appendChild(frame)
  })
  return engine
}

export const resetEngine = () => invalidateEngine(engineGeneration, new Error('yt-client: engine reset'))

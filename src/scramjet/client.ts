import type { FrameApi, FrameProgress, FrameRequest, FrameResponse } from '../frame/protocol'
import type { HostControlEvent, HostControlRequest } from './protocol'

import { CLEAR_COOKIES, CLOSE_SIGNIN, COOKIES_CLEARED, ENGINE_READY, OPEN_SIGNIN, SIGNIN_LOADED, SIGNIN_STATUS } from './protocol'

let engine: Promise<FrameApi> | undefined
let engineFrame: HTMLIFrameElement | undefined
let engineConnection: ReturnType<typeof createFrameApi> | undefined
let engineCleanup: (() => void) | undefined
let engineReject: ((error: Error) => void) | undefined
let engineGeneration = 0
let engineControl: MessagePort | undefined
let signInPending: { resolve: () => void, reject: (error: Error) => void, onStatus?: (signedIn: boolean) => void, onLoaded?: () => void } | undefined
// bumped by closeSignIn so an openSignIn parked on startEngine() bails instead
// of raising an orphaned overlay after the user has navigated away.
let signInGeneration = 0
let controlRequestId = 0
const CONTROL_TIMEOUT_MS = 15_000
const clearPending = new Map<number, { resolve: () => void, reject: (error: Error) => void }>()

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
      session: () => call('session'),
      resetIdentity: () => call('resetIdentity'),
    } satisfies FrameApi,
    close,
  }
}

const showHostFrame = () => {
  if (!engineFrame) return
  engineFrame.hidden = false
  // An iframe is a replaced element: inset offsets don't stretch it (it falls
  // back to the intrinsic 300x150), so size it explicitly. 5.6rem tracks the
  // header height under font scaling.
  engineFrame.style.cssText = 'position: fixed; top: 5.6rem; left: 0; width: 100vw; height: calc(100vh - 5.6rem); border: 0; z-index: 1500; background: #0f0f0f;'
}

const hideHostFrame = () => {
  if (!engineFrame) return
  engineFrame.hidden = true
  engineFrame.removeAttribute('style')
}

const connectControl = (port: MessagePort) => {
  engineControl = port
  port.addEventListener('message', (event) => {
    const message = event.data as HostControlEvent
    if (message.type === SIGNIN_LOADED) {
      signInPending?.onLoaded?.()
      return
    }
    if (message.type === SIGNIN_STATUS) {
      const pending = signInPending
      pending?.onStatus?.(message.signedIn)
      if (!message.signedIn || !pending) return
      signInPending = undefined
      hideHostFrame()
      pending.resolve()
      return
    }
    if (message.type === COOKIES_CLEARED) {
      const pending = clearPending.get(message.id)
      clearPending.delete(message.id)
      if (!pending) return
      if (message.error) pending.reject(new Error(`yt-client: clearing session cookies failed: ${message.error}`))
      else pending.resolve()
    }
  })
  port.start()
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
  engineControl?.close()
  engineControl = undefined
  signInPending?.reject(error)
  signInPending = undefined
  for (const pending of clearPending.values()) pending.reject(error)
  clearPending.clear()
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
        event.ports[1]?.close()
        return
      }
      engineReject = undefined
      const control = event.ports[1]
      if (control) connectControl(control)
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

export const openSignIn = async (
  { onStatus, onLoaded }: { onStatus?: (signedIn: boolean) => void, onLoaded?: () => void } = {},
) => {
  // capture the generation BEFORE the engine await: a closeSignIn issued while
  // the engine is still booting must cancel this open instead of letting it
  // raise the overlay over whatever route the user navigated to.
  const generation = ++signInGeneration
  await startEngine()
  if (generation !== signInGeneration) throw new Error('yt-client: sign-in closed')
  if (!engineControl) throw new Error('yt-client: engine host control is missing')
  signInPending?.reject(new Error('yt-client: sign-in restarted'))
  showHostFrame()
  engineControl.postMessage({ type: OPEN_SIGNIN } satisfies HostControlRequest)
  await new Promise<void>((resolve, reject) => {
    signInPending = { resolve, reject, onStatus, onLoaded }
  })
}

export const closeSignIn = () => {
  signInGeneration++
  engineControl?.postMessage({ type: CLOSE_SIGNIN } satisfies HostControlRequest)
  hideHostFrame()
  signInPending?.reject(new Error('yt-client: sign-in closed'))
  signInPending = undefined
}

export const clearSessionCookies = async () => {
  await startEngine()
  const control = engineControl
  if (!control) throw new Error('yt-client: engine host control is missing')
  const id = ++controlRequestId
  await new Promise<void>((resolve, reject) => {
    // the ack carries no payload, so a dead host must surface as an error
    // rather than an eternal await — sign-out treats failure as fatal.
    const timeout = setTimeout(() => {
      clearPending.delete(id)
      reject(new Error('yt-client: clearing session cookies timed out'))
    }, CONTROL_TIMEOUT_MS)
    clearPending.set(id, {
      resolve: () => {
        clearTimeout(timeout)
        resolve()
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    })
    control.postMessage({ type: CLEAR_COOKIES, id } satisfies HostControlRequest)
  })
}

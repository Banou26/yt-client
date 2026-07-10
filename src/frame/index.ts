import type { FrameApi, FrameRequest, FrameResponse, SegmentEnvelope } from './protocol'

import { createYoutubeSource } from '../sources/youtube'
import { catalogInnertube, getSabrSource } from './innertube'
import { createSabrSession } from './sabr'
import { FRAME_CONNECT } from './protocol'

const source = createYoutubeSource({
  fetch: globalThis.fetch.bind(globalThis),
  createClient: () => catalogInnertube,
})

const sessions = new Map<string, ReturnType<typeof createSabrSession>>()
let sessionId = 0

const api = {
  home: source.home,
  search: source.search,
  video: source.video,
  channel: source.channel,
  openPlayback: async (videoId, maxHeight) => {
    const id = `playback:${++sessionId}`
    const session = createSabrSession(await getSabrSource(videoId), maxHeight)
    sessions.set(id, session)
    return {
      id,
      durationMs: session.durationMs,
      videoFormats: session.videoFormats,
      audioFormats: session.audioFormats,
      selectedVideoKey: session.videoFormat.key,
      selectedAudioKey: session.audioFormat.key,
    }
  },
  requestSegment: async (request) => {
    const session = sessions.get(request.sessionId)
    if (!session) throw new Error(`youtube: unknown playback session ${request.sessionId}`)
    document.documentElement.dataset.segmentStartMs = String(request.startTimeMs)
    return session.requestSegment(request)
  },
  selectVideoFormat: async (id, key) => {
    const session = sessions.get(id)
    if (!session) throw new Error(`youtube: unknown playback session ${id}`)
    session.selectVideoFormat(key)
  },
  closePlayback: async (id) => {
    sessions.get(id)?.close()
    sessions.delete(id)
  },
} satisfies FrameApi

const dispatch = (request: FrameRequest) => {
  switch (request.method) {
    case 'home': return api.home(...request.args)
    case 'search': return api.search(...request.args)
    case 'video': return api.video(...request.args)
    case 'channel': return api.channel(...request.args)
    case 'openPlayback': return api.openPlayback(...request.args)
    case 'requestSegment': return api.requestSegment(...request.args)
    case 'selectVideoFormat': return api.selectVideoFormat(...request.args)
    case 'closePlayback': return api.closePlayback(...request.args)
  }
}

type FrameWindow = Window & {
  [FRAME_CONNECT]?: (port: MessagePort) => void
}

const connect = (port: MessagePort) => {
  port.addEventListener('message', (event) => {
    const request = event.data as FrameRequest
    document.documentElement.dataset.frameApi = request.method
    void dispatch(request).then(
      (result) => {
        document.documentElement.dataset.frameApi = `${request.method}:done`
        const transferables = request.method === 'requestSegment'
          ? [(result as SegmentEnvelope).data]
          : []
        port.postMessage({ id: request.id, result } satisfies FrameResponse, transferables)
      },
      (error) => {
        document.documentElement.dataset.frameApi = `${request.method}:error`
        port.postMessage({
          id: request.id,
          error: error instanceof Error ? error.message : String(error),
        } satisfies FrameResponse)
      },
    )
  })
  port.start()
}

Object.defineProperty(window, FRAME_CONNECT, {
  configurable: true,
  value: connect,
})

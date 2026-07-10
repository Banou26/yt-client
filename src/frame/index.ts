import type { FrameApi, FrameProgress, FrameRequest, FrameResponse, SegmentEnvelope } from './protocol'

import { createYoutubeSource } from '../sources/youtube'
import { catalogInnertube, getSabrSource } from './innertube'
import { createSabrSession, isSabrSessionRefreshError } from './sabr'
import { FRAME_CONNECT } from './protocol'

const source = createYoutubeSource({
  fetch: globalThis.fetch.bind(globalThis),
  createClient: () => catalogInnertube,
})

type PlaybackEntry = {
  videoId: string
  maxHeight?: number
  player: ReturnType<typeof createSabrSession>
  chain: Promise<unknown>
  requests: Map<string, AbortController>
  generation: number
  closed: boolean
}

const sessions = new Map<string, PlaybackEntry>()
let sessionId = 0

const refreshSession = async (entry: PlaybackEntry) => {
  if (entry.closed) throw new Error('youtube: playback session closed during refresh')
  const previous = entry.player
  const videoKey = previous.videoFormat.key
  const videoMimeType = previous.videoFormat.mimeType
  const audioKey = previous.audioFormat.key
  const audioMimeType = previous.audioFormat.mimeType
  const source = await getSabrSource(entry.videoId)
  if (entry.closed) throw new Error('youtube: playback session closed during refresh')
  const next = createSabrSession(source, entry.maxHeight)
  const videoFormat = next.videoFormats.find((format) => format.key === videoKey && format.mimeType === videoMimeType)
  const audioFormat = next.audioFormats.find((format) => format.key === audioKey && format.mimeType === audioMimeType)
  if (!videoFormat || !audioFormat) {
    next.close()
    throw new Error('youtube: playback formats changed during session refresh')
  }
  next.selectVideoFormat(videoFormat.key)
  next.selectAudioFormat(audioFormat.key)
  previous.close()
  entry.player = next
}

const api = {
  home: source.home,
  search: source.search,
  video: source.video,
  channel: source.channel,
  openPlayback: async (videoId, maxHeight) => {
    const id = `playback:${++sessionId}`
    const player = createSabrSession(await getSabrSource(videoId), maxHeight)
    sessions.set(id, {
      videoId,
      maxHeight,
      player,
      chain: Promise.resolve(),
      requests: new Map(),
      generation: 0,
      closed: false,
    })
    return {
      id,
      durationMs: player.durationMs,
      manifest: player.manifest,
      videoFormats: player.videoFormats,
      audioFormats: player.audioFormats,
      selectedVideoKey: player.videoFormat.key,
      selectedAudioKey: player.audioFormat.key,
    }
  },
  requestSegment: async (request, progress: (phase: string) => void = () => {}) => {
    const entry = sessions.get(request.sessionId)
    if (!entry) throw new Error(`youtube: unknown playback session ${request.sessionId}`)
    const controller = new AbortController()
    entry.requests.set(request.requestId, controller)
    entry.generation = Math.max(entry.generation, request.generation)
    document.documentElement.dataset.segmentStartMs = String(request.startTimeMs)
    const assertActive = () => {
      if (controller.signal.aborted || request.generation < entry.generation) {
        throw new Error('youtube: segment request cancelled')
      }
      if (entry.closed) throw new Error(`youtube: unknown playback session ${request.sessionId}`)
    }
    const run = entry.chain.then(async () => {
      assertActive()
      try {
        const segment = await entry.player.requestSegment(request, progress, controller.signal)
        assertActive()
        return segment
      } catch (error) {
        assertActive()
        if (!isSabrSessionRefreshError(error)) throw error
        document.documentElement.dataset.segmentRecovery = error.message
        progress('session-refresh')
        await refreshSession(entry)
        assertActive()
        return entry.player.requestSegment(request, progress, controller.signal)
      }
    }).finally(() => entry.requests.delete(request.requestId))
    entry.chain = run.catch(() => {})
    return run
  },
  cancelSegment: async (id, requestId) => {
    sessions.get(id)?.requests.get(requestId)?.abort()
  },
  selectVideoFormat: async (id, key) => {
    const entry = sessions.get(id)
    if (!entry) throw new Error(`youtube: unknown playback session ${id}`)
    const run = entry.chain.then(() => {
      if (entry.closed) throw new Error(`youtube: unknown playback session ${id}`)
      entry.player.selectVideoFormat(key)
    })
    entry.chain = run.catch(() => {})
    await run
  },
  closePlayback: async (id) => {
    const entry = sessions.get(id)
    if (!entry) return
    entry.closed = true
    for (const controller of entry.requests.values()) controller.abort()
    entry.requests.clear()
    entry.player.close()
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
    case 'cancelSegment': return api.cancelSegment(...request.args)
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
    const progress = (phase: string) => {
      try {
        port.postMessage({ id: request.id, progress: phase } satisfies FrameProgress)
      } catch {}
    }
    const response = request.method === 'requestSegment'
      ? api.requestSegment(request.args[0], progress)
      : dispatch(request)
    void response.then(
      (result) => {
        document.documentElement.dataset.frameApi = `${request.method}:done`
        const segment = result as SegmentEnvelope
        const transferables = request.method === 'requestSegment' && !segment.end ? [segment.data] : []
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

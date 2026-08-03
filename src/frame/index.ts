import type { FrameApi, FrameProgress, FrameRequest, FrameResponse, SegmentEnvelope } from './protocol'

import type { YoutubeClient } from '../sources/youtube'

import type { CaptionSource } from './captions'

import { createYoutubeSource } from '../sources/youtube'
import { json3ToWebVtt, parseCaptionTracks, timedTextUrl } from './captions'
import { catalogInnertube, getSabrSource, hasSessionCookie, prefetchInitialPlayerResponse } from './innertube'
import { buildLiveManifest, liveAnchor, timelineEndMs } from './live-manifest'
import { createSabrSession, isSabrSessionRefreshError } from './sabr'
import { resetIdentity, storeAccountIndex } from './identity'
import { FRAME_CONNECT, isFrameMethod } from './protocol'

const { id: _sourceId, ...sourceApi } = createYoutubeSource({
  fetch: globalThis.fetch.bind(globalThis),
  createClient: () => catalogInnertube as unknown as Promise<YoutubeClient>,
  signedIn: hasSessionCookie,
})

type PlaybackEntry = {
  videoId: string
  maxHeight?: number
  player: ReturnType<typeof createSabrSession>
  chain: Promise<unknown>
  serial: Promise<unknown>
  requests: Map<string, AbortController>
  generation: number
  closed: boolean
  refreshing?: Promise<void>
  captions: CaptionSource[]
  cueSources?: Promise<CaptionSource[]>

  lastLiveManifest?: string
  liveAnchorMs?: number
}

const sessions = new Map<string, PlaybackEntry>()
let sessionId = 0

const LIVE_START_DEPTH = 4
const LIVE_START_DEPTH_TIMEOUT_MS = 3_000
const LIVE_REFRESH_WAIT_MS = 2_000

// watch-page caption addresses are marked `exp=xpe` and answer 200 with an empty body; ANDROID_VR's serve real json3
const CUE_CLIENT = 'ANDROID_VR'

const cueSourcesFor = async (entry: PlaybackEntry) => {
  entry.cueSources ??= (async () => {
    const client = await catalogInnertube
    const info = await client.getBasicInfo(entry.videoId, { client: CUE_CLIENT })
    return parseCaptionTracks(info.captions)
  })().catch((error) => {
    entry.cueSources = undefined
    throw error
  })
  return entry.cueSources
}

const cueSourceFor = async (entry: PlaybackEntry, track: CaptionSource) => {
  const sources = await cueSourcesFor(entry)
  const match = sources.find((source) => source.id === track.id)
    ?? sources.find((source) => source.languageCode === track.languageCode && source.auto === track.auto)
    ?? sources.find((source) => source.languageCode === track.languageCode)
  if (!match) throw new Error(`youtube: caption track ${track.id} has no servable address`)
  return match
}

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
  if (!source.isLive) entry.captions = source.captions
  next.startLivePump()
}

// the anchor is carried on the entry rather than recomputed, so every refresh hangs off the same presentation zero
const liveManifestFor = (entry: PlaybackEntry) => {
  const player = entry.player
  const segments = player.liveSegments
  const nowMs = Date.now()
  const endMs = timelineEndMs(segments)
  if (endMs === undefined) return undefined
  entry.liveAnchorMs = liveAnchor(entry.liveAnchorMs, nowMs, endMs)
  return buildLiveManifest({
    videoFormats: player.videoFormats,
    audioFormats: player.audioFormats,
    targetMs: player.targetDurationMs,
    segments,
    nowMs,
    anchorMs: entry.liveAnchorMs,
  })
}

const api = {
  ...sourceApi,
  resetIdentity,
  switchAccount: async (index: number) => {
    storeAccountIndex(index)
    // order matters: the stored index deliberately survives resetIdentity
    await resetIdentity()
  },
  prefetchPlayback: async (videoId) => {
    prefetchInitialPlayerResponse(videoId)
  },
  openPlayback: async (videoId, maxHeight) => {
    const id = `playback:${++sessionId}`
    const source = await getSabrSource(videoId)
    const player = createSabrSession(source, maxHeight)
    const entry: PlaybackEntry = {
      videoId,
      maxHeight,
      player,
      chain: Promise.resolve(),
      serial: Promise.resolve(),
      requests: new Map(),
      generation: 0,
      closed: false,
      // Shaka rejects a side-loaded text track against an infinite presentation
      captions: source.isLive ? [] : source.captions,
    }
    let manifest = player.manifest
    if (source.isLive) {
      await player.requestSegment({
        requestId: `${id}:live-probe`,
        sessionId: id,
        generation: 0,
        track: 'video',
        kind: 'media',
        formatKey: player.videoFormat.key,
        startTimeMs: 0,
        snapshot: { currentTimeMs: 0, playbackRate: 1, bandwidthEstimate: 10_000_000, viewportWidth: 1_280, viewportHeight: 720 },
      }, () => {})
      player.startLivePump()
      const depthDeadline = Date.now() + LIVE_START_DEPTH_TIMEOUT_MS
      while (player.liveSegments.length < LIVE_START_DEPTH && Date.now() < depthDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      const live = liveManifestFor(entry)
      if (!live) throw new Error(`youtube: live stream ${videoId} delivered no addressable segment`)
      manifest = live
    }
    sessions.set(id, entry)
    return {
      id,
      durationMs: player.durationMs,
      manifest,
      videoFormats: player.videoFormats,
      audioFormats: player.audioFormats,
      selectedVideoKey: player.videoFormat.key,
      selectedAudioKey: player.audioFormat.key,
      storyboards: source.storyboards,
      captionTracks: entry.captions.map(({ url: _url, ...track }) => track),
      isLive: source.isLive,
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
    const base = request.kind === 'init' ? entry.serial : entry.chain
    const run = base.then(async () => {
      assertActive()
      const player = entry.player
      try {
        const segment = await player.requestSegment(request, progress, controller.signal)
        assertActive()
        return segment
      } catch (error) {
        assertActive()
        if (!isSabrSessionRefreshError(error)) throw error
        document.documentElement.dataset.segmentRecovery = error.message
        progress('session-refresh')
        // refresh only if the player that failed is still current, or a stale failure disposes a fresh session
        if (entry.player === player) {
          await (entry.refreshing ??= refreshSession(entry).finally(() => {
            entry.refreshing = undefined
          }))
        }
        assertActive()
        return entry.player.requestSegment(request, progress, controller.signal)
      }
    }).finally(() => entry.requests.delete(request.requestId))
    if (request.kind === 'init') {
      entry.chain = Promise.allSettled([entry.chain, run]).then(() => {})
    } else {
      entry.chain = run.catch(() => {})
      entry.serial = entry.chain
    }
    return run
  },
  liveManifest: async (id) => {
    const entry = sessions.get(id)
    if (!entry) throw new Error(`youtube: unknown playback session ${id}`)
    entry.player.startLivePump()
    const deadline = Date.now() + LIVE_REFRESH_WAIT_MS
    for (;;) {
      const manifest = liveManifestFor(entry)
      if (manifest) {
        entry.lastLiveManifest = manifest
        return manifest
      }
      if (Date.now() > deadline) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (entry.lastLiveManifest) return entry.lastLiveManifest
    throw new Error(`youtube: live session ${id} has no delivered segments`)
  },
  captionCues: async (id, trackId) => {
    const entry = sessions.get(id)
    if (!entry) throw new Error(`youtube: unknown playback session ${id}`)
    const track = entry.captions.find((candidate) => candidate.id === trackId)
    if (!track) throw new Error(`youtube: unknown caption track ${trackId}`)
    const source = await cueSourceFor(entry, track)
    // the frame's own fetch rather than `egressFetch`: same-origin here, and an explicit cookie header would route this onto the tunnel
    const response = await globalThis.fetch(timedTextUrl(source.url), { credentials: 'include' })
    if (!response.ok) throw new Error(`youtube: caption track ${trackId} answered ${response.status}`)
    const body = await response.text()
    if (!body) throw new Error(`youtube: caption track ${trackId} was answered with no cues`)
    return json3ToWebVtt(body)
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
    entry.serial = entry.chain
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

const dispatch = async (request: FrameRequest, progress: (phase: string) => void) => {
  // only requestSegment takes the progress callback: its RPC heartbeat is what keeps the app realm's inactivity deadline from firing mid-download
  if (request.method === 'requestSegment') return api.requestSegment(request.args[0], progress)
  if (!isFrameMethod(request.method)) throw new Error(`yt-client: unknown frame method ${String(request.method)}`)
  return (api[request.method] as (...args: unknown[]) => Promise<unknown>)(...request.args)
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
    void dispatch(request, progress).then(
      (result) => {
        document.documentElement.dataset.frameApi = `${request.method}:done`
        const segment = result as SegmentEnvelope
        const transferables = request.method === 'requestSegment' && !segment.end ? [segment.data] : []
        port.postMessage({ id: request.id, result } satisfies FrameResponse, transferables)
      },
      (error) => {
        document.documentElement.dataset.frameApi = `${request.method}:error`
        console.error(`yt-client: ${request.method} failed`, error)
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

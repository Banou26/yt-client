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

// `id` is source metadata rather than part of the RPC surface. The rest of the
// source forwards to the app unchanged.
const { id: _sourceId, ...sourceApi } = createYoutubeSource({
  fetch: globalThis.fetch.bind(globalThis),
  // YoutubeClient is the structural subset this source actually calls, so the
  // real Innertube is widened to it rather than matched field for field.
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
  // Kept with the session so a track can be addressed by id: the app is never
  // given the timedtext URL, so it can never ask the frame to fetch an
  // arbitrary one.
  captions: CaptionSource[]
  // Resolved lazily and kept for the session, so switching between tracks costs
  // one lookup rather than one per track.
  cueSources?: Promise<CaptionSource[]>

  // The last manifest that described real segments, served while the timeline
  // refills so a transient gap cannot fail Shaka's update.
  lastLiveManifest?: string
  // Presentation zero for a live session, established on the first manifest and
  // kept for every refresh after it.
  liveAnchorMs?: number
}

const sessions = new Map<string, PlaybackEntry>()
let sessionId = 0

// Segments to have in hand before a live stream starts playing, and how long
// that is worth waiting for.
const LIVE_START_DEPTH = 4
const LIVE_START_DEPTH_TIMEOUT_MS = 3_000
// How long a manifest refresh waits for the pump to refill a timeline that a
// quality switch or a session refresh just emptied.
const LIVE_REFRESH_WAIT_MS = 2_000

/* Where cue files are actually served from.

   The watch page publishes the track LIST for free, but every address on it is
   marked `exp=xpe`, and that endpoint answers a request for one with HTTP 200
   and an empty body. Measured on 2026-07-31 against every combination the
   reference implementations use, including a video-id-bound and a
   visitor-bound proof of origin token sent with `potc=1` and `c=WEB` together:
   all six published tracks, all answered 200 with content-length 0.

   The same video requested as ANDROID_VR publishes the same six tracks with no
   `exp` marker at all, and those addresses serve real json3. So the list keeps
   riding the watch page, and only the address is resolved through this second
   client, once per session and only when a viewer actually asks for cues. */
const CUE_CLIENT = 'ANDROID_VR'

const cueSourcesFor = async (entry: PlaybackEntry) => {
  entry.cueSources ??= (async () => {
    const client = await catalogInnertube
    const info = await client.getBasicInfo(entry.videoId, { client: CUE_CLIENT })
    return parseCaptionTracks(info.captions)
  })().catch((error) => {
    // Not cached as a rejection: a failed lookup should not make every later
    // selection fail without trying again.
    entry.cueSources = undefined
    throw error
  })
  return entry.cueSources
}

const cueSourceFor = async (entry: PlaybackEntry, track: CaptionSource) => {
  const sources = await cueSourcesFor(entry)
  /* Ids agree across clients because both come from the same video, so that is
     the match. Language plus generated-or-not is the fallback for a client that
     names its tracks differently, and is still exact enough not to hand back a
     different language. */
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
  /* Caption addresses are signed and expire alongside the streaming URLs a
     refresh exists to replace, so they are re-read from the same fresh
     response. Ids are stable per video, so a track the viewer already picked
     keeps resolving. */
  if (!source.isLive) entry.captions = source.captions
  // A live session that is not being consumed produces nothing, so the new one
  // has to pick the stream back up rather than wait to be asked.
  next.startLivePump()
}

/* Describes the session as it stands right now. Returns undefined until the
   transport has delivered a segment, because a live manifest that names
   anything else names something the session cannot serve.

   The anchor is carried on the entry rather than recomputed, so every refresh
   hangs off the same presentation zero. */
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
    /* Drop the identity residue too. Visitor data and PoTokens were minted
       against the previous account, and carrying them into the next one is
       exactly what resetIdentity exists to prevent. The stored index itself
       deliberately survives it. */
    await resetIdentity()
  },
  prefetchPlayback: async (videoId) => {
    // Kick (and memoize) the watch-page fetch now; openPlayback reuses it. Do
    // not await — this resolves the moment the transfer is in flight.
    prefetchInitialPlayerResponse(videoId)
  },
  openPlayback: async (videoId, maxHeight) => {
    const id = `playback:${++sessionId}`
    const source = await getSabrSource(videoId)
    const player = createSabrSession(source, maxHeight)
    /* A live manifest cannot be written before the stream says where its edge
       is, and the only thing that knows is a segment. One probe buys that, and
       it is not wasted work: the session caches it, so the first segment Shaka
       asks for is already in hand. */
    const entry: PlaybackEntry = {
      videoId,
      maxHeight,
      player,
      chain: Promise.resolve(),
      serial: Promise.resolve(),
      requests: new Map(),
      generation: 0,
      closed: false,
      // Live never offers captions: Shaka rejects a side-loaded text track
      // against an infinite presentation, so an offered track could only fail.
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
      /* Start consuming the stream before describing it. SABR pushes from its
         edge and the manifest can only advertise what has arrived, so without a
         reader running the timeline never grows and the player has nothing to
         ask for. */
      player.startLivePump()
      /* Let the timeline gain a little depth before describing it.

         The playhead opens `suggestedPresentationDelay` behind the advertised
         edge, and since segments arrive in real time that opening gap IS the
         buffer: a playhead that starts with nothing in front of it never builds
         a cushion afterwards. Waiting for a few segments is cheap because the
         server opens a stream with readahead, so they arrive far faster than
         real time. Bounded, because a stream that will not produce them should
         still play rather than hang here. */
      const depthDeadline = Date.now() + LIVE_START_DEPTH_TIMEOUT_MS
      while (player.liveSegments.length < LIVE_START_DEPTH && Date.now() < depthDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      const live = liveManifestFor(entry)
      // The probe is what seeds the timeline, so a session that delivered no
      // sequence cannot describe itself and must not pretend otherwise.
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
    // Init requests run concurrently (the SABR session parallelizes them per
    // track) but never overtake pending media work; media requests keep the
    // strict ordering behind everything else.
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
        // Refresh only if the player that failed is still current: a stale
        // failure from a concurrent request must not dispose the fresh session
        // another request is already streaming from.
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
    /* The timeline empties briefly on a quality switch and on a session
       refresh, and a refresh lands exactly when playback is already struggling.
       Waiting for the pump to refill, then falling back to the last manifest
       that worked, keeps a transient gap from becoming a dead player: throwing
       here fails Shaka's manifest update, and it will not recover on its own. */
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
    /* The frame's own fetch rather than `egressFetch`: this document is the
       rewritten youtube.com page, so the request is same-origin and carries the
       shared cookie jar without the caller assembling one. Sending an explicit
       cookie header instead would mark the request as carrying identity, which
       routes it onto the tunnel rather than the extension. */
    const response = await globalThis.fetch(timedTextUrl(source.url), { credentials: 'include' })
    if (!response.ok) throw new Error(`youtube: caption track ${trackId} answered ${response.status}`)
    const body = await response.text()
    /* An accepted request that carries no body is upstream declining to serve
       this track rather than a parse failure, and the two are worth telling
       apart: reporting it here is what stops an empty cue file from reaching
       the player and looking like captions that simply never appear. */
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

// Async so an unknown method rejects the RPC instead of throwing synchronously
// into the message listener.
const dispatch = async (request: FrameRequest, progress: (phase: string) => void) => {
  // Segments alone take the progress callback: their RPC heartbeat is what
  // keeps the app's inactivity deadline from firing mid-download.
  if (request.method === 'requestSegment') return api.requestSegment(request.args[0], progress)
  // The port carries whatever the app realm posts, so the name is checked
  // against the API surface before it is used as an index.
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
        /* Only the message crosses the port, because it is rendered to readers.
           The stack stays here, on the frame's own console, rather than being
           dropped: a TypeError thrown deep inside youtubei.js arrives in the app
           realm as a bare sentence like "Cannot read properties of undefined",
           which names neither the call that failed nor the line. That is how a
           renderer change that broke comments on every video stayed invisible. */
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

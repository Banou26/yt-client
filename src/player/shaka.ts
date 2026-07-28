import type { FrameApi, PlaybackSession } from '../frame/protocol'

import shaka from 'shaka-player'

type Bridge = {
  api: FrameApi
  generation: number
  player: shaka.Player
  requestNumber: number
  session: PlaybackSession
  video: HTMLVideoElement
}

// Kept in front of the playhead when a quality upgrade clears the buffer, so
// the swap is visible without a stall.
const SAFE_MARGIN_SECONDS = 1

const bridges = new Map<string, Bridge>()
let schemeInstalled = false
let diagnosticBridgeId: string | undefined

/* Records what the timeline ASKED for against what the transport actually
   delivered, which is the one measurement that distinguishes a live stall from
   a slow one. Kept in the app realm because it is the only place that sees both
   halves: the `start` the manifest computed and the `startMs` the SABR session
   reports back. Bounded, and only ever read by hand from the console. */
type SegmentTrace = {
  at: number
  kind: string
  track: string
  requestedMs: number
  deliveredMs?: number
  sequenceNumber?: number
  driftMs?: number
}
const SEGMENT_TRACE_LIMIT = 240
const segmentTrace: SegmentTrace[] = []
const traceSegment = (
  kind: string,
  track: string,
  requestedMs: number,
  segment: { sequenceNumber?: number, startMs?: number },
) => {
  segmentTrace.push({
    at: Math.round(performance.now()),
    kind,
    track,
    requestedMs,
    deliveredMs: segment.startMs,
    sequenceNumber: segment.sequenceNumber,
    driftMs: segment.startMs === undefined ? undefined : segment.startMs - requestedMs,
  })
  if (segmentTrace.length > SEGMENT_TRACE_LIMIT) segmentTrace.splice(0, segmentTrace.length - SEGMENT_TRACE_LIMIT)
  ;(globalThis as { __segmentTrace?: SegmentTrace[] }).__segmentTrace = segmentTrace
}

const rangeFromRequest = (request: shaka.extern.Request) => {
  const value = request.headers.Range ?? request.headers.range
  const match = value?.match(/^bytes=(\d+)-(\d+)$/)
  return match ? { start: Number(match[1]), end: Number(match[2]) } : undefined
}

const abortError = (uri: string) => new shaka.util.Error(
  shaka.util.Error.Severity.RECOVERABLE,
  shaka.util.Error.Category.NETWORK,
  shaka.util.Error.Code.OPERATION_ABORTED,
  uri,
)

const networkError = (uri: string, error: unknown) => error instanceof shaka.util.Error
  ? error
  : new shaka.util.Error(
      shaka.util.Error.Severity.RECOVERABLE,
      shaka.util.Error.Category.NETWORK,
      shaka.util.Error.Code.HTTP_ERROR,
      uri,
      error,
    )

const installScheme = () => {
  if (schemeInstalled) return
  schemeInstalled = true
  shaka.net.NetworkingEngine.registerScheme('sabr', (
    uri,
    request,
    requestType,
    progressUpdated,
    headersReceived,
  ) => {
    let isAborted = false
    let bridge: Bridge | undefined
    let segmentRequestId: string | undefined
    let abort = () => {}
    const aborted = new Promise<never>((_, reject) => {
      abort = () => {
        isAborted = true
        reject(abortError(uri))
      }
    })
    const response = (async (): Promise<shaka.extern.Response> => {
      const url = new URL(uri)
      bridge = bridges.get(url.searchParams.get('session') ?? '')
      if (!bridge) throw new Error('shaka: playback session is closed')
      /* A live manifest is refetched rather than fixed.

         Shaka reloads it every `minimumUpdatePeriod`, and each reload is
         regenerated from the segments the SABR session has actually received
         since the last one. That is what keeps the advertised live edge on real
         media: the previous design anchored one probe to the wall clock and let
         the two drift apart at real-time rate. A blob URL cannot do this, since
         its contents are frozen at creation, so live addresses the manifest
         through this scheme too. */
      if (requestType === shaka.net.NetworkingEngine.RequestType.MANIFEST) {
        const manifest = await bridge.api.liveManifest(bridge.session.id)
        if (isAborted) throw abortError(uri)
        ;(globalThis as { __liveManifest?: unknown }).__liveManifest = { at: Math.round(performance.now()), manifest }
        const headers = { 'content-type': 'application/dash+xml' }
        headersReceived(headers)
        return {
          uri,
          originalUri: uri,
          originalRequest: request,
          data: new TextEncoder().encode(manifest).buffer as ArrayBuffer,
          status: 200,
          headers,
          fromCache: false,
          timeMs: 0,
        }
      }
      if (requestType !== shaka.net.NetworkingEngine.RequestType.SEGMENT) {
        throw new Error(`shaka: unsupported SABR request type ${requestType}`)
      }
      const track = url.hostname
      if (track !== 'audio' && track !== 'video') throw new Error(`shaka: unknown track ${track}`)
      const formatKey = url.searchParams.get('key')
      if (!formatKey) throw new Error('shaka: SABR format key is missing')
      const generation = Number(url.searchParams.get('generation') ?? 0)
      if (generation < bridge.generation) throw abortError(uri)
      const kind = url.searchParams.get('kind') === 'media' ? 'media' : 'init'
      segmentRequestId = `${url.searchParams.get('session')}:${++bridge.requestNumber}`
      const started = performance.now()
      const segment = await bridge.api.requestSegment({
        requestId: segmentRequestId,
        sessionId: bridge.session.id,
        generation,
        track,
        kind,
        formatKey,
        range: rangeFromRequest(request),
        startTimeMs: Number(url.searchParams.get('start') ?? 0),
        // `n` is the live template's $Number$, which the manifest generator
        // pins to the SABR sequence. VOD templates carry no `n` and keep
        // addressing by byte range.
        sequenceNumber: url.searchParams.has('n') ? Number(url.searchParams.get('n')) : undefined,
        snapshot: {
          currentTimeMs: bridge.video.currentTime * 1_000,
          playbackRate: bridge.video.playbackRate,
          bandwidthEstimate: bridge.player.getStats().estimatedBandwidth || 10_000_000,
          viewportWidth: Math.max(1, bridge.video.clientWidth),
          viewportHeight: Math.max(1, bridge.video.clientHeight),
        },
      })
      if (isAborted) throw abortError(uri)
      traceSegment(kind, track, Number(url.searchParams.get('start') ?? 0), segment)
      if (segment.end) throw new Error(`youtube: ${track} ended before the DASH timeline`)
      const headers = {
        'content-length': String(segment.data.byteLength),
        'content-type': segment.mimeType.split(';')[0] ?? 'application/octet-stream',
      }
      headersReceived(headers)
      progressUpdated(performance.now() - started, segment.data.byteLength, 0)
      return {
        uri,
        originalUri: uri,
        originalRequest: request,
        data: segment.data,
        status: 200,
        headers,
        fromCache: false,
        timeMs: segment.elapsedMs,
      }
    })().catch((error) => {
      throw networkError(uri, error)
    })
    return new shaka.util.AbortableOperation(Promise.race([response, aborted]), async () => {
      abort()
      if (bridge && segmentRequestId) {
        await bridge.api.cancelSegment(bridge.session.id, segmentRequestId).catch(() => {})
      }
    })
  }, shaka.net.NetworkingEngine.PluginPriority.PREFERRED, false)
}

const describeShakaError = (error: shaka.util.Error) => {
  const cause = error.data.find((value: unknown) => value instanceof Error) as Error | undefined
  return cause ?? Object.assign(new Error(`shaka: error ${error.code} in category ${error.category}`), { cause: error })
}

export const startShakaPlayback = async ({
  api,
  video,
  videoId,
  startTime,
  signal,
  onError,
}: {
  api: FrameApi
  video: HTMLVideoElement
  videoId: string
  startTime: number
  signal: AbortSignal
  onError(error: unknown): void
}) => {
  if (signal.aborted) throw signal.reason
  shaka.polyfill.installAll()
  if (!shaka.Player.isBrowserSupported()) throw new Error('shaka: browser is not supported')
  installScheme()

  const maxHeight = Math.max(360, Math.ceil(video.getBoundingClientRect().height * devicePixelRatio))
  // The frame builds its session while the Shaka player constructs and attaches.
  const sessionPromise = api.openPlayback(videoId, maxHeight)
  void sessionPromise.catch(() => {})
  const closeSession = () => {
    void sessionPromise.then((session) => api.closePlayback(session.id)).catch(() => {})
  }

  const bridgeId = crypto.randomUUID()
  let player: shaka.Player | undefined
  let networking: shaka.net.NetworkingEngine | undefined
  let manifestUrl: string | undefined
  let requestFilter: shaka.extern.RequestFilter | undefined
  let playerError: ((event: Event) => void) | undefined
  let buffering: ((event: Event) => void) | undefined
  let seeking: (() => void) | undefined
  let abortListener: (() => void) | undefined
  let destroyed = false

  const destroy = async () => {
    if (destroyed) return
    destroyed = true
    if (abortListener) signal.removeEventListener('abort', abortListener)
    bridges.delete(bridgeId)
    if (networking && requestFilter) networking.unregisterRequestFilter(requestFilter)
    if (player && playerError) player.removeEventListener('error', playerError)
    if (player && buffering) player.removeEventListener('buffering', buffering)
    if (seeking) video.removeEventListener('seeking', seeking)
    if (diagnosticBridgeId === bridgeId) {
      diagnosticBridgeId = undefined
      delete document.documentElement.dataset.playbackBuffering
      delete document.documentElement.dataset.playerEngine
    }
    if (manifestUrl) URL.revokeObjectURL(manifestUrl)
    await player?.destroy().catch(() => {})
    closeSession()
  }
  abortListener = () => void destroy()
  signal.addEventListener('abort', abortListener, { once: true })

  try {
    const activePlayer = new shaka.Player()
    player = activePlayer
    networking = activePlayer.getNetworkingEngine() ?? undefined
    if (!networking) throw new Error('shaka: networking engine is missing')
    playerError = (event: Event) => {
      const detail = (event as Event & { detail?: shaka.util.Error }).detail
      if (!destroyed && detail?.severity === shaka.util.Error.Severity.CRITICAL) {
        onError(describeShakaError(detail))
      }
    }
    buffering = (event: Event) => {
      if (destroyed) return
      diagnosticBridgeId = bridgeId
      const active = Boolean((event as Event & { buffering?: boolean }).buffering)
      document.documentElement.dataset.playbackBuffering = String(active)
    }
    activePlayer.addEventListener('error', playerError)
    activePlayer.addEventListener('buffering', buffering)
    activePlayer.configure({
      preferredAudioCodecs: ['opus', 'mp4a.40.2', 'mp4a.40.5'],
      abr: { restrictToElementSize: true },
      streaming: {
        bufferingGoal: 30,
        rebufferingGoal: 0,
        bufferBehind: 30,
        segmentPrefetchLimit: 0,
        retryParameters: {
          maxAttempts: 3,
          baseDelay: 500,
          backoffFactor: 2,
          fuzzFactor: 0.5,
          timeout: 30_000,
          stallTimeout: 20_000,
          connectionTimeout: 20_000,
        },
      },
    })

    await activePlayer.attach(video)
    if (signal.aborted) throw signal.reason

    const session = await sessionPromise
    if (signal.aborted) throw signal.reason
    const bridge = { api, generation: 0, player: activePlayer, requestNumber: 0, session, video }
    bridges.set(bridgeId, bridge)
    /* VOD's manifest never changes, so a blob is exactly right for it. Live's
       has to be refetchable: Shaka reloads it on the update period and the
       frame regenerates it from segments that have arrived since. */
    const loadUrl = session.isLive
      ? `sabr://manifest?session=${bridgeId}`
      : (manifestUrl = URL.createObjectURL(new Blob([session.manifest], { type: 'application/dash+xml' })))
    requestFilter = (type, request, context) => {
      if (type !== shaka.net.NetworkingEngine.RequestType.SEGMENT) return
      request.uris = request.uris.map((uri) => {
        if (!uri.startsWith('sabr:')) return uri
        const url = new URL(uri)
        url.searchParams.set('session', bridgeId)
        url.searchParams.set('generation', String(bridge.generation))
        // SegmentBase index requests have no SegmentReference and reuse the init response cache.
        url.searchParams.set('kind', context?.segment ? 'media' : 'init')
        url.searchParams.set('start', String((context?.segment?.getStartTime() ?? video.currentTime) * 1_000))
        return url.toString()
      })
    }
    networking.registerRequestFilter(requestFilter)
    seeking = () => {
      bridge.generation += 1
    }
    video.addEventListener('seeking', seeking)
    /* Live gets its streaming budget BEFORE load, not after.

       The manifest only ever advertises segments that have already arrived, so
       a lookahead larger than the advertised window just makes Shaka ask for
       segments that do not exist yet; the frame then holds those requests open
       waiting for real time to produce them. Keeping the goal inside one update
       period means Shaka asks for what is there and comes back for more.

       Configuring after load() left the VOD 30s goal in force for the whole
       initial buffering pass, which is the window where a live stream either
       settles or starves. */
    if (session.isLive) {
      activePlayer.configure({
        streaming: {
          bufferingGoal: 10,
          rebufferingGoal: 2,
          bufferBehind: 30,
          /* Gaps are no longer expected: every append lands at the position its
             sequence names. These stay tight so a genuinely dropped segment
             costs a skip rather than a freeze, but they are a backstop now
             rather than the mechanism playback relies on. */
          gapDetectionThreshold: 0.3,
          gapPadding: 0.1,
          stallEnabled: true,
          stallThreshold: 0.5,
          stallSkip: 0.2,
        },
        /* Live runs WITHOUT automatic ABR.

           The SABR session streams one video format at a time, so every switch
           costs the session its cached readahead and makes the player ask for
           media it does not yet hold. ABR against a live edge switches
           constantly, because the buffer is inherently thin and it reads that as
           congestion: measured, it moved ten times in a minute and playback
           collapsed to readyState 0 about five seconds in.

           Quality is still selectable, just deliberately: selectQuality below
           switches both halves together and pays the re-anchor once. */
        abr: { enabled: false, defaultBandwidthEstimate: 400_000 },
      })
    }
    await activePlayer.load(loadUrl, startTime || undefined, 'application/dash+xml')
    if (signal.aborted) throw signal.reason
    /* Live opens where the manifest says, and the manifest is now built from
       media that has already arrived, so that position is real.

       This used to need help. The old timeline was extrapolated forward from a
       single probe, which put the playhead in a hole the server would never
       fill, so goToLive() plus a loop that chased video.buffered was what got
       playback started at all. goToLive() is actively wrong against an honest
       timeline: it seeks to the availability end, which is where the NEXT
       segment will begin, not where the newest one is.

       The chase loop stays as a bounded backstop, since it only ever moves the
       playhead forward and only when it sits before the first buffered range. */
    if (session.isLive) {
      /* Pin the player to the format the SESSION is streaming.

         With ABR off Shaka still makes its own opening pick, and any variant
         other than the session's costs a switch on the very first segment. The
         Representation id in the generated manifest IS the SABR format key,
         which is what makes the two sides nameable in the same terms. */
      const opening = activePlayer.getVariantTracks()
        .find((track) => track.originalVideoId === session.selectedVideoKey)
      if (opening && !opening.active) activePlayer.selectVariantTrack(opening, true)
      const settle = Date.now() + 10_000
      while (!destroyed && !signal.aborted && Date.now() < settle) {
        const buffered = video.buffered
        if (buffered.length > 0) {
          const start = buffered.start(0)
          if (video.currentTime < start) video.currentTime = start + 0.1
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
    diagnosticBridgeId = bridgeId
    document.documentElement.dataset.playerEngine = 'shaka'
    // Autoplay with sound is blocked until the origin has enough media
    // engagement, and the rejection arrives AFTER the element is already set up.
    // Falling back to muted playback is what every player does, but the mute is
    // the browser's choice, not the viewer's, so it is never written back to
    // settings: the stored volume survives and one click restores sound.
    const start = async () => {
      try {
        await video.play()
      } catch {
        if (!video.muted) {
          video.muted = true
          await video.play().catch(() => {})
        }
      }
    }
    /* Live does not WAIT for playback to begin.

       play() resolves when the element actually starts, and a live element that
       is gap-jumping can leave that promise pending indefinitely. Awaiting it
       meant startShakaPlayback never returned, so the "Loading player" status
       stayed pinned over a video that was visibly playing at 1280x720 and the
       control bar never rendered at all. Starting playback is best-effort here
       exactly as it is for VOD, where a rejection is already non-fatal. */
    if (session.isLive) void start()
    else await start()

    // Heights come from the SABR session rather than from Shaka: the session is
    // the side that has to serve the format, so anything it cannot serve must
    // not be offered.
    const heights = [...new Set(
      session.videoFormats
        .map((format) => format.height)
        .filter((height): height is number => typeof height === 'number' && height > 0),
    )].sort((a, b) => b - a)

    // Switching quality is two coordinated moves, and doing only the Shaka half
    // is what makes the stream die: the frame's SABR adapter keeps advertising
    // the old format, so segments for the newly selected one abort
    // (OPERATION_ABORTED) until Shaka gives up.
    const selectQuality = async (height: number | 'auto') => {
      if (destroyed) return
      if (height === 'auto') {
        activePlayer.configure({ abr: { enabled: true, restrictToElementSize: true } })
        return
      }
      const format = session.videoFormats
        .filter((candidate) => candidate.height === height)
        .sort((a, b) => b.bitrate - a.bitrate)[0]
      if (!format) return
      await api.selectVideoFormat(session.id, format.key)
      if (destroyed) return
      // restrictToElementSize also restricts manual picks, so it has to come off
      // before selecting a track taller than the rendered element.
      activePlayer.configure({ abr: { enabled: false, restrictToElementSize: false } })
      const track = activePlayer.getVariantTracks()
        .filter((candidate) => candidate.height === height)
        .sort((a, b) => b.bandwidth - a.bandwidth)[0]
      if (!track) return
      // Going UP, the already-buffered lower quality is exactly what the viewer
      // asked to stop seeing, so it is dropped and refetched: keeping it would
      // leave them staring at the old quality for the whole 30s buffer. Going
      // DOWN, the buffer is better than what was asked for, so it is kept and
      // the change simply applies to what comes next. SAFE_MARGIN leaves a
      // second of already-decoded video in front of the playhead so the swap
      // does not stall playback while the first new segment lands.
      const upgrade = (video.videoHeight || 0) > 0 && height > video.videoHeight
      activePlayer.selectVariantTrack(track, upgrade, upgrade ? SAFE_MARGIN_SECONDS : 0)
    }

    // Reported rather than hardcoded: the live branch above falls through to
    // this same return, and saying `false` here is what left a live stream
    // showing a 3348:27:07 / 0:00 clock instead of a LIVE badge.
    return { player: activePlayer, destroy, heights, selectQuality, storyboards: session.storyboards, isLive: session.isLive }
  } catch (error) {
    await destroy()
    throw error instanceof shaka.util.Error ? describeShakaError(error) : error
  }
}

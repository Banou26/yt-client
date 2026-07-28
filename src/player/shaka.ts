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
      if (requestType !== shaka.net.NetworkingEngine.RequestType.SEGMENT) {
        throw new Error(`shaka: unsupported SABR request type ${requestType}`)
      }
      const url = new URL(uri)
      bridge = bridges.get(url.searchParams.get('session') ?? '')
      if (!bridge) throw new Error('shaka: playback session is closed')
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
        snapshot: {
          currentTimeMs: bridge.video.currentTime * 1_000,
          playbackRate: bridge.video.playbackRate,
          bandwidthEstimate: bridge.player.getStats().estimatedBandwidth || 10_000_000,
          viewportWidth: Math.max(1, bridge.video.clientWidth),
          viewportHeight: Math.max(1, bridge.video.clientHeight),
        },
      })
      if (isAborted) throw abortError(uri)
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
    manifestUrl = URL.createObjectURL(new Blob([session.manifest], { type: 'application/dash+xml' }))
    const bridge = { api, generation: 0, player: activePlayer, requestNumber: 0, session, video }
    bridges.set(bridgeId, bridge)
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
    await activePlayer.load(manifestUrl, startTime || undefined, 'application/dash+xml')
    if (signal.aborted) throw signal.reason
    /* Live opens wherever the media actually landed.

       The manifest's presentation timeline is the stream's own clock, so a
       stream running six hours starts at 24,000s and the element would
       otherwise sit at 0 while every segment appends at the far end.
       goToLive() gets the playhead into the right neighbourhood, but not
       reliably into the media: the server streams from ITS live edge, which has
       moved on since the probe that dated the manifest, so the computed edge
       landed ~15s short of the first buffered range and stalled in the hole.

       The server decides where the media is, so the playhead follows the
       buffer rather than the arithmetic. Bounded, and only until the first
       range appears. */
    if (session.isLive) {
      /* Live gets its own buffer budget, and keeps ABR.

         The server only ever serves the live EDGE, so Shaka can never build the
         30s of lookahead the VOD config asks for: measured buffer ahead was
         ~3s. Against the VOD budget ABR read that permanently-thin buffer as
         congestion and walked a 1280x720 stream down to 256x144 inside twenty
         seconds. Pinning the format instead is worse, not better: 720p then
         held but stalled, playing 10s of media in 25s of wall clock, because
         the tunnel genuinely cannot sustain it.

         So the goal is lowered to something a live edge can actually reach and
         ABR is left to find the rate the pipe supports, which is the job it
         exists to do. */
      activePlayer.configure({
        streaming: { bufferingGoal: 12, rebufferingGoal: 2, bufferBehind: 15 },
        /* Start ABR pessimistic and let it climb. Its default estimate is
           tuned for a VOD start, where a fat first segment measures the pipe
           quickly; a live edge never hands over enough at once to correct an
           optimistic guess, so it opened at 720p, starved (11.7s of media in
           30s of wall clock, playhead 3s PAST the buffer) and never recovered.
           Climbing from a low guess converges on what the tunnel can feed. */
        abr: { defaultBandwidthEstimate: 400_000 },
      })
      try {
        activePlayer.goToLive()
      } catch {}
      const settle = Date.now() + 10_000
      while (!destroyed && !signal.aborted && Date.now() < settle) {
        const buffered = video.buffered
        if (buffered.length > 0) {
          const start = buffered.start(0)
          // Only forward: a playhead already inside the buffer is left alone.
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
    try {
      await video.play()
    } catch {
      if (!video.muted) {
        video.muted = true
        await video.play().catch(() => {})
      }
    }

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

    return { player: activePlayer, destroy, heights, selectQuality, storyboards: session.storyboards, isLive: false }
  } catch (error) {
    await destroy()
    throw error instanceof shaka.util.Error ? describeShakaError(error) : error
  }
}

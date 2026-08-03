import type { FrameApi, PlaybackSession } from '../frame/protocol'

import shaka from 'shaka-player'

import { markStartup } from '../perf'

type Bridge = {
  api: FrameApi
  generation: number
  player: shaka.Player
  requestNumber: number
  session: PlaybackSession
  video: HTMLVideoElement
}

const SAFE_MARGIN_SECONDS = 1

const bridges = new Map<string, Bridge>()
let schemeInstalled = false
let diagnosticBridgeId: string | undefined

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
        // `n` is the live template's $Number$, which the manifest generator pins to the SABR sequence
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
  const captionUrls: string[] = []
  // eslint-disable-next-line prefer-const
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
    for (const url of captionUrls) URL.revokeObjectURL(url)
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
        ignoreTextStreamFailures: true,
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
    // live's manifest has to be refetchable, and a blob's contents are frozen at creation
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
    // live gets its streaming budget BEFORE load, not after
    if (session.isLive) {
      activePlayer.configure({
        streaming: {
          bufferingGoal: 10,
          rebufferingGoal: 2,
          bufferBehind: 30,
          gapDetectionThreshold: 0.3,
          gapPadding: 0.1,
          stallEnabled: true,
          stallThreshold: 0.5,
          stallSkip: 0.2,
        },
        // live runs WITHOUT automatic ABR: the SABR session streams one video format at a time, so every switch costs its cached readahead
        abr: { enabled: false, defaultBandwidthEstimate: 400_000 },
      })
    }
    await activePlayer.load(loadUrl, startTime || undefined, 'application/dash+xml')
    if (signal.aborted) throw signal.reason
    // no goToLive(): it seeks to the availability end, which is where the NEXT segment will begin, not where the newest one is
    if (session.isLive) {
      // the Representation id in the generated manifest IS the SABR format key
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
    markStartup('player-attached')
    // `timeupdate` rather than `playing`: an element fires `playing` when it intends to play, and this has to mean the clock moved
    const markFirstFrame = () => {
      if (video.currentTime <= 0) return
      markStartup('first-frame')
      video.removeEventListener('timeupdate', markFirstFrame)
    }
    video.addEventListener('timeupdate', markFirstFrame)
    document.documentElement.dataset.playerEngine = 'shaka'
    // the mute is the browser's choice, not the viewer's, so it is never written back to settings
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
    // live does not await play(): a live element that is gap-jumping can leave that promise pending indefinitely
    if (session.isLive) void start()
    else await start()

    const heights = [...new Set(
      session.videoFormats
        .map((format) => format.height)
        .filter((height): height is number => typeof height === 'number' && height > 0),
    )].sort((a, b) => b - a)

    // switching quality is two coordinated moves: the Shaka half alone leaves the SABR adapter advertising the old format
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
      // restrictToElementSize also restricts manual picks, so it has to come off before selecting a taller track
      activePlayer.configure({ abr: { enabled: false, restrictToElementSize: false } })
      const track = activePlayer.getVariantTracks()
        .filter((candidate) => candidate.height === height)
        .sort((a, b) => b.bandwidth - a.bandwidth)[0]
      if (!track) return
      // going UP drops the already-buffered lower quality and refetches, with SAFE_MARGIN of decoded video left in front of the playhead
      const upgrade = (video.videoHeight || 0) > 0 && height > video.videoHeight
      activePlayer.selectVariantTrack(track, upgrade, upgrade ? SAFE_MARGIN_SECONDS : 0)
    }

    // Shaka is addressed by the numeric id it assigned: `getTextTracks` builds fresh objects on every call
    const captionIds = new Map<string, number>()
    let captionChain: Promise<unknown> = Promise.resolve()

    const applyCaption = async (trackId: string | undefined) => {
      if (destroyed) return
      if (!trackId) {
        activePlayer.setTextTrackVisibility(false)
        return
      }
      const track = session.captionTracks.find((candidate) => candidate.id === trackId)
      if (!track) return
      if (!captionIds.has(trackId)) {
        const vtt = await api.captionCues(session.id, trackId)
        if (destroyed) return
        const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
        captionUrls.push(url)
        const added = await activePlayer.addTextTrackAsync(url, track.languageCode, 'subtitle', 'text/vtt', undefined, track.label)
        if (destroyed) return
        captionIds.set(trackId, added.id)
      }
      const target = activePlayer.getTextTracks().find((candidate) => candidate.id === captionIds.get(trackId))
      if (!target) return
      activePlayer.selectTextTrack(target)
      activePlayer.setTextTrackVisibility(true)
    }

    // serialized so two quick picks cannot race to decide which track ends up visible
    const selectCaption = (trackId: string | undefined) => {
      const run = captionChain.then(() => applyCaption(trackId))
      captionChain = run.catch(() => {})
      return run
    }

    return {
      player: activePlayer,
      destroy,
      heights,
      selectQuality,
      storyboards: session.storyboards,
      captionTracks: session.captionTracks,
      selectCaption,
      // REPORTED rather than hardcoded false: the live branch falls through to this same return, and returning false is what left a live stream showing a 3348:27:07 / 0:00 clock instead of a LIVE badge
      isLive: session.isLive,
    }
  } catch (error) {
    await destroy()
    throw error instanceof shaka.util.Error ? describeShakaError(error) : error
  }
}

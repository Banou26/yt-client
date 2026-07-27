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
    diagnosticBridgeId = bridgeId
    document.documentElement.dataset.playerEngine = 'shaka'
    await video.play().catch(() => {})

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
      // clearBuffer stays false: dropping the buffer aborts every in-flight
      // segment, and the switch is only meant to take effect going forward.
      if (track) activePlayer.selectVariantTrack(track, false)
    }

    return { player: activePlayer, destroy, heights, selectQuality }
  } catch (error) {
    await destroy()
    throw error instanceof shaka.util.Error ? describeShakaError(error) : error
  }
}

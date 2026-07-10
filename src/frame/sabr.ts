import type {
  PlayerHttpRequest,
  PlayerHttpResponse,
  RequestFilter,
  ResponseFilter,
  SabrPlayerAdapter,
  SabrRequestMetadata,
} from 'googlevideo/sabr-streaming-adapter'
import type { SabrFormat } from 'googlevideo/shared-types'
import type { CacheManager, RequestMetadataManager } from 'googlevideo/utils'
import type { PlaybackFormat, PlaybackSnapshot, SegmentEnvelope, SegmentRequest } from './protocol'
import type { SabrSource } from './innertube'

import { SabrStreamingAdapter, SabrUmpProcessor } from 'googlevideo/sabr-streaming-adapter'
import { VideoPlaybackAbrRequest } from 'googlevideo/protos'
import { FormatKeyUtils } from 'googlevideo/utils'

type AdapterState = {
  snapshot: PlaybackSnapshot
  audio?: SabrFormat
  video?: SabrFormat
  requestFilter?: RequestFilter
  responseFilter?: ResponseFilter
  metadata?: RequestMetadataManager
  cache?: CacheManager | null
}

const bytes = (value: ArrayBuffer | ArrayBufferView | null | undefined) => {
  if (!value) return undefined
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

const headers = (input: Headers) => Object.fromEntries(input.entries())

const createPlayerAdapter = (state: AdapterState): SabrPlayerAdapter => ({
  initialize: (_player, metadata, cache) => {
    state.metadata = metadata
    state.cache = cache
  },
  getPlayerTime: () => state.snapshot.currentTimeMs / 1_000,
  getPlaybackRate: () => state.snapshot.playbackRate,
  getBandwidthEstimate: () => state.snapshot.bandwidthEstimate,
  getActiveTrackFormats: () => ({ audioFormat: state.audio, videoFormat: state.video }),
  registerRequestInterceptor: (interceptor) => {
    state.requestFilter = interceptor
  },
  registerResponseInterceptor: (interceptor) => {
    state.responseFilter = interceptor
  },
  dispose: () => {},
})

export const createSabrSession = (source: SabrSource, maxHeight = 1_080) => {
  const videoFormats = source.playbackFormats.filter((format) => format.width && format.height)
  const audioFormats = source.playbackFormats.filter((format) => !format.width)
  const initialVideoFormat = videoFormats
    .filter((format) => format.height! <= maxHeight && MediaSource.isTypeSupported(format.mimeType))
    .sort((a, b) => b.height! - a.height!)[0]
    ?? videoFormats.find((format) => MediaSource.isTypeSupported(format.mimeType))
  const initialAudioFormat = audioFormats
    .filter((format) => MediaSource.isTypeSupported(format.mimeType))
    .sort((a, b) => Number(b.mimeType.includes('opus')) - Number(a.mimeType.includes('opus')))[0]
  if (!initialVideoFormat || !initialAudioFormat) throw new Error('youtube: no supported audio and video formats')
  let videoFormat: PlaybackFormat = initialVideoFormat
  const audioFormat: PlaybackFormat = initialAudioFormat

  const byKey = new Map(source.formats.map((format) => [FormatKeyUtils.fromFormat(format), format]))
  const state: AdapterState = {
    snapshot: {
      currentTimeMs: 0,
      playbackRate: 1,
      bandwidthEstimate: 10_000_000,
      viewportWidth: 1_280,
      viewportHeight: 720,
    },
    audio: byKey.get(audioFormat.key),
    video: byKey.get(videoFormat.key),
  }
  const adapter = new SabrStreamingAdapter({
    clientInfo: source.clientInfo as never,
    playerAdapter: createPlayerAdapter(state),
  })
  adapter.setStreamingURL(source.streamingUrl)
  adapter.setUstreamerConfig(source.ustreamerConfig)
  adapter.setServerAbrFormats(source.formats)
  adapter.onMintPoToken(source.mint)
  adapter.attach(null)

  let lastMetadata: SabrRequestMetadata | undefined
  let chain: Promise<unknown> = Promise.resolve()

  const execute = async (
    url: string,
    requestHeaders: Record<string, string>,
    startTimeMs: number,
    init: boolean,
  ): Promise<PlayerHttpResponse> => {
    const request: PlayerHttpRequest = {
      url,
      method: 'GET',
      headers: requestHeaders,
      segment: {
        getStartTime: () => startTimeMs / 1_000,
        isInit: () => init,
      },
    }
    const filtered = await state.requestFilter?.(request) ?? request
    const requestBody = bytes(filtered.body)
    if (requestBody && filtered.url.includes('googlevideo.com')) {
      const decoded = VideoPlaybackAbrRequest.decode(requestBody)
      decoded.clientAbrState ??= {}
      decoded.clientAbrState.playbackAuthorization ??= {
        authorizedFormats: [
          { trackType: 1, isHdr: false },
          { trackType: 2, isHdr: false },
          { trackType: 2, isHdr: true },
        ],
      }
      decoded.clientAbrState.clientViewportWidth = state.snapshot.viewportWidth
      decoded.clientAbrState.clientViewportHeight = state.snapshot.viewportHeight
      decoded.clientAbrState.av1QualityThreshold = 1_080
      filtered.body = VideoPlaybackAbrRequest.encode(decoded).finish()
    }
    const metadata = state.metadata?.getRequestMetadata(filtered.url)
    if (!metadata) throw new Error('youtube: SABR request metadata is missing')
    lastMetadata = metadata
    const started = performance.now()
    const response = await fetch(filtered.url, {
      method: filtered.method,
      headers: {
        ...filtered.headers,
        origin: 'https://www.youtube.com',
        referer: 'https://www.youtube.com/',
        'content-type': 'application/x-protobuf',
      },
      body: requestBody ? Uint8Array.from(requestBody).buffer : undefined,
    })
    if (!response.ok) throw new Error(`youtube: segment returned ${response.status}`)
    const processor = new SabrUmpProcessor(metadata, state.cache ?? undefined)
    const reader = response.body?.getReader()
    let result: Awaited<ReturnType<typeof processor.processChunk>>
    if (reader) {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        result = await processor.processChunk(chunk.value)
        if (result?.done) {
          await reader.cancel()
          break
        }
      }
    } else {
      result = await processor.processChunk(new Uint8Array(await response.arrayBuffer()))
    }
    const data = result?.data
    const output: PlayerHttpResponse = {
      url: filtered.url,
      method: filtered.method,
      headers: headers(response.headers),
      data,
      makeRequest: (nextUrl, nextHeaders) => execute(nextUrl, nextHeaders, startTimeMs, init),
    }
    const modified = await state.responseFilter?.(output)
    Object.assign(output, modified)
    Object.assign(output, { elapsedMs: performance.now() - started })
    return output
  }

  const requestSegment = (request: SegmentRequest) => {
    state.snapshot = request.snapshot
    const format = request.track === 'video' ? videoFormat : audioFormat
    const range = request.kind === 'init' ? `bytes=${format.initRange.start}-${format.initRange.end}` : undefined
    const run = chain.then(async () => {
      const response = await execute(
        `sabr://${request.track}?key=${encodeURIComponent(format.key)}`,
        range ? { Range: range } : {},
        request.startTimeMs,
        request.kind === 'init',
      )
      const data = bytes(response.data)
      if (!data?.byteLength) throw new Error('youtube: segment response is empty')
      const media = lastMetadata?.streamInfo?.mediaHeader
      if (request.kind === 'media' && media?.contentLength && Number(media.contentLength) !== data.byteLength) {
        throw new Error(`youtube: incomplete segment ${data.byteLength}/${media.contentLength}`)
      }
      return {
        generation: request.generation,
        track: request.track,
        kind: request.kind,
        formatKey: format.key,
        mimeType: format.mimeType,
        sequenceNumber: media?.sequenceNumber,
        startMs: media?.startMs ? Number(media.startMs) : undefined,
        durationMs: media?.durationMs ? Number(media.durationMs) : undefined,
        data: Uint8Array.from(data).buffer as ArrayBuffer,
        elapsedMs: (response as PlayerHttpResponse & { elapsedMs?: number }).elapsedMs ?? 0,
      } satisfies SegmentEnvelope
    })
    chain = run.catch(() => {})
    return run
  }

  return {
    durationMs: source.durationMs,
    videoFormats,
    audioFormats,
    get videoFormat() { return videoFormat },
    get audioFormat() { return audioFormat },
    requestSegment,
    selectVideoFormat: (key: string) => {
      const next = videoFormats.find((format) => format.key === key)
      if (!next) throw new Error(`youtube: unknown video format ${key}`)
      videoFormat = next
      state.video = byKey.get(next.key)
    },
    close: () => adapter.dispose(),
  }
}

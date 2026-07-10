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
import { MediaHeader, UMPPartId, VideoPlaybackAbrRequest } from 'googlevideo/protos'
import { FormatKeyUtils } from 'googlevideo/utils'
import { resetPoTokenSession } from './botguard'
import { egressFetch } from './egress'

type AdapterState = {
  snapshot: PlaybackSnapshot
  audio?: SabrFormat
  video?: SabrFormat
  requestFilter?: RequestFilter
  responseFilter?: ResponseFilter
  metadata?: RequestMetadataManager
  cache?: CacheManager | null
}

type ExecutedResponse = PlayerHttpResponse & {
  metadata: SabrRequestMetadata
  elapsedMs: number
  endOfTrack: boolean
  partial: boolean
  partTypes: number[]
  incomplete?: { actual: number, expected: number }
}

const MAX_SEGMENT_ATTEMPTS = 3
const MAX_HARVESTED_SEGMENT_BYTES = 32 * 1024 * 1024
const MAX_MEDIA_CACHE_BYTES = 64 * 1024 * 1024
const START_TIME_TOLERANCE_MS = 2
const REFRESH_ERROR = 'SabrSessionRefreshError'

const bytes = (value: ArrayBuffer | ArrayBufferView | null | undefined) => {
  if (!value) return undefined
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

const headers = (input: Headers) => Object.fromEntries(input.entries())

const wait = (durationMs: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason)
  const complete = () => {
    signal?.removeEventListener('abort', aborted)
    resolve()
  }
  const timer = setTimeout(complete, durationMs)
  const aborted = () => {
    clearTimeout(timer)
    signal?.removeEventListener('abort', aborted)
    reject(signal?.reason)
  }
  signal?.addEventListener('abort', aborted, { once: true })
})

const refreshError = (message: string) => Object.assign(new Error(message), { name: REFRESH_ERROR })

export const isSabrSessionRefreshError = (error: unknown): error is Error =>
  error instanceof Error && error.name === REFRESH_ERROR

type UmpVarInt = { value: number, offset: number }

const readUmpVarInt = (data: Uint8Array, offset: number): UmpVarInt | undefined => {
  if (offset >= data.byteLength) return undefined
  const first = data[offset]!
  const length = first < 128 ? 1 : first < 192 ? 2 : first < 224 ? 3 : first < 240 ? 4 : 5
  if (offset + length > data.byteLength) return undefined
  if (length === 1) return { value: first, offset: offset + 1 }
  if (length === 2) return { value: (first & 0x3f) + 64 * data[offset + 1]!, offset: offset + 2 }
  if (length === 3) {
    return {
      value: (first & 0x1f) + 32 * (data[offset + 1]! + 256 * data[offset + 2]!),
      offset: offset + 3,
    }
  }
  if (length === 4) {
    return {
      value: (first & 0x0f) + 16 * (data[offset + 1]! + 256 * (data[offset + 2]! + 256 * data[offset + 3]!)),
      offset: offset + 4,
    }
  }
  return {
    value: new DataView(data.buffer, data.byteOffset + offset + 1, 4).getUint32(0, true),
    offset: offset + 5,
  }
}

export const createUmpFramer = () => {
  let pending = new Uint8Array()
  return {
    push(chunk: Uint8Array) {
      const data = pending.byteLength
        ? (() => {
            const joined = new Uint8Array(pending.byteLength + chunk.byteLength)
            joined.set(pending)
            joined.set(chunk, pending.byteLength)
            return joined
          })()
        : chunk
      const frames: { type: number, data: Uint8Array, payload: Uint8Array }[] = []
      let offset = 0
      while (offset < data.byteLength) {
        const start = offset
        const type = readUmpVarInt(data, offset)
        if (!type) break
        const size = readUmpVarInt(data, type.offset)
        if (!size || size.offset + size.value > data.byteLength) break
        const end = size.offset + size.value
        const encoded = data.slice(start, end)
        frames.push({
          type: type.value,
          data: encoded,
          payload: encoded.subarray(size.offset - start),
        })
        offset = end
      }
      pending = data.slice(offset)
      return frames
    },
    get partial() { return pending.byteLength > 0 },
  }
}

type UmpFrame = ReturnType<ReturnType<typeof createUmpFramer>['push']>[number]
type CollectedUmpSegment = {
  formatKey: string
  header: ReturnType<typeof MediaHeader.decode>
  data: Uint8Array
}

export const createUmpSegmentCollector = () => {
  const pending = new Map<number, {
    header: ReturnType<typeof MediaHeader.decode>
    chunks: Uint8Array[]
    size: number
  }>()
  return {
    push(frame: UmpFrame): CollectedUmpSegment | undefined {
      if (frame.type === UMPPartId.MEDIA_HEADER) {
        const header = MediaHeader.decode(frame.payload)
        pending.set(header.headerId ?? 0, { header, chunks: [], size: 0 })
        return
      }
      if (frame.type !== UMPPartId.MEDIA && frame.type !== UMPPartId.MEDIA_END) return
      const headerId = frame.payload[0]
      if (headerId === undefined) return
      const segment = pending.get(headerId)
      if (!segment) return
      if (frame.type === UMPPartId.MEDIA) {
        const chunk = frame.payload.subarray(1)
        segment.size += chunk.byteLength
        if (segment.size > MAX_HARVESTED_SEGMENT_BYTES) pending.delete(headerId)
        else segment.chunks.push(Uint8Array.from(chunk))
        return
      }
      pending.delete(headerId)
      const expected = Number(segment.header.contentLength ?? 0)
      if (expected > 0 && segment.size !== expected) return
      const data = new Uint8Array(segment.size)
      let offset = 0
      for (const chunk of segment.chunks) {
        data.set(chunk, offset)
        offset += chunk.byteLength
      }
      return {
        formatKey: FormatKeyUtils.fromMediaHeader(segment.header),
        header: segment.header,
        data,
      }
    },
    clear: () => pending.clear(),
  }
}

export const inspectUmpChunks = (chunks: Uint8Array[]) => {
  const framer = createUmpFramer()
  const partTypes: number[] = []
  for (const chunk of chunks) {
    for (const frame of framer.push(chunk)) partTypes.push(frame.type)
  }
  return {
    endOfTrack: partTypes.includes(UMPPartId.END_OF_TRACK),
    partial: framer.partial,
    partTypes,
  }
}

const describeNoMedia = (response: ExecutedResponse) => {
  const sabrError = response.metadata.error?.sabrError
  if (sabrError) return `SABR error ${sabrError.type ?? 'unknown'}:${sabrError.code ?? 'unknown'}`
  const streamStatus = response.metadata.streamInfo?.streamProtectionStatus?.status
  if (streamStatus !== undefined) return `SABR stream status ${streamStatus}`
  if (response.metadata.streamInfo?.reloadPlaybackContext) return 'SABR player reload requested'
  if (response.partial) return 'truncated UMP response'
  const parts = response.partTypes.map((type) => UMPPartId[type] ?? String(type)).join(', ')
  return parts ? `UMP response contained ${parts}` : 'UMP response contained no parts'
}

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
  let audioFormat: PlaybackFormat = initialAudioFormat

  const byKey = new Map(source.formats.map((format) => [FormatKeyUtils.fromFormat(format), format]))
  const playbackByKey = new Map(source.playbackFormats.map((format) => [format.key, format]))
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

  type CachedMedia = CollectedUmpSegment & {
    cacheKey: string
    durationMs?: number
    sequenceNumber?: number
    startMs: number
    track: 'audio' | 'video'
  }
  type ActiveHarvest = {
    done: Promise<void>
    formatKeys: Set<string>
    generation: number
    reader: ReadableStreamDefaultReader<Uint8Array>
  }
  const mediaCache = new Map<string, CachedMedia>()
  let mediaCacheBytes = 0
  let resolveCacheChange: () => void = () => {}
  let cacheChange = new Promise<void>((resolve) => {
    resolveCacheChange = resolve
  })
  let activeHarvest: ActiveHarvest | undefined

  const notifyCacheChange = () => {
    const resolve = resolveCacheChange
    cacheChange = new Promise<void>((nextResolve) => {
      resolveCacheChange = nextResolve
    })
    resolve()
  }

  const storeCollectedSegment = (segment: CollectedUmpSegment) => {
    const sabrFormat = byKey.get(segment.formatKey)
    if (!sabrFormat) return
    if (segment.header.isInitSeg) {
      state.cache?.setInitSegment(
        FormatKeyUtils.createSegmentCacheKey(segment.header, sabrFormat),
        segment.data,
      )
      notifyCacheChange()
      return
    }
    const format = playbackByKey.get(segment.formatKey)
    const startMs = Number(segment.header.startMs)
    if (!format || !Number.isFinite(startMs)) return
    const cacheKey = `${segment.formatKey}:${startMs}:${segment.header.sequenceNumber ?? ''}`
    if (mediaCache.has(cacheKey)) return
    const cached: CachedMedia = {
      ...segment,
      cacheKey,
      durationMs: segment.header.durationMs === undefined ? undefined : Number(segment.header.durationMs),
      sequenceNumber: segment.header.sequenceNumber,
      startMs,
      track: format.width ? 'video' : 'audio',
    }
    mediaCache.set(cacheKey, cached)
    mediaCacheBytes += segment.data.byteLength
    while (mediaCacheBytes > MAX_MEDIA_CACHE_BYTES) {
      const oldest = mediaCache.entries().next().value as [string, CachedMedia] | undefined
      if (!oldest) break
      mediaCache.delete(oldest[0])
      mediaCacheBytes -= oldest[1].data.byteLength
    }
    notifyCacheChange()
  }

  const findCachedMedia = (track: 'audio' | 'video', formatKey: string, startTimeMs: number) => {
    let closest: CachedMedia | undefined
    for (const segment of mediaCache.values()) {
      if (segment.track !== track || segment.formatKey !== formatKey) continue
      if (Math.abs(segment.startMs - startTimeMs) > START_TIME_TOLERANCE_MS) continue
      if (!closest || Math.abs(segment.startMs - startTimeMs) < Math.abs(closest.startMs - startTimeMs)) {
        closest = segment
      }
    }
    return closest
  }

  const withAbort = <T>(promise: Promise<T>, signal?: AbortSignal) => {
    if (!signal) return promise
    if (signal.aborted) return Promise.reject(signal.reason)
    return new Promise<T>((resolve, reject) => {
      const aborted = () => reject(signal.reason)
      signal.addEventListener('abort', aborted, { once: true })
      void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
    })
  }

  const cancelActiveHarvest = async () => {
    const harvest = activeHarvest
    if (!harvest) return
    activeHarvest = undefined
    notifyCacheChange()
    await harvest.reader.cancel().catch(() => {})
  }

  let chain: Promise<unknown> = Promise.resolve()

  const selectFormat = (track: 'audio' | 'video', key: string) => {
    const formats = track === 'video' ? videoFormats : audioFormats
    const next = formats.find((format) => format.key === key)
    if (!next) throw new Error(`youtube: unknown ${track} format ${key}`)
    void cancelActiveHarvest()
    if (track === 'video') {
      videoFormat = next
      state.video = byKey.get(next.key)
    } else {
      audioFormat = next
      state.audio = byKey.get(next.key)
    }
    return next
  }

  const execute = async (
    url: string,
    requestHeaders: Record<string, string>,
    startTimeMs: number,
    init: boolean,
    generation: number,
    progress: (phase: string) => void,
    signal?: AbortSignal,
    attempt = 0,
  ): Promise<ExecutedResponse> => {
    if (signal?.aborted) throw signal.reason
    const request: PlayerHttpRequest = {
      url,
      method: 'GET',
      headers: requestHeaders,
      segment: {
        getStartTime: () => startTimeMs / 1_000,
        isInit: () => init,
      },
    }
    progress('request-filter')
    const filtered = await state.requestFilter?.(request) ?? request
    let requestBody = bytes(filtered.body)
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
      const cachedTracks = new Set(Array.from(mediaCache.values(), (segment) => segment.track))
      if (init && state.audio && state.video && cachedTracks.size < 2) {
        decoded.clientAbrState.enabledTrackTypesBitfield = 0
        decoded.clientAbrState.audioTrackId = state.audio.audioTrackId
        decoded.clientAbrState.drcEnabled = state.audio.isDrc ?? false
        decoded.clientAbrState.stickyResolution = state.video.height
        decoded.clientAbrState.lastManualSelectedResolution = state.video.height
        decoded.preferredAudioFormatIds = [state.audio]
        decoded.preferredVideoFormatIds = [state.video]
        decoded.selectedFormatIds = []
        decoded.bufferedRanges = []
      }
      requestBody = VideoPlaybackAbrRequest.encode(decoded).finish()
      filtered.body = requestBody
    }
    const metadata = state.metadata?.getRequestMetadata(filtered.url)
    if (!metadata) throw new Error('youtube: SABR request metadata is missing')
    const started = performance.now()
    progress('fetch')
    const response = await egressFetch(filtered.url, {
      method: filtered.method,
      headers: {
        ...filtered.headers,
        origin: 'https://www.youtube.com',
        referer: 'https://www.youtube.com/',
        'content-type': 'application/x-protobuf',
      },
      body: requestBody ? Uint8Array.from(requestBody).buffer : undefined,
      redirect: 'manual',
    }, signal)
    progress('headers')
    if (response.status === 403 && attempt === 0) {
      await response.body?.cancel()
      progress('token-reset')
      await resetPoTokenSession()
      return execute(url, requestHeaders, startTimeMs, init, generation, progress, signal, attempt + 1)
    }
    if (!response.ok) {
      if (response.status === 403) await resetPoTokenSession()
      throw refreshError(`youtube: segment returned ${response.status}`)
    }
    const processor = new SabrUmpProcessor(metadata, state.cache ?? undefined)
    const collector = createUmpSegmentCollector()
    const framer = createUmpFramer()
    const reader = response.body?.getReader()
    const partTypes: number[] = []
    type ProcessingResult = Awaited<ReturnType<typeof processor.processChunk>>
    let result: ProcessingResult
    let readerDone = false
    const process = async (chunk: Uint8Array) => {
      for (const frame of framer.push(chunk)) {
        partTypes.push(frame.type)
        const collected = collector.push(frame)
        if (collected) storeCollectedSegment(collected)
        const mediaPart = frame.type === UMPPartId.MEDIA_HEADER
          || frame.type === UMPPartId.MEDIA
          || frame.type === UMPPartId.MEDIA_END
        if (!result || !mediaPart) {
          const next = await processor.processChunk(frame.data)
          if (next?.done && !result) result = next
        }
      }
    }
    if (reader) {
      while (!result) {
        const chunk = await reader.read()
        if (chunk.done) {
          readerDone = true
          break
        }
        progress('body')
        await process(chunk.value)
      }
    } else {
      const chunk = new Uint8Array(await response.arrayBuffer())
      progress('body')
      await process(chunk)
      readerDone = true
    }
    const data = result?.data
    const mediaHeader = metadata.streamInfo?.mediaHeader
    const expectedLength = Number(mediaHeader?.contentLength ?? 0)
    const actualLength = data?.byteLength ?? 0
    const incomplete = !init && expectedLength > 0 && actualLength !== expectedLength
      ? { actual: actualLength, expected: expectedLength }
      : undefined
    if (incomplete && metadata.streamInfo) delete metadata.streamInfo.mediaHeader
    const output: ExecutedResponse = {
      url: filtered.url,
      method: filtered.method,
      headers: headers(response.headers),
      data,
      makeRequest: (nextUrl, nextHeaders) => execute(
        nextUrl,
        nextHeaders,
        startTimeMs,
        init,
        generation,
        progress,
        signal,
      ),
      metadata,
      elapsedMs: performance.now() - started,
      incomplete,
      endOfTrack: partTypes.includes(UMPPartId.END_OF_TRACK),
      partial: framer.partial,
      partTypes: [...partTypes],
    }
    progress('response-filter')
    const modified = await state.responseFilter?.(output)
    Object.assign(output, modified)
    if (incomplete && mediaHeader) {
      metadata.streamInfo ??= {}
      metadata.streamInfo.mediaHeader = mediaHeader
    }
    if (reader && result?.done && !readerDone) {
      const harvest = {
        done: Promise.resolve(),
        formatKeys: new Set([state.audio, state.video].flatMap((format) => {
          const key = FormatKeyUtils.fromFormat(format)
          return key ? [key] : []
        })),
        generation,
        reader,
      } satisfies ActiveHarvest
      activeHarvest = harvest
      harvest.done = (async () => {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          await process(chunk.value)
        }
      })().catch(() => {}).finally(() => {
        collector.clear()
        if (activeHarvest === harvest) activeHarvest = undefined
        notifyCacheChange()
      })
    } else {
      collector.clear()
    }
    output.elapsedMs = performance.now() - started
    return output
  }

  const requestSegment = (
    request: SegmentRequest,
    progress: (phase: string) => void = () => {},
    signal?: AbortSignal,
  ) => {
    const run = chain.then(async () => {
      if (signal?.aborted) throw signal.reason
      state.snapshot = request.snapshot
      const currentFormat = request.track === 'video' ? videoFormat : audioFormat
      const format = request.formatKey && request.formatKey !== currentFormat.key
        ? selectFormat(request.track, request.formatKey)
        : currentFormat
      const requestedRange = request.range ?? (request.kind === 'init' ? format.initRange : undefined)
      const range = requestedRange ? `bytes=${requestedRange.start}-${requestedRange.end}` : undefined
      const getCachedSegment = (): SegmentEnvelope | undefined => {
        if (request.kind === 'init' && requestedRange) {
          const sabrFormat = byKey.get(format.key)
          const cacheKey = sabrFormat && FormatKeyUtils.createSegmentCacheKey({
            itag: sabrFormat.itag,
            xtags: sabrFormat.xtags,
            isInitSeg: true,
          } as never, sabrFormat)
          const cached = cacheKey ? bytes(state.cache?.getInitSegment(cacheKey)) : undefined
          if (!cached || requestedRange.end >= cached.byteLength) return
          return {
            generation: request.generation,
            track: request.track,
            kind: request.kind,
            formatKey: format.key,
            mimeType: format.mimeType,
            elapsedMs: 0,
            end: false as const,
            data: cached.slice(requestedRange.start, requestedRange.end + 1).buffer,
          }
        }
        if (request.kind === 'media') {
          const cached = findCachedMedia(request.track, format.key, request.startTimeMs)
          if (!cached) return
          return {
            generation: request.generation,
            track: request.track,
            kind: request.kind,
            formatKey: format.key,
            mimeType: format.mimeType,
            elapsedMs: 0,
            end: false as const,
            sequenceNumber: cached.sequenceNumber,
            startMs: cached.startMs,
            durationMs: cached.durationMs,
            data: Uint8Array.from(cached.data).buffer as ArrayBuffer,
          }
        }
      }
      const getHarvestedSegment = async () => {
        let cached = getCachedSegment()
        if (cached) return cached
        const harvest = activeHarvest
        if (!harvest) return
        if (harvest.generation !== request.generation || !harvest.formatKeys.has(format.key)) {
          await cancelActiveHarvest()
          return
        }
        while (activeHarvest === harvest) {
          const changed = cacheChange
          progress('cache-wait')
          await withAbort(Promise.race([changed, harvest.done]), signal)
          cached = getCachedSegment()
          if (cached) return cached
        }
        return getCachedSegment()
      }
      const fetchSegment = async (attempt = 0): Promise<SegmentEnvelope> => {
        const harvested = await getHarvestedSegment()
        if (harvested) return harvested
        const response = await execute(
          `sabr://${request.track}?key=${encodeURIComponent(format.key)}`,
          range ? { Range: range } : {},
          request.startTimeMs,
          request.kind === 'init',
          request.generation,
          progress,
          signal,
        )
        const common = {
          generation: request.generation,
          track: request.track,
          kind: request.kind,
          formatKey: format.key,
          mimeType: format.mimeType,
          elapsedMs: response.elapsedMs,
        }
        const data = bytes(response.data)
        const media = response.metadata.streamInfo?.mediaHeader
        if (data?.byteLength && !response.incomplete) {
          return {
            ...common,
            end: false,
            sequenceNumber: media?.sequenceNumber,
            startMs: media?.startMs !== undefined ? Number(media.startMs) : undefined,
            durationMs: media?.durationMs !== undefined ? Number(media.durationMs) : undefined,
            data: Uint8Array.from(data).buffer as ArrayBuffer,
          }
        }
        if (request.kind === 'media' && response.endOfTrack && !data?.byteLength) {
          return { ...common, end: true }
        }
        const streamStatus = response.metadata.streamInfo?.streamProtectionStatus?.status
        const reason = response.incomplete
          ? `incomplete segment ${response.incomplete.actual}/${response.incomplete.expected}`
          : describeNoMedia(response)
        if (response.metadata.streamInfo?.reloadPlaybackContext) throw refreshError(`youtube: ${reason}`)
        if (attempt + 1 < MAX_SEGMENT_ATTEMPTS) {
          if (streamStatus === 3) await resetPoTokenSession()
          const serverBackoff = response.metadata.streamInfo?.nextRequestPolicy?.backoffTimeMs ?? 0
          progress('retry')
          await wait(Math.min(2_000, Math.max(serverBackoff, 200 * 2 ** attempt)), signal)
          return fetchSegment(attempt + 1)
        }
        throw refreshError(`youtube: ${reason} after ${MAX_SEGMENT_ATTEMPTS} attempts`)
      }
      return fetchSegment()
    })
    chain = run.catch(() => {})
    return run
  }

  return {
    durationMs: source.durationMs,
    manifest: source.manifest,
    videoFormats,
    audioFormats,
    get videoFormat() { return videoFormat },
    get audioFormat() { return audioFormat },
    requestSegment,
    selectVideoFormat: (key: string) => selectFormat('video', key),
    selectAudioFormat: (key: string) => selectFormat('audio', key),
    close: () => {
      void cancelActiveHarvest()
      mediaCache.clear()
      mediaCacheBytes = 0
      adapter.dispose()
    },
  }
}

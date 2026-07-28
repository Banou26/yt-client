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
import { GVS_ORIGIN_KEY } from './innertube'
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
/* How long a live request will wait for the segment it actually named. The
   ceiling is Shaka's own 30s segment timeout: giving up first turns a wait into
   a retry we control instead of a network error it reports. */
const LIVE_SEGMENT_WAIT_MS = 20_000
// Segments kept in the advertised timeline, which is also the rewind window.
const LIVE_TIMELINE_LIMIT = 48

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

/* A rangeless init answer is the initialization segment CONCATENATED with a
   media segment: ftyp + moov + emsg + moof + mdat, of which only the first few
   hundred bytes are the init. MSE needs the initialization segment on its own,
   and handing it the whole blob does not error, it just leaves readyState and
   videoWidth at 0 forever.

   Only correct for the rangeless (live) case. A VOD range request returns
   ftyp + moov + sidx, and cutting at moov would drop the sidx that SegmentBase
   indexing depends on. */
const initSegmentPrefix = (data: Uint8Array) => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 0
  while (offset + 8 <= view.byteLength) {
    const size = view.getUint32(offset)
    if (size < 8) break
    const type = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7),
    )
    offset += size
    if (type === 'moov') return data.subarray(0, Math.min(offset, data.byteLength))
  }
  return data
}

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
  // Every live stream measured used 5s segments; the formats' own figure wins
  // wherever they publish one.
  const targetDurationMs = initialVideoFormat.targetDurationMs ?? initialAudioFormat.targetDurationMs ?? 5_000

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
  /* The live timeline, recorded from what the transport actually delivered.

     A live MPD can only honestly describe segments the session can serve, and
     the session can only serve what it has already received: the server ignores
     the address on a request and answers with its current edge, so a timeline
     extrapolated forward names segments that will never arrive. Video drives it
     because it is the track a viewer notices stalling; audio fills a sequence in
     only when video has not reported it yet. */
  const liveTimeline = new Map<number, { sequenceNumber: number, startMs: number, durationMs: number }>()
  const recordLiveSegment = (segment: CachedMedia, targetMs: number) => {
    const { sequenceNumber, startMs, track } = segment
    if (sequenceNumber === undefined) return
    if (track === 'audio' && liveTimeline.has(sequenceNumber)) return
    liveTimeline.set(sequenceNumber, {
      sequenceNumber,
      startMs,
      // A final short segment would leave a hole in the timeline; the target
      // duration is the stream's own answer for how long a segment covers.
      durationMs: segment.durationMs && segment.durationMs > 0 ? segment.durationMs : targetMs,
    })
    while (liveTimeline.size > LIVE_TIMELINE_LIMIT) {
      const oldest = liveTimeline.keys().next().value
      if (oldest === undefined) break
      liveTimeline.delete(oldest)
    }
  }
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
      const cacheKey = FormatKeyUtils.createSegmentCacheKey(segment.header, sabrFormat)
      // A combined init+index blob may already be cached; never shrink it.
      const existing = bytes(state.cache?.getInitSegment(cacheKey))
      if (!existing || existing.byteLength < segment.data.byteLength) {
        state.cache?.setInitSegment(cacheKey, segment.data)
      }
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
    if (source.isLive) recordLiveSegment(cached, targetDurationMs)
    mediaCacheBytes += segment.data.byteLength
    while (mediaCacheBytes > MAX_MEDIA_CACHE_BYTES) {
      const oldest = mediaCache.entries().next().value as [string, CachedMedia] | undefined
      if (!oldest) break
      mediaCache.delete(oldest[0])
      mediaCacheBytes -= oldest[1].data.byteLength
    }
    notifyCacheChange()
  }

  const findCachedSequence = (track: 'audio' | 'video', formatKey: string, sequenceNumber: number) => {
    for (const segment of mediaCache.values()) {
      if (segment.track !== track || segment.formatKey !== formatKey) continue
      if (segment.sequenceNumber === sequenceNumber) return segment
    }
  }

  // The span this session can still answer for, per format. Outside it a request
  // is unservable rather than slow: the transport cannot rewind, and anything
  // older has already been evicted.
  const cachedSequenceRange = (track: 'audio' | 'video', formatKey: string) => {
    let oldest: number | undefined
    let newest: number | undefined
    for (const segment of mediaCache.values()) {
      if (segment.track !== track || segment.formatKey !== formatKey) continue
      const sequence = segment.sequenceNumber
      if (sequence === undefined) continue
      if (oldest === undefined || sequence < oldest) oldest = sequence
      if (newest === undefined || sequence > newest) newest = sequence
    }
    return { oldest, newest }
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
  // Where init requests fork from: the last serial (media/select) operation.
  // Inits run parallel to each other but never overtake pending media work,
  // since a format switch inside an init cancels the harvest media relies on.
  let serialTail: Promise<unknown> = Promise.resolve()

  // The SabrStreamingAdapter tracks, per format, how far ahead we've buffered and
  // reports it to the server so it knows how much readahead to push. It only
  // resets that tracking on a *backward* seek (getPlayerTime() < lastPlayerTimeSecs);
  // a forward jump leaves ranges anchored at t=0 with the pre-seek duration. Then a
  // post-seek request claims a tiny buffered window far behind the requested
  // position, and the server withholds media entirely (streamProtectionStatus 2 +
  // PLAYBACK_START_POLICY, no MEDIA parts) for any seek past its readahead window —
  // which our loop then mistakes for a fatal error and refresh-loops on. Clearing
  // the tracking on any seek makes the next request look like a fresh start, which
  // the server serves at the requested position (exactly how initial load works).
  // (The playback cookie is intentionally NOT reset here — it carries session/format
  // state and a seek only changes playerTimeMs, not the session.)
  let seekGeneration = 0
  const resetBufferTracking = () => {
    const internals = adapter as unknown as { initializedFormats?: { clear?: () => void } }
    internals.initializedFormats?.clear?.()
  }

  const selectFormat = (track: 'audio' | 'video', key: string) => {
    const formats = track === 'video' ? videoFormats : audioFormats
    const next = formats.find((format) => format.key === key)
    if (!next) throw new Error(`youtube: unknown ${track} format ${key}`)
    void cancelActiveHarvest()
    /* The live timeline deliberately SURVIVES a format switch. Sequence numbers
       are aligned across formats (a sequence covers the same media time in every
       one of them), so the sequence-to-time mapping is format independent even
       though the cached bytes are not. Clearing it here re-anchored the whole
       presentation on every switch: ABR moved ten times in a minute, the
       manifest re-anchored ten times behind it, and playback collapsed to
       readyState 0 about five seconds in. */
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
    dualTrack = false,
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
      if (init && dualTrack && state.audio && state.video && cachedTracks.size < 2) {
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
      await source.recoverMint()
      return execute(url, requestHeaders, startTimeMs, init, generation, progress, signal, attempt + 1, dualTrack)
    }
    if (!response.ok) {
      if (response.status === 403) await source.recoverMint()
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
        0,
        dualTrack,
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

  /* Live keeps the stream flowing on its own, independent of player demand.

     SABR is a PUSH transport: a request opens a stream the server keeps feeding,
     and it always feeds from its current edge. A manifest can therefore only
     honestly advertise segments that have already arrived. That closes a loop
     if nothing else pulls: the timeline only grows when segments arrive,
     segments only arrive when something fetches, and the player only fetches
     what the timeline advertises. Measured, that deadlock is total, two segment
     requests in fifty-six seconds with an empty buffer.

     So the session consumes the stream continuously and the player reads out of
     the cache behind it. This is also what the transport wants: one long-lived
     harvest rather than a fetch per segment. */
  let livePump: Promise<void> | undefined

  const runLivePump = async () => {
    while (!closeController.signal.aborted) {
      try {
        if (!activeHarvest) {
          // Ask from the edge we know about, so the server's readahead picks up
          // where the last harvest left off rather than restarting behind it.
          const startTimeMs = [...liveTimeline.values()]
            .reduce((newest, segment) => Math.max(newest, segment.startMs + segment.durationMs), 0)
          const run = chain.then(() => execute(
            `sabr://video?key=${encodeURIComponent(videoFormat.key)}`,
            {},
            startTimeMs,
            false,
            seekGeneration,
            () => {},
            closeController.signal,
          ))
          chain = run.catch(() => {})
          serialTail = chain
          await run
        }
        // Harvesting happens off the chain, so player requests stay responsive
        // while the stream feeds the cache behind them.
        const harvest = activeHarvest
        if (harvest) await harvest.done
        else await wait(Math.round(targetDurationMs / 2), closeController.signal)
      } catch {
        if (closeController.signal.aborted) return
        // A failed pull is not fatal: the next one re-opens from the edge, which
        // is where the server would have put us anyway.
        await wait(1_000, closeController.signal).catch(() => {})
      }
    }
  }

  const ensureLivePump = () => {
    if (!source.isLive || livePump || closeController.signal.aborted) return
    livePump = runLivePump().finally(() => {
      livePump = undefined
    })
  }

  const initFetches = new Map<string, Promise<Uint8Array>>()
  // Init blob fetches are shared between requesters, so they must not die with
  // any single requester's signal, only with the session itself.
  const closeController = new AbortController()

  const initCacheKey = (formatKey: string) => {
    const sabrFormat = byKey.get(formatKey)
    return sabrFormat && FormatKeyUtils.createSegmentCacheKey({
      itag: sabrFormat.itag,
      xtags: sabrFormat.xtags,
      isInitSeg: true,
    } as never, sabrFormat)
  }

  // Fetches the whole init+index head of a format in one round trip and caches
  // it, so Shaka's separate init and SegmentBase index requests share a single
  // fetch instead of two serial ones.
  const fetchInitBlob = async (
    track: 'audio' | 'video',
    format: PlaybackFormat,
    startTimeMs: number,
    generation: number,
    progress: (phase: string) => void,
    dualTrack: boolean,
    attempt = 0,
  ): Promise<Uint8Array> => {
    const end = Math.max(format.initRange?.end ?? 0, format.indexRange?.end ?? 0)
    const response = await execute(
      `sabr://${track}?key=${encodeURIComponent(format.key)}`,
      /* No init range means nothing to slice. Asking for `bytes=0-0` returns
         exactly one byte, and the success path below CACHES it, so every later
         read serves that byte and MSE fails the append (shaka 3014). The server
         sends the init segment on the stream instead, filed by
         storeCollectedSegment under the same key this function reads. */
      format.initRange ? { Range: `bytes=0-${end}` } : {},
      startTimeMs,
      true,
      generation,
      progress,
      closeController.signal,
      0,
      dualTrack,
    )
    /* Which of the two answers is the init segment depends on how it was asked
       for. A RANGE request (VOD) returns the init+index head as the response
       body. A rangeless one (live) returns a MEDIA blob as the body, several
       hundred KB of it, while the real init arrives separately on the stream
       and is filed in the cache by storeCollectedSegment. Preferring the body
       in that case hands MSE half a megabyte of media as an initialization
       segment, which leaves readyState at 0 and videoWidth at 0 rather than
       erroring.

       The VOD branch is deliberately byte-for-byte what it always was, so this
       whole live path cannot regress it. */
    const collected = bytes(state.cache?.getInitSegment(initCacheKey(format.key) ?? ''))
    const data = format.initRange
      ? bytes(response.data)
      : initSegmentPrefix(collected?.byteLength ? collected : bytes(response.data) ?? new Uint8Array())
    if (data?.byteLength) {
      const cacheKey = initCacheKey(format.key)
      if (cacheKey) {
        const existing = bytes(state.cache?.getInitSegment(cacheKey))
        if (!existing || existing.byteLength < data.byteLength) state.cache?.setInitSegment(cacheKey, data)
        notifyCacheChange()
      }
      try {
        // Remember the redirected edge host so the next load dials it at boot.
        if (response.url.includes('googlevideo.com')) localStorage.setItem(GVS_ORIGIN_KEY, new URL(response.url).origin)
      } catch {}
      return data
    }
    if (response.metadata.streamInfo?.reloadPlaybackContext) throw refreshError(`youtube: ${describeNoMedia(response)}`)
    if (attempt + 1 < MAX_SEGMENT_ATTEMPTS) {
      const streamStatus = response.metadata.streamInfo?.streamProtectionStatus?.status
      if (streamStatus === 3) await source.recoverMint()
      const serverBackoff = response.metadata.streamInfo?.nextRequestPolicy?.backoffTimeMs ?? 0
      progress('retry')
      await wait(Math.min(2_000, Math.max(serverBackoff, 200 * 2 ** attempt)), closeController.signal)
      return fetchInitBlob(track, format, startTimeMs, generation, progress, dualTrack, attempt + 1)
    }
    throw refreshError(`youtube: ${describeNoMedia(response)} after ${MAX_SEGMENT_ATTEMPTS} attempts`)
  }

  const requestSegment = (
    request: SegmentRequest,
    progress: (phase: string) => void = () => {},
    signal?: AbortSignal,
  ) => {
    // A generation bump means the player seeked. Reset the adapter's buffered-range
    // tracking so the post-seek request reports a clean (empty) buffer at the new
    // position instead of a stale one anchored at t=0.
    if (request.generation > seekGeneration) {
      seekGeneration = request.generation
      resetBufferTracking()
    }
    // Init and index requests are plain byte-range reads: they run concurrently
    // across tracks, while media requests keep the strict session ordering and
    // wait for every launched init fetch.
    const base = request.kind === 'init' ? serialTail : chain
    const run = base.then(async () => {
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
          const cacheKey = initCacheKey(format.key)
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
          // Live names the segment by the server's own sequence, which is exact.
          // VOD has no sequence and matches on start time instead.
          const cached = request.sequenceNumber === undefined
            ? findCachedMedia(request.track, format.key, request.startTimeMs)
            : findCachedSequence(request.track, format.key, request.sequenceNumber)
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
        const raw = bytes(response.data)
        /* A rangeless init answer (live) is the initialization segment with a
           media segment glued to it: ftyp + moov + emsg + moof + mdat, of which
           only the first few hundred bytes are the init. MSE wants the
           initialization segment alone, and handing it the whole blob does not
           error, it just leaves readyState and videoWidth at 0. */
        const data = raw && request.kind === 'init' && !requestedRange ? initSegmentPrefix(raw) : raw
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
          if (streamStatus === 3) await source.recoverMint()
          const serverBackoff = response.metadata.streamInfo?.nextRequestPolicy?.backoffTimeMs ?? 0
          progress('retry')
          await wait(Math.min(2_000, Math.max(serverBackoff, 200 * 2 ** attempt)), signal)
          return fetchSegment(attempt + 1)
        }
        throw refreshError(`youtube: ${reason} after ${MAX_SEGMENT_ATTEMPTS} attempts`)
      }
      /* A live media request resolves the exact sequence it named, or fails.

         The server ignores the address and always answers with its current
         edge, so returning that answer under the requested segment's name puts
         media wherever the stream happens to be rather than where the timeline
         says it belongs. Measured, that is the whole stutter: Shaka asked for
         the same position fifteen times while the server walked fifteen
         sequences forward, and the playhead starved in the widening hole.

         A future sequence is worth waiting for, because the stream is producing
         it in real time. A sequence older than the cache is not: the transport
         cannot rewind, so it is reported and the refreshed manifest moves the
         viewer forward instead. */
      const awaitLiveSequence = async (sequenceNumber: number): Promise<SegmentEnvelope> => {
        const deadline = Date.now() + LIVE_SEGMENT_WAIT_MS
        // The pump owns fetching, so this only ever reads. Kicking it here is
        // what heals a pump that died with the last session refresh.
        ensureLivePump()
        for (;;) {
          // Captured BEFORE the lookup: a segment landing between the miss and
          // the await would otherwise leave this waiting for the one after it.
          const changed = cacheChange
          const cached = getCachedSegment()
          if (cached) return cached
          /* Plain errors, NEVER refreshError.

             A refresh tears the SABR session down and builds a new one, which
             starts with an empty live timeline. The manifest is generated from
             that timeline, so one unservable segment took out the whole
             presentation: liveManifest had nothing to describe, Shaka could not
             reload, and a stream that was merely a few seconds out of position
             went to a black frame permanently. These conditions mean "ask again"
             or "look at the refreshed manifest", not "the session is broken". */
          const { oldest, newest } = cachedSequenceRange(request.track, format.key)
          if (oldest !== undefined && sequenceNumber < oldest) {
            throw new Error(`youtube: live segment ${sequenceNumber} is older than the session window`)
          }
          if (newest !== undefined && sequenceNumber <= newest) {
            throw new Error(`youtube: live segment ${sequenceNumber} was not delivered`)
          }
          if (Date.now() > deadline) {
            throw new Error(`youtube: live segment ${sequenceNumber} did not arrive in time`)
          }
          progress('live-wait')
          await withAbort(changed, signal)
        }
      }
      if (request.kind === 'media' && request.sequenceNumber !== undefined) {
        return awaitLiveSequence(request.sequenceNumber)
      }
      if (request.kind === 'init' && requestedRange) {
        const cached = getCachedSegment()
        if (cached) return cached
        let blobPromise = initFetches.get(format.key)
        if (!blobPromise) {
          // Only the first concurrent init fetch asks the server to push both
          // tracks' opening segments; the others stay range-only.
          const wantDual = initFetches.size === 0
          blobPromise = fetchInitBlob(request.track, format, request.startTimeMs, request.generation, progress, wantDual)
          initFetches.set(format.key, blobPromise)
          void blobPromise.catch(() => {}).finally(() => {
            if (initFetches.get(format.key) === blobPromise) initFetches.delete(format.key)
          })
        }
        const blob = await withAbort(blobPromise, signal)
        if (requestedRange.end < blob.byteLength) {
          return {
            generation: request.generation,
            track: request.track,
            kind: request.kind,
            formatKey: format.key,
            mimeType: format.mimeType,
            elapsedMs: 0,
            end: false as const,
            data: blob.slice(requestedRange.start, requestedRange.end + 1).buffer as ArrayBuffer,
          } satisfies SegmentEnvelope
        }
        // The blob came back shorter than the requested range: fall back to a
        // direct ranged fetch rather than serving truncated bytes.
        return fetchSegment()
      }
      return fetchSegment()
    })
    if (request.kind === 'init') {
      chain = Promise.allSettled([chain, run]).then(() => {})
    } else {
      chain = run.catch(() => {})
      serialTail = chain
    }
    return run
  }

  return {
    durationMs: source.durationMs,
    manifest: source.manifest,
    videoFormats,
    audioFormats,
    targetDurationMs,
    // The segments this session can actually serve, which is the only honest
    // basis for a live manifest.
    get liveSegments() { return [...liveTimeline.values()] },
    startLivePump: ensureLivePump,
    get videoFormat() { return videoFormat },
    get audioFormat() { return audioFormat },
    requestSegment,
    selectVideoFormat: (key: string) => selectFormat('video', key),
    selectAudioFormat: (key: string) => selectFormat('audio', key),
    close: () => {
      closeController.abort(new Error('youtube: playback session closed'))
      initFetches.clear()
      void cancelActiveHarvest()
      mediaCache.clear()
      mediaCacheBytes = 0
      adapter.dispose()
    },
  }
}

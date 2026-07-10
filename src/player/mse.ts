import type { FrameApi, PlaybackFormat, PlaybackSnapshot, SegmentEnvelope } from '../frame/protocol'

import { bufferedAhead, createSourceBufferQueue } from './source-buffer'

const BUFFER_TARGET_SECONDS = 30

export type PlaybackController = {
  destroy(): void
  selectVideoFormat(formatKey: string): Promise<void>
}

type TrackState = {
  kind: 'audio' | 'video'
  format: PlaybackFormat
  sourceBuffer: SourceBuffer
  queue: ReturnType<typeof createSourceBufferQueue>
  nextTimeMs: number
  loadingGeneration?: number
  finished: boolean
  failures: number
  retryAt: number
}

const waitForSourceOpen = (mediaSource: MediaSource, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (mediaSource.readyState === 'open') return resolve()
  if (signal.aborted) return reject(signal.reason)
  const cleanup = () => {
    mediaSource.removeEventListener('sourceopen', opened)
    mediaSource.removeEventListener('sourceclose', closed)
    signal.removeEventListener('abort', aborted)
  }
  const opened = () => {
    cleanup()
    resolve()
  }
  const closed = () => {
    cleanup()
    reject(new Error('player: MediaSource closed during startup'))
  }
  const aborted = () => {
    cleanup()
    reject(signal.reason)
  }
  mediaSource.addEventListener('sourceopen', opened, { once: true })
  mediaSource.addEventListener('sourceclose', closed, { once: true })
  signal.addEventListener('abort', aborted, { once: true })
})

const sameCodec = (left: PlaybackFormat, right: PlaybackFormat) => left.mimeType === right.mimeType

const selectAutomaticFormat = (
  formats: PlaybackFormat[],
  current: PlaybackFormat,
  bandwidth: number,
  maxHeight: number,
) => formats
  .filter((format) => sameCodec(format, current) && (format.height ?? 0) <= maxHeight)
  .sort((a, b) => a.bitrate - b.bitrate)
  .filter((format) => format.bitrate * 1.3 < bandwidth)
  .at(-1) ?? current

export const startPlayback = async ({
  api,
  video,
  videoId,
  signal,
  onRestart,
}: {
  api: FrameApi
  video: HTMLVideoElement
  videoId: string
  signal: AbortSignal
  onRestart(error: unknown): void
}): Promise<PlaybackController> => {
  const maxHeight = Math.max(360, Math.ceil(video.getBoundingClientRect().height * devicePixelRatio))
  const session = await api.openPlayback(videoId, maxHeight)
  if (signal.aborted) {
    await api.closePlayback(session.id)
    throw signal.reason
  }

  const [mediaSource, objectUrl] = await (async () => {
    try {
      const source = new MediaSource()
      return [source, URL.createObjectURL(source)] as const
    } catch (error) {
      await api.closePlayback(session.id).catch(() => {})
      throw error
    }
  })()

  let generation = 0
  let bandwidth = 10_000_000
  let destroyed = false
  let requesting = false
  let restartRequested = false
  let seekTimer: ReturnType<typeof setTimeout> | undefined
  const selectedVideo = session.videoFormats.find((format) => format.key === session.selectedVideoKey)
  const selectedAudio = session.audioFormats.find((format) => format.key === session.selectedAudioKey)

  const makeTrack = (kind: 'audio' | 'video', format: PlaybackFormat): TrackState => {
    const sourceBuffer = mediaSource.addSourceBuffer(format.mimeType)
    sourceBuffer.mode = 'segments'
    return {
      kind,
      format,
      sourceBuffer,
      queue: createSourceBufferQueue(sourceBuffer, () => generation),
      nextTimeMs: 0,
      finished: false,
      failures: 0,
      retryAt: 0,
    }
  }
  let audio: TrackState
  let videoTrack: TrackState
  const tracks: TrackState[] = []

  const snapshot = (): PlaybackSnapshot => ({
    currentTimeMs: video.currentTime * 1_000,
    playbackRate: video.playbackRate,
    bandwidthEstimate: bandwidth,
    viewportWidth: Math.max(1, video.clientWidth),
    viewportHeight: Math.max(1, video.clientHeight),
  })

  const request = async (track: TrackState, kind: 'init' | 'media', formatKey = track.format.key) => {
    const current = generation
    const segment = await api.requestSegment({
      requestId: crypto.randomUUID(),
      sessionId: session.id,
      generation: current,
      track: track.kind,
      kind,
      startTimeMs: track.nextTimeMs,
      snapshot: snapshot(),
    })
    if (destroyed || current !== generation || segment.generation !== generation) return false
    if (segment.formatKey !== formatKey) throw new Error(`player: expected format ${formatKey}, received ${segment.formatKey}`)
    if (segment.end) {
      if (kind === 'init') throw new Error(`player: ${track.kind} ended before initialization`)
      track.finished = true
      return true
    }
    await track.queue.append(segment.data, current)
    if (destroyed || current !== generation) return false
    if (kind === 'media') {
      track.nextTimeMs = segment.startMs !== undefined && segment.durationMs !== undefined
        ? segment.startMs + segment.durationMs
        : track.nextTimeMs + (segment.durationMs ?? 2_000)
      track.finished = track.nextTimeMs >= session.durationMs - 250
      if (segment.elapsedMs > 0) {
        const measured = segment.data.byteLength * 8_000 / segment.elapsedMs
        bandwidth = bandwidth * 0.75 + measured * 0.25
      }
    }
    return true
  }

  try {
    video.src = objectUrl
    await waitForSourceOpen(mediaSource, signal)
    mediaSource.duration = session.durationMs / 1_000
    if (!selectedVideo || !selectedAudio) throw new Error('player: selected formats are missing')
    audio = makeTrack('audio', selectedAudio)
    tracks.push(audio)
    videoTrack = makeTrack('video', selectedVideo)
    tracks.push(videoTrack)
    for (const track of tracks) await request(track, 'init')
  } catch (error) {
    for (const track of tracks) track.queue.dispose()
    await api.closePlayback(session.id).catch(() => {})
    if (video.src === objectUrl) {
      video.removeAttribute('src')
      video.load()
    }
    URL.revokeObjectURL(objectUrl)
    throw error
  }

  const changeVideoFormat = async (format: PlaybackFormat) => {
    if (format.key === videoTrack.format.key) return
    if (!sameCodec(format, videoTrack.format)) throw new Error('player: cross-codec switching requires a restart')
    const previous = videoTrack.format
    await api.selectVideoFormat(session.id, format.key)
    try {
      const initialized = await request(videoTrack, 'init', format.key)
      if (!initialized) {
        if (!destroyed && !signal.aborted) await api.selectVideoFormat(session.id, previous.key).catch(() => {})
        return
      }
      videoTrack.format = format
    } catch (error) {
      await api.selectVideoFormat(session.id, previous.key).catch(() => {})
      throw error
    }
  }

  const pump = async (track: TrackState) => {
    if (
      track.loadingGeneration !== undefined
      || track.finished
      || destroyed
      || restartRequested
      || requesting
      || signal.aborted
      || mediaSource.readyState === 'closed'
      || performance.now() < track.retryAt
    ) return
    if (bufferedAhead(track.sourceBuffer, video.currentTime) >= BUFFER_TARGET_SECONDS) return
    const current = generation
    track.loadingGeneration = current
    requesting = true
    try {
      if (track.kind === 'video') {
        const automatic = selectAutomaticFormat(
          session.videoFormats,
          videoTrack.format,
          bandwidth,
          Math.max(360, Math.ceil(video.clientHeight * devicePixelRatio)),
        )
        await changeVideoFormat(automatic)
      }
      await request(track, 'media')
      track.failures = 0
      track.retryAt = 0
      delete document.documentElement.dataset.playbackRecovery
    } catch (error) {
      if (!destroyed && !signal.aborted && current === generation) {
        track.failures += 1
        track.retryAt = performance.now() + Math.min(5_000, 250 * 2 ** Math.min(track.failures - 1, 5))
        document.documentElement.dataset.playbackRecovery = error instanceof Error ? error.message : String(error)
        const retryable = error instanceof Error && error.message.startsWith('youtube:')
        if (!retryable || track.failures >= 3) {
          restartRequested = true
          onRestart(error)
        }
      }
    } finally {
      requesting = false
      if (track.loadingGeneration === current) track.loadingGeneration = undefined
      if (
        mediaSource.readyState === 'open'
        && tracks.every((candidate) => candidate.finished && candidate.loadingGeneration === undefined && !candidate.sourceBuffer.updating)
      ) {
        try {
          mediaSource.endOfStream()
        } catch (error) {
          restartRequested = true
          onRestart(error)
        }
      }
    }
  }

  const interval = setInterval(() => {
    const first = bufferedAhead(audio.sourceBuffer, video.currentTime) <= bufferedAhead(videoTrack.sourceBuffer, video.currentTime)
      ? audio
      : videoTrack
    void pump(first).then(() => pump(first === audio ? videoTrack : audio), () => {})
  }, 120)

  const seek = () => {
    clearTimeout(seekTimer)
    seekTimer = setTimeout(() => {
      generation += 1
      const current = generation
      const target = video.currentTime * 1_000
      for (const track of tracks) {
        track.queue.abort()
        track.nextTimeMs = target
        track.finished = false
        track.failures = 0
        track.retryAt = 0
        void track.queue.clear(current).then(() => pump(track), () => {})
      }
    }, 50)
  }
  video.addEventListener('seeking', seek)

  const reportWaiting = () => {
    document.documentElement.dataset.playbackStall = JSON.stringify({
      currentTime: video.currentTime,
      readyState: video.readyState,
      networkState: video.networkState,
      generation,
      tracks: tracks.map((track) => ({
        kind: track.kind,
        bufferedAhead: bufferedAhead(track.sourceBuffer, video.currentTime),
        nextTimeMs: track.nextTimeMs,
        loadingGeneration: track.loadingGeneration,
        updating: track.sourceBuffer.updating,
        failures: track.failures,
        finished: track.finished,
      })),
    })
  }
  const clearWaiting = () => delete document.documentElement.dataset.playbackStall
  video.addEventListener('waiting', reportWaiting)
  video.addEventListener('playing', clearWaiting)

  const destroy = () => {
    if (destroyed) return
    destroyed = true
    generation += 1
    clearInterval(interval)
    clearTimeout(seekTimer)
    video.removeEventListener('seeking', seek)
    video.removeEventListener('waiting', reportWaiting)
    video.removeEventListener('playing', clearWaiting)
    for (const track of tracks) track.queue.dispose()
    void api.closePlayback(session.id).catch(() => {})
    if (video.src === objectUrl) {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
    URL.revokeObjectURL(objectUrl)
  }
  signal.addEventListener('abort', destroy, { once: true })

  void Promise.all(tracks.map(pump)).then(() => video.play().catch(() => {}))

  return {
    destroy,
    selectVideoFormat: async (key) => {
      const format = session.videoFormats.find((candidate) => candidate.key === key)
      if (!format) throw new Error(`player: unknown video format ${key}`)
      await changeVideoFormat(format)
    },
  }
}

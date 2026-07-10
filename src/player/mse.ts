import type { FrameApi, PlaybackFormat, PlaybackSnapshot, SegmentEnvelope } from '../frame/protocol'

import { bufferedAhead, createSourceBufferQueue } from './source-buffer'

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
  loading: boolean
  finished: boolean
}

const waitForSourceOpen = (mediaSource: MediaSource) => new Promise<void>((resolve, reject) => {
  if (mediaSource.readyState === 'open') return resolve()
  mediaSource.addEventListener('sourceopen', () => resolve(), { once: true })
  mediaSource.addEventListener('sourceclose', () => reject(new Error('player: MediaSource closed during startup')), { once: true })
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
}: {
  api: FrameApi
  video: HTMLVideoElement
  videoId: string
  signal: AbortSignal
}): Promise<PlaybackController> => {
  const maxHeight = Math.max(360, Math.ceil(video.getBoundingClientRect().height * devicePixelRatio))
  const session = await api.openPlayback(videoId, maxHeight)
  if (signal.aborted) {
    await api.closePlayback(session.id)
    throw signal.reason
  }

  const mediaSource = new MediaSource()
  const objectUrl = URL.createObjectURL(mediaSource)
  video.src = objectUrl
  await waitForSourceOpen(mediaSource)
  mediaSource.duration = session.durationMs / 1_000

  let generation = 0
  let bandwidth = 10_000_000
  let destroyed = false
  let seekTimer: ReturnType<typeof setTimeout> | undefined
  const selectedVideo = session.videoFormats.find((format) => format.key === session.selectedVideoKey)
  const selectedAudio = session.audioFormats.find((format) => format.key === session.selectedAudioKey)
  if (!selectedVideo || !selectedAudio) throw new Error('player: selected formats are missing')

  const makeTrack = (kind: 'audio' | 'video', format: PlaybackFormat): TrackState => {
    const sourceBuffer = mediaSource.addSourceBuffer(format.mimeType)
    sourceBuffer.mode = 'segments'
    return {
      kind,
      format,
      sourceBuffer,
      queue: createSourceBufferQueue(sourceBuffer, () => generation),
      nextTimeMs: 0,
      loading: false,
      finished: false,
    }
  }
  const audio = makeTrack('audio', selectedAudio)
  const videoTrack = makeTrack('video', selectedVideo)
  const tracks = [audio, videoTrack]

  const snapshot = (): PlaybackSnapshot => ({
    currentTimeMs: video.currentTime * 1_000,
    playbackRate: video.playbackRate,
    bandwidthEstimate: bandwidth,
    viewportWidth: Math.max(1, video.clientWidth),
    viewportHeight: Math.max(1, video.clientHeight),
  })

  const request = async (track: TrackState, kind: 'init' | 'media') => {
    const current = generation
    const segment = await api.requestSegment({
      sessionId: session.id,
      generation: current,
      track: track.kind,
      kind,
      startTimeMs: track.nextTimeMs,
      snapshot: snapshot(),
    })
    if (destroyed || current !== generation || segment.generation !== generation) return
    await track.queue.append(segment.data, current)
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
  }

  await Promise.all(tracks.map((track) => request(track, 'init')))

  const changeVideoFormat = async (format: PlaybackFormat) => {
    if (format.key === videoTrack.format.key) return
    if (!sameCodec(format, videoTrack.format)) throw new Error('player: cross-codec switching requires a restart')
    await api.selectVideoFormat(session.id, format.key)
    videoTrack.format = format
    await request(videoTrack, 'init')
  }

  const pump = async (track: TrackState) => {
    if (track.loading || track.finished || destroyed || signal.aborted || mediaSource.readyState === 'closed') return
    if (bufferedAhead(track.sourceBuffer, video.currentTime) >= 12) return
    track.loading = true
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
    } finally {
      track.loading = false
      if (
        mediaSource.readyState === 'open'
        && tracks.every((candidate) => candidate.finished && !candidate.loading && !candidate.sourceBuffer.updating)
      ) mediaSource.endOfStream()
    }
  }

  const interval = setInterval(() => {
    const first = bufferedAhead(audio.sourceBuffer, video.currentTime) <= bufferedAhead(videoTrack.sourceBuffer, video.currentTime)
      ? audio
      : videoTrack
    void pump(first).then(() => pump(first === audio ? videoTrack : audio))
  }, 120)

  const seek = () => {
    clearTimeout(seekTimer)
    seekTimer = setTimeout(() => {
      generation += 1
      const current = generation
      const target = video.currentTime * 1_000
      for (const track of tracks) {
        track.nextTimeMs = target
        track.loading = false
        track.finished = false
        void track.queue.clear(current).then(() => pump(track))
      }
    }, 50)
  }
  video.addEventListener('seeking', seek)

  const destroy = () => {
    if (destroyed) return
    destroyed = true
    generation += 1
    clearInterval(interval)
    clearTimeout(seekTimer)
    video.removeEventListener('seeking', seek)
    for (const track of tracks) track.queue.dispose()
    void api.closePlayback(session.id)
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

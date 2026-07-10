import type { SourceApi } from '../sources/types'

export type PlaybackFormat = {
  key: string
  itag: number
  mimeType: string
  bitrate: number
  width?: number
  height?: number
  qualityLabel?: string
  audioTrackId?: string
  language?: string
  initRange: { start: number, end: number }
}

export type PlaybackSnapshot = {
  currentTimeMs: number
  playbackRate: number
  bandwidthEstimate: number
  viewportWidth: number
  viewportHeight: number
}

export type PlaybackSession = {
  id: string
  durationMs: number
  videoFormats: PlaybackFormat[]
  audioFormats: PlaybackFormat[]
  selectedVideoKey: string
  selectedAudioKey: string
}

export type SegmentRequest = {
  sessionId: string
  generation: number
  track: 'audio' | 'video'
  kind: 'init' | 'media'
  startTimeMs: number
  snapshot: PlaybackSnapshot
}

export type SegmentEnvelope = {
  generation: number
  track: 'audio' | 'video'
  kind: 'init' | 'media'
  formatKey: string
  mimeType: string
  sequenceNumber?: number
  startMs?: number
  durationMs?: number
  data: ArrayBuffer
  elapsedMs: number
}

export type FrameApi = SourceApi & {
  openPlayback(videoId: string, maxHeight?: number): Promise<PlaybackSession>
  requestSegment(request: SegmentRequest): Promise<SegmentEnvelope>
  selectVideoFormat(sessionId: string, formatKey: string): Promise<void>
  closePlayback(sessionId: string): Promise<void>
}

export const FRAME_CONNECT = 'yt-client-frame-connect'

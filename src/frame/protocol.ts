import type { Exhaustive, SourceApi } from '../sources/types'
import type { TransportResponse } from '../scramjet/protocol'

import type { CaptionTrack } from './captions'
import type { Storyboard } from './storyboard'

import { SOURCE_METHODS } from '../sources/types'

export type { CaptionTrack } from './captions'
export type { Storyboard, StoryboardFrame } from './storyboard'

// the terminal marker the players match on, declared here because the app realm has to recognize it too
export const LIVE_UNSUPPORTED = 'youtube: live streams are not playable in this client yet'

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
  // optional rather than zero-filled: a `{0,0}` range is a REAL range meaning "one byte"
  initRange?: { start: number, end: number }
  indexRange?: { start: number, end: number }
  // live only: one segment's worth, and sequence maps onto time through it
  targetDurationMs?: number
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
  manifest: string
  videoFormats: PlaybackFormat[]
  audioFormats: PlaybackFormat[]
  selectedVideoKey: string
  selectedAudioKey: string
  storyboards: Storyboard[]
  // always empty for live: Shaka refuses a side-loaded text track when the presentation duration is infinite (CANNOT_ADD_EXTERNAL_TEXT_TO_LIVE_STREAM)
  captionTracks: CaptionTrack[]
  isLive: boolean
}

export type SegmentRequest = {
  requestId: string
  sessionId: string
  generation: number
  track: 'audio' | 'video'
  kind: 'init' | 'media'
  formatKey?: string
  range?: { start: number, end: number }
  startTimeMs: number
  // live only: the SABR sequence the manifest named, and the only address the session can resolve exactly; absent for VOD, which addresses by byte range
  sequenceNumber?: number
  snapshot: PlaybackSnapshot
}

type SegmentMetadata = {
  generation: number
  track: 'audio' | 'video'
  kind: 'init' | 'media'
  formatKey: string
  mimeType: string
  sequenceNumber?: number
  startMs?: number
  durationMs?: number
  elapsedMs: number
}

export type SegmentEnvelope = SegmentMetadata & ({
  end: true
  data?: never
} | {
  end?: false
  data: ArrayBuffer
})

export type FrameApi = SourceApi & {
  prefetchPlayback(videoId: string): Promise<void>
  openPlayback(videoId: string, maxHeight?: number): Promise<PlaybackSession>
  requestSegment(request: SegmentRequest): Promise<SegmentEnvelope>
  liveManifest(sessionId: string): Promise<string>
  captionCues(sessionId: string, trackId: string): Promise<string>
  cancelSegment(sessionId: string, requestId: string): Promise<void>
  selectVideoFormat(sessionId: string, formatKey: string): Promise<void>
  closePlayback(sessionId: string): Promise<void>
  resetIdentity(): Promise<void>
  // records the choice for the NEXT engine only: youtubei.js has no runtime switch, so the caller reloads to apply it
  switchAccount(index: number): Promise<void>
}

export const FRAME_METHODS = [
  ...SOURCE_METHODS,
  'prefetchPlayback',
  'openPlayback',
  'requestSegment',
  'liveManifest',
  'captionCues',
  'cancelSegment',
  'selectVideoFormat',
  'closePlayback',
  'resetIdentity',
  'switchAccount',
] as const satisfies readonly (keyof FrameApi)[]

export type FrameMethod = (typeof FRAME_METHODS)[number]

export type FrameMethodsAreExhaustive = Exhaustive<Exclude<keyof FrameApi, FrameMethod>>

const frameMethods: ReadonlySet<string> = new Set(FRAME_METHODS)

export const isFrameMethod = (value: unknown): value is FrameMethod =>
  typeof value === 'string' && frameMethods.has(value)

export type FrameRequest = {
  [Method in keyof FrameApi]: {
    id: number
    method: Method
    args: Parameters<FrameApi[Method]>
  }
}[keyof FrameApi]

export type FrameResponse = {
  id: number
  result: unknown
  error?: never
} | {
  id: number
  result?: never
  error: string
}

export type FrameProgress = {
  id: number
  progress: string
}

export type FrameEgressRequest = {
  type: 'fetch'
  id: number
  url: string
  options: {
    method?: string
    headers?: Record<string, string>
    body?: ArrayBuffer | null
    redirect?: 'follow' | 'manual'
  }
} | {
  type: 'cancel'
  id: number
}

export type FrameEgressResponse = {
  id: number
  response: TransportResponse
  error?: never
} | {
  id: number
  response?: never
  error: string
}

export const FRAME_CONNECT = 'yt-client-frame-connect'
export const FRAME_EGRESS_CONNECT = 'yt-client-frame-egress-connect'

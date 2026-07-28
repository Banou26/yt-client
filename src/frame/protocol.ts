import type { Exhaustive, SourceApi } from '../sources/types'
import type { TransportResponse } from '../scramjet/protocol'

import type { Storyboard } from './storyboard'

import { SOURCE_METHODS } from '../sources/types'

export type { Storyboard, StoryboardFrame } from './storyboard'

/* Live playback is not wired up: the WEB watch page carries no DASH or HLS
   manifest for a live stream and its direct format URLs are refused, so the
   only route left is a hand-written dynamic MPD over SABR. The watch page
   renders its own card instead of mounting a player, and this constant is the
   backstop for a video that goes live between the page load and the open.

   Declared here rather than in the frame's innertube module because the app
   realm has to recognize it too, and importing that module would pull
   youtubei.js into the app bundle for one string. It is terminal: the retry
   ladder must not spend three attempts on something that cannot succeed. */
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
  /* Absent for live, which publishes no byte ranges at all. It describes a
     DASH SegmentBase, which only the VOD manifest uses.

     Optional rather than zero-filled: a `{0,0}` range is a REAL range meaning
     "one byte", and the segment path slices the cached init blob down to it.
     That is how live playback failed with a 1-byte init and shaka 3014. */
  initRange?: { start: number, end: number }
  indexRange?: { start: number, end: number }
  // Live only: one segment's worth. Sequence maps onto time through it.
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
  // Scrubber hover previews. The sheets live on i.ytimg.com, which the app
  // realm already loads thumbnails from, so only the spec crosses the boundary.
  storyboards: Storyboard[]
  /* A live stream's manifest is dynamic and its media is only ever served from
     the edge, so the player has to be told to start there. Left alone it opens
     at presentation time 0, which for a stream running six hours is 24,000
     seconds behind the only media the server will send. */
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
  cancelSegment(sessionId: string, requestId: string): Promise<void>
  selectVideoFormat(sessionId: string, formatKey: string): Promise<void>
  closePlayback(sessionId: string): Promise<void>
  resetIdentity(): Promise<void>
}

// Both ends of the port forward by method name, so the list has to exist at
// runtime. A method added to `FrameApi` but not listed here fails
// `FrameMethodsAreExhaustive`.
export const FRAME_METHODS = [
  ...SOURCE_METHODS,
  'prefetchPlayback',
  'openPlayback',
  'requestSegment',
  'cancelSegment',
  'selectVideoFormat',
  'closePlayback',
  'resetIdentity',
] as const satisfies readonly (keyof FrameApi)[]

export type FrameMethod = (typeof FRAME_METHODS)[number]

export type FrameMethodsAreExhaustive = Exhaustive<Exclude<keyof FrameApi, FrameMethod>>

const frameMethods: ReadonlySet<string> = new Set(FRAME_METHODS)

// The port carries whatever the peer realm posts: only dispatch names that are
// actually part of the API surface.
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

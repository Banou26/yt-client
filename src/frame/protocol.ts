import type { Exhaustive, SourceApi } from '../sources/types'
import type { TransportResponse } from '../scramjet/protocol'

import type { CaptionTrack } from './captions'
import type { Storyboard } from './storyboard'

import { SOURCE_METHODS } from '../sources/types'

export type { CaptionTrack } from './captions'
export type { Storyboard, StoryboardFrame } from './storyboard'

/* Live plays over SABR now, so nothing in the frame raises this any more. It
   survives as the terminal marker the players still match on: a video that
   cannot be played must not spend the whole retry ladder proving it.

   Declared here rather than in the frame's innertube module because the app
   realm has to recognize it too, and importing that module would pull
   youtubei.js into the app bundle for one string. */
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
  /* What the video publishes, without the cue files themselves: those are
     fetched through `captionCues` only once a viewer picks a track.

     Always empty for live. Shaka refuses a side-loaded text track when the
     presentation duration is infinite (CANNOT_ADD_EXTERNAL_TEXT_TO_LIVE_STREAM),
     so an offered track there could only fail, and the control bar reads the
     empty list as "no captions for this video". */
  captionTracks: CaptionTrack[]
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
  /* Live only: the SABR sequence the manifest named. It is the server's own
     address for a segment and the only one the session can resolve exactly,
     because the transport answers a request for a TIME with whatever its edge
     currently holds. Absent for VOD, which addresses by byte range. */
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
  /* Regenerates a live manifest from the segments the session now holds. Shaka
     refetches it on the `minimumUpdatePeriod` cadence, which is how the
     advertised edge keeps tracking the real one instead of drifting away from
     it on a wall clock. */
  liveManifest(sessionId: string): Promise<string>
  /* Fetches one track's cues as WebVTT, addressed by the id the session
     published rather than by URL: the timedtext address stays inside the frame,
     which is the realm that holds the session it was signed against. */
  captionCues(sessionId: string, trackId: string): Promise<string>
  cancelSegment(sessionId: string, requestId: string): Promise<void>
  selectVideoFormat(sessionId: string, formatKey: string): Promise<void>
  closePlayback(sessionId: string): Promise<void>
  resetIdentity(): Promise<void>
  /* Selects which account on the login to act as, for the NEXT engine.

     Not a mutation: youtubei.js has no runtime switch, and the Innertube
     clients bake the account into every request at module load. So this only
     records the choice, and the caller reloads to apply it, exactly the way
     signing out does. */
  switchAccount(index: number): Promise<void>
}

// Both ends of the port forward by method name, so the list has to exist at
// runtime. A method added to `FrameApi` but not listed here fails
// `FrameMethodsAreExhaustive`.
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

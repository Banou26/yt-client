import { forwardRef } from 'react'
import type { Ref } from 'react'
import { createPlayer } from '@videojs/react'
import { videoFeatures } from '@videojs/react/video'

import { DashSabrVideo } from './dash-sabr-video'

const VideoPlayer = createPlayer({ features: videoFeatures })

// yt-client playback hosted in @videojs/react v10: the Provider + DashSabrVideo own
// the media engine (dash.js MSE timeline + the SABR-via-frame bridge). Native
// <video controls> for now — custom control UI is a later increment. The ref
// exposes the underlying <video> so the caller can capture currentTime before a
// retry-remount and resume from it.
export const VideoJsPlayer = forwardRef(function VideoJsPlayer(
  {
    videoId,
    startTime,
    onError,
  }: {
    videoId: string
    startTime?: number
    onError?: (error: unknown) => void
  },
  ref: Ref<HTMLVideoElement>,
) {
  return (
    <VideoPlayer.Provider>
      <DashSabrVideo ref={ref} src={videoId} startTime={startTime} onError={onError} />
    </VideoPlayer.Provider>
  )
})

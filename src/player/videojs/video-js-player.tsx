import { createPlayer } from '@videojs/react'
import { videoFeatures } from '@videojs/react/video'

import { DashSabrVideo } from './dash-sabr-video'

const VideoPlayer = createPlayer({ features: videoFeatures })

// yt-client playback hosted in @videojs/react v10: the Provider + DashSabrVideo own
// the media engine (dash.js MSE timeline + the SABR-via-frame bridge). Native
// <video controls> for now — custom control UI is a later increment.
export const VideoJsPlayer = ({
  videoId,
  startTime,
  onError,
}: {
  videoId: string
  startTime?: number
  onError?: (error: unknown) => void
}) => (
  <VideoPlayer.Provider>
    <DashSabrVideo src={videoId} startTime={startTime} onError={onError} />
  </VideoPlayer.Provider>
)

import type { Media } from '@videojs/core/dom'
import type { FunctionComponent } from 'preact'

import { css } from '@emotion/react'
import { videoFeatures } from '@videojs/core/dom'
import { createPlayer, useMediaAttach } from '@videojs/react'
import { VideoSkin as VideoSkinBase } from '@videojs/react/video'
import { useEffect, useState } from 'preact/hooks'

import '@videojs/react/video/skin.css'

import { startEngine } from '../scramjet/client'
import { startPlayback } from './mse'

const VideoSkin = VideoSkinBase as FunctionComponent<Parameters<typeof VideoSkinBase>[0]>
const player = createPlayer({ features: videoFeatures, displayName: 'YouTubePlayer' })

const playerStyle = css`
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: 14px;
  background: #000;

  .media-default-skin,
  video {
    width: 100%;
    height: 100%;
  }

  video {
    display: block;
    object-fit: contain;
  }
`

const MediaSession = ({ video, videoId }: { video: HTMLVideoElement | null, videoId: string }) => {
  const attach = useMediaAttach()
  useEffect(() => {
    if (!video || !attach) return
    const abort = new AbortController()
    let controller: Awaited<ReturnType<typeof startPlayback>> | undefined
    attach(video as unknown as Media)
    void (async () => {
      const api = await startEngine()
      const next = await startPlayback({ api, video, videoId, signal: abort.signal })
      if (abort.signal.aborted) next.destroy()
      else controller = next
    })().catch((error) => {
      if (!abort.signal.aborted) console.error(error)
    })
    return () => {
      abort.abort()
      controller?.destroy()
      attach(null)
    }
  }, [attach, video, videoId])
  return null
}

const VideoPlayer = ({ videoId }: { videoId: string }) => {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  return (
    <div css={playerStyle}>
      <player.Provider>
        <MediaSession video={video} videoId={videoId} />
        <VideoSkin>
          <video ref={setVideo} playsInline preload="auto" />
        </VideoSkin>
      </player.Provider>
    </div>
  )
}

export default VideoPlayer

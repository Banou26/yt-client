import { css } from '@emotion/react'
import { useRef, useState } from 'preact/hooks'

import { resetEngine } from '../scramjet/client'
import { VideoJsPlayer } from './videojs/video-js-player'

const playerStyle = css`
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: 14px;
  background: #000;
  position: relative;

  video {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .playback-status {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
    color: #fff;
    font: 600 14px/1.4 system-ui, sans-serif;
    text-shadow: 0 1px 4px #000;
  }
`

const VideoPlayer = ({ videoId }: { videoId: string }) => {
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState('')
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const videoRef = useRef<HTMLVideoElement>(null)
  const resumeAt = useRef(0)

  // The @videojs/react player + dash.js media engine own playback; on a failure we
  // remount (key=attempt) and, for engine-level failures, rebuild the scramjet
  // engine first. Bounded to 3 attempts, mirroring the previous Shaka wrapper.
  const restart = (error: unknown) => {
    if (retryTimer.current !== undefined) return
    // Capture the playhead before the remount so the retry resumes in place.
    resumeAt.current = videoRef.current?.currentTime || resumeAt.current
    if (attempt >= 3) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus(`Playback failed: ${message}`)
      console.error(error)
      return
    }
    const engineFailure = error instanceof Error && error.message.startsWith('youtube:')
    retryTimer.current = setTimeout(() => {
      retryTimer.current = undefined
      if (engineFailure) resetEngine()
      setAttempt((value) => value + 1)
    }, attempt === 0 && !engineFailure ? 100 : 1_000)
  }

  return (
    <div css={playerStyle}>
      <VideoJsPlayer key={attempt} ref={videoRef} videoId={videoId} startTime={resumeAt.current} onError={restart} />
      {status && <div class="playback-status">{status}</div>}
    </div>
  )
}

export default VideoPlayer

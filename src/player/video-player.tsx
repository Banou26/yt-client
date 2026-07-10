import { css } from '@emotion/react'
import { useEffect, useRef, useState } from 'preact/hooks'

import { resetEngine, startEngine } from '../scramjet/client'
import { setSource } from '../sources/runtime'
import { startShakaPlayback } from './shaka'

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
  const videoRef = useRef<HTMLVideoElement>(null)
  const resumeAt = useRef(0)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState('Loading Shaka player')

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const abort = new AbortController()
    let controller: Awaited<ReturnType<typeof startShakaPlayback>> | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const restart = (error: unknown) => {
      if (abort.signal.aborted || retryTimer !== undefined) return
      resumeAt.current = video.currentTime
      if (attempt >= 3) {
        void controller?.destroy()
        const message = error instanceof Error ? error.message : String(error)
        setStatus(`Playback failed: ${message}`)
        console.error(error)
        return
      }
      retryTimer = setTimeout(() => {
        if (!abort.signal.aborted) {
          if (error instanceof Error && error.message.startsWith('youtube:')) resetEngine()
          setAttempt((value) => value + 1)
        }
      }, 1_000)
    }
    setStatus('Loading Shaka player')
    void (async () => {
      const api = await startEngine()
      setSource(api)
      controller = await startShakaPlayback({
        api,
        video,
        videoId,
        startTime: resumeAt.current,
        signal: abort.signal,
        onError: restart,
      })
      if (!abort.signal.aborted) setStatus('')
    })().catch((error) => {
      if (!abort.signal.aborted) restart(error)
    })
    return () => {
      abort.abort()
      clearTimeout(retryTimer)
      void controller?.destroy()
    }
  }, [attempt, videoId])

  return (
    <div css={playerStyle}>
      <video key={attempt} ref={videoRef} controls playsInline preload="auto" />
      {status && <div class="playback-status">{status}</div>}
    </div>
  )
}

export default VideoPlayer

import type shaka from 'shaka-player'

import { css } from '@emotion/react'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

import { resetEngine, startEngine } from '../scramjet/client'
import { getSettings, updateSettings } from '../settings'
import { isTypingTarget, PlayerControls } from './controls'
import { startShakaPlayback } from './shaka'
import { usePlayerState } from './use-player-state'

const playerStyle = css`
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: 14px;
  background: #000;
  position: relative;

  &:fullscreen {
    border-radius: 0;
    aspect-ratio: auto;
    height: 100%;
  }

  video {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  &.idle {
    cursor: none;
  }

  .playback-status {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
    color: var(--text-on-media);
    font: 600 14px/1.4 system-ui, sans-serif;
    text-shadow: 0 1px 4px #000;
  }

  .spinner {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 4.8rem;
    height: 4.8rem;
    margin: -2.4rem 0 0 -2.4rem;
    border: 0.4rem solid rgba(255, 255, 255, 0.25);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: player-spin 0.8s linear infinite;
    pointer-events: none;
  }

  @keyframes player-spin {
    to {
      transform: rotate(360deg);
    }
  }
`

const IDLE_MS = 2_500
const SEEK_STEP = 5
const JUMP_STEP = 10

const requestPlayerFullscreen = (video: HTMLVideoElement | null) => {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => {})
    return
  }
  void video?.closest('[data-player-root]')?.requestFullscreen().catch(() => {})
}

const VideoPlayer = (
  { videoId, theater = false, onTheater }: { videoId: string, theater?: boolean, onTheater?: () => void },
) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const resumeAt = useRef(0)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState('Loading player')
  const [player, setPlayer] = useState<shaka.Player | undefined>(undefined)
  const [heights, setHeights] = useState<number[]>([])
  const [quality, setQuality] = useState<'auto' | number>(() => getSettings().quality)
  const selectQualityRef = useRef<((height: number | 'auto') => Promise<void>) | undefined>(undefined)
  const [active, setActive] = useState(true)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const state = usePlayerState(videoRef.current, player)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const abort = new AbortController()
    let controller: Awaited<ReturnType<typeof startShakaPlayback>> | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    // On failure, capture the playhead and remount (key=attempt) so the retry
    // resumes in place; engine-level failures (youtube:) rebuild the scramjet
    // engine first. Bounded to 3 attempts.
    const restart = (error: unknown) => {
      if (abort.signal.aborted || retryTimer !== undefined) return
      resumeAt.current = video.currentTime || resumeAt.current
      if (attempt >= 3) {
        void controller?.destroy()
        const message = error instanceof Error ? error.message : String(error)
        setStatus(`Playback failed: ${message}`)
        console.error(error)
        return
      }
      const engineFailure = error instanceof Error && error.message.startsWith('youtube:')
      retryTimer = setTimeout(() => {
        if (!abort.signal.aborted) {
          if (engineFailure) resetEngine()
          setAttempt((value) => value + 1)
        }
        // A fast first retry only when the engine is kept: engine rebuilds are
        // heavy and deserve the old backoff.
      }, attempt === 0 && !engineFailure ? 100 : 1_000)
    }
    setStatus('Loading player')
    void (async () => {
      const api = await startEngine()
      controller = await startShakaPlayback({
        api,
        video,
        videoId,
        startTime: resumeAt.current,
        signal: abort.signal,
        onError: restart,
      })
      if (abort.signal.aborted) return
      setStatus('')
      setPlayer(controller.player)
      setHeights(controller.heights)
      selectQualityRef.current = controller.selectQuality
      // A stored preference has to be reapplied per video, once this session's
      // formats exist, or every new video silently reverts to auto.
      const stored = getSettings().quality
      if (stored !== 'auto') void controller.selectQuality(stored).catch(() => {})
    })().catch((error) => {
      if (!abort.signal.aborted) restart(error)
    })
    return () => {
      abort.abort()
      clearTimeout(retryTimer)
      setPlayer(undefined)
      setHeights([])
      void controller?.destroy()
    }
  }, [attempt, videoId])

  // Volume and rate are remembered across videos and sessions. The element is
  // fresh on every attempt, so they are reapplied rather than read back.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !player) return
    const settings = getSettings()
    video.volume = settings.volume
    video.muted = settings.muted
    video.playbackRate = settings.playbackRate
  }, [player])

  const applyQuality = useCallback((value: 'auto' | number) => {
    setQuality(value)
    updateSettings({ quality: value })
    void selectQualityRef.current?.(value).catch(() => {})
  }, [])

  const wake = useCallback(() => {
    setActive(true)
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setActive(false), IDLE_MS)
  }, [])

  useEffect(() => () => clearTimeout(idleTimer.current), [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const seekBy = (delta: number) => {
      video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta))
    }
    const onKeyDown = (event: KeyboardEvent) => {
      // The header binds '/' to focus search, so a player shortcut must never
      // fire while the user is typing.
      if (event.defaultPrevented || isTypingTarget(event.target)) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const key = event.key
      const handled = () => {
        event.preventDefault()
        wake()
      }
      switch (key) {
        case ' ':
        case 'k':
          handled()
          if (video.paused) void video.play().catch(() => {})
          else video.pause()
          return
        case 'ArrowLeft': handled(); seekBy(-SEEK_STEP); return
        case 'ArrowRight': handled(); seekBy(SEEK_STEP); return
        case 'j': handled(); seekBy(-JUMP_STEP); return
        case 'l': handled(); seekBy(JUMP_STEP); return
        case 'ArrowUp':
          handled()
          video.volume = Math.min(1, video.volume + 0.05)
          updateSettings({ volume: video.volume })
          return
        case 'ArrowDown':
          handled()
          video.volume = Math.max(0, video.volume - 0.05)
          updateSettings({ volume: video.volume })
          return
        case 'm':
          handled()
          video.muted = !video.muted
          updateSettings({ muted: video.muted })
          return
        case 'f':
          handled()
          requestPlayerFullscreen(video)
          return
        case 't':
          handled()
          onTheater?.()
          return
        case 'Home': handled(); video.currentTime = 0; return
        case 'End': handled(); video.currentTime = video.duration || 0; return
        default:
          // 0-9 jump to that tenth of the video, matching youtube.com.
          if (/^[0-9]$/.test(key) && Number.isFinite(video.duration)) {
            handled()
            video.currentTime = (video.duration * Number(key)) / 10
          }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [wake, onTheater])

  const video = videoRef.current
  const showSpinner = Boolean(player) && (state.buffering || state.seeking)

  return (
    <div
      css={playerStyle}
      data-player-root
      className={!active && !state.paused ? 'idle' : undefined}
      onPointerMove={wake}
      onPointerLeave={() => setActive(false)}
    >
      <video
        key={attempt}
        ref={videoRef}
        playsInline
        preload='auto'
        onClick={() => {
          const current = videoRef.current
          if (!current) return
          if (current.paused) void current.play().catch(() => {})
          else current.pause()
        }}
        onDblClick={() => requestPlayerFullscreen(videoRef.current)}
      />
      {showSpinner ? <div className='spinner' /> : undefined}
      {status ? <div className='playback-status'>{status}</div> : undefined}
      {video && !status
        ? (
          <PlayerControls
            video={video}
            player={player}
            state={state}
            heights={heights}
            quality={quality}
            onQuality={applyQuality}
            theater={theater}
            onTheater={() => onTheater?.()}
            visible={active || state.paused}
          />
        )
        : undefined}
    </div>
  )
}

export default VideoPlayer

import type shaka from 'shaka-player'

import type { CaptionTrack, Storyboard } from '../frame/protocol'

// must stay type-only: a value import puts the on-demand shaka chunk back in the entry
import type { startShakaPlayback } from './shaka'

import { LIVE_UNSUPPORTED } from '../frame/protocol'
import { preferredTrack } from '../frame/captions'

import { css } from '@emotion/react'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

import { resetEngine, startEngine } from '../scramjet/client'
import { warmShaka } from './prefetch'
import { registerSeek, clearSeek } from './seek'
import { getSettings, updateSettings } from '../settings'
import { showToast } from '../components/ui/toast'
import { isTypingTarget, PlayerControls } from './controls'
import { usePlayerState } from './use-player-state'

const playerStyle = css`
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: 14px;
  background: #000;
  position: relative;

  /* Fullscreen has to beat BOTH the 16/9 aspect-ratio box and the max-height
     that theater mode puts on this element, or the video is letterboxed inside
     a correctly-fullscreened container. Sizing off the viewport rather than
     100%/100% also survives whatever the ancestor grid was doing. */
  &:fullscreen {
    width: 100vw;
    height: 100vh;
    max-width: none;
    max-height: none;
    aspect-ratio: auto;
    border-radius: 0;
  }

  &:fullscreen video {
    width: 100%;
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
  { videoId, startAt, theater = false, onTheater }: {
    videoId: string
    startAt?: number
    theater?: boolean
    onTheater?: () => void
  },
) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const resumeAt = useRef(startAt ?? 0)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState('Loading player')
  const [player, setPlayer] = useState<shaka.Player | undefined>(undefined)
  const [heights, setHeights] = useState<number[]>([])
  const [storyboards, setStoryboards] = useState<Storyboard[]>([])
  const [isLive, setIsLive] = useState(false)
  const [quality, setQuality] = useState<'auto' | number>(() => getSettings().quality)
  const selectQualityRef = useRef<((height: number | 'auto') => Promise<void>) | undefined>(undefined)
  const [captionTracks, setCaptionTracks] = useState<CaptionTrack[]>([])
  const [caption, setCaption] = useState<string | undefined>(undefined)
  const selectCaptionRef = useRef<((trackId: string | undefined) => Promise<void>) | undefined>(undefined)
  const [active, setActive] = useState(true)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const state = usePlayerState(videoRef.current, player)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    // applied BEFORE playback starts, or autoplay is attempted at volume 1 and the browser's block-then-mute fallback loses the stored volume
    const audio = getSettings()
    video.volume = audio.volume
    video.muted = audio.muted
    video.playbackRate = audio.playbackRate
    const abort = new AbortController()
    let controller: Awaited<ReturnType<typeof startShakaPlayback>> | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const restart = (error: unknown) => {
      if (abort.signal.aborted || retryTimer !== undefined) return
      resumeAt.current = video.currentTime || resumeAt.current
      const terminal = error instanceof Error && error.message === LIVE_UNSUPPORTED
      if (terminal || attempt >= 3) {
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
      }, attempt === 0 && !engineFailure ? 100 : 1_000)
    }
    setStatus('Loading player')
    void (async () => {
      const [api, { startShakaPlayback }] = await Promise.all([startEngine(), warmShaka()])
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
      registerSeek(
        videoId,
        (seconds) => {
          video.currentTime = seconds
          void video.play().catch(() => {})
        },
        () => video.currentTime,
      )
      setPlayer(controller.player)
      setHeights(controller.heights)
      setStoryboards(controller.storyboards)
      setIsLive(controller.isLive)
      selectQualityRef.current = controller.selectQuality
      setCaptionTracks(controller.captionTracks)
      selectCaptionRef.current = controller.selectCaption
      const stored = getSettings().quality
      if (stored !== 'auto') void controller.selectQuality(stored).catch(() => {})
      const subtitles = getSettings()
      const wanted = subtitles.captionsEnabled
        ? preferredTrack(controller.captionTracks, subtitles.captionsLanguage)
        : undefined
      setCaption(wanted?.id)
      if (wanted) {
        void controller.selectCaption(wanted.id).catch(() => {
          setCaption((current) => (current === wanted.id ? undefined : current))
        })
      }
    })().catch((error) => {
      if (!abort.signal.aborted) restart(error)
    })
    return () => {
      abort.abort()
      clearTimeout(retryTimer)
      clearSeek(videoId)
      setPlayer(undefined)
      setHeights([])
      setStoryboards([])
      setIsLive(false)
      setCaptionTracks([])
      void controller?.destroy()
    }
  }, [attempt, videoId])

  const applyQuality = useCallback((value: 'auto' | number) => {
    setQuality(value)
    updateSettings({ quality: value })
    void selectQualityRef.current?.(value).catch(() => {})
  }, [])

  // stores the LANGUAGE rather than the track id, since ids are per video and the next video would not recognize one
  const applyCaption = useCallback((trackId: string | undefined) => {
    setCaption(trackId)
    const picked = captionTracks.find((track) => track.id === trackId)
    updateSettings(picked
      ? { captionsEnabled: true, captionsLanguage: picked.languageCode }
      : { captionsEnabled: false })
    void selectCaptionRef.current?.(trackId).catch(() => {
      if (!trackId) return
      setCaption((current) => (current === trackId ? undefined : current))
      showToast('Subtitles are not available for this video right now')
    })
  }, [captionTracks])

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
            storyboards={storyboards}
            quality={quality}
            onQuality={applyQuality}
            captionTracks={captionTracks}
            caption={caption}
            onCaption={applyCaption}
            theater={theater}
            onTheater={() => onTheater?.()}
            isLive={isLive}
            visible={active || state.paused}
          />
        )
        : undefined}
    </div>
  )
}

export default VideoPlayer

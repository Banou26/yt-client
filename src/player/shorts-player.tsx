import type { TargetedMouseEvent, TargetedPointerEvent } from 'preact'

// must stay type-only: a value import puts the on-demand shaka chunk back in the entry
import type { startShakaPlayback } from './shaka'

import { css } from '@emotion/react'
import { useEffect, useRef, useState } from 'preact/hooks'

import { LIVE_UNSUPPORTED } from '../frame/protocol'
import { startEngine } from '../scramjet/client'
import { warmShaka } from './prefetch'
import { getSettings, updateSettings } from '../settings'

const playerStyle = css`
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 12px;
  overflow: hidden;
  background: #000;

  video,
  .poster {
    display: block;
    width: 100%;
    height: 100%;
    /* The box is 9:16 and so is a well-formed short, so this is a no-op for the
       common case. It matters for the shorts that are not: plenty are uploaded
       1:1 or 16:9, and covering would crop their edges away rather than
       letting them letterbox. */
    object-fit: contain;
  }

  .poster {
    position: absolute;
    inset: 0;
  }

  .spinner {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 3.6rem;
    height: 3.6rem;
    margin: -1.8rem 0 0 -1.8rem;
    border: 0.3rem solid rgba(255, 255, 255, 0.25);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: shorts-spin 0.8s linear infinite;
    pointer-events: none;
  }

  @keyframes shorts-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .status {
    position: absolute;
    inset: auto 1.2rem 4.4rem;
    color: var(--text-on-media);
    font: 500 1.3rem/1.4 system-ui, sans-serif;
    text-shadow: 0 1px 4px #000;
    text-align: center;
  }

  .paused-glyph {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
  }

  .paused-glyph svg {
    width: 5.6rem;
    height: 5.6rem;
    fill: rgba(255, 255, 255, 0.9);
    filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.6));
  }

  /* Full-bleed progress line pinned to the bottom edge, the way the Shorts
     player shows position. It is a scrubber, so it takes pointer events while
     the surrounding surface stays a play/pause target. */
  .scrubber {
    position: absolute;
    inset: auto 0 0 0;
    height: 1.4rem;
    display: flex;
    align-items: flex-end;
    cursor: pointer;
    touch-action: none;
  }

  .scrubber .track {
    width: 100%;
    height: 0.3rem;
    background: rgba(255, 255, 255, 0.3);
    transition: height 0.1s ease;
  }

  .scrubber:hover .track,
  .scrubber.scrubbing .track {
    height: 0.5rem;
  }

  .scrubber .fill {
    height: 100%;
    background: var(--brand, #f00);
  }

  .mute {
    position: absolute;
    top: 1rem;
    right: 1rem;
    display: grid;
    place-items: center;
    width: 3.2rem;
    height: 3.2rem;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
    color: var(--text-on-media);
    cursor: pointer;
  }

  .mute svg {
    width: 1.8rem;
    height: 1.8rem;
    fill: currentColor;
  }
`

const MuteIcon = ({ muted }: { muted: boolean }) => (
  <svg viewBox='0 0 24 24' aria-hidden='true'>
    {muted
      ? <path d='M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.94 8.94 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z' />
      : <path d='M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z' />}
  </svg>
)

// only the visible slide may hold a SABR session: each one pins a per-session media cache in the frame
/**
 * The Shorts player.
 *
 * A separate component from `VideoPlayer` rather than a mode of it: the two
 * share only the Shaka startup call. This one loops, has no control bar, no
 * quality menu, no fullscreen and no keyboard map, and it is mounted and torn
 * down as slides scroll rather than living for a route.
 *
 * `active` is what gates playback. Only the visible slide is allowed to hold a
 * SABR session, because each open session pins a per-session media cache in the
 * frame and a pager that left them open would multiply them per swipe.
 */
const ShortsPlayer = (
  { videoId, poster, active }: { videoId: string, poster?: string, active: boolean },
) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState('')
  const [paused, setPaused] = useState(false)
  const [muted, setMuted] = useState(() => getSettings().muted)
  const [progress, setProgress] = useState(0)
  const [scrubbing, setScrubbing] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!active) setAttempt(0)
  }, [active])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !active) return
    const settings = getSettings()
    video.volume = settings.volume
    video.muted = settings.muted
    // the loop MUST be on the element: restarting through currentTime re-enters the SABR chain as a seek
    video.loop = true
    const abort = new AbortController()
    let controller: Awaited<ReturnType<typeof startShakaPlayback>> | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    setReady(false)
    setStatus('')
    const fail = (error: unknown) => {
      if (abort.signal.aborted || retryTimer !== undefined) return
      const message = error instanceof Error ? error.message : String(error)
      if (attempt >= 2 || message === LIVE_UNSUPPORTED) {
        setStatus(message)
        return
      }
      retryTimer = setTimeout(() => {
        if (!abort.signal.aborted) setAttempt((value) => value + 1)
      }, 400)
    }
    void (async () => {
      const [api, { startShakaPlayback }] = await Promise.all([startEngine(), warmShaka()])
      controller = await startShakaPlayback({
        api,
        video,
        videoId,
        startTime: 0,
        signal: abort.signal,
        onError: fail,
      })
      if (abort.signal.aborted) return
      setReady(true)
      // through selectQuality, not Shaka restrictions: the frame's SABR session must serve the format before Shaka may select it
      const displayHeight = Math.ceil(video.getBoundingClientRect().height * devicePixelRatio)
      const covering = [...controller.heights].sort((a, b) => a - b).find((height) => height >= displayHeight)
      if (covering) await controller.selectQuality(covering).catch(() => {})
    })().catch(fail)
    return () => {
      abort.abort()
      clearTimeout(retryTimer)
      setReady(false)
      void controller?.destroy()
    }
  }, [videoId, active, attempt])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const sync = () => {
      setPaused(video.paused)
      setMuted(video.muted)
    }
    const tick = () => {
      if (scrubbing) return
      const duration = video.duration
      setProgress(Number.isFinite(duration) && duration > 0 ? video.currentTime / duration : 0)
    }
    video.addEventListener('play', sync)
    video.addEventListener('pause', sync)
    video.addEventListener('volumechange', sync)
    video.addEventListener('timeupdate', tick)
    return () => {
      video.removeEventListener('play', sync)
      video.removeEventListener('pause', sync)
      video.removeEventListener('volumechange', sync)
      video.removeEventListener('timeupdate', tick)
    }
  }, [scrubbing])

  const seekToPointer = (event: TargetedPointerEvent<HTMLDivElement>) => {
    const video = videoRef.current
    const track = event.currentTarget as HTMLElement | null
    if (!video || !track || !Number.isFinite(video.duration)) return
    const box = track.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
    setProgress(ratio)
    video.currentTime = ratio * video.duration
  }

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => {})
    else video.pause()
  }

  return (
    <div css={playerStyle} onClick={togglePlay}>
      {poster && !ready ? <img className='poster' src={poster} alt='' /> : undefined}
      <video key={attempt} ref={videoRef} playsInline preload='auto' />
      {active && !ready && !status ? <div className='spinner' /> : undefined}
      {status ? <p className='status'>{status}</p> : undefined}
      {ready && paused
        ? (
          <div className='paused-glyph'>
            <svg viewBox='0 0 24 24' aria-hidden='true'><path d='M8 5v14l11-7z' /></svg>
          </div>
        )
        : undefined}
      {ready
        ? (
          <button
            type='button'
            className='mute'
            aria-label={muted ? 'Unmute' : 'Mute'}
            onClick={(event: TargetedMouseEvent<HTMLButtonElement>) => {
              event.stopPropagation()
              const video = videoRef.current
              if (!video) return
              video.muted = !video.muted
              updateSettings({ muted: video.muted })
            }}
          >
            <MuteIcon muted={muted} />
          </button>
        )
        : undefined}
      {ready
        ? (
          <div
            className={scrubbing ? 'scrubber scrubbing' : 'scrubber'}
            onClick={(event: TargetedMouseEvent<HTMLDivElement>) => event.stopPropagation()}
            onPointerDown={(event: TargetedPointerEvent<HTMLDivElement>) => {
              event.stopPropagation()
              ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
              setScrubbing(true)
              seekToPointer(event)
            }}
            onPointerMove={(event: TargetedPointerEvent<HTMLDivElement>) => {
              if (scrubbing) seekToPointer(event)
            }}
            onPointerUp={(event: TargetedPointerEvent<HTMLDivElement>) => {
              ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
              setScrubbing(false)
            }}
          >
            <div className='track'>
              <div className='fill' style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
        )
        : undefined}
    </div>
  )
}

export default ShortsPlayer

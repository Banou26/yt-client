import { css } from '@emotion/react'
import { Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { Storyboard } from '../frame/protocol'

import { bestStoryboard, storyboardFrame } from '../frame/storyboard'

import { startEngine } from '../scramjet/client'
import { clock } from './controls'
import { warmShaka } from './prefetch'

import type { startShakaPlayback } from './shaka'

// only ONE preview can be live at a time: module scope because no single card can know about the others
let activeToken = 0

const DWELL_MS = 700

// carried between previews and deliberately NOT persisted: a feed may never start talking on its own
let preferMuted = true

// a card wants the largest sheet that FITS, not the sharpest one `bestStoryboard` picks
const previewStoryboard = (boards: Storyboard[], stripWidth: number) => {
  const fitting = boards.filter((board) => board.thumbnailWidth <= stripWidth * 0.6)
  if (fitting.length) return bestStoryboard(fitting)
  return boards.reduce<Storyboard | undefined>(
    (best, board) => (!best || board.thumbnailWidth < best.thumbnailWidth ? board : best),
    undefined,
  )
}

const style = css`
  position: absolute;
  inset: 0;
  background: #000;
  /* Above the card's own thumbnail overlays.

     The duration badge and the resume bar are siblings drawn AFTER this one, and
     the resume bar is deliberately last so it wins wherever the two overlap. It
     therefore also won over the scrubber: both sit flush to the bottom edge, the
     resume bar is 4px and the scrubber's visible track is the bottom 3px of its
     strip, so the track was painted UNDER a bar of the same brand red. What the
     reader saw was a scrubber; what the pointer hit was a span with no handler,
     so dragging it did nothing. The preview covers the whole thumbnail anyway,
     so it owns this box while it is up. */
  z-index: 1;

  /* Held invisible until the video actually has a frame to show.

     This box is opaque black and it covers the thumbnail from the moment it
     mounts, so every millisecond of session setup was painted as a black
     rectangle where a picture used to be, which reads as the card breaking
     rather than as the card loading. Fading the preview IN is the same thing as
     fading the thumbnail OUT, and it needs no second element and no
     coordination with the card: the still is simply still there, underneath.

     It also fixes the failure case. A preview that never produces a frame now
     leaves the thumbnail up forever instead of leaving a black hole, which is
     the behaviour the silent-failure design already asked for everywhere else
     in this file. */
  opacity: 0;
  transition: opacity 0.18s ease;

  &[data-painted] {
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }

  video {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* The grab area is deliberately several times the height of the bar it draws.
     A 3px track on the last pixels of a thumbnail is not a pointer target at
     any card size, so the strip reaches well above the line and the line itself
     sits at the bottom of it. */
  .scrubber {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2.4rem;
    display: flex;
    align-items: flex-end;
    cursor: pointer;
    touch-action: none;
  }

  .track {
    position: relative;
    width: 100%;
    height: 0.4rem;
    background: rgba(255, 255, 255, 0.3);
    transition: height 0.12s ease;
  }

  /* Thickens under the pointer, so the thing being aimed at confirms the aim
     before the press rather than after it. */
  .scrubber:hover .track {
    height: 0.6rem;
  }

  /* Buffered sits UNDER played and over the track, the same three-layer stack
     the watch controls use, so the bar reads as "have it / played it / neither"
     rather than as one bar that only knows about the playhead. */
  .buffered {
    position: absolute;
    inset: 0 auto 0 0;
    background: rgba(255, 255, 255, 0.5);
  }

  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--brand-red);
  }

  /* The knob is what makes the bar look grabbable before it is grabbed. It sits
     outside the track's overflow so it can be taller than the 4px line. */
  .knob {
    position: absolute;
    bottom: -0.3rem;
    width: 1.2rem;
    height: 1.2rem;
    margin-left: -0.6rem;
    border-radius: 50%;
    background: var(--brand-red);
    pointer-events: none;
  }

  /* Storyboard scrub preview: the sheet frame plus its timestamp, centred on
     the pointer and clamped inside the card. Identical treatment to the watch
     scrubber (white border, time underneath) because it is the same gesture. */
  .preview {
    position: absolute;
    bottom: 100%;
    margin-bottom: 0.6rem;
    transform: translateX(-50%);
    pointer-events: none;
    text-align: center;
  }

  .preview-frame {
    border: 2px solid #ffffff;
    border-radius: 0.4rem;
    background-color: #000;
    background-repeat: no-repeat;
  }

  .preview-time {
    margin-top: 0.2rem;
    font-size: 1.2rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 1px 3px #000;
  }

  .muted {
    position: absolute;
    top: 0.8rem;
    right: 0.8rem;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.8rem;
    height: 2.8rem;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    cursor: pointer;
  }

  .muted:hover {
    background: rgba(0, 0, 0, 0.8);
  }
`

export const HoverPreview = ({ videoId }: { videoId: string }) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [progress, setProgress] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [ready, setReady] = useState(false)
  const [painted, setPainted] = useState(false)
  const [muted, setMuted] = useState(preferMuted)
  const [storyboards, setStoryboards] = useState<Storyboard[]>([])
  const [hover, setHover] = useState<{ x: number, width: number, time: number } | undefined>()

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const token = ++activeToken
    const abort = new AbortController()
    let controller: Awaited<ReturnType<typeof startShakaPlayback>> | undefined
    video.muted = preferMuted

    const timer = setTimeout(() => {
      void (async () => {
        const [api, { startShakaPlayback }] = await Promise.all([startEngine(), warmShaka()])
        if (abort.signal.aborted || token !== activeToken) return
        controller = await startShakaPlayback({
          api,
          video,
          videoId,
          startTime: 0,
          signal: abort.signal,
          onError: () => {},
        })
        if (abort.signal.aborted) return
        void video.play().catch(() => {})
        setStoryboards(controller.storyboards)
        setReady(true)
      })().catch(() => {
        // silent: the thumbnail underneath is still the right thing to show
      })
    }, DWELL_MS)

    const onTime = () => {
      if (video.duration > 0) setProgress(video.currentTime / video.duration)
      // the range that CONTAINS the playhead, not the last one: a seek leaves earlier ranges behind
      const ranges = video.buffered
      for (let index = 0; index < ranges.length; index += 1) {
        if (ranges.start(index) <= video.currentTime && video.currentTime <= ranges.end(index)) {
          if (video.duration > 0) setBuffered(ranges.end(index) / video.duration)
          break
        }
      }
    }
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('progress', onTime)

    const onPainted = () => setPainted(true)
    if (video.readyState >= 2) onPainted()
    video.addEventListener('loadeddata', onPainted)

    return () => {
      clearTimeout(timer)
      abort.abort()
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('progress', onTime)
      video.removeEventListener('loadeddata', onPainted)
      void controller?.destroy()
    }
  }, [videoId])

  const ratioFromPointer = (event: PointerEvent) => {
    const bar = event.currentTarget as HTMLElement
    const box = bar.getBoundingClientRect()
    return Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
  }

  const seekFromPointer = (event: PointerEvent) => {
    const video = videoRef.current
    if (!video || !video.duration) return
    const ratio = ratioFromPointer(event)
    video.currentTime = ratio * video.duration
    setProgress(ratio)
  }

  const trackHover = (event: PointerEvent) => {
    const video = videoRef.current
    if (!video?.duration) return
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const ratio = ratioFromPointer(event)
    setHover({ x: event.clientX - box.left, width: box.width, time: ratio * video.duration })
  }

  const board = hover ? previewStoryboard(storyboards, hover.width) : undefined
  const frame = board && hover ? storyboardFrame(board, hover.time) : undefined
  // half the tile plus its 2px border
  const half = frame ? frame.width / 2 + 2 : 0
  const previewLeft = hover
    ? Math.min(Math.max(hover.x, half), Math.max(half, hover.width - half))
    : 0

  return (
    <div css={style} data-painted={painted ? '' : undefined}>
      {/* No preload='none': an element told not to preload never runs its resource selection, so the MediaSource sits at networkState 0 forever */}
      <video ref={videoRef} muted playsInline tabIndex={-1} aria-hidden='true' />
      {ready
        ? (
          <button
            type='button'
            className='muted'
            aria-label={muted ? 'Unmute preview' : 'Mute preview'}
            onPointerDown={(event: PointerEvent) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event: MouseEvent) => {
              event.preventDefault()
              event.stopPropagation()
              const video = videoRef.current
              if (!video) return
              video.muted = !video.muted
              preferMuted = video.muted
              setMuted(video.muted)
            }}
          >
            {muted ? <VolumeX size={16} strokeWidth={2} /> : <Volume2 size={16} strokeWidth={2} />}
          </button>
        )
        : undefined}
      {ready
        ? (
          <div
            className='scrubber'
            onPointerLeave={() => setHover(undefined)}
            onPointerDown={(event: PointerEvent) => {
              // this is drawn INSIDE the card's watch link, so an unguarded press opens the video
              event.preventDefault()
              event.stopPropagation()
              ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
              seekFromPointer(event)
            }}
            onPointerMove={(event: PointerEvent) => {
              trackHover(event)
              if (event.buttons !== 0) seekFromPointer(event)
            }}
            onClick={(event: MouseEvent) => {
              event.preventDefault()
              event.stopPropagation()
            }}
          >
            <div className='track'>
              <div className='buffered' style={{ width: `${Math.round(buffered * 100)}%` }} />
              <div className='fill' style={{ width: `${Math.round(progress * 100)}%` }} />
              <div className='knob' style={{ left: `${Math.round(progress * 100)}%` }} />
            </div>
            {hover
              ? (
                <div className='preview' style={{ left: `${previewLeft}px` }}>
                  {frame
                    ? (
                      <div
                        className='preview-frame'
                        style={{
                          width: `${frame.width}px`,
                          height: `${frame.height}px`,
                          backgroundImage: `url("${frame.url}")`,
                          backgroundPosition: `-${frame.x}px -${frame.y}px`,
                        }}
                      />
                    )
                    : undefined}
                  <div className='preview-time'>{clock(hover.time)}</div>
                </div>
              )
              : undefined}
          </div>
        )
        : undefined}
    </div>
  )
}

export default HoverPreview

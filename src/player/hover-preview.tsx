import { css } from '@emotion/react'
import { Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { Storyboard } from '../frame/protocol'

import { bestStoryboard, storyboardFrame } from '../frame/storyboard'

import { startEngine } from '../scramjet/client'
import { clock } from './controls'
import { warmShaka } from './prefetch'

// Type-only, so it is erased at build and adds no runtime edge back to the
// chunk this file deliberately loads on demand.
import type { startShakaPlayback } from './shaka'

/* An inline preview is a REAL playback session: it opens a SABR session in the
   frame, mints a token and streams media, the same as the watch page. Three
   consequences shape everything here.

   It costs a tunneled round trip, so it starts only after a dwell delay: moving
   the pointer across a grid must not open a session per card passed over.

   Only ONE can be live at a time. Each session holds a media cache in the
   frame, so a reader sweeping a feed would otherwise accumulate them until the
   frame is carrying a dozen. The token below is module scope because no single
   card can know about the others.

   The box is small, and startShakaPlayback derives its format ceiling from the
   element, so a preview asks for a low resolution rather than the 1080p the
   watch page would. */
let activeToken = 0

// About as long as a deliberate pause. Shorter turns an accidental sweep into a
// burst of sessions; longer reads as the preview being broken.
const DWELL_MS = 700

/* Carried between previews so unmuting one card does not have to be repeated on
   the next, and NOT persisted: the rule is that a feed may never start talking
   on its own, which is about the default, not about forgetting a choice the
   viewer just made. A fresh page load starts silent again. */
let preferMuted = true

/* The watch scrubber wants the SHARPEST sheet; a card wants the largest one
   that FITS. YouTube ships levels roughly 48, 80, 160 and 320 wide, and
   `bestStoryboard` takes the 320 - which is wider than a grid card, so the tile
   hangs off both edges and no amount of clamping helps: a clamp can recentre a
   frame, it cannot shrink one.

   Capped at 60% of the strip so the frame stays clearly a preview OF the card
   rather than a second card sitting on top of it. Falls back to the smallest
   level when even that does not fit, which is the least bad of the bad options
   and still beats overflowing onto the neighbour. */
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

/**
 * A muted inline preview drawn over a card thumbnail.
 *
 * Mounted only while the pointer is dwelling on the card. Failure is silent by
 * design: this is a hover affordance over a thumbnail that is already correct,
 * so an error card in its place would be worse than no preview.
 */
export const HoverPreview = ({ videoId }: { videoId: string }) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [progress, setProgress] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [ready, setReady] = useState(false)
  /* Separate from `ready`, which says the controller exists. This says PIXELS
     exist, which is the only thing that makes covering the thumbnail correct.
     `loadeddata` is exactly that signal: readyState has reached
     HAVE_CURRENT_DATA, so there is a frame for the current position. */
  const [painted, setPainted] = useState(false)
  const [muted, setMuted] = useState(preferMuted)
  const [storyboards, setStoryboards] = useState<Storyboard[]>([])
  /* Where the pointer is over the strip, which is NOT the playhead: the frame
     under the pointer is what a scrub is aiming at, and showing the playhead
     instead would make the preview lag the gesture it exists to guide.

     Carries pixels rather than a ratio because the frame has to be clamped
     inside the card, and a card is a fraction of the width the watch scrubber
     gets: a sheet tile centred on ratio 0 hangs half its width off the left
     edge, over the neighbouring card. */
  const [hover, setHover] = useState<{ x: number, width: number, time: number } | undefined>()

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const token = ++activeToken
    const abort = new AbortController()
    let controller: Awaited<ReturnType<typeof startShakaPlayback>> | undefined
    // Never read from settings and never persisted: a preview is muted because
    // a feed that starts talking when the pointer rests on it is hostile, not
    // because the viewer chose it. `preferMuted` only carries a choice the
    // viewer made a moment ago, in this session.
    video.muted = preferMuted

    const timer = setTimeout(() => {
      void (async () => {
        // Loaded on demand so Shaka stays out of the entry chunk. The card's
        // own hover prefetch has normally warmed it already.
        const [api, { startShakaPlayback }] = await Promise.all([startEngine(), warmShaka()])
        // A newer hover has taken over while the engine was coming up.
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
        // Muted, so the autoplay policy permits this without a gesture. Kept
        // here rather than relied on from startShakaPlayback so a preview that
        // starts paused still rolls.
        void video.play().catch(() => {})
        setStoryboards(controller.storyboards)
        setReady(true)
      })().catch(() => {
        // Silent: the thumbnail underneath is still the right thing to show.
      })
    }, DWELL_MS)

    const onTime = () => {
      if (video.duration > 0) setProgress(video.currentTime / video.duration)
      // The range that CONTAINS the playhead, not the last one: a seek leaves
      // earlier ranges behind, and taking the final one would draw a buffer
      // that has nothing to do with where playback actually is.
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

    // Checked as well as listened for: Shaka can reach HAVE_CURRENT_DATA before
    // this effect gets to attach, and a missed event would hold the preview
    // invisible for its whole life.
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

  // Dragging anywhere on the strip seeks, rather than only a press on the drawn
  // line: the line is a few pixels tall over a card, so requiring precision
  // would make it unusable at the size it actually renders.
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

  // Tracked on every move, pressed or not, so the storyboard frame follows the
  // pointer before a drag starts - which is the whole point of a scrub preview.
  const trackHover = (event: PointerEvent) => {
    const video = videoRef.current
    if (!video?.duration) return
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const ratio = ratioFromPointer(event)
    setHover({ x: event.clientX - box.left, width: box.width, time: ratio * video.duration })
  }

  const board = hover ? previewStoryboard(storyboards, hover.width) : undefined
  const frame = board && hover ? storyboardFrame(board, hover.time) : undefined
  // Half the tile plus its 2px border, so the clamp accounts for what is
  // actually painted rather than for the sprite alone.
  const half = frame ? frame.width / 2 + 2 : 0
  const previewLeft = hover
    ? Math.min(Math.max(hover.x, half), Math.max(half, hover.width - half))
    : 0

  return (
    <div css={style} data-painted={painted ? '' : undefined}>
      {/* No preload='none': Shaka drives this element through MSE, and an
          element told not to preload never runs its resource selection, so the
          MediaSource attaches and then sits at networkState 0 forever. */}
      <video ref={videoRef} muted playsInline tabIndex={-1} aria-hidden='true' />
      {ready
        ? (
          <button
            type='button'
            className='muted'
            aria-label={muted ? 'Unmute preview' : 'Mute preview'}
            /* Same guard as the scrubber: this is drawn INSIDE the card's watch
               link, so an unguarded press opens the video instead of toggling
               sound. */
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
              /* The preview is drawn INSIDE the card's watch link, so a press
                 here would otherwise open the video: scrubbing and clicking
                 through are the same gesture to the anchor above. Both are
                 stopped, and the click below covers the anchor's own default. */
              event.preventDefault()
              event.stopPropagation()
              // Captured so a drag that leaves the strip keeps seeking rather
              // than stopping the moment the pointer slips off a short target.
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

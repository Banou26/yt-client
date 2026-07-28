import { css } from '@emotion/react'
import { useEffect, useRef, useState } from 'preact/hooks'

import { startEngine } from '../scramjet/client'
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

const style = css`
  position: absolute;
  inset: 0;
  background: #000;

  video {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .scrubber {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 1.2rem;
    display: flex;
    align-items: flex-end;
    cursor: pointer;
    touch-action: none;
  }

  .track {
    width: 100%;
    height: 0.3rem;
    background: rgba(255, 255, 255, 0.3);
  }

  .fill {
    height: 100%;
    background: var(--brand-red);
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
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    cursor: pointer;
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
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const token = ++activeToken
    const abort = new AbortController()
    let controller: Awaited<ReturnType<typeof startShakaPlayback>> | undefined
    // Never persisted and never read from settings: a preview is muted because
    // a feed that starts talking when the pointer rests on it is hostile, not
    // because the viewer chose it.
    video.muted = true

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
        setReady(true)
      })().catch(() => {
        // Silent: the thumbnail underneath is still the right thing to show.
      })
    }, DWELL_MS)

    const onTime = () => {
      if (video.duration > 0) setProgress(video.currentTime / video.duration)
    }
    video.addEventListener('timeupdate', onTime)

    return () => {
      clearTimeout(timer)
      abort.abort()
      video.removeEventListener('timeupdate', onTime)
      void controller?.destroy()
    }
  }, [videoId])

  // Dragging anywhere on the bar seeks, rather than only a press on the handle:
  // the strip is 12px tall over a card, so requiring precision would make it
  // unusable at the size it actually renders.
  const seekFromPointer = (event: PointerEvent) => {
    const video = videoRef.current
    if (!video || !video.duration) return
    const bar = event.currentTarget as HTMLElement
    const box = bar.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
    video.currentTime = ratio * video.duration
    setProgress(ratio)
  }

  return (
    <div css={style}>
      {/* No preload='none': Shaka drives this element through MSE, and an
          element told not to preload never runs its resource selection, so the
          MediaSource attaches and then sits at networkState 0 forever. */}
      <video ref={videoRef} muted playsInline tabIndex={-1} aria-hidden='true' />
      {ready
        ? (
          <div
            className='scrubber'
            onPointerDown={(event: PointerEvent) => {
              /* The preview is drawn INSIDE the card's watch link, so a press
                 here would otherwise open the video: scrubbing and clicking
                 through are the same gesture to the anchor above. Both are
                 stopped, and the click below covers the anchor's own default. */
              event.preventDefault()
              event.stopPropagation()
              // Captured so a drag that leaves the strip keeps seeking rather
              // than stopping the moment the pointer slips off a 12px target.
              ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
              seekFromPointer(event)
            }}
            onPointerMove={(event: PointerEvent) => {
              if (event.buttons !== 0) seekFromPointer(event)
            }}
            onClick={(event: MouseEvent) => {
              event.preventDefault()
              event.stopPropagation()
            }}
          >
            <div className='track'>
              <div className='fill' style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>
        )
        : undefined}
    </div>
  )
}

export default HoverPreview

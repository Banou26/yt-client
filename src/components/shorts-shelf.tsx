import type { VideoCardData } from './video-card'

import { css } from '@emotion/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { Link } from 'wouter'

import { formatViews } from './format'

// A short opens the vertical pager, seeded on the one that was clicked, rather
// than the 16:9 watch page.
const shortsHrefFor = (id: string) => `/shorts/${encodeURIComponent(id)}`

const style = css`
  /* Spans the whole grid so the shelf is a full-width band between rows rather
     than a cell inside one. */
  grid-column: 1 / -1;
  margin: 1.6rem 0 2.4rem;

  .shelf-head {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    margin-bottom: 1.6rem;
  }

  .shelf-title {
    margin: 0;
    font-size: 2rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .rail {
    position: relative;
  }

  .track {
    display: flex;
    gap: 0.8rem;
    overflow-x: auto;
    scroll-behavior: smooth;
    /* The scrollbar is hidden because the arrows are the affordance; without
       them the overflow would be unreachable on a mouse-only desktop, which is
       why they are rendered rather than left to the trackpad. */
    scrollbar-width: none;
    scroll-snap-type: x proximity;
  }

  .track::-webkit-scrollbar {
    display: none;
  }

  .card {
    flex: none;
    width: 21rem;
    scroll-snap-align: start;
  }

  .thumb {
    display: block;
    aspect-ratio: 9 / 16;
    border-radius: 1.2rem;
    overflow: hidden;
    background: var(--bg-elevated);
  }

  .thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .title {
    margin: 0.8rem 0 0;
    font-size: 1.4rem;
    font-weight: 500;
    line-height: 2rem;
    color: var(--text-primary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .views {
    margin-top: 0.4rem;
    font-size: 1.2rem;
    color: var(--text-secondary);
  }

  .arrow {
    position: absolute;
    top: calc(50% - 6rem);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 4rem;
    height: 4rem;
    border: none;
    border-radius: 50%;
    background: var(--bg-menu);
    color: var(--text-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    cursor: pointer;
    z-index: 1;
  }

  .arrow.left {
    left: -2rem;
  }

  .arrow.right {
    right: -2rem;
  }
`

// Roughly a screenful, so a click advances the rail rather than nudging it.
const SCROLL_BY = 0.8

export const ShortsShelf = ({ shorts }: { shorts: readonly VideoCardData[] }) => {
  const trackRef = useRef<HTMLDivElement>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)

  // Which arrows to show is a measurement, not a count: the number of cards
  // that fit depends on the viewport, and a rail that already fits needs none.
  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return
    const measure = () => {
      const max = track.scrollWidth - track.clientWidth
      setAtStart(track.scrollLeft <= 1)
      setAtEnd(track.scrollLeft >= max - 1)
    }
    measure()
    track.addEventListener('scroll', measure, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(track)
    return () => {
      track.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [shorts.length])

  if (shorts.length === 0) return null

  const scrollBy = (direction: 1 | -1) => {
    const track = trackRef.current
    if (!track) return
    track.scrollBy({ left: direction * track.clientWidth * SCROLL_BY, behavior: 'smooth' })
  }

  return (
    <section css={style} aria-label='Shorts'>
      <div className='shelf-head'>
        <svg width='24' height='24' viewBox='0 0 24 24' aria-hidden='true'>
          <path
            fill='#f00'
            d='M17.77 10.32l-1.2-.5 1.2-.5a3.7 3.7 0 0 0-3.24-6.64L5.1 7.2a3.7 3.7 0 0 0 .13 6.68l1.2.5-1.2.5a3.7 3.7 0 0 0 3.24 6.64l9.43-4.52a3.7 3.7 0 0 0-.13-6.68z'
          />
          <path fill='#fff' d='M10 14.65v-5.3L15 12z' />
        </svg>
        <h2 className='shelf-title'>Shorts</h2>
      </div>
      <div className='rail'>
        {!atStart
          ? (
            <button type='button' className='arrow left' aria-label='Previous shorts' onClick={() => scrollBy(-1)}>
              <ChevronLeft size={24} strokeWidth={2} />
            </button>
          )
          : undefined}
        <div className='track' ref={trackRef}>
          {shorts.map(short => (
            <article className='card' key={short.id}>
              <Link href={shortsHrefFor(short.id)} className='thumb' tabIndex={-1} aria-hidden='true'>
                {short.thumbnail ? <img src={short.thumbnail} alt='' loading='lazy' /> : undefined}
              </Link>
              <h3 className='title'>
                <Link href={shortsHrefFor(short.id)}>{short.title}</Link>
              </h3>
              {short.viewCount ? <div className='views'>{formatViews(short.viewCount)}</div> : undefined}
            </article>
          ))}
        </div>
        {!atEnd
          ? (
            <button type='button' className='arrow right' aria-label='More shorts' onClick={() => scrollBy(1)}>
              <ChevronRight size={24} strokeWidth={2} />
            </button>
          )
          : undefined}
      </div>
    </section>
  )
}

export default ShortsShelf

import type { HomeFeedQuery } from '../generated/graphql'

import { css } from '@emotion/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useQuery } from 'urql'

import { useDocumentTitle } from '../app'
import { FeedSentinel, useInfiniteFeed } from '../components/use-infinite-feed'
import { VideoGrid } from '../components/video-grid'
import { gql } from '../generated'

const HOME_FEED_QUERY = gql(`
  query HomeFeed($chip: ID, $cursor: String) {
    home(chip: $chip, cursor: $cursor) {
      items {
        id
        title
        thumbnail
        durationSeconds
        viewCount
        publishedText
        isLive
        progressPercent
        channel { id name avatar }
      }
      chips {
        id
        label
        selected
      }
      cursor
    }
  }
`)

type HomeFeedPage = HomeFeedQuery['home']
type RailChip = HomeFeedPage['chips'][number]

const style = css`
  padding: 0 1.6rem 2.4rem;

  .rail {
    position: sticky;
    top: var(--header-height);
    z-index: 100;
    margin-bottom: 1.2rem;
    background: var(--bg-base);
  }

  .chips {
    display: flex;
    padding: 1.2rem 0;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .chips::-webkit-scrollbar {
    display: none;
  }

  .track {
    display: flex;
    gap: 1.2rem;
  }

  .chip {
    flex: none;
    height: 3.2rem;
    padding: 0 1.2rem;
    border: none;
    border-radius: 0.8rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-size: 1.4rem;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .chip:hover {
    background: var(--bg-chip-hover);
  }

  .chip.active {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  .chip.active:hover {
    background: var(--bg-inverse-hover);
  }

  .rail-arrow {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    width: 8rem;
    padding: 0;
    border: none;
    color: var(--text-primary);
    cursor: pointer;
  }

  .rail-arrow.start {
    left: 0;
    justify-content: flex-start;
    background: linear-gradient(to right, var(--bg-base) 60%, transparent);
  }

  .rail-arrow.end {
    right: 0;
    justify-content: flex-end;
    background: linear-gradient(to left, var(--bg-base) 60%, transparent);
  }

  .rail-arrow .circle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 4rem;
    height: 4rem;
    border-radius: 50%;
    transition: background 0.15s ease;
  }

  .rail-arrow:hover .circle {
    background: var(--bg-hover);
  }

  .notice {
    padding: 2.4rem 0;
    color: var(--text-secondary);
  }

  .empty {
    max-width: 56rem;
    margin: 4.8rem auto 0;
    padding: 2.4rem;
    border-radius: 1.2rem;
    background: var(--bg-subtle);
    text-align: center;
  }

  .empty h2 {
    margin: 0 0 0.8rem;
    font-size: 2rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .empty p {
    margin: 0;
    font-size: 1.4rem;
    color: var(--text-secondary);
  }
`

const HomePage = () => {
  useDocumentTitle()
  const [chip, setChip] = useState<string>()
  // Consumed pages carry the chip they came from, so picking another filter
  // starts from an empty list in the same render rather than one frame later.
  const [loaded, setLoaded] = useState<{ chip?: string, pages: HomeFeedPage[] }>({ pages: [] })
  // Continuations come back with an empty chips list, so the rail is kept in
  // state rather than read off whichever page happens to be current.
  const [rail, setRail] = useState<{ chips: RailChip[], allId?: string }>({ chips: [] })
  const [arrows, setArrows] = useState({ start: false, end: false })
  const scrollerRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const pages = loaded.chip === chip ? loaded.pages : []
  const [{ data, error, fetching, operation }] = useQuery({
    query: HOME_FEED_QUERY,
    variables: { chip, cursor: pages[pages.length - 1]?.cursor }
  })

  // urql holds the previous result while the next request is in flight, so a
  // page is only usable once it is known to come from the selected chip: a
  // cursor is minted per filter and cannot page another filter's results.
  const page = operation?.variables.chip === chip ? data?.home : undefined
  // Within one filter the same hold means the live page can repeat one already
  // consumed, which useInfiniteFeed dedupes by id.
  const { items, cursor } = useInfiniteFeed({
    pages: page ? [...pages, page] : pages,
    key: video => video.id
  })

  useEffect(() => {
    const chips = page?.chips
    if (!chips || chips.length === 0) return
    setRail(previous => (
      previous.chips === chips
        ? previous
        : {
          chips,
          // YouTube's own rail leads with an All entry, which the unfiltered
          // feed reports as selected. It is spotted that way rather than by
          // label, which is localized, and dropped below so the synthetic All
          // is not rendered twice. Only the first response can decide this: a
          // later one also marks the applied chip selected.
          allId: previous.allId ?? chips.find(entry => entry.selected)?.id
        }
    ))
  }, [page])

  useEffect(() => {
    const scroller = scrollerRef.current
    const track = trackRef.current
    if (!scroller || !track) return
    const measure = () => {
      // 1px of slack: fractional layout widths never land exactly on the edge.
      const start = scroller.scrollLeft > 1
      const end = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1
      setArrows(previous => previous.start === start && previous.end === end ? previous : { start, end })
    }
    // The track is observed alongside the scroller because chips arriving and
    // the web font landing both change the content width while leaving the
    // scroller's own box untouched.
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    observer.observe(track)
    scroller.addEventListener('scroll', measure, { passive: true })
    measure()
    return () => {
      observer.disconnect()
      scroller.removeEventListener('scroll', measure)
    }
  }, [])

  const scrollRail = (direction: -1 | 1) => {
    const scroller = scrollerRef.current
    if (!scroller) return
    scroller.scrollBy({ left: direction * scroller.clientWidth * 0.8, behavior: 'smooth' })
  }

  const onMore = () => {
    if (!page?.cursor || fetching || error) return
    setLoaded({ chip, pages: pages[pages.length - 1] === page ? pages : [...pages, page] })
  }

  const chips = rail.chips.filter(entry => entry.id !== rail.allId)
  const empty = !fetching && !error && items.length === 0

  return (
    <main css={style}>
      <div className='rail'>
        {arrows.start
          ? (
            <button type='button' className='rail-arrow start' aria-label='Scroll filters left' onClick={() => scrollRail(-1)}>
              <span className='circle'>
                <ChevronLeft size={24} strokeWidth={1.5} />
              </span>
            </button>
          )
          : undefined}
        <div className='chips' ref={scrollerRef}>
          <div className='track' ref={trackRef}>
            <button
              type='button'
              className={chip === undefined ? 'chip active' : 'chip'}
              aria-pressed={chip === undefined}
              onClick={() => setChip(undefined)}
            >
              All
            </button>
            {chips.map(entry => (
              <button
                key={entry.id}
                type='button'
                className={entry.id === chip ? 'chip active' : 'chip'}
                aria-pressed={entry.id === chip}
                onClick={() => setChip(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
        {arrows.end
          ? (
            <button type='button' className='rail-arrow end' aria-label='Scroll filters right' onClick={() => scrollRail(1)}>
              <span className='circle'>
                <ChevronRight size={24} strokeWidth={1.5} />
              </span>
            </button>
          )
          : undefined}
      </div>
      {error && items.length === 0 ? <p className='notice'>{error.message}</p> : undefined}
      {empty
        ? chip === undefined
          ? (
            <div className='empty'>
              <h2>Try searching to get started</h2>
              <p>Anonymous sessions start with an empty feed: search for videos to start watching.</p>
            </div>
          )
          : <p className='notice'>No videos under this filter.</p>
        : <VideoGrid videos={items} fetching={fetching && items.length === 0} />}
      {error && items.length > 0 ? <p className='notice'>Couldn’t load more videos.</p> : undefined}
      {fetching && items.length > 0 ? <p className='notice'>Loading more…</p> : undefined}
      <FeedSentinel onVisible={onMore} disabled={fetching || !cursor || Boolean(error)} />
    </main>
  )
}

export default HomePage

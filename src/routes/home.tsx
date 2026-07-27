import { css } from '@emotion/react'
import { useQuery } from 'urql'
import { useLocation } from 'wouter'

import { VideoGrid } from '../components/video-grid'
import { gql } from '../generated'

const HOME_FEED_QUERY = gql(`
  query HomeFeed {
    home {
      items {
        id
        title
        thumbnail
        durationSeconds
        viewCount
        publishedText
        isLive
        channel { id name avatar }
      }
    }
  }
`)

const CHIPS = ['All', 'Music', 'Gaming', 'Live', 'News', 'Sports', 'Learning', 'Podcasts']

const style = css`
  padding: 0 1.6rem 2.4rem;

  .chips {
    position: sticky;
    top: var(--header-height);
    z-index: 100;
    display: flex;
    gap: 1.2rem;
    padding: 1.2rem 0;
    margin-bottom: 1.2rem;
    overflow-x: auto;
    scrollbar-width: none;
    background: var(--bg-base);
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

  .error {
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
  const [{ data, error, fetching }] = useQuery({ query: HOME_FEED_QUERY })
  const [, navigate] = useLocation()
  return (
    <main css={style}>
      <div className='chips'>
        {CHIPS.map(chip => (
          <button
            key={chip}
            type='button'
            className={chip === 'All' ? 'chip active' : 'chip'}
            onClick={chip === 'All' ? undefined : () => navigate(`/search/${encodeURIComponent(chip)}`)}
          >
            {chip}
          </button>
        ))}
      </div>
      {error ? <p className='error'>{error.message}</p> : undefined}
      {!fetching && !error && data?.home.items.length === 0
        ? (
          <div className='empty'>
            <h2>Try searching to get started</h2>
            <p>Anonymous sessions start with an empty feed: search for videos to start watching.</p>
          </div>
        )
        : <VideoGrid videos={data?.home.items ?? []} fetching={fetching && !data} />}
    </main>
  )
}

export default HomePage

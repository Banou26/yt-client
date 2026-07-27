import type { SearchResultsQuery } from '../generated/graphql'

import { css } from '@emotion/react'
import { useState } from 'preact/hooks'
import { useQuery } from 'urql'
import { Link, useSearch } from 'wouter'

import { useDocumentTitle } from '../app'
import { formatDuration, formatMeta } from '../components/format'
import { FeedSentinel, useInfiniteFeed } from '../components/use-infinite-feed'
import { watchHrefFor } from '../components/video-card'
import { gql } from '../generated'

type ResultsPage = SearchResultsQuery['search']

const SEARCH_RESULTS_QUERY = gql(`
  query SearchResults($query: String!, $cursor: String) {
    search(query: $query, cursor: $cursor) {
      items {
        id
        title
        description
        descriptionSnippet
        thumbnail
        durationSeconds
        viewCount
        publishedText
        isLive
        channel { id name avatar }
      }
      cursor
    }
  }
`)

const style = css`
  max-width: 109.6rem;
  padding: 2.4rem 1.6rem;

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  .status {
    color: var(--text-secondary);
  }

  .results {
    display: flex;
    flex-direction: column;
    gap: 1.6rem;
  }

  .result {
    display: flex;
    gap: 1.6rem;
  }

  .thumb {
    position: relative;
    flex: 1 1 50%;
    max-width: 50rem;
    min-width: 24rem;
    aspect-ratio: 16 / 9;
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

  .badge {
    position: absolute;
    right: 0.6rem;
    bottom: 0.6rem;
    padding: 0.1rem 0.4rem;
    border-radius: 0.4rem;
    background: var(--bg-badge);
    color: var(--text-on-media);
    font-size: 1.2rem;
    font-weight: 500;
    line-height: 1.8rem;
  }

  .badge.live {
    background: var(--brand);
    text-transform: uppercase;
  }

  .info {
    flex: 1 1 50%;
    min-width: 0;
  }

  .title {
    margin: 0 0 0.4rem;
    font-size: 1.8rem;
    font-weight: 400;
    line-height: 2.6rem;
    color: var(--text-primary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .meta {
    font-size: 1.2rem;
    color: var(--text-secondary);
  }

  .channel {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    width: fit-content;
    margin: 1.2rem 0;
    font-size: 1.2rem;
    color: var(--text-secondary);
    transition: color 0.15s ease;
  }

  .channel:hover {
    color: var(--text-primary);
  }

  .avatar {
    flex: none;
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 50%;
    overflow: hidden;
    background: var(--bg-chip);
  }

  .avatar img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar.fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .description {
    font-size: 1.2rem;
    color: var(--text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  @media (max-width: 600px) {
    .result {
      flex-direction: column;
    }

    .thumb {
      max-width: none;
      min-width: 0;
    }
  }
`

const SearchPage = () => {
  // URLSearchParams hands back an already-decoded value, so decoding it again
  // would corrupt any query containing a literal '%'.
  const query = new URLSearchParams(useSearch()).get('search_query') ?? ''
  useDocumentTitle(query.length > 0 ? query : 'Search')
  // Consumed pages carry the query they came from, so a new search starts from
  // an empty list in the same render rather than one frame later via an effect.
  const [loaded, setLoaded] = useState<{ query: string, pages: ResultsPage[] }>({ query, pages: [] })
  const pages = loaded.query === query ? loaded.pages : []
  const [{ data, error, fetching }] = useQuery({
    query: SEARCH_RESULTS_QUERY,
    variables: { query, cursor: pages[pages.length - 1]?.cursor },
    pause: query.length === 0
  })
  const page = data?.search
  // urql keeps the previous result while the next page is in flight, so the
  // live page can repeat one already consumed: useInfiniteFeed dedupes by id.
  const { items, cursor } = useInfiniteFeed({
    pages: page ? [...pages, page] : pages,
    key: video => video.id
  })

  const onMore = () => {
    if (!page?.cursor || fetching) return
    setLoaded({ query, pages: pages[pages.length - 1] === page ? pages : [...pages, page] })
  }

  return (
    <main css={style}>
      <h1 className='sr-only'>Results for {query}</h1>
      {error ? <p className='status'>{error.message}</p> : undefined}
      {fetching && items.length === 0 ? <p className='status'>Searching…</p> : undefined}
      <div className='results'>
        {items.map(video => {
          const watchHref = watchHrefFor(video.id)
          const duration = formatDuration(video.durationSeconds)
          const meta = formatMeta(video.viewCount, video.publishedText)
          const snippet = video.descriptionSnippet ?? video.description
          return (
            <article className='result' key={video.id}>
              <Link href={watchHref} className='thumb' tabIndex={-1} aria-hidden='true'>
                {video.thumbnail ? <img src={video.thumbnail} alt='' loading='lazy' /> : undefined}
                {video.isLive
                  ? <span className='badge live'>LIVE</span>
                  : duration ? <span className='badge'>{duration}</span> : undefined}
              </Link>
              <div className='info'>
                <h2 className='title'>
                  <Link href={watchHref}>{video.title}</Link>
                </h2>
                {meta ? <div className='meta'>{meta}</div> : undefined}
                {video.channel
                  ? (
                    <Link href={`/channel/${video.channel.id}`} className='channel'>
                      <span className={video.channel.avatar ? 'avatar' : 'avatar fallback'}>
                        {video.channel.avatar
                          ? <img src={video.channel.avatar} alt='' loading='lazy' />
                          : video.channel.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span>{video.channel.name}</span>
                    </Link>
                  )
                  : undefined}
                {snippet ? <p className='description'>{snippet}</p> : undefined}
              </div>
            </article>
          )
        })}
      </div>
      {query.length > 0 && !fetching && !error && items.length === 0
        ? <p className='status'>No results found.</p>
        : undefined}
      {fetching && items.length > 0 ? <p className='status'>Loading more…</p> : undefined}
      <FeedSentinel onVisible={onMore} disabled={fetching || !cursor} />
    </main>
  )
}

export default SearchPage

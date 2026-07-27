import { css } from '@emotion/react'
import { useQuery } from 'urql'
import { Link } from 'wouter'

import { formatDuration, formatMeta, safeDecode } from '../components/format'
import { gql } from '../generated'

const SEARCH_RESULTS_QUERY = gql(`
  query SearchResults($query: String!) {
    search(query: $query) {
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

const SearchPage = ({ params }: { params: { query: string } }) => {
  const query = safeDecode(params.query)
  const [{ data, error, fetching }] = useQuery({ query: SEARCH_RESULTS_QUERY, variables: { query } })
  return (
    <main css={style}>
      <h1 className='sr-only'>Results for {query}</h1>
      {error ? <p className='status'>{error.message}</p> : undefined}
      {fetching && !data ? <p className='status'>Searching…</p> : undefined}
      <div className='results'>
        {(data?.search.items ?? []).map(video => {
          const watchHref = `/watch/${video.id}`
          const duration = formatDuration(video.durationSeconds)
          const meta = formatMeta(video.viewCount, video.publishedText)
          const snippet = video.descriptionSnippet ?? video.description
          return (
            <article className='result' key={video.id}>
              <Link href={watchHref} className='thumb' tabIndex={-1} aria-hidden='true'>
                {video.thumbnail ? <img src={video.thumbnail} alt='' loading='lazy' /> : undefined}
                {duration ? <span className='badge'>{duration}</span> : undefined}
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
    </main>
  )
}

export default SearchPage

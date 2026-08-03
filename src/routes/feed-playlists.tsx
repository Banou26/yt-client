import type { LibraryPlaylistsQuery } from '../generated/graphql'

import { css } from '@emotion/react'
import { CircleUserRound, Clock, ThumbsUp } from 'lucide-react'
import { useState } from 'preact/hooks'
import { useQuery } from 'urql'
import { useLocation } from 'wouter'

import { useDocumentTitle } from '../app'
import { readable } from '../components/format'
import { LIKED_VIDEOS_ID, WATCH_LATER_ID } from '../components/playlist'
import { PlaylistCard } from '../components/playlist-card'
import { FeedSentinel, useInfiniteFeed } from '../components/use-infinite-feed'
import { gql } from '../generated'
import { useSession } from '../session'

// no `updatedText` and no `privacy`: this feed cannot fill them, and Playlist is keyed by id in graphcache, so the nulls would overwrite what a /playlist read had stored
const LIBRARY_PLAYLISTS_QUERY = gql(`
  query LibraryPlaylists($cursor: String) {
    playlists(cursor: $cursor) {
      items {
        id
        title
        thumbnail
        videoCountText
        channel { id name }
      }
      cursor
    }
  }
`)

type LibraryPage = LibraryPlaylistsQuery['playlists']
type LibraryPlaylist = LibraryPage['items'][number]

const PINNED = [
  { id: WATCH_LATER_ID, title: 'Watch later', Icon: Clock },
  { id: LIKED_VIDEOS_ID, title: 'Liked videos', Icon: ThumbsUp }
]

const FIRST_PAGE_SKELETONS = 12
const NEXT_PAGE_SKELETONS = 4

const style = css`
  padding: 2.4rem 1.6rem;

  .heading {
    margin: 0 0 2.4rem;
    font-size: 2rem;
    font-weight: 700;
    line-height: 2.8rem;
    color: var(--text-primary);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(25.6rem, 1fr));
    column-gap: 1.6rem;
    row-gap: 2.4rem;
  }

  .card {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .cover {
    position: relative;
    aspect-ratio: 16 / 9;
    border-radius: 1.2rem;
    overflow: hidden;
    background: var(--bg-elevated);
  }

  .cover img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .cover-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--text-tertiary);
  }

  .count {
    position: absolute;
    right: 0.6rem;
    bottom: 0.6rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.1rem 0.4rem;
    border-radius: 0.4rem;
    background: var(--bg-badge);
    color: var(--text-on-media);
    font-size: 1.2rem;
    font-weight: 500;
    line-height: 1.8rem;
  }

  .card-title {
    margin: 1.2rem 0 0;
    font-size: 1.6rem;
    font-weight: 500;
    line-height: 2.2rem;
    color: var(--text-primary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .card-meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.4rem;
    font-size: 1.4rem;
    color: var(--text-secondary);
  }

  .card-meta svg {
    flex: none;
  }

  .card:hover .card-meta {
    color: var(--text-primary);
  }

  .notice {
    padding: 2.4rem 0;
    font-size: 1.4rem;
    color: var(--text-secondary);
    text-align: center;
  }

  .prompt {
    max-width: 56rem;
    margin: 4.8rem auto 0;
    padding: 2.4rem;
    border-radius: 1.2rem;
    background: var(--bg-subtle);
    text-align: center;
  }

  .prompt h2 {
    margin: 0 0 0.8rem;
    font-size: 2rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .prompt p {
    margin: 0;
    font-size: 1.4rem;
    color: var(--text-secondary);
  }

  .sign-in {
    display: inline-flex;
    align-items: center;
    gap: 0.8rem;
    height: 3.6rem;
    margin-top: 1.6rem;
    padding: 0 1.5rem;
    border: 1px solid var(--border-strong);
    border-radius: 1.8rem;
    background: transparent;
    color: var(--accent);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .sign-in:hover {
    background: var(--accent-hover);
    border-color: transparent;
  }

  @media (max-width: 500px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
`

const cardSkeletonStyle = css`
  min-width: 0;
  animation: playlist-card-pulse 1.6s ease-in-out infinite;

  .cover {
    aspect-ratio: 16 / 9;
    border-radius: 1.2rem;
    background: var(--bg-elevated);
  }

  .bar {
    height: 1.6rem;
    border-radius: 0.4rem;
    background: var(--bg-elevated);
    margin-top: 1.2rem;
  }

  .bar.short {
    width: 60%;
    margin-top: 0.8rem;
  }

  @keyframes playlist-card-pulse {
    0%,
    100% {
      opacity: 1;
    }

    50% {
      opacity: 0.55;
    }
  }
`

const PlaylistCardSkeleton = () => (
  <div css={cardSkeletonStyle} aria-hidden='true'>
    <div className='cover' />
    <div className='bar' />
    <div className='bar short' />
  </div>
)

const PlaylistsFeedPage = () => {
  useDocumentTitle('Playlists')
  const [, navigate] = useLocation()
  const { ready, signedIn } = useSession()
  const [loaded, setLoaded] = useState<LibraryPage[]>([])
  const [{ data, error, fetching }] = useQuery({
    query: LIBRARY_PLAYLISTS_QUERY,
    variables: { cursor: loaded[loaded.length - 1]?.cursor },
    pause: !ready || !signedIn
  })

  const page = data?.playlists
  const { items, cursor } = useInfiniteFeed({
    pages: page ? [...loaded, page] : loaded,
    // annotated rather than inferred: an unannotated parameter lands on unknown here instead of tripping noImplicitAny
    key: (playlist: LibraryPlaylist) => playlist.id
  })
  const playlists = items.filter(playlist => !PINNED.some(pinned => pinned.id === playlist.id))

  const onMore = () => {
    if (!page?.cursor || fetching || error) return
    setLoaded(previous => previous[previous.length - 1] === page ? previous : [...previous, page])
  }

  if (!ready) {
    return (
      <main css={style}>
        <h1 className='heading'>Playlists</h1>
        <div className='grid'>
          {Array.from({ length: FIRST_PAGE_SKELETONS }, (_, index) => <PlaylistCardSkeleton key={index} />)}
        </div>
      </main>
    )
  }

  if (!signedIn) {
    return (
      <main css={style}>
        <h1 className='heading'>Playlists</h1>
        <div className='prompt'>
          <h2>Sign in to see your playlists</h2>
          <p>Playlists belong to your account, so sign in to open them and save videos to them here.</p>
          <button type='button' className='sign-in' onClick={() => navigate('/signin')}>
            <CircleUserRound size={24} strokeWidth={1.5} />
            Sign in
          </button>
        </div>
      </main>
    )
  }

  return (
    <main css={style}>
      <h1 className='heading'>Playlists</h1>
      {error && playlists.length === 0 ? <p className='notice'>{readable(error.message)}</p> : undefined}
      {/* the two pinned cards are known ids rather than results, so no fetch state can remove them */}
      <div className='grid'>
        {PINNED.map(pinned => (
          <PlaylistCard key={pinned.id} id={pinned.id} title={pinned.title} fallbackIcon={pinned.Icon} />
        ))}
        {playlists.map(playlist => (
          <PlaylistCard
            key={playlist.id}
            id={playlist.id}
            title={playlist.title}
            thumbnail={playlist.thumbnail}
            videoCountText={playlist.videoCountText}
            channelName={playlist.channel?.name}
          />
        ))}
        {fetching
          ? Array.from(
            { length: playlists.length === 0 ? FIRST_PAGE_SKELETONS : NEXT_PAGE_SKELETONS },
            (_, index) => <PlaylistCardSkeleton key={`skeleton-${index}`} />,
          )
          : undefined}
      </div>
      {data && !fetching && !error && playlists.length === 0
        ? (
          <div className='prompt'>
            <h2>No playlists yet</h2>
            <p>Save a video from its Save button and the playlist you put it in collects here.</p>
          </div>
        )
        : undefined}
      {error && playlists.length > 0 ? <p className='notice'>Could not load more playlists.</p> : undefined}
      {fetching && playlists.length > 0 ? <p className='notice'>Loading more…</p> : undefined}
      <FeedSentinel onVisible={onMore} disabled={fetching || Boolean(error) || !cursor} />
    </main>
  )
}

export default PlaylistsFeedPage

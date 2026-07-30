import type { PlaylistViewQuery } from '../generated/graphql'

import { css } from '@emotion/react'
import { CircleUserRound, EllipsisVertical, ListVideo, Play, Share2, Shuffle, X } from 'lucide-react'
import { useState } from 'preact/hooks'
import { useMutation, useQuery } from 'urql'
import { Link, useLocation, useSearch } from 'wouter'

import { useDocumentTitle } from '../app'
import { readable } from '../components/format'
import { LIKED_VIDEOS_ID, playlistHrefFor, WATCH_LATER_ID } from '../components/playlist'
import { setQueueShuffle } from '../components/playlist-panel'
import { useSession } from '../session'
import { Menu, MenuItem } from '../components/ui/menu'
import { showToast } from '../components/ui/toast'
import { FeedSentinel, useInfiniteFeed } from '../components/use-infinite-feed'
import { watchHrefFor } from '../components/video-card'
import { VideoCardCompact, VideoCardCompactSkeleton } from '../components/video-card-compact'
import { gql } from '../generated'

const PLAYLIST_VIEW_QUERY = gql(`
  query PlaylistView($id: ID!, $cursor: String) {
    playlist(id: $id, cursor: $cursor) {
      playlist {
        id
        title
        description
        thumbnail
        videoCountText
        viewCountText
        updatedText
        privacy
        isEditable
        channel { id name avatar }
      }
      items {
        setVideoId
        index
        video {
          id
          title
          thumbnail
          thumbnailSrcset
          durationSeconds
          viewCount
          publishedText
          isLive
          channel { id name }
        }
      }
      cursor
    }
  }
`)

// Only identity is selected back. The write cannot recompute a localized count,
// so asking for `videoCountText` here would write the pre-write string over the
// cached one: see the Mutation comment in src/worker/schema.gql.
const REMOVE_FROM_PLAYLIST = gql(`
  mutation RemoveFromPlaylist($playlistId: ID!, $setVideoIds: [ID!]!) {
    removeFromPlaylist(playlistId: $playlistId, setVideoIds: $setVideoIds) {
      id
    }
  }
`)

type PlaylistViewPage = PlaylistViewQuery['playlist']
type PlaylistItemData = PlaylistViewPage['items'][number]

const SKELETON_ROWS = 8

// A playlist can hold the same video twice, each occurrence its own slot with
// its own setVideoId, so the dedupe key addresses the SLOT. Keying on the video
// id would merge the two copies onto one row.
const keyOf = (item: PlaylistItemData) => item.setVideoId ?? `${item.index ?? ''}:${item.video.id}`

const style = css`
  padding: 2.4rem 1.6rem;

  .layout {
    display: grid;
    grid-template-columns: 36rem minmax(0, 1fr);
    gap: 2.4rem;
    /* Without this the side column stretches to the height of the whole list
       and its sticky offset never has any room to take effect. */
    align-items: start;
  }

  .side {
    position: sticky;
    /* Under the fixed header rather than at the viewport top. */
    top: calc(var(--header-height) + 2.4rem);
    padding: 2.4rem;
    border-radius: 1.2rem;
    background: var(--bg-subtle);
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

  .heading {
    margin: 1.6rem 0 0;
    font-size: 2.4rem;
    font-weight: 700;
    line-height: 3rem;
    color: var(--text-primary);
  }

  .owner {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    width: fit-content;
    margin-top: 1.2rem;
    font-size: 1.4rem;
    font-weight: 500;
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
  }

  .stats {
    margin-top: 0.4rem;
    font-size: 1.2rem;
    color: var(--text-secondary);
  }

  .description {
    margin: 1.2rem 0 0;
    font-size: 1.2rem;
    line-height: 1.8rem;
    color: var(--text-secondary);
    white-space: pre-wrap;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    margin-top: 1.6rem;
  }

  .pill {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    height: 3.6rem;
    padding: 0 1.6rem;
    border: none;
    border-radius: 1.8rem;
    background: var(--bg-inverse);
    color: var(--text-inverse);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .pill:hover {
    background: var(--bg-inverse-hover);
  }

  .pill.secondary {
    background: var(--bg-chip);
    color: var(--text-primary);
  }

  .pill.secondary:hover {
    background: var(--bg-chip-hover);
  }

  .round {
    flex: none;
    width: 3.6rem;
    height: 3.6rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .round:hover {
    background: var(--bg-hover);
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.4rem;
    border-radius: 0.8rem;
    transition: background 0.15s ease;
  }

  .row:hover {
    background: var(--bg-hover);
  }

  .row.playing {
    background: var(--bg-selected);
  }

  .number {
    flex: none;
    width: 2.4rem;
    text-align: center;
    font-size: 1.2rem;
    color: var(--text-tertiary);
  }

  .card {
    flex: 1;
    min-width: 0;
  }

  .remove {
    flex: none;
    width: 2.4rem;
    height: 2.4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    opacity: 0;
    transition: background 0.15s ease, opacity 0.15s ease;
  }

  .row:hover .remove,
  .remove:focus-visible {
    opacity: 1;
  }

  .remove:hover {
    background: var(--bg-hover);
  }

  .remove:disabled {
    cursor: default;
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

  @media (max-width: 1000px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .side {
      position: static;
    }
  }
`

// /playlist carries the playlist in the query string, matching youtube.com, so
// a pasted link works. wouter's useSearch keeps the leading '?', which
// URLSearchParams accepts. The route has NO path params, and reading one would
// yield undefined silently: wouter checks the component prop bivariantly, so
// the compiler would not object.
const PlaylistPage = () => {
  const params = new URLSearchParams(useSearch())
  const listId = params.get('list') ?? ''
  const indexParam = params.get('index')
  // 1-based, the way youtube.com writes it and the way PlaylistItem.index comes
  // back. Anything that is not a plain number marks no row rather than row NaN.
  const activeIndex = indexParam !== null && /^\d+$/.test(indexParam) ? Number(indexParam) : undefined
  const [, navigate] = useLocation()
  // Consumed pages carry the playlist they came from, so opening another list
  // starts from an empty list in the same render rather than one frame later.
  const [loaded, setLoaded] = useState<{ id: string, pages: PlaylistViewPage[] }>({ id: listId, pages: [] })
  const pages = loaded.id === listId ? loaded.pages : []
  // Watch later and Liked videos are the two ids that are account-scoped rather
  // than public, and the guide links both of them on every page, signed in or
  // not. Browsing one anonymously comes back as an upstream ERROR alert that
  // youtubei.js throws on, and errors are unmasked, so the raw sentence would
  // render under a bare 'Playlist' heading with no way to act on it.
  const accountScoped = listId === WATCH_LATER_ID || listId === LIKED_VIDEOS_ID
  const { ready, signedIn } = useSession()
  const signedOutOfOwnList = accountScoped && ready && !signedIn
  const [{ data, error, fetching }] = useQuery({
    query: PLAYLIST_VIEW_QUERY,
    variables: { id: listId, cursor: pages[pages.length - 1]?.cursor },
    // Any other id is a public playlist and opens signed out.
    pause: listId.length === 0 || (accountScoped && (!ready || !signedIn))
  })
  const [, removeFromPlaylist] = useMutation(REMOVE_FROM_PLAYLIST)
  // The write answers with the playlist id alone, and the page it edited is
  // whichever cursor happened to be live, so the row leaves the list from here.
  const [removed, setRemoved] = useState<Set<string>>(() => new Set())
  const [removing, setRemoving] = useState<string[]>([])

  const page = data?.playlist
  // urql keeps the previous result while the next page is in flight, so the
  // live page can repeat one already consumed: useInfiniteFeed dedupes by slot.
  const { items, cursor } = useInfiniteFeed({
    pages: page ? [...pages, page] : pages,
    key: keyOf
  })
  // Identical on every page (a continuation carries no header, so the source
  // replays the first one), which is why it can be read off whichever page is
  // in hand rather than held separately.
  const playlist = page?.playlist
  useDocumentTitle(playlist?.title ?? 'Playlist')

  const rows = items.filter(item => !item.setVideoId || !removed.has(item.setVideoId))
  const first = rows[0]

  const onMore = () => {
    if (!page?.cursor || fetching || error) return
    setLoaded({ id: listId, pages: pages[pages.length - 1] === page ? pages : [...pages, page] })
  }

  const onRemove = (setVideoId: string) => {
    if (removing.includes(setVideoId)) return
    setRemoving(previous => [...previous, setVideoId])
    void removeFromPlaylist({ playlistId: listId, setVideoIds: [setVideoId] }).then((result) => {
      setRemoving(previous => previous.filter(value => value !== setVideoId))
      if (result.error) {
        showToast(readable(result.error.message))
        return
      }
      setRemoved(previous => new Set(previous).add(setVideoId))
      showToast('Removed from playlist')
    })
  }

  const onShare = () => {
    const clipboard = navigator.clipboard
    // writeText rejects on a denied permission as well as on a non-secure
    // context, and a silent failure is indistinguishable from a copy.
    if (!clipboard) {
      showToast('Could not copy the link')
      return
    }
    void clipboard.writeText(`${location.origin}${playlistHrefFor(listId)}`).then(
      () => showToast('Link copied to clipboard'),
      () => showToast('Could not copy the link'),
    )
  }

  // Only the rows already paged in are shuffled: the full order is not on the
  // client, and the queue endpoint offers no "start me somewhere random". The
  // random entry point is half the control; the other half is the queue landing
  // in shuffle mode, which lives in the panel's module state because every
  // queue navigation unmounts it.
  const onShuffle = () => {
    const pick = rows[Math.floor(Math.random() * rows.length)]
    if (!pick) return
    setQueueShuffle(true)
    navigate(watchHrefFor(pick.video.id, { list: listId, index: pick.index ?? undefined }))
  }

  if (listId.length === 0) {
    return (
      <main css={style}>
        <div className='prompt'>
          <h2>No playlist selected</h2>
          <p>A playlist link carries its id in the address, as /playlist?list=…</p>
        </div>
      </main>
    )
  }

  if (signedOutOfOwnList) {
    const label = listId === WATCH_LATER_ID ? 'Watch later' : 'Liked videos'
    return (
      <main css={style}>
        <div className='prompt'>
          <h2>Sign in to see {label}</h2>
          <p>{label} belongs to your account, so it only opens once you are signed in.</p>
          <button type='button' className='sign-in' onClick={() => navigate('/signin')}>
            <CircleUserRound size={24} strokeWidth={1.5} />
            Sign in
          </button>
        </div>
      </main>
    )
  }

  const stats = [playlist?.videoCountText, playlist?.viewCountText, playlist?.updatedText]
    .filter(part => part !== undefined && part !== null && part !== '')
    .join(' • ')

  return (
    <main css={style}>
      <div className='layout'>
        <aside className='side'>
          <div className='cover'>
            {playlist?.thumbnail
              ? <img src={playlist.thumbnail} alt='' />
              : (
                <span className='cover-fallback'>
                  <ListVideo size={48} strokeWidth={1.5} />
                </span>
              )}
          </div>
          <h1 className='heading'>{playlist?.title ?? 'Playlist'}</h1>
          {playlist?.channel
            ? (
              <Link href={`/channel/${playlist.channel.id}`} className='owner'>
                <span className={playlist.channel.avatar ? 'avatar' : 'avatar fallback'}>
                  {playlist.channel.avatar
                    ? <img src={playlist.channel.avatar} alt='' loading='lazy' />
                    : playlist.channel.name.slice(0, 1).toUpperCase()}
                </span>
                <span>{playlist.channel.name}</span>
              </Link>
            )
            : undefined}
          {stats ? <div className='stats'>{stats}</div> : undefined}
          {playlist?.description ? <p className='description'>{playlist.description}</p> : undefined}
          <div className='actions'>
            {first
              ? (
                <Link
                  href={watchHrefFor(first.video.id, { list: listId, index: first.index ?? undefined })}
                  className='pill'
                >
                  <Play size={20} strokeWidth={1.5} fill='currentColor' />
                  Play all
                </Link>
              )
              : undefined}
            {rows.length > 1
              ? (
                <button type='button' className='pill secondary' onClick={onShuffle}>
                  <Shuffle size={20} strokeWidth={1.5} />
                  Shuffle
                </button>
              )
              : undefined}
            <Menu
              label='Playlist actions'
              align='start'
              trigger={
                <button type='button' className='round' aria-label='More actions'>
                  <EllipsisVertical size={20} strokeWidth={1.5} />
                </button>
              }
            >
              <MenuItem icon={Share2} label='Share' onSelect={onShare} />
              {/* No rename, privacy or delete rows. Every one of those is a
                  write this page has no dialog for, and privacy in particular
                  only applies reliably at creation: see setPlaylistPrivacy in
                  src/worker/schema.gql. */}
            </Menu>
          </div>
        </aside>
        <div>
          {error && rows.length === 0 ? <p className='notice'>{readable(error.message)}</p> : undefined}
          <div className='rows'>
            {rows.map((item, position) => {
              // Two different numbers on purpose. The one on screen counts the
              // rows actually rendered, so a local removal never leaves a gap
              // in the column. The one in the href is upstream's slot, which is
              // what ?index= addresses, and it keeps pointing at the right
              // queue position after the visible numbering has shifted.
              const queueIndex = item.index ?? position + 1
              const setVideoId = item.setVideoId
              return (
                <div
                  className={queueIndex === activeIndex ? 'row playing' : 'row'}
                  key={keyOf(item)}
                  aria-current={queueIndex === activeIndex ? 'true' : undefined}
                >
                  <span className='number' aria-hidden='true'>{position + 1}</span>
                  <div className='card'>
                    {/* The shared card carries the row's own overflow menu
                        (save, share) and the queue-aware href, so the playlist
                        adds only what is specific to it: the position and the
                        one action the card cannot know about. */}
                    <VideoCardCompact video={item.video} context={{ list: listId, index: queueIndex }} />
                  </div>
                  {playlist?.isEditable === true && setVideoId
                    ? (
                      <button
                        type='button'
                        className='remove'
                        aria-label={`Remove ${item.video.title} from this playlist`}
                        disabled={removing.includes(setVideoId)}
                        onClick={() => onRemove(setVideoId)}
                      >
                        <X size={16} strokeWidth={1.5} />
                      </button>
                    )
                    : undefined}
                </div>
              )
            })}
            {fetching && rows.length === 0
              ? Array.from({ length: SKELETON_ROWS }, (_, index) => <VideoCardCompactSkeleton key={index} />)
              : undefined}
          </div>
          {data && !fetching && !error && rows.length === 0
            ? (
              <div className='prompt'>
                <h2>Nothing in this playlist</h2>
                <p>Videos saved to it collect here.</p>
              </div>
            )
            : undefined}
          {error && rows.length > 0 ? <p className='notice'>Could not load more of this playlist.</p> : undefined}
          {fetching && rows.length > 0 ? <p className='notice'>Loading more…</p> : undefined}
          <FeedSentinel onVisible={onMore} disabled={fetching || Boolean(error) || !cursor} />
        </div>
      </div>
    </main>
  )
}

export default PlaylistPage

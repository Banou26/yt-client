import type { PlaylistPanelData } from '../components/playlist-panel'
import type { RelatedVideosQuery } from '../generated/graphql'

import type { VideoCardData } from '../components/video-card'

import { css } from '@emotion/react'
import { EllipsisVertical, Link2, Share2, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { useMutation, useQuery } from 'urql'
import { Link, useLocation, useSearch } from 'wouter'

import { useDocumentTitle } from '../app'
import Comments from '../components/comments'
import DescriptionBox from '../components/description-box'
import { parseStartSeconds, readable } from '../components/format'
import LiveChat from '../components/live-chat'
import PlaylistPanel from '../components/playlist-panel'
import SaveMenu from '../components/save-menu'
import ShareDialog from '../components/share-dialog'
import SubscribeButton from '../components/subscribe-button'
import { FeedSentinel } from '../components/use-infinite-feed'
import { VideoCardCompact, VideoCardCompactSkeleton } from '../components/video-card-compact'
import { gql } from '../generated'
import { prefetchPlayback } from '../player/prefetch'
import { claimPlayer, closePlayer, openPlayer, setTheater as setPlayerTheater, usePlayerSession } from '../player/session'
import { Menu, MenuItem } from '../components/ui/menu'
import { showToast } from '../components/ui/toast'
import { getSettings, updateSettings } from '../settings'

const RATE_VIDEO = gql(`
  mutation RateVideo($id: ID!, $status: LikeStatus!) {
    rateVideo(id: $id, status: $status) {
      id
      likeStatus
    }
  }
`)

// one /next round trip serves the whole page (title included). The /player
// data rides in with the playback path already, so no video(id) query here.
// The queue rides in on that same call: passing `playlistId` is what makes
// upstream return the playlist panel, so there is no second round trip for it.
const WATCH_META_QUERY = gql(`
  query WatchMeta($id: ID!, $playlistId: ID, $playlistIndex: Int) {
    watch(id: $id, playlistId: $playlistId, playlistIndex: $playlistIndex) {
      id
      isLive
      concurrentViewers
      title
      viewCountText
      publishedDateText
      likeCountText
      commentCountText
      description
      descriptionRuns { text url videoId startSeconds browseId }
      likeStatus
      channel { id name avatar handle subscriberCountText isSubscribed notificationLevel }
      relatedCursor
      related {
        id
        title
        thumbnail
        durationSeconds
        viewCount
        publishedText
        isLive
        channel { id name }
      }
      playlist {
        id
        title
        author
        currentIndex
        isInfinite
        items {
          id
          title
          thumbnail
          durationSeconds
        }
      }
    }
  }
`)

/* Grid rather than flex so theater mode is a placement change: the player keeps
   its DOM position and only spans differently. */
const style = css`
  display: grid;
  grid-template-columns: minmax(0, 128rem) 40.2rem;
  /* The sidebar spans BOTH rows, and an auto-sized row absorbs a share of a
     spanning item that is taller than its own content. So a long sidebar
     inflated row 1 and pushed the title and description far below the player:
     measured at 590px below it with 40 related videos, and 1610px once paging
     had loaded more.

     min-content pins row 1 to the player it actually holds, and the FLEXIBLE
     second row is what makes it stick: a spanning item's excess height is
     shared out across intrinsic rows, so a min-content plus auto pair still
     inflated row 1 (measured: a 2007px gap). A flexible track absorbs that
     excess instead. */
  grid-template-rows: min-content 1fr;
  align-items: start;
  gap: 0 2.4rem;
  padding: 2.4rem;

  .stage {
    grid-column: 1;
  }

  /* Reserves the player's box. The player is moved in as a child rather than
     rendered here, so without a size of its own this slot would collapse and
     the page would jump as the video arrives. */
  .player-slot,
  .player-slot > .player-host {
    display: block;
    width: 100%;
  }

  .primary {
    grid-column: 1;
    min-width: 0;
  }

  .secondary {
    grid-column: 2;
    grid-row: 1 / span 2;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }

  &.theater {
    padding: 0 0 2.4rem;
  }

  &.theater .stage {
    grid-column: 1 / -1;
    background: #000;
  }

  /* Keeps a tall window from pushing the title below the fold. Excluded in
     fullscreen: this selector out-specifies the player's own :fullscreen rule,
     so without :not() it would cap the height of a fullscreened player and
     letterbox it inside a correctly sized container.

     Matched on the player's own attribute rather than on a direct child: the
     player is moved in through a slot and a host node now, so it is two levels
     down and a child-combinator selector silently stops matching. */
  &.theater .stage [data-player-root]:not(:fullscreen) {
    max-height: calc(100vh - var(--header-height) - 8rem);
    border-radius: 0;
  }

  &.theater .primary {
    padding: 2.4rem 0 0 2.4rem;
  }

  &.theater .secondary {
    grid-row: 2;
    padding: 2.4rem 2.4rem 0 0;
  }

  .title {
    margin: 1.2rem 0 0;
    font-size: 2rem;
    font-weight: 700;
    line-height: 2.8rem;
    color: var(--text-primary);
  }

  .owner-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 1.2rem;
    margin-top: 1.2rem;
  }

  .avatar {
    flex: none;
    width: 4rem;
    height: 4rem;
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
    color: var(--text-primary);
    font-size: 1.6rem;
    font-weight: 500;
  }

  .owner-text {
    min-width: 0;
    margin-right: 1.2rem;
  }

  .channel-name {
    display: block;
    width: fit-content;
    font-size: 1.6rem;
    font-weight: 500;
    line-height: 2.2rem;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sub-count {
    font-size: 1.2rem;
    color: var(--text-secondary);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    margin-left: auto;
  }

  .like-pill {
    display: flex;
    align-items: stretch;
    height: 3.6rem;
    border-radius: 1.8rem;
    background: var(--bg-chip);
    overflow: hidden;
  }

  .like,
  .dislike {
    display: flex;
    align-items: center;
    border: none;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .like {
    gap: 0.8rem;
    padding: 0 1.2rem 0 1.6rem;
    border-right: 1px solid var(--border-subtle);
    font-size: 1.4rem;
    font-weight: 500;
  }

  .dislike {
    padding: 0 1.6rem;
  }

  .like:hover,
  .dislike:hover {
    background: var(--bg-chip-hover);
  }

  .pill {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    height: 3.6rem;
    padding: 0 1.6rem;
    border: none;
    border-radius: 1.8rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .pill:hover {
    background: var(--bg-chip-hover);
  }

  .round {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3.6rem;
    height: 3.6rem;
    border: none;
    border-radius: 50%;
    background: var(--bg-chip);
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .round:hover {
    background: var(--bg-chip-hover);
  }

  .error {
    margin-top: 1.2rem;
    color: var(--text-secondary);
  }

  @media (max-width: 1017px) {
    grid-template-columns: minmax(0, 1fr);

    .stage,
    .primary,
    .secondary,
    &.theater .stage,
    &.theater .primary,
    &.theater .secondary {
      grid-column: 1;
      grid-row: auto;
    }

    .secondary {
      margin-top: 2.4rem;
    }

    &.theater .primary,
    &.theater .secondary {
      padding: 2.4rem 1.2rem 0;
    }
  }

  @media (max-width: 768px) {
    padding: 1.2rem;
  }
`

const RELATED_MORE_QUERY = gql(`
  query RelatedVideos($cursor: String!) {
    relatedVideos(cursor: $cursor) {
      items {
        id
        title
        thumbnail
        durationSeconds
        viewCount
        publishedText
        isLive
        channel { id name }
      }
      cursor
    }
  }
`)

type RelatedPage = RelatedVideosQuery['relatedVideos']

const RELATED_SKELETON_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

// /watch carries the id in the query string, matching youtube.com, so a pasted
// link works. wouter's useSearch keeps the leading '?', which URLSearchParams
// accepts. Nothing here is a path param any more, and reading one would yield
// undefined silently: wouter checks the component prop bivariantly, so the
// compiler would not object.
const WatchPage = () => {
  const params = new URLSearchParams(useSearch())
  const videoId = params.get('v') ?? ''
  prefetchPlayback(videoId)
  // The queue context, exactly as youtube.com spells it. `list` is the playlist
  // id; `index` is 1-BASED there (index=1 is the first entry) while the schema
  // takes a 0-based `playlistIndex`, so it is shifted here. Anything that is not
  // a whole position is dropped rather than forwarded: upstream clamps an
  // out-of-range index, but a NaN would serialize as null and lose a position
  // that the URL actually carried.
  const listId = params.get('list') ?? undefined
  // A shared link can carry a start offset. app.tsx deliberately keeps `t` out
  // of the route identity, so changing it does NOT remount the player: this is
  // the position a FRESH load of the page starts at.
  const startAt = parseStartSeconds(params.get('t'))
  const indexParam = Number(params.get('index'))
  const playlistIndex = Number.isInteger(indexParam) && indexParam > 0 ? indexParam - 1 : undefined
  const [{ data: watchData, error: watchError, fetching: watchFetching }] = useQuery({
    query: WATCH_META_QUERY,
    // Both are undefined without a `list`, which the resolver reads as "no
    // queue" and graphcache leaves out of the field key entirely, so a plain
    // watch URL resolves to the same field it did before the queue existed.
    variables: { id: videoId, playlistId: listId, playlistIndex },
    // WatchMeta is keyed by video id and WatchPlaylist is embedded in it, so
    // every argument set for one video shares a single `playlist` slot: a plain
    // ?v= read writes null over it, and a read from another queue writes that
    // queue's panel. Under cache-first the stale slot would be served straight
    // back. Revalidating keeps the cached render instant while making the panel
    // converge on the queue the URL actually asked for.
    requestPolicy: 'cache-and-network',
    pause: videoId === ''
  })
  const [, navigate] = useLocation()
  const [rateState, rateVideo] = useMutation(RATE_VIDEO)
  /* Theater belongs to the player, and the player now lives above the router,
     so the persisted preference is pushed into the session rather than held
     here. Reading it here as well keeps the layout in step: `.theater` is a
     class on this page's grid, not on the player. */
  const playerSession = usePlayerSession()
  const theater = playerSession.theater
  const toggleTheater = useCallback(() => {
    setPlayerTheater(updateSettings({ theater: !getSettings().theater }).theater)
  }, [])

  // A new video means a new sidebar: its pages and its cursor both belong to
  // the video that produced them.
  useEffect(() => {
    setRelatedPages([])
    setWantMoreRelated(false)
  }, [videoId])
  // The share sheet closes when the video changes: it is about the video it was
  // opened over, and leaving it up would copy a link to a different one.
  useEffect(() => setSharing(false), [videoId])

  const watch = watchData?.watch
  useDocumentTitle(watch?.title ?? undefined)
  const channel = watch?.channel

  /* Opening is deliberately NOT gated on the watch query. Playback starts from
     the id alone, and waiting for /next would add a tunneled round trip to
     every first frame. The title arrives later and is folded in then, because
     the dock needs it once this page unmounts.

     Liveness also arrives with that query, so a live video does get opened for
     the moment before it resolves. It is closed here rather than left to fail:
     the player treats the live refusal as terminal, so nothing retries in the
     meantime. */
  useEffect(() => {
    if (videoId === '') return
    openPlayer({ videoId, startAt, title: watch?.title ?? undefined })
  }, [videoId, startAt, watch?.title, watch?.isLive])
  // Annotated rather than inferred so the two selections above are checked
  // against the contracts the components actually publish, which is the only
  // place that mismatch can be caught: a field dropped from the document would
  // otherwise surface as an undefined at runtime.
  /* The sidebar pages from its own cursor rather than the watch query, so
     loading more never re-runs /next: that call also drives the player's page
     data, and re-executing it would restart the whole watch. */
  const [wantMoreRelated, setWantMoreRelated] = useState(false)
  const [relatedPages, setRelatedPages] = useState<RelatedPage[]>([])
  const relatedCursor = relatedPages[relatedPages.length - 1]?.cursor ?? watch?.relatedCursor
  const [{ data: moreData, fetching: moreFetching }] = useQuery({
    query: RELATED_MORE_QUERY,
    variables: { cursor: relatedCursor ?? '' },
    pause: !wantMoreRelated || !relatedCursor,
  })
  const morePage = moreData?.relatedVideos
  const related: VideoCardData[] | undefined = watch?.related
    ? [...watch.related, ...relatedPages.flatMap(entry => entry.items)]
      .filter((video, index, all) => all.findIndex(other => other.id === video.id) === index)
    : undefined
  /* Gated on the URL, not just on the response. WatchMeta is keyed by video id
     in graphcache and WatchPlaylist is embedded in it, so watching a video
     inside a queue writes the panel onto the same entity a plain ?v= read links
     to: without this the queue would reappear on a bare watch URL for any video
     already opened from a playlist. Requirement is that no-list renders exactly
     as before, and only the URL can answer whether a queue was asked for.
     Matched on id as well: that shared slot can still be holding another
     queue's panel from an earlier read of this same video, and rendering it
     would navigate the viewer into a playlist they never opened. */
  const playlist: PlaylistPanelData | undefined =
    listId === undefined || watch?.playlist?.id !== listId ? undefined : watch.playlist
  // The rating now comes back with the video rather than living in component
  // state, so it survives navigation and reflects what the account already did.
  const liked = watch?.likeStatus === 'LIKE'
  const disliked = watch?.likeStatus === 'DISLIKE'

  const rate = (status: 'LIKE' | 'DISLIKE') => {
    // Absent (rather than INDIFFERENT) is what a signed-out read looks like.
    if (!watch?.likeStatus) {
      navigate('/signin')
      return
    }
    const next = watch.likeStatus === status ? 'INDIFFERENT' : status
    void rateVideo({ id: videoId, status: next }).then((result) => {
      if (result.error) showToast(readable(result.error.message))
    })
  }

  // Replaces a bare clipboard write with a real sheet: the old control could
  // only copy the current URL, so sharing from a position or embedding was not
  // reachable at all.
  const [sharing, setSharing] = useState(false)

  return (
    <main css={style} className={theater ? 'theater' : undefined}>
      {/* The player stays in one place in the DOM across theater toggles: moving
          it to another parent would remount it and restart playback. Only the
          grid placement of .stage changes. */}
      <div className='stage'>
        {/* The player is NOT mounted here. It lives above the router, and this
            slot only says where to show it, so leaving the page moves it to the
            miniplayer dock instead of destroying its SABR session. */}
        <div className='player-slot' ref={claimPlayer} />
      </div>
      <div className='primary'>
        {watch?.title ? <h1 className='title'>{watch.title}</h1> : undefined}
        {watchError && !watch ? <p className='error'>{watchError.message}</p> : undefined}
        {channel
          ? (
            <div className='owner-row'>
              <Link
                href={`/channel/${channel.id}`}
                className={channel.avatar ? 'avatar' : 'avatar fallback'}
                aria-label={channel.name}
              >
                {channel.avatar
                  ? <img src={channel.avatar} alt='' loading='lazy' />
                  : channel.name.slice(0, 1).toUpperCase()}
              </Link>
              <div className='owner-text'>
                <Link href={`/channel/${channel.id}`} className='channel-name'>{channel.name}</Link>
                {channel.subscriberCountText
                  ? <div className='sub-count'>{channel.subscriberCountText}</div>
                  : undefined}
              </div>
              <SubscribeButton
                channelId={channel.id}
                subscribed={channel.isSubscribed}
                notificationLevel={channel.notificationLevel}
              />
              <div className='actions'>
                <div className='like-pill'>
                  <button
                    type='button'
                    className='like'
                    aria-label='Like'
                    aria-pressed={liked}
                    disabled={rateState.fetching}
                    onClick={() => rate('LIKE')}
                  >
                    <ThumbsUp size={20} strokeWidth={1.5} fill={liked ? 'currentColor' : 'none'} />
                    {watch?.likeCountText ? <span>{watch.likeCountText}</span> : undefined}
                  </button>
                  <button
                    type='button'
                    className='dislike'
                    aria-label='Dislike'
                    aria-pressed={disliked}
                    disabled={rateState.fetching}
                    onClick={() => rate('DISLIKE')}
                  >
                    <ThumbsDown size={20} strokeWidth={1.5} fill={disliked ? 'currentColor' : 'none'} />
                  </button>
                </div>
                <button type='button' className='pill' onClick={() => setSharing(true)}>
                  <Share2 size={20} strokeWidth={1.5} />
                  Share
                </button>
                {/* Save owns a trigger and a panel of its own, so it sits beside
                    Share rather than inside the More menu: menu.tsx finds its
                    rows with one DOM query rooted at the wrapper, so a menu
                    nested in a menu would hand the outer panel the inner
                    panel's rows to navigate. */}
                <SaveMenu videoId={videoId} />
                <Menu
                  label='More actions'
                  trigger={
                    <button type='button' className='round' aria-label='More actions'>
                      <EllipsisVertical size={20} strokeWidth={1.5} />
                    </button>
                  }
                >
                  {/* Only rows that do something. YouTube's own overflow menu
                      also offers Report, Transcript and Show clip; none of the
                      three has a mutation or a query behind it here, and a row
                      that opens nothing is worse than an absent one. */}
                  <MenuItem icon={Link2} label='Share' onSelect={() => setSharing(true)} />
                  {/* No icon: a checkable row draws the tick box in the icon
                      slot, so one passed here would never be rendered. */}
                  <MenuItem
                    label='Theater mode'
                    checked={theater}
                    // Checkable rows keep the panel up by default, which is
                    // right for ticking several playlists but wrong here: the
                    // change is behind the panel that would stay over it.
                    closeOnSelect
                    onSelect={toggleTheater}
                  />
                </Menu>
              </div>
            </div>
          )
          : undefined}
        {watch?.description || watch?.viewCountText || watch?.publishedDateText
          ? (
            <DescriptionBox
              key={`description:${videoId}`}
              viewCountText={watch.viewCountText}
              publishedDateText={watch.publishedDateText}
              description={watch.description}
              runs={watch.descriptionRuns}
              videoId={videoId}
            />
          )
          : undefined}
        {/* mount after the /next answer so the comments call never contends with startup */}
        {!watchFetching
          ? <Comments key={`comments:${videoId}`} videoId={videoId} commentCountText={watch?.commentCountText} />
          : undefined}
      </div>
      {/* `playlist` only widens this condition when the URL carried a list, so
          the no-queue page keeps rendering (and not rendering) the column on
          exactly the terms it did before. */}
      {watchFetching || playlist || watch?.isLive || (related && related.length > 0)
        ? (
          <aside className='secondary'>
            {playlist ? <PlaylistPanel playlist={playlist} /> : undefined}
            {/* Above the related rail, the way upstream places it, and keyed on
                the video so switching streams starts a new transcript rather
                than appending to the previous one. */}
            {watch?.isLive ? <LiveChat key={`chat:${videoId}`} videoId={videoId} /> : undefined}
            {related
              ? related.map(item => <VideoCardCompact key={item.id} video={item} />)
              : RELATED_SKELETON_KEYS.map(key => <VideoCardCompactSkeleton key={key} />)}
            {relatedCursor
              ? (
                <FeedSentinel
                  onVisible={() => {
                    if (!wantMoreRelated) setWantMoreRelated(true)
                    else if (morePage && !moreFetching) {
                      setRelatedPages(pages => pages[pages.length - 1] === morePage ? pages : [...pages, morePage])
                    }
                  }}
                  disabled={moreFetching}
                />
              )
              : undefined}
          </aside>
        )
        : undefined}
      {sharing ? <ShareDialog videoId={videoId} list={listId} onClose={() => setSharing(false)} /> : undefined}
    </main>
  )
}

export default WatchPage

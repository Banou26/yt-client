import type { PlaylistPanelData } from '../components/playlist-panel'
import type { RelatedVideosQuery } from '../generated/graphql'

import type { VideoCardData } from '../components/video-card'

import { css } from '@emotion/react'
import { EllipsisVertical, Link2, Share2, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useCallback, useEffect, useState } from 'preact/hooks'
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
import { claimPlayer, openPlayer, setTheater as setPlayerTheater, usePlayerSession } from '../player/session'
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
        thumbnailSrcset
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
          thumbnailSrcset
          durationSeconds
        }
      }
    }
  }
`)

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
        thumbnailSrcset
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

const WatchPage = () => {
  const params = new URLSearchParams(useSearch())
  const videoId = params.get('v') ?? ''
  prefetchPlayback(videoId)
  // `index` is 1-BASED in the URL, matching youtube.com, while the schema takes a 0-based `playlistIndex`
  const listId = params.get('list') ?? undefined
  // app.tsx keeps `t` out of the route identity, so changing it does NOT remount the player
  const startAt = parseStartSeconds(params.get('t'))
  const indexParam = Number(params.get('index'))
  const playlistIndex = Number.isInteger(indexParam) && indexParam > 0 ? indexParam - 1 : undefined
  const [{ data: watchData, error: watchError, fetching: watchFetching }] = useQuery({
    query: WATCH_META_QUERY,
    variables: { id: videoId, playlistId: listId, playlistIndex },
    // load-bearing: WatchMeta is keyed by video id and WatchPlaylist is embedded in it, so every argument set for one video shares a single `playlist` slot (a plain ?v= read writes null over it, a read from another queue writes that queue's panel), and cache-first would serve the stale slot straight back
    requestPolicy: 'cache-and-network',
    pause: videoId === ''
  })
  const [, navigate] = useLocation()
  const [rateState, rateVideo] = useMutation(RATE_VIDEO)
  const playerSession = usePlayerSession()
  const theater = playerSession.theater
  const toggleTheater = useCallback(() => {
    setPlayerTheater(updateSettings({ theater: !getSettings().theater }).theater)
  }, [])

  useEffect(() => {
    setRelatedPages([])
    setWantMoreRelated(false)
  }, [videoId])
  useEffect(() => setSharing(false), [videoId])

  const watch = watchData?.watch
  useDocumentTitle(watch?.title ?? undefined)
  const channel = watch?.channel

  useEffect(() => {
    if (videoId === '') return
    openPlayer({ videoId, startAt, title: watch?.title ?? undefined })
  }, [videoId, startAt, watch?.title])
  // the sidebar pages from its own cursor: re-running /next would restart the whole watch
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
  // gated on the URL: WatchMeta is keyed by video id, so its one `playlist` slot can hold another queue's panel
  const playlist: PlaylistPanelData | undefined =
    listId === undefined || watch?.playlist?.id !== listId ? undefined : watch.playlist
  const liked = watch?.likeStatus === 'LIKE'
  const disliked = watch?.likeStatus === 'DISLIKE'

  const rate = (status: 'LIKE' | 'DISLIKE') => {
    if (!watch?.likeStatus) {
      navigate('/signin')
      return
    }
    const next = watch.likeStatus === status ? 'INDIFFERENT' : status
    void rateVideo({ id: videoId, status: next }).then((result) => {
      if (result.error) showToast(readable(result.error.message))
    })
  }

  const [sharing, setSharing] = useState(false)

  return (
    <main css={style} className={theater ? 'theater' : undefined}>
      <div className='stage'>
        {/* The player is NOT mounted here: it lives above the router, so leaving the page docks it rather than destroying its SABR session */}
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
                {/* Save sits beside Share rather than inside the More menu: menu.tsx finds its rows with one DOM query rooted at the wrapper */}
                <SaveMenu videoId={videoId} />
                <Menu
                  label='More actions'
                  trigger={
                    <button type='button' className='round' aria-label='More actions'>
                      <EllipsisVertical size={20} strokeWidth={1.5} />
                    </button>
                  }
                >
                  <MenuItem icon={Link2} label='Share' onSelect={() => setSharing(true)} />
                  <MenuItem
                    label='Theater mode'
                    checked={theater}
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
        {!watchFetching
          ? <Comments key={`comments:${videoId}`} videoId={videoId} commentCountText={watch?.commentCountText} />
          : undefined}
      </div>
      {watchFetching || playlist || watch?.isLive || (related && related.length > 0)
        ? (
          <aside className='secondary'>
            {playlist ? <PlaylistPanel playlist={playlist} /> : undefined}
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

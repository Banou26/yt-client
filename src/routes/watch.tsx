import { css } from '@emotion/react'
import { EllipsisVertical, Share2, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { useMutation, useQuery } from 'urql'
import { Link, useLocation } from 'wouter'

import Comments from '../components/comments'
import DescriptionBox from '../components/description-box'
import SubscribeButton from '../components/subscribe-button'
import { VideoCardCompact, VideoCardCompactSkeleton } from '../components/video-card-compact'
import { gql } from '../generated'
import VideoPlayer from '../player/video-player'
import { prefetchPlayback } from '../player/prefetch'
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

// one /next round trip serves the whole page (title included) — the /player
// data rides in with the playback path already, so no video(id) query here.
const WATCH_META_QUERY = gql(`
  query WatchMeta($id: ID!) {
    watch(id: $id) {
      id
      title
      viewCountText
      publishedDateText
      likeCountText
      commentCountText
      description
      likeStatus
      channel { id name avatar handle subscriberCountText isSubscribed notificationLevel }
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
    }
  }
`)

/* Grid rather than flex so theater mode is a placement change: the player keeps
   its DOM position and only spans differently. */
const style = css`
  display: grid;
  grid-template-columns: minmax(0, 128rem) 40.2rem;
  align-items: start;
  gap: 0 2.4rem;
  padding: 2.4rem;

  .stage {
    grid-column: 1;
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

  /* Keeps a tall window from pushing the title below the fold. */
  &.theater .stage > div {
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

const RELATED_SKELETON_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

const WatchPage = ({ params }: { params: { videoId: string } }) => {
  prefetchPlayback(params.videoId)
  const [{ data: watchData, error: watchError, fetching: watchFetching }] = useQuery({
    query: WATCH_META_QUERY,
    variables: { id: params.videoId }
  })
  const [, navigate] = useLocation()
  const [rateState, rateVideo] = useMutation(RATE_VIDEO)
  const [theater, setTheater] = useState(() => getSettings().theater)
  const toggleTheater = useCallback(() => {
    setTheater((value) => updateSettings({ theater: !value }).theater)
  }, [])
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    setCopied(false)
    clearTimeout(copiedTimer.current)
  }, [params.videoId])
  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  const watch = watchData?.watch
  const channel = watch?.channel
  const related = watch?.related
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
    void rateVideo({ id: params.videoId, status: next }).then((result) => {
      if (result.error) showToast(result.error.message.replace(/^\[\w+]\s*/, ''))
    })
  }

  const onShare = () => {
    navigator.clipboard.writeText(location.href).catch(() => {})
    setCopied(true)
    clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(false), 2000)
  }

  return (
    <main css={style} className={theater ? 'theater' : undefined}>
      {/* The player stays in one place in the DOM across theater toggles: moving
          it to another parent would remount it and restart playback. Only the
          grid placement of .stage changes. */}
      <div className='stage'>
        <VideoPlayer
          key={`player:${params.videoId}`}
          videoId={params.videoId}
          theater={theater}
          onTheater={toggleTheater}
        />
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
                <button type='button' className='pill' onClick={onShare}>
                  <Share2 size={20} strokeWidth={1.5} />
                  {copied ? 'Copied' : 'Share'}
                </button>
                <button type='button' className='round' aria-label='More actions'>
                  <EllipsisVertical size={20} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          )
          : undefined}
        {watch?.description || watch?.viewCountText || watch?.publishedDateText
          ? (
            <DescriptionBox
              key={`description:${params.videoId}`}
              viewCountText={watch.viewCountText}
              publishedDateText={watch.publishedDateText}
              description={watch.description}
            />
          )
          : undefined}
        {/* mount after the /next answer so the comments call never contends with startup */}
        {!watchFetching
          ? <Comments key={`comments:${params.videoId}`} videoId={params.videoId} commentCountText={watch?.commentCountText} />
          : undefined}
      </div>
      {watchFetching || (related && related.length > 0)
        ? (
          <aside className='secondary'>
            {related
              ? related.map(item => <VideoCardCompact key={item.id} video={item} />)
              : RELATED_SKELETON_KEYS.map(key => <VideoCardCompactSkeleton key={key} />)}
          </aside>
        )
        : undefined}
    </main>
  )
}

export default WatchPage

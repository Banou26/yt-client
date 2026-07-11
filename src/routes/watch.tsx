import { css } from '@emotion/react'
import { EllipsisVertical, Share2, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useQuery } from 'urql'
import { Link } from 'wouter'

import Comments from '../components/comments'
import DescriptionBox from '../components/description-box'
import SubscribeButton from '../components/subscribe-button'
import { VideoCardCompact, VideoCardCompactSkeleton } from '../components/video-card-compact'
import { gql } from '../generated'
import VideoPlayer from '../player/video-player'

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
      channel { id name avatar handle subscriberCountText }
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

const style = css`
  display: flex;
  align-items: flex-start;
  padding: 2.4rem;

  .primary {
    flex: 1;
    min-width: 0;
    max-width: 128rem;
  }

  .secondary {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    width: 40.2rem;
    margin-left: 2.4rem;
  }

  .title {
    margin: 1.2rem 0 0;
    font-size: 2rem;
    font-weight: 700;
    line-height: 2.8rem;
    color: #f1f1f1;
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
    background: #272727;
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
    color: #f1f1f1;
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
    color: #f1f1f1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sub-count {
    font-size: 1.2rem;
    color: #aaaaaa;
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
    background: #272727;
    overflow: hidden;
  }

  .like,
  .dislike {
    display: flex;
    align-items: center;
    border: none;
    background: transparent;
    color: #f1f1f1;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .like {
    gap: 0.8rem;
    padding: 0 1.2rem 0 1.6rem;
    border-right: 1px solid rgba(255, 255, 255, 0.2);
    font-size: 1.4rem;
    font-weight: 500;
  }

  .dislike {
    padding: 0 1.6rem;
  }

  .like:hover,
  .dislike:hover {
    background: #3f3f3f;
  }

  .pill {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    height: 3.6rem;
    padding: 0 1.6rem;
    border: none;
    border-radius: 1.8rem;
    background: #272727;
    color: #f1f1f1;
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .pill:hover {
    background: #3f3f3f;
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
    background: #272727;
    color: #f1f1f1;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .round:hover {
    background: #3f3f3f;
  }

  .error {
    margin-top: 1.2rem;
    color: #aaaaaa;
  }

  @media (max-width: 1017px) {
    flex-direction: column;

    .secondary {
      width: auto;
      max-width: 128rem;
      align-self: stretch;
      margin: 2.4rem 0 0;
    }
  }

  @media (max-width: 768px) {
    padding: 1.2rem;
  }
`

const RELATED_SKELETON_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

const WatchPage = ({ params }: { params: { videoId: string } }) => {
  const [{ data: watchData, error: watchError, fetching: watchFetching }] = useQuery({
    query: WATCH_META_QUERY,
    variables: { id: params.videoId }
  })
  const [liked, setLiked] = useState(false)
  const [disliked, setDisliked] = useState(false)
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    setLiked(false)
    setDisliked(false)
    setCopied(false)
    clearTimeout(copiedTimer.current)
  }, [params.videoId])
  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  const watch = watchData?.watch
  const channel = watch?.channel
  const related = watch?.related

  const onLike = () => {
    setDisliked(false)
    setLiked(value => !value)
  }
  const onDislike = () => {
    setLiked(false)
    setDisliked(value => !value)
  }
  const onShare = () => {
    navigator.clipboard.writeText(location.href).catch(() => {})
    setCopied(true)
    clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(false), 2000)
  }

  return (
    <main css={style}>
      <div className='primary'>
        <VideoPlayer key={`player:${params.videoId}`} videoId={params.videoId} />
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
              <SubscribeButton key={params.videoId} />
              <div className='actions'>
                <div className='like-pill'>
                  <button type='button' className='like' aria-label='Like' aria-pressed={liked} onClick={onLike}>
                    <ThumbsUp size={20} strokeWidth={1.5} fill={liked ? 'currentColor' : 'none'} />
                    {watch?.likeCountText ? <span>{watch.likeCountText}</span> : undefined}
                  </button>
                  <button type='button' className='dislike' aria-label='Dislike' aria-pressed={disliked} onClick={onDislike}>
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

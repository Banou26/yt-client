import type { Channel, Video } from '../generated/graphql'

import { css } from '@emotion/react'
import { EllipsisVertical } from 'lucide-react'
import { Link } from 'wouter'

import { usePrefetchOnIntent } from '../player/prefetch'
import { formatDuration, formatMeta } from './format'

export type VideoCardData =
  Pick<Video, 'id' | 'title'>
  & Partial<Pick<Video, 'description' | 'durationSeconds' | 'publishedText' | 'thumbnail' | 'viewCount'>>
  & {
    isLive?: boolean | null
    channel?: (Pick<Channel, 'id' | 'name'> & Partial<Pick<Channel, 'avatar'>>) | null
  }

const style = css`
  display: flex;
  flex-direction: column;
  min-width: 0;

  .thumb {
    position: relative;
    display: block;
    aspect-ratio: 16 / 9;
    border-radius: 1.2rem;
    overflow: hidden;
    background: #212121;
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
    background: rgba(0, 0, 0, 0.8);
    color: #ffffff;
    font-size: 1.2rem;
    font-weight: 500;
    line-height: 1.8rem;
  }

  .badge.live {
    background: #ff0000;
    text-transform: uppercase;
  }

  .details {
    display: flex;
    align-items: flex-start;
    margin-top: 1.2rem;
  }

  .avatar {
    flex: none;
    width: 3.6rem;
    height: 3.6rem;
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

  .text {
    flex: 1;
    min-width: 0;
    margin-left: 1.2rem;
  }

  .title {
    margin: 0 0 0.4rem;
    font-size: 1.6rem;
    font-weight: 500;
    line-height: 2.2rem;
    color: #f1f1f1;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .channel-name {
    display: block;
    width: fit-content;
    font-size: 1.4rem;
    font-weight: 400;
    color: #aaaaaa;
    transition: color 0.15s ease;
  }

  .channel-name:hover {
    color: #f1f1f1;
  }

  .meta {
    font-size: 1.4rem;
    font-weight: 400;
    color: #aaaaaa;
  }

  &.channel .text {
    margin-left: 0;
  }

  &.channel .title {
    font-size: 1.4rem;
    line-height: 2rem;
  }

  &.channel .meta {
    font-size: 1.2rem;
  }

  .more {
    flex: none;
    width: 3.6rem;
    height: 3.6rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: #f1f1f1;
    cursor: pointer;
    opacity: 0;
    transition: background 0.15s ease, opacity 0.15s ease;
  }

  &:hover .more,
  .more:focus-visible {
    opacity: 1;
  }

  .more:hover {
    background: rgba(255, 255, 255, 0.1);
  }
`

export const VideoCard = ({ video, variant }: { video: VideoCardData, variant?: 'channel' }) => {
  const watchHref = `/watch/${video.id}`
  const channelHref = video.channel ? `/channel/${video.channel.id}` : undefined
  const duration = formatDuration(video.durationSeconds)
  const meta = formatMeta(video.viewCount, video.publishedText)
  const prefetch = usePrefetchOnIntent(video.id)
  return (
    <article css={style} className={variant} {...prefetch}>
      <Link href={watchHref} className='thumb' tabIndex={-1} aria-hidden='true'>
        {video.thumbnail ? <img src={video.thumbnail} alt='' loading='lazy' /> : undefined}
        {video.isLive
          ? <span className='badge live'>LIVE</span>
          : duration ? <span className='badge'>{duration}</span> : undefined}
      </Link>
      <div className='details'>
        {video.channel && channelHref && variant !== 'channel'
          ? (
            <Link
              href={channelHref}
              className={video.channel.avatar ? 'avatar' : 'avatar fallback'}
              aria-label={video.channel.name}
            >
              {video.channel.avatar
                ? <img src={video.channel.avatar} alt='' loading='lazy' />
                : video.channel.name.slice(0, 1).toUpperCase()}
            </Link>
          )
          : undefined}
        <div className='text'>
          <h3 className='title'>
            <Link href={watchHref}>{video.title}</Link>
          </h3>
          {video.channel && channelHref && variant !== 'channel'
            ? <Link href={channelHref} className='channel-name'>{video.channel.name}</Link>
            : undefined}
          {meta ? <div className='meta'>{meta}</div> : undefined}
        </div>
        <button type='button' className='more' aria-label='More actions'>
          <EllipsisVertical size={20} strokeWidth={1.5} />
        </button>
      </div>
    </article>
  )
}

const skeletonStyle = css`
  min-width: 0;
  animation: video-card-pulse 1.6s ease-in-out infinite;

  .thumb {
    aspect-ratio: 16 / 9;
    border-radius: 1.2rem;
    background: #212121;
  }

  .bar {
    height: 1.6rem;
    border-radius: 0.4rem;
    background: #212121;
    margin-top: 1.2rem;
  }

  .bar.short {
    width: 60%;
    margin-top: 0.8rem;
  }

  @keyframes video-card-pulse {
    0%,
    100% {
      opacity: 1;
    }

    50% {
      opacity: 0.55;
    }
  }
`

export const VideoCardSkeleton = () => (
  <div css={skeletonStyle} aria-hidden='true'>
    <div className='thumb' />
    <div className='bar' />
    <div className='bar short' />
  </div>
)

export default VideoCard

import type { VideoCardData } from './video-card'

import { css } from '@emotion/react'
import { EllipsisVertical } from 'lucide-react'
import { Link } from 'wouter'

import { formatDuration, formatMeta } from './format'

const style = css`
  display: flex;
  align-items: flex-start;
  min-width: 0;

  .thumb {
    position: relative;
    flex: none;
    display: block;
    width: 16.8rem;
    height: 9.4rem;
    border-radius: 0.8rem;
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
    right: 0.4rem;
    bottom: 0.4rem;
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

  .text {
    flex: 1;
    min-width: 0;
    margin-left: 0.8rem;
  }

  .title {
    margin: 0 0 0.4rem;
    font-size: 1.4rem;
    font-weight: 500;
    line-height: 2rem;
    color: #f1f1f1;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .channel-name {
    display: block;
    width: fit-content;
    margin-top: 0.4rem;
    font-size: 1.2rem;
    font-weight: 400;
    color: #aaaaaa;
    transition: color 0.15s ease;
  }

  .channel-name:hover {
    color: #f1f1f1;
  }

  .meta {
    font-size: 1.2rem;
    font-weight: 400;
    color: #aaaaaa;
  }

  .more {
    flex: none;
    width: 2.4rem;
    height: 2.4rem;
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

export const VideoCardCompact = ({ video }: { video: VideoCardData }) => {
  const watchHref = `/watch/${video.id}`
  const duration = formatDuration(video.durationSeconds)
  const meta = formatMeta(video.viewCount, video.publishedText)
  return (
    <article css={style}>
      <Link href={watchHref} className='thumb' tabIndex={-1} aria-hidden='true'>
        {video.thumbnail ? <img src={video.thumbnail} alt='' loading='lazy' /> : undefined}
        {video.isLive
          ? <span className='badge live'>LIVE</span>
          : duration ? <span className='badge'>{duration}</span> : undefined}
      </Link>
      <div className='text'>
        <h3 className='title'>
          <Link href={watchHref}>{video.title}</Link>
        </h3>
        {video.channel
          ? <Link href={`/channel/${video.channel.id}`} className='channel-name'>{video.channel.name}</Link>
          : undefined}
        {meta ? <div className='meta'>{meta}</div> : undefined}
      </div>
      <button type='button' className='more' aria-label='More actions'>
        <EllipsisVertical size={16} strokeWidth={1.5} />
      </button>
    </article>
  )
}

const skeletonStyle = css`
  display: flex;
  align-items: flex-start;
  min-width: 0;
  animation: video-card-compact-pulse 1.6s ease-in-out infinite;

  .thumb {
    flex: none;
    width: 16.8rem;
    height: 9.4rem;
    border-radius: 0.8rem;
    background: #212121;
  }

  .text {
    flex: 1;
    min-width: 0;
    margin-left: 0.8rem;
  }

  .bar {
    height: 1.4rem;
    border-radius: 0.4rem;
    background: #212121;
    margin-top: 0.4rem;
  }

  .bar.short {
    width: 60%;
    margin-top: 0.8rem;
  }

  @keyframes video-card-compact-pulse {
    0%,
    100% {
      opacity: 1;
    }

    50% {
      opacity: 0.55;
    }
  }
`

export const VideoCardCompactSkeleton = () => (
  <div css={skeletonStyle} aria-hidden='true'>
    <div className='thumb' />
    <div className='text'>
      <div className='bar' />
      <div className='bar short' />
    </div>
  </div>
)

export default VideoCardCompact

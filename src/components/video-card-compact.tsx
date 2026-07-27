import type { VideoCardData } from './video-card'

import { css } from '@emotion/react'
import { EllipsisVertical } from 'lucide-react'
import { Link } from 'wouter'

import { usePrefetchOnIntent } from '../player/prefetch'
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
    right: 0.4rem;
    bottom: 0.4rem;
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
    color: var(--text-primary);
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
    color: var(--text-secondary);
    transition: color 0.15s ease;
  }

  .channel-name:hover {
    color: var(--text-primary);
  }

  .meta {
    font-size: 1.2rem;
    font-weight: 400;
    color: var(--text-secondary);
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
    color: var(--text-primary);
    cursor: pointer;
    opacity: 0;
    transition: background 0.15s ease, opacity 0.15s ease;
  }

  &:hover .more,
  .more:focus-visible {
    opacity: 1;
  }

  .more:hover {
    background: var(--bg-hover);
  }
`

export const VideoCardCompact = ({ video }: { video: VideoCardData }) => {
  const watchHref = `/watch/${video.id}`
  const duration = formatDuration(video.durationSeconds)
  const meta = formatMeta(video.viewCount, video.publishedText)
  const prefetch = usePrefetchOnIntent(video.id)
  return (
    <article css={style} {...prefetch}>
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
    background: var(--bg-elevated);
  }

  .text {
    flex: 1;
    min-width: 0;
    margin-left: 0.8rem;
  }

  .bar {
    height: 1.4rem;
    border-radius: 0.4rem;
    background: var(--bg-elevated);
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

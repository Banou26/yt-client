import type { PlaylistIcon } from './playlist'

import { css } from '@emotion/react'
import { ListVideo } from 'lucide-react'
import { Link } from 'wouter'

import { playlistHrefFor, restrictedPrivacyIcon } from './playlist'

export const playlistCardStyle = css`
  display: flex;
  flex-direction: column;
  min-width: 0;

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

  &:hover .card-meta {
    color: var(--text-primary);
  }
`

export const PlaylistCard = (
  { id, title, thumbnail, videoCountText, updatedText, privacy, channelName, fallbackIcon: FallbackIcon }: {
    id: string
    title: string
    thumbnail?: string | null
    videoCountText?: string | null
    updatedText?: string | null
    privacy?: string | null
    channelName?: string | null
    fallbackIcon?: PlaylistIcon
  },
) => {
  const Privacy = restrictedPrivacyIcon(privacy)
  const meta = [channelName, updatedText].filter(part => part !== undefined && part !== null && part !== '')
  return (
    // One link over the whole card: an anchor inside an anchor gets flattened
    <Link href={playlistHrefFor(id)} css={playlistCardStyle} className='card'>
      <div className='cover'>
        {thumbnail
          ? <img src={thumbnail} alt='' loading='lazy' />
          : (
            <span className='cover-fallback'>
              {FallbackIcon
                ? <FallbackIcon size={40} strokeWidth={1.5} />
                : <ListVideo size={40} strokeWidth={1.5} />}
            </span>
          )}
        {videoCountText
          ? (
            <span className='count'>
              <ListVideo size={14} strokeWidth={1.5} />
              {videoCountText}
            </span>
          )
          : undefined}
      </div>
      <h3 className='card-title'>{title}</h3>
      <div className='card-meta'>
        {Privacy ? <Privacy size={14} strokeWidth={1.5} /> : undefined}
        <span>{meta.length > 0 ? meta.join(' • ') : 'View full playlist'}</span>
      </div>
    </Link>
  )
}

export default PlaylistCard

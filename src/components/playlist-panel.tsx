import type { Video } from '../generated/graphql'

import { css } from '@emotion/react'
import { Play, Repeat, Shuffle, SkipBack, SkipForward } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { Link, useLocation } from 'wouter'

import { usePrefetchOnIntent } from '../player/prefetch'
import { formatDuration } from './format'
import { watchHrefFor } from './video-card'

// deliberately structural rather than typed off WatchMetaQuery, so a playlist route reading Query.playlist can reuse it
export type PlaylistPanelData = {
  id: string
  title?: string | null
  author?: string | null
  /** 0-based, and upstream's answer rather than the requested one. */
  currentIndex?: number | null
  isInfinite?: boolean | null
  items: (Pick<Video, 'id' | 'title'> & Partial<Pick<Video, 'thumbnail' | 'durationSeconds'>>)[]
}

// `position` is the 0-based offset into `items`, while the `&index=` it writes is 1-based, as youtube.com's own
const queueHrefFor = (videoId: string, playlistId: string, position: number) =>
  watchHrefFor(videoId, { list: playlistId, index: position + 1 })

// module scope because app.tsx keys the whole route subtree on the query string, so every queue navigation unmounts this panel
// kept out of settings.ts because a queue mode belongs to the session in progress, not to the next one
const mode = { loop: false, shuffle: false }

// exists so a Shuffle pressed on /playlist arrives at the queue with shuffle already on: that button navigates into the queue and only this module can answer for its mode
export const setQueueShuffle = (value: boolean) => {
  mode.shuffle = value
}

const style = css`
  flex: none;
  display: flex;
  flex-direction: column;
  max-height: 48rem;
  margin-bottom: 1.6rem;
  border: 1px solid var(--border);
  border-radius: 1.2rem;
  background: var(--bg-subtle);
  /* Clips the first and last rows to the rounded corners; the scrolling happens
     one level down, in .items. */
  overflow: hidden;

  /* Pinned above the list rather than position: sticky inside it. The list is
     the scroll container, so the head is already fixed relative to what moves,
     and a sticky head inside the same box would let the transport controls
     scroll away under their own rows. */
  .head {
    flex: none;
    padding: 1.2rem 1.6rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg-elevated);
  }

  .head-top {
    display: flex;
    align-items: flex-start;
    gap: 1.2rem;
  }

  .head-text {
    flex: 1;
    min-width: 0;
  }

  .playlist-title {
    font-size: 1.6rem;
    font-weight: 500;
    line-height: 2.2rem;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .playlist-meta {
    margin-top: 0.4rem;
    font-size: 1.2rem;
    line-height: 1.8rem;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .count {
    flex: none;
    font-size: 1.2rem;
    line-height: 2.2rem;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.8rem;
  }

  .control {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3.2rem;
    height: 3.2rem;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .control:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .control:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* aria-pressed carries the state for assistive tech, so the styling reads off
     the same attribute instead of a second class that could disagree with it. */
  .control[aria-pressed='true'] {
    color: var(--accent);
  }

  .items {
    flex: 1;
    min-height: 0;
    /* offsetTop on a row is measured against this box, which is what the
       scroll-into-view below relies on. */
    position: relative;
    margin: 0;
    padding: 0.8rem 0;
    list-style: none;
    overflow-y: auto;
  }

  .row {
    display: flex;
    align-items: stretch;
  }

  .row-link {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.4rem 0.8rem 0.4rem 0;
    transition: background 0.15s ease;
  }

  .row-link:hover {
    background: var(--bg-hover);
  }

  .row[data-current='true'] .row-link {
    background: var(--bg-selected);
  }

  .position {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.8rem;
    font-size: 1.2rem;
    color: var(--text-tertiary);
  }

  .row[data-current='true'] .position {
    color: var(--text-primary);
  }

  .thumb {
    position: relative;
    flex: none;
    display: block;
    width: 10rem;
    height: 5.6rem;
    border-radius: 0.4rem;
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
    line-height: 1.6rem;
  }

  .row-title {
    flex: 1;
    min-width: 0;
    font-size: 1.4rem;
    font-weight: 400;
    line-height: 2rem;
    color: var(--text-primary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .empty {
    padding: 1.6rem;
    font-size: 1.4rem;
    color: var(--text-secondary);
  }
`

const QueueRow = (
  { video, position, current, playlistId }: {
    video: PlaylistPanelData['items'][number]
    position: number
    current: boolean
    playlistId: string
  },
) => {
  const prefetch = usePrefetchOnIntent(video.id)
  const duration = formatDuration(video.durationSeconds)

  return (
    <li className='row' data-current={current ? 'true' : undefined} {...prefetch}>
      <Link
        href={queueHrefFor(video.id, playlistId, position)}
        className='row-link'
        aria-current={current ? 'true' : undefined}
      >
        <span className='position'>
          {current ? <Play size={12} strokeWidth={1.5} fill='currentColor' /> : position + 1}
        </span>
        <span className='thumb'>
          {video.thumbnail ? <img src={video.thumbnail} alt='' loading='lazy' /> : undefined}
          {duration ? <span className='badge'>{duration}</span> : undefined}
        </span>
        <span className='row-title'>{video.title}</span>
      </Link>
    </li>
  )
}

export const PlaylistPanel = ({ playlist }: { playlist: PlaylistPanelData }) => {
  const [, navigate] = useLocation()
  const [loop, setLoop] = useState(mode.loop)
  const [shuffle, setShuffle] = useState(mode.shuffle)
  const listRef = useRef<HTMLOListElement>(null)

  const items = playlist.items
  const count = items.length
  const current = Math.min(Math.max(playlist.currentIndex ?? 0, 0), Math.max(count - 1, 0))

  // scrollTop rather than scrollIntoView, which walks up and scrolls every scrollable ancestor
  useLayoutEffect(() => {
    const list = listRef.current
    const row = list?.querySelector<HTMLElement>('[data-current="true"]')
    if (!list || !row) return
    list.scrollTop = row.offsetTop - (list.clientHeight - row.clientHeight) / 2
  }, [current, count, playlist.id])

  const toggleLoop = () => {
    mode.loop = !loop
    setLoop(mode.loop)
  }

  const toggleShuffle = () => {
    mode.shuffle = !shuffle
    setShuffle(mode.shuffle)
  }

  // the offset is drawn from a range one shorter than the queue and stepped over the current position, so the video on screen can never be picked again
  const pickNext = () => {
    if (shuffle) {
      if (count < 2) return undefined
      const offset = Math.floor(Math.random() * (count - 1))
      return offset >= current ? offset + 1 : offset
    }
    if (current + 1 < count) return current + 1
    return loop && count > 1 ? 0 : undefined
  }

  // previous steps back through the list even under shuffle: going back to what actually played would need a play history
  const previousIndex = current > 0 ? current - 1 : loop && count > 1 ? count - 1 : undefined
  const hasNext = shuffle ? count > 1 : current + 1 < count || (loop && count > 1)

  const go = (index?: number) => {
    if (index === undefined) return
    const video = items[index]
    if (!video) return
    navigate(queueHrefFor(video.id, playlist.id, index))
  }

  const meta = [playlist.author ?? undefined, playlist.isInfinite ? 'Mix' : undefined]
    .filter(part => part !== undefined)
    .join(' • ')

  return (
    <section css={style} aria-label='Playlist queue'>
      <div className='head'>
        <div className='head-top'>
          <div className='head-text'>
            <div className='playlist-title'>{playlist.title ?? 'Playlist'}</div>
            {meta ? <div className='playlist-meta'>{meta}</div> : undefined}
          </div>
          {/* suppressed rather than showing "1 / 0" on a queue that came back with no entries */}
          {count > 0 ? <div className='count'>{current + 1} / {count}</div> : undefined}
        </div>
        <div className='controls'>
          <button
            type='button'
            className='control'
            aria-label='Previous video'
            disabled={previousIndex === undefined}
            onClick={() => go(previousIndex)}
          >
            <SkipBack size={20} strokeWidth={1.5} />
          </button>
          <button
            type='button'
            className='control'
            aria-label='Next video'
            disabled={!hasNext}
            onClick={() => go(pickNext())}
          >
            <SkipForward size={20} strokeWidth={1.5} />
          </button>
          <button
            type='button'
            className='control'
            aria-label='Shuffle'
            aria-pressed={shuffle}
            onClick={toggleShuffle}
          >
            <Shuffle size={20} strokeWidth={1.5} />
          </button>
          <button
            type='button'
            className='control'
            aria-label='Loop playlist'
            aria-pressed={loop}
            onClick={toggleLoop}
          >
            <Repeat size={20} strokeWidth={1.5} />
          </button>
        </div>
      </div>
      {count > 0
        ? (
          <ol className='items' ref={listRef}>
            {items.map((video, position) => (
              // position is part of the key because a playlist may hold the same video twice
              <QueueRow
                key={`${position}:${video.id}`}
                video={video}
                position={position}
                current={position === current}
                playlistId={playlist.id}
              />
            ))}
          </ol>
        )
        : <p className='empty'>This playlist has no videos.</p>}
    </section>
  )
}

export default PlaylistPanel

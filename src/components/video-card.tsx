import type { TargetedPointerEvent } from 'preact'

import type { Channel, SavePlaylistsQuery, Video } from '../generated/graphql'

import { css } from '@emotion/react'
import { Check, ChevronLeft, Clock, EllipsisVertical, ListPlus, Share2 } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useMutation, useQuery } from 'urql'
import { Link, useLocation } from 'wouter'

// reuses save-menu.tsx's documents rather than a second gql() copy: two operations cannot share a name
import { AddToPlaylistDocument, SavePlaylistsDocument } from '../generated/graphql'
import { HoverPreview } from '../player/hover-preview'
import { usePrefetchOnIntent } from '../player/prefetch'
import { useSession } from '../session'
import { formatDuration, formatMeta, readable } from './format'
import { WATCH_LATER_ID } from './playlist'
import { Menu, MenuItem, MenuSeparator } from './ui/menu'
import { showToast } from './ui/toast'
import { useInfiniteFeed } from './use-infinite-feed'

export type VideoCardData =
  Pick<Video, 'id' | 'title'>
  & Partial<
    Pick<
      Video,
      | 'description'
      | 'durationSeconds'
      | 'progressPercent'
      | 'publishedText'
      | 'thumbnail'
      | 'thumbnailSrcset'
      | 'viewCount'
    >
  >
  & {
    isLive?: boolean | null
    isShort?: boolean | null
    isUpcoming?: boolean | null
    channel?: (Pick<Channel, 'id' | 'name'> & Partial<Pick<Channel, 'avatar'>>) | null
  }

export type WatchContext = { list?: string, index?: number }

export const watchHrefFor = (videoId: string, context?: WatchContext) => {
  const params = new URLSearchParams({ v: videoId })
  if (context?.list !== undefined && context.list.length > 0) {
    params.set('list', context.list)
    if (context.index !== undefined && Number.isFinite(context.index)) {
      params.set('index', String(context.index))
    }
  }
  return `/watch?${params}`
}

// upstream progress is a rounded percentage that can read slightly over 100
export const resumePercent = (progressPercent?: number | null) =>
  progressPercent !== undefined && progressPercent !== null && progressPercent > 0
    ? Math.min(progressPercent, 100)
    : undefined

type PlaylistsPage = SavePlaylistsQuery['playlists']

const menuPanelStyle = css`
  min-width: 24rem;
`

type CardMenuView = 'root' | 'playlists'

const CardMenuPanel = (
  { videoId, saved, onSaved }: {
    videoId: string
    saved: string[]
    onSaved: (playlistId: string) => void
  },
) => {
  const [, navigate] = useLocation()
  const { ready, signedIn } = useSession()
  const [view, setView] = useState<CardMenuView>('root')
  const [wanted, setWanted] = useState(false)
  const [loaded, setLoaded] = useState<PlaylistsPage[]>([])
  const [pending, setPending] = useState<string | undefined>(undefined)
  const panelRef = useRef<HTMLDivElement>(null)
  // Menu moves focus onto a row only when the panel OPENS, so this covers the swap
  const shown = useRef(view)

  useLayoutEffect(() => {
    if (shown.current === view) return
    shown.current = view
    panelRef.current?.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')?.focus()
  }, [view])

  const [{ data, error, fetching }] = useQuery({
    query: SavePlaylistsDocument,
    variables: { cursor: loaded[loaded.length - 1]?.cursor },
    pause: !wanted || !ready || !signedIn,
  })
  const [, addToPlaylist] = useMutation(AddToPlaylistDocument)

  const page = data?.playlists
  const { items, cursor } = useInfiniteFeed({
    pages: page ? [...loaded, page] : loaded,
    key: playlist => playlist.id,
  })
  const rows = items.filter(playlist => playlist.id !== WATCH_LATER_ID)

  const onMore = () => {
    if (!page?.cursor || fetching || error) return
    setLoaded(loaded[loaded.length - 1] === page ? loaded : [...loaded, page])
  }

  const save = (playlistId: string, label: string) => {
    if (pending !== undefined || saved.includes(playlistId)) return
    setPending(playlistId)
    void addToPlaylist({ playlistId, videoIds: [videoId] }).then((result) => {
      setPending(undefined)
      if (result.error) {
        showToast(readable(result.error.message))
        return
      }
      onSaved(playlistId)
      showToast(`Saved to ${label}`)
    })
  }

  const onShare = () => {
    // deliberately without the playlist context: a shared link opens the video, not a queue
    const url = `${location.origin}${watchHrefFor(videoId)}`
    const clipboard = navigator.clipboard
    if (!clipboard) {
      showToast('Could not copy the link')
      return
    }
    void clipboard.writeText(url).then(
      () => showToast('Link copied to clipboard'),
      () => showToast('Could not copy the link'),
    )
  }

  const savedWatchLater = saved.includes(WATCH_LATER_ID)

  return (
    <div css={menuPanelStyle} role='presentation' ref={panelRef}>
      {view === 'root'
        ? (
          <>
            <MenuItem
              icon={savedWatchLater ? Check : Clock}
              label={savedWatchLater ? 'Saved to Watch later' : 'Save to Watch later'}
              disabled={!ready || pending !== undefined || savedWatchLater}
              onSelect={() => {
                if (!signedIn) {
                  navigate('/signin')
                  return
                }
                save(WATCH_LATER_ID, 'Watch later')
              }}
            />
            <MenuItem
              icon={ListPlus}
              label='Save to playlist'
              disabled={!ready}
              closeOnSelect={false}
              onSelect={() => {
                if (!signedIn) {
                  navigate('/signin')
                  return
                }
                setWanted(true)
                setView('playlists')
              }}
            />
            <MenuSeparator />
            <MenuItem icon={Share2} label='Share' onSelect={onShare} />
          </>
        )
        : (
          <>
            <MenuItem icon={ChevronLeft} label='Back' closeOnSelect={false} onSelect={() => setView('root')} />
            <MenuSeparator />
            {/* No visibility icon: SavePlaylists cannot select a privacy without writing nulls over the cached entity */}
            {rows.map(playlist => (
              <MenuItem
                key={playlist.id}
                label={playlist.title}
                detail={playlist.videoCountText ?? undefined}
                checked={saved.includes(playlist.id)}
                disabled={pending !== undefined || saved.includes(playlist.id)}
                onSelect={() => save(playlist.id, playlist.title)}
              />
            ))}
            {fetching && rows.length === 0 ? <MenuItem label='Loading…' disabled /> : undefined}
            {error && rows.length === 0 ? <MenuItem label={readable(error.message)} disabled /> : undefined}
            {!fetching && !error && rows.length === 0
              ? <MenuItem label='No playlists yet' disabled />
              : undefined}
            {cursor
              ? (
                <MenuItem
                  label={fetching ? 'Loading more…' : 'Show more'}
                  disabled={fetching || Boolean(error)}
                  closeOnSelect={false}
                  onSelect={onMore}
                />
              )
              : undefined}
          </>
        )}
    </div>
  )
}

export const VideoCardMenu = (
  { videoId, title, iconSize = 20, class: className }: {
    videoId: string
    title: string
    iconSize?: number
    class?: string
  },
) => {
  const [saved, setSaved] = useState<string[]>([])

  return (
    <Menu
      class={className}
      label={`More actions for ${title}`}
      trigger={
        <button type='button' className='more' aria-label={`More actions for ${title}`}>
          <EllipsisVertical size={iconSize} strokeWidth={1.5} />
        </button>
      }
    >
      <CardMenuPanel
        videoId={videoId}
        saved={saved}
        onSaved={(playlistId: string) => setSaved(ids => ids.includes(playlistId) ? ids : [...ids, playlistId])}
      />
    </Menu>
  )
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
    background: var(--bg-elevated);
  }

  /* The card does NOT grow on hover. It used to, matching upstream's 4% lift,
     with an elevated surface behind the whole card so the grown thumbnail did
     not read as a picture that had outgrown its own caption. Both are gone by
     request: the preview now arrives inside a thumbnail that stays exactly
     where it was, so nothing under the pointer moves while the reader aims. */

  /* Shorts are vertical, and a 16/9 box would letterbox one into a slot mostly
     made of background. The card keeps its grid column and only the thumbnail
     changes shape, so the surrounding layout is untouched. */
  &.short .thumb {
    aspect-ratio: 9 / 16;
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

  .progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: block;
    height: 0.4rem;
    background: var(--bg-scrim);
  }

  .progress span {
    display: block;
    height: 100%;
    background: var(--brand);
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
    color: var(--text-primary);
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
    color: var(--text-secondary);
    transition: color 0.15s ease;
  }

  .channel-name:hover {
    color: var(--text-primary);
  }

  .meta {
    font-size: 1.4rem;
    font-weight: 400;
    color: var(--text-secondary);
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
    color: var(--text-primary);
    cursor: pointer;
    opacity: 0;
    transition: background 0.15s ease, opacity 0.15s ease;
  }

  /* The third selector keeps the trigger of an OPEN menu on screen: the pointer
     has moved onto the panel by then, so the card is no longer hovered and the
     button would fade out from under its own menu. */
  &:hover .more,
  .more:focus-visible,
  .more-menu[data-open] .more {
    opacity: 1;
  }

  .more:hover {
    background: var(--bg-hover);
  }
`

export const VideoCard = (
  { video, variant, context }: { video: VideoCardData, variant?: 'channel', context?: WatchContext },
) => {
  const watchHref = watchHrefFor(video.id, context)
  const channelHref = video.channel ? `/channel/${video.channel.id}` : undefined
  const duration = formatDuration(video.durationSeconds)
  const meta = formatMeta(video.viewCount, video.publishedText)
  const progress = resumePercent(video.progressPercent)
  const prefetch = usePrefetchOnIntent(video.id)
  const [previewing, setPreviewing] = useState(false)
  const classes = [variant, video.isShort ? 'short' : undefined]
    .filter(Boolean)
    .join(' ')
  const canPreview = video.isUpcoming !== true && video.isLive !== true
  return (
    <article
      css={style}
      className={classes || undefined}
      /* Called through rather than spread: `{...prefetch}` lets the handlers below overwrite the hook's own. */
      onPointerEnter={(event: TargetedPointerEvent<HTMLElement>) => {
        prefetch.onPointerEnter()
        if (event.pointerType !== 'mouse') return
        if (canPreview) setPreviewing(true)
      }}
      onPointerLeave={() => {
        prefetch.onPointerLeave()
        setPreviewing(false)
      }}
      onPointerDown={prefetch.onPointerDown}
    >
      <Link href={watchHref} className='thumb' tabIndex={-1} aria-hidden='true'>
        {video.thumbnail
          ? (
            <img
              src={video.thumbnail}
              srcSet={video.thumbnailSrcset ?? undefined}
              sizes='(max-width: 500px) 100vw, 38rem'
              alt=''
              loading='lazy'
            />
          )
          : undefined}
        {previewing ? <HoverPreview videoId={video.id} /> : undefined}
        {video.isLive
          ? <span className='badge live'>LIVE</span>
          : duration ? <span className='badge'>{duration}</span> : undefined}
        {progress !== undefined
          ? (
            <span className='progress'>
              <span style={{ width: `${progress}%` }} />
            </span>
          )
          : undefined}
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
        <VideoCardMenu videoId={video.id} title={video.title} class='more-menu' />
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
    background: var(--bg-elevated);
  }

  .bar {
    height: 1.6rem;
    border-radius: 0.4rem;
    background: var(--bg-elevated);
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

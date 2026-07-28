import type { TargetedPointerEvent } from 'preact'

import type { Channel, SavePlaylistsQuery, Video } from '../generated/graphql'

import { css } from '@emotion/react'
import { Check, ChevronLeft, Clock, EllipsisVertical, ListPlus, Share2 } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useMutation, useQuery } from 'urql'
import { Link, useLocation } from 'wouter'

/* The two documents the overflow menu needs are the ones save-menu.tsx already
   declares, so the generated nodes are reused instead of a second gql() copy.
   Two operations cannot share a name, and re-declaring these verbatim would
   make the project's codegen depend on two copies never drifting apart: the day
   one of them gains a field, `npm run generate` fails for everyone. The fix
   that removes this import is lifting the save panel out of save-menu.tsx into
   a component both surfaces render. */
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
    Pick<Video, 'description' | 'durationSeconds' | 'progressPercent' | 'publishedText' | 'thumbnail' | 'viewCount'>
  >
  & {
    isLive?: boolean | null
    isShort?: boolean | null
    isUpcoming?: boolean | null
    channel?: (Pick<Channel, 'id' | 'name'> & Partial<Pick<Channel, 'avatar'>>) | null
  }

/**
 * The playlist a link is being followed from, so /watch opens the queue the
 * reader was already looking at instead of the video on its own.
 *
 * `index` is 1-based, matching PlaylistItem.index and upstream's own links. It
 * is optional even when `list` is set: the server resolves the position from
 * the video id, and a list that has shifted since the page was rendered would
 * otherwise open on the wrong row.
 */
export type WatchContext = { list?: string, index?: number }

export const watchHrefFor = (videoId: string, context?: WatchContext) => {
  const params = new URLSearchParams({ v: videoId })
  // An index with no list indexes into nothing, and upstream drops it there, so
  // it only ships alongside one.
  if (context?.list !== undefined && context.list.length > 0) {
    params.set('list', context.list)
    if (context.index !== undefined && Number.isFinite(context.index)) {
      params.set('index', String(context.index))
    }
  }
  return `/watch?${params}`
}

// Clamped because upstream progress is a rounded percentage that can read
// slightly over 100, which would spill the fill past the thumbnail edge.
export const resumePercent = (progressPercent?: number | null) =>
  progressPercent !== undefined && progressPercent !== null && progressPercent > 0
    ? Math.min(progressPercent, 100)
    : undefined

type PlaylistsPage = SavePlaylistsQuery['playlists']

/* Wider than Popup's 20rem floor because a playlist title plus its count is
   what the picker rows carry, and role=presentation keeps this wrapper out of
   the accessibility tree so the rows stay owned by the menu. */
const menuPanelStyle = css`
  min-width: 24rem;
`

/* One panel, two sets of rows, rather than a panel stacked on a panel: the menu
   primitive finds its rows with a single query rooted at the wrapper, so a
   second panel open inside the first would have both sets answering one set of
   arrow keys. Swapping which rows exist keeps that query honest. */
type CardMenuView = 'root' | 'playlists'

/**
 * The card overflow menu's contents.
 *
 * Split from the trigger because Menu mounts its children only while the panel
 * is open, and a feed renders dozens of cards: the session probe, the library
 * query and the mutation all live here so a closed menu costs nothing but the
 * button. The one thing that has to outlive the panel is which playlists this
 * video has already been put into, so that state sits with the trigger.
 */
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
  // Sticky within one opening: the library costs a round trip through the
  // tunnel, so it is not asked for until the picker is actually entered.
  const [wanted, setWanted] = useState(false)
  const [loaded, setLoaded] = useState<PlaylistsPage[]>([])
  // Which row is in flight, not merely that one is: only that row goes inert.
  const [pending, setPending] = useState<string | undefined>(undefined)
  const panelRef = useRef<HTMLDivElement>(null)
  // Menu moves focus onto a row when the panel OPENS, the only moment it knows
  // about. Swapping the rows underneath it strands focus on a button that just
  // unmounted, which drops the reader back to <body>, so this covers the swap.
  const shown = useRef(view)

  useLayoutEffect(() => {
    if (shown.current === view) return
    shown.current = view
    panelRef.current?.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')?.focus()
  }, [view])

  const [{ data, error, fetching }] = useQuery({
    query: SavePlaylistsDocument,
    variables: { cursor: loaded[loaded.length - 1]?.cursor },
    // The library browse is refused in the source before the network call when
    // signed out, and errors are unmasked, so it is gated rather than fired.
    pause: !wanted || !ready || !signedIn,
  })
  const [, addToPlaylist] = useMutation(AddToPlaylistDocument)

  // urql keeps the previous result while the next page is in flight, so the
  // live page can repeat one already consumed: useInfiniteFeed dedupes by id.
  const page = data?.playlists
  const { items, cursor } = useInfiniteFeed({
    pages: page ? [...loaded, page] : loaded,
    key: playlist => playlist.id,
  })
  // Watch later is filtered out of the picker: it already has a row of its own
  // above, and the library aggregation lists it only sometimes.
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
      // Reported upwards: a save that closes the panel unmounts this component
      // before the write lands, and the tick belongs to the card either way.
      onSaved(playlistId)
      showToast(`Saved to ${label}`)
    })
  }

  const onShare = () => {
    // The card's own watch link, deliberately without the playlist context it
    // may have been rendered with: a shared link should open the video, not
    // hand the recipient a queue they were never looking at.
    const url = `${location.origin}${watchHrefFor(videoId)}`
    const clipboard = navigator.clipboard
    if (!clipboard) {
      showToast('Could not copy the link')
      return
    }
    void clipboard.writeText(url).then(
      () => showToast('Link copied to clipboard'),
      // writeText rejects on a denied permission as well as a non-secure
      // context, and a silent failure is indistinguishable from a copy.
      () => showToast('Could not copy the link'),
    )
  }

  const savedWatchLater = saved.includes(WATCH_LATER_ID)

  return (
    <div css={menuPanelStyle} role='presentation' ref={panelRef}>
      {view === 'root'
        ? (
          <>
            {/* Reports rather than toggles, for the same reason the save panel
                does: nothing upstream says whether the video is already in a
                list, and taking it back out needs a setVideoId that only a
                loaded playlist page carries. */}
            <MenuItem
              icon={savedWatchLater ? Check : Clock}
              label={savedWatchLater ? 'Saved to Watch later' : 'Save to Watch later'}
              disabled={!ready || pending !== undefined || savedWatchLater}
              onSelect={() => {
                // The source refuses this write before the network call, so a
                // signed-out save goes where it can be made to work instead.
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
              // Swaps the rows instead of acting, so the panel has to survive
              // the selection.
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
            {/* No "Not interested" row. There is no feedback mutation in the
                schema and no method behind one in the Source contract, so it
                could only ever be a row that swallows a click. */}
          </>
        )
        : (
          <>
            <MenuItem icon={ChevronLeft} label='Back' closeOnSelect={false} onSelect={() => setView('root')} />
            <MenuSeparator />
            {/* No visibility icon on these rows: the library feed parses to
                GridPlaylist and playlist lockups, neither of which carries a
                privacy, so SavePlaylists cannot select one without writing
                nulls over the cached entity. See that query in save-menu.tsx. */}
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
            {/* Placeholders are menu items rather than bare text so the row set
                is never empty: focus is moved onto a row on every swap, and an
                empty panel would leave it on a button that no longer exists. */}
            {fetching && rows.length === 0 ? <MenuItem label='Loading…' disabled /> : undefined}
            {error && rows.length === 0 ? <MenuItem label={readable(error.message)} disabled /> : undefined}
            {/* No "Create new playlist" row either. Creating one needs a name
                and a visibility, and privacy is only settable at creation, so
                it is a dialog rather than a row: that flow lives on the Save
                pill on /watch, where the choice is not being made from inside a
                hover menu over a card the reader was scrolling past. */}
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

/**
 * The overflow menu both card layouts hang off their `.more` button.
 *
 * `iconSize` is the only thing that differs between them: the compact card's
 * button is 2.4rem where the grid card's is 3.6rem, and an icon sized for one
 * looks wrong in the other.
 */
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
      // Named after the card, because a feed renders dozens of these and a
      // screen reader reading out "More actions" dozens of times says nothing
      // about which one it landed on.
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
        // Annotated because this project's JSX factory gives no contextual type
        // to a function passed as a component prop, so noImplicitAny trips.
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
    /* The independent scale property rather than a transform, and the
       transition names it directly.

       The two are not interchangeable here. A transition on transform holds
       that property at its start value for the duration, and reading it back
       mid-flight reports no scaling at all, which made this look inert. The
       scale property is not entangled with any other transform this element
       might carry, so nothing else can reset it. */
    transition: scale 0.18s ease, box-shadow 0.18s ease;
  }

  /* The hovered card grows, the way upstream's inline preview does.

     A transform rather than a width or a grid change: it must not reflow the
     row, or every neighbouring card would shuffle under the pointer while the
     reader is aiming at one of them. The card is lifted so it overlaps its
     neighbours instead of pushing them.

     The amount is small on purpose, and was measured off upstream rather than
     guessed: their thumbnail goes 533px to 553px on hover, about 4%, which is
     enough to read as "this one" while still landing inside the grid gutter so
     the neighbours stay whole. An earlier 1.18 here was sized to make the
     preview's scrubber grabbable, and that reasoning is obsolete: the strip is
     2.4rem tall in its own right now, so it no longer needs the card grown
     around it. What 1.18 actually did was take a 435px card to 525px and paint
     it over both neighbours, including their duration badges. */
  &.expanded .thumb {
    scale: 1.04;
    z-index: 2;
  }

  &.expanded {
    position: relative;
    z-index: 2;
  }

  /* The surface behind the WHOLE card, thumbnail and metadata together.

     This is what upstream has and what the grown card was missing: without it
     an enlarged thumbnail is just a picture that has outgrown its own caption
     and spilled toward whatever is next to it. With it, the card reads as one
     object lifted off the page, and the panel edge is what separates it from
     its neighbours rather than the neighbours simply being covered.

     Inset negatively so it reaches into the gutter, and drawn behind the card's
     own content: the root establishes the stacking context, so a negative
     z-index here sits under the thumbnail and text without escaping the card. */
  &.expanded::before {
    content: '';
    position: absolute;
    inset: -0.8rem -0.8rem -1.2rem;
    z-index: -1;
    border-radius: 1.6rem;
    background: var(--bg-elevated);
    box-shadow: 0 0.8rem 2.4rem rgb(0 0 0 / 45%);
  }

  /* Shorts are vertical, and a 16/9 box would letterbox one into a slot mostly
     made of background. The card keeps its grid column and only the thumbnail
     changes shape, so the surrounding layout is untouched. */
  &.short .thumb {
    aspect-ratio: 9 / 16;
  }

  /* A portrait card is already tall and narrow, so the same 4% costs it more
     absolute height than it costs a 16/9 card width. */
  &.short.expanded .thumb {
    scale: 1.03;
  }

  @media (prefers-reduced-motion: reduce) {
    .thumb {
      transition: none;
    }
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
  /* Separate from `previewing` because it answers a different question.

     The card grows the moment the pointer lands, not when the preview finally
     plays: a session takes a dwell delay plus a tunneled round trip to produce
     a first frame, and a card that sits inert for seconds before acknowledging
     the pointer reads as an unresponsive page rather than a loading one. The
     thumbnail is already the right picture, so it is what grows first and the
     video arrives inside it.

     It is also not gated on `canPreview`: a live or upcoming card has nothing
     to play but is still hovered, and growing only some of the cards in a grid
     would read as the others being broken. */
  const [expanded, setExpanded] = useState(false)
  const classes = [variant, video.isShort ? 'short' : undefined, expanded ? 'expanded' : undefined]
    .filter(Boolean)
    .join(' ')
  /* Pointer type rather than a media query: a touch device reports hover events
     on tap, which would start a session on the way to opening the video. An
     upcoming premiere has a page but nothing to play, so it has no preview
     either. */
  const canPreview = video.isUpcoming !== true && video.isLive !== true
  return (
    <article
      css={style}
      className={classes || undefined}
      {...prefetch}
      onPointerEnter={(event: TargetedPointerEvent<HTMLElement>) => {
        if (event.pointerType !== 'mouse') return
        setExpanded(true)
        if (canPreview) setPreviewing(true)
      }}
      onPointerLeave={() => {
        setPreviewing(false)
        setExpanded(false)
      }}
    >
      <Link href={watchHref} className='thumb' tabIndex={-1} aria-hidden='true'>
        {video.thumbnail ? <img src={video.thumbnail} alt='' loading='lazy' /> : undefined}
        {/* Mounted only while hovering: the component owns the session, so
            unmounting it is what tears the session down. */}
        {previewing ? <HoverPreview videoId={video.id} /> : undefined}
        {video.isLive
          ? <span className='badge live'>LIVE</span>
          : duration ? <span className='badge'>{duration}</span> : undefined}
        {/* After the badge so the resume bar wins wherever the two overlap. */}
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

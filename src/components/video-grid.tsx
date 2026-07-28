import type { ComponentChildren } from 'preact'

import type { VideoCardData, WatchContext } from './video-card'

import { css } from '@emotion/react'

import { VideoCard, VideoCardSkeleton } from './video-card'

/* Column width measured against upstream rather than picked: at a 1650px
   viewport they fit THREE across on both the home and channel grids, with
   thumbnails 438px and 420px wide and a 16px gutter. The 31rem/25.6rem minimums
   here fit four of roughly 300px in the same space, which is why every video
   read as small next to theirs - the cards were never the problem, the column
   count was. 38rem is the smallest minimum that lands on three where they land
   on three, and it degrades the same way theirs does as the window narrows. */
const style = css`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(38rem, 1fr));
  column-gap: 1.6rem;
  row-gap: 4rem;

  &.channel {
    grid-template-columns: repeat(auto-fill, minmax(38rem, 1fr));
    row-gap: 2.4rem;
  }

  @media (max-width: 500px) {
    grid-template-columns: 1fr;
  }
`

const FIRST_PAGE_SKELETONS = 12
const NEXT_PAGE_SKELETONS = 4

/* No paging props here. Every route already renders its own FeedSentinel as a
   sibling after the grid, together with the two guards that make it idempotent
   (an early return in onMore and an identity check when appending), so a grid
   that also owned one would fire the same page twice for any route that used
   both. `context` is forwarded rather than paged: it is the same for every card
   in one grid, whereas a per-row index is not, so a list that needs indices
   builds its own rows and passes context per card. */
/* One row on a wide screen. The shelf sits under the first row the way it does
   on youtube.com, rather than at the very top where it would push the grid down
   before the reader has seen a single video. */
const SHELF_AFTER = 4

export const VideoGrid = (
  { videos, fetching = false, variant, context, shelf }: {
    videos: VideoCardData[]
    fetching?: boolean
    variant?: 'channel'
    context?: WatchContext
    /* A full-width band dropped into the grid after the first row, which is
       where youtube.com puts the Shorts shelf. Rendered INSIDE the grid rather
       than above it so the rows above and below stay one continuous grid and
       keep their column alignment. */
    shelf?: ComponentChildren
  }
) => (
  <div css={style} className={variant}>
    {videos.slice(0, SHELF_AFTER).map(video => (
      <VideoCard key={video.id} video={video} variant={variant} context={context} />
    ))}
    {shelf}
    {videos.slice(SHELF_AFTER).map(video => (
      <VideoCard key={video.id} video={video} variant={variant} context={context} />
    ))}
    {/* A page loading under existing cards gets trailing placeholders only:
        replacing the whole grid with skeletons would rip the rows the reader is
        looking at out from under the scroll position. */}
    {fetching
      ? Array.from(
        { length: videos.length === 0 ? FIRST_PAGE_SKELETONS : NEXT_PAGE_SKELETONS },
        (_, index) => <VideoCardSkeleton key={`skeleton-${index}`} />,
      )
      : undefined}
  </div>
)

export default VideoGrid

import type { VideoCardData, WatchContext } from './video-card'

import { css } from '@emotion/react'

import { VideoCard, VideoCardSkeleton } from './video-card'

const style = css`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(31rem, 1fr));
  column-gap: 1.6rem;
  row-gap: 4rem;

  &.channel {
    grid-template-columns: repeat(auto-fill, minmax(25.6rem, 1fr));
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
export const VideoGrid = (
  { videos, fetching = false, variant, context }: {
    videos: VideoCardData[]
    fetching?: boolean
    variant?: 'channel'
    context?: WatchContext
  }
) => (
  <div css={style} className={variant}>
    {videos.map(video => <VideoCard key={video.id} video={video} variant={variant} context={context} />)}
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

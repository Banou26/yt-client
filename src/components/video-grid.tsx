import type { ComponentChildren } from 'preact'

import type { VideoCardData, WatchContext } from './video-card'

import { css } from '@emotion/react'

import { VideoCard, VideoCardSkeleton } from './video-card'

// 38rem is the smallest minimum that lands on three across at a 1650px viewport, where upstream lands on three
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

// No paging props here: every route already renders its own FeedSentinel as a sibling, so a grid that owned one would fire the same page twice
const SHELF_AFTER = 4

export const VideoGrid = (
  { videos, fetching = false, variant, context, shelf }: {
    videos: VideoCardData[]
    fetching?: boolean
    variant?: 'channel'
    context?: WatchContext
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
    {fetching
      ? Array.from(
        { length: videos.length === 0 ? FIRST_PAGE_SKELETONS : NEXT_PAGE_SKELETONS },
        (_, index) => <VideoCardSkeleton key={`skeleton-${index}`} />,
      )
      : undefined}
  </div>
)

export default VideoGrid

import type { VideoCardData } from './video-card'

import { css } from '@emotion/react'

import { FeedSentinel } from './use-infinite-feed'
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

export const VideoGrid = (
  { videos, fetching = false, variant, onMore, hasMore = false }: {
    videos: VideoCardData[]
    fetching?: boolean
    variant?: 'channel'
    onMore?: () => void
    hasMore?: boolean
  }
) => (
  <div css={style} className={variant}>
    {videos.map(video => <VideoCard key={video.id} video={video} variant={variant} />)}
    {/* A page loading under existing cards gets trailing placeholders only:
        replacing the whole grid with skeletons would rip the rows the reader is
        looking at out from under the scroll position. */}
    {fetching
      ? Array.from(
        { length: videos.length === 0 ? FIRST_PAGE_SKELETONS : NEXT_PAGE_SKELETONS },
        (_, index) => <VideoCardSkeleton key={`skeleton-${index}`} />,
      )
      : undefined}
    {onMore ? <FeedSentinel onVisible={onMore} disabled={!hasMore || fetching} /> : undefined}
  </div>
)

export default VideoGrid

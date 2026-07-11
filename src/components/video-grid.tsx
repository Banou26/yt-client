import type { VideoCardData } from './video-card'

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

export const VideoGrid = (
  { videos, fetching = false, variant }:
  { videos: VideoCardData[], fetching?: boolean, variant?: 'channel' }
) => (
  <div css={style} className={variant}>
    {videos.map(video => <VideoCard key={video.id} video={video} variant={variant} />)}
    {fetching && videos.length === 0
      ? Array.from({ length: 12 }, (_, index) => <VideoCardSkeleton key={index} />)
      : undefined}
  </div>
)

export default VideoGrid

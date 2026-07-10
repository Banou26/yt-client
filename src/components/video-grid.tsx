import type { Video } from '../generated/graphql'

import { css } from '@emotion/react'
import { Link } from 'wouter'

const grid = css`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 28px 18px;
`

const card = css`
  display: grid;
  gap: 10px;
`

const thumbnail = css`
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 10px;
  object-fit: cover;
  background: #181a1f;
`

const title = css`
  margin: 0;
  font-size: 0.98rem;
  line-height: 1.35;
`

const metadata = css`
  margin: 0;
  color: #989ba3;
  font-size: 0.84rem;
`

export const VideoGrid = ({ videos }: { videos: Video[] }) => (
  <div css={grid}>
    {videos.map((video) => (
      <article css={card} key={video.id}>
        <Link href={`/watch/${video.id}`}>
          {video.thumbnail ? <img css={thumbnail} src={video.thumbnail} alt="" /> : <div css={thumbnail} />}
        </Link>
        <div>
          <h2 css={title}><Link href={`/watch/${video.id}`}>{video.title}</Link></h2>
          {video.channel ? (
            <p css={metadata}>
              <Link href={`/channel/${video.channel.id}`}>{video.channel.name}</Link>
            </p>
          ) : null}
        </div>
      </article>
    ))}
  </div>
)

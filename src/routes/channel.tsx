import { css } from '@emotion/react'
import { useQuery } from 'urql'

import { SubscribeButton } from '../components/subscribe-button'
import { VideoGrid } from '../components/video-grid'
import { gql } from '../generated'

const CHANNEL_VIEW_QUERY = gql(`
  query ChannelView($id: ID!) {
    channel(id: $id) {
      channel {
        id
        name
        avatar
        handle
        subscriberCountText
        videoCountText
        banner
        description
        isSubscribed
        notificationLevel
      }
      videos {
        items {
          id
          title
          thumbnail
          durationSeconds
          viewCount
          publishedText
          isLive
        }
      }
    }
  }
`)

const TABS = ['Home', 'Videos', 'Shorts', 'Playlists']
const ACTIVE_TAB = 'Videos'

const style = css`
  max-width: 128.4rem;
  margin: 0 auto;
  padding: 2.4rem 1.6rem;

  .banner {
    display: block;
    width: 100%;
    aspect-ratio: 6.2 / 1;
    border-radius: 1.2rem;
    object-fit: cover;
    background: var(--bg-elevated);
  }

  .header {
    display: flex;
    align-items: center;
    gap: 2.4rem;
    margin-top: 2.4rem;
  }

  .avatar {
    flex: none;
    width: 16rem;
    height: 16rem;
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
    font-size: 6.4rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .info {
    flex: 1;
    min-width: 0;
  }

  .name {
    font-size: 3.6rem;
    font-weight: 700;
    line-height: 5rem;
    color: var(--text-primary);
  }

  .meta {
    margin-top: 0.4rem;
    font-size: 1.4rem;
    color: var(--text-secondary);
  }

  .description {
    margin-top: 0.8rem;
    font-size: 1.4rem;
    color: var(--text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .subscribe-row {
    margin-top: 1.2rem;
  }

  .tabs {
    display: flex;
    gap: 2.4rem;
    margin-top: 2.4rem;
    border-bottom: 1px solid var(--border-subtle);
  }

  .tab {
    margin-bottom: -0.1rem;
    padding: 1.2rem 0;
    border: none;
    border-bottom: 0.2rem solid transparent;
    background: transparent;
    color: var(--text-secondary);
    font-size: 1.5rem;
    font-weight: 500;
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .tab:hover {
    color: var(--text-primary);
  }

  .tab.active {
    color: var(--text-primary);
    border-bottom-color: var(--text-primary);
  }

  .videos {
    margin-top: 2.4rem;
  }

  .status {
    margin-top: 2.4rem;
    color: var(--text-secondary);
  }

  @media (max-width: 768px) {
    .header {
      flex-direction: column;
      align-items: center;
      text-align: center;
    }

    .avatar {
      width: 9.6rem;
      height: 9.6rem;
    }

    .avatar.fallback {
      font-size: 4rem;
    }

    .name {
      font-size: 2.4rem;
      line-height: 3.2rem;
    }
  }
`

export const ChannelPage = ({ params }: { params: { channelId: string } }) => {
  const [{ data, error, fetching }] = useQuery({ query: CHANNEL_VIEW_QUERY, variables: { id: params.channelId } })
  const channel = data?.channel.channel
  const videos = data?.channel.videos.items ?? []
  const handle = channel?.handle
    ? channel.handle.startsWith('@') ? channel.handle : `@${channel.handle}`
    : undefined
  const metaParts = [handle, channel?.subscriberCountText, channel?.videoCountText]
    .filter(part => part != null && part.length > 0)
  const meta = metaParts.length > 0 ? metaParts.join(' • ') : undefined
  return (
    <main css={style}>
      {channel?.banner ? <img className='banner' src={channel.banner} alt='' /> : undefined}
      {channel
        ? (
          <header className='header'>
            <div className={channel.avatar ? 'avatar' : 'avatar fallback'}>
              {channel.avatar
                ? <img src={channel.avatar} alt='' />
                : channel.name.slice(0, 1).toUpperCase()}
            </div>
            <div className='info'>
              <h1 className='name'>{channel.name}</h1>
              {meta ? <p className='meta'>{meta}</p> : undefined}
              {channel.description ? <p className='description'>{channel.description}</p> : undefined}
              <div className='subscribe-row'>
                <SubscribeButton
                  channelId={channel.id}
                  subscribed={channel.isSubscribed}
                  notificationLevel={channel.notificationLevel}
                />
              </div>
            </div>
          </header>
        )
        : undefined}
      {error ? <p className='status'>{error.message}</p> : undefined}
      <nav className='tabs' aria-label='Channel sections'>
        {TABS.map(tab => (
          <button
            key={tab}
            type='button'
            className={tab === ACTIVE_TAB ? 'tab active' : 'tab'}
          >
            {tab}
          </button>
        ))}
      </nav>
      <div className='videos'>
        <VideoGrid videos={videos} fetching={fetching && !data} variant='channel' />
        {data && !fetching && !error && videos.length === 0
          ? <p className='status'>This channel has no videos.</p>
          : undefined}
      </div>
    </main>
  )
}

export default ChannelPage

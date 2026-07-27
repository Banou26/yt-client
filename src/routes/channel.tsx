import type { ChannelTab, ChannelViewQuery } from '../generated/graphql'

import { css } from '@emotion/react'
import { useState } from 'preact/hooks'
import { useQuery } from 'urql'
import { useLocation, useSearch } from 'wouter'

import { useDocumentTitle } from '../app'
import { SubscribeButton } from '../components/subscribe-button'
import { FeedSentinel, useInfiniteFeed } from '../components/use-infinite-feed'
import { VideoGrid } from '../components/video-grid'
import { gql } from '../generated'

type VideosPage = ChannelViewQuery['channel']['videos']

const CHANNEL_VIEW_QUERY = gql(`
  query ChannelView($id: ID!, $tab: ChannelTab, $sort: String, $query: String, $cursor: String) {
    channel(id: $id, tab: $tab, sort: $sort, query: $query, cursor: $cursor) {
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
          isUpcoming
          badges
        }
        cursor
      }
      availableTabs
      tab
      sortOptions
      appliedSort
    }
  }
`)

// Upstream reports which tabs a channel actually has, so the strip renders that
// set rather than a fixed one. The label is ours because the enum is not
// display text; the order comes from the source, which keeps upstream's.
const TAB_LABELS: Record<ChannelTab, string> = {
  HOME: 'Home',
  VIDEOS: 'Videos',
  SHORTS: 'Shorts',
  LIVE: 'Live',
  RELEASES: 'Releases',
  PODCASTS: 'Podcasts',
  COURSES: 'Courses',
  PLAYLISTS: 'Playlists',
  COMMUNITY: 'Community',
  SEARCH: 'Search',
}

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

  /* Only rendered when the tab offers more than one ordering, so it never shows
     a single dead option next to itself. The labels are upstream's own and are
     already localized. */
  .sorts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
    padding: 1.6rem 0 0;
  }

  .sort {
    height: 3.2rem;
    padding: 0 1.2rem;
    border: none;
    border-radius: 0.8rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .sort:hover {
    background: var(--bg-chip-hover);
  }

  .sort.active {
    background: var(--bg-inverse);
    color: var(--text-inverse);
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
  const id = params.channelId
  // The channel id stays a path param, matching youtube.com, while the tab and
  // its options ride in the query string: they address a view of the same page
  // rather than a different page, and that keeps a tab shareable.
  const search = useSearch()
  const urlParams = new URLSearchParams(search)
  const [, navigate] = useLocation()
  const tab = (urlParams.get('tab') ?? undefined) as ChannelTab | undefined
  const sort = urlParams.get('sort') ?? undefined
  const channelQuery = urlParams.get('query') ?? undefined
  // Consumed pages carry the channel they came from, so switching channels
  // starts from an empty grid in the same render rather than one frame later.
  // The tab, sort and in-channel query are part of the feed identity: switching
  // any of them has to restart paging rather than append one tab's rows under
  // another's.
  const feedKey = `${id}|${tab ?? ''}|${sort ?? ''}|${channelQuery ?? ''}`
  const [loaded, setLoaded] = useState<{ id: string, pages: VideosPage[] }>({ id: feedKey, pages: [] })
  const pages = loaded.id === feedKey ? loaded.pages : []
  const [{ data, error, fetching }] = useQuery({
    query: CHANNEL_VIEW_QUERY,
    variables: { id, tab, sort, query: channelQuery, cursor: pages[pages.length - 1]?.cursor }
  })
  const channel = data?.channel.channel
  const page = data?.channel.videos
  // urql keeps the previous result while the next page is in flight, so the
  // live page can repeat one already consumed: useInfiniteFeed dedupes by id.
  const { items, cursor } = useInfiniteFeed({
    pages: page ? [...pages, page] : pages,
    key: video => video.id
  })
  useDocumentTitle(channel?.name ?? 'Channel')
  const handle = channel?.handle
    ? channel.handle.startsWith('@') ? channel.handle : `@${channel.handle}`
    : undefined
  const metaParts = [handle, channel?.subscriberCountText, channel?.videoCountText]
    .filter(part => part != null && part.length > 0)
  const meta = metaParts.length > 0 ? metaParts.join(' • ') : undefined

  // One writer for every view parameter, so a tab switch always clears the sort
  // and query that belonged to the previous tab: upstream's sort labels differ
  // per tab, and carrying one across would send an option the new tab rejects.
  const setView = (param: 'tab' | 'sort', value: string) => {
    const next = new URLSearchParams(search)
    if (param === 'tab') {
      next.delete('sort')
      next.delete('query')
    }
    if (next.get(param) === value) next.delete(param)
    else next.set(param, value)
    const rest = next.toString()
    navigate(rest ? `/channel/${id}?${rest}` : `/channel/${id}`)
  }

  const onMore = () => {
    if (!page?.cursor || fetching) return
    setLoaded({ id: feedKey, pages: pages[pages.length - 1] === page ? pages : [...pages, page] })
  }

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
        {(data?.channel.availableTabs ?? []).map(available => {
          const active = available === data?.channel.tab
          return (
            <button
              key={available}
              type='button'
              className={active ? 'tab active' : 'tab'}
              aria-current={active ? 'page' : undefined}
              onClick={() => setView('tab', available)}
            >
              {TAB_LABELS[available]}
            </button>
          )
        })}
      </nav>
      {(data?.channel.sortOptions.length ?? 0) > 1
        ? (
          <div className='sorts'>
            {data?.channel.sortOptions.map(option => {
              const active = option === (data.channel.appliedSort ?? data.channel.sortOptions[0])
              return (
                <button
                  key={option}
                  type='button'
                  className={active ? 'sort active' : 'sort'}
                  aria-pressed={active}
                  onClick={() => setView('sort', option)}
                >
                  {option}
                </button>
              )
            })}
          </div>
        )
        : undefined}
      <div className='videos'>
        <VideoGrid videos={items} fetching={fetching && items.length === 0} variant='channel' />
        {data && !fetching && !error && items.length === 0
          ? <p className='status'>This channel has no videos.</p>
          : undefined}
      </div>
      {fetching && items.length > 0 ? <p className='status'>Loading more…</p> : undefined}
      <FeedSentinel onVisible={onMore} disabled={fetching || !cursor} />
    </main>
  )
}

export default ChannelPage

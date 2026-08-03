import type { ChannelTab, ChannelViewQuery, CommunityPostsQuery } from '../generated/graphql'

import { css } from '@emotion/react'
import { useState } from 'preact/hooks'
import { useQuery } from 'urql'
import { Link, useLocation, useSearch } from 'wouter'

import { useDocumentTitle } from '../app'
import { PlaylistCard } from '../components/playlist-card'
import { SubscribeButton } from '../components/subscribe-button'
import { FeedSentinel, useInfiniteFeed } from '../components/use-infinite-feed'
import { VideoCardCompact } from '../components/video-card-compact'
import { VideoGrid } from '../components/video-grid'
import { gql } from '../generated'

type VideosPage = ChannelViewQuery['channel']['videos']
type PostsPage = CommunityPostsQuery['communityPosts']

const CHANNEL_ABOUT_QUERY = gql(`
  query ChannelAbout($id: ID!) {
    channelAbout(id: $id) {
      description
      country
      joinedDateText
      viewCountText
      subscriberCountText
      videoCountText
      canonicalUrl
      links { title url }
    }
  }
`)

const COMMUNITY_POSTS_QUERY = gql(`
  query CommunityPosts($channelId: ID!, $cursor: String) {
    communityPosts(channelId: $channelId, cursor: $cursor) {
      items {
        id
        text
        publishedText
        voteCountText
        attachedImage
        author { id name avatar }
        attachedVideo {
          id
          title
          thumbnail
          thumbnailSrcset
          durationSeconds
          viewCount
          publishedText
          channel { id name }
        }
      }
      cursor
    }
  }
`)

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
          thumbnailSrcset
          durationSeconds
          viewCount
          publishedText
          isLive
          isShort
          isUpcoming
          badges
        }
        playlists {
          id
          title
          thumbnail
          videoCountText
          updatedText
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
  ABOUT: 'About',
  SEARCH: 'Search',
}

const emptyMessageFor = (tab?: ChannelTab) => {
  if (tab === undefined || tab === 'VIDEOS' || tab === 'HOME') return 'This channel has no videos.'
  if (tab === 'SHORTS') return 'This channel has no shorts.'
  if (tab === 'LIVE') return 'This channel has no live streams.'
  return `This channel has nothing under ${TAB_LABELS[tab]}.`
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

  /* Matches the video grid's column sizing so a Playlists tab lines up with the
     Videos tab beside it in the strip. */
  .playlist-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(38rem, 1fr));
    column-gap: 1.6rem;
    row-gap: 2.4rem;
  }

  /* A single readable column rather than a grid: a post is a body of text, and
     the video grid's card width would set the measure far too wide. */
  .posts {
    display: flex;
    flex-direction: column;
    gap: 1.6rem;
    max-width: 68rem;
  }

  .post {
    padding: 1.6rem;
    border: 1px solid var(--border-subtle);
    border-radius: 1.2rem;
  }

  .post-head {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    font-size: 1.3rem;
    color: var(--text-secondary);
  }

  .post-author {
    display: inline-flex;
    align-items: center;
    gap: 0.8rem;
    color: var(--text-primary);
    font-weight: 500;
  }

  .post-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 50%;
    object-fit: cover;
    background: var(--bg-chip);
    font-size: 1.1rem;
  }

  .post-text {
    margin: 1.2rem 0 0;
    font-size: 1.4rem;
    line-height: 2rem;
    color: var(--text-primary);
    white-space: pre-wrap;
  }

  .post-image {
    display: block;
    width: 100%;
    margin-top: 1.2rem;
    border-radius: 0.8rem;
  }

  .post-votes {
    margin-top: 1.2rem;
    font-size: 1.3rem;
    color: var(--text-secondary);
  }

  .about {
    max-width: 68rem;
  }

  .about-description {
    margin: 0;
    font-size: 1.4rem;
    line-height: 2.2rem;
    color: var(--text-primary);
    white-space: pre-wrap;
  }

  .about-stats {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.8rem 2.4rem;
    margin: 2.4rem 0 0;
    font-size: 1.4rem;
  }

  .about-stats > div {
    display: contents;
  }

  .about-stats dt {
    color: var(--text-secondary);
  }

  .about-stats dd {
    margin: 0;
    color: var(--text-primary);
  }

  .about-links {
    display: flex;
    flex-wrap: wrap;
    gap: 1.6rem;
    margin: 2.4rem 0 0;
    padding: 0;
    list-style: none;
  }

  .about-links a {
    color: var(--accent);
    font-size: 1.4rem;
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

export const ChannelPage = ({ params }: { params: { channelId?: string, handle?: string } }) => {
  const id = params.channelId ?? `@${params.handle ?? ''}`
  const search = useSearch()
  const urlParams = new URLSearchParams(search)
  const [, navigate] = useLocation()
  const tab = (urlParams.get('tab') ?? undefined) as ChannelTab | undefined
  const sort = urlParams.get('sort') ?? undefined
  const channelQuery = urlParams.get('query') ?? undefined
  // tab, sort and in-channel query are part of the feed identity: switching any of them MUST restart paging
  const feedKey = `${id}|${tab ?? ''}|${sort ?? ''}|${channelQuery ?? ''}`
  const [loaded, setLoaded] = useState<{ id: string, pages: VideosPage[] }>({ id: feedKey, pages: [] })
  const pages = loaded.id === feedKey ? loaded.pages : []
  const [{ data, error, fetching }] = useQuery({
    query: CHANNEL_VIEW_QUERY,
    variables: { id, tab, sort, query: channelQuery, cursor: pages[pages.length - 1]?.cursor }
  })
  const channel = data?.channel.channel
  const page = data?.channel.videos
  const { items, cursor } = useInfiniteFeed({
    pages: page ? [...pages, page] : pages,
    key: video => video.id
  })
  const { items: playlists } = useInfiniteFeed({
    pages: (page ? [...pages, page] : pages).map(entry => ({ items: entry.playlists, cursor: entry.cursor })),
    key: playlist => playlist.id,
  })
  useDocumentTitle(channel?.name ?? 'Channel')
  const handle = channel?.handle
    ? channel.handle.startsWith('@') ? channel.handle : `@${channel.handle}`
    : undefined
  const metaParts = [handle, channel?.subscriberCountText, channel?.videoCountText]
    .filter(part => part != null && part.length > 0)
  const meta = metaParts.length > 0 ? metaParts.join(' • ') : undefined

  // a tab switch MUST clear sort and query: upstream's sort labels differ per tab and the new tab rejects the old one
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

  const activeTab = data?.channel.tab
  const [{ data: aboutData, fetching: aboutFetching }] = useQuery({
    query: CHANNEL_ABOUT_QUERY,
    variables: { id },
    pause: activeTab !== 'ABOUT',
  })
  const about = aboutData?.channelAbout
  const aboutStats: [string, string][] = about
    ? ([
      ['Joined', about.joinedDateText],
      ['Country', about.country],
      ['Subscribers', about.subscriberCountText],
      ['Videos', about.videoCountText],
      ['Views', about.viewCountText],
    ] as const)
      .flatMap(([label, value]) => (value ? [[label, value] as [string, string]] : []))
    : []

  const [postPages, setPostPages] = useState<PostsPage[]>([])
  const [{ data: postsData, fetching: postsFetching }] = useQuery({
    query: COMMUNITY_POSTS_QUERY,
    variables: { channelId: id, cursor: postPages[postPages.length - 1]?.cursor },
    pause: activeTab !== 'COMMUNITY',
  })
  const postPage = postsData?.communityPosts
  const { items: posts, cursor: postsCursor } = useInfiniteFeed({
    pages: postPage ? [...postPages, postPage] : postPages,
    key: post => post.id,
  })

  const onMorePosts = () => {
    if (!postPage?.cursor || postsFetching) return
    setPostPages(postPages[postPages.length - 1] === postPage ? postPages : [...postPages, postPage])
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
      {activeTab === 'COMMUNITY'
        ? (
          <div className='videos'>
            <div className='posts'>
              {posts.map(post => (
                <article className='post' key={post.id}>
                  <div className='post-head'>
                    {post.author
                      ? (
                        <Link href={`/channel/${post.author.id}`} className='post-author'>
                          {post.author.avatar
                            ? <img className='post-avatar' src={post.author.avatar} alt='' loading='lazy' />
                            : <span className='post-avatar' aria-hidden='true'>{post.author.name.slice(0, 1)}</span>}
                          <span>{post.author.name}</span>
                        </Link>
                      )
                      : undefined}
                    {post.publishedText ? <span className='post-date'>{post.publishedText}</span> : undefined}
                  </div>
                  {post.text ? <p className='post-text'>{post.text}</p> : undefined}
                  {post.attachedImage
                    ? <img className='post-image' src={post.attachedImage} alt='' loading='lazy' />
                    : undefined}
                  {post.attachedVideo ? <VideoCardCompact video={post.attachedVideo} /> : undefined}
                  {post.voteCountText ? <div className='post-votes'>{post.voteCountText}</div> : undefined}
                </article>
              ))}
            </div>
            {!postsFetching && posts.length === 0
              ? <p className='status'>This channel has no posts.</p>
              : undefined}
            <FeedSentinel onVisible={onMorePosts} disabled={postsFetching || !postsCursor} />
          </div>
        )
        : activeTab === 'ABOUT'
          ? (
            <div className='videos about'>
              {about?.description ? <p className='about-description'>{about.description}</p> : undefined}
              <dl className='about-stats'>
                {aboutStats.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              {about && about.links.length > 0
                ? (
                  <ul className='about-links'>
                    {about.links.map(link => (
                      <li key={link.url}>
                        <a href={link.url} target='_blank' rel='noreferrer noopener'>{link.title}</a>
                      </li>
                    ))}
                  </ul>
                )
                : undefined}
              {!aboutFetching && !about ? <p className='status'>This channel has no About panel.</p> : undefined}
            </div>
          )
          : (
            <>
              <div className='videos'>
                <VideoGrid videos={items} fetching={fetching && items.length === 0} variant='channel' />
                {playlists.length > 0
                  ? (
                    <div className='playlist-grid'>
                      {playlists.map(playlist => (
                        <PlaylistCard
                          key={playlist.id}
                          id={playlist.id}
                          title={playlist.title}
                          thumbnail={playlist.thumbnail}
                          videoCountText={playlist.videoCountText}
                          updatedText={playlist.updatedText}
                        />
                      ))}
                    </div>
                  )
                  : undefined}
                {data && !fetching && !error && items.length === 0 && playlists.length === 0
                  ? <p className='status'>{emptyMessageFor(tab)}</p>
                  : undefined}
              </div>
              {fetching && items.length > 0 ? <p className='status'>Loading more…</p> : undefined}
              <FeedSentinel onVisible={onMore} disabled={fetching || !cursor} />
            </>
          )}
    </main>
  )
}

export default ChannelPage

import type { SubscriptionsFeedQuery } from '../generated/graphql'

import { css } from '@emotion/react'
import { CircleUserRound } from 'lucide-react'
import { useState } from 'preact/hooks'
import { useQuery } from 'urql'
import { useLocation } from 'wouter'

import { useDocumentTitle } from '../app'
import { FeedSentinel, useInfiniteFeed } from '../components/use-infinite-feed'
import { VideoGrid } from '../components/video-grid'
import { gql } from '../generated'
import { useSession } from '../session'

const SUBSCRIPTIONS_FEED_QUERY = gql(`
  query SubscriptionsFeed($cursor: String) {
    subscriptions(cursor: $cursor) {
      items {
        id
        title
        thumbnail
        durationSeconds
        viewCount
        publishedText
        isLive
        progressPercent
        channel { id name avatar }
      }
      cursor
    }
  }
`)

type SubscriptionsPage = SubscriptionsFeedQuery['subscriptions']

// urql prefixes a GraphQL error message with its kind; the user only needs the
// sentence the source wrote.
const readable = (message: string) => message.replace(/^\[\w+]\s*/, '')

const style = css`
  padding: 2.4rem 1.6rem;

  .heading {
    margin: 0 0 2.4rem;
    font-size: 2rem;
    font-weight: 700;
    line-height: 2.8rem;
    color: var(--text-primary);
  }

  .notice {
    padding: 2.4rem 0;
    font-size: 1.4rem;
    color: var(--text-secondary);
    text-align: center;
  }

  .card {
    max-width: 56rem;
    margin: 4.8rem auto 0;
    padding: 2.4rem;
    border-radius: 1.2rem;
    background: var(--bg-subtle);
    text-align: center;
  }

  .card h2 {
    margin: 0 0 0.8rem;
    font-size: 2rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .card p {
    margin: 0;
    font-size: 1.4rem;
    color: var(--text-secondary);
  }

  .sign-in {
    display: inline-flex;
    align-items: center;
    gap: 0.8rem;
    height: 3.6rem;
    margin-top: 1.6rem;
    padding: 0 1.5rem;
    border: 1px solid var(--border-strong);
    border-radius: 1.8rem;
    background: transparent;
    color: var(--accent);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .sign-in:hover {
    background: var(--accent-hover);
    border-color: transparent;
  }
`

const SubscriptionsFeedPage = () => {
  useDocumentTitle('Subscriptions')
  const [, navigate] = useLocation()
  const { ready, signedIn } = useSession()
  const [loaded, setLoaded] = useState<SubscriptionsPage[]>([])
  const [{ data, error, fetching }] = useQuery({
    query: SUBSCRIPTIONS_FEED_QUERY,
    variables: { cursor: loaded[loaded.length - 1]?.cursor },
    // The source refuses this feed before the network call when signed out, and
    // errors are unmasked, so that refusal would land in the UI verbatim.
    pause: !ready || !signedIn
  })
  const page = data?.subscriptions
  // urql keeps the previous result while the next page is in flight, so the
  // live page can repeat one already consumed: useInfiniteFeed dedupes by id.
  const { items, cursor } = useInfiniteFeed({
    pages: page ? [...loaded, page] : loaded,
    key: video => video.id
  })

  const onMore = () => {
    if (!page?.cursor || fetching || error) return
    setLoaded(previous => previous[previous.length - 1] === page ? previous : [...previous, page])
  }

  if (!ready) {
    return (
      <main css={style}>
        <h1 className='heading'>Subscriptions</h1>
        <VideoGrid videos={[]} fetching />
      </main>
    )
  }

  if (!signedIn) {
    return (
      <main css={style}>
        <h1 className='heading'>Subscriptions</h1>
        <div className='card'>
          <h2>Sign in to see your subscriptions</h2>
          <p>The newest videos from the channels you follow show up here once you are signed in.</p>
          <button type='button' className='sign-in' onClick={() => navigate('/signin')}>
            <CircleUserRound size={24} strokeWidth={1.5} />
            Sign in
          </button>
        </div>
      </main>
    )
  }

  return (
    <main css={style}>
      <h1 className='heading'>Subscriptions</h1>
      {error && items.length === 0 ? <p className='notice'>{readable(error.message)}</p> : undefined}
      {data && !fetching && !error && items.length === 0
        ? (
          <div className='card'>
            <h2>No new videos</h2>
            <p>Subscribe to a channel and its latest uploads collect here.</p>
          </div>
        )
        : <VideoGrid videos={items} fetching={fetching && items.length === 0} />}
      {error && items.length > 0 ? <p className='notice'>Could not load more videos.</p> : undefined}
      {fetching && items.length > 0 ? <p className='notice'>Loading more…</p> : undefined}
      <FeedSentinel onVisible={onMore} disabled={fetching || Boolean(error) || !cursor} />
    </main>
  )
}

export default SubscriptionsFeedPage

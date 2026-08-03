import type { WatchHistoryQuery } from '../generated/graphql'

import { css } from '@emotion/react'
import { CircleUserRound, X } from 'lucide-react'
import { useState } from 'preact/hooks'
import { useMutation, useQuery } from 'urql'
import { useLocation } from 'wouter'

import { useDocumentTitle } from '../app'
import { readable } from '../components/format'
import { showToast } from '../components/ui/toast'
import { FeedSentinel, useInfiniteFeed } from '../components/use-infinite-feed'
import { VideoCardCompact, VideoCardCompactSkeleton } from '../components/video-card-compact'
import { gql } from '../generated'
import { useSession } from '../session'

const WATCH_HISTORY_QUERY = gql(`
  query WatchHistory($cursor: String) {
    history(cursor: $cursor) {
      sections {
        title
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
          progressPercent
          channel { id name avatar }
        }
      }
      cursor
    }
  }
`)

const REMOVE_FROM_HISTORY = gql(`
  mutation RemoveFromHistory($videoId: ID!) {
    removeFromHistory(videoId: $videoId)
  }
`)

type HistoryPage = WatchHistoryQuery['history']
type HistoryVideo = HistoryPage['sections'][number]['items'][number] & { sectionTitle: string }
type HistorySection = { title: string, items: HistoryVideo[] }

const SKELETON_ROWS = 8

const style = css`
  max-width: 88rem;
  padding: 2.4rem 1.6rem;

  .heading {
    margin: 0 0 2.4rem;
    font-size: 2rem;
    font-weight: 700;
    line-height: 2.8rem;
    color: var(--text-primary);
  }

  .section + .section {
    margin-top: 3.2rem;
  }

  .section-title {
    margin: 0 0 1.6rem;
    font-size: 1.6rem;
    font-weight: 500;
    line-height: 2.2rem;
    color: var(--text-primary);
  }

  .entries {
    display: flex;
    flex-direction: column;
    gap: 1.6rem;
  }

  .entry {
    display: flex;
    align-items: flex-start;
    gap: 0.8rem;
  }

  .card {
    flex: 1;
    min-width: 0;
  }

  .remove {
    flex: none;
    width: 2.4rem;
    height: 2.4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    opacity: 0;
    transition: background 0.15s ease, opacity 0.15s ease;
  }

  .entry:hover .remove,
  .remove:focus-visible {
    opacity: 1;
  }

  .remove:hover {
    background: var(--bg-hover);
  }

  .remove:disabled {
    cursor: default;
  }

  .notice {
    padding: 2.4rem 0;
    font-size: 1.4rem;
    color: var(--text-secondary);
    text-align: center;
  }

  .prompt {
    max-width: 56rem;
    margin: 4.8rem auto 0;
    padding: 2.4rem;
    border-radius: 1.2rem;
    background: var(--bg-subtle);
    text-align: center;
  }

  .prompt h2 {
    margin: 0 0 0.8rem;
    font-size: 2rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .prompt p {
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

const HistoryFeedPage = () => {
  useDocumentTitle('History')
  const [, navigate] = useLocation()
  const { ready, signedIn } = useSession()
  const [loaded, setLoaded] = useState<HistoryPage[]>([])
  const [{ data, error, fetching }] = useQuery({
    query: WATCH_HISTORY_QUERY,
    variables: { cursor: loaded[loaded.length - 1]?.cursor },
    // the source refuses this feed when signed out and errors are unmasked, so the refusal would land in the UI verbatim
    pause: !ready || !signedIn
  })
  const [, removeFromHistory] = useMutation(REMOVE_FROM_HISTORY)
  const [removed, setRemoved] = useState<Set<string>>(() => new Set())
  const [removing, setRemoving] = useState<string[]>([])

  const page = data?.history
  const { items, cursor } = useInfiniteFeed({
    pages: (page ? [...loaded, page] : loaded).map(entry => ({
      items: entry.sections.flatMap(section =>
        section.items.map(video => ({ ...video, sectionTitle: section.title ?? '' }))),
      cursor: entry.cursor
    })),
    key: video => video.id
  })

  const sections: HistorySection[] = []
  const byTitle = new Map<string, HistorySection>()
  for (const video of items) {
    if (removed.has(video.id)) continue
    let section = byTitle.get(video.sectionTitle)
    if (!section) {
      section = { title: video.sectionTitle, items: [] }
      byTitle.set(video.sectionTitle, section)
      sections.push(section)
    }
    section.items.push(video)
  }

  const onMore = () => {
    if (!page?.cursor || fetching || error) return
    setLoaded(previous => previous[previous.length - 1] === page ? previous : [...previous, page])
  }

  const onRemove = (videoId: string) => {
    if (removing.includes(videoId)) return
    setRemoving(previous => [...previous, videoId])
    void removeFromHistory({ videoId }).then((result) => {
      setRemoving(previous => previous.filter(id => id !== videoId))
      if (result.error) {
        showToast(readable(result.error.message))
        return
      }
      setRemoved(previous => new Set(previous).add(videoId))
      showToast('Removed from watch history')
    })
  }

  if (!ready) {
    return (
      <main css={style}>
        <h1 className='heading'>Watch history</h1>
        <div className='entries'>
          {Array.from({ length: SKELETON_ROWS }, (_, index) => <VideoCardCompactSkeleton key={index} />)}
        </div>
      </main>
    )
  }

  if (!signedIn) {
    return (
      <main css={style}>
        <h1 className='heading'>Watch history</h1>
        <div className='prompt'>
          <h2>Keep track of what you watch</h2>
          <p>Watch history belongs to your account, so sign in to see it and manage it here.</p>
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
      <h1 className='heading'>Watch history</h1>
      {error && items.length === 0 ? <p className='notice'>{readable(error.message)}</p> : undefined}
      {fetching && items.length === 0
        ? (
          <div className='entries'>
            {Array.from({ length: SKELETON_ROWS }, (_, index) => <VideoCardCompactSkeleton key={index} />)}
          </div>
        )
        : undefined}
      {sections.map(section => (
        <section className='section' key={section.title}>
          {section.title ? <h2 className='section-title'>{section.title}</h2> : undefined}
          <div className='entries'>
            {section.items.map(video => (
              <div className='entry' key={video.id}>
                <div className='card'>
                  <VideoCardCompact video={video} />
                </div>
                <button
                  type='button'
                  className='remove'
                  aria-label={`Remove ${video.title} from watch history`}
                  disabled={removing.includes(video.id)}
                  onClick={() => onRemove(video.id)}
                >
                  <X size={16} strokeWidth={1.5} />
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
      {data && !fetching && !error && sections.length === 0
        ? (
          <div className='prompt'>
            <h2>Nothing watched yet</h2>
            <p>Videos you watch collect here, so you can pick one back up where you left it.</p>
          </div>
        )
        : undefined}
      {error && items.length > 0 ? <p className='notice'>Could not load more of your history.</p> : undefined}
      {fetching && items.length > 0 ? <p className='notice'>Loading more…</p> : undefined}
      <FeedSentinel onVisible={onMore} disabled={fetching || Boolean(error) || !cursor} />
    </main>
  )
}

export default HistoryFeedPage

import { css } from '@emotion/react'
import { useEffect, useRef } from 'preact/hooks'

type FeedPage<Item> = { items: Item[], cursor?: string | null }

// Continuations overlap: the same video or comment routinely comes back on the
// next page, and a repeated key makes preact reconcile two cards onto one slot.
// Every consumer therefore flattens through this one key set instead of
// concatenating pages.
export const useInfiniteFeed = <Item,>(
  { pages, key }: { pages: FeedPage<Item>[], key: (item: Item) => string },
) => {
  const items: Item[] = []
  const seen = new Set<string>()
  for (const page of pages) {
    for (const item of page.items) {
      const id = key(item)
      if (seen.has(id)) continue
      seen.add(id)
      items.push(item)
    }
  }
  // Only the newest page can extend the feed, earlier cursors are spent.
  return { items, cursor: pages[pages.length - 1]?.cursor ?? undefined }
}

const sentinelStyle = css`
  /* Spans the row so the probe never claims a card slot in a grid parent. */
  grid-column: 1 / -1;
  height: 0.1rem;
`

// Roughly two rows of lookahead: the next page is usually in hand by the time
// the last visible row scrolls up, so the feed never shows a stall.
const ROOT_MARGIN = '1200px 0px'

export const FeedSentinel = ({ onVisible, disabled }: { onVisible: () => void, disabled?: boolean }) => {
  const ref = useRef<HTMLDivElement>(null)
  const onVisibleRef = useRef(onVisible)
  // Callers pass an inline closure, so holding it in a ref keeps a parent
  // re-render from tearing down and re-arming the observer, which would fire
  // onVisible again for a page already in flight.
  onVisibleRef.current = onVisible

  useEffect(() => {
    const node = ref.current
    if (!node || disabled) return
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) onVisibleRef.current()
      },
      { rootMargin: ROOT_MARGIN },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [disabled])

  return <div css={sentinelStyle} ref={ref} aria-hidden='true' />
}

export default useInfiniteFeed

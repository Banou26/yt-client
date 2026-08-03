import { css } from '@emotion/react'
import { useEffect, useRef } from 'preact/hooks'

type FeedPage<Item> = { items: Item[], cursor?: string | null }

// continuations overlap, so every consumer flattens through this key set rather than concatenating pages
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
  return { items, cursor: pages[pages.length - 1]?.cursor ?? undefined }
}

const sentinelStyle = css`
  /* Spans the row so the probe never claims a card slot in a grid parent. */
  grid-column: 1 / -1;
  height: 0.1rem;
`

const ROOT_MARGIN = '1200px 0px'

export const FeedSentinel = ({ onVisible, disabled }: { onVisible: () => void, disabled?: boolean }) => {
  const ref = useRef<HTMLDivElement>(null)
  const onVisibleRef = useRef(onVisible)
  // held in a ref so a parent re-render does not re-arm the observer and fire onVisible again for a page already in flight
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

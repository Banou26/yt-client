import { useRef } from 'preact/hooks'

import { startEngine } from '../scramjet/client'

// Kick (and memoize, in the frame) a video's watch-page fetch ahead of its
// openPlayback, on feed hover or at route resolution, so the ~500ms transfer
// overlaps the navigation + player mount instead of trailing it. The head start
// is what buys the latency: firing at route resolution is ~free (openPlayback
// fires ~immediately after), but firing on feed hover overlaps the whole
// navigation and cuts first-frame by up to ~1s on a lingering hover. The frame
// dedupes and bounds the number of in-flight prefetches; this Set only avoids
// re-issuing the RPC for an id already kicked this session. videoId is always
// the bare id (the watch URL's `v` param), never an href, so a hover prefetch
// and the later route-resolution prefetch land on the same key.
const prefetched = new Set<string>()

export const prefetchPlayback = (videoId: string) => {
  if (!videoId || prefetched.has(videoId)) return
  prefetched.add(videoId)
  // Keep the dedup set from growing without bound over a long browse session.
  if (prefetched.size > 128) prefetched.delete(prefetched.values().next().value!)
  void startEngine().then((api) => api.prefetchPlayback(videoId)).catch(() => {})
}

// Only a deliberate hover (a short dwell) prefetches, so skimming the feed does
// not fetch every card the pointer crosses; a committed pointerdown fires it
// immediately. Both funnel through the deduped prefetchPlayback above.
const HOVER_DWELL_MS = 140

export const usePrefetchOnIntent = (videoId: string) => {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  return {
    onPointerEnter: () => {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => prefetchPlayback(videoId), HOVER_DWELL_MS)
    },
    onPointerLeave: () => clearTimeout(timer.current),
    onPointerDown: () => {
      clearTimeout(timer.current)
      prefetchPlayback(videoId)
    },
  }
}

import { useRef } from 'preact/hooks'

import { startEngine } from '../scramjet/client'

// videoId is always the bare `v` param, never an href, so a hover prefetch and the later route-resolution prefetch share a key
const prefetched = new Set<string>()

export const warmShaka = () => import('./shaka')

export const prefetchPlayback = (videoId: string) => {
  if (!videoId || prefetched.has(videoId)) return
  prefetched.add(videoId)
  if (prefetched.size > 128) prefetched.delete(prefetched.values().next().value!)
  void warmShaka().catch(() => {})
  void startEngine().then((api) => api.prefetchPlayback(videoId)).catch(() => {})
}

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

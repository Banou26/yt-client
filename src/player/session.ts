import { useEffect, useState } from 'preact/hooks'

import { getSettings } from '../settings'

/* What is playing, held OUTSIDE the routed tree.
   The player used to mount inside the watch route, so every navigation
   unmounted it, the effect cleanup aborted and destroy() closed the SABR
   session in the frame. Nothing survived leaving the page. This store is what
   the App-level player reads instead, so a route change is a change of where
   the player is SHOWN rather than whether it exists.

   Module scope, in the same shape as src/player/seek.ts and
   src/components/ui/toast.tsx use for state no single component owns. */
export type PlayerSession = {
  videoId?: string
  // Only the INITIAL offset of a freshly opened video, from a shared link's
  // `t`. It is not a live playhead.
  startAt?: number
  // What the mini dock shows while the video is off its own page. Captured when
  // the video is opened rather than read back, because the watch query that
  // knows the title unmounts with the route.
  title?: string
  poster?: string
  theater: boolean
  // Whether a route is currently showing the player in its own layout. False
  // means it is in the dock, which is what the mini chrome renders on.
  claimed: boolean
}

let session: PlayerSession = { theater: false, claimed: false }
const listeners = new Set<() => void>()

const emit = () => {
  for (const listener of [...listeners]) listener()
}

export const getPlayerSession = () => session

const update = (next: Partial<PlayerSession>) => {
  session = { ...session, ...next }
  emit()
}

/**
 * Show a video in the persistent player.
 *
 * Re-opening the video already playing is deliberately a no-op rather than a
 * reset: the watch route calls this on every render pass that has an id, and
 * treating each one as a fresh open would restart playback whenever the page
 * re-rendered for an unrelated reason.
 */
export const openPlayer = (
  { videoId, startAt, title, poster }: { videoId: string, startAt?: number, title?: string, poster?: string },
) => {
  if (session.videoId === videoId) {
    // Metadata still catches up: the title arrives from a query that resolves
    // after the id is known, and the dock needs it.
    if (title !== undefined && title !== session.title) update({ title, poster: poster ?? session.poster })
    return
  }
  // Theater is a stored preference, so a newly opened video honours it rather
  // than starting flat. It used to be read as the watch page's initial state,
  // which no longer exists now that the player outlives the page.
  update({ videoId, startAt, title, poster, theater: getSettings().theater })
}

/**
 * Stop playback entirely.
 *
 * This is the ONLY thing that closes the frame's SABR session now. Route
 * unmount deliberately does not, which is the whole point of the dock.
 */
export const closePlayer = () => {
  update({ videoId: undefined, startAt: undefined, title: undefined, poster: undefined, theater: false })
}

export const setTheater = (theater: boolean) => update({ theater })

export const usePlayerSession = () => {
  const [value, setValue] = useState(session)
  useEffect(() => {
    const listener = () => setValue(session)
    listeners.add(listener)
    // The store can have moved between the initial read and this effect.
    listener()
    return () => {
      listeners.delete(listener)
    }
  }, [])
  return value
}

/* The player's DOM home.
   Created once and MOVED with appendChild rather than re-rendered into a new
   parent. createPortal cannot do this job: when its container changes, Preact
   unmounts from the old one and mounts into the new, which builds a FRESH
   <video> element and loses the MediaSource attached to the old one. Moving the
   node itself keeps the element, and with it playback, buffered media and the
   Shaka bridge, all of which resolve through module-level maps rather than DOM
   ancestry. */
let host: HTMLDivElement | undefined
let dock: HTMLElement | undefined

const ensureHost = () => {
  host ??= Object.assign(document.createElement('div'), { className: 'player-host' })
  return host
}

// Where the player falls back to when no route claims it.
export const registerPlayerDock = (element: HTMLElement | null) => {
  dock = element ?? undefined
  if (dock && host && host.parentElement === null) dock.append(host)
}

/**
 * Move the player into `slot`, or back to the dock when it is null.
 *
 * Called from a ref callback, so it runs with the element on mount and with
 * null on unmount, which is exactly the claim/release pair the dock needs.
 */
export const claimPlayer = (slot: HTMLElement | null) => {
  const element = ensureHost()
  const target = slot ?? dock
  // Re-appending to the SAME parent still moves the node to the end of it,
  // which is a needless DOM mutation on every render pass.
  if (target && element.parentElement !== target) target.append(element)
  if (session.claimed !== Boolean(slot)) update({ claimed: Boolean(slot) })
}

export const playerHost = ensureHost

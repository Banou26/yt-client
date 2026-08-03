import { useEffect, useState } from 'preact/hooks'

import { getSettings } from '../settings'

export type PlayerSession = {
  videoId?: string
  startAt?: number
  title?: string
  poster?: string
  theater: boolean
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

// re-opening the video already playing is deliberately a no-op, not a reset
export const openPlayer = (
  { videoId, startAt, title, poster }: { videoId: string, startAt?: number, title?: string, poster?: string },
) => {
  if (session.videoId === videoId) {
    if (title !== undefined && title !== session.title) update({ title, poster: poster ?? session.poster })
    return
  }
  update({ videoId, startAt, title, poster, theater: getSettings().theater })
}

// the ONLY thing that closes the frame's SABR session: route unmount deliberately does not
export const closePlayer = () => {
  update({ videoId: undefined, startAt: undefined, title: undefined, poster: undefined, theater: false })
}

export const setTheater = (theater: boolean) => update({ theater })

export const usePlayerSession = () => {
  const [value, setValue] = useState(session)
  useEffect(() => {
    const listener = () => setValue(session)
    listeners.add(listener)
    // the store can have moved between the initial read and this effect
    listener()
    return () => {
      listeners.delete(listener)
    }
  }, [])
  return value
}

// MOVED with appendChild, never createPortal: a container change remounts a FRESH <video> and loses the MediaSource
let host: HTMLDivElement | undefined
let dock: HTMLElement | undefined

const ensureHost = () => {
  host ??= Object.assign(document.createElement('div'), { className: 'player-host' })
  return host
}

export const registerPlayerDock = (element: HTMLElement | null) => {
  dock = element ?? undefined
  if (dock && host && host.parentElement === null) dock.append(host)
}

export const claimPlayer = (slot: HTMLElement | null) => {
  const element = ensureHost()
  const target = slot ?? dock
  if (target && element.parentElement !== target) target.append(element)
  if (session.claimed !== Boolean(slot)) update({ claimed: Boolean(slot) })
}

export const playerHost = ensureHost

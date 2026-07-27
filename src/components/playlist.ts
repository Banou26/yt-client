import type { FunctionComponent } from 'preact'

import { EyeOff, Globe, Lock } from 'lucide-react'

/* What every playlist surface needs and none of them owns: the two fixed ids,
   the route href, and the privacy mapping. They live here because four
   surfaces (the guide rail, the library grid, the playlist route and both save
   panels) reach for the same three answers, and a second copy of any of them
   only ever surfaces as one surface disagreeing with another. */

// Upstream's fixed ids. Both are ordinary playlists to every read and write,
// which is why neither gets a page of its own: they are /playlist with a known
// id. The library aggregation does not list them reliably, so the surfaces that
// show the library pin them and filter them back out of the fetched list.
export const WATCH_LATER_ID = 'WL'
export const LIKED_VIDEOS_ID = 'LL'

// The playlist lives in the query string, matching youtube.com, so a pasted
// link works. See the route comment in src/routes/playlist.tsx.
export const playlistHrefFor = (playlistId: string) => `/playlist?list=${encodeURIComponent(playlistId)}`

// Structural rather than lucide's own props type, so a caller can pass any
// icon-shaped component. It is the shape ui/menu.tsx accepts for its rows.
export type PlaylistIcon = FunctionComponent<{ size?: number, strokeWidth?: number }>

// The vocabulary is upstream's and changes, so an unrecognized value simply
// gets no icon rather than a wrong one.
export const privacyIcon = (privacy?: string | null): PlaylistIcon | undefined => {
  const value = privacy?.toUpperCase()
  if (value === 'PUBLIC') return Globe
  if (value === 'UNLISTED') return EyeOff
  if (value === 'PRIVATE') return Lock
  return undefined
}

// The same mapping with PUBLIC left bare, for a list where most rows are public
// and a globe on each of them says nothing. A menu row is the opposite case: it
// is read one at a time, so naming the visibility of every entry is worth the
// space.
export const restrictedPrivacyIcon = (privacy?: string | null) =>
  privacy?.toUpperCase() === 'PUBLIC' ? undefined : privacyIcon(privacy)

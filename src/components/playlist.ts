import type { FunctionComponent } from 'preact'

import { EyeOff, Globe, Lock } from 'lucide-react'

// upstream's fixed ids, which the library aggregation does not list reliably
export const WATCH_LATER_ID = 'WL'
export const LIKED_VIDEOS_ID = 'LL'

export const playlistHrefFor = (playlistId: string) => `/playlist?list=${encodeURIComponent(playlistId)}`

export type PlaylistIcon = FunctionComponent<{ size?: number, strokeWidth?: number }>

export const privacyIcon = (privacy?: string | null): PlaylistIcon | undefined => {
  const value = privacy?.toUpperCase()
  if (value === 'PUBLIC') return Globe
  if (value === 'UNLISTED') return EyeOff
  if (value === 'PRIVATE') return Lock
  return undefined
}

export const restrictedPrivacyIcon = (privacy?: string | null) =>
  privacy?.toUpperCase() === 'PUBLIC' ? undefined : privacyIcon(privacy)

// keyed BY VIDEO ID rather than held as one handle: the watch page remounts its player on every queue navigation and retry, and an unkeyed handle would let a seek land on a player already torn down
type SeekHandler = (seconds: number) => void
type PlayheadReader = () => number

let current: { videoId: string, seek: SeekHandler, playhead: PlayheadReader } | undefined

export const registerSeek = (videoId: string, seek: SeekHandler, playhead: PlayheadReader) => {
  current = { videoId, seek, playhead }
}

// undefined rather than 0 when the video is not the one mounted: 0 is a real position
export const playheadOf = (videoId: string) => {
  if (current?.videoId !== videoId) return undefined
  const seconds = current.playhead()
  return Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : undefined
}

// takes the id it is releasing so a teardown that arrives AFTER the next player has registered cannot clear the live handle
export const clearSeek = (videoId: string) => {
  if (current?.videoId === videoId) current = undefined
}

export const seekTo = (videoId: string, seconds: number) => {
  if (current?.videoId !== videoId || !Number.isFinite(seconds) || seconds < 0) return false
  current.seek(seconds)
  return true
}

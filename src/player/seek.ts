/* A seek handle for the things that sit OUTSIDE the player subtree: a chapter
   timestamp in the description, a 12:34 in a comment. Those live in
   src/routes/watch.tsx's sibling columns, so they cannot reach the player's own
   state, and threading a callback down through every run of every comment would
   put the player in the props of components that otherwise know nothing about
   it.

   Module scope is the same shape src/components/ui/toast.tsx uses for state no
   single tree owns. Keyed BY VIDEO ID rather than held as one handle: the
   watch page remounts its player on every queue navigation and on every retry,
   and an unkeyed handle would let a seek land on a player that has already been
   torn down. */
type SeekHandler = (seconds: number) => void
type PlayheadReader = () => number

let current: { videoId: string, seek: SeekHandler, playhead: PlayheadReader } | undefined

export const registerSeek = (videoId: string, seek: SeekHandler, playhead: PlayheadReader) => {
  current = { videoId, seek, playhead }
}

/**
 * Where the mounted video is, for the share dialog's "start at" offset.
 *
 * Undefined rather than 0 when the video is not the one mounted: 0 is a real
 * position, and a caller cannot tell a genuine start-of-video from "no player"
 * if both answer the same.
 */
export const playheadOf = (videoId: string) => {
  if (current?.videoId !== videoId) return undefined
  const seconds = current.playhead()
  return Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : undefined
}

// Takes the id it is releasing so a teardown that arrives AFTER the next
// player has registered cannot clear the live handle. Retry remounts make that
// ordering real rather than theoretical.
export const clearSeek = (videoId: string) => {
  if (current?.videoId === videoId) current = undefined
}

/**
 * Seeks the video currently mounted, if it is the one being addressed.
 *
 * Returns whether the seek was taken, so a caller can fall back to a plain
 * link: a timestamp in a comment can point at a DIFFERENT video, and that has
 * to navigate rather than silently do nothing.
 */
export const seekTo = (videoId: string, seconds: number) => {
  if (current?.videoId !== videoId || !Number.isFinite(seconds) || seconds < 0) return false
  current.seek(seconds)
  return true
}

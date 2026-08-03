/* Marking is deliberately one-shot per name: a playback restart would otherwise overwrite
   the startup timings, and the number this is here to protect is the FIRST one. */

const marked = new Set<string>()

/** Every startup milestone worth a budget, in the order they can happen. */
export type Milestone =
  /** The Scramjet frame answers, so the app can query YouTube at all. */
  | 'engine-ready'
  /** Shaka is attached to the media element and owns the stream. */
  | 'player-attached'
  /** The media element has actually advanced: the first frame a viewer sees. */
  | 'first-frame'

export const markStartup = (milestone: Milestone) => {
  if (marked.has(milestone)) return
  marked.add(milestone)
  try {
    performance.mark(`yt:${milestone}`)
  } catch {
  }
}

/**
 * When a milestone happened, in ms since navigation, or undefined if it has
 * not. Reading through `performance` rather than a local map so a test or a
 * console can ask the same question the same way.
 */
export const startupTiming = (milestone: Milestone) => {
  try {
    return performance.getEntriesByName(`yt:${milestone}`, 'mark')[0]?.startTime
  } catch {
    return undefined
  }
}

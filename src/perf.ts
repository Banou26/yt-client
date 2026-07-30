/* Startup milestones, on the timeline the browser already keeps.

   These exist because the browser suite's ceilings are not budgets: they were
   set high enough that a run never flakes (75s to an engine, 35s to playback),
   which is roughly three times the real path, so a change that made startup
   twice as slow would still pass every test. A ceiling that cannot fail is not
   a measurement.

   `performance.mark` rather than a timestamp of our own: marks are relative to
   the navigation start the browser recorded, so a mark is comparable across
   runs without threading a start time through the app, and devtools plots them
   next to paint and resource timing for free.

   Marking is deliberately one-shot per name. Playback restarts (a seek that
   rebuilds the engine, a second video in the same frame) would otherwise
   overwrite the startup timings with mid-session ones, and the number this is
   here to protect is the FIRST one. */

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
    // A browser that refuses the mark (an exhausted buffer) must not take the
    // startup path down with it: this is instrumentation, not behaviour.
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

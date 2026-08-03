/* Marking is deliberately one-shot per name: a playback restart would otherwise overwrite
   the startup timings, and the number this is here to protect is the FIRST one. */

const marked = new Set<string>()

export type Milestone =
  | 'engine-ready'
  | 'player-attached'
  | 'first-frame'

export const markStartup = (milestone: Milestone) => {
  if (marked.has(milestone)) return
  marked.add(milestone)
  try {
    performance.mark(`yt:${milestone}`)
  } catch {
  }
}

export const startupTiming = (milestone: Milestone) => {
  try {
    return performance.getEntriesByName(`yt:${milestone}`, 'mark')[0]?.startTime
  } catch {
    return undefined
  }
}

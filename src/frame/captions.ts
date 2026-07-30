export type CaptionTrack = {
  /* YouTube's own per-video track id (`vss_id`, for example `.en` or `a.en`).
     The app hands it straight back to ask for cues, so the frame never accepts
     a URL from the app realm. */
  id: string
  languageCode: string
  label: string
  // Auto-generated tracks read differently from authored ones and viewers pick
  // between them knowingly, so the distinction is carried rather than flattened.
  auto: boolean
}

// The frame keeps the address to itself; only the public half above crosses.
export type CaptionSource = CaptionTrack & { url: string }

/* Structural rather than imported from youtubei.js, so the app realm can share
   this module for the `CaptionTrack` type and the resolver below without
   pulling the library into its bundle. This mirrors how `storyboard.ts` takes
   a raw spec string rather than a parsed node. */
type RawTracklist = {
  caption_tracks?: {
    base_url?: string
    name?: string | { text?: string }
    vss_id?: string
    language_code?: string
    kind?: string
  }[]
}

const nameOf = (name: string | { text?: string } | undefined) =>
  (typeof name === 'string' ? name : name?.text) ?? ''

export const parseCaptionTracks = (tracklist: RawTracklist | undefined): CaptionSource[] => {
  const tracks = tracklist?.caption_tracks ?? []
  const seen = new Set<string>()
  return tracks.flatMap((track) => {
    const url = track.base_url
    const languageCode = track.language_code ?? ''
    if (!url || !languageCode) return []
    const auto = track.kind === 'asr'
    // `vss_id` is what YouTube itself keys a track on, but it is not guaranteed
    // to be there, and a list with two entries sharing an id would make the
    // second unreachable.
    const id = track.vss_id || `${auto ? 'a' : ''}.${languageCode}`
    if (seen.has(id)) return []
    seen.add(id)
    return [{
      id,
      languageCode,
      label: nameOf(track.name) || languageCode,
      auto,
      url,
    }]
  })
}

/* Resolves a stored language preference against what one video actually
   publishes. Exact match first, then the base language, so a preference of
   `en` still finds `en-GB`. Authored tracks are preferred over generated ones
   at equal specificity, which is the order YouTube itself offers them in. */
export const preferredTrack = (tracks: CaptionTrack[], language: string | undefined) => {
  if (tracks.length === 0) return undefined
  const rank = (track: CaptionTrack) => (track.auto ? 1 : 0)
  const byRank = (a: CaptionTrack, b: CaptionTrack) => rank(a) - rank(b)
  if (language) {
    const base = language.split('-')[0]?.toLowerCase()
    const exact = tracks.filter((track) => track.languageCode.toLowerCase() === language.toLowerCase())
    if (exact.length > 0) return exact.sort(byRank)[0]
    const loose = tracks.filter((track) => track.languageCode.split('-')[0]?.toLowerCase() === base)
    if (loose.length > 0) return loose.sort(byRank)[0]
    // A stored language the video does not publish means no captions, rather
    // than silently showing a language the viewer never asked for.
    return undefined
  }
  return [...tracks].sort(byRank)[0]
}

/* One timed-text event as `fmt=json3` publishes it.

   json3 is asked for in preference to `fmt=vtt` because it is the format
   YouTube's own player consumes, and because its cue model is explicit enough
   to correct the rolling-caption overlap below. Every field is optional: the
   same array also carries window and style definitions that hold no text. */
type Json3Event = {
  tStartMs?: number
  dDurationMs?: number
  /* Marks an event that re-states the line before it so a rolling caption can
     grow a word at a time. Keeping them renders the same sentence several times
     over, so they are dropped in favour of the event they extend. */
  aAppend?: number
  segs?: { utf8?: string, tOffsetMs?: number }[]
}

export type Cue = { startMs: number, endMs: number, text: string }

// A cue that states no duration still has to occupy time, and the next cue's
// start is the only honest bound available. This covers the last cue, which has
// no next.
const ORPHAN_CUE_MS = 4_000

const pad = (value: number, width: number) => String(value).padStart(width, '0')

const timestamp = (totalMs: number) => {
  const ms = Math.max(0, Math.round(totalMs))
  const seconds = Math.floor(ms / 1_000)
  return `${pad(Math.floor(seconds / 3_600), 2)}:${pad(Math.floor(seconds / 60) % 60, 2)}:${pad(seconds % 60, 2)}.${pad(ms % 1_000, 3)}`
}

/* WebVTT reads `<` as a cue tag and `&` as an entity, so caption text that
   contains either would be swallowed rather than shown. Escaping `>` as well is
   what stops a line containing the cue separator from splitting the block. */
const escapeCueText = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export const parseJson3 = (body: string): Cue[] => {
  let events: Json3Event[]
  try {
    const parsed = JSON.parse(body) as { events?: Json3Event[] }
    events = Array.isArray(parsed.events) ? parsed.events : []
  } catch {
    return []
  }

  const cues: Cue[] = []
  for (const event of events) {
    if (event.aAppend) continue
    const startMs = Number(event.tStartMs)
    if (!Number.isFinite(startMs) || startMs < 0) continue
    const text = (event.segs ?? []).map((segment) => segment.utf8 ?? '').join('').trim()
    if (!text) continue
    const durationMs = Number(event.dDurationMs)
    cues.push({
      startMs,
      endMs: Number.isFinite(durationMs) && durationMs > 0 ? startMs + durationMs : Number.NaN,
      text,
    })
  }

  cues.sort((a, b) => a.startMs - b.startMs)

  /* Generated tracks overlap on purpose: each event repeats the tail of the one
     before it so the line appears to scroll. Rendered as published that is two
     stacked copies of the same words, so every cue is cut at the next one's
     start. Authored tracks rarely overlap, and where they do the same cut is
     what YouTube itself shows. */
  return cues
    .map((cue, index) => {
      const next = cues[index + 1]?.startMs
      const endMs = Number.isFinite(cue.endMs)
        ? Math.min(cue.endMs, next ?? cue.endMs)
        : next ?? cue.startMs + ORPHAN_CUE_MS
      return { ...cue, endMs }
    })
    .filter((cue) => cue.endMs > cue.startMs)
}

export const toWebVtt = (cues: Cue[]) =>
  ['WEBVTT', '', ...cues.flatMap((cue) => [
    `${timestamp(cue.startMs)} --> ${timestamp(cue.endMs)}`,
    escapeCueText(cue.text),
    '',
  ])].join('\n')

export const json3ToWebVtt = (body: string) => toWebVtt(parseJson3(body))

/* Pins the response to the one format this module reads, replacing whatever
   format the published URL already named. Every other parameter is preserved:
   `base_url` arrives signed, and those parameters are what authorize it. */
export const timedTextUrl = (baseUrl: string) => {
  const url = new URL(baseUrl)
  url.searchParams.set('fmt', 'json3')
  return url.toString()
}

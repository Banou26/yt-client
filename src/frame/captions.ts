export type CaptionTrack = {
  // `id` is YouTube's own `vss_id` and the app hands it straight back to ask for cues, so the frame never accepts a URL from the app realm
  id: string
  languageCode: string
  label: string
  auto: boolean
}

export type CaptionSource = CaptionTrack & { url: string }

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
    // a stored language the video does not publish means no captions, rather than a language the viewer never asked for
    return undefined
  }
  return [...tracks].sort(byRank)[0]
}

// one `fmt=json3` event: every field is optional, and `aAppend` marks an event that re-states the line before it so a rolling caption can grow a word at a time
type Json3Event = {
  tStartMs?: number
  dDurationMs?: number
  aAppend?: number
  segs?: { utf8?: string, tOffsetMs?: number }[]
}

export type Cue = { startMs: number, endMs: number, text: string }

const ORPHAN_CUE_MS = 4_000

const pad = (value: number, width: number) => String(value).padStart(width, '0')

const timestamp = (totalMs: number) => {
  const ms = Math.max(0, Math.round(totalMs))
  const seconds = Math.floor(ms / 1_000)
  return `${pad(Math.floor(seconds / 3_600), 2)}:${pad(Math.floor(seconds / 60) % 60, 2)}:${pad(seconds % 60, 2)}.${pad(ms % 1_000, 3)}`
}

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

  // generated tracks overlap on purpose so the line appears to scroll, so every cue is cut at the next one's start
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

// every other parameter is preserved: `base_url` arrives signed, and those parameters are what authorize it
export const timedTextUrl = (baseUrl: string) => {
  const url = new URL(baseUrl)
  url.searchParams.set('fmt', 'json3')
  return url.toString()
}

import type { PlaybackFormat } from './protocol'

/* segments are addressed by SEQUENCE, not by byte range, and sequence maps onto time exactly (sequence 4717 * 5000 = startMs 23585000).
   THE SERVER IGNORES THE ADDRESS AND ALWAYS SENDS ITS CURRENT EDGE, which is why this generator describes only segments that have ALREADY ARRIVED. */

const seconds = (value: number) => `PT${(value / 1_000).toFixed(3)}S`

const escapeAttribute = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

const codecsOf = (mimeType: string) => mimeType.match(/codecs="([^"]+)"/)?.[1] ?? ''

const containerOf = (mimeType: string) => mimeType.split(';')[0] ?? 'video/mp4'

export type LiveSegment = {
  sequenceNumber: number
  startMs: number
  durationMs: number
}

// `$Number$` must equal the SABR sequence number, and under a SegmentTimeline it is positional (startNumber, then +1 per S entry), so the run has to be consecutive
export const contiguousTail = (segments: LiveSegment[]) => {
  const ordered = [...segments].sort((a, b) => a.sequenceNumber - b.sequenceNumber)
  let start = ordered.length - 1
  while (start > 0 && ordered[start - 1]!.sequenceNumber === ordered[start]!.sequenceNumber - 1) start -= 1
  return ordered.slice(Math.max(0, start))
}

// the app's request filter adds the session, generation and start time on the way out, and forwards `n` back as the sequence the session must resolve
const segmentTemplate = (format: PlaybackFormat, track: 'audio' | 'video', segments: LiveSegment[]) => {
  const uri = escapeAttribute(`sabr://${track}?key=${encodeURIComponent(format.key)}`)
  const entries = segments
    .map((segment) => `<S t="${segment.startMs}" d="${segment.durationMs}"/>`)
    .join('')
  return `<SegmentTemplate timescale="1000" startNumber="${segments[0]!.sequenceNumber}" `
    + `initialization="${uri}" media="${uri}&amp;n=$Number$">`
    + `<SegmentTimeline>${entries}</SegmentTimeline>`
    + '</SegmentTemplate>'
}

const representation = (format: PlaybackFormat, track: 'audio' | 'video', segments: LiveSegment[]) => {
  const codecs = escapeAttribute(codecsOf(format.mimeType))
  const size = track === 'video' && format.width && format.height
    ? ` width="${format.width}" height="${format.height}"`
    : ''
  const audio = track === 'audio' ? '<AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2"/>' : ''
  return `<Representation id="${escapeAttribute(format.key)}" codecs="${codecs}" bandwidth="${format.bitrate}"${size}>`
    + `${audio}${segmentTemplate(format, track, segments)}</Representation>`
}

// one AdaptationSet PER CONTAINER, not one per track: DASH does not allow mixing containers inside an AdaptationSet
const adaptationSets = (formats: PlaybackFormat[], track: 'audio' | 'video', segments: LiveSegment[]) => {
  const groups = new Map<string, PlaybackFormat[]>()
  for (const format of formats) {
    const container = containerOf(format.mimeType)
    groups.set(container, [...(groups.get(container) ?? []), format])
  }
  return [...groups].map(([container, group], index) =>
    `<AdaptationSet id="${track}-${index}" contentType="${track}" mimeType="${escapeAttribute(container)}" `
    + 'segmentAlignment="true" startWithSAP="1">'
    + group.map((format) => representation(format, track, segments)).join('')
    + '</AdaptationSet>').join('')
}

export type LiveManifestInput = {
  videoFormats: PlaybackFormat[]
  audioFormats: PlaybackFormat[]
  targetMs: number
  segments: LiveSegment[]
  nowMs: number
  anchorMs?: number
}

// availabilityStartTime is held FIXED across refreshes and only ever moves EARLIER: later would drop the newest delivered segment out of availability
export const liveAnchor = (previousMs: number | undefined, nowMs: number, endMs: number) =>
  Math.min(previousMs ?? Infinity, nowMs - endMs)

export const timelineEndMs = (segments: LiveSegment[]) => {
  const last = contiguousTail(segments).at(-1)
  return last && last.startMs + last.durationMs
}

export const buildLiveManifest = (
  { videoFormats, audioFormats, targetMs, segments, nowMs, anchorMs }: LiveManifestInput,
) => {
  const timeline = contiguousTail(segments)
  if (!timeline.length) throw new Error('youtube: live manifest needs at least one delivered segment')
  const first = timeline[0]!
  const last = timeline[timeline.length - 1]!
  const endMs = last.startMs + last.durationMs
  const windowMs = endMs - first.startMs

  // presentation time IS media time: an S entry's `t` is the stream's own clock, which is also the `startMs` the SABR session reports
  const availabilityStart = new Date(liveAnchor(anchorMs, nowMs, endMs)).toISOString()
  const publishTime = new Date(nowMs).toISOString()

  const shiftDepth = Math.max(windowMs, targetMs)

  // start behind the edge by more than one segment: the delay is also all the buffer the playhead ever gets, and at two segments buffer-ahead measured a 0.4s to 4.7s sawtooth
  const presentationDelay = Math.min(targetMs * 3, windowMs)

  const updatePeriod = Math.max(1_000, Math.round(targetMs / 2))

  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" '
    + 'profiles="urn:mpeg:dash:profile:isoff-live:2011" type="dynamic" '
    + `availabilityStartTime="${availabilityStart}" publishTime="${publishTime}" `
    + `minimumUpdatePeriod="${seconds(updatePeriod)}" timeShiftBufferDepth="${seconds(shiftDepth)}" `
    + `minBufferTime="${seconds(targetMs)}" suggestedPresentationDelay="${seconds(presentationDelay)}">`
    + '<Period id="0" start="PT0S">'
    + adaptationSets(videoFormats, 'video', timeline)
    + adaptationSets(audioFormats, 'audio', timeline)
    + '</Period></MPD>'
}

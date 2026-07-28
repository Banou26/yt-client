import type { PlaybackFormat } from './protocol'

/* A dynamic MPD for a live stream, written by hand.

   youtubei.js refuses to generate one (`MediaInfo.toDash` throws for live), and
   the two cheap alternatives do not exist for this client: the WEB watch page
   carries no dashManifestUrl or hlsManifestUrl, and the per-format URLs it does
   carry answer 403. What DOES work is the SABR session this client already
   uses for every other video, verified against four live streams. So the
   transport is not the missing piece; this description of it is.

   Two measured facts shape the whole shape of this manifest.

   Segments are addressed by SEQUENCE, not by byte range: live formats carry no
   initRange or indexRange, only targetDurationSec. Sequence maps onto time
   exactly (a stream at sequence 4717 reported startMs 23585000, and
   4717 * 5000 = 23585000).

   THE SERVER IGNORES THE ADDRESS AND ALWAYS SENDS ITS CURRENT EDGE. Asking for
   60s, 600s or 7200s before the edge all returned the edge. That single fact is
   why this generator describes only segments that have ALREADY ARRIVED instead
   of extrapolating a template forward from a probe.

   The extrapolating version is what made live playback stutter. It anchored a
   constant-duration SegmentTemplate to one probe taken at open and let Shaka
   compute addresses from the wall clock. Shaka then asked for a presentation
   time the server would never send, the server answered with the edge instead,
   and the two never converged: a trace showed Shaka requesting the same time
   (12057555) fifteen times in a row while the server walked sequence 2411550 up
   to 2411564, drift climbing from 12.5s to 22.5s at exactly real-time rate. The
   buffer filled far ahead of a playhead that starved in the hole.

   Describing only what has arrived closes that loop: every address Shaka can
   form names a segment the session already holds, so every append lands exactly
   where the timeline says it should. */

const seconds = (value: number) => `PT${(value / 1_000).toFixed(3)}S`

const escapeAttribute = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

// The bare codec string, without the container that mimeType wraps it in.
const codecsOf = (mimeType: string) => mimeType.match(/codecs="([^"]+)"/)?.[1] ?? ''

const containerOf = (mimeType: string) => mimeType.split(';')[0] ?? 'video/mp4'

// One segment as the transport actually delivered it, not as a template guessed.
export type LiveSegment = {
  sequenceNumber: number
  startMs: number
  durationMs: number
}

/* `$Number$` has to come out equal to the SABR sequence number, because that is
   the only address the session can resolve. Under a SegmentTimeline the number
   is positional (startNumber, then +1 per S entry), so a missing sequence in the
   middle would silently shift every later address by one. Taking the longest
   CONSECUTIVE run ending at the newest segment keeps position and sequence
   identical by construction, and drops history rather than correctness when the
   session misses one. */
export const contiguousTail = (segments: LiveSegment[]) => {
  const ordered = [...segments].sort((a, b) => a.sequenceNumber - b.sequenceNumber)
  let start = ordered.length - 1
  while (start > 0 && ordered[start - 1]!.sequenceNumber === ordered[start]!.sequenceNumber - 1) start -= 1
  return ordered.slice(Math.max(0, start))
}

/* Segments are requested through the same `sabr:` scheme the VOD path uses, so
   the app's existing handler and request filter serve both. `$Number$` is what
   makes each segment a distinct URI; the filter adds the session, generation
   and start time on the way out, and the app forwards `n` back as the sequence
   the session must resolve. */
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

/* One AdaptationSet PER CONTAINER, not one per track.

   A live stream's video formats are mixed: four avc1 in video/mp4 alongside one
   vp9 in video/webm. Taking the container off the first format and declaring
   the whole set with it is how the vp9 track ended up advertised as mp4. Shaka
   then picked it, MSE opened an mp4 SourceBuffer for webm segments, and the
   video buffer stayed permanently EMPTY while audio played normally: no error,
   just readyState 0 and videoWidth 0 forever.

   DASH does not allow mixing containers inside an AdaptationSet, so this is the
   correct modelling rather than a workaround. */
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
  // One segment's worth, from the format's own targetDurationSec. Used only for
  // pacing hints; the timeline itself comes from the segments below.
  targetMs: number
  // Every segment the session currently holds, in any order. The manifest can
  // only ever describe these, because they are the only ones it can serve.
  segments: LiveSegment[]
  // Wall clock, passed in rather than read here so the generator stays pure.
  nowMs: number
  /* Wall clock corresponding to presentation time zero, held FIXED for the
     session. availabilityStartTime is the anchor the whole presentation hangs
     off, and DASH expects it to be stable across updates: recomputing it every
     refresh makes the computed live edge wobble by whatever the client clock and
     the stream's production have drifted apart, and Shaka answers a wobbling
     edge with seeks. Omitted on the first build, which is what establishes it. */
  anchorMs?: number
}

/* The anchor that keeps the advertised availability window covering the
   segments the session actually holds.

   It only ever moves EARLIER. Later would shrink the window from the far end and
   could drop the newest delivered segment out of availability, which stalls
   playback on media already in hand; earlier only widens it, and the explicit
   SegmentTimeline still bounds what can be requested. Monotonic in one direction
   also means the live edge never jumps backwards. */
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

  /* Presentation time IS media time: an S entry's `t` is the stream's own clock,
     which is also the `startMs` the SABR session reports. The anchor maps that
     onto wall clock so Shaka's live edge lands on real media. */
  const availabilityStart = new Date(liveAnchor(anchorMs, nowMs, endMs)).toISOString()
  const publishTime = new Date(nowMs).toISOString()

  /* The seek range is exactly what the session can still serve from cache, so a
     scrub inside it resolves to the segment it names. It is a rewind buffer
     rather than real DVR: the transport cannot go back further than the session
     happened to keep, and asking it to silently returns live media. */
  const shiftDepth = Math.max(windowMs, targetMs)

  /* Start behind the edge, never at it, and by more than one segment.

     The availability end is the END of the newest delivered segment, so a delay
     of zero puts the playhead exactly where the next, unproduced segment would
     begin and nothing plays for a full target duration. The delay is also what
     the buffer ahead of the playhead is made of: segments arrive in real time,
     so the playhead can never build a cushion it did not start with. Measured at
     two segments, buffer-ahead ran a sawtooth between 0.4s and 4.7s, which plays
     but leaves nothing for one slow fetch. Three is still ordinary live latency
     and roughly doubles the floor. */
  const presentationDelay = Math.min(targetMs * 3, windowMs)

  /* Poll for new segments twice per segment. The refresh is generated in
     process from state the session already holds, with no network behind it, so
     a tight period costs nothing and keeps the advertised edge within half a
     segment of the real one. */
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

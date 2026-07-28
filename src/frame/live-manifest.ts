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
   4717 * 5000 = 23585000), which is what makes a plain SegmentTemplate with a
   constant duration the right description rather than a SegmentTimeline.

   The server always streams from the LIVE EDGE and ignores a request for an
   earlier position: asking for 60s, 600s and 7200s before the edge all returned
   the edge segment. That is why timeShiftBufferDepth is deliberately tiny.
   Advertising a real DVR window would let a viewer scrub back into a range that
   silently answers with live media, which reads as the stream jumping rather
   than as a seek that is not supported. */

const seconds = (value: number) => `PT${(value / 1_000).toFixed(3)}S`

const escapeAttribute = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

// The bare codec string, without the container that mimeType wraps it in.
const codecsOf = (mimeType: string) => mimeType.match(/codecs="([^"]+)"/)?.[1] ?? ''

const containerOf = (mimeType: string) => mimeType.split(';')[0] ?? 'video/mp4'

/* Segments are requested through the same `sabr:` scheme the VOD path uses, so
   the app's existing handler and request filter serve both. `$Number$` is what
   makes each segment a distinct URI; the filter adds the session, generation
   and start time on the way out. */
const segmentTemplate = (format: PlaybackFormat, track: 'audio' | 'video', targetMs: number) => {
  const uri = escapeAttribute(`sabr://${track}?key=${encodeURIComponent(format.key)}`)
  return `<SegmentTemplate timescale="1000" duration="${targetMs}" startNumber="0" `
    + `initialization="${uri}" media="${uri}&amp;n=$Number$"/>`
}

const representation = (format: PlaybackFormat, track: 'audio' | 'video', targetMs: number) => {
  const codecs = escapeAttribute(codecsOf(format.mimeType))
  const size = track === 'video' && format.width && format.height
    ? ` width="${format.width}" height="${format.height}"`
    : ''
  const audio = track === 'audio' ? '<AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2"/>' : ''
  return `<Representation id="${escapeAttribute(format.key)}" codecs="${codecs}" bandwidth="${format.bitrate}"${size}>`
    + `${audio}${segmentTemplate(format, track, targetMs)}</Representation>`
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
const adaptationSets = (formats: PlaybackFormat[], track: 'audio' | 'video', targetMs: number) => {
  const groups = new Map<string, PlaybackFormat[]>()
  for (const format of formats) {
    const container = containerOf(format.mimeType)
    groups.set(container, [...(groups.get(container) ?? []), format])
  }
  return [...groups].map(([container, group], index) =>
    `<AdaptationSet id="${track}-${index}" contentType="${track}" mimeType="${escapeAttribute(container)}" `
    + 'segmentAlignment="true" startWithSAP="1">'
    + group.map((format) => representation(format, track, targetMs)).join('')
    + '</AdaptationSet>').join('')
}

export type LiveManifestInput = {
  videoFormats: PlaybackFormat[]
  audioFormats: PlaybackFormat[]
  // One segment's worth, from the format's own targetDurationSec.
  targetMs: number
  // Where the stream is right now, from a probe segment. Presentation time is
  // media time, so this is also the live edge on the timeline below.
  edgeMs: number
  // Wall clock at the moment the edge was measured, passed in rather than read
  // here so the generator stays pure and testable.
  nowMs: number
}

export const buildLiveManifest = (
  { videoFormats, audioFormats, targetMs, edgeMs, nowMs }: LiveManifestInput,
) => {
  /* Presentation time IS media time: segment N covers N*targetMs, which matches
     the `startMs` the SABR session reports for sequence N. Anchoring
     availabilityStartTime that far in the past is what puts Shaka's computed
     live edge on the segment the server is actually about to send. */
  const availabilityStart = new Date(nowMs - edgeMs).toISOString()
  const publishTime = new Date(nowMs).toISOString()
  // Two segments back, which is a buffer rather than a seek range. See the note
  // at the top: rewinding is not supported by the transport.
  const shiftDepth = targetMs * 2
  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" '
    + 'profiles="urn:mpeg:dash:profile:isoff-live:2011" type="dynamic" '
    + `availabilityStartTime="${availabilityStart}" publishTime="${publishTime}" `
    + `minimumUpdatePeriod="${seconds(targetMs)}" timeShiftBufferDepth="${seconds(shiftDepth)}" `
    + `minBufferTime="${seconds(targetMs * 2)}" suggestedPresentationDelay="${seconds(targetMs * 2)}">`
    + '<Period id="0" start="PT0S">'
    + adaptationSets(videoFormats, 'video', targetMs)
    + adaptationSets(audioFormats, 'audio', targetMs)
    + '</Period></MPD>'
}

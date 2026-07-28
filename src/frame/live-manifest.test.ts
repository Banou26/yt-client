import { describe, expect, it } from 'vitest'

import { buildLiveManifest, contiguousTail, liveAnchor, timelineEndMs } from './live-manifest'

const video = (key: string, mimeType: string, height: number) => ({
  key,
  itag: 1,
  mimeType,
  bitrate: 100_000,
  width: Math.round((height * 16) / 9),
  height,
})

const audio = (key: string, mimeType: string) => ({
  key,
  itag: 2,
  mimeType,
  bitrate: 50_000,
})

// A run of delivered segments ending at `sequence`, which is how the session
// reports them: sequence maps onto media time through the target duration.
const delivered = (sequence: number, count: number, durationMs = 5_000) =>
  Array.from({ length: count }, (_, index) => {
    const sequenceNumber = sequence - count + 1 + index
    return { sequenceNumber, startMs: sequenceNumber * durationMs, durationMs }
  })

const build = (overrides: Partial<Parameters<typeof buildLiveManifest>[0]> = {}) =>
  buildLiveManifest({
    videoFormats: [video('v1', 'video/mp4; codecs="avc1.4d401f"', 720)],
    audioFormats: [audio('a1', 'audio/mp4; codecs="mp4a.40.2"')],
    targetMs: 5_000,
    segments: delivered(4_717, 4),
    nowMs: Date.UTC(2026, 6, 28, 12, 0, 0),
    ...overrides,
  })

describe('live manifest', () => {
  it('groups representations by container rather than by track', () => {
    /* A live stream mixes containers: avc1 in video/mp4 alongside vp9 in
       video/webm. Declaring one AdaptationSet per TRACK takes the container off
       the first format and applies it to all of them, so the vp9 track gets
       advertised as mp4. Shaka then picks it, MSE opens an mp4 source buffer for
       webm bytes, and the video buffer stays permanently empty while audio plays
       normally: no error, just a black frame forever. */
    const manifest = build({
      videoFormats: [
        video('v1', 'video/mp4; codecs="avc1.4d401f"', 720),
        video('v2', 'video/webm; codecs="vp9"', 360),
      ],
    })
    const sets = [...manifest.matchAll(/<AdaptationSet[^>]*mimeType="([^"]+)"/g)].map((match) => match[1])
    expect(sets).toEqual(['video/mp4', 'video/webm', 'audio/mp4'])
    // And each representation sits under the container it actually uses.
    const webm = manifest.slice(manifest.indexOf('video/webm'))
    expect(webm).toContain('id="v2"')
    expect(webm).not.toContain('id="v1"')
  })

  it('describes only segments that were actually delivered', () => {
    /* The whole live stutter came from a timeline that extrapolated forward
       from one probe. The server ignores the address on a request and answers
       with its current edge, so every extrapolated segment named something that
       would never arrive: a trace caught Shaka asking for the same position
       fifteen times while the server walked fifteen sequences past it. */
    const manifest = build({ segments: delivered(4_717, 3) })
    const entries = [...manifest.matchAll(/<S t="(\d+)" d="(\d+)"\/>/g)].map((match) => match[1])
    expect(entries).toEqual(['23575000', '23580000', '23585000', '23575000', '23580000', '23585000'])
    // Nothing past the newest delivered segment is offered.
    expect(manifest).not.toContain('t="23590000"')
  })

  it('numbers segments by their SABR sequence', () => {
    // `$Number$` is the only address the session can resolve, because the
    // transport answers a request for a TIME with whatever its edge holds.
    const manifest = build({ segments: delivered(4_717, 3) })
    expect(manifest).toContain('startNumber="4715"')
    expect(manifest).toContain('media="sabr://video?key=v1&amp;n=$Number$"')
    expect(manifest).toContain('initialization="sabr://video?key=v1"')
  })

  it('drops history rather than shifting every later address', () => {
    /* Under a SegmentTimeline the number is positional: startNumber, then +1 per
       S entry. A sequence missing from the middle would silently offset every
       later address by one, so the run has to be consecutive. */
    const gapped = [...delivered(100, 2), ...delivered(105, 3)]
    expect(contiguousTail(gapped).map((segment) => segment.sequenceNumber)).toEqual([103, 104, 105])
    const manifest = build({ segments: gapped })
    expect(manifest).toContain('startNumber="103"')
    expect([...manifest.matchAll(/<S /g)]).toHaveLength(6)
  })

  it('anchors the presentation so now is the end of the newest segment', () => {
    // Presentation time IS media time, so an edge 23,590s into the stream means
    // the presentation began that long before the moment it was measured.
    const manifest = build({ segments: delivered(4_717, 4) })
    expect(manifest).toContain('type="dynamic"')
    expect(manifest).toContain('availabilityStartTime="2026-07-28T05:26:50.000Z"')
  })

  it('advertises a seek range no wider than the session can serve', () => {
    /* Measured: the server answers a request for 60s, 600s or 7200s before the
       edge with the EDGE segment. The only rewind that works is back into
       segments the session still holds, so that is exactly what is offered. */
    expect(build({ segments: delivered(4_717, 4) })).toContain('timeShiftBufferDepth="PT20.000S"')
  })

  it('starts the playhead behind the edge, never at it', () => {
    /* The availability end is where the NEXT segment will begin. Opening there
       plays nothing for a full target duration while Shaka waits for a segment
       the stream has not produced. */
    expect(build({ segments: delivered(4_717, 4) })).toContain('suggestedPresentationDelay="PT15.000S"')
    // With only one segment in hand there is just one step back to take.
    expect(build({ segments: delivered(4_717, 1) })).toContain('suggestedPresentationDelay="PT5.000S"')
  })

  it('refuses to describe a session that has delivered nothing', () => {
    expect(() => build({ segments: [] })).toThrow(/at least one delivered segment/)
    expect(timelineEndMs([])).toBeUndefined()
  })

  it('holds the anchor still across refreshes', () => {
    /* availabilityStartTime is the anchor the whole presentation hangs off.
       Recomputing it per refresh made it creep 2.5s per update and then jump 65s
       backwards, 26 distinct values in 86 seconds. Shaka answers a live edge
       that moves like that with seeks: measured, the playhead covered 97.3s of
       media in 86s of wall clock and sat frozen for 29 of them. */
    const anchor = liveAnchor(undefined, 1_000_000, 20_000)
    expect(anchor).toBe(980_000)
    // A later recomputation does not drag the anchor forward with it.
    expect(liveAnchor(anchor, 1_002_500, 20_000)).toBe(980_000)
  })

  it('moves the anchor earlier when the stream outruns the clock', () => {
    /* Earlier only ever widens the availability window, and the explicit
       SegmentTimeline still bounds what can be requested. Letting it move later
       would shrink the window from the far end and could drop the newest
       delivered segment out of availability, stalling on media already in hand. */
    expect(liveAnchor(980_000, 1_002_500, 25_000)).toBe(977_500)
  })

  it('escapes a format key that would otherwise break the XML', () => {
    // Format keys are `itag:xtags` and xtags carry `=` and `:`; a key with an
    // ampersand would end the attribute early and produce an unparseable MPD.
    const manifest = build({ videoFormats: [video('251:a&b', 'video/mp4; codecs="avc1"', 720)] })
    expect(manifest).toContain('id="251:a&amp;b"')
    expect(manifest).not.toContain('id="251:a&b"')
  })
})

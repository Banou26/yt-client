import { describe, expect, it } from 'vite-plus/test'

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
    // one AdaptationSet per TRACK advertises the vp9 track as mp4, and MSE then opens an mp4 source buffer for webm bytes: black frame forever, no error
    const manifest = build({
      videoFormats: [
        video('v1', 'video/mp4; codecs="avc1.4d401f"', 720),
        video('v2', 'video/webm; codecs="vp9"', 360),
      ],
    })
    const sets = [...manifest.matchAll(/<AdaptationSet[^>]*mimeType="([^"]+)"/g)].map((match) => match[1])
    expect(sets).toEqual(['video/mp4', 'video/webm', 'audio/mp4'])
    const webm = manifest.slice(manifest.indexOf('video/webm'))
    expect(webm).toContain('id="v2"')
    expect(webm).not.toContain('id="v1"')
  })

  it('describes only segments that were actually delivered', () => {
    // the server ignores the address on a request and answers with its current edge, so an extrapolated segment names something that would never arrive
    const manifest = build({ segments: delivered(4_717, 3) })
    const entries = [...manifest.matchAll(/<S t="(\d+)" d="(\d+)"\/>/g)].map((match) => match[1])
    expect(entries).toEqual(['23575000', '23580000', '23585000', '23575000', '23580000', '23585000'])
    expect(manifest).not.toContain('t="23590000"')
  })

  it('numbers segments by their SABR sequence', () => {
    const manifest = build({ segments: delivered(4_717, 3) })
    expect(manifest).toContain('startNumber="4715"')
    expect(manifest).toContain('media="sabr://video?key=v1&amp;n=$Number$"')
    expect(manifest).toContain('initialization="sabr://video?key=v1"')
  })

  it('drops history rather than shifting every later address', () => {
    // under a SegmentTimeline the number is positional (startNumber, then +1 per S entry), so the run has to be consecutive
    const gapped = [...delivered(100, 2), ...delivered(105, 3)]
    expect(contiguousTail(gapped).map((segment) => segment.sequenceNumber)).toEqual([103, 104, 105])
    const manifest = build({ segments: gapped })
    expect(manifest).toContain('startNumber="103"')
    expect([...manifest.matchAll(/<S /g)]).toHaveLength(6)
  })

  it('anchors the presentation so now is the end of the newest segment', () => {
    const manifest = build({ segments: delivered(4_717, 4) })
    expect(manifest).toContain('type="dynamic"')
    expect(manifest).toContain('availabilityStartTime="2026-07-28T05:26:50.000Z"')
  })

  it('advertises a seek range no wider than the session can serve', () => {
    expect(build({ segments: delivered(4_717, 4) })).toContain('timeShiftBufferDepth="PT20.000S"')
  })

  it('starts the playhead behind the edge, never at it', () => {
    expect(build({ segments: delivered(4_717, 4) })).toContain('suggestedPresentationDelay="PT15.000S"')
    expect(build({ segments: delivered(4_717, 1) })).toContain('suggestedPresentationDelay="PT5.000S"')
  })

  it('refuses to describe a session that has delivered nothing', () => {
    expect(() => build({ segments: [] })).toThrow(/at least one delivered segment/)
    expect(timelineEndMs([])).toBeUndefined()
  })

  it('holds the anchor still across refreshes', () => {
    // availabilityStartTime is the anchor the whole presentation hangs off, and recomputing it per refresh makes Shaka answer the moving live edge with seeks
    const anchor = liveAnchor(undefined, 1_000_000, 20_000)
    expect(anchor).toBe(980_000)
    expect(liveAnchor(anchor, 1_002_500, 20_000)).toBe(980_000)
  })

  it('moves the anchor earlier when the stream outruns the clock', () => {
    expect(liveAnchor(980_000, 1_002_500, 25_000)).toBe(977_500)
  })

  it('escapes a format key that would otherwise break the XML', () => {
    const manifest = build({ videoFormats: [video('251:a&b', 'video/mp4; codecs="avc1"', 720)] })
    expect(manifest).toContain('id="251:a&amp;b"')
    expect(manifest).not.toContain('id="251:a&b"')
  })
})

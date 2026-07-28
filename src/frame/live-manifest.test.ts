import { describe, expect, it } from 'vitest'

import { buildLiveManifest } from './live-manifest'

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

const build = (overrides: Partial<Parameters<typeof buildLiveManifest>[0]> = {}) =>
  buildLiveManifest({
    videoFormats: [video('v1', 'video/mp4; codecs="avc1.4d401f"', 720)],
    audioFormats: [audio('a1', 'audio/mp4; codecs="mp4a.40.2"')],
    targetMs: 5_000,
    edgeMs: 23_585_000,
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

  it('declares a dynamic presentation anchored so the edge is now', () => {
    const manifest = build()
    expect(manifest).toContain('type="dynamic"')
    // Presentation time IS media time, so an edge 23,585s into the stream means
    // the presentation began that long before the moment it was measured.
    expect(manifest).toContain('availabilityStartTime="2026-07-28T05:26:55.000Z"')
  })

  it('advertises a seek range too small to scrub into', () => {
    /* Measured: the server answers a request for 60s, 600s or 7200s before the
       edge with the EDGE segment. Advertising a real DVR window would let a
       viewer scrub into a range that silently returns live media, which reads
       as the stream jumping rather than as an unsupported seek. */
    expect(build()).toContain('timeShiftBufferDepth="PT10.000S"')
  })

  it('addresses segments by number through the sabr scheme', () => {
    const manifest = build()
    // `$Number$` is what makes each segment a distinct URI; the app's request
    // filter adds the session and start time on the way out.
    expect(manifest).toContain('media="sabr://video?key=v1&amp;n=$Number$"')
    expect(manifest).toContain('initialization="sabr://video?key=v1"')
    expect(manifest).toContain('duration="5000"')
  })

  it('escapes a format key that would otherwise break the XML', () => {
    // Format keys are `itag:xtags` and xtags carry `=` and `:`; a key with an
    // ampersand would end the attribute early and produce an unparseable MPD.
    const manifest = build({ videoFormats: [video('251:a&b', 'video/mp4; codecs="avc1"', 720)] })
    expect(manifest).toContain('id="251:a&amp;b"')
    expect(manifest).not.toContain('id="251:a&b"')
  })
})

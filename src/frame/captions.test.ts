import { describe, expect, it } from 'vite-plus/test'

import { json3ToWebVtt, parseCaptionTracks, parseJson3, preferredTrack, timedTextUrl } from './captions'

// youtubei.js parses `name` into a Text node, so the label arrives as an object
const TRACKLIST = {
  caption_tracks: [
    {
      base_url: 'https://www.youtube.com/api/timedtext?v=abc&lang=en&signature=sig&fmt=srv3',
      name: { text: 'English' },
      vss_id: '.en',
      language_code: 'en',
      is_translatable: true,
    },
    {
      base_url: 'https://www.youtube.com/api/timedtext?v=abc&lang=en&kind=asr&signature=sig',
      name: { text: 'English (auto-generated)' },
      vss_id: 'a.en',
      language_code: 'en',
      kind: 'asr',
      is_translatable: true,
    },
    {
      base_url: 'https://www.youtube.com/api/timedtext?v=abc&lang=fr&signature=sig',
      name: { text: 'French' },
      vss_id: '.fr',
      language_code: 'fr',
      is_translatable: true,
    },
  ],
}

describe('parseCaptionTracks', () => {
  it('keeps the address inside the frame and publishes the rest', () => {
    const tracks = parseCaptionTracks(TRACKLIST)
    expect(tracks).toHaveLength(3)
    expect(tracks[0]).toMatchObject({ id: '.en', languageCode: 'en', label: 'English', auto: false })
    expect(tracks[0]!.url).toContain('timedtext')
  })

  it('marks generated tracks', () => {
    const tracks = parseCaptionTracks(TRACKLIST)
    expect(tracks[1]!.auto).toBe(true)
    expect(tracks[0]!.auto).toBe(false)
  })

  it('drops entries that cannot be addressed or named', () => {
    const tracks = parseCaptionTracks({
      caption_tracks: [
        { name: { text: 'No URL' }, vss_id: '.en', language_code: 'en' },
        { base_url: 'https://x/t', name: { text: 'No language' }, vss_id: '.x' },
      ],
    })
    expect(tracks).toHaveLength(0)
  })

  it('synthesizes an id when the response carries none, and never repeats one', () => {
    const tracks = parseCaptionTracks({
      caption_tracks: [
        { base_url: 'https://x/1', name: { text: 'English' }, language_code: 'en' },
        { base_url: 'https://x/2', name: { text: 'English auto' }, language_code: 'en', kind: 'asr' },
        { base_url: 'https://x/3', name: { text: 'Duplicate' }, language_code: 'en' },
      ],
    })
    expect(tracks.map((track) => track.id)).toStrictEqual(['.en', 'a.en'])
  })

  it('falls back to the language code when the track is unnamed', () => {
    const tracks = parseCaptionTracks({
      caption_tracks: [{ base_url: 'https://x/1', language_code: 'pt-BR' }],
    })
    expect(tracks[0]!.label).toBe('pt-BR')
  })

  it('returns nothing for a response with no captions at all', () => {
    expect(parseCaptionTracks(undefined)).toStrictEqual([])
    expect(parseCaptionTracks({})).toStrictEqual([])
  })
})

describe('preferredTrack', () => {
  const tracks = parseCaptionTracks(TRACKLIST)

  it('prefers an authored track over a generated one in the same language', () => {
    expect(preferredTrack(tracks, 'en')?.id).toBe('.en')
  })

  it('matches a base language against a regional track', () => {
    const regional = parseCaptionTracks({
      caption_tracks: [{ base_url: 'https://x/1', name: { text: 'English (UK)' }, vss_id: '.en-GB', language_code: 'en-GB' }],
    })
    expect(preferredTrack(regional, 'en')?.id).toBe('.en-GB')
  })

  it('shows nothing rather than a language the viewer never asked for', () => {
    expect(preferredTrack(tracks, 'de')).toBeUndefined()
  })

  it('falls back to the first authored track when no language is stored', () => {
    expect(preferredTrack(tracks, undefined)?.id).toBe('.en')
  })

  it('has nothing to pick from an empty list', () => {
    expect(preferredTrack([], 'en')).toBeUndefined()
  })
})

describe('timedTextUrl', () => {
  it('pins the format it can read and keeps what authorizes the URL', () => {
    const url = new URL(timedTextUrl(TRACKLIST.caption_tracks[0]!.base_url))
    expect(url.searchParams.get('fmt')).toBe('json3')
    expect(url.searchParams.get('signature')).toBe('sig')
    expect(url.searchParams.get('lang')).toBe('en')
  })
})

describe('parseJson3', () => {
  it('joins the segments of one event into a single cue', () => {
    const cues = parseJson3(JSON.stringify({
      events: [{ tStartMs: 1_000, dDurationMs: 2_000, segs: [{ utf8: 'Hello ' }, { utf8: 'world' }] }],
    }))
    expect(cues).toStrictEqual([{ startMs: 1_000, endMs: 3_000, text: 'Hello world' }])
  })

  it('drops the window and style events that carry no text', () => {
    const cues = parseJson3(JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 0, id: 1, wpWinPosId: 1 },
        { tStartMs: 0, dDurationMs: 500, segs: [{ utf8: '\n' }] },
        { tStartMs: 1_000, dDurationMs: 500, segs: [{ utf8: 'Real' }] },
      ],
    }))
    expect(cues).toStrictEqual([{ startMs: 1_000, endMs: 1_500, text: 'Real' }])
  })

  it('cuts an overrunning cue at the next one, so a rolling caption shows once', () => {
    const cues = parseJson3(JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 5_000, segs: [{ utf8: 'first' }] },
        { tStartMs: 1_000, dDurationMs: 5_000, segs: [{ utf8: 'first second' }] },
      ],
    }))
    expect(cues.map((cue) => cue.endMs)).toStrictEqual([1_000, 6_000])
  })

  it('drops the append events that re-state the line before them', () => {
    const cues = parseJson3(JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 1_000, segs: [{ utf8: 'hello' }] },
        { tStartMs: 500, dDurationMs: 1_000, aAppend: 1, segs: [{ utf8: 'hello' }] },
      ],
    }))
    expect(cues).toHaveLength(1)
  })

  it('gives a cue with no stated duration the time up to the next one', () => {
    const cues = parseJson3(JSON.stringify({
      events: [
        { tStartMs: 0, segs: [{ utf8: 'first' }] },
        { tStartMs: 2_000, segs: [{ utf8: 'last' }] },
      ],
    }))
    expect(cues[0]!.endMs).toBe(2_000)
    expect(cues[1]!.endMs).toBe(6_000)
  })

  it('orders cues by start time even when the response does not', () => {
    const cues = parseJson3(JSON.stringify({
      events: [
        { tStartMs: 2_000, dDurationMs: 500, segs: [{ utf8: 'second' }] },
        { tStartMs: 0, dDurationMs: 500, segs: [{ utf8: 'first' }] },
      ],
    }))
    expect(cues.map((cue) => cue.text)).toStrictEqual(['first', 'second'])
  })

  it('returns nothing rather than throwing on a body that is not json3', () => {
    expect(parseJson3('<!DOCTYPE html><html>signed out</html>')).toStrictEqual([])
    expect(parseJson3('')).toStrictEqual([])
    expect(parseJson3('{}')).toStrictEqual([])
  })
})

describe('json3ToWebVtt', () => {
  it('writes a header and one block per cue', () => {
    const vtt = json3ToWebVtt(JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 1_500, segs: [{ utf8: 'first' }] },
        { tStartMs: 3_661_000, dDurationMs: 1_000, segs: [{ utf8: 'later' }] },
      ],
    }))
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true)
    expect(vtt).toContain('00:00:00.000 --> 00:00:01.500\nfirst')
    expect(vtt).toContain('01:01:01.000 --> 01:01:02.000\nlater')
  })

  it('escapes text that WebVTT would otherwise read as markup', () => {
    const vtt = json3ToWebVtt(JSON.stringify({
      events: [{ tStartMs: 0, dDurationMs: 1_000, segs: [{ utf8: '<i>a & b</i> -->' }] }],
    }))
    expect(vtt).toContain('&lt;i&gt;a &amp; b&lt;/i&gt; --&gt;')
    expect(vtt.match(/-->/g)).toHaveLength(1)
  })

  it('is still a valid file when the track has no cues', () => {
    expect(json3ToWebVtt('{}')).toBe('WEBVTT\n')
  })
})

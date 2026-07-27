import { describe, expect, it } from 'vitest'

import type { AdaptiveFormat } from './formats'

import { isPlayableFormat } from './formats'

const audio = (extra: Partial<AdaptiveFormat> = {}): AdaptiveFormat =>
  ({ has_audio: true, has_video: false, ...extra })

const video = (extra: Partial<AdaptiveFormat> = {}): AdaptiveFormat =>
  ({ has_audio: false, has_video: true, ...extra })

describe('isPlayableFormat', () => {
  it('keeps every video format', () => {
    expect(isPlayableFormat(video())).toBe(true)
    // Video formats carry xtags too, and none of the audio flags apply to them.
    expect(isPlayableFormat(video({ xtags: 'Cg0KBGxhbmcSBWVuLVVT' }))).toBe(true)
    expect(isPlayableFormat({ has_audio: true, has_video: true })).toBe(true)
  })

  it('keeps plain audio with no tags at all', () => {
    expect(isPlayableFormat(audio())).toBe(true)
  })

  // The regression this function exists for: on an auto-dubbed video EVERY
  // audio format is tagged, the original included, so keying off the presence
  // of xtags discarded all of them and playback failed with
  // "no supported audio and video formats".
  it('keeps the original track on an auto-dubbed video', () => {
    const original = audio({
      xtags: 'ChEKBWFjb250EghvcmlnaW5hbAoNCgRsYW5nEgVlbi1VUw',
      is_original: true,
      is_drc: false,
      is_dubbed: false,
      is_auto_dubbed: false,
      is_descriptive: false,
    })
    expect(isPlayableFormat(original)).toBe(true)
  })

  it('drops the auto-dubbed language tracks', () => {
    const dubbed = audio({
      xtags: 'ChQKBWFjb250EgtkdWJiZWQtYXV0bwoKCgRsYW5nEgJhcg',
      is_auto_dubbed: true,
    })
    expect(isPlayableFormat(dubbed)).toBe(false)
    expect(isPlayableFormat(audio({ is_dubbed: true }))).toBe(false)
  })

  it('drops DRC and descriptive audio', () => {
    const drc = audio({
      xtags: 'ChEKBWFjb250EghvcmlnaW5hbAoICgNkcmMSATEKDQoEbGFuZxIFZW4tVVM',
      is_original: true,
      is_drc: true,
    })
    expect(isPlayableFormat(drc)).toBe(false)
    expect(isPlayableFormat(audio({ is_descriptive: true }))).toBe(false)
  })

  it('leaves at least one audio track on a fully tagged 17-language video', () => {
    // Every audio format of the reported video, reduced to its flags: 17
    // auto-dubbed languages per itag plus three English originals (plain, DRC,
    // and a volume-normalised variant).
    const perItag: AdaptiveFormat[] = [
      ...Array.from({ length: 17 }, () => audio({ xtags: 'dubbed', is_auto_dubbed: true })),
      audio({ xtags: 'original+drc', is_original: true, is_drc: true }),
      audio({ xtags: 'original', is_original: true }),
      audio({ xtags: 'original+vb', is_original: true }),
    ]
    const kept = perItag.filter(isPlayableFormat)
    expect(kept).toHaveLength(2)
    expect(kept.every((format) => format.is_original)).toBe(true)
  })
})

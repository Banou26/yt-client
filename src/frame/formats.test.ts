import { describe, expect, it } from 'vite-plus/test'

import type { AdaptiveFormat } from './formats'

import { playableFormats } from './formats'

type Named = AdaptiveFormat & { name: string }

const audio = (name: string, extra: Partial<AdaptiveFormat> = {}): Named =>
  ({ name, has_audio: true, has_video: false, ...extra })

const video = (name: string, extra: Partial<AdaptiveFormat> = {}): Named =>
  ({ name, has_video: true, has_audio: false, ...extra })

const names = (formats: Named[]) => formats.map((format) => format.name)

describe('playableFormats', () => {
  it('keeps every video format, tagged or not', () => {
    const formats = [video('v1'), video('v2', { xtags: 'Cg0KBGxhbmcSBWVuLVVT' }), audio('a')]
    expect(names(playableFormats(formats))).toEqual(['v1', 'v2', 'a'])
  })

  it('keeps a lone untagged audio track', () => {
    expect(names(playableFormats([audio('a')]))).toEqual(['a'])
  })

  // The 403 regression: siblings that differ only by xtags are not independently servable
  it('drops the volume-boosted sibling when a plain track exists', () => {
    const formats = [
      audio('opus'),
      audio('opus-vb', { xtags: 'CgcKAnZiEgEx' }),
      audio('aac'),
      audio('aac-vb', { xtags: 'CgcKAnZiEgEx' }),
    ]
    expect(names(playableFormats(formats))).toEqual(['opus', 'aac'])
  })

  it('falls back to the original track when every format is tagged', () => {
    const formats = [
      audio('ar', { xtags: 'dubbed', is_auto_dubbed: true }),
      audio('de', { xtags: 'dubbed', is_auto_dubbed: true }),
      audio('en-drc', { xtags: 'original+drc', is_original: true, is_drc: true }),
      audio('en', { xtags: 'original', is_original: true }),
    ]
    expect(names(playableFormats(formats))).toEqual(['en'])
  })

  it('drops dubbed, descriptive, and DRC audio outright', () => {
    const formats = [
      audio('keep'),
      audio('dubbed', { is_dubbed: true }),
      audio('auto', { is_auto_dubbed: true }),
      audio('described', { is_descriptive: true }),
      audio('drc', { is_drc: true }),
    ]
    expect(names(playableFormats(formats))).toEqual(['keep'])
  })

  it('preserves the caller ordering, which decides the starting track', () => {
    const formats = [audio('first'), video('v'), audio('second')]
    expect(names(playableFormats(formats))).toEqual(['first', 'v', 'second'])
  })

  it('leaves audio present rather than empty if every track looks unwanted', () => {
    const formats = [audio('only', { xtags: 'weird', is_drc: false })]
    expect(names(playableFormats(formats))).toEqual(['only'])
  })
})

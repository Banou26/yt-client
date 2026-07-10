import { describe, expect, it } from 'vitest'

import { bufferedAhead } from './source-buffer'

describe('bufferedAhead', () => {
  it('returns coverage after the playhead', () => {
    const sourceBuffer = {
      buffered: {
        length: 2,
        start: (index: number) => index === 0 ? 0 : 20,
        end: (index: number) => index === 0 ? 10 : 30,
      },
    } as SourceBuffer
    expect(bufferedAhead(sourceBuffer, 4)).toBe(6)
    expect(bufferedAhead(sourceBuffer, 15)).toBe(0)
  })
})

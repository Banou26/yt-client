import { describe, expect, it } from 'vitest'

import { UMPPartId } from 'googlevideo/protos'
import { createUmpFramer, inspectUmpChunks } from './sabr'

const encodeVarInt = (value: number) => {
  if (value < 128) return [value]
  if (value < 16_384) return [(value & 0x3f) | 0x80, value >> 6]
  throw new Error('test value is too large')
}

const part = (type: number, data: number[]) => new Uint8Array([
  ...encodeVarInt(type),
  ...encodeVarInt(data.length),
  ...data,
])

describe('inspectUmpChunks', () => {
  it('recognizes an end-of-track response', () => {
    expect(inspectUmpChunks([new Uint8Array([UMPPartId.END_OF_TRACK, 0])])).toEqual({
      endOfTrack: true,
      partial: false,
      partTypes: [UMPPartId.END_OF_TRACK],
    })
  })

  it('recognizes a truncated part', () => {
    expect(inspectUmpChunks([new Uint8Array([UMPPartId.MEDIA, 2, 1])])).toMatchObject({
      endOfTrack: false,
      partial: true,
      partTypes: [],
    })
  })

  it('preserves UMP parts across every network split', () => {
    const media = part(UMPPartId.MEDIA, Array.from({ length: 130 }, (_, index) => index))
    const end = part(UMPPartId.MEDIA_END, [1])
    const envelope = new Uint8Array(media.byteLength + end.byteLength)
    envelope.set(media)
    envelope.set(end, media.byteLength)

    for (let split = 1; split < envelope.byteLength; split += 1) {
      const framer = createUmpFramer()
      const frames = [
        ...framer.push(envelope.slice(0, split)),
        ...framer.push(envelope.slice(split)),
      ]
      expect(frames.map((frame) => frame.type), `split at byte ${split}`).toEqual([
        UMPPartId.MEDIA,
        UMPPartId.MEDIA_END,
      ])
      expect(framer.partial, `split at byte ${split}`).toBe(false)
    }
  })
})

import { describe, expect, it } from 'vitest'

import { MediaHeader, UMPPartId } from 'googlevideo/protos'
import { createUmpFramer, createUmpSegmentCollector, inspectUmpChunks } from './sabr'

const encodeVarInt = (value: number) => {
  if (value < 128) return [value]
  if (value < 16_384) return [(value & 0x3f) | 0x80, value >> 6]
  throw new Error('test value is too large')
}

const part = (type: number, input: Iterable<number>) => {
  const data = [...input]
  return new Uint8Array([
    ...encodeVarInt(type),
    ...encodeVarInt(data.length),
    ...data,
  ])
}

const join = (parts: Uint8Array[]) => {
  const output = new Uint8Array(parts.reduce((size, value) => size + value.byteLength, 0))
  let offset = 0
  for (const value of parts) {
    output.set(value, offset)
    offset += value.byteLength
  }
  return output
}

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

describe('createUmpSegmentCollector', () => {
  it('harvests interleaved audio and video across every network split', () => {
    const audioHeader = MediaHeader.encode({
      headerId: 1,
      itag: 251,
      startMs: '0',
      durationMs: '5000',
      contentLength: '3',
    }).finish()
    const videoHeader = MediaHeader.encode({
      headerId: 2,
      itag: 399,
      startMs: '0',
      durationMs: '5005',
      contentLength: '3',
    }).finish()
    const envelope = join([
      part(UMPPartId.MEDIA_HEADER, audioHeader),
      part(UMPPartId.MEDIA_HEADER, videoHeader),
      part(UMPPartId.MEDIA, [1, 10, 11]),
      part(UMPPartId.MEDIA, [2, 20]),
      part(UMPPartId.MEDIA, [1, 12]),
      part(UMPPartId.MEDIA_END, [1]),
      part(UMPPartId.MEDIA, [2, 21, 22]),
      part(UMPPartId.MEDIA_END, [2]),
    ])

    for (let split = 1; split < envelope.byteLength; split += 1) {
      const framer = createUmpFramer()
      const collector = createUmpSegmentCollector()
      const segments = [
        ...framer.push(envelope.slice(0, split)),
        ...framer.push(envelope.slice(split)),
      ].flatMap((frame) => collector.push(frame) ?? [])

      expect(segments.map((segment) => ({
        key: segment.formatKey,
        data: [...segment.data],
      })), `split at byte ${split}`).toEqual([
        { key: '251:', data: [10, 11, 12] },
        { key: '399:', data: [20, 21, 22] },
      ])
    }
  })

  it('rejects a segment whose declared content is incomplete', () => {
    const framer = createUmpFramer()
    const collector = createUmpSegmentCollector()
    const envelope = join([
      part(UMPPartId.MEDIA_HEADER, MediaHeader.encode({
        headerId: 1,
        itag: 251,
        contentLength: '3',
      }).finish()),
      part(UMPPartId.MEDIA, [1, 10, 11]),
      part(UMPPartId.MEDIA_END, [1]),
    ])

    expect(framer.push(envelope).flatMap((frame) => collector.push(frame) ?? [])).toEqual([])
  })
})

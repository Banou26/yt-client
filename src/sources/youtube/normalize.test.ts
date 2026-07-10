import { describe, expect, it } from 'vitest'

import { normalizeFeedVideo, normalizeVideoDetails } from './normalize'

describe('youtube normalization', () => {
  it('normalizes feed videos', () => {
    expect(normalizeFeedVideo({
      video_id: 'abc',
      title: { text: 'Video title' },
      duration: { seconds: 125 },
      thumbnails: [
        { url: 'small', width: 120 },
        { url: 'large', width: 640 },
      ],
      author: { id: 'channel', name: 'Channel' },
    })).toEqual({
      id: 'abc',
      title: 'Video title',
      thumbnail: 'large',
      durationSeconds: 125,
      channel: { id: 'channel', name: 'Channel' },
    })
  })

  it('normalizes player details', () => {
    expect(normalizeVideoDetails({
      id: 'abc',
      title: 'Video title',
      short_description: 'Description',
      duration: 90,
      view_count: 42,
      channel_id: 'channel',
      author: 'Channel',
    })).toMatchObject({
      id: 'abc',
      title: 'Video title',
      description: 'Description',
      durationSeconds: 90,
      viewCount: '42',
    })
  })
})

import { describe, expect, it } from 'vitest'

import { createYoutubeSource } from '.'

type FakeFeed = {
  videos: { video_id: string, title: { text: string } }[]
  has_continuation: boolean
  getContinuation(): Promise<FakeFeed>
}

const feed = (id: string, next?: () => Promise<FakeFeed>): FakeFeed => ({
  videos: [{ video_id: id, title: { text: id } }],
  has_continuation: Boolean(next),
  getContinuation: next ?? (() => Promise.reject(new Error('no continuation'))),
})

describe('youtube source', () => {
  it('keeps continuations opaque and one-shot', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => ({
        getHomeFeed: async () => feed('first', async () => feed('second')),
        search: async () => feed('search'),
        getBasicInfo: async () => ({ basic_info: undefined }),
        getChannel: async () => ({ ...feed('channel'), metadata: { external_id: 'c', title: 'Channel' } }),
      }),
    })
    const first = await source.home()
    expect(first.items[0]?.id).toBe('first')
    expect(first.cursor).toBeTruthy()
    const second = await source.home(first.cursor)
    expect(second.items[0]?.id).toBe('second')
    await expect(source.home(first.cursor)).rejects.toThrow('unknown continuation')
  })
})

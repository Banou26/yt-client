import { describe, expect, it } from 'vitest'

import { createYoutubeSource } from '.'

type FakeFeed = {
  videos: { video_id: string, title: { text: string } }[]
  has_continuation: boolean
  getContinuation(): Promise<FakeFeed>
}

type FakeComments = {
  contents: { comment: { comment_id: string, content: { text: string } } }[]
  has_continuation: boolean
  getContinuation(): Promise<FakeComments>
}

const feed = (id: string, next?: () => Promise<FakeFeed>): FakeFeed => ({
  videos: [{ video_id: id, title: { text: id } }],
  has_continuation: Boolean(next),
  getContinuation: next ?? (() => Promise.reject(new Error('no continuation'))),
})

const comments = (id: string, next?: () => Promise<FakeComments>): FakeComments => ({
  contents: [{ comment: { comment_id: id, content: { text: id } } }],
  has_continuation: Boolean(next),
  getContinuation: next ?? (() => Promise.reject(new Error('no continuation'))),
})

const createFakeClient = () => ({
  getHomeFeed: async () => feed('first', async () => feed('second')),
  search: async () => feed('search'),
  getBasicInfo: async () => ({ basic_info: undefined }),
  getChannel: async () => ({ ...feed('channel'), metadata: { external_id: 'c', title: 'Channel' } }),
  getComments: async () => comments('top', async () => comments('next')),
  actions: {
    execute: async () => ({
      contents_memo: new Map<string, unknown[]>([
        ['VideoPrimaryInfo', [{ view_count: { view_count: { text: '42 views' } } }]],
      ]),
    }),
  },
})

describe('youtube source', () => {
  it('keeps continuations opaque and one-shot', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const first = await source.home()
    expect(first.items[0]?.id).toBe('first')
    expect(first.cursor).toBeTruthy()
    const second = await source.home(first.cursor)
    expect(second.items[0]?.id).toBe('second')
    await expect(source.home(first.cursor)).rejects.toThrow('unknown continuation')
  })

  it('fetches watch metadata through a single /next call', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    await expect(source.watch('abc')).resolves.toMatchObject({
      id: 'abc',
      viewCountText: '42 views',
      related: [],
    })
  })

  it('pages comments with one-shot cursors', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const first = await source.comments('abc')
    expect(first.items[0]?.id).toBe('top')
    expect(first.cursor).toBeTruthy()
    const second = await source.comments('abc', first.cursor)
    expect(second.items[0]?.id).toBe('next')
    expect(second.cursor).toBeUndefined()
    await expect(source.comments('abc', first.cursor)).rejects.toThrow('unknown continuation')
  })
})

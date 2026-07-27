import { describe, expect, it } from 'vitest'

import { createYoutubeSource } from '.'
import { SOURCE_CURSOR_ARGUMENT, SOURCE_REPLAY } from '../types'

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

const createFakeClient = () => {
  // Writes are verified by what reached the wire, so every outbound call is
  // recorded: the point of these tests is which endpoint fired, not the reply.
  const calls: string[] = []
  return {
    calls,
    getHomeFeed: async () => feed('first', async () => feed('second')),
    search: async () => feed('search'),
    getBasicInfo: async () => ({ basic_info: undefined }),
    getChannel: async () => ({ ...feed('channel'), metadata: { external_id: 'c', title: 'Channel' } }),
    getComments: async () => comments('top', async () => comments('next')),
    getSubscriptionsFeed: async () => feed('sub'),
    getHistory: async () => ({
      ...feed('watched'),
      sections: [
        { header: { title: 'Today' }, contents: [{ video_id: 'today', title: { text: 'Today video' } }] },
        { header: { title: 'Yesterday' }, contents: [{ video_id: 'older', title: { text: 'Older video' } }] },
      ],
      removeVideo: async (videoId: string, _pagesToLoad?: number) => void calls.push(`removeHistory:${videoId}`),
    }),
    getChannelsFeed: async () => ({
      channels: [{ author: { id: 'UC1', name: 'Chan', thumbnails: [{ url: 'a' }] } }],
    }),
    session: { logged_in: true },
    interact: {
      subscribe: async (channelId: string) => void calls.push(`subscribe:${channelId}`),
      unsubscribe: async (channelId: string) => void calls.push(`unsubscribe:${channelId}`),
      setNotificationPreferences: async (channelId: string, type: string) =>
        void calls.push(`notifications:${channelId}:${type}`),
    },
    account: {
      getInfo: async (): Promise<unknown> => ({
        contents: {
          account_name: { text: 'Banou' },
          account_photo: [{ url: 'avatar' }],
          channel_handle: { text: '@banou' },
        },
      }),
    },
    actions: {
      execute: async (endpoint: string) => {
        calls.push(endpoint)
        return {
          contents_memo: new Map<string, unknown[]>([
            ['VideoPrimaryInfo', [{ view_count: { view_count: { text: '42 views' } } }]],
          ]),
        }
      },
    },
  }
}

describe('youtube source', () => {
  it('keeps continuations opaque and replayable', async () => {
    const client = createFakeClient()
    let continuationCalls = 0
    client.getHomeFeed = async () => feed('first', async () => {
      continuationCalls += 1
      return feed('second')
    })
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => client,
    })
    const first = await source.home()
    expect(first.items[0]?.id).toBe('first')
    expect(first.cursor).toBeTruthy()
    const second = await source.home(undefined, first.cursor)
    expect(second.items[0]?.id).toBe('second')
    // urql re-executes a query on remount and on back-navigation. Replaying a
    // cursor must return the same page rather than throwing, and must not cost
    // a second round trip.
    const replay = await source.home(undefined, first.cursor)
    expect(replay.items[0]?.id).toBe('second')
    expect(continuationCalls).toBe(1)
    await expect(source.home(undefined, 'youtube:home:999')).rejects.toThrow('unknown continuation')
  })

  it('refuses a cursor issued for a different feed', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const home = await source.home()
    expect(home.cursor).toBeTruthy()
    await expect(source.search('query', home.cursor)).rejects.toThrow('belongs to home')
  })

  it('lets a failed continuation be retried instead of caching the failure', async () => {
    const client = createFakeClient()
    let attempts = 0
    client.getHomeFeed = async () => feed('first', async () => {
      attempts += 1
      if (attempts === 1) throw new Error('network blip')
      return feed('second')
    })
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => client,
    })
    const first = await source.home()
    await expect(source.home(undefined, first.cursor)).rejects.toThrow('network blip')
    await expect(source.home(undefined, first.cursor)).resolves.toMatchObject({ items: [{ id: 'second' }] })
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

  it('pages comments with cursors scoped to their video', async () => {
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
    await expect(source.comments('abc', first.cursor)).resolves.toMatchObject({ items: [{ id: 'next' }] })
    // Comment cursors are scoped to their video, so the same cursor must not
    // page a different video's comments.
    await expect(source.comments('other', first.cursor)).rejects.toThrow('belongs to comments:abc')
  })

  it('reports a signed-out session without hitting the account API', async () => {
    const client = createFakeClient()
    let called = false
    client.account.getInfo = async () => {
      called = true
      return { contents: {} }
    }
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => client,
    })
    await expect(source.session()).resolves.toEqual({ signedIn: false })
    expect(called).toBe(false)
  })

  it('decorates a signed-in session with account info', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
      signedIn: () => true,
    })
    await expect(source.session()).resolves.toEqual({
      signedIn: true,
      name: 'Banou',
      avatar: 'avatar',
      handle: '@banou',
    })
  })

  // src/sources/runtime.ts decides whether a failed call may be replayed against
  // a rebuilt engine by reading the cursor out of SOURCE_CURSOR_ARGUMENT BY
  // POSITION. Nothing in the type system ties that index to the real signature,
  // so reordering a parameter would silently start replaying continuations,
  // which reads to the user as a feed that jumps back to page one. These cases
  // pin the position: the leading arguments listed here must be exactly the
  // arguments that come before the cursor.
  const CURSOR_CASES: Record<keyof typeof SOURCE_CURSOR_ARGUMENT, string[]> = {
    home: [undefined as unknown as string],
    subscriptions: [],
    history: [],
    search: ['query'],
    channel: ['c'],
    comments: ['abc'],
  }

  for (const [method, leading] of Object.entries(CURSOR_CASES)) {
    it(`reads the ${method} cursor from the argument runtime.ts retries on`, async () => {
      expect(SOURCE_CURSOR_ARGUMENT[method as keyof typeof SOURCE_CURSOR_ARGUMENT]).toBe(leading.length)
      const source = createYoutubeSource({
        fetch: globalThis.fetch,
        createClient: async () => createFakeClient(),
      })
      const call = source[method as keyof typeof CURSOR_CASES] as (...args: unknown[]) => Promise<unknown>
      // The first page has to exist before a continuation can be rejected as
      // unknown (channel continuations also require the channel to be loaded).
      await call(...leading)
      await expect(call(...leading, 'youtube:bogus')).rejects.toThrow('unknown continuation')
    })
  }

  it('rates a video on the WEB client rather than through the TV-context manager', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.rateVideo('abc', 'LIKE')).resolves.toMatchObject({ id: 'abc', likeStatus: 'LIKE' })
    await source.rateVideo('abc', 'DISLIKE')
    await source.rateVideo('abc', 'INDIFFERENT')
    expect(client.calls).toEqual(['/like/like', '/like/dislike', '/like/removelike'])
  })

  it('returns the channel with its new subscription state', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.setSubscribed('c', true)).resolves.toMatchObject({ id: 'c', isSubscribed: true })
    await expect(source.setSubscribed('c', false)).resolves.toMatchObject({ id: 'c', isSubscribed: false })
    await expect(source.setNotificationLevel('c', 'ALL')).resolves.toMatchObject({ id: 'c', notificationLevel: 'ALL' })
    expect(client.calls).toEqual(['subscribe:c', 'unsubscribe:c', 'notifications:c:ALL'])
  })

  it('keeps a loaded channel in step with a subscription write', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await source.channel('c')
    const updated = await source.setSubscribed('c', true)
    // The name survives from the cached read, so the write does not hand back a
    // channel stripped of everything it already knew.
    expect(updated).toMatchObject({ id: 'c', name: 'Channel', isSubscribed: true })
  })

  it('refuses writes when signed out instead of emitting an opaque innertube error', async () => {
    const client = createFakeClient()
    client.session.logged_in = false
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.rateVideo('abc', 'LIKE')).rejects.toThrow('sign in to rate a video')
    await expect(source.setSubscribed('c', true)).rejects.toThrow('sign in to change a subscription')
    expect(client.calls).toEqual([])
  })

  it('groups history by its section headings', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
      signedIn: () => true,
    })
    const page = await source.history()
    expect(page.sections.map((section) => section.title)).toEqual(['Today', 'Yesterday'])
    expect(page.sections[0]?.items[0]?.id).toBe('today')
  })

  it('refuses signed-out reads of the account feeds before any request', async () => {
    const client = createFakeClient()
    client.session.logged_in = false
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.subscriptions()).rejects.toThrow('sign in to see your subscriptions')
    await expect(source.history()).rejects.toThrow('sign in to see your history')
    await expect(source.subscribedChannels()).rejects.toThrow('sign in to see your subscriptions')
    expect(client.calls).toEqual([])
  })

  it('normalizes the subscribed channel rail off its author node', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
      signedIn: () => true,
    })
    await expect(source.subscribedChannels()).resolves.toEqual([
      { id: 'UC1', name: 'Chan', avatar: 'a', handle: undefined, subscriberCountText: undefined, videoCountText: undefined },
    ])
  })

  it('removes from history without needing the page to be open first', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => client,
      signedIn: () => true,
    })
    // removeVideo replaces its instance's contents when it has to page forward,
    // so each removal takes a fresh feed rather than reusing one that may have
    // already advanced past the video being removed.
    await expect(source.removeFromHistory('today')).resolves.toBe('today')
    expect(client.calls).toContain('removeHistory:today')
  })

  it('asks removeVideo to look past the first page', async () => {
    const client = createFakeClient()
    const requested: (number | undefined)[] = []
    client.getHistory = async () => ({
      ...feed('watched'),
      sections: [] as { header: { title: string }, contents: { video_id: string, title: { text: string } }[] }[],
      removeVideo: async (videoId: string, pagesToLoad?: number) => {
        requested.push(pagesToLoad)
        return void videoId
      },
    })
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => client,
      signedIn: () => true,
    })
    await source.removeFromHistory('deep')
    // The default is one page, which would fail for anything the user scrolled
    // past.
    expect(requested[0]).toBeGreaterThan(1)
  })

  it('survives a feed whose filter_chips getter throws', async () => {
    const client = createFakeClient()
    client.getHomeFeed = async () => ({
      ...feed('first'),
      // youtubei.js throws from this getter when the response carries no chip
      // bar, so optional chaining does not protect the call site.
      get filter_chips (): never { throw new Error('There are no feed filter chipbars') },
    })
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.home()).resolves.toMatchObject({ items: [{ id: 'first' }], chips: [] })
  })

  it('covers every cursored method declared to runtime.ts', () => {
    expect(Object.keys(CURSOR_CASES).sort()).toEqual(Object.keys(SOURCE_CURSOR_ARGUMENT).sort())
  })

  it('only lets a cursored read opt out of replay through a cursor argument', () => {
    // A method classified 'unless-cursor' decides replay by reading one
    // argument position, so it has to have one. Without this, the policy
    // silently degrades to 'always' and a paged feed restarts at page one.
    for (const [method, policy] of Object.entries(SOURCE_REPLAY)) {
      if (policy === 'unless-cursor') {
        expect(SOURCE_CURSOR_ARGUMENT).toHaveProperty(method)
      } else {
        expect(SOURCE_CURSOR_ARGUMENT).not.toHaveProperty(method)
      }
    }
  })

  it('stays signed in when the account lookup fails', async () => {
    const client = createFakeClient()
    client.account.getInfo = async () => {
      throw new Error('account fetch failed')
    }
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => client,
      signedIn: () => true,
    })
    await expect(source.session()).resolves.toEqual({ signedIn: true })
  })
})

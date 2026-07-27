import { describe, expect, it } from 'vitest'

import { createYoutubeSource } from '.'
import { SOURCE_CURSOR_ARGUMENT, SOURCE_REPLAY } from '../types'

type FakeFeed = {
  videos: { video_id: string, title: { text: string } }[]
  has_continuation: boolean
  getContinuation(): Promise<FakeFeed>
}

type FakeSearch = {
  videos: unknown[]
  results: unknown[]
  refinements: string[]
  estimated_results: number
  has_continuation: boolean
  getContinuation(): Promise<FakeSearch>
}

type FakeCommand = { call(actions: unknown, args?: Record<string, unknown>): Promise<unknown> }

type FakeComments = {
  contents: {
    comment: {
      comment_id: string
      content: { text: string }
      like_command?: FakeCommand
      dislike_command?: FakeCommand
      unlike_command?: FakeCommand
      reply_command?: { dialog?: { reply_button?: { endpoint?: FakeCommand } } }
    }
  }[]
  has_continuation: boolean
  getContinuation(): Promise<FakeComments>
}

type FakePlaylist = {
  info: { title: string, total_items: string }
  memo: Map<string, unknown[]>
  has_continuation: boolean
  getContinuation(): Promise<FakePlaylist>
}

type FakePlaylists = {
  playlists: unknown[]
  has_continuation: boolean
  getContinuation(): Promise<FakePlaylists>
}

const feed = (id: string, next?: () => Promise<FakeFeed>): FakeFeed => ({
  videos: [{ video_id: id, title: { text: id } }],
  has_continuation: Boolean(next),
  getContinuation: next ?? (() => Promise.reject(new Error('no continuation'))),
})

// A search response carries its rows on `results` rather than `videos`: that
// getter emits only videos, which is why channel and playlist hits were dropped.
const search = (id: string, next?: () => Promise<FakeSearch>): FakeSearch => ({
  videos: [],
  results: [
    { video_id: id, title: { text: id } },
    { id: 'UCchannel', author: { id: 'UCchannel', name: 'A Channel' }, subscriber_count: { text: '1M subscribers' } },
  ],
  refinements: ['refined query'],
  estimated_results: 1234,
  has_continuation: Boolean(next),
  getContinuation: next ?? (() => Promise.reject(new Error('no continuation'))),
})

// Comment actions are per-comment endpoints the source has to retain, so the
// fake carries real callables and records what was invoked.
const commentCalls: string[] = []

const commandFor = (id: string, name: string) => ({
  call: async (_actions: unknown, args?: Record<string, unknown>) => {
    commentCalls.push(args ? `${name}:${id}:${JSON.stringify(args)}` : `${name}:${id}`)
    return {}
  },
})

const comments = (id: string, next?: () => Promise<FakeComments>): FakeComments => ({
  contents: [{
    comment: {
      comment_id: id,
      content: { text: id },
      like_command: commandFor(id, 'like'),
      dislike_command: commandFor(id, 'dislike'),
      unlike_command: commandFor(id, 'unlike'),
      reply_command: { dialog: { reply_button: { endpoint: commandFor(id, 'reply') } } },
    },
  }],
  has_continuation: Boolean(next),
  getContinuation: next ?? (() => Promise.reject(new Error('no continuation'))),
})

// The playlist rows live in the memo rather than behind the `items` getter,
// which throws on any node outside its union.
const playlist = (id: string, next?: () => Promise<FakePlaylist>): FakePlaylist => ({
  info: { title: 'My playlist', total_items: '2 videos' },
  memo: new Map<string, unknown[]>([['PlaylistVideo', [
    { id, title: { text: id }, index: { text: '1' }, set_video_id: `set-${id}` },
  ]]]),
  has_continuation: Boolean(next),
  getContinuation: next ?? (() => Promise.reject(new Error('no continuation'))),
})

const playlists = (id: string, next?: () => Promise<FakePlaylists>): FakePlaylists => ({
  playlists: [{ id, title: { text: id }, video_count: { text: '3 videos' } }],
  has_continuation: Boolean(next),
  getContinuation: next ?? (() => Promise.reject(new Error('no continuation'))),
})

type FakePosts = {
  videos: unknown[]
  posts: unknown[]
  has_continuation: boolean
  getContinuation(): Promise<FakePosts>
}

// Community rows come off `posts`, which pageItems never reads: a post feed run
// through the video path yields an empty tab rather than an error.
const posts = (id: string, next?: () => Promise<FakePosts>): FakePosts => ({
  videos: [],
  posts: [{ id, content: { text: `Body of ${id}` }, published: { text: '2 days ago' }, author: { id: 'UC1', name: 'Chan' } }],
  has_continuation: Boolean(next),
  getContinuation: next ?? (() => Promise.reject(new Error('no continuation'))),
})

type FakeCall = { endpoint: string, args?: Record<string, unknown> }

const createFakeClient = () => {
  // Writes are verified by what reached the wire, so every outbound call is
  // recorded: the point of these tests is which endpoint fired, not the reply.
  const calls: string[] = []
  // The endpoint alone is not enough for a playlist edit: every one of them
  // POSTs to browse/edit_playlist and differs only in the body, which is also
  // where youtubei.js's own casing defects live.
  const payloads: FakeCall[] = []
  // Filter mapping is a translation layer to upstream's lowercase vocabulary, so
  // what actually reached the client is the only thing worth asserting on.
  const searchFilters: unknown[] = []
  return {
    calls,
    payloads,
    searchFilters,
    getHomeFeed: async () => feed('first', async () => feed('second')),
    search: async (_query: string, filters?: unknown) => {
      searchFilters.push(filters)
      return search('search', async () => search('search-2'))
    },
    getSearchSuggestions: async (query: string) => [`${query} one`, `${query} two`],
    getBasicInfo: async () => ({ basic_info: undefined }),
    getChannel: async () => {
      // Real methods rather than arrows, and each one checks its receiver. Every
      // upstream tab opener is a prototype method that reaches for
      // `this.getTabByURL`, so looking one up and calling it bare fails with
      // `reading 'getTabByURL' of undefined`. An arrow would ignore `this` and
      // let that regression through.
      const channel = {
        ...feed('channel'),
        metadata: { external_id: 'c', title: 'Channel' },
        has_videos: true,
        has_playlists: true,
        has_community: true,
        has_about: true,
        async getVideos(this: unknown) {
          if (this !== channel) throw new TypeError("Cannot read properties of undefined (reading 'getTabByURL')")
          return feed('channel-videos', async () => feed('channel-videos-2'))
        },
        async getPlaylists(this: unknown) {
          if (this !== channel) throw new TypeError("Cannot read properties of undefined (reading 'getTabByURL')")
          return feed('channel-playlists', async () => feed('channel-playlists-2'))
        },
        async getCommunity(this: unknown) {
          if (this !== channel) throw new TypeError("Cannot read properties of undefined (reading 'getTabByURL')")
          return posts('post-1', async () => posts('post-2'))
        },
        async getAbout(this: unknown) {
          if (this !== channel) throw new TypeError("Cannot read properties of undefined (reading 'getTabByURL')")
          return { metadata: { description: 'About us', country: 'Norway', view_count: '1,234 views', links: [{ title: { text: 'Site' }, link: { text: 'example.com' } }] } }
        },
      }
      return channel
    },
    getComments: async () => comments('top', async () => comments('next')),
    getPlaylists: async () => playlists('PLone', async () => playlists('PLtwo')),
    getPlaylist: async (id: string) => playlist(`${id}-first`, async () => playlist(`${id}-second`)),
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
      comment: async (videoId: string, body: string) => void calls.push(`comment:${videoId}:${body}`),
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
      execute: async (endpoint: string, args?: Record<string, unknown>) => {
        calls.push(endpoint)
        payloads.push({ endpoint, args })
        const memo: [string, unknown[]][] = [
          ['VideoPrimaryInfo', [{ view_count: { view_count: { text: '42 views' } } }]],
        ]
        // The queue panel only comes back when /next was asked for one, and it
        // rides on the same TwoColumnWatchNextResults the memo already holds.
        if (args?.playlistId) {
          memo.push(['TwoColumnWatchNextResults', [{
            playlist: {
              id: args.playlistId,
              title: 'Queue',
              author: { name: 'Owner' },
              contents: [
                { video_id: 'q1', title: { text: 'First' }, thumbnail: [{ url: 'q1.jpg', width: 320 }], duration: { seconds: 61 } },
                { primary: { video_id: 'q2', title: { text: 'Second' } } },
                { playlist_video: {} },
              ],
              current_index: args.playlistIndex ?? 0,
              is_infinite: false,
            },
          }]])
        }
        return {
          success: true,
          // `playlistId` is optional on the wire: playlist/create is the only
          // call here that returns one, and it is never validated upstream.
          data: { playlistId: 'PLnew' } as { playlistId?: string },
          contents_memo: new Map<string, unknown[]>(memo),
        }
      },
    },
  }
}

describe('youtube comment writes', () => {
  it('acts through the endpoint the page arrived with, not the comment id', async () => {
    commentCalls.length = 0
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const page = await source.comments('abc')
    const token = page.items[0]?.actionsToken
    // The commands are opaque per-comment protobuf params: without a retained
    // handle there is no way to reach them from the id alone.
    expect(token).toBeTruthy()

    await source.rateComment(token!, 'LIKE')
    await source.rateComment(token!, 'DISLIKE')
    // Clearing a rating is its own endpoint rather than a parameter, so
    // INDIFFERENT has to undo whichever direction was set.
    await source.rateComment(token!, 'INDIFFERENT')
    await source.replyToComment(token!, 'well said')
    expect(commentCalls).toEqual([
      'like:top',
      'dislike:top',
      'unlike:top',
      'reply:top:{"commentText":"well said"}',
    ])
  })

  it('reports an evicted comment handle as reloadable rather than failing opaquely', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    await expect(source.rateComment('youtube:comment:99999', 'LIKE'))
      .rejects.toThrow('no longer available')
  })

  it('posts a top-level comment through the video rather than a handle', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.postComment('abc', 'first')).resolves.toBe(true)
    expect(client.calls).toContain('comment:abc:first')
  })
})

describe('youtube search', () => {
  it('keeps channel and playlist hits that the videos getter drops', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const results = await source.search('query')
    // The rows are tagged rather than wrapped, so the worker's __resolveType is
    // a field switch and GraphQL still resolves each member's own fields off
    // this same object.
    expect(results.results.map((row) => row.kind)).toEqual(['video', 'channel'])
    expect(results.results[0]).toMatchObject({ kind: 'video', id: 'search' })
    expect(results.results[1]).toMatchObject({ kind: 'channel', id: 'UCchannel', name: 'A Channel' })
    expect(results.refinements).toEqual(['refined query'])
    expect(results.estimatedResults).toBe(1234)
  })

  it('translates the filter vocabulary and drops the unset axes', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await source.search('query', { uploadDate: 'WEEK', sortBy: 'POPULARITY', features: ['FOUR_K', 'CREATIVE_COMMONS'] })
    // ALL is the unset state on every axis: sending it would be a real filter
    // value upstream rather than an absent one.
    await source.search('query', { uploadDate: 'ALL', type: 'ALL' })
    expect(client.searchFilters[0]).toEqual({
      upload_date: 'week',
      type: undefined,
      duration: undefined,
      prioritize: 'popularity',
      features: ['4k', 'creative_commons'],
    })
    expect(client.searchFilters[1]).toBeUndefined()
  })

  it('refuses a cursor minted under a different filter set', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const unfiltered = await source.search('query')
    expect(unfiltered.cursor).toBeTruthy()
    // Paging a narrowed search with the unfiltered cursor would append results
    // the filter excludes, which reads as the filter silently switching off.
    await expect(source.search('query', { uploadDate: 'WEEK' }, unfiltered.cursor))
      .rejects.toThrow('belongs to')
    // The same filter set still pages normally.
    await expect(source.search('query', undefined, unfiltered.cursor)).resolves.toBeTruthy()
  })

  it('degrades suggestions to an empty list rather than failing the header', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    expect(await source.searchSuggestions('bl')).toEqual(['bl one', 'bl two'])
    // An empty box has nothing to suggest and must not cost a round trip.
    expect(await source.searchSuggestions('   ')).toEqual([])
    client.getSearchSuggestions = async () => { throw new Error('suggest host unreachable') }
    expect(await source.searchSuggestions('bl')).toEqual([])
  })
})

describe('youtube channel tabs', () => {
  it('reports only the tabs the channel actually has', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const result = await source.channel('c')
    // The fake carries Videos and Playlists only, so Shorts must not appear:
    // opening a tab a channel lacks throws `Tab "shorts" not found` upstream.
    // About and Search render their own surface, so they sit after the content
    // tabs rather than inside the feed table.
    expect(result.availableTabs).toEqual(['VIDEOS', 'PLAYLISTS', 'COMMUNITY', 'ABOUT'])
    expect(result.tab).toBe('VIDEOS')
    expect(result.videos.items[0]?.id).toBe('channel-videos')
  })

  it('opens the requested tab and ignores one the channel does not have', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const playlists = await source.channel('c', 'PLAYLISTS')
    expect(playlists.tab).toBe('PLAYLISTS')
    expect(playlists.videos.items[0]?.id).toBe('channel-playlists')
    // Falling back beats throwing at the page for a tab that is not there.
    const missing = await source.channel('c', 'SHORTS')
    expect(missing.tab).toBe('VIDEOS')
  })

  it('refuses a cursor minted for a different tab of the same channel', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const videos = await source.channel('c')
    expect(videos.videos.cursor).toBeTruthy()
    await expect(source.channel('c', 'PLAYLISTS', undefined, undefined, videos.videos.cursor))
      .rejects.toThrow('belongs to')
  })
})

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
    // Two different rejections, both of which have to hold. Search keeps its own
    // registry now (its pages are a union, not a video list), so a home cursor
    // is not merely the wrong KIND there, it does not exist at all.
    await expect(source.search('query', undefined, home.cursor)).rejects.toThrow('unknown continuation')
    // Within one registry the kind is what separates feeds, and that check is
    // the one that stops a home cursor from paging the subscriptions feed.
    await expect(source.subscriptions(home.cursor)).rejects.toThrow('belongs to home')
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
    const second = await source.comments('abc', undefined, first.cursor)
    expect(second.items[0]?.id).toBe('next')
    expect(second.cursor).toBeUndefined()
    await expect(source.comments('abc', undefined, first.cursor)).resolves.toMatchObject({ items: [{ id: 'next' }] })
    // Comment cursors are scoped to their video, so the same cursor must not
    // page a different video's comments.
    await expect(source.comments('other', undefined, first.cursor)).rejects.toThrow('belongs to comments:abc')
    // ...nor a different ORDERING of the same video: Top and Newest interleave
    // into nonsense if one's cursor pages the other.
    await expect(source.comments('abc', 'NEWEST', first.cursor)).rejects.toThrow('belongs to comments:abc:TOP')
  })

  it('pages a playlist with cursors scoped to that playlist', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const first = await source.playlist('PL1')
    expect(first.items[0]?.video.id).toBe('PL1-first')
    expect(first.items[0]?.setVideoId).toBe('set-PL1-first')
    expect(first.items[0]?.index).toBe(1)
    const second = await source.playlist('PL1', first.cursor)
    expect(second.items[0]?.video.id).toBe('PL1-second')
    // A continuation response carries no header, so the playlist has to be the
    // one read from the first page rather than an entity stripped of its title.
    expect(second.playlist).toEqual(first.playlist)
    await expect(source.playlist('PL2', first.cursor)).rejects.toThrow('belongs to playlist:PL1')
  })

  it('reads playlist details off the first page and covers it with the first row', async () => {
    const client = createFakeClient()
    client.getPlaylist = async (id: string) => ({
      ...playlist(id),
      memo: new Map<string, unknown[]>([['PlaylistVideo', [
        { id: 'row', title: { text: 'Row' }, thumbnails: [{ url: 'cover', width: 640 }] },
      ]]]),
    })
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    // The playlist id is nowhere in the response, so it can only come from the
    // id the caller browsed with.
    await expect(source.playlist('PL1')).resolves.toMatchObject({
      playlist: { id: 'PL1', title: 'My playlist', videoCountText: '2 videos', thumbnail: 'cover' },
    })
  })

  it('opens a playlist signed out and gates only the playlist library', async () => {
    const client = createFakeClient()
    client.session.logged_in = false
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.playlists()).rejects.toThrow('sign in to see your playlists')
    await expect(source.playlist('PL1')).resolves.toMatchObject({ playlist: { id: 'PL1' } })
  })

  it('pages the playlist library', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const first = await source.playlists()
    expect(first.items).toEqual([
      { id: 'PLone', title: 'PLone', thumbnail: undefined, videoCountText: '3 videos', channel: undefined },
    ])
    const second = await source.playlists(first.cursor)
    expect(second.items[0]?.id).toBe('PLtwo')
    expect(second.cursor).toBeUndefined()
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
  /* commentReplies is deliberately absent: this table encodes "leading
     arguments, then the cursor", and its ONLY argument is the cursor. There is
     no first-page call to make before one can be rejected, so it gets its own
     test below rather than a fake entry here. */
  const CURSOR_CASES: Record<Exclude<keyof typeof SOURCE_CURSOR_ARGUMENT, 'commentReplies'>, string[]> = {
    home: [undefined as unknown as string],
    subscriptions: [],
    history: [],
    // Both grew arguments in front of the cursor: search gained `filters` and
    // channel gained `tab`, `sort` and `query`.
    search: ['query', undefined as unknown as string],
    channel: ['c', undefined as unknown as string, undefined as unknown as string, undefined as unknown as string],
    comments: ['abc', undefined as unknown as string],
    communityPosts: ['c'],
    playlists: [],
    playlist: ['PL1'],
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

  it('carries playlist context into the /next call and reads the queue back', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    const meta = await source.watch('abc', 'PL1', 0)
    // `playlistIndex` is the key /next reads. `index` is only an alias inside
    // youtubei.js's WatchNextEndpoint.buildRequest, which execute never runs, so
    // sending it would ship a key InnerTube ignores and silently start the
    // queue at the wrong row.
    expect(client.payloads[0]?.args).toMatchObject({ videoId: 'abc', playlistId: 'PL1', playlistIndex: 0 })
    expect(client.payloads[0]?.args).not.toHaveProperty('index')
    expect(meta?.playlist).toMatchObject({ id: 'PL1', title: 'Queue', author: 'Owner', currentIndex: 0, isInfinite: false })
    // A wrapper's `primary` is unwrapped, and the mix teaser tail, which
    // carries no video at all, drops out instead of becoming an empty row.
    expect(meta?.playlist?.items.map((video) => video.id)).toEqual(['q1', 'q2'])
    expect(meta?.playlist?.items[0]).toMatchObject({ thumbnail: 'q1.jpg', durationSeconds: 61 })
  })

  it('leaves the playlist keys off a watch with no playlist context', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    const meta = await source.watch('abc')
    expect(client.payloads[0]?.args).not.toHaveProperty('playlistId')
    expect(client.payloads[0]?.args).not.toHaveProperty('playlistIndex')
    expect(meta?.playlist).toBeUndefined()
  })

  it('edits playlist rows through one endpoint, addressing entries by set video id', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await source.addToPlaylist('PL1', ['a', 'b'])
    await source.removeFromPlaylist('PL1', ['set-a'])
    await source.movePlaylistItem('PL1', 'set-b', 'set-a')
    await source.movePlaylistItem('PL1', 'set-b')
    expect(client.calls).toEqual(Array.from({ length: 4 }, () => 'browse/edit_playlist'))
    expect(client.payloads.map((call) => call.args)).toEqual([
      {
        playlistId: 'PL1',
        actions: [
          { action: 'ACTION_ADD_VIDEO', addedVideoId: 'a' },
          { action: 'ACTION_ADD_VIDEO', addedVideoId: 'b' },
        ],
      },
      { playlistId: 'PL1', actions: [{ action: 'ACTION_REMOVE_VIDEO', setVideoId: 'set-a' }] },
      {
        playlistId: 'PL1',
        actions: [{ action: 'ACTION_MOVE_VIDEO_AFTER', setVideoId: 'set-b', movedSetVideoIdPredecessor: 'set-a' }],
      },
      // No predecessor asks for the first position, so the key is omitted
      // rather than sent as an empty target.
      { playlistId: 'PL1', actions: [{ action: 'ACTION_MOVE_VIDEO_AFTER', setVideoId: 'set-b' }] },
    ])
  })

  it('renames through a payload that actually carries the playlist id', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.renamePlaylist('PL1', 'New name')).resolves.toMatchObject({ id: 'PL1', title: 'New name' })
    // youtubei.js's setName writes the id as snake_case `playlist_id`, which
    // PlaylistEditEndpoint drops on its way to the wire, so the rename ships
    // with no target at all. The id has to go out as camelCase `playlistId`.
    expect(client.payloads[0]).toEqual({
      endpoint: 'browse/edit_playlist',
      args: { playlistId: 'PL1', actions: [{ action: 'ACTION_SET_PLAYLIST_NAME', playlistName: 'New name' }] },
    })
  })

  it('sets a description and a privacy through the same edit endpoint', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.setPlaylistDescription('PL1', 'About')).resolves.toMatchObject({ id: 'PL1', description: 'About' })
    await expect(source.setPlaylistPrivacy('PL1', 'UNLISTED')).resolves.toMatchObject({ id: 'PL1', privacy: 'UNLISTED' })
    expect(client.payloads.map((call) => call.args?.actions)).toEqual([
      [{ action: 'ACTION_SET_PLAYLIST_DESCRIPTION', playlistDescription: 'About' }],
      [{ action: 'ACTION_SET_PLAYLIST_PRIVACY', playlistPrivacy: 'UNLISTED' }],
    ])
  })

  it('creates a playlist through the endpoint so privacy and description survive', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    // The manager's create() sends only a title and video ids; the endpoint it
    // calls copies privacyStatus and description too, and creation is the one
    // attested way to set privacy in this version.
    await expect(source.createPlaylist('Mix', ['a'], 'PRIVATE', 'Notes')).resolves.toEqual({
      id: 'PLnew',
      title: 'Mix',
      description: 'Notes',
      privacy: 'PRIVATE',
    })
    expect(client.payloads[0]).toEqual({
      endpoint: 'playlist/create',
      args: { title: 'Mix', videoIds: ['a'], privacyStatus: 'PRIVATE', description: 'Notes' },
    })
  })

  it('refuses a created playlist whose id did not come back', async () => {
    const client = createFakeClient()
    client.actions.execute = async () => ({
      success: true,
      data: {} as { playlistId?: string },
      contents_memo: new Map<string, unknown[]>(),
    })
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    // The id is the only server-generated value in the write path and it is
    // optional on the wire. Without it the entity has no cache key, so the
    // caller has to reread the library rather than merge a stub.
    await expect(source.createPlaylist('Mix')).rejects.toThrow('its id did not come back')
  })

  it('deletes through the path youtubei.js cannot reach', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    // client.playlist.delete throws before the network in 17.0.1: it builds a
    // raw key with no registered endpoint class, so no api_url is ever found.
    await expect(source.deletePlaylist('PL1')).resolves.toBe('PL1')
    expect(client.payloads[0]).toEqual({ endpoint: 'playlist/delete', args: { playlistId: 'PL1' } })
  })

  it('carries a read playlist forward into what a write resolves to', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await source.playlist('PL1')
    // Playlist.title is non-null in the schema and no edit endpoint hands a
    // playlist back, so a write on an already-read playlist has to resolve with
    // the title it knows rather than blanking the cached entity.
    await expect(source.addToPlaylist('PL1', ['a'])).resolves.toMatchObject({ id: 'PL1', title: 'My playlist' })
  })

  it('does not POST an edit for an empty selection', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await source.addToPlaylist('PL1', [])
    await source.removeFromPlaylist('PL1', [])
    expect(client.payloads).toEqual([])
  })

  it('refuses playlist writes when signed out', async () => {
    const client = createFakeClient()
    client.session.logged_in = false
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    // browse/edit_playlist carries no browseId, and youtubei.js only runs its
    // signed-in precheck for payloads that have one, so nothing upstream would
    // stop these.
    await expect(source.addToPlaylist('PL1', ['a'])).rejects.toThrow('sign in to save to a playlist')
    await expect(source.removeFromPlaylist('PL1', ['set-a'])).rejects.toThrow('sign in to change a playlist')
    await expect(source.renamePlaylist('PL1', 'x')).rejects.toThrow('sign in to rename a playlist')
    await expect(source.setPlaylistDescription('PL1', 'x')).rejects.toThrow('sign in to change a playlist description')
    await expect(source.setPlaylistPrivacy('PL1', 'PRIVATE')).rejects.toThrow('sign in to change a playlist privacy')
    await expect(source.movePlaylistItem('PL1', 'set-a')).rejects.toThrow('sign in to reorder a playlist')
    await expect(source.createPlaylist('Mix')).rejects.toThrow('sign in to create a playlist')
    await expect(source.deletePlaylist('PL1')).rejects.toThrow('sign in to delete a playlist')
    expect(client.payloads).toEqual([])
  })

  it('classifies every playlist write as non-replayable', () => {
    // runtime.ts replays a failed call against a rebuilt engine unless the
    // policy forbids it. A replayed edit adds the same video twice, or leaves a
    // second playlist behind with the same title.
    const writes = [
      'addToPlaylist',
      'removeFromPlaylist',
      'createPlaylist',
      'deletePlaylist',
      'renamePlaylist',
      'setPlaylistDescription',
      'setPlaylistPrivacy',
      'movePlaylistItem',
    ] as const
    for (const method of writes) expect(SOURCE_REPLAY[method]).toBe('never')
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
    // The exclusion is listed rather than assumed, so a method dropped from the
    // table by accident still fails here. commentReplies is covered by its own
    // test: its only argument is the cursor, so there are no leading arguments
    // for the table to pin and no first-page call to make first.
    const covered = [...Object.keys(CURSOR_CASES), 'commentReplies']
    expect(covered.sort()).toEqual(Object.keys(SOURCE_CURSOR_ARGUMENT).sort())
  })

  it('takes only a replies cursor, and says so when handed another feed\'s', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    // Unknown cursors report the same way every other feed reports them.
    await expect(source.commentReplies('youtube:bogus')).rejects.toThrow('unknown continuation')
    // A REAL cursor from the comment list is a different mistake: replies and
    // the list they hang off page different things through one registry.
    const list = await source.comments('abc')
    expect(list.cursor).toBeTruthy()
    await expect(source.commentReplies(list.cursor!)).rejects.toThrow('not a reply thread')
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

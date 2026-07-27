import type { Source, SourceChannel, SourceCommentPage, SourceLikeStatus, SourceNotificationLevel, SourcePlaylist, SourcePlaylistItem, SourcePlaylistListPage, SourcePlaylistPage, SourcePlaylistPrivacy, SourceSectionedVideoPage, SourceVideo, SourceVideoPage } from '../types'

import { Innertube } from 'youtubei.js/web'

import { normalizeChannel, normalizeCommentThread, normalizeFeedChannel, normalizeFeedVideo, normalizeGridPlaylist, normalizeLockupVideo, normalizePlaylistDetails, normalizePlaylistItem, normalizePlaylistLockup, normalizeSession, normalizeVideoDetails, normalizeWatchMeta } from './normalize'

type Feed = {
  videos: Iterable<unknown>
  memo?: Map<string, unknown[]>
  has_continuation: boolean
  getContinuation(): Promise<Feed>
}

type FilterChip = {
  title?: unknown
  is_selected?: boolean
  endpoint?: { payload?: { token?: string, params?: string } }
}

type HomeFeedResponse = Feed & {
  filter_chips?: FilterChip[]
  applyFilter?: (chip: FilterChip) => Promise<HomeFeedResponse>
}

// History and Subscriptions group their items under headings. `sections` is the
// grouped view; the flat `videos` getter throws the boundaries away.
type SectionedFeed = Feed & {
  sections?: { header?: { title?: unknown }, contents?: Iterable<unknown> }[]
  removeVideo?: (videoId: string, pagesToLoad?: number) => Promise<unknown>
}

type ChannelsFeed = {
  channels?: Iterable<unknown>
}

type ChannelFeed = Feed & {
  metadata?: unknown
  has_videos?: boolean
  getVideos?: () => Promise<ChannelFeed>
}

type CommentsFeed = {
  contents: Iterable<unknown>
  has_continuation: boolean
  getContinuation(): Promise<CommentsFeed>
}

// The library aggregation is a plain Feed, so the playlists it holds come off
// the `playlists` getter rather than `videos`.
type PlaylistsFeed = {
  playlists?: Iterable<unknown>
  has_continuation: boolean
  getContinuation(): Promise<PlaylistsFeed>
}

// A single playlist exposes its rows through `items`, but that getter casts
// every node the page carries and THROWS on anything outside its expected
// union: one stray recommended video detonates the whole list. The memo is read
// directly instead, which is the same set without the cast.
type PlaylistFeed = {
  info?: unknown
  memo?: Map<string, unknown[]>
  has_continuation: boolean
  getContinuation(): Promise<PlaylistFeed>
}

// One edit endpoint backs every playlist mutation; the action name selects
// which fields of this union are read. `browse/edit_playlist` forwards the
// array verbatim, so an action it does not know is silently ignored rather than
// rejected.
type PlaylistEditAction = {
  action: string
  addedVideoId?: string
  setVideoId?: string
  movedSetVideoIdPredecessor?: string
  playlistName?: string
  playlistDescription?: string
  playlistPrivacy?: SourcePlaylistPrivacy
}

// Without `parse: true` an action resolves to youtubei.js's Axios-shaped
// wrapper around the UNPARSED response, so `data` is raw InnerTube JSON.
type ApiResponse = {
  success?: boolean
  data?: { playlistId?: string }
}

export type YoutubeClient = {
  getHomeFeed(): Promise<HomeFeedResponse>
  getSubscriptionsFeed(): Promise<SectionedFeed>
  getHistory(): Promise<SectionedFeed>
  getChannelsFeed(): Promise<ChannelsFeed>
  search(query: string): Promise<Feed>
  getBasicInfo(id: string): Promise<{ basic_info?: unknown }>
  getChannel(id: string): Promise<ChannelFeed>
  getComments(videoId: string): Promise<CommentsFeed>
  getPlaylists(): Promise<PlaylistsFeed>
  getPlaylist(id: string): Promise<PlaylistFeed>
  account: {
    getInfo(): Promise<unknown>
  }
  interact: {
    subscribe(channelId: string): Promise<unknown>
    unsubscribe(channelId: string): Promise<unknown>
    setNotificationPreferences(channelId: string, type: SourceNotificationLevel): Promise<unknown>
  }
  session: {
    logged_in: boolean
  }
  actions: {
    // `playlistId` and `playlistIndex` are the keys /next actually reads.
    // youtubei.js's own WatchNextEndpoint also accepts `index` as an alias, but
    // that alias only exists inside its buildRequest, which execute never runs:
    // a raw `index` key would go out untouched and be ignored.
    execute(endpoint: '/next', args: { videoId: string, racyCheckOk: boolean, contentCheckOk: boolean, playlistId?: string, playlistIndex?: number, parse: true }): Promise<unknown>
    execute(endpoint: '/like/like' | '/like/dislike' | '/like/removelike', args: { target: { videoId: string } }): Promise<unknown>
    execute(endpoint: 'browse/edit_playlist', args: { playlistId: string, actions: PlaylistEditAction[] }): Promise<ApiResponse>
    execute(endpoint: 'playlist/create', args: { title: string, videoIds: string[], privacyStatus?: SourcePlaylistPrivacy, description?: string }): Promise<ApiResponse>
    execute(endpoint: 'playlist/delete', args: { playlistId: string }): Promise<ApiResponse>
  }
}

export type YoutubeSourceOptions = {
  fetch: typeof globalThis.fetch
  createClient?: () => Promise<YoutubeClient>
  signedIn?: () => boolean
}

const pageItems = (feed: Feed) => {
  // youtubei.js's `videos` getter surfaces legacy Video/GridVideo nodes but NOT
  // LockupView, and a modern feed (the signed-in home grid, channel Videos tab)
  // MIXES the two. Merging rather than either/or is essential: a single stray
  // legacy video used to short-circuit the LockupView branch and hide the whole
  // grid: the signed-in home then showed just that one video.
  const seen = new Set<string>()
  const items: SourceVideo[] = []
  const add = (video: SourceVideo | undefined) => {
    if (video && !seen.has(video.id)) {
      seen.add(video.id)
      items.push(video)
    }
  }
  for (const node of feed.videos) add(normalizeFeedVideo(node))
  for (const node of feed.memo?.get('LockupView') ?? []) add(normalizeLockupVideo(node))
  return items
}

// Cursors used to be one-shot: reading one deleted it, so any repeat of the same
// query threw `unknown continuation`. urql re-executes queries on remount and on
// back-navigation, so the second page of a feed died as soon as the user opened a
// video and came back. Pages are memoized per cursor instead, and the cursor
// carries the feed it belongs to so a home cursor cannot continue a search.
const CONTINUATION_LIMIT = 64

const createContinuations = <Page>() => {
  type Entry = { kind: string, load: () => Promise<Page>, result?: Promise<Page> }
  const entries = new Map<string, Entry>()
  let cursorId = 0

  const register = (kind: string, load: () => Promise<Page>) => {
    const cursor = `youtube:${kind}:${++cursorId}`
    entries.set(cursor, { kind, load })
    // Insertion order is eviction order, and `resolve` re-inserts on read, so
    // the cursors a user is actually paging through stay live.
    while (entries.size > CONTINUATION_LIMIT) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
    return cursor
  }

  const resolve = (kind: string, cursor: string) => {
    const entry = entries.get(cursor)
    if (!entry) throw new Error(`youtube: unknown continuation ${cursor}`)
    if (entry.kind !== kind) throw new Error(`youtube: continuation ${cursor} belongs to ${entry.kind}, not ${kind}`)
    if (!entry.result) {
      const result = entry.load()
      entry.result = result
      // A failed page must not be cached as the answer forever: drop it so the
      // next attempt refetches rather than replaying a transient network error.
      void result.catch(() => {
        if (entry.result === result) entry.result = undefined
      })
    }
    entries.delete(cursor)
    entries.set(cursor, entry)
    return entry.result
  }

  return { register, resolve }
}

// youtubei.js Text instances stringify through toString; feed nodes hand back
// either shape depending on the renderer.
const text = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  const node = value as { text?: string, toString?: () => string } | undefined
  if (node?.text) return node.text
  const stringified = node?.toString?.()
  return stringified && stringified !== 'N/A' ? stringified : undefined
}

// The chip's continuation token identifies it; its title is localized and would
// change under a different hl.
const chipId = (chip: { endpoint?: { payload?: { token?: string, params?: string } } }) =>
  chip.endpoint?.payload?.token ?? chip.endpoint?.payload?.params

// removeVideo defaults to scanning a single page, so anything the user has
// scrolled past would report 'Unable to find video in watch history'. Bounded
// because each extra page is a tunneled round trip.
const HISTORY_REMOVAL_PAGES = 10

// filter_chips THROWS when a feed carries no chip bar (and when it carries more
// than one), so it cannot be read with optional chaining. A feed without chips
// is ordinary, not an error.
const filterChipsOf = (feed: { filter_chips?: FilterChip[] }): FilterChip[] => {
  try {
    return feed.filter_chips ?? []
  } catch {
    return []
  }
}

const LIKE_ENDPOINT = {
  LIKE: '/like/like',
  DISLIKE: '/like/dislike',
  INDIFFERENT: '/like/removelike',
} as const satisfies Record<SourceLikeStatus, string>

// A write against a signed-out session comes back as an opaque innertube error,
// so it is refused up front with something the UI can act on.
const requireSignIn = (client: YoutubeClient, action: string) => {
  if (!client.session.logged_in) throw new Error(`youtube: sign in to ${action}`)
}

export const createYoutubeSource = ({ fetch, createClient, signedIn }: YoutubeSourceOptions): Source => {
  const client = createClient?.() ?? Innertube.create({ fetch, retrieve_player: false }) as unknown as Promise<YoutubeClient>
  const videoContinuations = createContinuations<SourceVideoPage>()
  const sectionContinuations = createContinuations<SourceSectionedVideoPage>()
  const commentContinuations = createContinuations<SourceCommentPage>()
  const playlistContinuations = createContinuations<SourcePlaylistPage>()
  const playlistListContinuations = createContinuations<SourcePlaylistListPage>()
  const channels = new Map<string, SourceChannel>()
  // A playlist write never refetches the playlist, and every mutation resolves
  // to a Playlist whose `title` is non-null, so the last read of each playlist
  // is kept to fill the fields the write did not touch.
  const knownPlaylists = new Map<string, SourcePlaylist>()

  const page = (kind: string, feed: Feed): SourceVideoPage => {
    const result: SourceVideoPage = { items: pageItems(feed) }
    if (feed.has_continuation) {
      result.cursor = videoContinuations.register(kind, async () => page(kind, await feed.getContinuation()))
    }
    return result
  }

  // Sections carry the day headings the History page is built around. A feed
  // that reports none still yields one untitled section, so the caller renders
  // a plain list rather than nothing.
  const sectionedPage = (kind: string, feed: SectionedFeed): SourceSectionedVideoPage => {
    const sections = (feed.sections ?? []).flatMap((section) => {
      const items = [...(section.contents ?? [])]
        .map((node) => normalizeFeedVideo(node) ?? normalizeLockupVideo(node))
        .filter((video) => video !== undefined)
      if (items.length === 0) return []
      return [{ title: text(section.header?.title), items }]
    })
    const result: SourceSectionedVideoPage = {
      sections: sections.length > 0 ? sections : [{ items: pageItems(feed) }],
    }
    if (feed.has_continuation) {
      result.cursor = sectionContinuations.register(
        kind,
        async () => sectionedPage(kind, await feed.getContinuation() as SectionedFeed),
      )
    }
    return result
  }

  const commentPage = (videoId: string, comments: CommentsFeed): SourceCommentPage => {
    const result: SourceCommentPage = {
      items: [...comments.contents].map(normalizeCommentThread).filter((comment) => comment !== undefined),
    }
    if (comments.has_continuation) {
      result.cursor = commentContinuations.register(
        `comments:${videoId}`,
        async () => commentPage(videoId, await comments.getContinuation()),
      )
    }
    return result
  }

  // Rows come straight out of the memo. The `items` getter casts the page's
  // whole video set in one go and throws on anything outside its union, so a
  // single recommended-video rail on the page loses the entire list. Only
  // PlaylistVideo is accepted: it is the one renderer carrying set_video_id,
  // which every later edit of the playlist needs.
  const playlistItems = (feed: PlaylistFeed) =>
    (feed.memo?.get('PlaylistVideo') ?? [])
      .map(normalizePlaylistItem)
      .filter((item) => item !== undefined)

  // The playlist entity is threaded through every page rather than re-read: a
  // continuation response carries no header and no sidebar, so reading its
  // `info` would hand back a playlist stripped of its title and stats.
  const playlistPage = (id: string, playlist: SourcePlaylist, feed: PlaylistFeed, items: SourcePlaylistItem[]): SourcePlaylistPage => {
    const result: SourcePlaylistPage = { playlist, items }
    if (feed.has_continuation) {
      result.cursor = playlistContinuations.register(`playlist:${id}`, async () => {
        const next = await feed.getContinuation()
        return playlistPage(id, playlist, next, playlistItems(next))
      })
    }
    return result
  }

  const rememberPlaylist = (playlist: SourcePlaylist) => {
    knownPlaylists.set(playlist.id, playlist)
    return playlist
  }

  // The entity a write resolves to. Only the changed fields are real; the rest
  // is whatever the last read of this playlist held, because none of the edit
  // endpoints hands back a parseable playlist (they answer with an undocumented
  // raw `actions` array). `title` falls back to '' the way setSubscribed fills
  // Channel.name: the schema forbids null there, and the mutation document is
  // not supposed to select it unless the write set it.
  const writtenPlaylist = (id: string, changed: Partial<SourcePlaylist>): SourcePlaylist => {
    const known = knownPlaylists.get(id)
    const next: SourcePlaylist = { ...known, id, title: known?.title ?? '', ...changed }
    // Only refresh what was already cached: a write must not mint a stub that a
    // later read of the library would then be merged into.
    if (known) knownPlaylists.set(id, next)
    return next
  }

  // Every playlist edit is the same POST with a different action. youtubei.js's
  // PlaylistManager wraps some of these, but its wrappers pay a browse (plus a
  // continuation per extra page) to translate video ids into set video ids, and
  // one of them ships a broken body, so the endpoint is called directly.
  const editPlaylist = async (id: string, reason: string, actions: PlaylistEditAction[]) => {
    const active = await client
    // `browse/edit_playlist` carries no browseId, and youtubei.js only runs its
    // signed-in precheck for payloads that have one, so an anonymous edit would
    // otherwise go out and come back as an opaque failure.
    requireSignIn(active, reason)
    await active.actions.execute('browse/edit_playlist', { playlistId: id, actions })
  }

  // The aggregation mixes modern lockups with legacy Playlist/GridPlaylist
  // nodes, and its lockup filter also admits albums and podcasts, which
  // normalizePlaylistLockup drops.
  const playlistListPage = (feed: PlaylistsFeed): SourcePlaylistListPage => {
    const result: SourcePlaylistListPage = {
      items: [...(feed.playlists ?? [])]
        .map((node) => normalizePlaylistLockup(node) ?? normalizeGridPlaylist(node))
        .filter((playlist) => playlist !== undefined)
        .map(rememberPlaylist),
    }
    if (feed.has_continuation) {
      result.cursor = playlistListContinuations.register(
        'playlists',
        async () => playlistListPage(await feed.getContinuation()),
      )
    }
    return result
  }

  return {
    id: 'youtube',
    // The chip is part of the continuation kind so a cursor minted under one
    // filter cannot page another one's results.
    home: async (chip, cursor) => {
      const kind = chip ? `home:${chip}` : 'home'
      if (cursor) {
        const next = await videoContinuations.resolve(kind, cursor)
        return { items: next.items, chips: [], cursor: next.cursor }
      }
      const feed = await (await client).getHomeFeed()
      const chips = filterChipsOf(feed)
      // applyFilter costs a second browse round trip, so it only runs when a
      // chip other than All is actually selected.
      const filter = chip ? chips.find((candidate) => chipId(candidate) === chip) : undefined
      const filtered = filter && feed.applyFilter ? await feed.applyFilter(filter) : feed
      const result = page(kind, filtered)
      return {
        items: result.items,
        // Chips come from the unfiltered response: the filtered one echoes back
        // a reduced set that would make the rail collapse after one click.
        chips: chips.flatMap((candidate) => {
          const id = chipId(candidate)
          const label = text(candidate.title)
          if (!id || !label) return []
          return [{ id, label, selected: candidate.is_selected === true || id === chip }]
        }),
        cursor: result.cursor,
      }
    },
    subscriptions: async (cursor) => {
      if (cursor) return videoContinuations.resolve('subscriptions', cursor)
      const active = await client
      requireSignIn(active, 'see your subscriptions')
      return page('subscriptions', await active.getSubscriptionsFeed())
    },
    history: async (cursor) => {
      if (cursor) return sectionContinuations.resolve('history', cursor)
      const active = await client
      requireSignIn(active, 'see your history')
      return sectionedPage('history', await active.getHistory())
    },
    subscribedChannels: async () => {
      const active = await client
      requireSignIn(active, 'see your subscriptions')
      const feed = await active.getChannelsFeed()
      return [...(feed.channels ?? [])]
        .map(normalizeFeedChannel)
        .filter((channel) => channel !== undefined)
    },
    // The query is part of the kind so a cursor from one search cannot page
    // another one's results after the user types something new.
    search: async (query, cursor) => cursor
      ? videoContinuations.resolve(`search:${query}`, cursor)
      : page(`search:${query}`, await (await client).search(query)),
    video: async (id) => normalizeVideoDetails((await (await client).getBasicInfo(id)).basic_info),
    channel: async (id, cursor) => {
      let channel = channels.get(id)
      if (cursor) {
        if (!channel) throw new Error(`youtube: channel ${id} is not loaded`)
        return { channel, videos: await videoContinuations.resolve(`channel:${id}`, cursor) }
      }
      const result = await (await client).getChannel(id)
      channel = normalizeChannel(result, id)
      channels.set(id, channel)
      const videos = result.has_videos && result.getVideos ? await result.getVideos() : result
      return { channel, videos: page(`channel:${id}`, videos) }
    },
    // A single /next call carries everything the watch page needs on top of
    // playback (which fetches /player separately): one tunneled round trip. In
    // playlist context that same response also brings the queue panel back, so
    // opening a video inside a playlist costs no extra request.
    watch: async (id, playlistId, playlistIndex) => normalizeWatchMeta(
      await (await client).actions.execute('/next', {
        videoId: id,
        racyCheckOk: true,
        contentCheckOk: true,
        // Omitted rather than sent as undefined: JSON.stringify would drop the
        // key anyway, but a 0 index is meaningful and must survive.
        ...(playlistId ? { playlistId } : {}),
        ...(playlistIndex === undefined ? {} : { playlistIndex }),
        parse: true,
      }),
      id,
    ),
    comments: async (videoId, cursor) => {
      if (cursor) return commentContinuations.resolve(`comments:${videoId}`, cursor)
      try {
        return commentPage(videoId, await (await client).getComments(videoId))
      } catch (error) {
        // videos with comments turned off make youtubei.js throw
        // "Comments page did not have any content.", an expected state, not a failure.
        if (error instanceof Error && /did not have any content/i.test(error.message)) {
          return { items: [], disabled: true }
        }
        throw error
      }
    },
    playlists: async (cursor) => {
      if (cursor) return playlistListContinuations.resolve('playlists', cursor)
      const active = await client
      requireSignIn(active, 'see your playlists')
      return playlistListPage(await active.getPlaylists())
    },
    // Deliberately not sign-in gated: a public playlist opens signed out, and a
    // private one comes back as an upstream error rather than as an empty page.
    // The cursor kind carries the playlist id so one playlist cannot page
    // another one's rows.
    playlist: async (id, cursor) => {
      if (cursor) return playlistContinuations.resolve(`playlist:${id}`, cursor)
      const feed = await (await client).getPlaylist(id)
      const items = playlistItems(feed)
      const details = normalizePlaylistDetails(feed, id)
      // The sidebar thumbnail renderer is legacy and often absent, so the first
      // row stands in as the cover. It has to be resolved before the
      // continuation closure captures the playlist: page two would otherwise
      // hand back the same entity with its cover cleared, and the normalized
      // cache would blank the image mid-scroll.
      const playlist = rememberPlaylist({ ...details, thumbnail: details.thumbnail ?? items[0]?.video.thumbnail })
      return playlistPage(id, playlist, feed, items)
    },
    // youtubei.js's InteractionManager issues like/dislike with client: 'TV',
    // but this frame pins a WEB session (a specific WEB clientVersion, a WEB
    // visitor id and a cookie jar bound to it), and a context swap mid-session
    // is exactly what has produced FAILED_PRECONDITION here before. The
    // endpoint is the same either way, so it is called directly on the WEB
    // client instead of through the manager.
    rateVideo: async (id, status) => {
      const active = await client
      requireSignIn(active, 'rate a video')
      await active.actions.execute(LIKE_ENDPOINT[status], { target: { videoId: id } })
      // Only identity and the changed field are real; `related` satisfies the
      // non-null list without being fetched back. See the Mutation comment in
      // src/worker/schema.gql.
      return { id, likeStatus: status, related: [] }
    },
    // History.removeVideo string-matches the English menu label for LockupView
    // items, so this breaks under a non-English hl. It is the only removal path
    // youtubei.js exposes.
    removeFromHistory: async (videoId) => {
      const active = await client
      requireSignIn(active, 'change your history')
      // A FRESH feed every time: removeVideo scans the pages its instance holds
      // and, when it has to look further, replaces that instance's contents with
      // the next page. Reusing one long-lived History would therefore lose the
      // earlier pages after the first removal that had to page forward.
      const history = await active.getHistory()
      if (!history.removeVideo) throw new Error('youtube: this history feed cannot be edited')
      await history.removeVideo(videoId, HISTORY_REMOVAL_PAGES)
      return videoId
    },
    setSubscribed: async (channelId, subscribed) => {
      const active = await client
      requireSignIn(active, 'change a subscription')
      await (subscribed ? active.interact.subscribe(channelId) : active.interact.unsubscribe(channelId))
      const known = channels.get(channelId)
      const next: SourceChannel = { ...known, id: channelId, name: known?.name ?? '', isSubscribed: subscribed }
      // Keep the cache honest so a later channel() read does not hand back the
      // pre-write state.
      if (known) channels.set(channelId, next)
      return next
    },
    setNotificationLevel: async (channelId, level) => {
      const active = await client
      requireSignIn(active, 'change notifications')
      await active.interact.setNotificationPreferences(channelId, level)
      const known = channels.get(channelId)
      const next: SourceChannel = { ...known, id: channelId, name: known?.name ?? '', notificationLevel: level }
      if (known) channels.set(channelId, next)
      return next
    },
    addToPlaylist: async (playlistId, videoIds) => {
      // An empty selection is an ordinary UI state, not an error, and an edit
      // carrying zero actions is a round trip that changes nothing.
      if (videoIds.length === 0) return writtenPlaylist(playlistId, {})
      await editPlaylist(playlistId, 'save to a playlist', videoIds.map((videoId) => ({
        action: 'ACTION_ADD_VIDEO',
        addedVideoId: videoId,
      })))
      return writtenPlaylist(playlistId, {})
    },
    // Entries go out as set video ids, which is what the wire wants anyway.
    // youtubei.js's removeVideos takes plain video ids and translates them by
    // browsing the playlist, paging until it has matched as many rows as ids it
    // was given: an id that is not in the playlist makes it walk every page and
    // then throw, and a single Shorts lockup on any page throws a ParsingError
    // before the edit is even attempted (core/managers/PlaylistManager.js:123).
    removeFromPlaylist: async (playlistId, setVideoIds) => {
      if (setVideoIds.length === 0) return writtenPlaylist(playlistId, {})
      await editPlaylist(playlistId, 'change a playlist', setVideoIds.map((setVideoId) => ({
        action: 'ACTION_REMOVE_VIDEO',
        setVideoId,
      })))
      return writtenPlaylist(playlistId, {})
    },
    // youtubei.js's create() can only send a title and video ids, but the
    // endpoint it calls copies privacyStatus and description too
    // (parser/classes/endpoints/CreatePlaylistServiceEndpoint.js:17), so the
    // call is made directly to reach them. There is no edit-side privacy path
    // in 17.0.1, which makes creation the one attested way to set it.
    createPlaylist: async (title, videoIds, privacy, description) => {
      const active = await client
      requireSignIn(active, 'create a playlist')
      const response = await active.actions.execute('playlist/create', {
        title,
        videoIds: videoIds ?? [],
        ...(privacy ? { privacyStatus: privacy } : {}),
        ...(description ? { description } : {}),
      })
      if (response.success === false) throw new Error('youtube: creating the playlist failed')
      // The new id is the only server-generated value in this whole write path
      // and it is optional on the wire, so it is narrowed rather than trusted:
      // without it the entity has no cache key and the caller has to reread the
      // library instead of merging a result.
      const id = response.data?.playlistId
      if (!id) throw new Error('youtube: the playlist was created but its id did not come back')
      return rememberPlaylist({ id, title, description, privacy })
    },
    // youtubei.js's delete() throws before it reaches the network here: it
    // builds the raw key `deletePlaylistServiceEndpoint`
    // (core/managers/PlaylistManager.js:40), for which parser/nodes.js registers
    // no class, so the command resolves to undefined and NavigationEndpoint then
    // finds no api_url. The registered DeletePlaylistEndpoint is broken in its
    // own right: it guards on `playlistId` and assigns from `sourcePlaylistId`
    // (parser/classes/endpoints/DeletePlaylistEndpoint.js:15), so it only emits
    // a body when both keys are passed. Calling the path directly skips both.
    deletePlaylist: async (id) => {
      const active = await client
      requireSignIn(active, 'delete a playlist')
      await active.actions.execute('playlist/delete', { playlistId: id })
      knownPlaylists.delete(id)
      return id
    },
    // youtubei.js's setName builds its payload as `{ playlist_id, actions }` in
    // snake_case (core/managers/PlaylistManager.js:200), but PlaylistEditEndpoint
    // only copies `actions`, `playlistId` and `params` out of it
    // (parser/classes/endpoints/PlaylistEditEndpoint.js:13), so the id is
    // dropped and the POST goes out saying which name to set but not on what.
    // It is the only snake_case payload in that manager; the endpoint is the
    // same one every other edit uses, so it is called directly instead.
    renamePlaylist: async (id, title) => {
      await editPlaylist(id, 'rename a playlist', [{ action: 'ACTION_SET_PLAYLIST_NAME', playlistName: title }])
      return writtenPlaylist(id, { title })
    },
    setPlaylistDescription: async (id, description) => {
      await editPlaylist(id, 'change a playlist description', [{
        action: 'ACTION_SET_PLAYLIST_DESCRIPTION',
        playlistDescription: description,
      }])
      return writtenPlaylist(id, { description })
    },
    // The one action name here that youtubei.js 17.0.1 does not attest: the
    // package has no privacy edit path at all, and grepping it turns up
    // `privacyStatus` only on the create endpoint. What IS verified is the
    // transport, since browse/edit_playlist forwards the actions array
    // untouched, so the shape is right even though the vocabulary is inferred.
    // An action the server does not recognise is ignored rather than rejected,
    // which makes this the one write whose optimistic result can outrun the
    // server. Setting privacy at creation goes through an attested endpoint.
    setPlaylistPrivacy: async (id, privacy) => {
      await editPlaylist(id, 'change a playlist privacy', [{
        action: 'ACTION_SET_PLAYLIST_PRIVACY',
        playlistPrivacy: privacy,
      }])
      return writtenPlaylist(id, { privacy })
    },
    // The destination is a predecessor, not an index: the moved entry lands
    // immediately AFTER `afterSetVideoId`, and omitting it asks for the first
    // position. youtubei.js's own jsdoc says "before" (core/managers/
    // PlaylistManager.d.ts:59), which contradicts both the action name and the
    // field name on the wire; the wire wins.
    movePlaylistItem: async (playlistId, setVideoId, afterSetVideoId) => {
      await editPlaylist(playlistId, 'reorder a playlist', [{
        action: 'ACTION_MOVE_VIDEO_AFTER',
        setVideoId,
        ...(afterSetVideoId ? { movedSetVideoIdPredecessor: afterSetVideoId } : {}),
      }])
      return writtenPlaylist(playlistId, {})
    },
    // Signed-in state comes from the cookie jar probe; the accounts_list call
    // only decorates it, so its failure must not read back as signed out.
    session: async () => {
      if (!signedIn?.()) return { signedIn: false }
      try {
        return normalizeSession(await (await client).account.getInfo())
      } catch {
        return { signedIn: true }
      }
    },
  }
}

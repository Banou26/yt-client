import type { Cache } from '@urql/exchange-graphcache'

import { cacheExchange } from '@urql/exchange-graphcache'
import { Client, fetchExchange } from 'urql'

import { handleRequest } from './worker'

// A root field is cached once per argument set, so a playlist the user has
// paged through has one cached entry per cursor. `inspectFields` is the only
// way to reach them all: invalidating with a guessed argument set (say, a bare
// id and no cursor) drops one page and leaves the rest stale.
const invalidateQueryField = (cache: Cache, fieldName: string, matches: (args: Record<string, unknown>) => boolean) => {
  for (const field of cache.inspectFields('Query')) {
    if (field.fieldName === fieldName && matches(field.arguments ?? {})) {
      cache.invalidate('Query', field.fieldName, field.arguments)
    }
  }
}

const invalidatePlaylistPages = (cache: Cache, playlistId: string) =>
  invalidateQueryField(cache, 'playlist', (args) => args.id === playlistId)

const invalidatePlaylistList = (cache: Cache) =>
  invalidateQueryField(cache, 'playlists', () => true)

// Normalized rather than urql's document cache. Every read crosses the app ->
// worker -> osra -> frame -> tunnel path, so a mutation that invalidated whole
// documents would pay a fresh /next round trip (~0.9s) just to relight a
// button. Normalizing lets a write merge its returned entity in place, and
// makes one subscribe update the channel everywhere it is currently rendered.
const cache = cacheExchange({
  keys: {
    // Entities: keyed by id so writes merge into every view holding them.
    Video: (data) => (data.id as string | undefined) ?? null,
    Channel: (data) => (data.id as string | undefined) ?? null,
    Comment: (data) => (data.id as string | undefined) ?? null,
    Playlist: (data) => (data.id as string | undefined) ?? null,
    // WatchMeta is keyed by the video id it describes: a rateVideo result has
    // to land on the same entity the watch query populated.
    WatchMeta: (data) => (data.id as string | undefined) ?? null,
    // Everything below is a response wrapper, not an entity. Returning null
    // embeds it in its parent; without these graphcache warns about each one
    // and refuses to cache the containing query.
    VideoPage: () => null,
    HomeFeed: () => null,
    /* A Short is NOT keyed on its id even though it has one. It is a thin
       slide record whose `title` is absent for most entries, so normalizing it
       would let one page's title-less slide overwrite the title another page
       supplied for the same short. The pager reads real metadata through the
       watch query, which is keyed properly. */
    Short: () => null,
    ShortsPage: () => null,
    SectionedVideoPage: () => null,
    VideoSection: () => null,
    ChannelPage: () => null,
    CommentPage: () => null,
    // A playlist entry is deliberately NOT an entity: one playlist can hold the
    // same video twice under different setVideoIds, and keying the entry on the
    // video id would collapse those two rows into one.
    PlaylistItem: () => null,
    PlaylistPage: () => null,
    PlaylistListPage: () => null,
    // A wrapper DESPITE carrying a real playlist id. Normalizing it on that id
    // would make every video in one playlist share a single WatchPlaylist, and
    // `currentIndex` belongs to the video being watched, so opening the second
    // video would rewrite the first one's position. Embedded in its WatchMeta,
    // which is already keyed by video id, it stays per-video.
    WatchPlaylist: () => null,
    Session: () => null,
  },
  updates: {
    Mutation: {
      // A playlist write resolves to the playlist entity, never to its rows, so
      // the page a user is looking at has to be dropped rather than patched:
      // the row order, the 1-based indices and the localized "50 videos" count
      // are all server-rendered and cannot be recomputed here. Every cursor
      // page of that playlist is invalidated, because a removal shifts rows
      // across page boundaries. Only the uncursored page truly refetches: the
      // frame memoizes a continuation per cursor, so re-executing a later page
      // replays the same rows (cheaply) until the user reaches it again from a
      // fresh first page.
      addToPlaylist: (_result, args, cache) => invalidatePlaylistPages(cache, args.playlistId as string),
      removeFromPlaylist: (_result, args, cache) => invalidatePlaylistPages(cache, args.playlistId as string),
      movePlaylistItem: (_result, args, cache) => invalidatePlaylistPages(cache, args.playlistId as string),
      // The library list is a page of Playlist entities, and a new one belongs
      // in it at a position only the server knows.
      createPlaylist: (_result, _args, cache) => invalidatePlaylistList(cache),
      deletePlaylist: (_result, args, cache) => {
        // Dropping the entity is what removes it from every list already
        // rendering it; invalidating the list fields makes the next read of the
        // library refetch rather than render a hole.
        cache.invalidate({ __typename: 'Playlist', id: args.id as string })
        invalidatePlaylistList(cache)
      },
    },
  },
})

export const client = new Client({
  url: 'http://yt-client.local/graphql',
  exchanges: [cache, fetchExchange],
  fetch: (input, init) => handleRequest(input, init),
})

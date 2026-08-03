import type { Cache } from '@urql/exchange-graphcache'

import { cacheExchange } from '@urql/exchange-graphcache'
import { Client, fetchExchange } from 'urql'

import { handleRequest } from './worker'

// a root field is cached once per argument set, so `inspectFields` is the only way to reach every cursor page
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

const cache = cacheExchange({
  keys: {
    Video: (data) => (data.id as string | undefined) ?? null,
    Channel: (data) => (data.id as string | undefined) ?? null,
    Comment: (data) => (data.id as string | undefined) ?? null,
    Playlist: (data) => (data.id as string | undefined) ?? null,
    // keyed by the video id it describes: a rateVideo result has to land on the same entity the watch query populated
    WatchMeta: (data) => (data.id as string | undefined) ?? null,
    // response wrappers, not entities: returning null embeds them, and without these graphcache refuses to cache the containing query
    VideoPage: () => null,
    HomeFeed: () => null,
    // NOT keyed on its id: `title` is absent for most entries, so a title-less slide would overwrite the title another page supplied
    Short: () => null,
    ShortsPage: () => null,
    SectionedVideoPage: () => null,
    VideoSection: () => null,
    ChannelPage: () => null,
    CommentPage: () => null,
    // deliberately NOT an entity: one playlist can hold the same video twice under different setVideoIds
    PlaylistItem: () => null,
    PlaylistPage: () => null,
    PlaylistListPage: () => null,
    // a wrapper DESPITE carrying a real playlist id: keyed on it, every video in one playlist would share one `currentIndex`
    WatchPlaylist: () => null,
    Session: () => null,
  },
  updates: {
    Mutation: {
      // every cursor page of that playlist is invalidated, because a removal shifts rows across page boundaries
      addToPlaylist: (_result, args, cache) => invalidatePlaylistPages(cache, args.playlistId as string),
      removeFromPlaylist: (_result, args, cache) => invalidatePlaylistPages(cache, args.playlistId as string),
      movePlaylistItem: (_result, args, cache) => invalidatePlaylistPages(cache, args.playlistId as string),
      createPlaylist: (_result, _args, cache) => invalidatePlaylistList(cache),
      deletePlaylist: (_result, args, cache) => {
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

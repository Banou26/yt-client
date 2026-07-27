import { cacheExchange } from '@urql/exchange-graphcache'
import { Client, fetchExchange } from 'urql'

import { handleRequest } from './worker'

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
    // WatchMeta is keyed by the video id it describes: a rateVideo result has
    // to land on the same entity the watch query populated.
    WatchMeta: (data) => (data.id as string | undefined) ?? null,
    // Everything below is a response wrapper, not an entity. Returning null
    // embeds it in its parent; without these graphcache warns about each one
    // and refuses to cache the containing query.
    VideoPage: () => null,
    ChannelPage: () => null,
    CommentPage: () => null,
    Session: () => null,
  },
})

export const client = new Client({
  url: 'http://yt-client.local/graphql',
  exchanges: [cache, fetchExchange],
  fetch: (input, init) => handleRequest(input, init),
})

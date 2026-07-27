import { describe, expect, it } from 'vitest'

import type { SourceApi } from '../sources/types'

import { resolvers } from './resolvers'
import typeDefs from './schema.gql?raw'

// The schema is the source of truth for the root surface, but nothing makes the
// resolver map follow it: a field added to schema.gql without a resolver only
// fails when a user hits it, as `Cannot return null for non-nullable field`.
const rootFields = (type: 'Query' | 'Mutation') =>
  (new RegExp(`type ${type} \\{([^}]*)\\}`).exec(typeDefs)?.[1] ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split(/[(:]/)[0]!.trim())
    .sort()

describe('root queries', () => {
  it('delegates home to the active source', async () => {
    const source = {
      home: async () => ({ items: [] }),
    } as unknown as SourceApi
    await expect(resolvers.Query.home({}, {}, { source } as never)).resolves.toEqual({ items: [] })
  })

  it('delegates watch to the active source and maps missing metadata to null', async () => {
    const meta = { id: 'abc', related: [] }
    const source = {
      watch: async (id: string) => (id === 'abc' ? meta : undefined),
    } as unknown as SourceApi
    await expect(resolvers.Query.watch({}, { id: 'abc' }, { source } as never)).resolves.toBe(meta)
    await expect(resolvers.Query.watch({}, { id: 'missing' }, { source } as never)).resolves.toBeNull()
  })

  it('delegates comments to the active source', async () => {
    const calls: [string, string | undefined][] = []
    const source = {
      comments: async (videoId: string, cursor?: string) => {
        calls.push([videoId, cursor])
        return { items: [] }
      },
    } as unknown as SourceApi
    await expect(resolvers.Query.comments({}, { videoId: 'abc', cursor: null }, { source } as never))
      .resolves.toEqual({ items: [] })
    expect(calls).toEqual([['abc', undefined]])
  })

  it('delegates session to the active source', async () => {
    const session = { signedIn: true, name: 'Banou', avatar: 'avatar', handle: '@banou' }
    const source = {
      session: async () => session,
    } as unknown as SourceApi
    await expect(resolvers.Query.session({}, {}, { source } as never)).resolves.toBe(session)
  })

  it('resolves every root field the schema declares', () => {
    expect(Object.keys(resolvers.Query).sort()).toEqual(rootFields('Query'))
    expect(Object.keys(resolvers.Mutation).sort()).toEqual(rootFields('Mutation'))
  })
})

describe('root mutations', () => {
  it('passes the rating through to the active source', async () => {
    const calls: [string, string][] = []
    const source = {
      rateVideo: async (id: string, status: string) => {
        calls.push([id, status])
        return { id, likeStatus: status, related: [] }
      },
    } as unknown as SourceApi
    await expect(resolvers.Mutation.rateVideo({}, { id: 'abc', status: 'LIKE' }, { source } as never))
      .resolves.toMatchObject({ id: 'abc', likeStatus: 'LIKE' })
    expect(calls).toEqual([['abc', 'LIKE']])
  })

  it('passes subscription writes through to the active source', async () => {
    const calls: [string, boolean][] = []
    const source = {
      setSubscribed: async (channelId: string, subscribed: boolean) => {
        calls.push([channelId, subscribed])
        return { id: channelId, name: '', isSubscribed: subscribed }
      },
    } as unknown as SourceApi
    await expect(resolvers.Mutation.setSubscribed({}, { channelId: 'c', subscribed: true }, { source } as never))
      .resolves.toMatchObject({ id: 'c', isSubscribed: true })
    expect(calls).toEqual([['c', true]])
  })

  it('passes the notification level through to the active source', async () => {
    const source = {
      setNotificationLevel: async (channelId: string, level: string) => ({
        id: channelId,
        name: '',
        notificationLevel: level,
      }),
    } as unknown as SourceApi
    await expect(resolvers.Mutation.setNotificationLevel({}, { channelId: 'c', level: 'ALL' }, { source } as never))
      .resolves.toMatchObject({ id: 'c', notificationLevel: 'ALL' })
  })
})

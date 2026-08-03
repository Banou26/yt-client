import { describe, expect, it } from 'vite-plus/test'

import type { SourceApi } from '../sources/types'

import { resolvers } from './resolvers'
import typeDefs from './schema.gql?raw'

// A field added to schema.gql without a resolver only fails when a user hits it
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

  it('forwards playlist context into watch and drops the nulls the schema allows', async () => {
    const calls: [string, string | undefined, number | undefined][] = []
    const source = {
      watch: async (id: string, playlistId?: string, playlistIndex?: number) => {
        calls.push([id, playlistId, playlistIndex])
        return { id, related: [] }
      },
    } as unknown as SourceApi
    await resolvers.Query.watch({}, { id: 'abc', playlistId: 'PL1', playlistIndex: 0 }, { source } as never)
    await resolvers.Query.watch({}, { id: 'abc', playlistId: null, playlistIndex: null }, { source } as never)
    expect(calls).toEqual([['abc', 'PL1', 0], ['abc', undefined, undefined]])
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

  it('passes playlist edits through to the active source', async () => {
    const calls: unknown[][] = []
    const source = {
      addToPlaylist: async (playlistId: string, videoIds: string[]) => {
        calls.push(['add', playlistId, videoIds])
        return { id: playlistId, title: 'Saved' }
      },
      removeFromPlaylist: async (playlistId: string, setVideoIds: string[]) => {
        calls.push(['remove', playlistId, setVideoIds])
        return { id: playlistId, title: 'Saved' }
      },
      movePlaylistItem: async (playlistId: string, setVideoId: string, afterSetVideoId?: string) => {
        calls.push(['move', playlistId, setVideoId, afterSetVideoId])
        return { id: playlistId, title: 'Saved' }
      },
      deletePlaylist: async (id: string) => id,
    } as unknown as SourceApi
    await resolvers.Mutation.addToPlaylist({}, { playlistId: 'PL1', videoIds: ['a'] }, { source } as never)
    await resolvers.Mutation.removeFromPlaylist({}, { playlistId: 'PL1', setVideoIds: ['set-a'] }, { source } as never)
    await resolvers.Mutation.movePlaylistItem({}, { playlistId: 'PL1', setVideoId: 'set-b', afterSetVideoId: null }, { source } as never)
    await expect(resolvers.Mutation.deletePlaylist({}, { id: 'PL1' }, { source } as never)).resolves.toBe('PL1')
    expect(calls).toEqual([
      ['add', 'PL1', ['a']],
      ['remove', 'PL1', ['set-a']],
      ['move', 'PL1', 'set-b', undefined],
    ])
  })

  it('passes the optional create arguments through as absent rather than null', async () => {
    const calls: unknown[][] = []
    const source = {
      createPlaylist: async (title: string, videoIds?: string[], privacy?: string, description?: string) => {
        calls.push([title, videoIds, privacy, description])
        return { id: 'PLnew', title }
      },
    } as unknown as SourceApi
    await resolvers.Mutation.createPlaylist({}, { title: 'Mix', videoIds: null, privacy: null, description: null }, { source } as never)
    await resolvers.Mutation.createPlaylist({}, { title: 'Mix', videoIds: ['a'], privacy: 'PRIVATE', description: 'Notes' }, { source } as never)
    expect(calls).toEqual([
      ['Mix', undefined, undefined, undefined],
      ['Mix', ['a'], 'PRIVATE', 'Notes'],
    ])
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

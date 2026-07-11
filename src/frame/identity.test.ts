import { afterEach, describe, expect, it, vi } from 'vitest'

const botguard = vi.hoisted(() => ({
  clearStoredTokens: vi.fn(),
  resetPoTokenSession: vi.fn(async () => {}),
}))

vi.mock('./botguard', () => botguard)

import { GVS_ORIGIN_KEY, resetIdentity, VISITOR_DATA_KEY } from './identity'

const createFakeStorage = () => {
  const store = new Map<string, string>()
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  }
}

const createFakeIndexedDb = () => {
  const deleted: unknown[] = []
  const transaction = {
    oncomplete: undefined as (() => void) | undefined,
    onerror: undefined as (() => void) | undefined,
    onabort: undefined as (() => void) | undefined,
    objectStore: () => ({
      delete: (key: unknown) => {
        deleted.push(key)
        queueMicrotask(() => transaction.oncomplete?.())
      },
    }),
  }
  const database = {
    closed: false,
    close() {
      this.closed = true
    },
    transaction: (store: string, mode: string) => {
      void store
      void mode
      return transaction
    },
  }
  return {
    deleted,
    database,
    open: () => {
      const request = {
        result: database,
        onsuccess: undefined as (() => void) | undefined,
        onerror: undefined as (() => void) | undefined,
      }
      queueMicrotask(() => request.onsuccess?.())
      return request
    },
  }
}

describe('resetIdentity', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    botguard.clearStoredTokens.mockClear()
    botguard.resetPoTokenSession.mockClear()
  })

  it('clears identity-bound storage, resets the minter and drops the cached innertube session', async () => {
    const storage = createFakeStorage()
    storage.setItem(VISITOR_DATA_KEY, 'visitor')
    storage.setItem(GVS_ORIGIN_KEY, 'https://gvs.example')
    storage.setItem('yt-client:unrelated', 'keep')
    vi.stubGlobal('localStorage', storage)
    const idb = createFakeIndexedDb()
    vi.stubGlobal('indexedDB', idb)
    await resetIdentity()
    expect(storage.store.has(VISITOR_DATA_KEY)).toBe(false)
    expect(storage.store.has(GVS_ORIGIN_KEY)).toBe(false)
    expect(storage.store.get('yt-client:unrelated')).toBe('keep')
    expect(botguard.clearStoredTokens).toHaveBeenCalledOnce()
    expect(botguard.resetPoTokenSession).toHaveBeenCalledOnce()
    expect(idb.deleted).toEqual(['innertube_session_data'])
    expect(idb.database.closed).toBe(true)
  })

  it('still resets tokens when storage and indexedDB are unavailable', async () => {
    await expect(resetIdentity()).resolves.toBeUndefined()
    expect(botguard.clearStoredTokens).toHaveBeenCalledOnce()
    expect(botguard.resetPoTokenSession).toHaveBeenCalledOnce()
  })
})

import { clearStoredTokens, resetPoTokenSession } from './botguard'

export const VISITOR_DATA_KEY = 'yt-client:visitor-data'
export const GVS_ORIGIN_KEY = 'yt-client:gvs-origin'

// youtubei.js's UniversalCache persists the serialized session context
// (visitor data, rollout/experiment tokens) under this key; the player
// analysis entries in the same store are identity-neutral and stay.
const INNERTUBE_DB = 'youtubei.js'
const INNERTUBE_STORE = 'kv-store'
const INNERTUBE_SESSION_KEY = 'innertube_session_data'

const deleteInnertubeSessionData = () => new Promise<void>((resolve) => {
  try {
    const request = indexedDB.open(INNERTUBE_DB)
    // A versionless open CREATES an empty v1 db when none exists — which would
    // permanently poison youtubei.js's own open (its onupgradeneeded, the only
    // place the store is created, never fires against an existing v1 db).
    // Nothing to delete in a fresh db: abort so onerror resolves cleanly.
    request.onupgradeneeded = () => {
      try {
        request.transaction?.abort()
      } catch {}
    }
    request.onerror = () => resolve()
    request.onsuccess = () => {
      const database = request.result
      try {
        const transaction = database.transaction(INNERTUBE_STORE, 'readwrite')
        const finish = () => {
          database.close()
          resolve()
        }
        transaction.oncomplete = finish
        transaction.onerror = finish
        transaction.onabort = finish
        transaction.objectStore(INNERTUBE_STORE).delete(INNERTUBE_SESSION_KEY)
      } catch {
        database.close()
        resolve()
      }
    }
  } catch {
    resolve()
  }
})

// Clears every piece of stored state bound to the current identity (visitor
// data, po tokens, the in-memory minter, the cached innertube session context)
// so the next engine boot derives a fresh one from the cookie jar. The jar
// itself is scramjet's: it IS the auth state and is never touched here.
export const resetIdentity = async () => {
  try {
    localStorage.removeItem(VISITOR_DATA_KEY)
  } catch {}
  try {
    localStorage.removeItem(GVS_ORIGIN_KEY)
  } catch {}
  clearStoredTokens()
  await resetPoTokenSession()
  await deleteInnertubeSessionData()
}

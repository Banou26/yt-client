import { useEffect, useState } from 'preact/hooks'
import { useQuery } from 'urql'

import { gql } from './generated'

const SESSION_QUERY = gql(`
  query Session {
    session {
      signedIn
      name
      avatar
      handle
      accounts { index name avatar handle selected hasChannel }
    }
  }
`)

export type SessionAccount = {
  index: number
  name?: string
  avatar?: string
  handle?: string
  selected?: boolean
  hasChannel?: boolean
}

export type SessionState = {
  signedIn: boolean
  name?: string
  avatar?: string
  handle?: string
  accounts: SessionAccount[]
  ready: boolean
}

const useEngineReady = () => {
  const [ready, setReady] = useState(() => document.documentElement.dataset.engine === 'ready')

  useEffect(() => {
    if (ready) return
    const check = () => {
      if (document.documentElement.dataset.engine !== 'ready') return
      setReady(true)
      observer.disconnect()
    }
    const observer = new MutationObserver(check)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-engine'] })
    check()
    return () => observer.disconnect()
  }, [ready])

  return ready
}

// `ready` must cover the whole probe, not just the engine gate, or a caller shows "sign in" to a signed-in user for one round trip
export const useSession = (): SessionState => {
  const engineReady = useEngineReady()
  const [{ data, error }] = useQuery({ query: SESSION_QUERY, pause: !engineReady })
  const session = data?.session

  return {
    signedIn: session?.signedIn ?? false,
    name: session?.name ?? undefined,
    avatar: session?.avatar ?? undefined,
    handle: session?.handle ?? undefined,
    accounts: (session?.accounts ?? []).map((account) => ({
      index: account.index,
      name: account.name ?? undefined,
      avatar: account.avatar ?? undefined,
      handle: account.handle ?? undefined,
      selected: account.selected ?? undefined,
      hasChannel: account.hasChannel ?? undefined,
    })),
    ready: engineReady && (data !== undefined || error !== undefined),
  }
}

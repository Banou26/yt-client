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
    }
  }
`)

export type SessionState = {
  signedIn: boolean
  name?: string
  avatar?: string
  handle?: string
  ready: boolean
}

// The probe reads the cookie jar the engine owns, so before the engine reports
// ready it cannot answer, and asking anyway competes with the latency-critical
// watch/player boot.
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

/**
 * Shared identity for every view that branches on being signed in.
 *
 * `ready` covers the whole probe, not just the engine gate: a caller that
 * renders a signed-out state the moment the engine comes up would show "sign
 * in" to a signed-in user for one full round trip. Every caller selects the
 * same fields off `Query.session`, so the normalized cache answers all of them
 * from whichever fetch lands first.
 */
export const useSession = (): SessionState => {
  const engineReady = useEngineReady()
  const [{ data, error }] = useQuery({ query: SESSION_QUERY, pause: !engineReady })
  const session = data?.session

  return {
    signedIn: session?.signedIn ?? false,
    name: session?.name ?? undefined,
    avatar: session?.avatar ?? undefined,
    handle: session?.handle ?? undefined,
    ready: engineReady && (data !== undefined || error !== undefined),
  }
}

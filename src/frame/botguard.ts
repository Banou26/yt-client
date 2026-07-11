import type { IntegrityTokenData, WebPoSignalOutput } from 'bgutils-js'

import { BG, buildURL, GOOG_API_KEY } from 'bgutils-js'

import { egressFetch } from './egress'

// BotGuard attestation (att/get, the interpreter script, GenerateIT) runs against
// Google's anti-bot backends, which reject the server-side FKN proxy fingerprint
// the scramjet-trapped global fetch routes through (the request aborts) — the same
// wall the sign-in flow hit. Route these over the libcurl/webvpn egress instead:
// in-browser Chrome-impersonated TLS that Google accepts, with no CORS. Without a
// live attestation the mint falls back to a cold-start token, which only earns the
// ~60s StreamProtectionStatus=2 preview before media is withheld.
const attestFetch = (url: string, init?: { method?: string, headers?: Record<string, string>, body?: string }) =>
  egressFetch(url, {
    method: init?.method ?? 'GET',
    headers: init?.headers,
    body: init?.body ? (new TextEncoder().encode(init.body).buffer as ArrayBuffer) : null,
    redirect: 'follow',
  })

const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo'
const ATT_GET_URL = 'https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false&alt=json'
const TOKEN_STORE_KEY = 'yt-client:po-tokens'

type BotguardContext = {
  client: {
    visitorData: string
    clientVersion: string
  }
}

type MinterSession = {
  client: InstanceType<typeof BG.BotGuardClient>
  minter: InstanceType<typeof BG.WebPoMinter>
  script: HTMLScriptElement
  expiresAt: number
}

type StoredToken = {
  token: string
  expiresAt: number
}

let session: MinterSession | undefined
let pending: Promise<MinterSession> | undefined

const readStoredTokens = (): Record<string, StoredToken> => {
  try {
    const raw = localStorage.getItem(TOKEN_STORE_KEY)
    return raw ? JSON.parse(raw) as Record<string, StoredToken> : {}
  } catch {
    return {}
  }
}

const storeToken = (identifier: string, token: string, expiresAt: number) => {
  try {
    const tokens = readStoredTokens()
    for (const [key, value] of Object.entries(tokens)) {
      if (value.expiresAt <= Date.now()) delete tokens[key]
    }
    tokens[identifier] = { token, expiresAt }
    localStorage.setItem(TOKEN_STORE_KEY, JSON.stringify(tokens))
  } catch {}
}

const readStoredToken = (identifier: string) => {
  const stored = readStoredTokens()[identifier]
  return stored && stored.expiresAt > Date.now() ? stored.token : undefined
}

export const clearStoredTokens = () => {
  try {
    localStorage.removeItem(TOKEN_STORE_KEY)
  } catch {}
}

const readSapisid = () => {
  try {
    return document.cookie.match(/(?:^|;\s*)SAPISID=([^;\s]+)/)?.[1]
  } catch {
    return undefined
  }
}

// Signed-in header parity for the challenge fetch (the real client sends it):
// SAPISIDHASH is the hex sha1 of '<ts> <SAPISID> <origin>' as '<ts>_<hash>'.
const sidAuthorization = async () => {
  const sapisid = readSapisid()
  if (!sapisid) return undefined
  const timestamp = Math.floor(Date.now() / 1_000)
  const digest = await crypto.subtle.digest(
    'SHA-1',
    new TextEncoder().encode(`${timestamp} ${sapisid} https://www.youtube.com`),
  )
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `SAPISIDHASH ${timestamp}_${hash}`
}

const fetchChallenge = async (context: BotguardContext) => {
  const authorization = await sidAuthorization()
  const response = await attestFetch(ATT_GET_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-visitor-id': context.client.visitorData,
      'x-youtube-client-name': '1',
      'x-youtube-client-version': context.client.clientVersion,
      ...(authorization && { authorization }),
    },
    body: JSON.stringify({ engagementType: 'ENGAGEMENT_TYPE_UNBOUND', context }),
  })
  if (!response.ok) throw new Error(`botguard: challenge returned ${response.status}`)
  const data = await response.json() as {
    bgChallenge?: {
      program: string
      globalName: string
      interpreterUrl?: {
        privateDoNotAccessOrElseTrustedResourceUrlWrappedValue?: string
      }
    }
  }
  const challenge = data.bgChallenge
  if (!challenge) throw new Error('botguard: challenge is missing')
  let interpreterUrl = challenge.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue
  if (!interpreterUrl) throw new Error('botguard: interpreter URL is missing')
  if (interpreterUrl.startsWith('//')) interpreterUrl = `https:${interpreterUrl}`
  const interpreter = await attestFetch(interpreterUrl).then((result) => result.text())
  return { ...challenge, interpreter }
}

const createSession = async (context: BotguardContext): Promise<MinterSession> => {
  const challenge = await fetchChallenge(context)
  const script = document.createElement('script')
  script.textContent = challenge.interpreter
  document.head.appendChild(script)
  const client = await BG.BotGuardClient.create({
    globalObj: globalThis,
    globalName: challenge.globalName,
    program: challenge.program,
  })
  const webPoSignalOutput: WebPoSignalOutput = []
  const botguardResponse = await client.snapshot({ webPoSignalOutput })
  const integrity = await attestFetch(buildURL('GenerateIT', true), {
    method: 'POST',
    headers: {
      'content-type': 'application/json+protobuf',
      'x-goog-api-key': GOOG_API_KEY,
      'x-user-agent': 'grpc-web-javascript/0.1',
    },
    body: JSON.stringify([REQUEST_KEY, botguardResponse]),
  }).then((response) => response.json()) as [string | null, number, number | null, string]
  const token = {
    integrityToken: integrity[0] ?? undefined,
    estimatedTtlSecs: integrity[1],
    mintRefreshThreshold: integrity[2] ?? undefined,
    websafeFallbackToken: integrity[3],
  } satisfies IntegrityTokenData
  if (!token.integrityToken && !token.websafeFallbackToken) throw new Error('botguard: integrity token is missing')
  return {
    client,
    minter: await BG.WebPoMinter.create(token, webPoSignalOutput),
    script,
    expiresAt: performance.now() + (token.estimatedTtlSecs ?? 3_600) * 800,
  }
}

const getSession = (context: BotguardContext) => {
  if (session && performance.now() < session.expiresAt) return Promise.resolve(session)
  pending ??= createSession(context).then(
    (next) => {
      session = next
      pending = undefined
      return next
    },
    (error) => {
      pending = undefined
      throw error
    },
  )
  return pending
}

// Persisted tokens live as long as their integrity token, capped as insurance
// against a server-side invalidation we cannot observe.
const PERSISTED_TOKEN_MAX_MS = 6 * 3_600_000

const mintSessionToken = async (target: MinterSession, identifier: string) => {
  const token = await target.minter.mintAsWebsafeString(identifier)
  const remaining = Math.max(0, target.expiresAt - performance.now())
  storeToken(identifier, token, Date.now() + Math.min(remaining, PERSISTED_TOKEN_MAX_MS))
  return token
}

const REFRESH_MARGIN_MS = 30 * 60_000

// Builds the minter session in the background unless a persisted token makes
// it unnecessary: the botguard chain is three serial round trips that would
// otherwise compete with startup traffic on the egress tunnel.
export const warmPoTokenSession = (context: BotguardContext, identifier: string) => {
  if (session && performance.now() < session.expiresAt) return
  const stored = readStoredTokens()[identifier]
  if (stored && stored.expiresAt - Date.now() > REFRESH_MARGIN_MS) return
  void getSession(context).catch(() => {})
}

export const mintPoToken = async (identifier: string, context: BotguardContext) => {
  if (session && performance.now() < session.expiresAt) return mintSessionToken(session, identifier)
  const stored = readStoredToken(identifier)
  if (stored) {
    warmPoTokenSession(context, identifier)
    return stored
  }
  // The session-bound minter is not ready yet: start playback on a cold-start
  // token, which SABR accepts while StreamProtectionStatus is 2. Later requests
  // mint through the session once it lands.
  void getSession(context).catch(() => {})
  return BG.PoToken.generateColdStartToken(identifier)
}

// Called after the server rejected a token: makes sure the next mint comes from
// a live minter session instead of a cold-start or persisted token. Failures
// propagate so a dead botguard endpoint surfaces its own error instead of an
// opaque 403 retry loop.
export const recoverPoTokenSession = async (context: BotguardContext) => {
  clearStoredTokens()
  if (pending) {
    await pending.catch(() => {})
    return
  }
  await resetPoTokenSession()
  await getSession(context)
}

export const preparePoToken = async (context: BotguardContext) => {
  await getSession(context)
}

export const resetPoTokenSession = async () => {
  if (!session) return
  const current = session
  session = undefined
  current.script.remove()
  await current.client.shutdown().catch(() => {})
}

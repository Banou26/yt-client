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

/* The jar itself, for the challenge request.

   SAPISIDHASH is not a bearer token: it is a hash OF the SAPISID cookie, and the
   server authenticates it by recomputing the hash from the cookie it received.
   Sent without that cookie there is nothing to recompute against, so the
   Authorization header is unverifiable and att/get is answered as if anonymous.
   This request was sending exactly that, on every transport, which the app's own
   Innertube clients already get right (see `authCookie` in innertube.ts, whose
   comment records the inverse failure: identity cookies without a matching
   Authorization header get 401s). The pairing has to go both ways. */
const readAuthCookie = () => {
  try {
    return document.cookie.includes('SAPISID=') ? document.cookie : undefined
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

/* This egress path bypasses Scramjet entirely (it is a direct port to the host,
   not the rewritten global fetch), so NOTHING adds these for us. The one frame
   request that has always worked, the SABR media fetch in sabr.ts, sets them by
   hand for exactly this reason. att/get did not, and Innertube answers a
   cross-origin-looking POST with no Origin at all with a 403, which is what kept
   the minter session from ever being built. */
const YOUTUBE_ORIGIN_HEADERS = {
  origin: 'https://www.youtube.com',
  referer: 'https://www.youtube.com/',
} as const

const fetchChallenge = async (context: BotguardContext) => {
  const authorization = await sidAuthorization()
  const authCookie = readAuthCookie()
  const response = await attestFetch(ATT_GET_URL, {
    method: 'POST',
    headers: {
      ...YOUTUBE_ORIGIN_HEADERS,
      'content-type': 'application/json',
      'x-goog-visitor-id': context.client.visitorData,
      'x-youtube-client-name': '1',
      'x-youtube-client-version': context.client.clientVersion,
      // Only ever together: a hash with no cookie cannot be verified, and a
      // cookie with no hash is answered with a 401.
      ...(authorization && authCookie && { authorization, cookie: authCookie }),
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

/* Names the failing step. Four things can break here and they need completely
   different fixes: the challenge fetch (auth or transport), evaluating the
   interpreter (it is obfuscated JS running in a REWRITTEN realm, so the
   rewriter is a real suspect), taking the snapshot, and GenerateIT. Without a
   label they all surface as the same silent cold-start fallback. */
const stage = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
  try {
    return await run()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`botguard: ${name} failed: ${reason}`, { cause: error })
  }
}

const createSession = async (context: BotguardContext): Promise<MinterSession> => {
  const challenge = await stage('challenge', () => fetchChallenge(context))
  const { client, script } = await stage('interpreter', async () => {
    const element = document.createElement('script')
    element.textContent = challenge.interpreter
    document.head.appendChild(element)
    // The interpreter defines its global synchronously on evaluation, so a
    // missing global here means the script did not run as written - which is
    // what a rewriter that could not parse it would look like.
    if (!(challenge.globalName in globalThis)) {
      element.remove()
      throw new Error(`the interpreter did not define ${challenge.globalName} (script evaluated but its global is absent)`)
    }
    return {
      client: await BG.BotGuardClient.create({
        globalObj: globalThis,
        globalName: challenge.globalName,
        program: challenge.program,
      }),
      script: element,
    }
  })
  const webPoSignalOutput: WebPoSignalOutput = []
  const botguardResponse = await stage('snapshot', () => client.snapshot({ webPoSignalOutput }))
  const integrity = await stage('GenerateIT', async () => {
    const response = await attestFetch(buildURL('GenerateIT', true), {
      method: 'POST',
      headers: {
        // Same reasoning as att/get: the real client sends these to jnn-pa too.
        ...YOUTUBE_ORIGIN_HEADERS,
        'content-type': 'application/json+protobuf',
        'x-goog-api-key': GOOG_API_KEY,
        'x-user-agent': 'grpc-web-javascript/0.1',
      },
      body: JSON.stringify([REQUEST_KEY, botguardResponse]),
    })
    if (!response.ok) throw new Error(`returned ${response.status}`)
    return await response.json() as [string | null, number, number | null, string]
  })
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

/* Why a botguard failure has to be LOUD.

   Every caller below starts the session with `void getSession(...).catch(() => {})`
   and carries on with a cold-start token, because a slow chain must not block
   playback. The cost of that shape is that a PERMANENTLY broken chain looks
   exactly like a slow one: playback starts, StreamProtectionStatus sits at 2,
   media is withheld at the ~60s preview, and nothing anywhere says why. The
   `yt-client:po-tokens` store staying empty is the only outward sign, and you
   have to know to look for it.

   So report the reason once per distinct message. Deduped rather than logged
   every mint, because a dead chain is retried on every request and would
   otherwise bury the rest of the console. */
const reported = new Set<string>()

const reportSessionFailure = (error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error)
  if (reported.has(reason)) return
  reported.add(reason)
  console.error(
    `yt-client: botguard session failed, falling back to cold-start tokens (playback will stop at the preview limit): ${reason}`,
    error,
  )
}

const getSession = (context: BotguardContext) => {
  if (session && performance.now() < session.expiresAt) return Promise.resolve(session)
  pending ??= createSession(context).then(
    (next) => {
      session = next
      pending = undefined
      reported.clear()
      return next
    },
    (error: unknown) => {
      pending = undefined
      reportSessionFailure(error)
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

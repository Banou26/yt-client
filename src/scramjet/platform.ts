import type { ExtFetchRequest, ExtFetchResponse, TransportResponse } from './protocol'

import { EGRESS_ABORT_ALL, EGRESS_KEY } from './protocol'

/* The FKN platform, owned by the APP realm rather than by the engine.

   `@fkn/lib` used to be imported inside the Scramjet host frame, next to the
   thing that consumes it. That looked tidy and cost two capabilities:

   1. Importing the lib injects an `fkn.app/api` broker iframe into the
      importing document, and the broker is not only an RPC channel: it renders
      the platform's own trusted UI (the connect popup that mints a premium
      token, the relay picker, the quota toast, the extension install prompt).
      The host frame is `hidden`, so that iframe lived inside a `display: none`
      subtree, where it can neither be seen nor clicked, and where its overlay
      rAF loop does not tick. Connecting an account from this client was
      therefore impossible, which left every WebVPN session on free-tier
      pacing - and free-tier pacing is what carries SABR media.

   2. The host frame is destroyed on every engine reset, taking the broker, the
      lib, the relay session and the egress worker's libcurl wasm with it. A
      reset is what playback failure DOES, so the recovery path was paying a
      full cold platform start at the worst possible moment.

   Both follow from the same placement, so both are fixed by moving the lib up
   here and handing the engine ports instead. The engine keeps a DIRECT port to
   the egress worker, so the media path gains no hop.

   THIS REALM IS A RELAY, so it does not make cloud calls of its own. Calling
   `relayWorker` hands the window's `fkn-api` osra channel to the worker; a
   realm that then also talks cloud over that same channel is contending with
   its own relay, which is the recorded cause of the reverted host-side
   cloud-fetch experiment. The rule is not "be careful", it is structural: the
   only lib surface used here is the EXTENSION one, which talks to the content
   script and never reaches the broker at all. All cloud egress happens in the
   worker, at the far end of the relay.

   If this realm ever does need cloud calls, the answer is a SEPARATE osra
   channel to the broker (its own key over its own MessageChannel), never the
   relayed one. */

const BROKER_URL = 'https://fkn.app/api'
const BROKER_TIMEOUT_MS = 15_000

/* Appended synchronously, and before `@fkn/lib` is imported, because the lib
   adopts an existing `iframe[src=...]` at module-evaluation time and injects
   its own otherwise. Owning the element is what makes this realm the overlay
   host: the lib binds hit-test retargeting to whoever mounted the iframe, and
   a clipped-out region has to retarget onto the real app to be pass-through.

   Deliberately unstyled: the lib stamps the whole overlay baseline on it
   (fixed, full viewport, `clip-path: inset(100%)` when idle, z-index max, all
   `!important`). Setting `hidden` here is what broke it before. */
const mountBroker = () => {
  const element = document.createElement('iframe')
  element.src = BROKER_URL
  const loaded = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('yt-client: FKN broker load timed out')), BROKER_TIMEOUT_MS)
    element.addEventListener('load', () => {
      clearTimeout(timeout)
      resolve()
    }, { once: true })
    element.addEventListener('error', () => {
      clearTimeout(timeout)
      reject(new Error('yt-client: FKN broker failed to load'))
    }, { once: true })
  })
  document.body.appendChild(element)
  return loaded
}

/* Requests the extension cannot carry correctly, so they stay on the tunnel.

   `extension.fetch` builds a `new Request(url, init)` and forwards
   `[...request.headers]`. The Request constructor silently drops FORBIDDEN
   header names, and the lib rescues only `origin` and `referer` back out into
   its `unsafeHeaders` smuggle list. `cookie` is not on that list, and the call
   defaults to `credentials: 'omit'`, so an identity-bearing request arrives at
   YouTube with no cookies whatsoever: not Scramjet's jar, and not the
   browser's either.

   `authorization` belongs here even though it SURVIVES the constructor, and
   that is the subtle half. It carries a SAPISIDHASH, which the server verifies
   by recomputing the hash from the SAPISID cookie it received. Sent without
   that cookie the header is not merely useless, it is inconsistent, so the
   attestation call is answered as if anonymous - which is what leaves the
   minter on a cold-start token and playback on the ~60s preview tier.

   Everything anonymous still goes native, and that is where the latency is:
   SABR media and init segments set only origin/referer/content-type, so the
   bulk of the bytes keep the direct path. */
const IDENTITY_HEADERS = ['cookie', 'authorization']

export const carriesIdentity = (headers: Record<string, string> | undefined) =>
  !!headers && Object.keys(headers).some((name) => IDENTITY_HEADERS.includes(name.toLowerCase()))

/* The other thing the extension cannot carry: the ANSWER to a redirect the
   caller wanted to handle itself.

   `extension.fetch` is a real browser fetch, and Scramjet asks for
   `redirect: 'manual'` on every request it proxies. That is harmless for the
   ordinary case, because a manual-redirect fetch only goes opaque when the
   response actually IS a 3xx; a 200 comes back whole. When it does go opaque
   the answer carries nothing at all: status 0, no headers, no body, by design.

   Forwarding that is worse than dropping it. The engine rebuilds every
   transport answer with `new Response(body, { status })`, and 0 is outside the
   range that constructor accepts, so the RangeError takes the service worker's
   whole request handler down and the page sees a 500 on the navigation. That is
   what broke sign-in on 2026-07-30: Google's login is a chain of redirects, so
   it hit this on the first hop, while ordinary browsing never did.

   Detected on the RESPONSE rather than refused on the request, which matters:
   refusing every `manual` request would send ALL proxied traffic to the tunnel
   and give up the direct path entirely. Only the hops that really do redirect
   pay a second request, and the tunnel reports their real status and Location. */
export const isOpaqueRedirect = (response: { status: number, type?: string }) =>
  response.status === 0 || response.type === 'opaqueredirect'

/* Falling back means RE-ISSUING, and the first attempt already reached the
   server. For a GET or a HEAD that costs one wasted round trip and nothing
   else; for anything that writes, the server has already acted, so a retry
   would act twice.

   The fix is not to keep writes off the extension. Scramjet marks EVERY request
   `manual`, and Innertube does its reading over POST, so refusing them there
   costs the direct path almost entirely (measured: search went from 1.2s back
   to 3.6s, level with the tunnel). Instead a write is sent with `follow`, so
   the browser resolves any redirect itself and the answer can never be the
   opaque one that would need replaying.

   What that gives up is a write's ability to see its own 3xx, which nothing
   here wants: the sign-in flow is the only caller that reads redirects, and it
   does not use this path at all. */
const REPLAYABLE_METHODS = ['GET', 'HEAD']

export const mayHonourManualRedirect = (method: string | undefined) =>
  REPLAYABLE_METHODS.includes((method ?? 'GET').toUpperCase())

const create = async () => {
  const worker = new Worker(new URL('./egress.worker.ts', import.meta.url), { type: 'module' })
  const relayAbort = new AbortController()
  window.addEventListener('pagehide', () => {
    relayAbort.abort()
    worker.terminate()
  }, { once: true })

  /* mountBroker appends the iframe SYNCHRONOUSLY, so the lib adopts it whichever
     of these settles first. Waiting for the load before touching the lib is
     what keeps the broker from being messaged too early, which surfaces as a
     target-origin warning rather than as a failure. */
  const brokerLoaded = mountBroker()
  const [, lib] = await Promise.all([brokerLoaded, import('@fkn/lib')])
  /* This realm is a relay from here on. Nothing below may reach the broker.

     The install prompt is disabled for the same reason: it is the one way the
     extension surface can pull the broker in, and a missing extension is the
     ORDINARY case here - the tunnel is a complete answer, not a degraded one,
     so there is nothing to prompt about. */
  lib.setMissingExtensionHandler(null)
  lib.relayWorker(worker, { unregisterSignal: relayAbort.signal })

  /* The platform's own install prompt, rendered inside the trusted broker
     iframe. Turning the AUTOMATIC one off above and keeping this is not a
     contradiction: the automatic prompt fires whenever an extension-gated call
     finds no extension, which here would interrupt the ordinary case, while
     this only ever runs because a reader clicked the header's offer.

     It is also the one broker call this realm makes, and it is UI rather than
     egress: the rule this file opens with is about cloud FETCHES contending
     with the relay they are being relayed over. Rendering the platform's own
     overlay is precisely what moving the lib up here made possible again.

     Delegated rather than reimplemented so the store links, the per-browser
     pick and the "installed" detection stay platform-side. */
  const promptInstall = (reason?: string) => lib.promptInstall(reason)

  /* One live engine at a time, so the worker rotates: handing it a new port
     releases the previous engine's, whose frame is already gone. Without that
     every reset would strand another osra listener in the worker. */
  const openEgressPort = () => {
    const channel = new MessageChannel()
    worker.postMessage({ type: EGRESS_KEY, port: channel.port1 }, [channel.port1])
    return channel.port2
  }

  /* Whether THIS @fkn/lib can carry a Cookie request header at all.

     `extension.fetch` normalises through `new Request`, whose constructor drops
     forbidden header names, and the lib rescues back only the names on this
     list. Builds up to 0.9.3 list `origin` and `referer` alone, so a
     cookie-bearing request reaches YouTube with no cookies whatsoever and reads
     as signed out; from 0.9.4 `cookie` is on the list and is applied per request
     by the extension's own header rule.

     Probed rather than version-gated on purpose: it turns itself on the moment
     the lib updates, with no second commit here, and it can never send an
     identity into a build that would silently discard it. */
  const forgeableCookie = ((lib as { FORGEABLE_HEADERS?: string[] }).FORGEABLE_HEADERS ?? []).includes('cookie')

  let lastEgressMode: boolean | undefined
  // Once per session: the failure is a shape disagreement between two
  // dependencies, so it repeats on every request and would otherwise flood.
  let warnedExtFetchFailure = false
  const runExtFetch = async (request: Extract<ExtFetchRequest, { type: 'fetch' }>, signal: AbortSignal) => {
    const exposed = lib.isExtensionExposed()
    if (exposed !== lastEgressMode) {
      lastEgressMode = exposed
      console.info(`[yt-client] egress → ${exposed
        ? `FKN extension (direct native fetch${forgeableCookie ? '' : ', anonymous requests only'})`
        : 'FKN relay + webvpn tunnel'}`)
    }
    if (!exposed) return null
    // Answering null is exactly the not-exposed answer, so the caller falls
    // back to the tunnel with no extra branch on either side.
    if (!forgeableCookie && carriesIdentity(request.options.headers)) return null
    /* `extension.fetch`, NOT the root `fetch`. The root one is the auto-select
       layer (extension, then desktop, then cloud, re-checked per call), so a
       flip in exposure between the gate above and the call below would put a
       CLOUD request in the relaying realm - the one thing this module must not
       do. The extension binding cannot fall through, so the property holds
       structurally rather than by the gate being lucky.

       `redirect` honours the caller only for a request that could be replayed
       if the answer comes back opaque; see above for why a write is followed
       natively instead. */
    const redirect = mayHonourManualRedirect(request.options.method)
      ? request.options.redirect ?? 'follow'
      : 'follow'
    /* A throw from the extension path is answered as `null`, the same as the
       extension being absent, so the caller re-issues on the tunnel.

       Reported 2026-07-31 as `(p ?? []).map is not a function`, surfacing as
       `botguard: challenge failed`. That message is @fkn/lib's forgeable-header
       validator, `(headers ?? []).map(([name]) => ...)`, which requires an array
       of `[name, value]` pairs; it throws when it is handed anything else. The
       lib and the extension build are separate artifacts on separate release
       cadences, so they can disagree about that shape, and when they do EVERY
       identity-bearing request through the extension throws.

       Without this, that throw propagated into att/get, the minter session was
       never built, and playback silently spent the rest of the session on
       cold-start tokens capped at the preview limit. A shape disagreement
       between two dependencies should cost a fallback, not attestation.

       An abort is rethrown rather than swallowed: it is this caller's own
       cancellation and the tunnel must not re-issue behind it. Retrying is safe
       for everything else because the request body is deliberately never
       transferred (see the port handler below). */
    const response = await lib.extension.fetch(request.url, {
      method: request.options.method,
      headers: request.options.headers,
      body: request.options.body ?? undefined,
      redirect,
      signal,
    }).catch((error: unknown) => {
      if (signal.aborted) throw error
      if (!warnedExtFetchFailure) {
        warnedExtFetchFailure = true
        console.warn(
          '[yt-client] extension fetch failed, falling back to the tunnel for this and later requests:',
          error instanceof Error ? error.message : String(error),
        )
      }
      return undefined
    })
    if (!response) return null
    // Nothing usable came back, so answer as if the extension were absent: the
    // caller re-issues on the tunnel, which reports the real status and headers.
    // Safe to retry because the request body is deliberately never transferred.
    if (isOpaqueRedirect(response)) return null
    return {
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers] as [string, string][],
      body: response.body,
    } satisfies TransportResponse
  }

  let extFetchPort: MessagePort | undefined
  const openExtFetchPort = () => {
    // Same one-engine-at-a-time rule as the egress port, on the side we can
    // actually close: the previous engine's frame is gone with its half.
    extFetchPort?.close()
    const channel = new MessageChannel()
    const port = channel.port1
    extFetchPort = port
    const aborts = new Map<number, AbortController>()
    port.addEventListener('message', (event) => {
      const request = event.data as ExtFetchRequest
      if (request.type === 'cancel') {
        aborts.get(request.id)?.abort()
        aborts.delete(request.id)
        return
      }
      const abort = new AbortController()
      aborts.set(request.id, abort)
      void runExtFetch(request, abort.signal).then(
        (response) => {
          aborts.delete(request.id)
          /* The BODY transfers (a ReadableStream cannot be cloned), the
             REQUEST body never does: the caller reuses the same options object
             on the tunnelled fallback when this answers null, and a
             transferred ArrayBuffer would reach it detached. */
          port.postMessage(
            { id: request.id, response } satisfies ExtFetchResponse,
            response?.body ? [response.body] : [],
          )
        },
        (error) => {
          aborts.delete(request.id)
          port.postMessage({
            id: request.id,
            error: error instanceof Error ? error.message : String(error),
          } satisfies ExtFetchResponse)
        },
      )
    })
    port.start()
    return channel.port2
  }

  return {
    openEgressPort,
    openExtFetchPort,
    promptInstall,
    abortEgress: () => worker.postMessage({ type: EGRESS_ABORT_ALL }),
  }
}

let platform: ReturnType<typeof create> | undefined

/**
 * Starts the FKN platform for this document, once.
 *
 * Deliberately memoized rather than tied to the engine: surviving engine
 * resets is half the point of living up here. A FAILED start is not memoized,
 * though - the host frame used to get a fresh broker attempt on every boot, and
 * caching the rejection would turn one transient failure into a dead client
 * until reload.
 */
export const startPlatform = () => (platform ??= create().catch((error: unknown) => {
  platform = undefined
  throw error
}))

/**
 * Asks the platform to show its extension install prompt, and answers whether
 * the extension is exposed afterwards: true once it is, false if the reader
 * dismissed the prompt.
 *
 * `reason` is the one app-specific line the platform prompt shows, so it should
 * say why THIS app is asking.
 */
export const promptExtensionInstall = async (reason?: string) => {
  const api = await startPlatform()
  return api.promptInstall(reason)
}

/** Drops the egress worker's in-flight requests. Safe before the first start. */
export const abortPlatformEgress = () => {
  void platform?.then((api) => api.abortEgress()).catch(() => {})
}

// Kept for the engine-facing side of the handshake, so client.ts does not have
// to know the shape of what it is transferring.
export type Platform = Awaited<ReturnType<typeof create>>

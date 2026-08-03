import type { ExtFetchRequest, ExtFetchResponse, TransportResponse } from './protocol'

import { EGRESS_ABORT_ALL, EGRESS_KEY } from './protocol'

// `@fkn/lib` lives in the APP realm rather than the host frame because importing it injects the `fkn.app/api` broker iframe into the importing document, and the broker renders the platform's own trusted UI (connect popup, relay picker, quota toast)
// the host frame is `hidden`, so in there that iframe can be neither seen nor clicked and its overlay rAF loop does not tick: connecting an account was impossible, which left every WebVPN session on free-tier pacing, and free-tier pacing is what carries SABR media
// THIS REALM IS A RELAY: it makes no cloud calls of its own, since `relayWorker` hands the window's `fkn-api` channel to the worker and a cloud call would contend with it

const BROKER_URL = 'https://fkn.app/api'
const BROKER_TIMEOUT_MS = 15_000

// appended before `@fkn/lib` is imported, which adopts an existing `iframe[src=...]` at module-evaluation time; owning the element is also what makes this realm the overlay host, since the lib binds hit-test retargeting to whoever mounted the iframe
// deliberately UNSTYLED: the lib stamps the whole overlay baseline on it (fixed, full viewport, `clip-path: inset(100%)` when idle, z-index max, all `!important`), and setting `hidden` here is what broke it before
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

// `extension.fetch` normalises through `new Request`, which drops `cookie`, and `authorization` carries a SAPISIDHASH the server recomputes from that cookie
const IDENTITY_HEADERS = ['cookie', 'authorization']

export const carriesIdentity = (headers: Record<string, string> | undefined) =>
  !!headers && Object.keys(headers).some((name) => IDENTITY_HEADERS.includes(name.toLowerCase()))

// an opaque redirect answers status 0, which the engine's `new Response(body, { status })` rejects outright
export const isOpaqueRedirect = (response: { status: number, type?: string }) =>
  response.status === 0 || response.type === 'opaqueredirect'

// falling back means RE-ISSUING, and the first attempt already reached the server, so only these may honour a manual redirect
// writes are NOT kept off the extension path: Scramjet marks EVERY request `manual` and Innertube reads over POST, so refusing them there costs the direct path almost entirely (measured: search went from 1.2s back to 3.6s, level with the tunnel)
// a write is sent with `follow` instead, so the browser resolves the redirect itself and the answer can never be the opaque one that would need replaying
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

  const brokerLoaded = mountBroker()
  const [, lib] = await Promise.all([brokerLoaded, import('@fkn/lib')])
  // the automatic install prompt is the one way the extension surface can pull the broker in, and a missing extension is the ORDINARY case here
  lib.setMissingExtensionHandler(null)
  lib.relayWorker(worker, { unregisterSignal: relayAbort.signal })

  // the one broker call this realm makes, and it is UI rather than egress
  const promptInstall = (reason?: string) => lib.promptInstall(reason)

  // one live engine at a time: handing the worker a new port releases the previous engine's, whose frame is already gone
  const openEgressPort = () => {
    const channel = new MessageChannel()
    worker.postMessage({ type: EGRESS_KEY, port: channel.port1 }, [channel.port1])
    return channel.port2
  }

  // probed rather than version-gated: @fkn/lib builds up to 0.9.3 rescue only `origin` and `referer`, and would discard a cookie silently
  const forgeableCookie = ((lib as { FORGEABLE_HEADERS?: string[] }).FORGEABLE_HEADERS ?? []).includes('cookie')

  let lastEgressMode: boolean | undefined
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
    // null is exactly the not-exposed answer, so the caller falls back to the tunnel with no extra branch on either side
    if (!forgeableCookie && carriesIdentity(request.options.headers)) return null
    // `extension.fetch`, NOT the root `fetch`: the root auto-selects and could put a CLOUD request in the relaying realm
    const redirect = mayHonourManualRedirect(request.options.method)
      ? request.options.redirect ?? 'follow'
      : 'follow'
    // a throw here is answered as null for a named upstream bug: @fkn/lib's forgeable-header validator `(headers ?? []).map(([name]) => ...)` wants an array of [name, value] pairs and throws `(p ?? []).map is not a function` (surfacing as `botguard: challenge failed`) when the lib and the extension build disagree about that shape, which they can since they are separate artifacts on separate release cadences
    // without the catch that throw reaches att/get, no minter session is ever built, and the whole session stays on cold-start tokens at the ~60s preview cap
    // an abort is rethrown rather than swallowed: it is this caller's own cancellation and the tunnel must not re-issue behind it
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
        // message AND stack, as separate arguments: FIREFOX'S `error.stack` DOES NOT INCLUDE THE MESSAGE the way V8's does
        console.warn(
          '[yt-client] extension fetch failed, falling back to the tunnel for this and later requests:',
          error instanceof Error ? error.message : String(error),
          error instanceof Error ? error.stack : undefined,
        )
      }
      return undefined
    })
    if (!response) return null
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
          // the response BODY transfers (a ReadableStream cannot be cloned), the REQUEST body never does: the tunnelled fallback reuses the same options object
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

export type Platform = Awaited<ReturnType<typeof create>>

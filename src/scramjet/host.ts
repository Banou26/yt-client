import type { EgressApi, ExtFetchRequest, ExtFetchResponse, HostBootstrap, HostControlEvent, HostControlRequest, HostHello, TransportResponse } from './protocol'
import type { FrameEgressRequest, FrameEgressResponse } from '../frame/protocol'

import { defaultConfigDev } from '@mercuryworkshop/scramjet'
import { Tap } from '@mercuryworkshop/scramjet'
import { Controller } from '@mercuryworkshop/scramjet-controller'
import { expose } from 'osra'

import { CLEAR_COOKIES, CLOSE_SIGNIN, COOKIES_CLEARED, EGRESS_KEY, ENGINE_READY, HOST_BOOTSTRAP, HOST_HELLO, OPEN_SIGNIN, SIGNIN_LOADED, SIGNIN_STATUS } from './protocol'
import { FRAME_CONNECT, FRAME_EGRESS_CONNECT } from '../frame/protocol'
import { createFknTransport, createWebvpnTransport, FRAME_BOOTSTRAP_URL } from './fkn-transport'
import type { ExtEgressFetch } from './fkn-transport'

// Start on youtube.com and let ITS Sign in button carry the flow to Google.
// Going straight to accounts.google.com leaves the login underconfigured (the
// Next/password step silently no-ops); the passive-mode button URL just bounces
// back. Loading youtube.com first is the recipe that actually completes.
const SIGN_IN_URL = 'https://www.youtube.com/'
// Any youtube.com host is a plumbing hop, not a page the user should see: a
// mobile user agent gets redirected to m.youtube.com (and Google can bounce
// through accounts.youtube.com on the way back), so a bare www. prefix check
// leaks those pages past the loading overlay.
const isYoutubeHop = (target: string) => /^https:\/\/(?:[a-z0-9-]+\.)*youtube\.com\//.test(target)

type FrameWindow = Window & {
  [FRAME_CONNECT]?: (port: MessagePort) => void
  [FRAME_EGRESS_CONNECT]?: (port: MessagePort) => void
  $scramerr?: (error: unknown) => void
}

const waitForWorker = async (registration: ServiceWorkerRegistration) => {
  if (registration.active) return registration.active
  await new Promise<void>((resolve) => {
    const worker = registration.installing ?? registration.waiting
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'activated') resolve()
    })
  })
  if (!registration.active) throw new Error('yt-client: Scramjet service worker did not activate')
  return registration.active
}

const stage = (value: string) => {
  document.documentElement.dataset.stage = value
}

/* Longer than the app's own broker-load ceiling, deliberately: this is only a
   backstop against an app that never answers at all. A platform that fails to
   come up is reported by the app side, which invalidates the engine with the
   real reason rather than letting this fire with a vaguer one. */
const BOOTSTRAP_TIMEOUT_MS = 30_000

/* The app realm owns `@fkn/lib`, the FKN broker and the egress worker (see
   platform.ts for why), so this frame is handed its egress instead of building
   it. Announced at module evaluation rather than inside boot(), so the app can
   answer while the service worker registration is still in flight. */
const bootstrap = new Promise<{ egress: MessagePort, extFetch: MessagePort }>((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error('yt-client: engine bootstrap ports never arrived')),
    BOOTSTRAP_TIMEOUT_MS,
  )
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== location.origin || event.source !== window.parent) return
    if ((event.data as HostBootstrap | undefined)?.type !== HOST_BOOTSTRAP) return
    window.removeEventListener('message', onMessage)
    clearTimeout(timeout)
    const [egress, extFetch] = event.ports
    if (!egress || !extFetch) {
      reject(new Error('yt-client: engine bootstrap ports are missing'))
      return
    }
    resolve({ egress, extFetch })
  }
  window.addEventListener('message', onMessage)
  window.parent.postMessage({ type: HOST_HELLO } satisfies HostHello, location.origin)
})

/* The app realm's extension fetch, reached over a port. Mirrors the local
   function it replaces exactly, including answering null when the extension is
   absent so every caller falls back to the tunnelled transports. */
const createExtFetch = (port: MessagePort): ExtEgressFetch => {
  let requestId = 0
  const pending = new Map<number, { resolve(value: TransportResponse | null): void, reject(reason: unknown): void }>()
  port.addEventListener('message', (event) => {
    const message = event.data as ExtFetchResponse
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error))
    // `?? null` only bridges the union's optional-vs-null shape; both mean the
    // same thing to the caller, which is "fall back to the tunnel".
    else request.resolve(message.response ?? null)
  })
  port.start()
  return (url, options, signal) => new Promise<TransportResponse | null>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const id = ++requestId
    pending.set(id, { resolve, reject })
    signal?.addEventListener('abort', () => {
      // Only the first settler wins: a response that crossed the abort keeps
      // the entry, and deleting it here is what proves this abort got there
      // first.
      if (!pending.delete(id)) return
      port.postMessage({ type: 'cancel', id } satisfies ExtFetchRequest)
      reject(signal.reason)
    }, { once: true })
    // `options.body` is NOT transferred: the caller reuses this same options
    // object on the tunnelled fallback, and a transferred ArrayBuffer would
    // reach it detached.
    port.postMessage({ type: 'fetch', id, url, options } satisfies ExtFetchRequest)
  })
}

const boot = async () => {
  // Every boot stage that depends on nothing starts immediately; awaits happen
  // only where a stage's result is consumed.
  stage('service-worker')
  const workerReady = navigator.serviceWorker.register('/__yt_scramjet__/sw.js', {
    scope: '/__yt_scramjet__/',
    type: 'classic',
    updateViaCache: 'none',
  }).then(waitForWorker)
  const frameCodePromise = fetch('/__yt_scramjet__/youtube-frame.js').then((response) => response.text())
  stage('bootstrap')
  const transportReady = bootstrap.then(async ({ egress, extFetch: extFetchPort }) => {
    egress.start()
    const remote = expose<EgressApi>({}, {
      key: EGRESS_KEY,
      transport: { receive: egress, emit: egress },
    })
    const extFetch = createExtFetch(extFetchPort)
    const transport = createFknTransport(remote, extFetch)
    await transport.init()
    return { egress, extFetchPort, remote, transport, extFetch }
  })
  const [serviceworker, { egress, extFetchPort, remote, transport, extFetch }] = await Promise.all([workerReady, transportReady])

  stage('controller')
  const controller = new Controller({
    serviceworker,
    transport,
    config: {
      prefix: '/__yt_scramjet__/proxy/',
      scramjetPath: '/__yt_scramjet__/scramjet/scramjet.js',
      injectPath: '/__yt_scramjet__/controller/controller.inject.js',
      wasmPath: '/__yt_scramjet__/scramjet/scramjet.wasm',
      virtualWasmPath: 'scramjet.wasm.js',
    },
    scramjetConfig: defaultConfigDev,
  })
  await controller.wait()
  stage('frame')

  // A SECOND Controller drives ONLY the sign-in frame, over the webvpn/libcurl
  // transport (in-browser Chrome-impersonated TLS Google's login backend accepts;
  // the FKN proxy is rejected with "Something went wrong"). It shares the same SW
  // registration + config as the engine (the SW multiplexes controllers by their
  // random-id prefix) and its cookie jar syncs to the engine's via the shared
  // __scramjet_controller IndexedDB + BroadcastChannel, so a completed login
  // still propagates. The engine keeps the latency-tuned FKN proxy — untouched.
  const webvpnTransport = createWebvpnTransport(remote)
  await webvpnTransport.init()
  const webvpnController = new Controller({
    serviceworker,
    transport: webvpnTransport,
    config: {
      prefix: '/__yt_scramjet__/proxy/',
      scramjetPath: '/__yt_scramjet__/scramjet/scramjet.js',
      injectPath: '/__yt_scramjet__/controller/controller.inject.js',
      wasmPath: '/__yt_scramjet__/scramjet/scramjet.wasm',
      virtualWasmPath: 'scramjet.wasm.js',
    },
    scramjetConfig: defaultConfigDev,
  })
  await webvpnController.wait()

  let signInElement: HTMLIFrameElement | undefined
  let signInPoll: ReturnType<typeof setInterval> | undefined

  // Whether the proxied frame has painted a real document. Scramjet drives
  // navigation through the service worker, so neither the iframe `load` event
  // nor its location are reliable — detect content directly: about:blank has an
  // empty body, a rendered login page has real structure.
  const signInRendered = (element: HTMLIFrameElement) => {
    try {
      const doc = element.contentDocument
      return !!doc && doc.readyState !== 'loading' && (doc.body?.childElementCount ?? 0) > 2
    } catch {
      return false
    }
  }

  // The frame's decoded target URL, or '' if unreadable.
  const signInTarget = (element: HTMLIFrameElement, prefix: string) => {
    try {
      const path = element.contentWindow?.location.pathname ?? ''
      if (!path.startsWith(prefix)) return ''
      return webvpnController.config.codec.decode(path.slice(prefix.length))
    } catch {
      return ''
    }
  }

  const signInComplete = (element: HTMLIFrameElement, prefix: string) => {
    // SAPISID in the shared jar is the definitive "logged in" signal — Google
    // only sets it after a successful auth, at which point it redirects back to
    // youtube.com. Gate on it, and only hold off if the frame is still visibly
    // on an accounts.google.com page (mid-flow); if the location is unreadable,
    // trust the cookie.
    // Read the webvpn controller's jar — the sign-in frame's cookies land there
    // first (it syncs to the engine jar for the authenticated reboot).
    const cookies = webvpnController.cookieJar.getCookies(new URL('https://www.youtube.com/'), false) as string
    if (!/(?:^|;\s*)SAPISID=/.test(cookies)) return false
    return !signInTarget(element, prefix).startsWith('https://accounts.google.com/')
  }

  const destroySignIn = () => {
    clearInterval(signInPoll)
    signInPoll = undefined
    const element = signInElement
    signInElement = undefined
    if (!element) return
    // The controller has no frame disposal API — drop it from the webvpn
    // controller's routing list (that's where the sign-in frame lives) and
    // remove the element.
    const index = webvpnController.frames.findIndex((proxied) => proxied.element === element)
    if (index !== -1) webvpnController.frames.splice(index, 1)
    element.remove()
  }

  const openSignIn = (port: MessagePort) => {
    if (signInElement) return
    // Least privilege: the login flow needs no permissions, and this frame is
    // the first place arbitrary rewritten Google JS runs on the app origin.
    const element = document.createElement('iframe')
    // Literal rather than var(--bg-base) on purpose: this element lives in the
    // scramjet host document, which carries none of the app's :root custom
    // properties, so a var() reference here would resolve to nothing. It is
    // only visible for the moment before Google's own (always light) login
    // page paints over it.
    element.style.cssText = 'position: fixed; inset: 0; width: 100%; height: 100%; border: 0; background: #0f0f0f; z-index: 10;'
    document.body.appendChild(element)
    // Untapped frame on the WEBVPN controller — no youtube-frame.js injection,
    // the real rewritten login pages run over libcurl against the shared jar.
    const proxied = webvpnController.createFrame(element)
    signInElement = element
    let announcedLoad = false
    let advanced = false
    const check = () => {
      if (signInElement !== element) return
      const target = signInTarget(element, proxied.prefix)
      // The youtube.com hops (the session-entry page at the start, the cookie
      // return at the end) are plumbing the user shouldn't see: keep the frame
      // invisible while it is on youtube.com so only the Google auth pages ever
      // show. Leave an unreadable ('') target alone — mid-navigation flicker.
      if (target) element.style.visibility = isYoutubeHop(target) ? 'hidden' : 'visible'
      // First rendered NON-youtube document = the auth page is up; tell the app
      // to drop its loading overlay. While still on youtube.com the overlay
      // stays, covering the entry hop + auto-click below.
      if (!announcedLoad && signInRendered(element) && target && !isYoutubeHop(target)) {
        announcedLoad = true
        port.postMessage({ type: SIGNIN_LOADED } satisfies HostControlEvent)
      }
      // If routed through youtube.com first, auto-click its own Sign in link (an
      // <a> whose rewritten href still encodes the ServiceLogin target) once, so
      // the redirect carries the youtube.com referer. Scoped to youtube.com pages
      // so it never clicks Google's footer TOS links.
      if (!advanced && isYoutubeHop(target)) {
        try {
          const link = element.contentDocument?.querySelector<HTMLElement>('a[href*="ServiceLogin"]')
          if (link) {
            advanced = true
            link.click()
          }
        } catch {}
      }
      if (!signInComplete(element, proxied.prefix)) return
      port.postMessage({ type: SIGNIN_STATUS, signedIn: true } satisfies HostControlEvent)
      destroySignIn()
    }
    element.addEventListener('load', check)
    signInPoll = setInterval(check, 500)
    // Prewarm the webvpn relay to both login hosts (a dial+close that warms the
    // relay session) BEFORE the first navigation — a cold libcurl dial to a
    // never-warmed host hangs, so pay that cost up front, then navigate. Capped
    // so a slow/failed warm never strands the frame (the app also has a reveal
    // fallback); the navigation itself re-warms if needed.
    void remote
      .then((api) => Promise.race([
        Promise.allSettled([api.prewarm('www.youtube.com'), api.prewarm('accounts.google.com')]),
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]))
      .catch(() => {})
      .finally(() => { if (signInElement === element) proxied.go(SIGN_IN_URL) })
  }

  const clearCookies = async (id: number, port: MessagePort) => {
    // A reply must ALWAYS go back: sign-out treats a missing/failed clear as
    // fatal (the persisted jar still holds the identity), never as success.
    try {
      controller.cookieJar.clear()
      await controller.persistCookies()
      await controller.propagateCookieSync([], { clear: true }).catch(() => {})
      port.postMessage({ type: COOKIES_CLEARED, id } satisfies HostControlEvent)
    } catch (error) {
      port.postMessage({
        type: COOKIES_CLEARED,
        id,
        error: String((error as Error)?.message ?? error),
      } satisfies HostControlEvent)
    }
  }

  let controlPort: MessagePort | undefined
  const connectControl = () => {
    const channel = new MessageChannel()
    controlPort = channel.port1
    channel.port1.addEventListener('message', (event) => {
      const message = event.data as HostControlRequest
      if (message.type === OPEN_SIGNIN) openSignIn(channel.port1)
      else if (message.type === CLOSE_SIGNIN) destroySignIn()
      else if (message.type === CLEAR_COOKIES) void clearCookies(message.id, channel.port1)
    })
    channel.port1.start()
    return channel
  }

  const frame = document.createElement('iframe')
  frame.hidden = true
  frame.setAttribute('allow', 'autoplay; encrypted-media')
  document.body.appendChild(frame)
  const proxiedFrame = controller.createFrame(frame)
  let frameEgressPort: MessagePort | undefined
  const frameCode = await frameCodePromise
  Tap.tap(proxiedFrame.hooks.init.post, (context) => {
    if (!context.isTopLevel) return
    const run = context.client.natives.call('Function', null, frameCode)
    run()
    stage('frame-code')
    const apiChannel = new MessageChannel()
    const frameWindow = context.window as FrameWindow
    frameWindow.$scramerr = () => {}
    const egressChannel = new MessageChannel()
    frameEgressPort = egressChannel.port2
    // Frame egress (SABR media, botguard attestation, host warms). Prefer the
    // extension's native CORS-free fetch when present, else the libcurl/webvpn
    // tunnel. Each in-flight request gets an AbortController so a frame-side
    // cancel (e.g. a seek dropping stale segment requests) aborts the extension
    // fetch too — the tunnel path is cancelled via cancelLibcurlFetch.
    const egressAborts = new Map<number, AbortController>()
    egressChannel.port2.addEventListener('message', (event) => {
      const request = event.data as FrameEgressRequest
      const egressRequestId = `frame:${proxiedFrame.id}:${request.id}`
      if (request.type === 'cancel') {
        egressAborts.get(request.id)?.abort()
        egressAborts.delete(request.id)
        void remote.then((api) => api.cancelLibcurlFetch(egressRequestId)).catch(() => {})
        return
      }
      const abort = new AbortController()
      egressAborts.set(request.id, abort)
      const run = async () => {
        const viaExtension = await extFetch(request.url, request.options, abort.signal)
        if (viaExtension) return viaExtension
        return (await remote).libcurlFetch(egressRequestId, request.url, request.options)
      }
      void run().then(
        (response) => {
          egressAborts.delete(request.id)
          const message = { id: request.id, response } satisfies FrameEgressResponse
          egressChannel.port2.postMessage(message, response.body ? [response.body] : [])
        },
        (error) => {
          egressAborts.delete(request.id)
          egressChannel.port2.postMessage({
            id: request.id,
            error: error instanceof Error ? error.message : String(error),
          } satisfies FrameEgressResponse)
        },
      )
    })
    egressChannel.port2.start()
    const connectEgress = frameWindow[FRAME_EGRESS_CONNECT]
    if (!connectEgress) throw new Error('yt-client: frame egress connector is missing')
    delete frameWindow[FRAME_EGRESS_CONNECT]
    connectEgress(egressChannel.port1)
    const connect = frameWindow[FRAME_CONNECT]
    if (!connect) throw new Error('yt-client: frame connector is missing')
    delete frameWindow[FRAME_CONNECT]
    connect(apiChannel.port1)
    stage('frame-connected')
    const controlChannel = connectControl()
    window.parent.postMessage({ type: ENGINE_READY }, location.origin, [apiChannel.port2, controlChannel.port2])
    stage('frame-posted')
  })
  proxiedFrame.go(FRAME_BOOTSTRAP_URL)
  /* Ports only. The egress worker, the relay and the broker belong to the app
     realm now and deliberately outlive this frame - surviving engine resets is
     the point of the move. */
  window.addEventListener('pagehide', () => {
    egress.close()
    extFetchPort.close()
    frameEgressPort?.close()
    controlPort?.close()
  }, { once: true })

  return { controller, frame: proxiedFrame }
}

void boot().catch((error) => {
  stage('error')
  window.parent.postMessage({
    type: ENGINE_READY,
    error: error instanceof Error ? error.message : String(error),
  }, location.origin)
})

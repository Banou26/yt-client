import type {
  ProxyTransport,
  RawHeaders,
  TransferrableResponse,
  WebSocketDataType,
} from '@mercuryworkshop/proxy-transports'

import type { EgressApi, TransportRequest, TransportResponse } from './protocol'

export const FRAME_BOOTSTRAP_URL = 'https://www.youtube.com/__yt_client__/frame'

const frameBootstrap = new URL(FRAME_BOOTSTRAP_URL)
const frameBootstrapHtml = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'

// Google's sign-in flow spans these hosts; they emit soft redirects (200 + Location).
const AUTH_HOST = /(^|\.)(accounts|myaccount)\.google\.com$/

// The egress strategy differs per transport: the engine uses the FKN broker proxy
// (fknFetch); the sign-in frame uses libcurl over the webvpn relay (in-browser
// Chrome-impersonated TLS Google's login backend accepts). The request-shaping —
// bootstrap short-circuit, header/body marshalling, and the auth soft-redirect
// promotion — is identical, so both share this builder.
type EgressFetch = (url: string, options: TransportRequest, signal: AbortSignal | undefined) => Promise<TransportResponse>

const createTransport = (ready: () => Promise<void>, egressFetch: EgressFetch): ProxyTransport => {
  const transport: ProxyTransport = {
    ready: false,
    async init() {
      await ready()
      transport.ready = true
    },
    async request(
      url: URL,
      method: string,
      body: BodyInit | null,
      headers: RawHeaders,
      signal: AbortSignal | undefined,
    ): Promise<TransferrableResponse> {
      if (signal?.aborted) throw signal.reason
      if (method === 'GET' && url.origin === frameBootstrap.origin && url.pathname === frameBootstrap.pathname) {
        return {
          status: 200,
          statusText: 'OK',
          headers: [
            ['content-type', 'text/html; charset=utf-8'],
            ['cache-control', 'no-store'],
          ],
          body: frameBootstrapHtml,
        }
      }
      const requestHeaders = Object.fromEntries(headers)
      // A GET/HEAD must never carry a body. Chromium's service worker reports
      // request.body as null, but Firefox never implemented the body getter, so
      // it arrives as undefined — a strict null check let it through as an
      // empty (truthy) ArrayBuffer, which the native fetch downstream (broker,
      // extension) rejects: "Request constructor: HEAD or GET Request cannot
      // have a body."
      const bytes = body == null || method === 'GET' || method === 'HEAD'
        ? undefined
        : await new Response(body).arrayBuffer()
      const response = await egressFetch(url.href, { method, headers: requestHeaders, body: bytes, redirect: 'manual' }, signal)
      // Google's auth endpoints answer some navigation hops with 200 + a Location
      // header (a "soft redirect" scramjet won't rewrite as a 200, so the browser
      // downloads the opaque blob and the frame never advances). Promote those to a
      // hard 302. Scoped to document navigations on auth hosts so nothing else is
      // affected; the login flow's XHRs pass through untouched.
      const isNavigation = (requestHeaders['sec-fetch-dest'] ?? requestHeaders['Sec-Fetch-Dest']) === 'document'
      if (isNavigation && AUTH_HOST.test(url.hostname) && response.status >= 200 && response.status < 300) {
        const location = response.headers.find(([key]) => key.toLowerCase() === 'location')?.[1]
        if (location) return { status: 302, statusText: 'Found', headers: [['location', location]], body: new ArrayBuffer(0) }
      }
      return {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: response.body ?? new ArrayBuffer(0),
      }
    },
    connect(
      _url: URL,
      _protocols: string[],
      _headers: RawHeaders,
      _onopen: (protocol: string, extensions: string) => void,
      _onmessage: (data: WebSocketDataType) => void,
      _onclose: (code: number, reason: string) => void,
      onerror: (error: string) => void,
    ) {
      queueMicrotask(() => onerror('yt-client: WebSocket transport is not available'))
      return [() => {}, () => {}]
    },
  }
  return transport
}

// A window-realm fetch (the FKN browser extension's CORS-free native fetch). It
// returns null when the extension isn't available so the caller falls back.
export type ExtEgressFetch = (
  url: string,
  options: TransportRequest,
  signal: AbortSignal | undefined,
) => Promise<TransportResponse | null>

// YouTube's innertube API answers Firefox's proxied POSTs with 400
// FAILED_PRECONDITION when they come through the FKN broker (a server-side
// anti-bot rejection specific to Firefox-originated proxied requests; Chromium's
// identical requests are accepted). The libcurl/webvpn tunnel — which does an
// in-browser Chrome-impersonated TLS handshake — is accepted by YouTube, so
// Firefox metadata rides the tunnel while Chromium keeps the latency-tuned
// broker. (Segments + botguard already use the tunnel via egressFetch.)
const isFirefox = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent)

// The engine transport: metadata/token traffic. When the FKN extension is present
// it goes over the extension's native fetch (direct, no proxy/tunnel round trip);
// otherwise Chromium uses the FKN proxy and Firefox uses the webvpn tunnel.
export const createFknTransport = (
  remote: Promise<Pick<EgressApi, 'fknFetch' | 'libcurlFetch' | 'cancelLibcurlFetch'>>,
  extFetch?: ExtEgressFetch,
): ProxyTransport => {
  let requestCounter = 0
  return createTransport(
    async () => { await remote },
    async (url, options, signal) => {
      const viaExtension = await extFetch?.(url, options, signal)
      if (viaExtension) return viaExtension
      const api = await remote
      if (!isFirefox) return api.fknFetch(url, options)
      const requestId = `meta:${++requestCounter}`
      signal?.addEventListener('abort', () => { void api.cancelLibcurlFetch(requestId) }, { once: true })
      return api.libcurlFetch(requestId, url, options)
    },
  )
}

// The sign-in transport: the WHOLE login flow (youtube.com + accounts.google.com)
// over one libcurl/webvpn connection, so Google sees a single in-browser-TLS,
// single-IP session — which its login backend accepts (the FKN proxy is rejected).
export const createWebvpnTransport = (remote: Promise<Pick<EgressApi, 'libcurlFetch' | 'cancelLibcurlFetch'>>): ProxyTransport => {
  let requestCounter = 0
  return createTransport(
    async () => { await remote },
    async (url, options, signal) => {
      const api = await remote
      const requestId = `signin:${++requestCounter}`
      signal?.addEventListener('abort', () => { void api.cancelLibcurlFetch(requestId) }, { once: true })
      return api.libcurlFetch(requestId, url, options)
    },
  )
}

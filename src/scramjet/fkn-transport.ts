import type {
  ProxyTransport,
  RawHeaders,
  TransferrableResponse,
  WebSocketDataType,
} from '@mercuryworkshop/proxy-transports'

import type { EgressApi } from './protocol'

export const FRAME_BOOTSTRAP_URL = 'https://www.youtube.com/__yt_client__/frame'

const frameBootstrap = new URL(FRAME_BOOTSTRAP_URL)
const frameBootstrapHtml = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'

// Google's sign-in flow spans these hosts; they emit soft redirects (200 + Location).
const AUTH_HOST = /(^|\.)(accounts|myaccount)\.google\.com$/

export const createFknTransport = (remote: Promise<Pick<EgressApi, 'fknFetch'>>): ProxyTransport => {
  const transport: ProxyTransport = {
    ready: false,
    async init() {
      await remote
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
      const api = await remote
      const requestHeaders = Object.fromEntries(headers)
      const bytes = body === null ? undefined : await new Response(body).arrayBuffer()
      const response = await api.fknFetch(url.href, {
        method,
        headers: requestHeaders,
        body: bytes,
        redirect: 'manual',
      })
      // Google's auth endpoints answer some hops with 200 + content-type
      // application/binary and a Location header — a "soft redirect" meant for
      // programmatic following. Scramjet only rewrites Location on a real 3xx, so
      // as a 200 the browser downloads the opaque blob and the frame never
      // advances. Promote that soft redirect to a hard 302 so scramjet rewrites
      // it and the login flow proceeds. Scoped to Google auth hosts so the
      // latency-tuned youtube playback/metadata path is untouched.
      // Only navigations get the soft-redirect promotion; XHR/fetch (the login
      // flow's batchexecute calls) must pass through untouched.
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

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

const AUTH_HOST = /(^|\.)(accounts|myaccount)\.google\.com$/

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
      // loose null check: Firefox never implemented the service worker body getter, so it arrives as undefined
      const bytes = body == null || method === 'GET' || method === 'HEAD'
        ? undefined
        : await new Response(body).arrayBuffer()
      const response = await egressFetch(url.href, { method, headers: requestHeaders, body: bytes, redirect: 'manual' }, signal)
      // Google's auth endpoints answer some navigation hops with a soft redirect (200 + Location) scramjet will not rewrite
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

export type ExtEgressFetch = (
  url: string,
  options: TransportRequest,
  signal: AbortSignal | undefined,
) => Promise<TransportResponse | null>

export const createFknTransport = (
  remote: Promise<Pick<EgressApi, 'fknFetch'>>,
  extFetch?: ExtEgressFetch,
): ProxyTransport =>
  createTransport(
    async () => { await remote },
    async (url, options, signal) => {
      const viaExtension = await extFetch?.(url, options, signal)
      if (viaExtension) return viaExtension
      return (await remote).fknFetch(url, options)
    },
  )

// takes NO extension fetch by design: `redirect: 'manual'` there yields an opaque redirect, and split hops are two sessions to Google
export const createWebvpnTransport = (
  remote: Promise<Pick<EgressApi, 'libcurlFetch' | 'cancelLibcurlFetch'>>,
): ProxyTransport => {
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

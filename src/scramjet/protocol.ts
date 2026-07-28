export type TransportResponse = {
  status: number
  statusText: string
  headers: [string, string][]
  body: ReadableStream<Uint8Array> | null
}

export type TransportRequest = {
  method?: string
  headers?: Record<string, string>
  body?: ArrayBuffer | null
  redirect?: 'follow' | 'manual'
}

export type EgressApi = {
  fknFetch(url: string, options: TransportRequest): Promise<TransportResponse>
  libcurlFetch(
    requestId: string,
    url: string,
    options: TransportRequest,
  ): Promise<TransportResponse>
  cancelLibcurlFetch(requestId: string): Promise<void>
  prewarm(host: string): Promise<void>
}

export const EGRESS_KEY = 'yt-client-egress'
export const ENGINE_READY = 'yt-client-engine-ready'

/* Posted straight at the worker rather than carried on an EgressApi port,
   because the app realm holds no port of its own: every port it opens is
   transferred into a host frame. The worker now OUTLIVES the engine, so an
   engine reset no longer takes its in-flight work down with it, and a failed
   playback session would otherwise keep pulling media over the tunnel long
   after the frame that asked for it is gone. */
export const EGRESS_ABORT_ALL = 'yt-client-egress-abort-all'

/* The host frame's boot handshake.

   The host announces itself (HOST_HELLO) as soon as its script evaluates, and
   the app answers with HOST_BOOTSTRAP carrying two ports:

   - ports[0]: EgressApi, straight to the egress worker. No hop through the app
     realm, so the hot media path is exactly as long as it was.
   - ports[1]: the extension fetch, back into the app realm.

   The second port exists because importing `@fkn/lib` ANYWHERE injects an
   `fkn.app/api` broker iframe into that realm's document as a module-load side
   effect. The app realm has to be the one that owns it (see platform.ts), so
   the host frame must not import the lib at all - not even for the extension
   path, which the content script would otherwise serve here perfectly well. */
export const HOST_HELLO = 'yt-client-host-hello'
export const HOST_BOOTSTRAP = 'yt-client-host-bootstrap'

export type HostHello = { type: typeof HOST_HELLO }
export type HostBootstrap = { type: typeof HOST_BOOTSTRAP }

export type ExtFetchRequest = {
  type: 'fetch'
  id: number
  url: string
  options: TransportRequest
} | {
  type: 'cancel'
  id: number
}

export type ExtFetchResponse = {
  id: number
  /* null when the extension is not exposed, so the caller falls back to the
     tunnelled transports exactly as it did when this was a local call. */
  response: TransportResponse | null
  error?: never
} | {
  id: number
  response?: never
  error: string
}

export const OPEN_SIGNIN = 'open-signin'
export const CLOSE_SIGNIN = 'close-signin'
export const CLEAR_COOKIES = 'clear-cookies'
export const SIGNIN_STATUS = 'signin-status'
export const SIGNIN_LOADED = 'signin-loaded'
export const COOKIES_CLEARED = 'cookies-cleared'

export type HostControlRequest = {
  type: typeof OPEN_SIGNIN
} | {
  type: typeof CLOSE_SIGNIN
} | {
  type: typeof CLEAR_COOKIES
  id: number
}

export type HostControlEvent = {
  type: typeof SIGNIN_STATUS
  signedIn: boolean
} | {
  type: typeof SIGNIN_LOADED
} | {
  type: typeof COOKIES_CLEARED
  id: number
  // present when the clear failed — the caller must treat it as fatal.
  error?: string
}

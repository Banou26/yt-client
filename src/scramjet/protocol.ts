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

export const EGRESS_ABORT_ALL = 'yt-client-egress-abort-all'

/* HOST_BOOTSTRAP carries two ports: ports[0] the EgressApi straight to the egress worker, ports[1] the extension fetch back into the app realm.
   The host frame must not import `@fkn/lib` at all: importing it ANYWHERE injects an `fkn.app/api` broker iframe into that realm's document. */
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
  error?: string
}

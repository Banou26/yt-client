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

export const OPEN_SIGNIN = 'open-signin'
export const CLOSE_SIGNIN = 'close-signin'
export const CLEAR_COOKIES = 'clear-cookies'
export const SIGNIN_STATUS = 'signin-status'
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
  type: typeof COOKIES_CLEARED
  id: number
  // present when the clear failed — the caller must treat it as fatal.
  error?: string
}

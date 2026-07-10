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

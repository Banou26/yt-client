export type TransportResponse = {
  status: number
  statusText: string
  headers: [string, string][]
  body: ReadableStream<Uint8Array> | null
}

export type EgressApi = {
  fetch(
    requestId: string,
    url: string,
    options: {
      method?: string
      headers?: Record<string, string>
      body?: ArrayBuffer | null
      redirect?: 'follow' | 'manual'
    },
  ): Promise<TransportResponse>
  cancelFetch(requestId: string): Promise<void>
  prewarm(host: string): Promise<void>
}

export const EGRESS_KEY = 'yt-client-egress'
export const ENGINE_READY = 'yt-client-engine-ready'

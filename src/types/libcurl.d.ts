declare module 'libcurl.js/bundled' {
  export const libcurl: {
    load_wasm(): Promise<void>
    set_websocket(url: string): void
    transport: new (url: string) => unknown
    fetch(url: string, init?: {
      method?: string
      headers?: Record<string, string>
      body?: Uint8Array
      redirect?: 'follow' | 'manual'
    }): Promise<Response & { raw_headers?: [string, string][] }>
  }
}

/// <reference lib="webworker" />

import { expose } from 'osra'
import { libcurl } from 'libcurl.js/bundled'
import * as net from '@fkn/lib/net'

import type { EgressApi } from './protocol'

import { EGRESS_KEY } from './protocol'

declare const self: DedicatedWorkerGlobalScope

type Socket = {
  on(event: string, listener: (...args: any[]) => void): void
  write(data: Uint8Array): void
  destroy(): void
}

type Pipe = {
  read(): Promise<Uint8Array | null>
  write(data: Uint8Array): Promise<void>
  close(): void
}

const dial = (host: string, port: number) => new Promise<Pipe>((resolve, reject) => {
  const socket = net.connect({ host, port }) as unknown as Socket
  const chunks: (Uint8Array | null)[] = []
  let waiting: ((chunk: Uint8Array | null) => void) | undefined
  let closed = false
  const push = (chunk: Uint8Array | null) => {
    if (waiting) {
      const receive = waiting
      waiting = undefined
      receive(chunk)
    } else {
      chunks.push(chunk)
    }
  }
  const finish = () => {
    if (closed) return
    closed = true
    push(null)
  }
  socket.on('connect', () => resolve({
    read: () => new Promise((receive) => {
      if (chunks.length) return receive(chunks.shift() ?? null)
      if (closed) return receive(null)
      waiting = receive
    }),
    write: async (data) => socket.write(data),
    close: () => socket.destroy(),
  }))
  socket.on('data', (chunk: ArrayBuffer | Uint8Array) => {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
    push(bytes.slice())
  })
  socket.on('end', finish)
  socket.on('close', finish)
  socket.on('error', (error: unknown) => {
    finish()
    reject(error)
  })
})

class WebvpnSocket {
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3
  readyState = this.CONNECTING
  binaryType = 'arraybuffer'
  onopen: () => void = () => {}
  onmessage: (event: { data: ArrayBuffer }) => void = () => {}
  onclose: () => void = () => {}
  onerror: (error: unknown) => void = () => {}
  #pipe?: Pipe

  constructor(url: string) {
    const address = url.split('/').at(-1) ?? ''
    const separator = address.lastIndexOf(':')
    const host = address.slice(0, separator)
    const port = Number(address.slice(separator + 1))
    void (async () => {
      try {
        this.#pipe = await dial(host, port)
        this.readyState = this.OPEN
        this.onopen()
        for (;;) {
          const chunk = await this.#pipe.read()
          if (!chunk) break
          this.onmessage({ data: Uint8Array.from(chunk).buffer as ArrayBuffer })
        }
        this.readyState = this.CLOSED
        this.onclose()
      } catch (error) {
        this.readyState = this.CLOSED
        this.onerror(error)
        this.onclose()
      }
    })()
  }

  send(data: ArrayBuffer | Uint8Array) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    void this.#pipe?.write(bytes)
  }

  close() {
    this.readyState = this.CLOSING
    this.#pipe?.close()
  }
}

let ready: Promise<void> | undefined
const prepare = () => (ready ??= (async () => {
  await libcurl.load_wasm()
  libcurl.set_websocket('wss://webvpn.invalid/')
  libcurl.transport = WebvpnSocket
})())

const withLanguage = (headers: Record<string, string> = {}) => {
  const result = { ...headers }
  if (!Object.keys(result).some((name) => name.toLowerCase() === 'accept-language')) {
    result['accept-language'] = navigator.languages
      .map((language, index) => index === 0 ? language : `${language};q=${Math.max(0.1, 1 - index * 0.1).toFixed(1)}`)
      .join(',')
  }
  return result
}

const requests = new Map<string, AbortController>()

const api = {
  fetch: async (requestId, url, options) => {
    const controller = new AbortController()
    requests.set(requestId, controller)
    let response: Awaited<ReturnType<typeof libcurl.fetch>>
    try {
      await prepare()
      if (controller.signal.aborted) throw controller.signal.reason
      const fetchOptions = {
        method: options.method,
        headers: withLanguage(options.headers),
        body: options.body ? new Uint8Array(options.body) : undefined,
        redirect: options.redirect,
        signal: controller.signal,
      }
      response = await libcurl.fetch(url, fetchOptions)
    } catch (error) {
      requests.delete(requestId)
      throw error
    }
    const headers: [string, string][] = response.raw_headers ?? []
    if (!headers.length) response.headers.forEach((value, name) => headers.push([name, value]))
    const reader = response.body?.getReader()
    if (!reader) requests.delete(requestId)
    const body = reader ? new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const chunk = await reader.read()
          if (chunk.done) {
            requests.delete(requestId)
            stream.close()
          } else {
            stream.enqueue(chunk.value)
          }
        } catch (error) {
          requests.delete(requestId)
          stream.error(error)
        }
      },
      async cancel(reason) {
        requests.delete(requestId)
        controller.abort()
        await reader.cancel(reason).catch(() => {})
      },
    }) : null
    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      body,
    }
  },
  cancelFetch: async (requestId) => {
    requests.get(requestId)?.abort()
    requests.delete(requestId)
  },
  prewarm: async (host) => {
    await prepare()
    const pipe = await dial(host, 443)
    pipe.close()
  },
} satisfies EgressApi

void prepare()

self.addEventListener('message', (event) => {
  if (event.data?.type !== EGRESS_KEY || !event.data.port) return
  const port = event.data.port as MessagePort
  port.start()
  expose(api, {
    key: EGRESS_KEY,
    transport: { receive: port, emit: port },
  })
})

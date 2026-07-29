import { describe, expect, it } from 'vite-plus/test'

import type { TransportRequest } from './protocol'

import { createFknTransport, createWebvpnTransport, FRAME_BOOTSTRAP_URL } from './fkn-transport'

describe('webvpn transport', () => {
  it('routes requests through libcurl with a request id, cancels on abort, and promotes auth soft-redirects', async () => {
    let libcurl: { requestId: string, url: string, options: TransportRequest } | undefined
    let cancelled: string | undefined
    const remote = Promise.resolve({
      libcurlFetch: async (requestId: string, url: string, options: TransportRequest) => {
        libcurl = { requestId, url, options }
        // simulate Google's soft redirect: 200 + Location on a navigation
        return {
          status: 200,
          statusText: 'OK',
          headers: [['content-type', 'application/binary'], ['location', 'https://accounts.google.com/v3/signin/identifier']] as [string, string][],
          body: null,
        }
      },
      cancelLibcurlFetch: async (requestId: string) => { cancelled = requestId },
    })
    const transport = createWebvpnTransport(remote)
    await transport.init()
    expect(transport.ready).toBe(true)

    const controller = new AbortController()
    const result = await transport.request(
      new URL('https://accounts.google.com/ServiceLogin?service=youtube'),
      'GET',
      null,
      [['sec-fetch-dest', 'document']],
      controller.signal,
    )

    expect(libcurl?.url).toBe('https://accounts.google.com/ServiceLogin?service=youtube')
    expect(libcurl?.requestId).toMatch(/^signin:\d+$/)
    expect(libcurl?.options).toMatchObject({ method: 'GET', redirect: 'manual' })
    // the 200 + Location navigation was promoted to a hard 302
    expect(result.status).toBe(302)
    expect(result.headers).toEqual([['location', 'https://accounts.google.com/v3/signin/identifier']])

    controller.abort()
    expect(cancelled).toBe(libcurl?.requestId)
  })
})

describe('FKN transport', () => {
  it('routes requests through the FKN fetch worker method', async () => {
    let request: { url: string, options: TransportRequest } | undefined
    const remote = Promise.resolve({
      fknFetch: async (url: string, options: TransportRequest) => {
        request = { url, options }
        return {
          status: 201,
          statusText: 'Created',
          headers: [['x-result', 'yes']] as [string, string][],
          body: new ReadableStream<Uint8Array>(),
        }
      },
    })
    const transport = createFknTransport(remote)
    await transport.init()
    const result = await transport.request(
      new URL('https://www.youtube.com/youtubei/v1/search'),
      'POST',
      new Uint8Array([1, 2, 3]),
      [['content-type', 'application/json']],
      undefined,
    )

    expect(transport.ready).toBe(true)
    expect(request?.url).toBe('https://www.youtube.com/youtubei/v1/search')
    expect(request?.options).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      redirect: 'manual',
    })
    expect([...new Uint8Array(request?.options.body as ArrayBuffer)]).toEqual([1, 2, 3])
    expect(result.status).toBe(201)
    expect(result.headers).toEqual([['x-result', 'yes']])
    expect(result.body).toBeInstanceOf(ReadableStream)
  })

  it('serves the frame bootstrap without remote egress', async () => {
    let fetched = false
    const transport = createFknTransport(Promise.resolve({
      fknFetch: async () => {
        fetched = true
        throw new Error('unexpected remote fetch')
      },
    }))
    await transport.init()
    const result = await transport.request(
      new URL(FRAME_BOOTSTRAP_URL),
      'GET',
      null,
      [],
      undefined,
    )

    expect(fetched).toBe(false)
    expect(result.status).toBe(200)
    expect(result.headers).toContainEqual(['content-type', 'text/html; charset=utf-8'])
    expect(result.body).toContain('<body></body>')
  })
})

describe('webvpn transport prefers the extension', () => {
  it('uses the extension when it answers, and falls back to libcurl when it does not', async () => {
    const calls: string[] = []
    const remote = Promise.resolve({
      libcurlFetch: async (_id: string, url: string) => {
        calls.push(`libcurl:${url}`)
        return { status: 200, statusText: 'OK', headers: [] as [string, string][], body: null }
      },
      cancelLibcurlFetch: async () => {},
    })
    // An exposed extension answers, so webvpn must not be touched at all: that
    // is the whole point of routing sign-in through it.
    const viaExt = createWebvpnTransport(remote, async (url) => {
      calls.push(`ext:${url}`)
      return { status: 200, statusText: 'OK', headers: [], body: null }
    })
    await viaExt.init()
    await viaExt.request(new URL('https://accounts.google.com/ServiceLogin'), 'GET', null, [], undefined)
    expect(calls).toEqual(['ext:https://accounts.google.com/ServiceLogin'])

    // Answering null is the not-exposed signal, so the tunnel takes over.
    calls.length = 0
    const viaTunnel = createWebvpnTransport(remote, async () => null)
    await viaTunnel.init()
    await viaTunnel.request(new URL('https://accounts.google.com/ServiceLogin'), 'GET', null, [], undefined)
    expect(calls).toEqual(['libcurl:https://accounts.google.com/ServiceLogin'])
  })
})

import { describe, expect, it } from 'vitest'

import type { TransportRequest } from './protocol'

import { createFknTransport } from './fkn-transport'

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
})

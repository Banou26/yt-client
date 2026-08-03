import { describe, expect, it } from 'vite-plus/test'

import { carriesIdentity, isOpaqueRedirect, mayHonourManualRedirect } from './platform'

// the extension's native fetch cannot carry an identity: the `new Request(...)` constructor drops forbidden header names, and the lib smuggles only `origin` and `referer` back out
describe('carriesIdentity', () => {
  it('keeps SABR media on the extension path', () => {
    expect(carriesIdentity({
      origin: 'https://www.youtube.com',
      referer: 'https://www.youtube.com/',
      'content-type': 'application/x-protobuf',
    })).toBe(false)
  })

  it('tunnels a request carrying the Scramjet jar cookie', () => {
    expect(carriesIdentity({ cookie: 'SAPISID=x; __Secure-3PAPISID=y' })).toBe(true)
  })

  it('tunnels a SAPISIDHASH request even though the header survives the constructor', () => {
    expect(carriesIdentity({
      'content-type': 'application/json',
      'x-goog-visitor-id': 'visitor',
      authorization: 'SAPISIDHASH 1234_abcdef',
    })).toBe(true)
  })

  it('keeps the signed-out attestation call on the extension path', () => {
    expect(carriesIdentity({
      'content-type': 'application/json',
      'x-goog-visitor-id': 'visitor',
      'x-youtube-client-name': '1',
    })).toBe(false)
  })

  it('matches header names case insensitively', () => {
    expect(carriesIdentity({ Cookie: 'SAPISID=x' })).toBe(true)
    expect(carriesIdentity({ Authorization: 'SAPISIDHASH 1_a' })).toBe(true)
  })

  it('treats a request with no headers as anonymous', () => {
    expect(carriesIdentity(undefined)).toBe(false)
    expect(carriesIdentity({})).toBe(false)
  })
})

// an opaque redirect's status 0 makes `new Response(body, { status: 0 })` throw, taking the service worker's request handler down as a 500
describe('extension redirect handling', () => {
  it('declines an opaque redirect so the tunnel can serve it', () => {
    expect(isOpaqueRedirect({ status: 0, type: 'opaqueredirect' })).toBe(true)
    expect(isOpaqueRedirect({ status: 0 })).toBe(true)
  })

  it('keeps every real answer on the extension', () => {
    expect(isOpaqueRedirect({ status: 200, type: 'basic' })).toBe(false)
    expect(isOpaqueRedirect({ status: 302, type: 'basic' })).toBe(false)
    expect(isOpaqueRedirect({ status: 404 })).toBe(false)
  })
})

// the fallback above is a RE-ISSUE, so only a request that can be replayed may ask for the redirect mode that could produce an answer needing one
describe('which requests may read their own redirects', () => {
  it('lets a read honour manual, since replaying it is free', () => {
    expect(mayHonourManualRedirect('GET')).toBe(true)
    expect(mayHonourManualRedirect('HEAD')).toBe(true)
    expect(mayHonourManualRedirect(undefined)).toBe(true)
    expect(mayHonourManualRedirect('get')).toBe(true)
  })

  it('makes a write follow instead, so no answer can need replaying', () => {
    expect(mayHonourManualRedirect('POST')).toBe(false)
    expect(mayHonourManualRedirect('PUT')).toBe(false)
    expect(mayHonourManualRedirect('DELETE')).toBe(false)
    expect(mayHonourManualRedirect('PATCH')).toBe(false)
  })
})

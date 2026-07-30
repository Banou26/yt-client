import { describe, expect, it } from 'vite-plus/test'

import { carriesIdentity, isOpaqueRedirect } from './platform'

/* The extension's native fetch cannot carry an identity: `extension.fetch`
   builds a `new Request(...)`, whose constructor drops forbidden header names,
   and the lib smuggles only `origin` and `referer` back out. These cases are
   the split between what may take that path and what has to stay tunnelled. */
describe('carriesIdentity', () => {
  it('keeps SABR media on the extension path', () => {
    // What sabr.ts actually sends. origin/referer ARE dropped by the Request
    // constructor, but the lib rescues exactly those two, so the request still
    // arrives intact. This is the bulk of the bytes and the whole latency win.
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
    // The server recomputes the hash from the SAPISID COOKIE it received, so
    // this header without that cookie is inconsistent rather than merely
    // useless, and the attestation comes back as if anonymous.
    expect(carriesIdentity({
      'content-type': 'application/json',
      'x-goog-visitor-id': 'visitor',
      authorization: 'SAPISIDHASH 1234_abcdef',
    })).toBe(true)
  })

  it('keeps the signed-out attestation call on the extension path', () => {
    // Same botguard request with no SAPISID in the jar: sidAuthorization()
    // returns undefined and the header is never added, so there is no identity
    // to lose and the direct path is correct.
    expect(carriesIdentity({
      'content-type': 'application/json',
      'x-goog-visitor-id': 'visitor',
      'x-youtube-client-name': '1',
    })).toBe(false)
  })

  it('matches header names case insensitively', () => {
    // Scramjet hands raw headers through untouched, so casing is upstream's
    // choice rather than ours.
    expect(carriesIdentity({ Cookie: 'SAPISID=x' })).toBe(true)
    expect(carriesIdentity({ Authorization: 'SAPISIDHASH 1_a' })).toBe(true)
  })

  it('treats a request with no headers as anonymous', () => {
    expect(carriesIdentity(undefined)).toBe(false)
    expect(carriesIdentity({})).toBe(false)
  })
})

/* The other half of the split, and the one that broke sign-in on 2026-07-30.

   Scramjet proxies every request with `redirect: 'manual'`. A manual-redirect
   fetch only goes opaque when the response really is a 3xx, which is why
   ordinary browsing never noticed and Google's login, a chain of redirects,
   failed on its first hop: the opaque answer's status 0 made the engine build
   `new Response(body, { status: 0 })`, which throws and takes the service
   worker's request handler down as a 500. */
describe('extension redirect handling', () => {
  it('declines an opaque redirect so the tunnel can serve it', () => {
    // What a browser hands back for a 3xx under `redirect: 'manual'`: no
    // status, no headers, no body, so there is nothing to forward.
    expect(isOpaqueRedirect({ status: 0, type: 'opaqueredirect' })).toBe(true)
    // Either signal alone is enough: the response crosses a port before it is
    // inspected, and `type` does not have to survive that trip.
    expect(isOpaqueRedirect({ status: 0 })).toBe(true)
  })

  it('keeps every real answer on the extension', () => {
    /* The reason this is judged on the response and not on the request: asking
       for `manual` is the norm here, so refusing those up front would send ALL
       proxied traffic to the tunnel and give up the direct path. */
    expect(isOpaqueRedirect({ status: 200, type: 'basic' })).toBe(false)
    expect(isOpaqueRedirect({ status: 302, type: 'basic' })).toBe(false)
    expect(isOpaqueRedirect({ status: 404 })).toBe(false)
  })
})

import { describe, expect, it } from 'vite-plus/test'

import { carriesIdentity } from './platform'

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

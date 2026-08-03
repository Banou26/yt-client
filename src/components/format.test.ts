import { describe, expect, it } from 'vite-plus/test'

import { parseStartSeconds } from './format'

describe('start offsets', () => {
  it('accepts both forms upstream mints for `t`', () => {
    expect(parseStartSeconds('90')).toBe(90)
    expect(parseStartSeconds('90s')).toBe(90)
    expect(parseStartSeconds('1h2m3s')).toBe(3723)
    expect(parseStartSeconds('1m30s')).toBe(90)
    expect(parseStartSeconds('2h')).toBe(7200)
    expect(parseStartSeconds('0')).toBe(0)
  })

  it('refuses anything that is not a position', () => {
    // Every group in the compound pattern is optional, so letters match it with all groups empty
    expect(parseStartSeconds('abc')).toBeUndefined()
    expect(parseStartSeconds('')).toBeUndefined()
    expect(parseStartSeconds(null)).toBeUndefined()
    expect(parseStartSeconds(undefined)).toBeUndefined()
    expect(parseStartSeconds('1x2')).toBeUndefined()
  })
})

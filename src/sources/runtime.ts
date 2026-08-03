import type { SourceApi, SourceMethod } from './types'

import { startEngine } from '../scramjet/client'
import { SOURCE_CURSOR_ARGUMENT, SOURCE_METHODS, SOURCE_REPLAY } from './types'

let resolveSource: (source: SourceApi) => void = () => {}
let source = new Promise<SourceApi>((resolve) => {
  resolveSource = resolve
})

export const setSource = (next: SourceApi) => {
  resolveSource(next)
  source = Promise.resolve(next)
}

const callSource = async <Result>(call: (api: SourceApi) => Promise<Result>, retry = true) => {
  try {
    const current = await Promise.race([
      source,
      startEngine().then((next) => {
        setSource(next)
        return next
      }),
    ])
    return await call(current)
  } catch (error) {
    if (!(error instanceof Error && error.message.startsWith('yt-client:'))) throw error
    const next = await startEngine()
    setSource(next)
    if (!retry) {
      throw new Error(`youtube: continuation expired after engine restart (${error.message})`, { cause: error })
    }
    return call(next)
  }
}

const cursorArgument = SOURCE_CURSOR_ARGUMENT as Partial<Record<SourceMethod, number>>

// Replayability comes from SOURCE_REPLAY rather than a default, so a write can never be replayed into a duplicate like or subscribe
const replayable = (method: SourceMethod, args: unknown[]) => {
  const policy = SOURCE_REPLAY[method]
  if (policy !== 'unless-cursor') return policy === 'always'
  const cursor = cursorArgument[method]
  return cursor === undefined || args[cursor] === undefined
}

export const sourceApi = Object.fromEntries(
  SOURCE_METHODS.map((method) => [method, (...args: unknown[]) => callSource(
    (api) => (api[method] as (...call: unknown[]) => Promise<unknown>)(...args),
    replayable(method, args),
  )]),
) as SourceApi

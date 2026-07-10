export type SourceBufferQueue = {
  append(data: BufferSource, generation: number): Promise<void>
  abort(): void
  clear(generation: number): Promise<void>
  dispose(): void
}

const waitForUpdate = (sourceBuffer: SourceBuffer) => new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => {
    cleanup()
    if (sourceBuffer.updating) sourceBuffer.abort()
    reject(new Error('player: SourceBuffer update timed out'))
  }, 8_000)
  const cleanup = () => {
    clearTimeout(timeout)
    sourceBuffer.removeEventListener('updateend', complete)
    sourceBuffer.removeEventListener('abort', complete)
    sourceBuffer.removeEventListener('error', fail)
  }
  const complete = () => {
    cleanup()
    resolve()
  }
  const fail = () => {
    cleanup()
    reject(new Error('player: SourceBuffer update failed'))
  }
  sourceBuffer.addEventListener('updateend', complete, { once: true })
  sourceBuffer.addEventListener('abort', complete, { once: true })
  sourceBuffer.addEventListener('error', fail, { once: true })
})

export const createSourceBufferQueue = (
  sourceBuffer: SourceBuffer,
  currentGeneration: () => number,
): SourceBufferQueue => {
  let chain: Promise<unknown> = Promise.resolve()
  let disposed = false
  const enqueue = (generation: number, task: () => Promise<void>) => {
    const run = chain.then(async () => {
      if (disposed || generation !== currentGeneration()) return
      await task()
    }, async () => {
      if (disposed || generation !== currentGeneration()) return
      await task()
    })
    chain = run.catch(() => {})
    return run
  }
  return {
    append: (data, generation) => enqueue(generation, async () => {
      sourceBuffer.appendBuffer(data)
      await waitForUpdate(sourceBuffer)
    }),
    abort: () => {
      if (sourceBuffer.updating) sourceBuffer.abort()
    },
    clear: (generation) => enqueue(generation, async () => {
      if (sourceBuffer.updating) sourceBuffer.abort()
      if (!sourceBuffer.buffered.length) return
      sourceBuffer.remove(0, sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1))
      await waitForUpdate(sourceBuffer)
    }),
    dispose: () => {
      disposed = true
      if (sourceBuffer.updating) sourceBuffer.abort()
    },
  }
}

export const bufferedAhead = (sourceBuffer: SourceBuffer, currentTime: number) => {
  for (let index = 0; index < sourceBuffer.buffered.length; index += 1) {
    const start = sourceBuffer.buffered.start(index)
    const end = sourceBuffer.buffered.end(index)
    if (currentTime >= start - 0.1 && currentTime <= end) return Math.max(0, end - currentTime)
  }
  return 0
}

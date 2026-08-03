import type { WorkerApi } from './worker/yoga'

import { expose } from 'osra'

import Worker from './worker/index?worker'
import { sourceApi } from './sources/runtime'

const worker = new Worker()

expose(sourceApi, {
  key: 'source',
  transport: worker,
})

// No top-level await: the handshake must not delay first render or the engine frame boot
const workerApi = expose<WorkerApi>({}, {
  key: 'graphql',
  transport: worker,
})

export const handleRequest = async (
  ...args: Parameters<WorkerApi['handleRequest']>
): Promise<Awaited<ReturnType<WorkerApi['handleRequest']>>> => (await workerApi).handleRequest(...args)

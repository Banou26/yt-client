import type { WorkerApi } from './worker/yoga'

import { expose } from 'osra'

import Worker from './worker/index?worker'
import { sourceApi } from './sources/runtime'

const worker = new Worker()

expose(sourceApi, {
  key: 'source',
  transport: worker,
})

export const { handleRequest } = await expose<WorkerApi>({}, {
  key: 'graphql',
  transport: worker,
})

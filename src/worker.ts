import type { WorkerApi } from './worker/yoga'

import { expose } from 'osra'

import Worker from './worker/index?worker'

const worker = new Worker()

export const { handleRequest } = await expose<WorkerApi>({}, {
  key: 'graphql',
  transport: worker,
})

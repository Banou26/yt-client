import type { YogaInitialContext } from 'graphql-yoga'
import type { SourceApi } from '../sources/types'

import { createSchema, createYoga } from 'graphql-yoga'
import { expose } from 'osra'

import typeDefs from './schema.gql?raw'
import { resolvers } from './resolvers'

type UserContext = {
  source: SourceApi
}

export type ServerContext = YogaInitialContext & UserContext

const source = await expose<SourceApi>({}, {
  key: 'source',
  transport: globalThis,
})

const yoga = createYoga<UserContext>({
  graphqlEndpoint: '/graphql',
  maskedErrors: false,
  schema: createSchema({ typeDefs, resolvers }),
})

const api = {
  handleRequest: (input: RequestInfo | URL, init?: RequestInit) =>
    yoga.handleRequest(new Request(input, init), { source }),
}

export type WorkerApi = typeof api

expose(api, {
  key: 'graphql',
  transport: globalThis,
})

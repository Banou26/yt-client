import type { YogaInitialContext } from 'graphql-yoga'

import { createSchema, createYoga } from 'graphql-yoga'
import { expose } from 'osra'

import typeDefs from './schema.gql?raw'
import { resolvers } from './resolvers'

export type ServerContext = YogaInitialContext

const yoga = createYoga({
  graphqlEndpoint: '/graphql',
  maskedErrors: false,
  schema: createSchema({ typeDefs, resolvers }),
})

const api = {
  handleRequest: (input: RequestInfo | URL, init?: RequestInit) =>
    yoga.handleRequest(new Request(input, init), {}),
}

export type WorkerApi = typeof api

expose(api, {
  key: 'graphql',
  transport: globalThis,
})

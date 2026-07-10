import { Client, cacheExchange, fetchExchange } from 'urql'

import { handleRequest } from './worker'

export const client = new Client({
  url: 'http://yt-client.local/graphql',
  exchanges: [cacheExchange, fetchExchange],
  fetch: (input, init) => handleRequest(input, init),
})

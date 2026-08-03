importScripts('/__yt_scramjet__/controller/controller.sw.js')

// Firefox returns undefined for the FetchEvent request `body` getter, so a body-bearing request is pre-read and passed to route() as an ArrayBuffer
const BODYLESS_METHODS = new Set(['GET', 'HEAD'])

const routeWithBody = async (event) => {
  const request = event.request
  let body = null
  try {
    const buffer = await request.clone().arrayBuffer()
    if (buffer.byteLength) body = buffer
  } catch {}
  if (body === null) return $scramjetController.route(event)
  return $scramjetController.route({
    request: {
      url: request.url,
      referrer: request.referrer,
      destination: request.destination,
      mode: request.mode,
      method: request.method,
      body,
      cache: request.cache,
      headers: request.headers,
    },
    clientId: event.clientId,
    resultingClientId: event.resultingClientId,
  })
}

self.addEventListener('fetch', (event) => {
  if (!$scramjetController.shouldRoute(event)) return
  const request = event.request
  if (BODYLESS_METHODS.has(request.method) || request.body != null) {
    event.respondWith($scramjetController.route(event))
    return
  }
  event.respondWith(routeWithBody(event))
})

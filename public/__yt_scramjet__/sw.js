importScripts('/__yt_scramjet__/controller/controller.sw.js')

// Firefox never implemented the FetchEvent request `body` ReadableStream getter
// (it returns undefined), so the scramjet controller forwards no body for
// POST/PUT/PATCH — login form submissions and youtubei POSTs reach the server
// empty. The body is still readable via the consuming methods, so pre-read it
// and hand route() a shim event carrying an ArrayBuffer body (the shape route()
// already transfers). Chromium exposes request.body as a stream, so it takes
// the untouched fast path and is unaffected.
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
  // Fast path: bodyless methods, or a browser (Chromium) that already exposes
  // the body stream. Only a body-bearing method with a missing body needs the
  // Firefox recovery.
  if (BODYLESS_METHODS.has(request.method) || request.body != null) {
    event.respondWith($scramjetController.route(event))
    return
  }
  event.respondWith(routeWithBody(event))
})

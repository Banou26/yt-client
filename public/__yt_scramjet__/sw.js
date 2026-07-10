importScripts('/__yt_scramjet__/controller/controller.sw.js')

self.addEventListener('fetch', (event) => {
  if ($scramjetController.shouldRoute(event)) event.respondWith($scramjetController.route(event))
})

import type { EgressApi } from './protocol'

import { relayWorker } from '@fkn/lib'
import { defaultConfigDev } from '@mercuryworkshop/scramjet'
import { Tap } from '@mercuryworkshop/scramjet'
import { Controller } from '@mercuryworkshop/scramjet-controller'
import { expose } from 'osra'

import { EGRESS_KEY, ENGINE_READY } from './protocol'
import { FRAME_CONNECT, FRAME_READY } from '../frame/protocol'
import { createWebvpnTransport } from './webvpn-transport'

const waitForWorker = async (registration: ServiceWorkerRegistration) => {
  if (registration.active) return registration.active
  await new Promise<void>((resolve) => {
    const worker = registration.installing ?? registration.waiting
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'activated') resolve()
    })
  })
  if (!registration.active) throw new Error('yt-client: Scramjet service worker did not activate')
  return registration.active
}

const boot = async () => {
  const registration = await navigator.serviceWorker.register('/__yt_scramjet__/sw.js', {
    scope: '/__yt_scramjet__/',
    type: 'classic',
    updateViaCache: 'none',
  })
  const serviceworker = await waitForWorker(registration)
  const worker = new Worker(new URL('./egress.worker.ts', import.meta.url), { type: 'module' })
  const relayAbort = new AbortController()
  relayWorker(worker, { unregisterSignal: relayAbort.signal })

  const channel = new MessageChannel()
  worker.postMessage({ type: EGRESS_KEY, port: channel.port1 }, [channel.port1])
  channel.port2.start()
  const remote = expose<EgressApi>({}, {
    key: EGRESS_KEY,
    transport: { receive: channel.port2, emit: channel.port2 },
  })
  const transport = createWebvpnTransport(remote)
  await transport.init()
  await (await remote).prewarm('www.youtube.com')

  const controller = new Controller({
    serviceworker,
    transport,
    config: {
      prefix: '/__yt_scramjet__/proxy/',
      scramjetPath: '/__yt_scramjet__/scramjet/scramjet.js',
      injectPath: '/__yt_scramjet__/controller/controller.inject.js',
      wasmPath: '/__yt_scramjet__/scramjet/scramjet.wasm',
      virtualWasmPath: 'scramjet.wasm.js',
    },
    scramjetConfig: defaultConfigDev,
  })
  await controller.wait()

  const frame = document.createElement('iframe')
  frame.hidden = true
  frame.setAttribute('allow', 'autoplay; encrypted-media')
  document.body.appendChild(frame)
  const proxiedFrame = controller.createFrame(frame)
  const frameCode = await fetch('/__yt_scramjet__/youtube-frame.js').then((response) => response.text())
  Tap.tap(proxiedFrame.hooks.init.post, (context) => {
    if (!context.isTopLevel) return
    context.window.eval(frameCode)
    const apiChannel = new MessageChannel()
    apiChannel.port2.start()
    apiChannel.port2.addEventListener('message', function ready(event) {
      if (event.data?.type !== FRAME_READY) return
      apiChannel.port2.removeEventListener('message', ready)
      window.parent.postMessage({ type: ENGINE_READY }, location.origin, [apiChannel.port2])
    })
    context.window.postMessage({ type: FRAME_CONNECT }, '*', [apiChannel.port1])
  })
  proxiedFrame.go('https://www.youtube.com/embed/dQw4w9WgXcQ')
  window.addEventListener('pagehide', () => {
    relayAbort.abort()
    channel.port2.close()
    worker.terminate()
  }, { once: true })

  return { controller, frame: proxiedFrame }
}

void boot().catch((error) => {
  window.parent.postMessage({
    type: ENGINE_READY,
    error: error instanceof Error ? error.message : String(error),
  }, location.origin)
})

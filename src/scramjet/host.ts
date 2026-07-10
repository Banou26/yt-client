import type { EgressApi } from './protocol'
import type { FrameEgressRequest, FrameEgressResponse } from '../frame/protocol'

import { defaultConfigDev } from '@mercuryworkshop/scramjet'
import { Tap } from '@mercuryworkshop/scramjet'
import { Controller } from '@mercuryworkshop/scramjet-controller'
import { expose } from 'osra'

import { EGRESS_KEY, ENGINE_READY } from './protocol'
import { FRAME_CONNECT, FRAME_EGRESS_CONNECT } from '../frame/protocol'
import { createFknTransport } from './fkn-transport'

type FrameWindow = Window & {
  [FRAME_CONNECT]?: (port: MessagePort) => void
  [FRAME_EGRESS_CONNECT]?: (port: MessagePort) => void
  $scramerr?: (error: unknown) => void
}

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

const stage = (value: string) => {
  document.documentElement.dataset.stage = value
}

const loadBroker = async () => {
  const frame = document.createElement('iframe')
  frame.src = 'https://fkn.app/api'
  const loaded = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('yt-client: FKN broker load timed out')), 15_000)
    frame.addEventListener('load', () => {
      clearTimeout(timeout)
      resolve()
    }, { once: true })
    frame.addEventListener('error', () => {
      clearTimeout(timeout)
      reject(new Error('yt-client: FKN broker failed to load'))
    }, { once: true })
  })
  document.body.appendChild(frame)
  await loaded
}

const boot = async () => {
  stage('service-worker')
  const registration = await navigator.serviceWorker.register('/__yt_scramjet__/sw.js', {
    scope: '/__yt_scramjet__/',
    type: 'classic',
    updateViaCache: 'none',
  })
  const serviceworker = await waitForWorker(registration)
  stage('egress-worker')
  const worker = new Worker(new URL('./egress.worker.ts', import.meta.url), { type: 'module' })
  const relayAbort = new AbortController()
  await loadBroker()
  const { relayWorker } = await import('@fkn/lib')
  relayWorker(worker, { unregisterSignal: relayAbort.signal })

  const channel = new MessageChannel()
  worker.postMessage({ type: EGRESS_KEY, port: channel.port1 }, [channel.port1])
  channel.port2.start()
  const remote = expose<EgressApi>({}, {
    key: EGRESS_KEY,
    transport: { receive: channel.port2, emit: channel.port2 },
  })
  const transport = createFknTransport(remote)
  await transport.init()

  stage('controller')
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
  stage('frame')

  const frame = document.createElement('iframe')
  frame.hidden = true
  frame.setAttribute('allow', 'autoplay; encrypted-media')
  document.body.appendChild(frame)
  const proxiedFrame = controller.createFrame(frame)
  let frameEgressPort: MessagePort | undefined
  const frameCode = await fetch('/__yt_scramjet__/youtube-frame.js').then((response) => response.text())
  Tap.tap(proxiedFrame.hooks.init.post, (context) => {
    if (!context.isTopLevel) return
    const run = context.client.natives.call('Function', null, frameCode)
    run()
    stage('frame-code')
    const apiChannel = new MessageChannel()
    const frameWindow = context.window as FrameWindow
    frameWindow.$scramerr = () => {}
    const egressChannel = new MessageChannel()
    frameEgressPort = egressChannel.port2
    egressChannel.port2.addEventListener('message', (event) => {
      const request = event.data as FrameEgressRequest
      const egressRequestId = `frame:${proxiedFrame.id}:${request.id}`
      if (request.type === 'cancel') {
        void remote.then((api) => api.cancelLibcurlFetch(egressRequestId)).catch(() => {})
        return
      }
      void remote.then((api) => api.libcurlFetch(egressRequestId, request.url, request.options)).then(
        (response) => {
          const message = { id: request.id, response } satisfies FrameEgressResponse
          egressChannel.port2.postMessage(message, response.body ? [response.body] : [])
        },
        (error) => {
          egressChannel.port2.postMessage({
            id: request.id,
            error: error instanceof Error ? error.message : String(error),
          } satisfies FrameEgressResponse)
        },
      )
    })
    egressChannel.port2.start()
    const connectEgress = frameWindow[FRAME_EGRESS_CONNECT]
    if (!connectEgress) throw new Error('yt-client: frame egress connector is missing')
    delete frameWindow[FRAME_EGRESS_CONNECT]
    connectEgress(egressChannel.port1)
    const connect = frameWindow[FRAME_CONNECT]
    if (!connect) throw new Error('yt-client: frame connector is missing')
    delete frameWindow[FRAME_CONNECT]
    connect(apiChannel.port1)
    stage('frame-connected')
    window.parent.postMessage({ type: ENGINE_READY }, location.origin, [apiChannel.port2])
    stage('frame-posted')
  })
  proxiedFrame.go('https://www.youtube.com/oops')
  window.addEventListener('pagehide', () => {
    relayAbort.abort()
    channel.port2.close()
    frameEgressPort?.close()
    worker.terminate()
  }, { once: true })

  return { controller, frame: proxiedFrame }
}

void boot().catch((error) => {
  stage('error')
  window.parent.postMessage({
    type: ENGINE_READY,
    error: error instanceof Error ? error.message : String(error),
  }, location.origin)
})

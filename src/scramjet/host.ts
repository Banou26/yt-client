import type { EgressApi, HostControlEvent, HostControlRequest } from './protocol'
import type { FrameEgressRequest, FrameEgressResponse } from '../frame/protocol'

import { defaultConfigDev } from '@mercuryworkshop/scramjet'
import { Tap } from '@mercuryworkshop/scramjet'
import { Controller } from '@mercuryworkshop/scramjet-controller'
import { expose } from 'osra'

import { CLEAR_COOKIES, CLOSE_SIGNIN, COOKIES_CLEARED, EGRESS_KEY, ENGINE_READY, OPEN_SIGNIN, SIGNIN_STATUS } from './protocol'
import { FRAME_CONNECT, FRAME_EGRESS_CONNECT } from '../frame/protocol'
import { createFknTransport, FRAME_BOOTSTRAP_URL } from './fkn-transport'

const SIGN_IN_URL = 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F&hl=en'

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
  frame.hidden = true
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
  // Every boot stage that depends on nothing starts immediately; awaits happen
  // only where a stage's result is consumed.
  stage('service-worker')
  const workerReady = navigator.serviceWorker.register('/__yt_scramjet__/sw.js', {
    scope: '/__yt_scramjet__/',
    type: 'classic',
    updateViaCache: 'none',
  }).then(waitForWorker)
  const worker = new Worker(new URL('./egress.worker.ts', import.meta.url), { type: 'module' })
  const relayAbort = new AbortController()
  const frameCodePromise = fetch('/__yt_scramjet__/youtube-frame.js').then((response) => response.text())
  const fknLib = import('@fkn/lib')
  stage('egress-worker')
  const transportReady = Promise.all([loadBroker(), fknLib]).then(async ([, { relayWorker }]) => {
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
    return { channel, remote, transport }
  })
  const [serviceworker, { channel, remote, transport }] = await Promise.all([workerReady, transportReady])

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

  let signInElement: HTMLIFrameElement | undefined
  let signInPoll: ReturnType<typeof setInterval> | undefined

  const signInComplete = (element: HTMLIFrameElement, prefix: string) => {
    // The proxied frame is same-origin: its path is the frame prefix plus the
    // codec-encoded target URL, so decode it to see whether the login flow has
    // navigated back to youtube.com.
    try {
      const path = element.contentWindow?.location.pathname ?? ''
      if (!path.startsWith(prefix)) return false
      if (!controller.config.codec.decode(path.slice(prefix.length)).startsWith('https://www.youtube.com/')) return false
    } catch {
      return false
    }
    const cookies = controller.cookieJar.getCookies(new URL('https://www.youtube.com/'), false) as string
    return /(?:^|;\s*)SAPISID=/.test(cookies)
  }

  const destroySignIn = () => {
    clearInterval(signInPoll)
    signInPoll = undefined
    const element = signInElement
    signInElement = undefined
    if (!element) return
    // The controller has no frame disposal API — drop it from the routing list
    // and remove the element.
    const index = controller.frames.findIndex((proxied) => proxied.element === element)
    if (index !== -1) controller.frames.splice(index, 1)
    element.remove()
  }

  const openSignIn = (port: MessagePort) => {
    if (signInElement) return
    // Least privilege: the login flow needs no permissions, and this frame is
    // the first place arbitrary rewritten Google JS runs on the app origin.
    const element = document.createElement('iframe')
    element.style.cssText = 'position: fixed; inset: 0; width: 100%; height: 100%; border: 0; background: #0f0f0f; z-index: 10;'
    document.body.appendChild(element)
    // Untapped frame — no youtube-frame.js injection, the real rewritten login
    // pages run against the shared cookie jar.
    const proxied = controller.createFrame(element)
    signInElement = element
    const check = () => {
      if (signInElement !== element || !signInComplete(element, proxied.prefix)) return
      port.postMessage({ type: SIGNIN_STATUS, signedIn: true } satisfies HostControlEvent)
      destroySignIn()
    }
    element.addEventListener('load', check)
    signInPoll = setInterval(check, 1_000)
    proxied.go(SIGN_IN_URL)
  }

  const clearCookies = async (id: number, port: MessagePort) => {
    // A reply must ALWAYS go back: sign-out treats a missing/failed clear as
    // fatal (the persisted jar still holds the identity), never as success.
    try {
      controller.cookieJar.clear()
      await controller.persistCookies()
      await controller.propagateCookieSync([], { clear: true }).catch(() => {})
      port.postMessage({ type: COOKIES_CLEARED, id } satisfies HostControlEvent)
    } catch (error) {
      port.postMessage({
        type: COOKIES_CLEARED,
        id,
        error: String((error as Error)?.message ?? error),
      } satisfies HostControlEvent)
    }
  }

  let controlPort: MessagePort | undefined
  const connectControl = () => {
    const channel = new MessageChannel()
    controlPort = channel.port1
    channel.port1.addEventListener('message', (event) => {
      const message = event.data as HostControlRequest
      if (message.type === OPEN_SIGNIN) openSignIn(channel.port1)
      else if (message.type === CLOSE_SIGNIN) destroySignIn()
      else if (message.type === CLEAR_COOKIES) void clearCookies(message.id, channel.port1)
    })
    channel.port1.start()
    return channel
  }

  const frame = document.createElement('iframe')
  frame.hidden = true
  frame.setAttribute('allow', 'autoplay; encrypted-media')
  document.body.appendChild(frame)
  const proxiedFrame = controller.createFrame(frame)
  let frameEgressPort: MessagePort | undefined
  const frameCode = await frameCodePromise
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
    const controlChannel = connectControl()
    window.parent.postMessage({ type: ENGINE_READY }, location.origin, [apiChannel.port2, controlChannel.port2])
    stage('frame-posted')
  })
  proxiedFrame.go(FRAME_BOOTSTRAP_URL)
  window.addEventListener('pagehide', () => {
    relayAbort.abort()
    channel.port2.close()
    frameEgressPort?.close()
    controlPort?.close()
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

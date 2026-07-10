import type { FrameApi } from '../frame/protocol'

import { expose } from 'osra'

import { FRAME_CONNECT } from '../frame/protocol'
import { ENGINE_READY } from './protocol'

let engine: Promise<FrameApi> | undefined

export const startEngine = () => (engine ??= new Promise((resolve, reject) => {
  const frame = document.createElement('iframe')
  frame.hidden = true
  frame.src = '/__yt_scramjet__/host.html'
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.type !== ENGINE_READY) return
    window.removeEventListener('message', onMessage)
    if (event.data.error) {
      reject(new Error(event.data.error))
      return
    }
    const port = event.ports[0]
    if (!port) {
      reject(new Error('yt-client: frame API port is missing'))
      return
    }
    port.start()
    resolve(expose<FrameApi>({}, {
      key: FRAME_CONNECT,
      transport: { receive: port, emit: port },
    }))
  }
  window.addEventListener('message', onMessage)
  document.body.appendChild(frame)
}))

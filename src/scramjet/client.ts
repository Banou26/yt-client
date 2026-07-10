import { ENGINE_READY } from './protocol'

let engine: Promise<HTMLIFrameElement> | undefined

export const startEngine = () => (engine ??= new Promise((resolve, reject) => {
  const frame = document.createElement('iframe')
  frame.hidden = true
  frame.src = '/__yt_scramjet__/host.html'
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.type !== ENGINE_READY) return
    window.removeEventListener('message', onMessage)
    if (event.data.error) reject(new Error(event.data.error))
    else resolve(frame)
  }
  window.addEventListener('message', onMessage)
  document.body.appendChild(frame)
}))

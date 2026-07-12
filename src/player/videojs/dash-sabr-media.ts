import { DashMedia } from '@videojs/core/dom/media/dash'

import { startEngine } from '../../scramjet/client'
import { setSource } from '../../sources/runtime'
import { startDashPlayback } from '../dashjs'

// HTMLVideoElementHost isn't a public export; reach it as DashMedia's base class
// (same trick heimdall's ShakaMedia uses). It provides target/attach/detach.
const HostBase = Object.getPrototypeOf(DashMedia) as new () => {
  target: HTMLVideoElement | null
  attach(target: HTMLVideoElement): void
  detach(): void
}

export const dashSabrMediaDefaultProps = {
  src: '',
  startTime: undefined as number | undefined,
  onError: undefined as ((error: unknown) => void) | undefined,
}

// A @videojs/core v10 media engine that plays yt-client's SABR-via-frame stream
// through dash.js — the whole load path is src/player/dashjs.ts's startDashPlayback
// (openPlayback → SegmentTemplate → dash.js + request interceptor → FrameApi). `src`
// is a YouTube videoId; the engine fetches the session and drives dash.js itself.
export class DashSabrMedia extends HostBase {
  #controller?: Awaited<ReturnType<typeof startDashPlayback>>
  #abort?: AbortController
  #src = ''
  #error?: Error
  #loading = false
  startTime?: number
  onError?: (error: unknown) => void

  get engine() {
    return this.#controller?.player
  }

  get error() {
    return this.#error
  }

  get src() {
    return this.#src
  }

  set src(videoId: string) {
    if (videoId === this.#src) return
    this.#teardown()
    this.#src = videoId
    this.#maybeLoad()
  }

  attach(target: HTMLVideoElement) {
    super.attach(target)
    this.#maybeLoad()
  }

  detach() {
    this.#teardown()
    super.detach()
  }

  destroy() {
    this.#teardown()
  }

  #teardown() {
    this.#abort?.abort()
    this.#abort = undefined
    this.#controller = undefined
    this.#loading = false
    this.#error = undefined
  }

  #maybeLoad() {
    if (this.#loading || !this.target || !this.#src) return
    this.#loading = true
    this.#error = undefined
    const video = this.target
    const videoId = this.#src
    const abort = new AbortController()
    this.#abort = abort
    void (async () => {
      const api = await startEngine()
      setSource(api)
      if (abort.signal.aborted) return
      this.#controller = await startDashPlayback({
        api,
        video,
        videoId,
        startTime: this.startTime ?? 0,
        signal: abort.signal,
        onError: (error) => {
          this.#error = error instanceof Error ? error : new Error(String(error))
          this.onError?.(error)
        },
      })
    })().catch((error) => {
      this.#loading = false
      this.#error = error instanceof Error ? error : new Error(String(error))
      this.onError?.(error)
    })
  }
}

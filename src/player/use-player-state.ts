import type shaka from 'shaka-player'

import { useEffect, useState } from 'preact/hooks'

export type PlayerState = {
  paused: boolean
  ended: boolean
  currentTime: number
  duration: number
  buffered: number
  volume: number
  muted: boolean
  playbackRate: number
  buffering: boolean
  seeking: boolean
}

const EMPTY: PlayerState = {
  paused: true,
  ended: false,
  currentTime: 0,
  duration: 0,
  buffered: 0,
  volume: 1,
  muted: false,
  playbackRate: 1,
  buffering: false,
  seeking: false,
}

const read = (video: HTMLVideoElement, buffering: boolean): PlayerState => ({
  paused: video.paused,
  ended: video.ended,
  currentTime: video.currentTime,
  duration: Number.isFinite(video.duration) ? video.duration : 0,
  buffered: video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : 0,
  volume: video.volume,
  muted: video.muted,
  playbackRate: video.playbackRate,
  buffering,
  seeking: video.seeking,
})

// timeupdate fires about four times a second, too coarse to track the playhead smoothly
export const usePlayerState = (video: HTMLVideoElement | null, player: shaka.Player | undefined) => {
  const [state, setState] = useState<PlayerState>(EMPTY)

  useEffect(() => {
    if (!video) return
    let buffering = false
    let frame = 0
    let running = true

    const sync = () => setState(read(video, buffering))

    const tick = () => {
      if (!running) return
      if (!video.paused || video.seeking) sync()
      frame = requestAnimationFrame(tick)
    }

    const onBuffering = (event: Event) => {
      buffering = Boolean((event as Event & { buffering?: boolean }).buffering)
      sync()
    }

    const events = ['play', 'pause', 'ended', 'seeking', 'seeked', 'volumechange', 'ratechange', 'durationchange', 'loadedmetadata', 'progress', 'timeupdate', 'emptied']
    for (const event of events) video.addEventListener(event, sync)
    player?.addEventListener('buffering', onBuffering)
    sync()
    frame = requestAnimationFrame(tick)

    return () => {
      running = false
      cancelAnimationFrame(frame)
      for (const event of events) video.removeEventListener(event, sync)
      player?.removeEventListener('buffering', onBuffering)
    }
  }, [video, player])

  return state
}

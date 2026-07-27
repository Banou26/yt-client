import type shaka from 'shaka-player'

import { css } from '@emotion/react'
import { Check, Maximize, Minimize, Pause, Play, Settings, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

import type { PlayerState } from './use-player-state'

import { MenuItem, Popup, useDismiss } from '../components/ui/popup'
import { updateSettings } from '../settings'

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

export const clock = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`
}

const style = css`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 0 1.2rem 0.8rem;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
  color: #ffffff;
  opacity: 0;
  transition: opacity 0.2s ease;
  pointer-events: none;

  &.visible {
    opacity: 1;
    pointer-events: auto;
  }

  .scrubber {
    position: relative;
    height: 1.6rem;
    display: flex;
    align-items: center;
    cursor: pointer;
    touch-action: none;
  }

  .rail {
    position: relative;
    width: 100%;
    height: 0.3rem;
    background: rgba(255, 255, 255, 0.3);
    transition: height 0.1s ease;
  }

  .scrubber:hover .rail,
  .scrubber.scrubbing .rail {
    height: 0.5rem;
  }

  .buffered,
  .played {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
  }

  .buffered {
    background: rgba(255, 255, 255, 0.45);
  }

  .played {
    background: var(--brand);
  }

  .knob {
    position: absolute;
    top: 50%;
    width: 1.3rem;
    height: 1.3rem;
    margin-left: -0.65rem;
    border-radius: 50%;
    background: var(--brand);
    transform: translateY(-50%) scale(0);
    transition: transform 0.1s ease;
  }

  .scrubber:hover .knob,
  .scrubber.scrubbing .knob {
    transform: translateY(-50%) scale(1);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    height: 4.8rem;
  }

  .spacer {
    flex: 1;
  }

  .control {
    flex: none;
    width: 4rem;
    height: 4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: #ffffff;
    cursor: pointer;
    opacity: 0.9;
    transition: opacity 0.1s ease;
  }

  .control:hover {
    opacity: 1;
  }

  .volume {
    display: flex;
    align-items: center;
  }

  .volume-slider {
    width: 0;
    overflow: hidden;
    transition: width 0.2s ease, margin 0.2s ease;
  }

  .volume:hover .volume-slider,
  .volume:focus-within .volume-slider {
    width: 7.2rem;
    margin-right: 0.8rem;
  }

  .volume-slider input {
    width: 7.2rem;
    accent-color: #ffffff;
    cursor: pointer;
  }

  .time {
    padding: 0 0.8rem;
    font-size: 1.3rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .menu-anchor {
    position: relative;
  }

  .settings-menu {
    bottom: calc(100% + 0.8rem);
    top: auto;
  }
`

type ControlsProps = {
  video: HTMLVideoElement
  player: shaka.Player | undefined
  state: PlayerState
  heights: number[]
  quality: 'auto' | number
  onQuality: (value: 'auto' | number) => void
  theater: boolean
  onTheater: () => void
  onNext?: () => void
  visible: boolean
}

export const PlayerControls = (
  { video, state, heights, quality, onQuality, theater, onTheater, onNext, visible }: ControlsProps,
) => {
  const [scrubbing, setScrubbing] = useState(false)
  const [preview, setPreview] = useState<number | undefined>(undefined)
  const [menu, setMenu] = useState<'root' | 'quality' | 'speed' | undefined>(undefined)
  const railRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const [fullscreen, setFullscreen] = useState(false)

  const closeMenu = useCallback(() => setMenu(undefined), [])
  useDismiss({ open: menu !== undefined, onClose: closeMenu, rootRef: menuRef, triggerRef: menuTriggerRef })

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', onChange)
    onChange()
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const duration = state.duration
  const position = preview ?? state.currentTime
  const played = duration > 0 ? Math.min(1, position / duration) : 0
  const buffered = duration > 0 ? Math.min(1, state.buffered / duration) : 0

  const timeAt = (clientX: number) => {
    const rail = railRef.current
    if (!rail || duration <= 0) return 0
    const box = rail.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * duration
  }

  // Pointer capture keeps the drag alive when the cursor leaves the rail, which
  // is the normal way people scrub.
  const onPointerDown = (event: PointerEvent) => {
    if (duration <= 0) return
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    setScrubbing(true)
    setPreview(timeAt(event.clientX))
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!scrubbing) return
    setPreview(timeAt(event.clientX))
  }

  const onPointerUp = (event: PointerEvent) => {
    if (!scrubbing) return
    const target = event.currentTarget as HTMLElement
    target.releasePointerCapture(event.pointerId)
    video.currentTime = timeAt(event.clientX)
    setScrubbing(false)
    setPreview(undefined)
  }

  const onVolume = (event: Event) => {
    const value = Number((event.currentTarget as HTMLInputElement).value)
    video.volume = value
    video.muted = value === 0
    updateSettings({ volume: value, muted: video.muted })
  }

  const toggleMute = () => {
    const muted = !video.muted
    video.muted = muted
    // Unmuting from a zero volume is a dead click otherwise.
    if (!muted && video.volume === 0) video.volume = 0.5
    updateSettings({ muted, volume: video.volume })
  }

  const onRate = (rate: number) => {
    video.playbackRate = rate
    updateSettings({ playbackRate: rate })
    setMenu(undefined)
  }

  const toggleFullscreen = () => {
    const container = video.closest('[data-player-root]')
    if (!document.fullscreenElement) void container?.requestFullscreen().catch(() => {})
    else void document.exitFullscreen().catch(() => {})
  }

  const VolumeIcon = state.muted || state.volume === 0 ? VolumeX : state.volume < 0.5 ? Volume1 : Volume2
  // The decoded height is what is actually on screen, which is more honest than
  // whichever variant Shaka currently has selected.
  const activeLabel = video.videoHeight > 0 ? `${video.videoHeight}p` : undefined

  return (
    <div css={style} className={visible || scrubbing || menu !== undefined ? 'visible' : undefined}>
      <div
        className={scrubbing ? 'scrubber scrubbing' : 'scrubber'}
        role='slider'
        aria-label='Seek'
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(position)}
        aria-valuetext={clock(position)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className='rail' ref={railRef}>
          <div className='buffered' style={{ width: `${buffered * 100}%` }} />
          <div className='played' style={{ width: `${played * 100}%` }} />
          <div className='knob' style={{ left: `${played * 100}%` }} />
        </div>
      </div>
      <div className='bar'>
        <button type='button' className='control' aria-label={state.paused ? 'Play' : 'Pause'} onClick={() => (state.paused ? void video.play().catch(() => {}) : video.pause())}>
          {state.paused ? <Play size={26} fill='currentColor' strokeWidth={0} /> : <Pause size={26} fill='currentColor' strokeWidth={0} />}
        </button>
        {onNext ? <button type='button' className='control' aria-label='Next' onClick={onNext}><SkipForward size={24} fill='currentColor' strokeWidth={0} /></button> : undefined}
        <div className='volume'>
          <button type='button' className='control' aria-label={state.muted ? 'Unmute' : 'Mute'} onClick={toggleMute}>
            <VolumeIcon size={24} strokeWidth={1.8} />
          </button>
          <div className='volume-slider'>
            <input
              type='range'
              min={0}
              max={1}
              step={0.05}
              value={state.muted ? 0 : state.volume}
              aria-label='Volume'
              onInput={onVolume}
            />
          </div>
        </div>
        <span className='time'>{clock(position)} / {clock(duration)}</span>
        <span className='spacer' />
        <div className='menu-anchor' ref={menuRef}>
          <button
            ref={menuTriggerRef}
            type='button'
            className='control'
            aria-label='Settings'
            aria-haspopup='menu'
            aria-expanded={menu !== undefined}
            onClick={() => setMenu(value => (value === undefined ? 'root' : undefined))}
          >
            <Settings size={24} strokeWidth={1.8} />
          </button>
          {menu === 'root'
            ? (
              <Popup label='Player settings' class='settings-menu'>
                <MenuItem detail={state.playbackRate === 1 ? 'Normal' : `${state.playbackRate}x`} onSelect={() => setMenu('speed')}>
                  Playback speed
                </MenuItem>
                <MenuItem
                  detail={quality === 'auto' ? `Auto${activeLabel ? ` (${activeLabel})` : ''}` : `${quality}p`}
                  disabled={heights.length === 0}
                  onSelect={() => setMenu('quality')}
                >
                  Quality
                </MenuItem>
              </Popup>
            )
            : menu === 'speed'
              ? (
                <Popup label='Playback speed' class='settings-menu'>
                  {RATES.map(rate => (
                    <MenuItem key={rate} icon={rate === state.playbackRate ? Check : undefined} onSelect={() => onRate(rate)}>
                      {rate === 1 ? 'Normal' : `${rate}x`}
                    </MenuItem>
                  ))}
                </Popup>
              )
              : menu === 'quality'
                ? (
                  <Popup label='Quality' class='settings-menu'>
                    <MenuItem
                      icon={quality === 'auto' ? Check : undefined}
                      detail={activeLabel}
                      onSelect={() => {
                        onQuality('auto')
                        setMenu(undefined)
                      }}
                    >
                      Auto
                    </MenuItem>
                    {heights.map(height => (
                      <MenuItem
                        key={height}
                        icon={quality === height ? Check : undefined}
                        onSelect={() => {
                          onQuality(height)
                          setMenu(undefined)
                        }}
                      >
                        {`${height}p`}
                      </MenuItem>
                    ))}
                  </Popup>
                )
                : undefined}
        </div>
        <button type='button' className='control' aria-label='Theater mode' aria-pressed={theater} onClick={onTheater}>
          {/* Two nested rectangles read as "wide screen" without pulling in an icon set variant. */}
          <svg width='24' height='24' viewBox='0 0 24 24' aria-hidden='true' fill='none' stroke='currentColor' strokeWidth='1.8'>
            <rect x='2' y='6' width='20' height='12' rx='1.5' />
            {theater ? <rect x='6' y='9' width='12' height='6' rx='1' /> : undefined}
          </svg>
        </button>
        <button type='button' className='control' aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={toggleFullscreen}>
          {fullscreen ? <Minimize size={24} strokeWidth={1.8} /> : <Maximize size={24} strokeWidth={1.8} />}
        </button>
      </div>
    </div>
  )
}

export default PlayerControls

// Exported for the player shell so both agree on what counts as a text entry
// target and never steal a key from the search box.
export const isTypingTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null
  return Boolean(element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable))
}

export { RATES }

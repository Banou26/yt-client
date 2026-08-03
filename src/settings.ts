export type ThemePreference = 'device' | 'light' | 'dark'

export type QualityPreference = 'auto' | number

export type Settings = {
  theme: ThemePreference
  autoplay: boolean
  volume: number
  muted: boolean
  playbackRate: number
  // a ceiling on the video height, not an exact pick: ABR still moves below it
  quality: QualityPreference
  captionsEnabled: boolean
  captionsLanguage?: string
  theater: boolean
  guideCollapsed: boolean
  // off for good once dismissed: an offer that keeps coming back after being declined is an ad
  suggestExtension: boolean
  // a CACHE rather than a preference, and the live DOM signal always wins over it
  extensionSeen?: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  autoplay: true,
  volume: 1,
  muted: false,
  playbackRate: 1,
  quality: 'auto',
  captionsEnabled: false,
  theater: false,
  guideCollapsed: false,
  suggestExtension: true,
}

const STORAGE_KEY = 'yt-client:settings'

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

// storage is user-editable and survives across versions of this code, so one bad entry must not take out the whole store
const coerce = (stored: Partial<Record<keyof Settings, unknown>>): Settings => {
  const theme = stored.theme
  const quality = stored.quality
  const volume = stored.volume
  const playbackRate = stored.playbackRate
  const captionsLanguage = stored.captionsLanguage
  return {
    theme: theme === 'device' || theme === 'light' || theme === 'dark' ? theme : DEFAULT_SETTINGS.theme,
    autoplay: typeof stored.autoplay === 'boolean' ? stored.autoplay : DEFAULT_SETTINGS.autoplay,
    volume: typeof volume === 'number' && Number.isFinite(volume) ? clamp(volume, 0, 1) : DEFAULT_SETTINGS.volume,
    muted: typeof stored.muted === 'boolean' ? stored.muted : DEFAULT_SETTINGS.muted,
    playbackRate: typeof playbackRate === 'number' && Number.isFinite(playbackRate)
      ? clamp(playbackRate, 0.25, 4)
      : DEFAULT_SETTINGS.playbackRate,
    quality: quality === 'auto' || (typeof quality === 'number' && Number.isFinite(quality))
      ? quality
      : DEFAULT_SETTINGS.quality,
    captionsEnabled: typeof stored.captionsEnabled === 'boolean' ? stored.captionsEnabled : DEFAULT_SETTINGS.captionsEnabled,
    captionsLanguage: typeof captionsLanguage === 'string' ? captionsLanguage : undefined,
    theater: typeof stored.theater === 'boolean' ? stored.theater : DEFAULT_SETTINGS.theater,
    guideCollapsed: typeof stored.guideCollapsed === 'boolean' ? stored.guideCollapsed : DEFAULT_SETTINGS.guideCollapsed,
    suggestExtension: typeof stored.suggestExtension === 'boolean' ? stored.suggestExtension : DEFAULT_SETTINGS.suggestExtension,
    extensionSeen: typeof stored.extensionSeen === 'boolean' ? stored.extensionSeen : undefined,
  }
}

const read = (): Settings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SETTINGS }
    return coerce(parsed as Partial<Record<keyof Settings, unknown>>)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

let current = read()

const listeners = new Set<(settings: Settings) => void>()

export const getSettings = () => current

export const subscribeSettings = (listener: (settings: Settings) => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const updateSettings = (patch: Partial<Settings>) => {
  const next = { ...current, ...patch }
  current = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // storage unavailable (private mode, quota): the in-memory value still stands
  }
  for (const listener of listeners) listener(next)
  return next
}

const prefersLight = () => {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches
  } catch {
    return false
  }
}

export const resolveTheme = (preference: ThemePreference): 'light' | 'dark' =>
  preference === 'device' ? (prefersLight() ? 'light' : 'dark') : preference

const THEME_COLOR = { dark: '#0f0f0f', light: '#f9f9f9' }

export const applyTheme = (preference: ThemePreference = current.theme) => {
  const resolved = resolveTheme(preference)
  document.documentElement.dataset.theme = resolved
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[resolved])
  return resolved
}

export const watchDeviceTheme = () => {
  let media: MediaQueryList
  try {
    media = window.matchMedia('(prefers-color-scheme: light)')
  } catch {
    return () => {}
  }
  const onChange = () => {
    if (current.theme === 'device') applyTheme('device')
  }
  media.addEventListener('change', onChange)
  const unsubscribe = subscribeSettings((settings) => applyTheme(settings.theme))
  return () => {
    media.removeEventListener('change', onChange)
    unsubscribe()
  }
}

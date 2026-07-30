import type { QualityPreference, Settings, ThemePreference } from '../settings'

import { css } from '@emotion/react'
import { useEffect, useState } from 'preact/hooks'

import { useDocumentTitle } from '../app'
import { EXTENSION_URL, useExtensionExposed } from '../components/extension-notice'
import { getSettings, subscribeSettings, updateSettings } from '../settings'

/* Every field here already existed in the validated store and had no way to be
   read or changed: theme was applied at boot from a value nothing could set,
   and quality, autoplay and captions were declared and unreachable. This page
   is the missing half, not new state. */

const THEMES: { value: ThemePreference, label: string, detail: string }[] = [
  { value: 'device', label: 'Device theme', detail: 'Follow the system setting' },
  { value: 'dark', label: 'Dark', detail: 'Always dark' },
  { value: 'light', label: 'Light', detail: 'Always light' },
]

/* A CEILING rather than an exact pick. The exact representation may not exist
   for a given video, and ABR still moves below the cap on a slow connection, so
   a label like "1080p" promises "no higher than", which is what it does. */
const QUALITIES: { value: QualityPreference, label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 2160, label: '2160p' },
  { value: 1440, label: '1440p' },
  { value: 1080, label: '1080p' },
  { value: 720, label: '720p' },
  { value: 480, label: '480p' },
  { value: 360, label: '360p' },
  { value: 240, label: '240p' },
]

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

const style = css`
  max-width: 78rem;
  padding: 2.4rem 1.6rem;

  .heading {
    margin: 0 0 2.4rem;
    font-size: 2.4rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .section {
    padding: 2.4rem 0;
    border-top: 1px solid var(--border-subtle);
  }

  .section:first-of-type {
    border-top: none;
    padding-top: 0;
  }

  .section-title {
    margin: 0 0 0.4rem;
    font-size: 1.6rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .section-note {
    margin: 0 0 1.6rem;
    font-size: 1.3rem;
    color: var(--text-secondary);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.6rem;
    padding: 0.8rem 0;
  }

  .row-label {
    font-size: 1.4rem;
    color: var(--text-primary);
  }

  .row-detail {
    margin-top: 0.2rem;
    font-size: 1.2rem;
    color: var(--text-secondary);
  }

  .link {
    color: var(--accent);
  }

  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
  }

  .choice {
    height: 3.2rem;
    padding: 0 1.2rem;
    border: none;
    border-radius: 0.8rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-size: 1.3rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .choice:hover {
    background: var(--bg-chip-hover);
  }

  .choice.active {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  /* A native checkbox rather than a custom switch: it is already keyboard
     operable and announced correctly, and a switch would be styling for its
     own sake. */
  .toggle {
    width: 1.8rem;
    height: 1.8rem;
    accent-color: var(--accent);
  }
`

export const SettingsPage = () => {
  useDocumentTitle('Settings')
  const [settings, setSettings] = useState<Settings>(getSettings)
  const extension = useExtensionExposed()

  // The store is shared: the player writes volume and rate as they change, and
  // the guide writes its collapsed state, so this page follows the store rather
  // than owning a copy of it.
  useEffect(() => subscribeSettings(setSettings), [])

  const set = (patch: Partial<Settings>) => setSettings(updateSettings(patch))

  return (
    <main css={style}>
      <h1 className='heading'>Settings</h1>

      <section className='section'>
        <h2 className='section-title'>Appearance</h2>
        <p className='section-note'>Device theme follows your system setting and changes with it.</p>
        <div className='choices'>
          {THEMES.map(theme => (
            <button
              type='button'
              key={theme.value}
              className={settings.theme === theme.value ? 'choice active' : 'choice'}
              aria-pressed={settings.theme === theme.value}
              title={theme.detail}
              onClick={() => set({ theme: theme.value })}
            >
              {theme.label}
            </button>
          ))}
        </div>
      </section>

      <section className='section'>
        <h2 className='section-title'>Playback</h2>
        <p className='section-note'>
          Quality is a ceiling, not an exact pick: a video without that exact size plays the
          closest one below it, and playback still drops lower on a slow connection.
        </p>
        <div className='choices'>
          {QUALITIES.map(quality => (
            <button
              type='button'
              key={String(quality.value)}
              className={settings.quality === quality.value ? 'choice active' : 'choice'}
              aria-pressed={settings.quality === quality.value}
              onClick={() => set({ quality: quality.value })}
            >
              {quality.label}
            </button>
          ))}
        </div>
        <div className='row'>
          <div>
            <div className='row-label'>Autoplay</div>
            <div className='row-detail'>Start a video as soon as its page opens</div>
          </div>
          <input
            type='checkbox'
            className='toggle'
            aria-label='Autoplay'
            checked={settings.autoplay}
            onChange={() => set({ autoplay: !settings.autoplay })}
          />
        </div>
        <div className='row'>
          <div>
            <div className='row-label'>Theater mode</div>
            <div className='row-detail'>Open the watch page with the wide player</div>
          </div>
          <input
            type='checkbox'
            className='toggle'
            aria-label='Theater mode'
            checked={settings.theater}
            onChange={() => set({ theater: !settings.theater })}
          />
        </div>
      </section>

      <section className='section'>
        <h2 className='section-title'>Speed</h2>
        <p className='section-note'>Applied to every video as it starts. The player can still change it per video.</p>
        <div className='choices'>
          {RATES.map(rate => (
            <button
              type='button'
              key={rate}
              className={settings.playbackRate === rate ? 'choice active' : 'choice'}
              aria-pressed={settings.playbackRate === rate}
              onClick={() => set({ playbackRate: rate })}
            >
              {rate === 1 ? 'Normal' : `${rate}x`}
            </button>
          ))}
        </div>
      </section>

      <section className='section'>
        <h2 className='section-title'>Subtitles</h2>
        <p className='section-note'>
          Turn captions on by default where a video has them. Captions are not wired into the
          player yet, so this only records the preference.
        </p>
        <div className='row'>
          <div className='row-label'>Always show captions</div>
          <input
            type='checkbox'
            className='toggle'
            aria-label='Always show captions'
            checked={settings.captionsEnabled}
            onChange={() => set({ captionsEnabled: !settings.captionsEnabled })}
          />
        </div>
      </section>

      {/* The one place the header offer can be brought back, which is what makes
          dismissing it safe to be permanent. */}
      <section className='section'>
        <h2 className='section-title'>Connection</h2>
        <p className='section-note'>
          {extension === true
            ? 'The FKN extension is active, so requests reach YouTube straight from your browser.'
            : (
              <>
                Requests reach YouTube through the shared FKN relay, which adds a round trip to
                each one. The{' '}
                <a className='link' href={EXTENSION_URL} target='_blank' rel='noreferrer'>FKN extension</a>{' '}
                sends them straight from your browser instead, and the relay's daily allowance
                stops applying.
              </>
            )}
        </p>
        {extension === false
          ? (
            <div className='row'>
              <div>
                <div className='row-label'>Offer the extension in the header</div>
                <div className='row-detail'>Shows a single dismissible link, and never with the extension installed</div>
              </div>
              <input
                type='checkbox'
                className='toggle'
                aria-label='Offer the extension in the header'
                checked={settings.suggestExtension}
                onChange={() => set({ suggestExtension: !settings.suggestExtension })}
              />
            </div>
          )
          : undefined}
      </section>
    </main>
  )
}

export default SettingsPage

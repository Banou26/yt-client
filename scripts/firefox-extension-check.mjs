/* Drives the SYSTEM Firefox through geckodriver, installs the FKN extension as a
   TEMPORARY add-on (the only way to load an unsigned build into a
   signature-enforcing release Firefox), and taps the console over WebDriver
   BiDi so the app's own `egress →` line is readable.

   Not a Playwright spec, twice over: Playwright cannot install Firefox add-ons
   at all, and its bundled Firefox is an unpatched binary that will not start on
   NixOS (missing libstdc++ and the whole GTK set). */
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const GECKODRIVER = '/nix/store/ghb40j28z8npnbrgxkgirh72cj7gzxa2-geckodriver-0.36.0/bin/geckodriver'
const FIREFOX = '/etc/profiles/per-user/banou/bin/firefox'
const SOURCE = process.env.EXT ?? '/home/banou/dev/fkn/web-extension/build-firefox'
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:4561'
const PORT = 4456

const work = join(tmpdir(), `fkn-ff-${Date.now()}`)
mkdirSync(work, { recursive: true })
const xpi = join(work, 'ext.xpi')
execFileSync('python3', [
  '-c',
  'import shutil,sys; shutil.make_archive(sys.argv[1], "zip", sys.argv[2])',
  join(work, 'ext'),
  SOURCE,
])
execFileSync('mv', [join(work, 'ext.zip'), xpi])

const driver = spawn(GECKODRIVER, ['--port', String(PORT)], { stdio: 'ignore' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const call = async (method, path, body) => {
  const response = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  try { return JSON.parse(text) } catch { return { raw: text } }
}

let sessionId
const logs = []
try {
  await sleep(1500)
  const created = await call('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        webSocketUrl: true,
        'moz:firefoxOptions': {
          binary: FIREFOX,
          args: process.env.HEADED === '1' ? [] : ['-headless'],
          prefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 },
        },
      },
    },
  })
  sessionId = created.value?.sessionId
  if (!sessionId) throw new Error(`no session: ${JSON.stringify(created).slice(0, 400)}`)
  const wsUrl = created.value.capabilities?.webSocketUrl
  console.log('firefox', created.value.capabilities?.browserVersion, '| bidi:', Boolean(wsUrl))

  const installed = await call('POST', `/session/${sessionId}/moz/addon/install`, { path: xpi, temporary: true })
  console.log('addon:', JSON.stringify(installed.value ?? installed).slice(0, 160))

  if (wsUrl) {
    const socket = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.method !== 'log.entryAdded') return
      const text = (message.params.args ?? []).map(a => a?.value ?? a?.type ?? '').join(' | ') || (message.params.text ?? '')
      logs.push(`${message.params.level}: ${String(text).slice(0, 700)}`)
    })
    socket.send(JSON.stringify({ id: 1, method: 'session.subscribe', params: { events: ['log.entryAdded'] } }))
    await sleep(500)
  }

  await call('POST', `/session/${sessionId}/url`, { url: `${ORIGIN}/results?search_query=blender` })
  await sleep(25_000)

  const state = await call('POST', `/session/${sessionId}/execute/sync`, {
    script: `
      const html = document.documentElement
      return {
        fknExtension: html.dataset.fknExtension ?? null,
        watchLinks: document.querySelectorAll('a[href^="/watch"]').length,
        engine: html.dataset.engine ?? null,
      }`,
    args: [],
  })
  console.log('STATE', JSON.stringify(state.value ?? state))
  console.log('LOGS')
  for (const line of logs.slice(0, 40)) console.log(' ', line)
} catch (error) {
  console.log('FAILED', error instanceof Error ? error.message : String(error))
} finally {
  if (sessionId) await call('DELETE', `/session/${sessionId}`)
  driver.kill()
  rmSync(work, { recursive: true, force: true })
}

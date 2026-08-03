import { expect, test } from '@playwright/test'

/* Captions end to end, against the live source: `dQw4w9WgXcQ` publishes an authored English track. */

const VIDEO = '/watch?v=dQw4w9WgXcQ'

const firstFrame = async (page: import('@playwright/test').Page) => {
  await page.waitForFunction(
    () => performance.getEntriesByName('yt:first-frame', 'mark').length > 0,
    null,
    { timeout: 120_000 },
  )
}

const shownCues = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const video = document.querySelector('video')
    if (!video) return { tracks: 0, showing: 0, cues: 0 }
    const tracks = [...video.textTracks]
    const showing = tracks.filter((track) => track.mode === 'showing')
    return {
      tracks: tracks.length,
      showing: showing.length,
      cues: showing.reduce((total, track) => total + (track.cues?.length ?? 0), 0),
    }
  })

test('offers a caption track, renders its cues, and takes them away again', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto(VIDEO)
  await firstFrame(page)

  const toggle = page.getByRole('button', { name: 'Turn on captions' })
  await expect(toggle).toBeVisible({ timeout: 30_000 })

  await toggle.click()
  await expect(page.getByRole('button', { name: 'Turn off captions' })).toBeVisible()

  await expect(async () => {
    const shown = await shownCues(page)
    expect(shown.showing, 'no text track was made visible').toBeGreaterThan(0)
    expect(shown.cues, 'the visible track carried no cues').toBeGreaterThan(0)
  }).toPass({ timeout: 60_000 })

  await page.getByRole('button', { name: 'Turn off captions' }).click()
  await expect(async () => {
    const shown = await shownCues(page)
    expect(shown.showing, 'a text track was still showing after captions were turned off').toBe(0)
  }).toPass({ timeout: 15_000 })
})

test('lists the published tracks in the settings menu', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto(VIDEO)
  await firstFrame(page)
  await expect(page.getByRole('button', { name: 'Turn on captions' })).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: 'Settings' }).click()
  const subtitles = page.getByRole('menuitem', { name: /Subtitles/ })
  await expect(subtitles).toBeVisible()
  await expect(subtitles).toBeEnabled()

  await subtitles.click()
  await expect(page.getByRole('menuitem', { name: 'Off' })).toBeVisible()
  const items = page.getByRole('menuitem')
  expect(await items.count()).toBeGreaterThan(1)

  await items.nth(1).click()
  await expect(page.getByRole('button', { name: 'Turn off captions' })).toBeVisible()
})

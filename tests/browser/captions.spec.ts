import { expect, test } from '@playwright/test'

/* Captions end to end, against the live source.

   The track list rides on the watch page the playback path already fetches, and
   the cue file is fetched from the frame only once a track is picked, so the
   only proof that either half works is driving a real video. `dQw4w9WgXcQ`
   publishes an authored English track and has since this suite existed.

   What is asserted is what a viewer sees: the control appears, picking a track
   puts real cues on the media element, and turning it off takes them away. The
   parsing itself is covered without a browser in src/frame/captions.test.ts. */

const VIDEO = '/watch?v=dQw4w9WgXcQ'

const firstFrame = async (page: import('@playwright/test').Page) => {
  await page.waitForFunction(
    () => performance.getEntriesByName('yt:first-frame', 'mark').length > 0,
    null,
    { timeout: 120_000 },
  )
}

// Shaka's default displayer pushes cues onto the media element itself, so the
// element is the honest place to read them from: it is what actually renders.
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

  // The control is only rendered when the video publishes a track, so its
  // presence is the assertion that the list survived the frame boundary.
  const toggle = page.getByRole('button', { name: 'Turn on captions' })
  await expect(toggle).toBeVisible({ timeout: 30_000 })

  await toggle.click()
  await expect(page.getByRole('button', { name: 'Turn off captions' })).toBeVisible()

  // Polled rather than awaited once: the cue file is fetched through the frame
  // when the track is picked, so it lands a moment after the click.
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
  // Enabled rather than merely present: the item is disabled when the list is
  // empty, which is what a lost track list would look like from here.
  await expect(subtitles).toBeEnabled()

  await subtitles.click()
  await expect(page.getByRole('menuitem', { name: 'Off' })).toBeVisible()
  // Off plus at least one real track.
  const items = page.getByRole('menuitem')
  expect(await items.count()).toBeGreaterThan(1)

  // Picking from the menu is the other route into the same selection, and it
  // has to leave the toggle reading as on.
  await items.nth(1).click()
  await expect(page.getByRole('button', { name: 'Turn off captions' })).toBeVisible()
})

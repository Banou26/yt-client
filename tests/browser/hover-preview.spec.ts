import { expect, test } from '@playwright/test'

/* The inline preview must never paint over a thumbnail it cannot yet replace.

   Its root is an opaque black box covering the whole thumbnail, mounted the
   moment the pointer lands but with no frame to show until a session has been
   opened and media has arrived. That was drawn as a black rectangle where a
   picture used to be, for the whole of the load, and it read as the card
   breaking rather than as the card loading.

   Sampled continuously rather than checked at the ends, because the defect is a
   flash: a before-and-after assertion passes straight through it. The condition
   that only the fix satisfies is "never visible while readyState < 2", which is
   false on every frame of the old behaviour. */

test('keeps the thumbnail until the preview has a frame, then fades it in', async ({ page }) => {
  test.setTimeout(240_000)

  await page.goto('/results?search_query=blender')
  const channelLink = page.locator('a[href^="/channel/"]').first()
  await expect(channelLink).toBeVisible({ timeout: 120_000 })
  await page.goto((await channelLink.getAttribute('href')) ?? '/')
  const cards = page.locator('article').filter({ has: page.locator('a.thumb') })
  await expect(cards.first().locator('a.thumb')).toBeVisible({ timeout: 120_000 })
  await page.waitForTimeout(3000)

  await page.evaluate(() => {
    const w = window as unknown as { __samples: { opacity: number, painted: boolean, ready: number }[] }
    w.__samples = []
    const timer = setInterval(() => {
      const video = document.querySelector('article video') as HTMLVideoElement | null
      const root = video?.parentElement
      if (!root || !video) return
      w.__samples.push({
        opacity: Number(getComputedStyle(root).opacity),
        painted: root.hasAttribute('data-painted'),
        ready: video.readyState,
      })
      if (w.__samples.length > 600) clearInterval(timer)
    }, 40)
  })

  await cards.first().hover()
  // Long enough to cover the slow tunnelled path as well as the direct one.
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as unknown as { __samples: { painted: boolean }[] }).__samples.some(s => s.painted)),
      { timeout: 90_000 },
    )
    .toBe(true)
  await page.waitForTimeout(1000)

  const samples = await page.evaluate(() =>
    (window as unknown as { __samples: { opacity: number, painted: boolean, ready: number }[] }).__samples)

  const tooEarly = samples.filter(sample => sample.opacity > 0.05 && sample.ready < 2)
  expect(samples.length, 'no samples were taken, so nothing was proven').toBeGreaterThan(3)
  expect(tooEarly, `the preview was visible with no decodable frame: ${JSON.stringify(tooEarly.slice(0, 3))}`)
    .toHaveLength(0)
  // And it does eventually reveal, so the test cannot pass by the preview
  // simply never appearing.
  expect(samples.some(sample => sample.painted && sample.opacity > 0.95)).toBe(true)
})

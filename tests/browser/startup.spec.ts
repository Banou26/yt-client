import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

/* Startup budgets: every other suite's timeouts are sized so a run never flakes, so a change
   that made startup twice as slow would pass all of them. These ceilings are the only ones that fail. */

type Milestone = 'engine-ready' | 'player-attached' | 'first-frame'

/* Set from measurements taken 2026-07-30 over three runs against the live source: engine-ready 455/455/520ms,
   player-attached 7.8/7.9/7.8s, first-frame 8.06/8.20/8.08s. The ceilings are deliberately a few MULTIPLES above
   those, not a few percent, so a slow afternoon does not get the budget deleted while a doubling is still caught. */
const BUDGET_MS: Record<Milestone, number> = {
  'engine-ready': 3_000,
  'player-attached': 20_000,
  'first-frame': 25_000,
}

const timingOf = (page: Page, milestone: Milestone) =>
  page.evaluate(
    (name) => performance.getEntriesByName(`yt:${name}`, 'mark')[0]?.startTime,
    milestone,
  )

const reportedBudget = async (page: Page, milestone: Milestone) => {
  const at = await timingOf(page, milestone)
  expect(at, `${milestone} was never marked`).toBeDefined()
  test.info().annotations.push({ type: milestone, description: `${Math.round(at ?? 0)}ms` })
  expect(at, `${milestone} took ${Math.round(at ?? 0)}ms, over its ${BUDGET_MS[milestone]}ms budget`)
    .toBeLessThan(BUDGET_MS[milestone])
}

test('reaches an engine, a player and a first frame inside their budgets', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/watch?v=dQw4w9WgXcQ')

  await page.waitForFunction(
    () => performance.getEntriesByName('yt:first-frame', 'mark').length > 0,
    null,
    { timeout: 120_000 },
  )

  await reportedBudget(page, 'engine-ready')
  await reportedBudget(page, 'player-attached')
  await reportedBudget(page, 'first-frame')

  const [engine, attached, frame] = await Promise.all([
    timingOf(page, 'engine-ready'),
    timingOf(page, 'player-attached'),
    timingOf(page, 'first-frame'),
  ])
  expect(engine).toBeLessThanOrEqual(attached ?? 0)
  expect(attached).toBeLessThanOrEqual(frame ?? 0)
})

test('marks the first frame once, not on every later one', async ({ page }) => {
  await page.goto('/watch?v=dQw4w9WgXcQ')
  await page.waitForFunction(
    () => performance.getEntriesByName('yt:first-frame', 'mark').length > 0,
    null,
    { timeout: 120_000 },
  )
  await page.waitForTimeout(3_000)
  const count = await page.evaluate(() => performance.getEntriesByName('yt:first-frame', 'mark').length)
  expect(count).toBe(1)
})

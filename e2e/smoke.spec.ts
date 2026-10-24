import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/** A tiny live graph: app -> lib -> tiny, and app -> tiny. Pulling "tiny" drops all three. */
const LIVE = {
  nodes: [
    { versionKey: { name: 'demo-app', version: '1.2.0' }, relation: 'SELF' },
    { versionKey: { name: 'demo-lib', version: '2.0.0' }, relation: 'DIRECT' },
    { versionKey: { name: 'tiny', version: '0.1.0' }, relation: 'INDIRECT' },
  ],
  edges: [
    { fromNode: 0, toNode: 1 },
    { fromNode: 1, toNode: 2 },
    { fromNode: 0, toNode: 2 },
  ],
}

async function mockDepsDev(page: Page) {
  await page.route('https://api.deps.dev/**', async (route) => {
    const url = route.request().url()
    if (url.includes('/packages/demo-app/versions/')) return route.fulfill({ json: LIVE })
    if (url.endsWith('/packages/demo-app')) {
      return route.fulfill({
        json: {
          versions: [{ versionKey: { version: '1.2.0' }, publishedAt: '2026-10-01T00:00:00Z' }],
        },
      })
    }
    return route.fulfill({ status: 404, json: { error: 'not found' } })
  })
}

test.beforeEach(async ({ page }) => {
  await mockDepsDev(page)
})

test('starts on a bundled tower and pulls the riskiest block', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Loadbearing' })).toBeVisible()
  await expect(page.getByText('125 packages')).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Pull the riskiest block' }).click()
  await expect(page.getByText('82 of 125')).toBeVisible()
  await expect(page.getByText(/66% of eslint-plugin-react@7\.37\.5/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Rebuild tower' })).toBeVisible()
})

test('the block list works from the keyboard', async ({ page }) => {
  await page.goto('/')
  const pull = page.getByRole('button', { name: /^Pull function-bind, 77 packages depend on it$/ })
  await pull.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('77 of 125')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Pull es-errors/ })).toBeDisabled()
})

test('rebuilding puts the tower back', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Pull the riskiest block' }).click()
  await page.getByRole('button', { name: 'Rebuild tower' }).click()
  await expect(page.getByText('125 packages')).toBeVisible()
})

test('a shared link opens with the block already pulled', async ({ page }) => {
  await page.goto('/?pkg=eslint-plugin-react&pull=es-errors')
  await expect(page.getByText('82 of 125')).toBeVisible({ timeout: 15_000 })
})

test('a live search shows the package and says where the data came from', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('npm package name').fill('demo-app')
  await page.getByRole('button', { name: 'Build tower' }).click()
  await expect(page.getByText('3 packages')).toBeVisible()
  await expect(page.getByText(/demo-app@1\.2\.0 · live from deps\.dev/)).toBeVisible()
  await page.getByRole('button', { name: /^Pull tiny, 2 packages depend on it$/ }).click()
  await expect(page.getByText('2 of 3')).toBeVisible()
})

test('says what went wrong for a bad or unknown name', async ({ page }) => {
  await page.goto('/')
  const input = page.getByLabel('npm package name')
  await input.fill('../etc')
  await page.getByRole('button', { name: 'Build tower' }).click()
  await expect(page.getByText(/is not a valid npm package name/)).toBeVisible()
  await input.fill('does-not-exist')
  await page.getByRole('button', { name: 'Build tower' }).click()
  await expect(page.getByText(/No npm package called "does-not-exist"/)).toBeVisible()
  await page.getByRole('button', { name: /^Show eslint-plugin-react$/ }).click()
  await expect(page.getByText('125 packages')).toBeVisible()
})

test('makes no requests to anything but deps.dev', async ({ page }) => {
  const hosts = new Set<string>()
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (u.protocol.startsWith('http')) hosts.add(u.host)
  })
  await page.goto('/')
  await page.getByLabel('npm package name').fill('demo-app')
  await page.getByRole('button', { name: 'Build tower' }).click()
  await expect(page.getByText('3 packages')).toBeVisible()
  expect([...hosts].sort()).toEqual(['127.0.0.1:4173', 'api.deps.dev'])
})

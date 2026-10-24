// Renders public/og.png (the link-preview card) from the real app. Run with the preview server up on :4173.
import { chromium } from '@playwright/test'

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await page.goto('http://127.0.0.1:4173/?pkg=eslint-plugin-react&pull=es-errors')
await page.getByText('82 of 125').waitFor({ timeout: 20000 })
await page.addStyleTag({ content: '.list, .bottom, .hud button { display: none !important }' })
await page.waitForTimeout(5000)
await page.screenshot({ path: new URL('../public/og.png', import.meta.url).pathname })
await browser.close()
console.log('wrote public/og.png')

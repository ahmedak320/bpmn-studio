import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const artifact = resolve(
  process.argv[2] ?? `release/OrbitPM-Process-Studio-Lite-${manifest.version}.html`
)
const fileUrl = pathToFileURL(artifact).toString()
const browser = await chromium.launch({ headless: true })
const failures = []

try {
  for (const language of ['en', 'ar']) {
    const context = await browser.newContext({ locale: language === 'ar' ? 'ar-AE' : 'en-US' })
    const page = await context.newPage()
    const unexpectedRequests = []
    page.on('request', (request) => {
      const url = request.url()
      if (url === fileUrl || url.startsWith('data:') || url.startsWith('blob:')) return
      unexpectedRequests.push(`${request.method()} ${url}`)
    })
    await page.addInitScript((selectedLanguage) => {
      localStorage.setItem('orbitpm.lite.lang', selectedLanguage)
      Object.defineProperty(window, 'showDirectoryPicker', {
        configurable: true,
        value: undefined
      })
      Object.defineProperty(window, 'showOpenFilePicker', {
        configurable: true,
        value: undefined
      })
    }, language)
    await page.goto(fileUrl, { waitUntil: 'load' })
    await page
      .getByRole('heading', { name: 'OrbitPM Process Studio Lite' })
      .waitFor({ state: 'visible' })
    const direction = await page.locator('html').getAttribute('dir')
    if (direction !== (language === 'ar' ? 'rtl' : 'ltr')) {
      failures.push(`${language}: expected document direction was not rendered`)
    }
    const buttonName = language === 'ar' ? 'مخطط فارغ جديد' : 'New blank diagram'
    await page.getByRole('button', { name: buttonName, exact: true }).click()
    await page.locator('.djs-container svg').first().waitFor({ state: 'visible' })
    await page.locator(`[aria-label="Version ${manifest.version}"]`).waitFor({ state: 'visible' })
    if (unexpectedRequests.length) {
      failures.push(`${language}: unexpected offline requests: ${unexpectedRequests.join(', ')}`)
    }
    await context.close()
  }
} finally {
  await browser.close()
}

if (failures.length) {
  console.error('Exact file:// release smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Exact release HTML passed English and Arabic file:// offline smoke: ${artifact}`)

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, firefox, webkit } from '@playwright/test'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const urlArgument = process.argv.find((argument) => argument.startsWith('--url='))
const pagesUrl = urlArgument?.slice('--url='.length) ?? process.env.PAGES_URL
const artifactArgument = process.argv.find((argument) => argument.startsWith('--artifact='))
const artifactPath = resolve(artifactArgument?.slice('--artifact='.length) ?? 'dist/index.html')
const attemptsArgument = process.argv.find((argument) => argument.startsWith('--fetch-attempts='))
const delayArgument = process.argv.find((argument) => argument.startsWith('--fetch-delay-ms='))
const fetchAttempts = Number(attemptsArgument?.slice('--fetch-attempts='.length) ?? 12)
const fetchDelayMs = Number(delayArgument?.slice('--fetch-delay-ms='.length) ?? 5000)

if (!pagesUrl) {
  console.error('Pages smoke requires --url=<deployment-url> or PAGES_URL.')
  process.exit(1)
}
if (!Number.isInteger(fetchAttempts) || fetchAttempts < 1 || fetchAttempts > 180) {
  console.error('--fetch-attempts must be an integer from 1 through 180.')
  process.exit(1)
}
if (!Number.isInteger(fetchDelayMs) || fetchDelayMs < 0 || fetchDelayMs > 60_000) {
  console.error('--fetch-delay-ms must be an integer from 0 through 60000.')
  process.exit(1)
}

const expectedBytes = readFileSync(artifactPath)
const expectedDigest = createHash('sha256').update(expectedBytes).digest('hex')
const normalizedUrl = pagesUrl.endsWith('/') ? pagesUrl : `${pagesUrl}/`
let deployedBytes
let lastFetchError

for (let attempt = 1; attempt <= fetchAttempts; attempt += 1) {
  try {
    const response = await fetch(normalizedUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const candidateBytes = Buffer.from(await response.arrayBuffer())
    const candidateDigest = createHash('sha256').update(candidateBytes).digest('hex')
    if (candidateDigest === expectedDigest) {
      deployedBytes = candidateBytes
      break
    }
    throw new Error(`deployed SHA-256 ${candidateDigest} does not yet match ${expectedDigest}`)
  } catch (error) {
    lastFetchError = error
    if (attempt < fetchAttempts) {
      console.log(
        `Pages artifact not ready (attempt ${attempt}/${fetchAttempts}): ${error.message}`
      )
      await new Promise((resolveDelay) => setTimeout(resolveDelay, fetchDelayMs))
    }
  }
}
if (!deployedBytes) {
  throw new Error(
    `Pages did not serve the exact tested artifact after ${fetchAttempts} attempts: ${lastFetchError?.message}`
  )
}

const browserTargets = [
  { name: 'chromium', browserType: chromium, launchOptions: {} },
  { name: 'chrome', browserType: chromium, launchOptions: { channel: 'chrome' } },
  { name: 'edge', browserType: chromium, launchOptions: { channel: 'msedge' } },
  { name: 'playwright-firefox', browserType: firefox, launchOptions: {} },
  { name: 'webkit-linux', browserType: webkit, launchOptions: {} }
]
const failures = []
for (const { name: browserName, browserType, launchOptions } of browserTargets) {
  const browser = await browserType.launch({ headless: true, ...launchOptions })
  try {
    for (const language of ['en', 'ar']) {
      const context = await browser.newContext({
        locale: language === 'ar' ? 'ar-AE' : 'en-US'
      })
      const page = await context.newPage()
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
      await page.goto(normalizedUrl, { waitUntil: 'load' })
      await page
        .getByRole('heading', { name: 'OrbitPM Process Studio Lite' })
        .waitFor({ state: 'visible' })
      const direction = await page.locator('html').getAttribute('dir')
      if (direction !== (language === 'ar' ? 'rtl' : 'ltr')) {
        failures.push(`${browserName}/${language}: incorrect document direction`)
      }
      const buttonName = language === 'ar' ? 'مخطط فارغ جديد' : 'New blank diagram'
      await page.getByRole('button', { name: buttonName, exact: true }).click()
      await page.locator('.djs-container svg').first().waitFor({ state: 'visible' })
      await page
        .locator(`html[data-orbitpm-app-version="${manifest.version}"]`)
        .waitFor({ state: 'attached' })
      await page.getByText(`v${manifest.version}`, { exact: true }).waitFor({ state: 'visible' })
      await context.close()
    }
  } finally {
    await browser.close()
  }
}

if (failures.length) {
  console.error('Pages smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `Pages serves the exact tested SHA-256 ${expectedDigest} and passed EN/AR smoke in Playwright Chromium, current Chrome and Edge channels, Playwright Firefox, and Playwright WebKit on Linux.`
)

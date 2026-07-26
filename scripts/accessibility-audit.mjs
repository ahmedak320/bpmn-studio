import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import { chromium, firefox, webkit } from '@playwright/test'

const browserArgument = process.argv.find((argument) => argument.startsWith('--browser='))
const browserName = browserArgument?.split('=', 2)[1] ?? 'chromium'
const outputArgument = process.argv.find((argument) => argument.startsWith('--output='))
const outputPath = resolve(
  outputArgument?.split('=', 2)[1] ?? `accessibility-results-${browserName}.json`
)
const browsers = { chromium, firefox, webkit }
const browserType = browsers[browserName]

if (!browserType) {
  console.error(`Unsupported browser: ${browserName}`)
  process.exit(1)
}

const artifactPath = resolve('dist/index.html')
const artifactUrl = pathToFileURL(artifactPath).toString()
const matrices = []
for (const language of ['en', 'ar']) {
  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [
      { name: 'desktop', width: 1280, height: 800 },
      { name: 'mobile', width: 375, height: 812 }
    ]) {
      matrices.push({ language, colorScheme, viewport })
    }
  }
}

const browser = await browserType.launch({ headless: true })
const reports = []
let failureCount = 0

try {
  for (const matrix of matrices) {
    const context = await browser.newContext({
      colorScheme: matrix.colorScheme,
      locale: matrix.language === 'ar' ? 'ar-AE' : 'en-US',
      viewport: { width: matrix.viewport.width, height: matrix.viewport.height }
    })
    const page = await context.newPage()
    const unexpectedRequests = []

    page.on('request', (request) => {
      const url = request.url()
      if (url === artifactUrl || url.startsWith('data:') || url.startsWith('blob:')) return
      unexpectedRequests.push(`${request.method()} ${url}`)
    })
    await page.addInitScript((language) => {
      localStorage.setItem('orbitpm.lite.lang', language)
      // Force the portable single-file mode; native picker UI cannot be automated.
      Object.defineProperty(window, 'showDirectoryPicker', {
        configurable: true,
        value: undefined
      })
      Object.defineProperty(window, 'showOpenFilePicker', {
        configurable: true,
        value: undefined
      })
    }, matrix.language)

    await page.goto(artifactUrl, { waitUntil: 'load' })
    await page
      .getByRole('heading', { name: 'OrbitPM Process Studio Lite' })
      .waitFor({ state: 'visible' })

    for (const surface of ['landing', 'editor']) {
      if (surface === 'editor') {
        const buttonName = matrix.language === 'ar' ? 'مخطط فارغ جديد' : 'New blank diagram'
        await page.getByRole('button', { name: buttonName, exact: true }).click()
        await page.locator('.djs-container svg').first().waitFor({ state: 'visible' })
        await page.locator('[aria-label="Version 0.4.5"]').waitFor({ state: 'visible' })
      }

      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      )
      const entry = {
        browser: browserName,
        ...matrix,
        surface,
        violations: result.violations,
        horizontalOverflow: overflow,
        unexpectedRequests: [...unexpectedRequests]
      }
      reports.push(entry)

      if (result.violations.length || overflow || unexpectedRequests.length) {
        failureCount += 1
        console.error(
          `${browserName}/${matrix.language}/${matrix.colorScheme}/${matrix.viewport.name}/${surface}: ` +
            `${result.violations.length} axe violation(s), overflow=${overflow}, ` +
            `unexpected requests=${unexpectedRequests.length}`
        )
        for (const violation of result.violations) {
          console.error(
            `- ${violation.id} (${violation.impact ?? 'impact unknown'}): ${violation.help} — ${violation.helpUrl}`
          )
          for (const node of violation.nodes.slice(0, 5)) {
            console.error(`  ${node.target.join(' ')}: ${node.failureSummary ?? ''}`)
          }
        }
      } else {
        console.log(
          `${browserName}/${matrix.language}/${matrix.colorScheme}/${matrix.viewport.name}/${surface}: passed`
        )
      }
    }
    await context.close()
  }
} finally {
  await browser.close()
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      artifact: artifactPath,
      browser: browserName,
      matrixCount: matrices.length,
      surfaceCount: reports.length,
      failures: failureCount,
      reports
    },
    null,
    2
  )}\n`
)

if (failureCount) {
  console.error(`Accessibility matrix failed in ${failureCount}/${reports.length} scans.`)
  process.exit(1)
}

console.log(`Accessibility matrix passed all ${reports.length} scans (${outputPath}).`)

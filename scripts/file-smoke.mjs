import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { BPMN_JS_LICENSE } from './license-policy-data.mjs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const artifact = resolve(
  process.argv[2] ?? `release/OrbitPM-Process-Studio-Lite-${manifest.version}.html`
)
const fileUrl = pathToFileURL(artifact).toString()
const browser = await chromium.launch({ headless: true })
const failures = []

async function verifyAttributionUnobscured(page, label) {
  const attribution = page.locator(`a.${BPMN_JS_LICENSE.attributionClass}`).first()
  if (!(await attribution.isVisible())) {
    failures.push(`${label}: required bpmn.io powered-by attribution is not visible`)
    return
  }

  const href = await attribution.getAttribute('href')
  const box = await attribution.boundingBox()
  const visualState = await attribution.evaluate((element) => {
    const computed = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    const inset = Math.min(2, rect.width / 4, rect.height / 4)
    const points = [
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [rect.left + inset, rect.top + inset],
      [rect.right - inset, rect.top + inset],
      [rect.left + inset, rect.bottom - inset],
      [rect.right - inset, rect.bottom - inset]
    ]
    return {
      display: computed.display,
      visibility: computed.visibility,
      opacity: computed.opacity,
      insideViewport:
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= window.innerWidth &&
        rect.bottom <= window.innerHeight,
      unobscured: points.every(([x, y]) => {
        const topmost = document.elementFromPoint(x, y)
        return topmost === element || (topmost !== null && element.contains(topmost))
      })
    }
  })
  if (
    href !== BPMN_JS_LICENSE.attributionHref ||
    !box ||
    box.width <= 0 ||
    box.height <= 0 ||
    visualState.display === 'none' ||
    visualState.visibility === 'hidden' ||
    Number(visualState.opacity) <= 0 ||
    !visualState.insideViewport ||
    !visualState.unobscured
  ) {
    failures.push(
      `${label}: bpmn.io attribution is hidden, clipped, overlapped, empty, or points elsewhere`
    )
  }
}

async function verifyAttributionRetainedBeneathModal(page, label) {
  const attributions = page.locator(`a.${BPMN_JS_LICENSE.attributionClass}`)
  if ((await attributions.count()) === 0) {
    failures.push(`${label}: required bpmn.io powered-by attribution is not retained in the DOM`)
    return
  }

  // The modal correctly makes the editor inert and covers it with its backdrop.
  // Keep proving that the attribution retains a rendered, in-viewport layout
  // box and that no unrelated application surface is what covers it.
  const attribution = attributions.first()
  const href = await attribution.getAttribute('href')
  const state = await attribution.evaluate((element) => {
    const computed = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    const inset = Math.min(2, rect.width / 4, rect.height / 4)
    const points = [
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [rect.left + inset, rect.top + inset],
      [rect.right - inset, rect.top + inset],
      [rect.left + inset, rect.bottom - inset],
      [rect.right - inset, rect.bottom - inset]
    ]
    return {
      rendered:
        computed.display !== 'none' &&
        computed.visibility !== 'hidden' &&
        Number(computed.opacity) > 0 &&
        rect.width > 0 &&
        rect.height > 0,
      insideViewport:
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= window.innerWidth &&
        rect.bottom <= window.innerHeight,
      coveredByActiveModal: points.every(([x, y]) => {
        const topmost = document.elementFromPoint(x, y)
        const backdrop =
          topmost instanceof HTMLElement ? topmost.closest('[role="presentation"]') : null
        return Boolean(backdrop?.querySelector('[role="dialog"][aria-modal="true"]'))
      })
    }
  })
  if (
    href !== BPMN_JS_LICENSE.attributionHref ||
    !state.rendered ||
    !state.insideViewport ||
    !state.coveredByActiveModal
  ) {
    failures.push(
      `${label}: bpmn.io attribution is removed, clipped, hidden, points elsewhere, or is covered by something other than the active modal`
    )
  }
}

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
    await page
      .locator(`html[data-orbitpm-app-version="${manifest.version}"]`)
      .waitFor({ state: 'attached' })
    await page.getByText(`v${manifest.version}`, { exact: true }).waitFor({ state: 'visible' })
    await verifyAttributionUnobscured(page, `${language}/assistant-closed`)

    const assistantOpenName =
      language === 'ar' ? 'اسأل مساعد العمليات' : 'Ask the process assistant'
    const assistantTitle = language === 'ar' ? 'مساعد العمليات' : 'Process assistant'
    const assistantCloseName = language === 'ar' ? 'إغلاق المساعد' : 'Close assistant'
    await page.getByRole('button', { name: assistantOpenName, exact: true }).click()
    const assistant = page.getByRole('dialog', { name: assistantTitle, exact: true })
    await assistant.waitFor({ state: 'visible' })
    if ((await assistant.getAttribute('aria-modal')) !== 'true') {
      failures.push(`${language}/assistant-open: process assistant is not an accessible modal`)
    }
    await verifyAttributionRetainedBeneathModal(page, `${language}/assistant-open`)
    await assistant.getByRole('button', { name: assistantCloseName, exact: true }).click()
    await assistant.waitFor({ state: 'hidden' })
    await verifyAttributionUnobscured(page, `${language}/assistant-closed-again`)

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

console.log(
  `Exact release HTML passed English/Arabic offline smoke and visible bpmn.io attribution: ${artifact}`
)

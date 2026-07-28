import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

const artifactPath = resolve(process.argv[2] ?? 'release/OrbitPM-ARIS-Studio-Lite.html')
const referencePath = resolve(
  process.argv[3] ?? new URL('../../reference/AnimalWF/ARISAMLExport.xml', import.meta.url).pathname
)
const artifactUrl = pathToFileURL(artifactPath).toString()
const failures = []

if (!statSync(artifactPath, { throwIfNoEntry: false })?.isFile()) {
  console.error(`ARIS rolling artifact does not exist: ${artifactPath}`)
  process.exit(1)
}
if (!statSync(referencePath, { throwIfNoEntry: false })?.isFile()) {
  console.error(`ARIS reference AML does not exist: ${referencePath}`)
  process.exit(1)
}

const bpmnFixture = Buffer.from(
  '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">' +
    '<bpmn:process id="Legacy_Process" />' +
    '</bpmn:definitions>',
  'utf8'
)

const scenarios = [
  {
    lang: 'en',
    locale: 'en-US',
    dir: 'ltr',
    colorScheme: 'light',
    backgroundColor: 'rgb(255, 255, 255)',
    assistantButton: 'Assistant',
    assistantTitle: 'Process assistant',
    settingsButton: '⚙ Settings',
    settingsTitle: 'Settings — AI keys',
    closeAssistant: 'Close assistant',
    closeSettings: 'Close',
    aiPanelHeading: '✨ Generate with AI',
    placeholderHeading: 'ARIS placeholder canvas',
    languageButtonPattern: /^Interface:/,
    rejectedToast: 'This ARIS-only build accepts ARIS AML/XML exports.'
  },
  {
    lang: 'ar',
    locale: 'ar-AE',
    dir: 'rtl',
    colorScheme: 'dark',
    backgroundColor: 'rgb(26, 27, 30)',
    assistantButton: 'المساعد',
    assistantTitle: 'مساعد العمليات',
    settingsButton: '⚙ الإعدادات',
    settingsTitle: 'الإعدادات — مفاتيح الذكاء الاصطناعي',
    closeAssistant: 'إغلاق المساعد',
    closeSettings: 'إغلاق',
    aiPanelHeading: '✨ إنشاء بالذكاء الاصطناعي',
    placeholderHeading: 'لوحة عنصر نائب لـ ARIS',
    languageButtonPattern: /^الواجهة:/,
    rejectedToast: 'هذا الإصدار المقتصر على ARIS يقبل فقط صادرات ARIS AML/XML.'
  }
]

function recordFailure(label, message) {
  failures.push(`${label}: ${message}`)
}

const browser = await chromium.launch({ headless: true })

try {
  for (const scenario of scenarios) {
    const label = `${scenario.lang}/${scenario.colorScheme}`
    const context = await browser.newContext({ locale: scenario.locale })
    const page = await context.newPage()
    const unexpectedRequests = []

    await page.emulateMedia({ colorScheme: scenario.colorScheme })
    page.on('request', (request) => {
      const url = request.url()
      if (
        url === artifactUrl ||
        url === 'about:blank' ||
        url.startsWith('data:') ||
        url.startsWith('blob:')
      ) {
        return
      }
      unexpectedRequests.push(`${request.method()} ${url}`)
    })

    await page.addInitScript((selectedLanguage) => {
      localStorage.clear()
      localStorage.setItem('orbitpm.lite.lang', selectedLanguage)
      Object.defineProperty(window, 'showDirectoryPicker', {
        configurable: true,
        value: undefined
      })
      Object.defineProperty(window, 'showOpenFilePicker', {
        configurable: true,
        value: undefined
      })
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: {}
      })
    }, scenario.lang)

    await page.goto(artifactUrl, { waitUntil: 'load' })
    await page.getByRole('heading', { name: 'OrbitPM ARIS Studio Lite' }).waitFor({ state: 'visible' })

    const renderedDir = await page.locator('html').getAttribute('dir')
    if (renderedDir !== scenario.dir) {
      recordFailure(label, `expected dir=${scenario.dir}, received ${renderedDir}`)
    }

    const backgroundColor = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor
    )
    if (backgroundColor !== scenario.backgroundColor) {
      recordFailure(
        label,
        `expected body background ${scenario.backgroundColor}, received ${backgroundColor}`
      )
    }

    const pickerInput = page.locator('input[type="file"]').first()
    await pickerInput.setInputFiles(referencePath)

    await page.getByText('ARISAMLExport.xml', { exact: true }).first().waitFor({ state: 'visible' })
    await page.getByText(scenario.placeholderHeading, { exact: true }).waitFor({ state: 'visible' })
    await page.getByLabel(scenario.aiPanelHeading, { exact: true }).waitFor({ state: 'visible' })

    await page.getByRole('banner').getByRole('button', { name: scenario.settingsButton, exact: true }).click()
    const settingsDialog = page.getByRole('dialog', { name: scenario.settingsTitle, exact: true })
    await settingsDialog.waitFor({ state: 'visible' })
    await settingsDialog.getByLabel(scenario.closeSettings, { exact: true }).click()
    await settingsDialog.waitFor({ state: 'hidden' })

    await page.getByRole('button', { name: scenario.assistantButton, exact: true }).click()
    const assistantDialog = page.getByRole('dialog', { name: scenario.assistantTitle, exact: true })
    await assistantDialog.waitFor({ state: 'visible' })
    await assistantDialog.getByLabel(scenario.closeAssistant, { exact: true }).click()
    await assistantDialog.waitFor({ state: 'hidden' })

    const openInput = page.locator('input[type="file"]').nth(0)
    await openInput.setInputFiles({
      name: 'legacy-open.bpmn',
      mimeType: 'application/xml',
      buffer: bpmnFixture
    })
    await page.getByText(scenario.rejectedToast, { exact: true }).waitFor({ state: 'visible' })
    if ((await page.getByText('legacy-open.bpmn', { exact: true }).count()) !== 0) {
      recordFailure(label, 'BPMN file from open-file path was not rejected cleanly')
    }

    const importInput = page.locator('input[type="file"]').nth(1)
    await importInput.setInputFiles({
      name: 'legacy-import.bpmn',
      mimeType: 'application/xml',
      buffer: bpmnFixture
    })
    if ((await page.getByText('legacy-import.bpmn', { exact: true }).count()) !== 0) {
      recordFailure(label, 'BPMN file from import path was not rejected cleanly')
    }

    const languageToggle = page.getByRole('button', { name: scenario.languageButtonPattern })
    await languageToggle.click()
    await page.waitForFunction(
      (expectedDir) => document.documentElement.getAttribute('dir') === expectedDir,
      scenario.dir === 'ltr' ? 'rtl' : 'ltr'
    )

    if (unexpectedRequests.length) {
      recordFailure(label, `unexpected requests: ${unexpectedRequests.join(', ')}`)
    }

    await context.close()
  }
} finally {
  await browser.close()
}

if (failures.length) {
  console.error('ARIS exact file:// smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

const artifactSha256 = readFileSync(artifactPath)
console.log(
  `ARIS exact file:// smoke passed for ${artifactPath} using reference AML ${referencePath} (${artifactSha256.byteLength} bytes).`
)

process.exit(0)

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { release as kernelRelease } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium, firefox, webkit } from '@playwright/test'

const playwrightManifest = JSON.parse(
  readFileSync(new URL('../node_modules/@playwright/test/package.json', import.meta.url), 'utf8')
)
const playwrightBrowsersManifest = JSON.parse(
  readFileSync(new URL('../node_modules/playwright-core/browsers.json', import.meta.url), 'utf8')
)
const applicationManifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
)

function option(name, fallback) {
  const prefix = `${name}=`
  const argument = process.argv.find((candidate) => candidate.startsWith(prefix))
  return argument?.slice(prefix.length) ?? fallback
}

const candidateSha = option('--candidate-sha', process.env.GITHUB_SHA)
const artifactPath = resolve(option('--artifact', 'dist/index.html'))
const outputPath = resolve(option('--output', 'browser-environment-evidence.json'))
const testedUrl = option('--url', pathToFileURL(artifactPath).toString())
const fetchAttempts = Number(option('--fetch-attempts', '12'))
const fetchDelayMs = Number(option('--fetch-delay-ms', '5000'))
const requestedTargets = option('--browsers', 'chromium')
  .split(',')
  .map((target) => target.trim())
  .filter(Boolean)

if (!candidateSha || !/^[a-f0-9]{40}$/i.test(candidateSha)) {
  throw new Error('--candidate-sha must be the exact 40-character Git commit SHA.')
}
if (outputPath === artifactPath) {
  throw new Error('Browser evidence output must not overwrite the tested artifact.')
}
if (requestedTargets.length === 0) {
  throw new Error('--browsers must select at least one browser target.')
}
if (new Set(requestedTargets).size !== requestedTargets.length) {
  throw new Error('--browsers must not contain duplicate browser targets.')
}
if (!Number.isInteger(fetchAttempts) || fetchAttempts < 1 || fetchAttempts > 120) {
  throw new Error('--fetch-attempts must be an integer from 1 through 120.')
}
if (!Number.isInteger(fetchDelayMs) || fetchDelayMs < 0 || fetchDelayMs > 60_000) {
  throw new Error('--fetch-delay-ms must be an integer from 0 through 60000.')
}

const targetCatalog = {
  chromium: {
    browserType: chromium,
    classification: 'playwright-bundled',
    launchOptions: {}
  },
  chrome: {
    browserType: chromium,
    classification: 'current-system-channel-observational',
    launchOptions: { channel: 'chrome' }
  },
  edge: {
    browserType: chromium,
    classification: 'current-system-channel-observational',
    launchOptions: { channel: 'msedge' }
  },
  firefox: {
    browserType: firefox,
    classification: 'playwright-bundled',
    launchOptions: {}
  },
  'webkit-linux': {
    browserType: webkit,
    classification: 'playwright-bundled-webkit-on-linux-not-safari',
    launchOptions: {}
  }
}
for (const target of requestedTargets) {
  if (!Object.hasOwn(targetCatalog, target)) {
    throw new Error(
      `Unknown browser target ${target}; expected one of ${Object.keys(targetCatalog).join(', ')}.`
    )
  }
}

const artifactBytes = readFileSync(artifactPath)
const artifactSha256 = createHash('sha256').update(artifactBytes).digest('hex')
const testedUrlObject = new URL(testedUrl)
if (!['file:', 'https:'].includes(testedUrlObject.protocol)) {
  throw new Error('The tested URL must use file: or https:.')
}
if (
  testedUrlObject.protocol === 'file:' &&
  realpathSync(fileURLToPath(testedUrlObject)) !== realpathSync(artifactPath)
) {
  throw new Error('A file: tested URL must resolve to the exact --artifact path.')
}
let servedSha256 = artifactSha256
let servedFinalUrl = testedUrl
if (testedUrlObject.protocol !== 'file:') {
  let fetchFailure
  for (let attempt = 1; attempt <= fetchAttempts; attempt += 1) {
    try {
      const response = await fetch(testedUrl, {
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000)
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      servedFinalUrl = response.url
      if (new URL(servedFinalUrl).protocol !== 'https:') {
        throw new Error('the final evidence URL is not HTTPS')
      }
      servedSha256 = createHash('sha256')
        .update(Buffer.from(await response.arrayBuffer()))
        .digest('hex')
      if (servedSha256 !== artifactSha256) {
        throw new Error(`SHA-256 ${servedSha256} does not match artifact ${artifactSha256}`)
      }
      fetchFailure = undefined
      break
    } catch (error) {
      fetchFailure = error
      if (attempt < fetchAttempts) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, fetchDelayMs))
      }
    }
  }
  if (fetchFailure) {
    throw new Error(
      `Evidence URL did not serve the exact artifact after ${fetchAttempts} attempt(s): ${
        fetchFailure instanceof Error ? fetchFailure.message : String(fetchFailure)
      }`
    )
  }
}

const browsers = []
for (const target of requestedTargets) {
  const { browserType, classification, launchOptions } = targetCatalog[target]
  const browser = await browserType.launch({ headless: true, ...launchOptions })
  try {
    const locales = []
    let environment
    for (const locale of [
      { applicationLanguage: 'en', browserLocale: 'en-US', direction: 'ltr' },
      { applicationLanguage: 'ar', browserLocale: 'ar-AE', direction: 'rtl' }
    ]) {
      const context = await browser.newContext({ locale: locale.browserLocale })
      try {
        const page = await context.newPage()
        await page.addInitScript((applicationLanguage) => {
          globalThis.localStorage.setItem('orbitpm.lite.lang', applicationLanguage)
          Object.defineProperty(globalThis, 'showDirectoryPicker', {
            configurable: true,
            value: undefined
          })
          Object.defineProperty(globalThis, 'showOpenFilePicker', {
            configurable: true,
            value: undefined
          })
        }, locale.applicationLanguage)
        let navigationSha256 = artifactSha256
        let navigationFailure
        if (testedUrlObject.protocol !== 'file:') {
          for (let attempt = 1; attempt <= fetchAttempts; attempt += 1) {
            try {
              const navigationResponse = await page.goto(testedUrl, { waitUntil: 'load' })
              if (!navigationResponse || !navigationResponse.ok()) {
                throw new Error('did not receive a successful main document')
              }
              navigationSha256 = createHash('sha256')
                .update(await navigationResponse.body())
                .digest('hex')
              if (navigationSha256 !== artifactSha256) {
                throw new Error(
                  `navigated to SHA-256 ${navigationSha256}, expected ${artifactSha256}`
                )
              }
              navigationFailure = undefined
              break
            } catch (error) {
              navigationFailure = error
              if (attempt < fetchAttempts) {
                await new Promise((resolveDelay) => setTimeout(resolveDelay, fetchDelayMs))
              }
            }
          }
          if (navigationFailure) {
            throw new Error(
              `${target}/${locale.applicationLanguage} did not navigate to exact bytes after ${fetchAttempts} attempt(s): ${
                navigationFailure instanceof Error
                  ? navigationFailure.message
                  : String(navigationFailure)
              }`
            )
          }
        } else {
          await page.goto(testedUrl, { waitUntil: 'load' })
        }
        await page.waitForFunction(
          ({ applicationLanguage, direction }) =>
            globalThis.document.documentElement.lang === applicationLanguage &&
            globalThis.document.documentElement.dir === direction,
          locale
        )
        const observed = await page.evaluate(() => ({
          documentLanguage: globalThis.document.documentElement.lang,
          direction: globalThis.document.documentElement.dir,
          platform: globalThis.navigator.platform,
          navigatorLanguage: globalThis.navigator.language,
          navigatorLanguages: [...globalThis.navigator.languages],
          directoryPickerDisabled: typeof globalThis.showDirectoryPicker === 'undefined',
          openFilePickerDisabled: typeof globalThis.showOpenFilePicker === 'undefined',
          userAgent: globalThis.navigator.userAgent
        }))
        const passed =
          observed.documentLanguage === locale.applicationLanguage &&
          observed.direction === locale.direction &&
          observed.navigatorLanguage === locale.browserLocale &&
          observed.directoryPickerDisabled &&
          observed.openFilePickerDisabled
        locales.push({
          applicationLanguage: locale.applicationLanguage,
          browserLocale: locale.browserLocale,
          expectedDirection: locale.direction,
          documentLanguage: observed.documentLanguage,
          direction: observed.direction,
          navigatorLanguage: observed.navigatorLanguage,
          navigatorLanguages: observed.navigatorLanguages,
          directoryPickerDisabled: observed.directoryPickerDisabled,
          openFilePickerDisabled: observed.openFilePickerDisabled,
          finalUrl: page.url(),
          navigationSha256,
          result: passed ? 'passed' : 'failed'
        })
        if (!passed) {
          throw new Error(
            `${target}/${locale.applicationLanguage} rendered lang=${observed.documentLanguage} dir=${observed.direction}.`
          )
        }
        environment ??= {
          userAgent: observed.userAgent,
          platform: observed.platform
        }
      } finally {
        await context.close()
      }
    }
    browsers.push({
      target,
      classification,
      channel: launchOptions.channel ?? null,
      version: browser.version(),
      userAgent: environment.userAgent,
      platform: environment.platform,
      locales
    })
  } finally {
    await browser.close()
  }
}

const evidence = {
  schemaVersion: 1,
  gate: 'orbitpm-lite-browser-environment',
  result: 'passed',
  generatedAt: new Date().toISOString(),
  candidateSha: candidateSha.toLowerCase(),
  artifact: {
    path: artifactPath,
    sha256: artifactSha256
  },
  testedUrl,
  servedFinalUrl,
  servedSha256,
  runner: {
    platform: process.platform,
    architecture: process.arch,
    kernelRelease: kernelRelease(),
    imageOs: process.env.ImageOS ?? null,
    imageVersion: process.env.ImageVersion ?? null,
    runnerOs: process.env.RUNNER_OS ?? null,
    runnerArchitecture: process.env.RUNNER_ARCH ?? null
  },
  runtime: {
    node: process.version,
    declaredPackageManager: applicationManifest.packageManager,
    playwright: playwrightManifest.version,
    playwrightBrowsers: playwrightBrowsersManifest.browsers.map(
      ({ name, revision, browserVersion, installByDefault }) => ({
        name,
        revision,
        browserVersion,
        installByDefault
      })
    )
  },
  workflow: {
    repository: process.env.GITHUB_REPOSITORY ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    workflow: process.env.GITHUB_WORKFLOW ?? null,
    job: process.env.GITHUB_JOB ?? null
  },
  testEnvironment: {
    headless: true,
    fileSystemAccessPickerOverrides: 'disabled'
  },
  browsers
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' })
console.log(
  `Recorded ${browsers.length} browser target(s), exact artifact SHA-256, URL, platform, and EN/AR locale results in ${outputPath}.`
)

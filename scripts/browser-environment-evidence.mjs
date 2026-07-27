import { createHash } from 'node:crypto'
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { release as kernelRelease } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium, firefox, webkit } from '@playwright/test'

const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
const DEFAULT_FETCH_TIMEOUT_MS = 30_000

const playwrightManifest = JSON.parse(
  readFileSync(new URL('../node_modules/@playwright/test/package.json', import.meta.url), 'utf8')
)
const playwrightBrowsersManifest = JSON.parse(
  readFileSync(new URL('../node_modules/playwright-core/browsers.json', import.meta.url), 'utf8')
)
const applicationManifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
)

class EvidenceDownloadError extends Error {}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function option(name, fallback) {
  const prefix = `${name}=`
  const argument = process.argv.find((candidate) => candidate.startsWith(prefix))
  return argument?.slice(prefix.length) ?? fallback
}

function timeoutError(timeoutMs) {
  return new EvidenceDownloadError(
    `Remote evidence response exceeded the ${timeoutMs} ms time limit.`
  )
}

async function settleBefore(promise, deadline, onTimeout, timeoutMs) {
  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0) {
    onTimeout()
    throw timeoutError(timeoutMs)
  }
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(timeoutError(timeoutMs))
          onTimeout()
        }, remainingMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Evidence URLs are deliberately non-parameterized. Besides keeping credentials
 * out of the evidence JSON and runner logs, this prevents redirect fragments or
 * bearer-token query parameters from becoming release metadata.
 */
export function assertSafeEvidenceUrl(
  value,
  label = 'Evidence URL',
  allowedProtocols = ['file:', 'https:']
) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${label} must be a valid URL.`)
  }
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(`${label} must use ${allowedProtocols.join(' or ')}.`)
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not include URL credentials.`)
  }
  if (parsed.href.includes('?') || parsed.href.includes('#')) {
    throw new Error(`${label} must not include a query string or fragment.`)
  }
  return parsed
}

/**
 * Read a response incrementally under one absolute deadline. Never call
 * arrayBuffer() for evidence downloads: an untrusted server controls their size.
 */
export async function readResponseBodyBounded(
  response,
  { maxBytes, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, deadline = Date.now() + timeoutMs } = {}
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('maxBytes must be a positive safe integer.')
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('timeoutMs must be a positive integer.')
  }

  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      void response.body?.cancel('invalid content length').catch(() => undefined)
      throw new EvidenceDownloadError('Remote evidence response has an invalid Content-Length.')
    }
    const parsedLength = Number(declaredLength)
    if (!Number.isSafeInteger(parsedLength) || parsedLength > maxBytes) {
      void response.body?.cancel('response too large').catch(() => undefined)
      throw new EvidenceDownloadError(
        `Remote evidence response exceeds the ${maxBytes}-byte size limit.`
      )
    }
  }
  if (!response.body) {
    throw new EvidenceDownloadError('Remote evidence response did not include a body.')
  }

  const reader = response.body.getReader()
  const chunks = []
  let totalBytes = 0
  let completed = false
  try {
    while (true) {
      let result
      try {
        result = await settleBefore(
          reader.read(),
          deadline,
          () => {
            void reader.cancel('response deadline exceeded').catch(() => undefined)
          },
          timeoutMs
        )
      } catch (error) {
        if (error instanceof EvidenceDownloadError) throw error
        throw new EvidenceDownloadError('Remote evidence response body could not be read.')
      }
      if (result.done) {
        completed = true
        break
      }
      const chunkLength = result.value.byteLength
      totalBytes += chunkLength
      if (totalBytes > maxBytes) {
        throw new EvidenceDownloadError(
          `Remote evidence response exceeds the ${maxBytes}-byte size limit.`
        )
      }
      chunks.push(Buffer.from(result.value))
    }
  } finally {
    if (!completed) {
      void reader.cancel('evidence download stopped').catch(() => undefined)
    } else {
      reader.releaseLock()
    }
  }
  return Buffer.concat(chunks, totalBytes)
}

/**
 * Download the remote document with a cap equal to the expected local artifact
 * length. The same deadline covers response headers and the complete body.
 */
export async function downloadExactRemoteDocument(
  url,
  { expectedSha256, maxBytes, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, fetchImplementation = fetch }
) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error('expectedSha256 must be an exact lowercase SHA-256 digest.')
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('maxBytes must be a positive safe integer.')
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('timeoutMs must be a positive integer.')
  }
  const requestedUrl = assertSafeEvidenceUrl(url, 'Remote evidence URL', ['https:'])
  const controller = new AbortController()
  const deadline = Date.now() + timeoutMs
  let response
  try {
    response = await settleBefore(
      Promise.resolve().then(() =>
        fetchImplementation(requestedUrl.toString(), {
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal
        })
      ),
      deadline,
      () => controller.abort(),
      timeoutMs
    )
  } catch (error) {
    controller.abort()
    if (error instanceof EvidenceDownloadError) throw error
    throw new EvidenceDownloadError('Remote evidence request failed.')
  }

  try {
    if (!response.ok) {
      throw new EvidenceDownloadError(`Remote evidence request returned HTTP ${response.status}.`)
    }
    const finalUrl = assertSafeEvidenceUrl(response.url, 'Remote evidence final URL', ['https:'])
    if (finalUrl.toString() !== requestedUrl.toString()) {
      throw new EvidenceDownloadError('Remote evidence request must not redirect.')
    }
    const bytes = await readResponseBodyBounded(response, {
      maxBytes,
      timeoutMs,
      deadline
    })
    const bodySha256 = sha256(bytes)
    if (bodySha256 !== expectedSha256) {
      throw new EvidenceDownloadError(
        `Remote evidence SHA-256 ${bodySha256} does not match artifact ${expectedSha256}.`
      )
    }
    return {
      bytes,
      finalUrl: finalUrl.toString(),
      sha256: bodySha256
    }
  } catch (error) {
    if (error instanceof EvidenceDownloadError) throw error
    if (error instanceof Error && /^Remote evidence (?:final URL|URL)/.test(error.message)) {
      throw error
    }
    throw new EvidenceDownloadError('Remote evidence response could not be verified.')
  } finally {
    controller.abort()
  }
}

/**
 * Bind the main document until the caller has finished its observations.
 * The verified, bounded snapshot fulfills the one authorized main request, and
 * Playwright hashes the fulfilled response bytes before locale observations.
 * Engines that cannot expose this route/response binding fail closed.
 */
export async function navigateUsingExactBytes(
  page,
  url,
  bytes,
  { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, expectedFinalUrl = url } = {}
) {
  const navigationUrl = assertSafeEvidenceUrl(url, 'Navigation URL')
  const expectedFinalUrlObject = assertSafeEvidenceUrl(expectedFinalUrl, 'Expected final URL')
  if (expectedFinalUrlObject.protocol !== navigationUrl.protocol) {
    throw new Error('Navigation and expected final URLs must use the same protocol.')
  }
  const expectedSha256 = sha256(bytes)
  let fulfilled = false
  let acceptedMainRequests = 0
  let bound = false
  let bindingViolation
  let released = false

  const recordBindingViolation = (message) => {
    bindingViolation ??= message
  }

  const requestIsMainDocument = (request) => {
    try {
      return (
        request.isNavigationRequest() &&
        request.resourceType() === 'document' &&
        request.frame() === page.mainFrame()
      )
    } catch {
      return false
    }
  }

  const routeHandler = async (route) => {
    const request = route.request()
    if (!requestIsMainDocument(request)) {
      recordBindingViolation('The tested document requested an external subresource.')
      await route.abort('blockedbyclient')
      return
    }
    let requestUrl
    try {
      requestUrl = assertSafeEvidenceUrl(request.url(), 'Browser request URL')
    } catch {
      recordBindingViolation('The browser requested an unsafe navigation URL.')
      await route.abort('blockedbyclient')
      return
    }
    if (bound) {
      recordBindingViolation('The browser attempted to leave the exact evidence URL.')
      await route.abort('blockedbyclient')
      return
    }
    if (
      acceptedMainRequests !== 0 ||
      requestUrl.toString() !== navigationUrl.toString() ||
      requestUrl.protocol !== navigationUrl.protocol ||
      requestUrl.toString() !== expectedFinalUrlObject.toString()
    ) {
      recordBindingViolation('The browser attempted an unauthorized evidence navigation.')
      await route.abort('blockedbyclient')
      return
    }
    acceptedMainRequests += 1
    fulfilled = true
    await route.fulfill({
      status: 200,
      headers: {
        'cache-control': 'no-store',
        'content-length': String(bytes.byteLength),
        'content-type': 'text/html; charset=utf-8'
      },
      body: bytes
    })
  }

  const requestHandler = (request) => {
    if (requestIsMainDocument(request)) return
    let protocol
    try {
      protocol = new URL(request.url()).protocol
    } catch {
      recordBindingViolation('The tested document issued an invalid subresource request.')
      return
    }
    if (['file:', 'http:', 'https:'].includes(protocol)) {
      recordBindingViolation('The tested document requested an external subresource.')
    }
  }

  const frameNavigationHandler = (frame) => {
    if (!bound || frame !== page.mainFrame()) return
    let currentUrl
    try {
      currentUrl = assertSafeEvidenceUrl(frame.url(), 'Browser final URL')
    } catch {
      recordBindingViolation('The browser left the safe evidence URL.')
      return
    }
    if (currentUrl.toString() !== expectedFinalUrlObject.toString()) {
      recordBindingViolation('The browser left the exact evidence URL after loading.')
    }
  }

  const popupHandler = (popup) => {
    recordBindingViolation('The tested document attempted to open a popup.')
    void popup.close().catch(() => undefined)
  }

  const webSocketHandler = () => {
    recordBindingViolation('The tested document attempted to open a WebSocket.')
  }

  const workerHandler = (worker) => {
    recordBindingViolation('The tested document attempted to start a worker.')
    void worker.evaluate(() => globalThis.close()).catch(() => undefined)
  }

  const browserContext = page.context()
  const extraPageHandler = (openedPage) => {
    if (openedPage === page) return
    recordBindingViolation('The tested document attempted to open an extra page.')
    void openedPage.close().catch(() => undefined)
  }

  const routedWebSocketHandler = (webSocketRoute) => {
    recordBindingViolation('The tested document attempted to open a WebSocket.')
    void webSocketRoute
      .close({ code: 1008, reason: 'External execution blocked for evidence' })
      .catch(() => undefined)
  }

  const release = async () => {
    if (released) return
    released = true
    page.off('request', requestHandler)
    page.off('framenavigated', frameNavigationHandler)
    page.off('popup', popupHandler)
    page.off('websocket', webSocketHandler)
    page.off('worker', workerHandler)
    browserContext.off('page', extraPageHandler)
    await browserContext.unroute('**/*', routeHandler).catch(() => undefined)
  }

  page.on('request', requestHandler)
  page.on('framenavigated', frameNavigationHandler)
  page.on('popup', popupHandler)
  page.on('websocket', webSocketHandler)
  page.on('worker', workerHandler)
  browserContext.on('page', extraPageHandler)
  await browserContext.route('**/*', routeHandler)
  await browserContext.routeWebSocket('**', routedWebSocketHandler)
  let completed = false
  try {
    const deadline = Date.now() + timeoutMs
    let navigationResponse
    try {
      navigationResponse = await page.goto(navigationUrl.toString(), {
        waitUntil: 'load',
        timeout: timeoutMs
      })
    } catch {
      if (bindingViolation) throw new Error(bindingViolation)
      throw new Error('Browser could not load the exact evidence URL.')
    }
    let navigationSha256
    let navigationBinding
    if (fulfilled) {
      if (!navigationResponse || !navigationResponse.ok()) {
        throw new Error('Browser did not receive the captured main document.')
      }
      if (bindingViolation) throw new Error(bindingViolation)
      let navigatedBytes
      try {
        navigatedBytes = await settleBefore(
          navigationResponse.body(),
          deadline,
          () => {
            void page.evaluate(() => globalThis.stop()).catch(() => undefined)
          },
          timeoutMs
        )
      } catch (error) {
        // The sticky violation is sanitized; the caught browser error is not.
        // eslint-disable-next-line preserve-caught-error
        if (bindingViolation) throw new Error(bindingViolation)
        if (error instanceof EvidenceDownloadError) throw error
        // Playwright can retain an unsafe rejected URL in the raw body error.
        // eslint-disable-next-line preserve-caught-error
        throw new Error('Browser file response body could not be verified.')
      }
      navigationSha256 = sha256(navigatedBytes)
      navigationBinding =
        navigationUrl.protocol === 'https:'
          ? 'bounded-download-fulfilled-response-bytes'
          : 'captured-response-bytes'
    } else {
      throw new Error('This browser cannot establish exact consumed-byte file evidence.')
    }
    if (bindingViolation) {
      throw new Error(bindingViolation)
    }
    if (navigationSha256 !== expectedSha256) {
      throw new Error(
        `Browser consumed SHA-256 ${navigationSha256}, expected captured artifact ${expectedSha256}.`
      )
    }
    const finalUrl = assertSafeEvidenceUrl(page.url(), 'Browser final URL')
    if (finalUrl.toString() !== expectedFinalUrlObject.toString()) {
      throw new Error('Browser left the exact evidence URL during navigation.')
    }
    bound = true
    const assertStillBound = () => {
      if (bindingViolation) {
        throw new Error(bindingViolation)
      }
      const currentUrl = assertSafeEvidenceUrl(page.url(), 'Browser final URL')
      if (currentUrl.toString() !== expectedFinalUrlObject.toString()) {
        throw new Error('Browser left the exact evidence URL after loading.')
      }
    }
    completed = true
    return {
      finalUrl: finalUrl.toString(),
      navigationSha256,
      navigationBinding,
      assertStillBound,
      release
    }
  } finally {
    if (!completed) await release()
  }
}

export function captureArtifactSnapshot(path) {
  const descriptor = openSync(path, 'r')
  try {
    const before = fstatSync(descriptor)
    if (!before.isFile()) {
      throw new Error('The browser evidence artifact must be a regular file.')
    }
    if (before.size < 1 || before.size > MAX_ARTIFACT_BYTES) {
      throw new Error(
        `The browser evidence artifact must contain 1 through ${MAX_ARTIFACT_BYTES} bytes.`
      )
    }
    const bytes = readFileSync(descriptor)
    const after = fstatSync(descriptor)
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.byteLength !== before.size
    ) {
      throw new Error('The browser evidence artifact changed while its snapshot was captured.')
    }
    return {
      bytes,
      sha256: sha256(bytes),
      device: after.dev,
      inode: after.ino,
      size: after.size,
      modifiedAtMs: after.mtimeMs,
      changedAtMs: after.ctimeMs
    }
  } finally {
    closeSync(descriptor)
  }
}

export function assertArtifactSnapshotStable(path, expectedSha256) {
  const current = captureArtifactSnapshot(path)
  if (current.sha256 !== expectedSha256) {
    throw new Error('The browser evidence artifact changed after its snapshot was captured.')
  }
}

async function main() {
  const candidateSha = option('--candidate-sha', process.env.GITHUB_SHA)
  const artifactPath = resolve(option('--artifact', 'dist/index.html'))
  const outputPath = resolve(option('--output', 'browser-environment-evidence.json'))
  const testedUrlValue = option('--url', pathToFileURL(artifactPath).toString())
  const fetchAttempts = Number(option('--fetch-attempts', '12'))
  const fetchDelayMs = Number(option('--fetch-delay-ms', '5000'))
  const fetchTimeoutMs = Number(option('--fetch-timeout-ms', String(DEFAULT_FETCH_TIMEOUT_MS)))
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
  if (!Number.isInteger(fetchTimeoutMs) || fetchTimeoutMs < 1 || fetchTimeoutMs > 120_000) {
    throw new Error('--fetch-timeout-ms must be an integer from 1 through 120000.')
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

  const artifactSnapshot = captureArtifactSnapshot(artifactPath)
  const artifactBytes = artifactSnapshot.bytes
  const artifactSha256 = artifactSnapshot.sha256
  const testedUrlObject = assertSafeEvidenceUrl(testedUrlValue, 'The tested URL')
  const testedUrl = testedUrlObject.toString()
  if (
    testedUrlObject.protocol === 'file:' &&
    realpathSync(fileURLToPath(testedUrlObject)) !== realpathSync(artifactPath)
  ) {
    throw new Error('A file: tested URL must resolve to the exact --artifact path.')
  }

  const fetchExactWithRetries = async () => {
    let fetchFailure
    for (let attempt = 1; attempt <= fetchAttempts; attempt += 1) {
      try {
        return await downloadExactRemoteDocument(testedUrl, {
          expectedSha256: artifactSha256,
          maxBytes: artifactBytes.byteLength,
          timeoutMs: fetchTimeoutMs
        })
      } catch (error) {
        fetchFailure = error
        if (attempt < fetchAttempts) {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, fetchDelayMs))
        }
      }
    }
    throw new Error(
      `Evidence URL did not serve the exact artifact after ${fetchAttempts} attempt(s): ${
        fetchFailure instanceof Error ? fetchFailure.message : 'verification failed'
      }`
    )
  }

  let servedSha256 = artifactSha256
  let servedFinalUrl = testedUrl
  if (testedUrlObject.protocol === 'https:') {
    const servedDocument = await fetchExactWithRetries()
    servedSha256 = servedDocument.sha256
    servedFinalUrl = servedDocument.finalUrl
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
        const context = await browser.newContext({
          locale: locale.browserLocale,
          serviceWorkers: 'block'
        })
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
            for (const constructorName of ['EventSource', 'SharedWorker', 'WebSocket', 'Worker']) {
              Object.defineProperty(globalThis, constructorName, {
                configurable: true,
                value: undefined
              })
            }
          }, locale.applicationLanguage)

          let navigationBytes = artifactBytes
          let navigationUrl = testedUrl
          let navigationSourceSha256 = artifactSha256
          if (testedUrlObject.protocol === 'https:') {
            const liveDocument = await fetchExactWithRetries()
            navigationBytes = liveDocument.bytes
            navigationUrl = liveDocument.finalUrl
            navigationSourceSha256 = liveDocument.sha256
          }
          const navigation = await navigateUsingExactBytes(page, navigationUrl, navigationBytes, {
            timeoutMs: fetchTimeoutMs,
            expectedFinalUrl: navigationUrl
          })
          let observed
          try {
            await page.waitForFunction(
              ({ applicationLanguage, direction }) =>
                globalThis.document.documentElement.lang === applicationLanguage &&
                globalThis.document.documentElement.dir === direction,
              locale,
              { timeout: fetchTimeoutMs }
            )
            observed = await page.evaluate(() => ({
              documentLanguage: globalThis.document.documentElement.lang,
              direction: globalThis.document.documentElement.dir,
              platform: globalThis.navigator.platform,
              navigatorLanguage: globalThis.navigator.language,
              navigatorLanguages: [...globalThis.navigator.languages],
              directoryPickerDisabled: typeof globalThis.showDirectoryPicker === 'undefined',
              openFilePickerDisabled: typeof globalThis.showOpenFilePicker === 'undefined',
              userAgent: globalThis.navigator.userAgent
            }))
            navigation.assertStillBound()
          } finally {
            await navigation.release()
          }
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
            finalUrl: navigation.finalUrl,
            navigationSourceSha256,
            navigationSha256: navigation.navigationSha256,
            navigationBinding: navigation.navigationBinding,
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

  // If another process replaced the path during the browser run, do not write
  // evidence that associates the captured bytes with the now-different file.
  assertArtifactSnapshotStable(artifactPath, artifactSha256)

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
      fileSystemAccessPickerOverrides: 'disabled',
      externalExecutionConstructors: 'disabled',
      mainDocumentBinding: 'recorded-per-navigation',
      remoteBodyByteLimit: artifactBytes.byteLength,
      remoteRequestTimeoutMs: fetchTimeoutMs
    },
    browsers
  }

  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' })
  console.log(
    `Recorded ${browsers.length} browser target(s), browser-bound artifact SHA-256, URL, platform, and EN/AR locale results in ${outputPath}.`
  )
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).toString() === import.meta.url) {
  await main()
}

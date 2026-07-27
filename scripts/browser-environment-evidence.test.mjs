import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { chromium } from '@playwright/test'
import {
  assertArtifactSnapshotStable,
  assertSafeEvidenceUrl,
  assertValidFetchAttempts,
  captureArtifactSnapshot,
  downloadExactRemoteDocument,
  navigateUsingExactBytes,
  readResponseBodyBounded
} from './browser-environment-evidence.mjs'

const scriptPath = fileURLToPath(new URL('./browser-environment-evidence.mjs', import.meta.url))
const repositoryRoot = resolve(dirname(scriptPath), '..')

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function responseWithUrl(body, url, init) {
  const response = new Response(body, init)
  Object.defineProperty(response, 'url', {
    configurable: true,
    value: url
  })
  return response
}

test('fetch-attempt validation accepts the Pages retry window and enforces its boundary', () => {
  assert.doesNotThrow(() => assertValidFetchAttempts(150))
  assert.doesNotThrow(() => assertValidFetchAttempts(240))
  assert.throws(() => assertValidFetchAttempts(241), /integer from 1 through 240/)
})

test(
  'file navigation consumes the captured bytes even when the artifact path changes before goto',
  { timeout: 20_000 },
  async (context) => {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), 'orbitpm-browser-evidence-race-'))
    const artifactPath = join(fixtureDirectory, 'artifact.html')
    context.after(() => rmSync(fixtureDirectory, { recursive: true, force: true }))

    const capturedHtml = Buffer.from(
      '<!doctype html><html><body><script>globalThis.__evidenceMarker="captured"</script></body></html>'
    )
    const replacementHtml = Buffer.from(
      '<!doctype html><html><body><script>globalThis.__evidenceMarker="replacement"</script></body></html>'
    )
    writeFileSync(artifactPath, capturedHtml)
    const snapshot = captureArtifactSnapshot(artifactPath)

    // This is the old TOCTOU window: the pathname now resolves to different
    // bytes, but the browser must consume the already-hashed response snapshot.
    writeFileSync(artifactPath, replacementHtml)

    const browser = await chromium.launch({ headless: true })
    context.after(() => browser.close())
    const browserContext = await browser.newContext({ serviceWorkers: 'block' })
    context.after(() => browserContext.close())
    const page = await browserContext.newPage()
    const navigation = await navigateUsingExactBytes(
      page,
      pathToFileURL(artifactPath).toString(),
      snapshot.bytes
    )
    try {
      assert.equal(await page.evaluate(() => globalThis.__evidenceMarker), 'captured')
      navigation.assertStillBound()
      assert.equal(navigation.navigationSha256, snapshot.sha256)
      assert.equal(hash(readFileSync(artifactPath)), hash(replacementHtml))
      assert.throws(
        () => assertArtifactSnapshotStable(artifactPath, snapshot.sha256),
        /changed after its snapshot/
      )
      await page.evaluate(() => {
        setTimeout(() => globalThis.location.reload(), 0)
      })
      await page.waitForTimeout(50)
      assert.throws(
        () => navigation.assertStillBound(),
        /attempted to leave the exact evidence URL/
      )
    } finally {
      await navigation.release()
    }
  }
)

test('file route fails closed when a browser cannot expose exact consumed bytes', async (context) => {
  const fixtureDirectory = mkdtempSync(join(tmpdir(), 'orbitpm-browser-evidence-fallback-race-'))
  const artifactPath = join(fixtureDirectory, 'artifact.html')
  context.after(() => rmSync(fixtureDirectory, { recursive: true, force: true }))
  const capturedHtml = Buffer.from('<!doctype html><title>captured</title>')
  writeFileSync(artifactPath, capturedHtml)
  const artifactUrl = pathToFileURL(artifactPath).toString()
  const browserContext = {
    on() {},
    off() {},
    async route() {},
    async routeWebSocket() {},
    async unroute() {}
  }

  const pageWithoutFileRouting = {
    context: () => browserContext,
    on() {},
    off() {},
    async route() {},
    async routeWebSocket() {},
    async goto() {
      writeFileSync(artifactPath, '<!doctype html><title>changed during navigation</title>')
      return null
    },
    url() {
      return artifactUrl
    },
    async unroute() {}
  }

  await assert.rejects(
    navigateUsingExactBytes(pageWithoutFileRouting, artifactUrl, capturedHtml),
    /cannot establish exact consumed-byte file evidence/
  )
})

test('streaming response rejects and cancels as soon as it exceeds the byte cap', async () => {
  let cancelled = false
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3]))
        controller.enqueue(Uint8Array.from([4, 5]))
      },
      cancel() {
        cancelled = true
      }
    })
  )

  await assert.rejects(
    readResponseBodyBounded(response, { maxBytes: 4, timeoutMs: 1_000 }),
    /exceeds the 4-byte size limit/
  )
  await new Promise((resolveCancellation) => setImmediate(resolveCancellation))
  assert.equal(cancelled, true)
})

test('streaming response deadline includes a body that never completes', async () => {
  let cancelled = false
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(Uint8Array.from([1]))
      },
      pull() {
        return new Promise(() => undefined)
      },
      cancel() {
        cancelled = true
      }
    })
  )
  const startedAt = Date.now()

  await assert.rejects(
    readResponseBodyBounded(response, { maxBytes: 8, timeoutMs: 25 }),
    /exceeded the 25 ms time limit/
  )
  assert.ok(Date.now() - startedAt < 500, 'the body deadline must be wall-clock bounded')
  await new Promise((resolveCancellation) => setImmediate(resolveCancellation))
  assert.equal(cancelled, true)
})

test('remote download applies the streaming cap before hashing', async () => {
  const response = responseWithUrl(
    new ReadableStream({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3]))
        controller.enqueue(Uint8Array.from([4, 5]))
        controller.close()
      }
    }),
    'https://example.test/app.html'
  )

  await assert.rejects(
    downloadExactRemoteDocument('https://example.test/app.html', {
      expectedSha256: hash(Buffer.from([1, 2, 3, 4])),
      maxBytes: 4,
      timeoutMs: 1_000,
      fetchImplementation: async () => response
    }),
    /exceeds the 4-byte size limit/
  )
})

test('remote download deadline includes waiting for response headers', async () => {
  const expectedBytes = Buffer.from('exact')
  const startedAt = Date.now()
  await assert.rejects(
    downloadExactRemoteDocument('https://example.test/app.html', {
      expectedSha256: hash(expectedBytes),
      maxBytes: expectedBytes.byteLength,
      timeoutMs: 25,
      fetchImplementation: async () => new Promise(() => undefined)
    }),
    /exceeded the 25 ms time limit/
  )
  assert.ok(Date.now() - startedAt < 500, 'the header deadline must be wall-clock bounded')
})

test('remote download rejects redirects before accepting bounded evidence', async () => {
  const expectedBytes = Buffer.from('exact')
  const redirectedResponse = responseWithUrl(expectedBytes, 'https://other.example.test/app.html')
  let redirectMode
  await assert.rejects(
    downloadExactRemoteDocument('https://example.test/app.html', {
      expectedSha256: hash(expectedBytes),
      maxBytes: expectedBytes.byteLength,
      timeoutMs: 1_000,
      fetchImplementation: async (_url, options) => {
        redirectMode = options.redirect
        return redirectedResponse
      }
    }),
    /must not redirect/
  )
  assert.equal(redirectMode, 'error')
})

test('remote navigation only reads the bounded bytes fulfilled by the evidence route', async () => {
  const navigationUrl = 'https://example.test/app.html'
  const expectedBytes = Buffer.from('good')
  const mainFrame = {}
  let routeHandler
  const browserContext = {
    on() {},
    off() {},
    async route(_pattern, handler) {
      routeHandler = handler
    },
    async routeWebSocket() {},
    async unroute() {}
  }
  let continued = false
  let fulfilled = false
  let fulfilledBytes
  const page = {
    context: () => browserContext,
    mainFrame: () => mainFrame,
    on() {},
    off() {},
    async route(_pattern, handler) {
      routeHandler = handler
    },
    async goto() {
      await routeHandler({
        request: () => ({
          isNavigationRequest: () => true,
          resourceType: () => 'document',
          frame: () => mainFrame,
          url: () => navigationUrl
        }),
        async continue() {
          continued = true
        },
        async fulfill(options) {
          fulfilled = true
          fulfilledBytes = options.body
        },
        async abort() {}
      })
      return {
        ok: () => true,
        body: async () => fulfilledBytes
      }
    },
    url: () => navigationUrl,
    async evaluate() {},
    async unroute() {},
    async routeWebSocket() {}
  }

  const navigation = await navigateUsingExactBytes(page, navigationUrl, expectedBytes)
  await navigation.release()
  assert.equal(navigation.navigationSha256, hash(expectedBytes))
  assert.equal(continued, false)
  assert.equal(fulfilled, true)
  assert.deepEqual(fulfilledBytes, expectedBytes)
})

test('browser redirect rejection never echoes a query secret from Playwright', async () => {
  const navigationUrl = 'https://example.test/app.html'
  const secretUrl = 'https://example.test/app.html?token=BROWSER_REDIRECT_SECRET'
  const mainFrame = {}
  let routeHandler
  const browserContext = {
    on() {},
    off() {},
    async route(_pattern, handler) {
      routeHandler = handler
    },
    async routeWebSocket() {},
    async unroute() {}
  }
  const page = {
    context: () => browserContext,
    mainFrame: () => mainFrame,
    on() {},
    off() {},
    async route(_pattern, handler) {
      routeHandler = handler
    },
    async goto() {
      const request = (url) => ({
        isNavigationRequest: () => true,
        resourceType: () => 'document',
        frame: () => mainFrame,
        url: () => url
      })
      await routeHandler({
        request: () => request(navigationUrl),
        async continue() {},
        async fulfill() {},
        async abort() {}
      })
      await routeHandler({
        request: () => request(secretUrl),
        async continue() {},
        async abort() {}
      })
      throw new Error(`Playwright failed at ${secretUrl}`)
    },
    url: () => navigationUrl,
    async unroute() {},
    async routeWebSocket() {}
  }

  await assert.rejects(
    navigateUsingExactBytes(page, navigationUrl, Buffer.from('exact')),
    (error) => {
      assert.equal(error.message.includes('BROWSER_REDIRECT_SECRET'), false)
      return /unsafe navigation URL/.test(error.message)
    }
  )
})

test('fulfilled response-body errors are scrubbed before leaving the evidence helper', async () => {
  const navigationUrl = 'file:///tmp/exact-evidence.html'
  const mainFrame = {}
  let routeHandler
  const browserContext = {
    on() {},
    off() {},
    async route(_pattern, handler) {
      routeHandler = handler
    },
    async routeWebSocket() {},
    async unroute() {}
  }
  const page = {
    context: () => browserContext,
    mainFrame: () => mainFrame,
    on() {},
    off() {},
    async route(_pattern, handler) {
      routeHandler = handler
    },
    async routeWebSocket() {},
    async goto() {
      await routeHandler({
        request: () => ({
          isNavigationRequest: () => true,
          resourceType: () => 'document',
          frame: () => mainFrame,
          url: () => navigationUrl
        }),
        async fulfill() {},
        async abort() {}
      })
      return {
        ok: () => true,
        body: async () => {
          throw new Error('failed at file:///tmp/exact-evidence.html?token=RAW_BODY_SECRET')
        }
      }
    },
    url: () => navigationUrl,
    async evaluate() {},
    async unroute() {}
  }

  await assert.rejects(
    navigateUsingExactBytes(page, navigationUrl, Buffer.from('exact')),
    (error) => {
      assert.equal(error.message.includes('RAW_BODY_SECRET'), false)
      return /response body could not be verified/.test(error.message)
    }
  )
})

test('WebSocket attempts are closed and make browser evidence fail', async () => {
  const navigationUrl = 'https://example.test/app.html'
  const expectedBytes = Buffer.from('exact')
  const mainFrame = {}
  let routeHandler
  let webSocketRouteHandler
  const browserContext = {
    on() {},
    off() {},
    async route(_pattern, handler) {
      routeHandler = handler
    },
    async routeWebSocket(_pattern, handler) {
      webSocketRouteHandler = handler
    },
    async unroute() {}
  }
  let webSocketClosed = false
  let fulfilledBytes
  const page = {
    context: () => browserContext,
    mainFrame: () => mainFrame,
    on() {},
    off() {},
    async route(_pattern, handler) {
      routeHandler = handler
    },
    async routeWebSocket(_pattern, handler) {
      webSocketRouteHandler = handler
    },
    async goto() {
      await routeHandler({
        request: () => ({
          isNavigationRequest: () => true,
          resourceType: () => 'document',
          frame: () => mainFrame,
          url: () => navigationUrl
        }),
        async fulfill(options) {
          fulfilledBytes = options.body
        },
        async abort() {}
      })
      webSocketRouteHandler({
        async close() {
          webSocketClosed = true
        }
      })
      return {
        ok: () => true,
        body: async () => fulfilledBytes
      }
    },
    url: () => navigationUrl,
    async evaluate() {},
    async unroute() {}
  }

  await assert.rejects(
    navigateUsingExactBytes(page, navigationUrl, expectedBytes),
    /attempted to open a WebSocket/
  )
  await new Promise((resolveClosure) => setImmediate(resolveClosure))
  assert.equal(webSocketClosed, true)
})

test('extra pages are closed and make browser evidence fail', async () => {
  const navigationUrl = 'https://example.test/app.html'
  const expectedBytes = Buffer.from('exact')
  const mainFrame = {}
  let contextPageHandler
  let routeHandler
  let extraPageClosed = false
  let extraPageRequestAborted = false
  let fulfilledBytes
  const popupFrame = {}
  const browserContext = {
    on(event, handler) {
      if (event === 'page') contextPageHandler = handler
    },
    off() {},
    async route(_pattern, handler) {
      routeHandler = handler
    },
    async routeWebSocket() {},
    async unroute() {}
  }
  const page = {
    context: () => browserContext,
    mainFrame: () => mainFrame,
    on() {},
    off() {},
    async route(_pattern, handler) {
      routeHandler = handler
    },
    async routeWebSocket() {},
    async goto() {
      await routeHandler({
        request: () => ({
          isNavigationRequest: () => true,
          resourceType: () => 'document',
          frame: () => mainFrame,
          url: () => navigationUrl
        }),
        async fulfill(options) {
          fulfilledBytes = options.body
        },
        async abort() {}
      })
      await routeHandler({
        request: () => ({
          isNavigationRequest: () => true,
          resourceType: () => 'document',
          frame: () => popupFrame,
          url: () => 'https://popup.example.test/'
        }),
        async fulfill() {},
        async abort() {
          extraPageRequestAborted = true
        }
      })
      contextPageHandler({
        async close() {
          extraPageClosed = true
        }
      })
      return {
        ok: () => true,
        body: async () => fulfilledBytes
      }
    },
    url: () => navigationUrl,
    async evaluate() {},
    async unroute() {}
  }

  await assert.rejects(
    navigateUsingExactBytes(page, navigationUrl, expectedBytes),
    /requested an external subresource/
  )
  await new Promise((resolveClosure) => setImmediate(resolveClosure))
  assert.equal(extraPageRequestAborted, true)
  assert.equal(extraPageClosed, true)
})

test('credentials, query strings, fragments, and secret-bearing redirects are rejected safely', async () => {
  const unsafeUrls = [
    ['https://release-user:credential-value@example.test/app.html', 'credential-value'],
    ['https://example.test/app.html?token=query-secret', 'query-secret'],
    ['https://example.test/app.html#fragment-secret', 'fragment-secret'],
    ['https://example.test/app.html?', ''],
    ['https://example.test/app.html#', '']
  ]
  for (const [unsafeUrl, secret] of unsafeUrls) {
    assert.throws(
      () => assertSafeEvidenceUrl(unsafeUrl),
      (error) => {
        if (secret) assert.equal(error.message.includes(secret), false)
        return /credentials|query string or fragment/.test(error.message)
      }
    )
  }

  const body = Buffer.from('exact')
  const redirectResponse = responseWithUrl(
    body,
    'https://example.test/app.html?signature=redirect-secret'
  )
  await assert.rejects(
    downloadExactRemoteDocument('https://example.test/app.html', {
      expectedSha256: hash(body),
      maxBytes: body.byteLength,
      timeoutMs: 1_000,
      fetchImplementation: async () => redirectResponse
    }),
    (error) => {
      assert.equal(error.message.includes('redirect-secret'), false)
      return /query string or fragment/.test(error.message)
    }
  )
})

test('CLI validation does not echo a secret-bearing tested URL', () => {
  const fixtureDirectory = mkdtempSync(join(tmpdir(), 'orbitpm-browser-evidence-secret-'))
  const artifactPath = join(fixtureDirectory, 'artifact.html')
  const outputPath = join(fixtureDirectory, 'evidence.json')
  writeFileSync(artifactPath, '<!doctype html><html lang="en" dir="ltr"></html>')
  try {
    const secret = 'DO_NOT_PRINT_THIS_TOKEN'
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--candidate-sha=0000000000000000000000000000000000000000',
        `--artifact=${artifactPath}`,
        `--url=https://example.test/app.html?token=${secret}`,
        '--browsers=chromium',
        `--output=${outputPath}`
      ],
      {
        cwd: repositoryRoot,
        encoding: 'utf8'
      }
    )
    const processOutput = `${result.stdout ?? ''}${result.stderr ?? ''}`
    assert.notEqual(result.status, 0)
    assert.equal(processOutput.includes(secret), false)
    assert.match(processOutput, /must not include a query string or fragment/)
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true })
  }
})

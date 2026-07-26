import { expect, test } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()
const BLOCKED_ORIGIN = 'https://orbitpm-csp-probe.invalid'
const BLOCKED_URL = `${BLOCKED_ORIGIN}/must-not-reach-playwright-route`

test.beforeAll(() => {
  const html = readFileSync(DIST, 'utf8')
  expect(html.length, 'dist/index.html should be a multi-hundred-KB single file').toBeGreaterThan(
    500_000
  )
})

test('BUILT dist rejects unapproved egress before a request reaches the network', async ({
  page
}) => {
  let interceptedRequests = 0

  await page.route(BLOCKED_URL, async (route) => {
    interceptedRequests += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ unexpectedlyReachedRoute: true })
    })
  })

  await page.goto(FILE_URL, { waitUntil: 'load' })

  const probe = await page.evaluate(
    async ({ blockedOrigin, blockedUrl }) => {
      const violationPromise = new Promise<{
        blockedURI: string
        effectiveDirective: string
        violatedDirective: string
      } | null>((resolveViolation) => {
        const timeout = window.setTimeout(() => resolveViolation(null), 5_000)

        document.addEventListener(
          'securitypolicyviolation',
          (event) => {
            if (!event.blockedURI.startsWith(blockedOrigin)) return

            window.clearTimeout(timeout)
            resolveViolation({
              blockedURI: event.blockedURI,
              effectiveDirective: event.effectiveDirective,
              violatedDirective: event.violatedDirective
            })
          },
          { once: true }
        )
      })

      const fetchOutcome = await window
        .fetch(blockedUrl, { cache: 'no-store', mode: 'cors' })
        .then(() => ({ status: 'fulfilled' as const, errorName: '', errorMessage: '' }))
        .catch((error: unknown) => ({
          status: 'rejected' as const,
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error)
        }))

      return {
        fetchOutcome,
        violation: await violationPromise
      }
    },
    { blockedOrigin: BLOCKED_ORIGIN, blockedUrl: BLOCKED_URL }
  )

  expect(probe.fetchOutcome.status, 'the disallowed fetch must reject').toBe('rejected')
  expect(probe.fetchOutcome.errorName, 'the browser must surface a real fetch rejection').not.toBe(
    ''
  )
  expect(probe.violation, 'the document must emit securitypolicyviolation').not.toBeNull()
  expect(probe.violation?.blockedURI).toContain(BLOCKED_ORIGIN)
  expect(
    [probe.violation?.effectiveDirective, probe.violation?.violatedDirective],
    'the runtime violation must be attributed to connect-src'
  ).toContain('connect-src')

  await page.waitForTimeout(100)
  expect(
    interceptedRequests,
    'CSP must stop the request before Playwright can intercept any network route'
  ).toBe(0)
})

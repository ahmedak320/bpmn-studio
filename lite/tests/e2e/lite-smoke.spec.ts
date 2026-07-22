import { test, expect } from '@playwright/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

// The BUILT single file (must be built first: `cd lite && npm run build`).
const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()

test.beforeAll(() => {
  // Fail fast with a clear message if the artifact isn't built.
  const html = readFileSync(DIST, 'utf8')
  expect(html.length, 'dist/index.html should be a multi-hundred-KB single file').toBeGreaterThan(
    500_000
  )
})

test('loads self-contained, renders bpmn-js, and exports SVG (fallback mode)', async ({ page }) => {
  // 1) Record every request. The ONLY load-time request allowed is the main
  //    document itself; anything else (http/https, or an extra file:// asset)
  //    would mean the page is not self-contained.
  const offending: string[] = []
  page.on('request', (req) => {
    const url = req.url()
    if (url === FILE_URL) return // the document navigation itself
    if (url.startsWith('data:') || url.startsWith('blob:')) return // inlined, not network
    offending.push(`${req.method()} ${url}`)
  })

  // Force the single-file fallback path (the File System Access folder picker
  // opens a native dialog that can't be automated). Removing showDirectoryPicker
  // makes directoryPickerSupported() false → the app offers "New blank diagram".
  await page.addInitScript(() => {
    // @ts-expect-error deleting an optional global for the test
    delete window.showDirectoryPicker
    // @ts-expect-error deleting an optional global for the test
    delete window.showOpenFilePicker
  })

  await page.goto(FILE_URL, { waitUntil: 'load' })

  // 2) Page renders.
  await expect(page.getByRole('heading', { name: 'OrbitPM Process Studio Lite' })).toBeVisible()
  await expect(page.getByRole('button', { name: /New blank diagram/i })).toBeVisible()

  // 3) Zero network/sub-resource requests during load — proves self-containment.
  expect(offending, `unexpected load-time requests: ${offending.join(', ')}`).toEqual([])

  // 4) Create a new diagram in-memory (fallback), then bpmn-js must render shapes.
  await page.getByRole('button', { name: /New blank diagram/i }).click()

  const canvas = page.locator('.djs-container svg').first()
  await expect(canvas).toBeVisible({ timeout: 20_000 })

  // The blank template has a start event (rendered as an SVG <circle>) plus its
  // label — at least one diagram shape element must be present.
  await expect(page.locator('.djs-element').first()).toBeVisible({ timeout: 20_000 })
  const circleCount = await page.locator('.djs-container svg circle').count()
  expect(circleCount, 'start-event circle should render').toBeGreaterThan(0)

  // 5) Export SVG produces real SVG content (download-on-save fallback).
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export SVG' }).click()
  ])
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const svg = Buffer.concat(chunks).toString('utf8')
  expect(svg).toContain('<svg')
  expect(svg.length).toBeGreaterThan(500)

  // 6) Still no stray network requests after interacting.
  expect(offending, `unexpected requests after interaction: ${offending.join(', ')}`).toEqual([])
})

test('AI panel documents the browser-only provider limitation', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error test-only
    delete window.showDirectoryPicker
  })
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page.getByRole('button', { name: /New blank diagram/i }).click()

  // The AI panel (right zone) names the two browser-capable providers and the
  // desktop-only ones.
  await expect(page.getByText(/Only\s+Anthropic\s+and\s+Gemini/i)).toBeVisible()
  await expect(page.getByText(/don.?t allow browser \(CORS\) access/i)).toBeVisible()
})

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

/** Attach a request recorder that flags any load/runtime request that is not
 *  the document navigation itself or an inlined data:/blob: URI. Returns the
 *  live array of offending requests. */
function recordOffendingRequests(page: import('@playwright/test').Page): string[] {
  const offending: string[] = []
  page.on('request', (req) => {
    const url = req.url()
    if (url === FILE_URL) return // the document navigation itself
    if (url.startsWith('data:') || url.startsWith('blob:')) return // inlined, not network
    offending.push(`${req.method()} ${url}`)
  })
  return offending
}

/** Force the single-file fallback path (the File System Access folder picker
 *  opens a native dialog that can't be automated). Removing showDirectoryPicker
 *  makes directoryPickerSupported() false. */
async function forceFallbackMode(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    // @ts-expect-error deleting an optional global for the test
    delete window.showDirectoryPicker
    // @ts-expect-error deleting an optional global for the test
    delete window.showOpenFilePicker
  })
}

/** Opening a diagram auto-collapses the left sidebar (which now holds the AI
 *  generator). Restore it via the rail, then expand the AI section if a stored
 *  pref left it collapsed, so the AI form body is on screen. */
async function expandAiPanel(page: import('@playwright/test').Page): Promise<void> {
  const aside = page.locator('aside')
  if (!(await aside.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Toggle side panel' }).click()
    await expect(aside).toBeVisible()
  }
  const aiHeader = page.getByRole('button', { name: /Generate with AI/i })
  if ((await aiHeader.getAttribute('aria-expanded')) === 'false') {
    await aiHeader.click()
  }
}

test('loads self-contained, renders bpmn-js, and exports SVG (fallback mode)', async ({ page }) => {
  // 1) Record every request. The ONLY load-time request allowed is the main
  //    document itself; anything else would mean the page is not self-contained.
  const offending = recordOffendingRequests(page)
  await forceFallbackMode(page)

  await page.goto(FILE_URL, { waitUntil: 'load' })

  // 2) Page renders, with the always-present New-process affordance + the quick
  //    "New blank diagram" path.
  await expect(page.getByRole('heading', { name: 'OrbitPM Process Studio Lite' })).toBeVisible()
  await expect(page.getByRole('button', { name: /New process/i }).first()).toBeVisible()
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

test('New process flow (fallback): modal → full palette → add a task → undo → export', async ({
  page
}) => {
  const offending = recordOffendingRequests(page)
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })

  // (a) The New-process button is visible with no file open; clicking it opens
  //     the name modal.
  await page.getByRole('button', { name: /New process/i }).first().click()
  const dialog = page.getByRole('dialog', { name: /New Process/i })
  await expect(dialog).toBeVisible()

  // Focus management: the input is autofocused + selected, so typing replaces
  // the suggested name.
  const input = dialog.getByRole('textbox')
  await expect(input).toBeFocused()
  await input.fill('Invoice Approval')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()

  // (b) The canvas renders with the start event.
  const svg = page.locator('.djs-container svg').first()
  await expect(svg).toBeVisible({ timeout: 20_000 })
  expect(await page.locator('.djs-container svg circle').count()).toBeGreaterThan(0)

  // The brand-new-diagram hint overlay is shown.
  await expect(page.getByText('Start drawing')).toBeVisible()

  // (c) Full default palette is present (FIX 2 completeness): events, task,
  //     gateway, sub-process, pool (participant) and data object.
  const palette = page.locator('.djs-palette')
  for (const action of [
    'create.start-event',
    'create.end-event',
    'create.intermediate-event',
    'create.task',
    'create.exclusive-gateway',
    'create.subprocess-expanded',
    'create.participant-expanded',
    'create.data-object',
    'create.data-store'
  ]) {
    await expect(palette.locator(`[data-action="${action}"]`)).toBeVisible()
  }

  // (d) Programmatic modeling via the exposed automation hook, with UI-visible
  //     effects. Count diagram elements before/after so we don't depend on ids.
  await page.waitForFunction(() => {
    const w = window as unknown as { __ORBITPM_LITE__?: { modeler?: unknown } }
    return !!w.__ORBITPM_LITE__?.modeler
  })
  const before = await page.locator('.djs-element').count()

  await page.evaluate(() => {
    const w = window as unknown as {
      __ORBITPM_LITE__: { modeler: { get(name: string): unknown } }
    }
    const m = w.__ORBITPM_LITE__.modeler
    const modeling = m.get('modeling') as {
      createShape(shape: unknown, pos: { x: number; y: number }, parent: unknown): unknown
    }
    const elementFactory = m.get('elementFactory') as {
      createShape(attrs: { type: string }): unknown
    }
    const canvas = m.get('canvas') as { getRootElement(): unknown }
    const task = elementFactory.createShape({ type: 'bpmn:Task' })
    modeling.createShape(task, { x: 420, y: 220 }, canvas.getRootElement())
  })

  // UI reflects the change: an extra element, the dirty flag, and the hint gone.
  await expect(page.locator('.djs-element')).toHaveCount(before + 1)
  await expect(page.getByText('Unsaved changes')).toBeVisible()
  await expect(page.getByText('Start drawing')).toHaveCount(0)

  // (e) Keyboard shortcuts work (auto-bound to the focusable canvas SVG in
  //     bpmn-js 18): focus the canvas and Ctrl+Z undoes the task.
  await svg.focus()
  await page.keyboard.press('Control+z')
  await expect(page.locator('.djs-element')).toHaveCount(before)
  await expect(page.getByText('Saved')).toBeVisible()
  // Dismissed hint must NOT reappear now that the diagram is "clean" again.
  await expect(page.getByText('Start drawing')).toHaveCount(0)

  // (f) Export SVG downloads real content.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export SVG' }).click()
  ])
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const out = Buffer.concat(chunks).toString('utf8')
  expect(out).toContain('<svg')
  expect(out.length).toBeGreaterThan(500)

  // (g) Everything above ran with zero stray network requests.
  expect(offending, `unexpected requests: ${offending.join(', ')}`).toEqual([])
})

test('Escape closes the New-process modal', async ({ page }) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })

  await page.getByRole('button', { name: /New process/i }).first().click()
  const dialog = page.getByRole('dialog', { name: /New Process/i })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('AI panel documents the browser-only provider limitation', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error test-only
    delete window.showDirectoryPicker
  })
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page.getByRole('button', { name: /New blank diagram/i }).click()
  await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })

  // Opening the diagram collapsed the sidebar; the AI generator now lives in its
  // bottom section, so restore it before asserting on its copy.
  await expandAiPanel(page)

  // The AI panel names the browser-capable providers (now Anthropic, Gemini AND
  // OpenRouter) and the desktop-only ones. The exhaustive copy check lives in
  // lite-providers.spec.ts; here we just assert the note is present and still
  // warns about the CORS-gated providers.
  await expect(page.getByText(/can be called directly from a web page/i)).toBeVisible()
  await expect(page.getByText(/don.?t allow browser \(CORS\) access/i)).toBeVisible()
})

test('sidebar auto-collapses on open and the rail restores it', async ({ page }) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })

  // Create a new process via the dialog flow (the fallback landing shows the
  // workspace picker, not the main layout, so the sidebar only exists once a
  // diagram is open).
  const aside = page.locator('aside')
  await page.getByRole('button', { name: /New process/i }).first().click()
  const dialog = page.getByRole('dialog', { name: /New Process/i })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox').fill('Sidebar Demo')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()

  // The diagram opens and the sidebar auto-collapses to the rail.
  await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })
  await expect(aside).toBeHidden()

  // Clicking the rail restores the sidebar.
  await page.getByRole('button', { name: 'Toggle side panel' }).click()
  await expect(aside).toBeVisible()
})

import { test, expect } from '@playwright/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'

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
  expect(
    readdirSync(dirname(DIST)).sort(),
    'the release artifact must contain exactly one self-contained HTML file'
  ).toEqual(['index.html'])
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
    delete window.showDirectoryPicker
    delete window.showOpenFilePicker
  })
}

async function expectBpmnAttributionUnobscured(
  page: import('@playwright/test').Page,
  label: string
): Promise<void> {
  const attribution = page.locator('a.bjs-powered-by').first()
  await expect(attribution, `${label}: powered-by link must remain visible`).toBeVisible()
  await expect(attribution).toHaveAttribute('href', 'http://bpmn.io')
  const attributionBox = await attribution.boundingBox()
  expect(attributionBox?.width, `${label}: attribution must have rendered width`).toBeGreaterThan(0)
  expect(attributionBox?.height, `${label}: attribution must have rendered height`).toBeGreaterThan(
    0
  )
  const attributionVisibility = await attribution.evaluate((element) => {
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
        Number(computed.opacity) > 0,
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
  expect(attributionVisibility.rendered, `${label}: attribution must be rendered`).toBe(true)
  expect(attributionVisibility.insideViewport, `${label}: attribution must be fully visible`).toBe(
    true
  )
  expect(attributionVisibility.unobscured, `${label}: attribution must not be overlapped`).toBe(
    true
  )

  const clip = {
    x: Math.max(0, attributionBox!.x),
    y: Math.max(0, attributionBox!.y),
    width: attributionBox!.width,
    height: attributionBox!.height
  }
  const visiblePixels = await page.screenshot({ clip, animations: 'disabled' })
  const previousOpacity = await attribution.evaluate((element) => {
    const htmlElement = element as HTMLElement
    const previous = {
      value: htmlElement.style.getPropertyValue('opacity'),
      priority: htmlElement.style.getPropertyPriority('opacity')
    }
    htmlElement.style.setProperty('opacity', '0', 'important')
    return previous
  })
  let pixelsWithoutAttribution: Buffer
  try {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        })
    )
    pixelsWithoutAttribution = await page.screenshot({ clip, animations: 'disabled' })
  } finally {
    await attribution.evaluate((element, previous) => {
      const htmlElement = element as HTMLElement
      if (previous.value) {
        htmlElement.style.setProperty('opacity', previous.value, previous.priority)
      } else {
        htmlElement.style.removeProperty('opacity')
      }
    }, previousOpacity)
  }

  const compositingDifference = await page.evaluate(
    async ({ visibleBase64, hiddenBase64 }) => {
      const decode = async (base64: string): Promise<ImageData> => {
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index)
        }
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) throw new Error('2D canvas context unavailable for attribution audit')
        context.drawImage(bitmap, 0, 0)
        bitmap.close()
        return context.getImageData(0, 0, canvas.width, canvas.height)
      }

      const visible = await decode(visibleBase64)
      const hidden = await decode(hiddenBase64)
      if (visible.width !== hidden.width || visible.height !== hidden.height) {
        return { differentPixels: 0, totalPixels: 0, sameDimensions: false }
      }
      let differentPixels = 0
      for (let index = 0; index < visible.data.length; index += 4) {
        if (
          visible.data[index] !== hidden.data[index] ||
          visible.data[index + 1] !== hidden.data[index + 1] ||
          visible.data[index + 2] !== hidden.data[index + 2] ||
          visible.data[index + 3] !== hidden.data[index + 3]
        ) {
          differentPixels += 1
        }
      }
      return {
        differentPixels,
        totalPixels: visible.width * visible.height,
        sameDimensions: true
      }
    },
    {
      visibleBase64: visiblePixels.toString('base64'),
      hiddenBase64: pixelsWithoutAttribution.toString('base64')
    }
  )
  expect(
    compositingDifference.sameDimensions,
    `${label}: browser-composited attribution samples must have matching dimensions`
  ).toBe(true)
  expect(
    compositingDifference.differentPixels,
    `${label}: hiding the attribution must change browser-composited pixels`
  ).toBeGreaterThan(16)
}

async function expectBpmnAttributionRetainedBeneathModal(
  page: import('@playwright/test').Page,
  label: string
): Promise<void> {
  const attribution = page.locator('a.bjs-powered-by').first()
  await expect(attribution, `${label}: powered-by link must remain in the DOM`).toBeAttached()
  await expect(attribution).toHaveAttribute('href', 'http://bpmn.io')
  const state = await attribution.evaluate((element) => {
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
      hasLayoutBox: rect.width > 0 && rect.height > 0,
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
  expect(state.hasLayoutBox, `${label}: attribution must retain its layout box`).toBe(true)
  expect(state.insideViewport, `${label}: attribution layout must remain in the viewport`).toBe(
    true
  )
  expect(
    state.coveredByActiveModal,
    `${label}: the active modal, rather than unrelated UI, must be the covering surface`
  ).toBe(true)
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

  const canvas = page.locator('.djs-container > svg').first()
  await expect(canvas).toBeVisible({ timeout: 20_000 })

  await expectBpmnAttributionUnobscured(page, 'assistant closed')
  await page.getByRole('button', { name: 'Ask the process assistant', exact: true }).click()
  const assistant = page.getByRole('dialog', { name: 'Process assistant', exact: true })
  await expect(assistant).toBeVisible()
  await expect(assistant).toHaveAttribute('aria-modal', 'true')
  await expectBpmnAttributionRetainedBeneathModal(page, 'assistant open')
  await page.getByRole('button', { name: 'Close assistant', exact: true }).click()
  await expectBpmnAttributionUnobscured(page, 'assistant closed again')

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

test('keeps bpmn.io attribution unobscured before and after responsive and RTL modals', async ({
  browser
}) => {
  const variants = [
    { name: 'desktop-ltr', language: 'en', viewport: { width: 1280, height: 720 } },
    { name: 'mobile-ltr', language: 'en', viewport: { width: 390, height: 844 } },
    { name: 'mobile-rtl', language: 'ar', viewport: { width: 390, height: 844 } }
  ]

  for (const variant of variants) {
    // Each viewport/language variant represents a fresh launch. A separate
    // context prevents IndexedDB recovery drafts and UI preferences from one
    // variant leaking into the next.
    const context = await browser.newContext({ viewport: variant.viewport })
    const page = await context.newPage()
    try {
      await forceFallbackMode(page)
      await page.addInitScript((language) => {
        localStorage.setItem('orbitpm.lite.lang', language)
      }, variant.language)
      await page.goto(FILE_URL, { waitUntil: 'load' })
      const blankName = variant.language === 'ar' ? 'مخطط فارغ جديد' : 'New blank diagram'
      await page.getByRole('button', { name: blankName, exact: true }).click()
      await expect(page.locator('.djs-container > svg').first()).toBeVisible({ timeout: 20_000 })

      await expectBpmnAttributionUnobscured(page, `${variant.name}/assistant-closed`)
      const openName =
        variant.language === 'ar' ? 'اسأل مساعد العمليات' : 'Ask the process assistant'
      const drawerName = variant.language === 'ar' ? 'مساعد العمليات' : 'Process assistant'
      await page.getByRole('button', { name: openName, exact: true }).click()
      const assistant = page.getByRole('dialog', { name: drawerName, exact: true })
      await expect(assistant).toBeVisible()
      await expect(assistant).toHaveAttribute('aria-modal', 'true')
      await expectBpmnAttributionRetainedBeneathModal(page, `${variant.name}/assistant-open`)
      const closeName = variant.language === 'ar' ? 'إغلاق المساعد' : 'Close assistant'
      await page.getByRole('button', { name: closeName, exact: true }).click()
      await expectBpmnAttributionUnobscured(page, `${variant.name}/assistant-closed-again`)
    } finally {
      await context.close()
    }
  }
})

test('New process flow (fallback): modal → full palette → add a task → undo → export', async ({
  page
}) => {
  const offending = recordOffendingRequests(page)
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })

  // (a) The New-process button is visible with no file open; clicking it opens
  //     the name modal.
  await page
    .getByRole('button', { name: /New process/i })
    .first()
    .click()
  const dialog = page.getByRole('dialog', { name: /New Process/i })
  await expect(dialog).toBeVisible()

  // Focus management: the input is autofocused + selected, so typing replaces
  // the suggested name.
  const input = dialog.getByRole('textbox')
  await expect(input).toBeFocused()
  await input.fill('Invoice Approval')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()

  // (b) The canvas renders with the start event.
  const svg = page.locator('.djs-container > svg').first()
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

  await page
    .getByRole('button', { name: /New process/i })
    .first()
    .click()
  const dialog = page.getByRole('dialog', { name: /New Process/i })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('AI panel documents the browser-only provider limitation', async ({ page }) => {
  await page.addInitScript(() => {
    delete window.showDirectoryPicker
  })
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page.getByRole('button', { name: /New blank diagram/i }).click()
  await expect(page.locator('.djs-container > svg').first()).toBeVisible({ timeout: 20_000 })

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
  await page
    .getByRole('button', { name: /New process/i })
    .first()
    .click()
  const dialog = page.getByRole('dialog', { name: /New Process/i })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox').fill('Sidebar Demo')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()

  // The diagram opens and the sidebar auto-collapses to the rail.
  await expect(page.locator('.djs-container > svg').first()).toBeVisible({ timeout: 20_000 })
  await expect(aside).toBeHidden()

  // Clicking the rail restores the sidebar.
  await page.getByRole('button', { name: 'Toggle side panel' }).click()
  await expect(aside).toBeVisible()
})

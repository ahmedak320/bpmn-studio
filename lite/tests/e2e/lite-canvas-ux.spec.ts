import { test, expect, type Page } from '@playwright/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// Canvas-surface UX of the feature wave: missing-info badges (+ the delegated
// tooltip), the sub-process chip marker swap, start/end event restyle, the
// disabled edge auto-pan, direct-label -> orbitpm:nameEn mirroring, and the
// keyless free-translate chain (stubbed endpoints).
//
// Follows the house pattern (lite-org.spec.ts / lite-smoke.spec.ts): BUILT
// single file over file://, forced fallback mode, programmatic modeling via
// the window.__ORBITPM_LITE__ automation hook. The free-translate tests serve
// the same dist over http://127.0.0.1 (lite-live-cors pattern) so the page has
// a real Origin while Playwright routing stubs the two translation hosts.

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()

test.beforeAll(() => {
  const html = readFileSync(DIST, 'utf8')
  expect(html.length, 'dist/index.html should be a multi-hundred-KB single file').toBeGreaterThan(
    500_000
  )
})

/** Force the single-file fallback path (the folder picker opens a native
 *  dialog that can't be automated). */
async function forceFallbackMode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // @ts-expect-error deleting an optional global for the test
    delete window.showDirectoryPicker
    // @ts-expect-error deleting an optional global for the test
    delete window.showOpenFilePicker
  })
}

/** Create a new process via the New-process modal and wait for the modeler. */
async function newProcess(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /New process/i }).first().click()
  const dialog = page.getByRole('dialog', { name: /New Process/i })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox').fill(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForFunction(() => {
    const w = window as unknown as { __ORBITPM_LITE__?: { modeler?: unknown } }
    return !!w.__ORBITPM_LITE__?.modeler
  })
}

interface HookWindow {
  __ORBITPM_LITE__: { modeler: { get(name: string): unknown } }
}

/** Create a shape via the automation hook, refit the viewport so it is on
 *  screen, and return its element id. */
async function createShape(
  page: Page,
  type: string,
  pos: { x: number; y: number },
  extra?: Record<string, unknown>
): Promise<string> {
  return page.evaluate(
    ({ type, pos, extra }) => {
      const w = window as unknown as HookWindow
      const m = w.__ORBITPM_LITE__.modeler
      const modeling = m.get('modeling') as {
        createShape(shape: unknown, pos: { x: number; y: number }, parent: unknown): { id: string }
      }
      const elementFactory = m.get('elementFactory') as {
        createShape(attrs: Record<string, unknown>): unknown
      }
      const canvas = m.get('canvas') as {
        getRootElement(): unknown
        zoom(mode: 'fit-viewport'): void
      }
      const shape = elementFactory.createShape({ type, ...(extra ?? {}) })
      const placed = modeling.createShape(shape, pos, canvas.getRootElement())
      canvas.zoom('fit-viewport')
      return placed.id
    },
    { type, pos, extra }
  )
}

/** name / orbitpm:nameEn / orbitpm:nameAr of an element's business object. */
async function readNames(
  page: Page,
  id: string
): Promise<{ name: string | null; nameEn: string | null; nameAr: string | null }> {
  return page.evaluate((elementId) => {
    const w = window as unknown as HookWindow
    const m = w.__ORBITPM_LITE__.modeler
    const registry = m.get('elementRegistry') as {
      get(id: string): { businessObject?: Record<string, unknown> } | undefined
    }
    const bo = registry.get(elementId)?.businessObject as
      | {
          name?: unknown
          get?(key: string): unknown
          $attrs?: Record<string, unknown>
        }
      | undefined
    const attr = (key: string): string | null => {
      const viaGet = typeof bo?.get === 'function' ? bo.get(key) : undefined
      const value = viaGet ?? bo?.$attrs?.[key]
      return typeof value === 'string' ? value : null
    }
    return {
      name: typeof bo?.name === 'string' ? bo.name : null,
      nameEn: attr('orbitpm:nameEn'),
      nameAr: attr('orbitpm:nameAr')
    }
  }, id)
}

// ---------------------------------------------------------------------------
// Missing-info badge + start/end restyle
// ---------------------------------------------------------------------------

test('missing-info badges carry tooltip/missing data (no native <title>); start/end events are restyled', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Badge Demo')

  // The template's start event is missing its trigger -> it gets a badge.
  const startId = await page.evaluate(() => {
    const w = window as unknown as HookWindow
    const registry = w.__ORBITPM_LITE__.modeler.get('elementRegistry') as {
      getAll(): Array<{ type?: string; id: string; labelTarget?: unknown }>
    }
    return registry.getAll().find((e) => e.type === 'bpmn:StartEvent' && !e.labelTarget)?.id ?? ''
  })
  expect(startId).not.toBe('')
  const startGfx = page.locator(`.djs-element[data-element-id="${startId}"]`)
  const startBadge = startGfx.locator('g.orbitpm-missing-badge')
  await expect(startBadge).toBeVisible()
  await expect(startBadge).toHaveAttribute('data-org-missing', 'trigger')

  // A fresh task is missing owner/inputs/outputs -> "!3" badge with the full
  // localized tooltip text (incl. the click-to-complete action line), a
  // pointer cursor, and NO native <title> child (the delegated tooltip
  // replaced it).
  const taskId = await createShape(page, 'bpmn:Task', { x: 420, y: 220 })
  const taskGfx = page.locator(`.djs-element[data-element-id="${taskId}"]`)
  const badge = taskGfx.locator('g.orbitpm-missing-badge')
  await expect(badge).toBeVisible()
  await expect(badge).toHaveAttribute('data-org-missing', 'owner,inputs,outputs')
  // tiny-svg maps `cursor` onto the inline STYLE (CSS_PROPERTIES table), so
  // assert the computed style rather than an attribute.
  await expect(badge).toHaveCSS('cursor', 'pointer')
  await expect(badge).toHaveAttribute(
    'data-org-tooltip',
    /Missing: responsible party, inputs, outputs/
  )
  await expect(badge).toHaveAttribute('data-org-tooltip', /Click to complete these details/)
  await expect(badge.locator('title')).toHaveCount(0)
  await expect(badge.locator('text')).toHaveText('!3')

  // Start/end restyle (org renderer eventStyle): green go / red stop.
  // tiny-svg writes fill/stroke as inline styles (CSS_PROPERTIES), so assert
  // computed CSS: #1e9e62/#e3f4ea and #c0504d/#fdeaea in rgb() form.
  const startCircle = startGfx.locator('.djs-visual circle').first()
  await expect(startCircle).toHaveCSS('stroke', 'rgb(30, 158, 98)')
  await expect(startCircle).toHaveCSS('fill', 'rgb(227, 244, 234)')

  const endId = await createShape(page, 'bpmn:EndEvent', { x: 620, y: 220 })
  const endCircle = page
    .locator(`.djs-element[data-element-id="${endId}"]`)
    .locator('.djs-visual circle')
    .first()
  await expect(endCircle).toHaveCSS('stroke', 'rgb(192, 80, 77)')
  await expect(endCircle).toHaveCSS('fill', 'rgb(253, 234, 234)')
})

// ---------------------------------------------------------------------------
// Delegated hover tooltip
// ---------------------------------------------------------------------------

test('delegated tooltip shows on badge pointerover and hides on wheel/pointerdown (synthetic events)', async ({
  page
}) => {
  // NOTE: this test drives canvasDecor's delegated listeners by dispatching
  // events WITH THE BADGE AS TARGET. Real-pointer delivery is covered (and
  // currently red) in the next test — see the pointer-events finding there.
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Tooltip Demo')

  const taskId = await createShape(page, 'bpmn:Task', { x: 420, y: 220 })
  const badge = page
    .locator(`.djs-element[data-element-id="${taskId}"]`)
    .locator('g.orbitpm-missing-badge')
  await expect(badge).toBeVisible()

  const hoverBadge = () =>
    badge.evaluate((el) => el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })))
  const dispatchOnCanvasSvg = (kind: 'wheel' | 'pointerdown') =>
    page.evaluate((eventKind) => {
      const svg = document.querySelector('.djs-container svg')
      if (!svg) return
      svg.dispatchEvent(
        eventKind === 'wheel'
          ? new WheelEvent('wheel', { bubbles: true, deltaY: 120 })
          : new PointerEvent('pointerdown', { bubbles: true })
      )
    }, kind)

  // pointerover on the badge -> the floating tooltip div appears inside the
  // editor root: role=tooltip, fixed positioning, the badge's full text.
  await hoverBadge()
  const tooltip = page.locator('.orbitpm-editor .orbitpm-canvas-tooltip')
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toHaveAttribute('role', 'tooltip')
  await expect(tooltip).toHaveCSS('position', 'fixed')
  await expect(tooltip).toContainText('Missing: responsible party, inputs, outputs')
  await expect(tooltip).toContainText('Click to complete these details')

  // Wheel (pan/zoom would invalidate the fixed position) -> hidden.
  await dispatchOnCanvasSvg('wheel')
  await expect(tooltip).toBeHidden()

  // Shown again on re-hover; any pointerdown hides it immediately.
  await hoverBadge()
  await expect(tooltip).toBeVisible()
  await dispatchOnCanvasSvg('pointerdown')
  await expect(tooltip).toBeHidden()
})

test('badge is reachable by a REAL pointer and hovering it shows the tooltip', async ({ page }) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Tooltip Hit Demo')

  const taskId = await createShape(page, 'bpmn:Task', { x: 420, y: 220 })
  const badge = page
    .locator(`.djs-element[data-element-id="${taskId}"]`)
    .locator('g.orbitpm-missing-badge')
  await expect(badge).toBeVisible()

  // Hit-test at the badge center: a real pointer event must target the badge
  // subtree, otherwise the delegated tooltip/click can never fire for users.
  // KNOWN GAP as of this wave: diagram-js.css sets
  // `.djs-visual, .djs-outline { pointer-events: none; }` and the badge is
  // appended INSIDE .djs-visual, so it inherits pointer-events:none and
  // document.elementFromPoint() falls through to the root <svg>.
  const hit = await badge.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return {
      pointerEvents: getComputedStyle(el).pointerEvents,
      hitTag: target ? target.tagName.toLowerCase() : null,
      insideBadge: !!(target && target.closest('.orbitpm-missing-badge'))
    }
  })
  expect(
    hit.insideBadge,
    `badge center must hit-test to the badge itself, got <${hit.hitTag}> ` +
      `(badge computed pointer-events: ${hit.pointerEvents} — inherited from .djs-visual)`
  ).toBe(true)

  // With hit-testing intact a plain hover must produce the tooltip.
  await badge.hover()
  await expect(page.locator('.orbitpm-editor .orbitpm-canvas-tooltip')).toBeVisible()
})

// ---------------------------------------------------------------------------
// Sub-process chip (stock '+' marker swap)
// ---------------------------------------------------------------------------

test('collapsed sub-process and call activity get the org chip instead of the stock "+" marker', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Sub Chip Demo')

  // A CallActivity (no calledElement yet) -> generic tooltip chip.
  const callId = await createShape(page, 'bpmn:CallActivity', { x: 420, y: 220 })
  const callGfx = page.locator(`.djs-element[data-element-id="${callId}"]`)
  const callChip = callGfx.locator('g.orbitpm-sub-chip')
  await expect(callChip).toBeVisible()
  await expect(callChip).toHaveAttribute('data-org-tooltip', /Contains a sub-process/)
  await expect(callGfx.locator('path[data-marker="sub-process"]')).toHaveCount(0)

  // A collapsed SubProcess -> same swap.
  const subId = await createShape(
    page,
    'bpmn:SubProcess',
    { x: 640, y: 220 },
    { isExpanded: false }
  )
  const subGfx = page.locator(`.djs-element[data-element-id="${subId}"]`)
  await expect(subGfx.locator('g.orbitpm-sub-chip')).toBeVisible()
  await expect(subGfx.locator('g.orbitpm-sub-chip')).toHaveAttribute('data-org-tooltip', /.+/)
  await expect(subGfx.locator('path[data-marker="sub-process"]')).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// Edge auto-pan stays disabled
// ---------------------------------------------------------------------------

test('holding a dragged shape at the canvas edge does not auto-pan the viewbox', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'AutoPan Demo')

  const taskId = await createShape(page, 'bpmn:Task', { x: 420, y: 220 })
  const gfxBox = await page.locator(`.djs-element[data-element-id="${taskId}"]`).boundingBox()
  expect(gfxBox).not.toBeNull()
  if (!gfxBox) return
  const canvasBox = await page.locator('.orbitpm-editor__canvas').boundingBox()
  expect(canvasBox).not.toBeNull()
  if (!canvasBox) return

  const readViewbox = () =>
    page.evaluate(() => {
      const w = window as unknown as HookWindow
      const canvas = w.__ORBITPM_LITE__.modeler.get('canvas') as {
        viewbox(): { x: number; y: number; scale?: number }
      }
      const vb = canvas.viewbox()
      const round = (n: number) => Math.round(n * 1000) / 1000
      return { x: round(vb.x), y: round(vb.y), scale: round(vb.scale ?? 1) }
    })

  const before = await readViewbox()

  // Grab the task and drag it to ~5px from the canvas's right edge, then HOLD.
  const startX = gfxBox.x + gfxBox.width / 2
  const startY = gfxBox.y + gfxBox.height / 2
  const edgeX = canvasBox.x + canvasBox.width - 5
  const holdY = Math.min(Math.max(startY, canvasBox.y + 200), canvasBox.y + canvasBox.height - 40)
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 20, startY, { steps: 4 }) // pass the drag threshold
  await page.mouse.move(edgeX, holdY, { steps: 12 })

  const atEdge = await readViewbox()
  await page.waitForTimeout(700) // the old AutoScroll would pan repeatedly during this hold
  const afterHold = await readViewbox()
  await page.mouse.up()

  expect(afterHold, 'viewbox must not move while holding at the edge').toEqual(atEdge)
  expect(afterHold, 'viewbox must be exactly the pre-drag one').toEqual(before)

  // Sanity: the drag itself was real — the element actually moved right.
  const movedX = await page.evaluate((id) => {
    const w = window as unknown as HookWindow
    const registry = w.__ORBITPM_LITE__.modeler.get('elementRegistry') as {
      get(id: string): { x?: number } | undefined
    }
    return registry.get(id)?.x ?? 0
  }, taskId)
  expect(movedX).toBeGreaterThan(420)
})

// ---------------------------------------------------------------------------
// Direct label edit mirrors into orbitpm:nameEn (one undo reverts both)
// ---------------------------------------------------------------------------

test('typing a label mirrors into orbitpm:nameEn and a single undo reverts both', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Mirror Demo')

  const taskId = await createShape(page, 'bpmn:Task', { x: 420, y: 220 })
  const gfxBox = await page.locator(`.djs-element[data-element-id="${taskId}"]`).boundingBox()
  expect(gfxBox).not.toBeNull()
  if (!gfxBox) return

  // Double-click opens bpmn-js direct editing; type the name and commit (Enter).
  await page.mouse.dblclick(gfxBox.x + gfxBox.width / 2, gfxBox.y + gfxBox.height / 2)
  await expect(page.locator('.djs-direct-editing-content')).toBeVisible()
  await page.keyboard.type('Review Invoice')
  await page.keyboard.press('Enter')
  await expect(page.locator('.djs-direct-editing-content')).toHaveCount(0)

  await page.waitForFunction((id) => {
    const w = window as unknown as { __ORBITPM_LITE__: { modeler: { get(n: string): unknown } } }
    const registry = w.__ORBITPM_LITE__.modeler.get('elementRegistry') as {
      get(id: string): { businessObject?: { name?: unknown } } | undefined
    }
    return registry.get(id)?.businessObject?.name === 'Review Invoice'
  }, taskId)

  const afterEdit = await readNames(page, taskId)
  expect(afterEdit.name).toBe('Review Invoice')
  // Default diagram language is 'en' -> the visible name mirrors into nameEn.
  expect(afterEdit.nameEn).toBe('Review Invoice')

  // ONE Ctrl+Z reverts the visible name AND the mirrored attribute together
  // (the mirror write joins the same undo action as the label edit).
  await page.locator('.djs-container svg').first().focus()
  await page.keyboard.press('Control+z')
  await page.waitForFunction((id) => {
    const w = window as unknown as { __ORBITPM_LITE__: { modeler: { get(n: string): unknown } } }
    const registry = w.__ORBITPM_LITE__.modeler.get('elementRegistry') as {
      get(id: string): { businessObject?: { name?: unknown } } | undefined
    }
    const name = registry.get(id)?.businessObject?.name
    return name === undefined || name === null || name === ''
  }, taskId)
  const afterUndo = await readNames(page, taskId)
  // bpmn-js's UpdateLabelHandler restores the pre-edit label as '' (not
  // undefined) — either way the typed name must be gone from BOTH places.
  expect(afterUndo.name ?? '').toBe('')
  expect(afterUndo.nameEn ?? '').toBe('')
  // The visible label text is gone from the diagram SVG too.
  const texts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.djs-container svg text')).map((el) => el.textContent ?? '')
  )
  expect(texts.some((s) => s.includes('Review Invoice'))).toBe(false)
})

// ---------------------------------------------------------------------------
// Keyless free translate (stubbed Google gtx / MyMemory endpoints)
// ---------------------------------------------------------------------------

test.describe('free translate without a provider key (stubbed endpoints)', () => {
  // Serve the dist over http so the page has a real Origin (file:// sends
  // `Origin: null`, which makes CORS-fulfilled routing needlessly flaky);
  // Playwright routing then stubs the two translation hosts beneath the CSP
  // allowlist that ships in the page.
  let server: Server
  let baseURL = ''

  test.beforeAll(async () => {
    const html = readFileSync(DIST, 'utf8')
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const { port } = server.address() as AddressInfo
    baseURL = `http://127.0.0.1:${port}/`
  })

  test.afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()))
  })

  /** Boot a fallback-mode diagram with one named task; returns its id. */
  async function bootTranslateDiagram(page: Page): Promise<string> {
    await forceFallbackMode(page)
    await page.goto(baseURL, { waitUntil: 'load' })
    await newProcess(page, 'Translate Demo')
    const taskId = await createShape(page, 'bpmn:Task', { x: 420, y: 220 })
    await page.evaluate((id) => {
      const w = window as unknown as HookWindow
      const m = w.__ORBITPM_LITE__.modeler
      const registry = m.get('elementRegistry') as { get(id: string): unknown }
      const modeling = m.get('modeling') as {
        updateProperties(el: unknown, props: Record<string, unknown>): void
      }
      modeling.updateProperties(registry.get(id), { name: 'Review order' })
    }, taskId)
    return taskId
  }

  test('✨ Translate falls back to the free service and stores orbitpm:nameAr', async ({
    page
  }) => {
    const googleCalls: string[] = []
    const myMemoryCalls: string[] = []
    // Canned gtx payload: segments array whose [i][0] parts join to 'ترجمة'
    // (see ai/freeTranslate.ts parseGoogleResponse).
    await page.route('https://translate.googleapis.com/**', async (route) => {
      googleCalls.push(route.request().url())
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*'
        },
        body: JSON.stringify([[['ترجمة', 'src', null, null]], null, 'en'])
      })
    })
    // Safety net only — with Google answering, MyMemory must never be called.
    await page.route('https://api.mymemory.translated.net/**', async (route) => {
      myMemoryCalls.push(route.request().url())
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*'
        },
        body: JSON.stringify({ responseStatus: 200, responseData: { translatedText: 'ترجمة' } })
      })
    })

    const taskId = await bootTranslateDiagram(page)
    await page.getByRole('button', { name: /Translate/ }).click()

    // The keyless run announces the free service (i18n translate.free.using).
    await expect(
      page.getByRole('status').filter({ hasText: 'free translation service' })
    ).toBeVisible()

    // The missing Arabic side lands on the business object (visible name untouched).
    await page.waitForFunction(
      (id) => {
        const w = window as unknown as {
          __ORBITPM_LITE__: { modeler: { get(n: string): unknown } }
        }
        const registry = w.__ORBITPM_LITE__.modeler.get('elementRegistry') as {
          get(id: string): { businessObject?: { get?(k: string): unknown } } | undefined
        }
        return registry.get(id)?.businessObject?.get?.('orbitpm:nameAr') === 'ترجمة'
      },
      taskId,
      { timeout: 20_000 }
    )
    const names = await readNames(page, taskId)
    expect(names.name).toBe('Review order')
    expect(names.nameAr).toBe('ترجمة')

    // Completion toast, then verify the network shape: one gtx GET per label
    // (process name + "Start" + the task), Google only.
    await expect(page.getByRole('status').filter({ hasText: /Translated 3 labels/ })).toBeVisible({
      timeout: 15_000
    })
    expect(googleCalls.length).toBe(3)
    for (const url of googleCalls) {
      expect(url).toContain('client=gtx')
      expect(url).toContain('sl=en')
      expect(url).toContain('tl=ar')
    }
    expect(myMemoryCalls.length).toBe(0)
  })

  test('free-service 429s surface the rate-limit toast and write nothing', async ({ page }) => {
    // Both hops rate-limited -> the whole chain classifies as 'rate'.
    // ACAO must be present even on the 429 or the browser could not READ the
    // status (an opaque CORS failure would classify as 'service' instead).
    for (const host of [
      'https://translate.googleapis.com/**',
      'https://api.mymemory.translated.net/**'
    ]) {
      await page.route(host, (route) =>
        route.fulfill({
          status: 429,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'access-control-allow-origin': '*'
          },
          body: '{}'
        })
      )
    }

    const taskId = await bootTranslateDiagram(page)
    await page.getByRole('button', { name: /Translate/ }).click()

    await expect(
      page.getByRole('status').filter({ hasText: 'free translation service' })
    ).toBeVisible()
    // i18n translate.free.rate
    await expect(page.getByRole('status').filter({ hasText: /daily limit/ })).toBeVisible({
      timeout: 20_000
    })

    // The chain threw before the apply step — nothing was written.
    const names = await readNames(page, taskId)
    expect(names.nameAr).toBeNull()
    expect(names.name).toBe('Review order')
  })
})

import { test, expect, type Page } from '@playwright/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// The BUILT single file (must be built first: `cd lite && npm run build`).
const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()

/** Force the single-file fallback path (the File System Access folder picker
 *  opens a native dialog that can't be automated in CI). */
async function forceFallbackMode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // @ts-expect-error deleting an optional global for the test
    delete window.showDirectoryPicker
    // @ts-expect-error deleting an optional global for the test
    delete window.showOpenFilePicker
  })
}

interface HookWindow {
  __ORBITPM_LITE__: { modeler: { get(name: string): unknown } }
}

async function bootEnglishDiagram(page: Page, name: string): Promise<void> {
  await page
    .getByRole('button', { name: /New process/i })
    .first()
    .click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForFunction(() => {
    const w = window as unknown as { __ORBITPM_LITE__?: { modeler?: unknown } }
    return !!w.__ORBITPM_LITE__?.modeler
  })
}

async function createNamedTask(
  page: Page,
  names: { name: string; nameEn?: string; nameAr?: string }
): Promise<string> {
  return page.evaluate((values) => {
    const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
    const modeling = modeler.get('modeling') as {
      createShape(shape: unknown, pos: { x: number; y: number }, parent: unknown): { id: string }
      updateProperties(element: unknown, properties: Record<string, unknown>): void
    }
    const factory = modeler.get('elementFactory') as {
      createShape(attrs: { type: string }): unknown
    }
    const canvas = modeler.get('canvas') as {
      getRootElement(): unknown
      zoom(mode: 'fit-viewport'): void
    }
    const placed = modeling.createShape(
      factory.createShape({ type: 'bpmn:Task' }),
      { x: 420, y: 220 },
      canvas.getRootElement()
    )
    const properties: Record<string, unknown> = { name: values.name }
    if (values.nameEn !== undefined) properties['orbitpm:nameEn'] = values.nameEn
    if (values.nameAr !== undefined) properties['orbitpm:nameAr'] = values.nameAr
    modeling.updateProperties(placed, properties)
    canvas.zoom('fit-viewport')
    return placed.id
  }, names)
}

async function setActiveDiagramLang(page: Page, lang: 'en' | 'ar'): Promise<void> {
  await page.evaluate((target) => {
    const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
    const root = (modeler.get('canvas') as { getRootElement(): unknown }).getRootElement()
    ;(
      modeler.get('modeling') as {
        updateProperties(element: unknown, properties: Record<string, unknown>): void
      }
    ).updateProperties(root, { 'orbitpm:activeLang': target })
  }, lang)
}

/** Seed all currently named template elements so translation tests isolate the
 * deliberately partial task they add. */
async function makeNamedElementsBilingual(
  page: Page,
  arabicById: Record<string, string> = {}
): Promise<void> {
  await page.evaluate((overrides) => {
    const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
    type ElementLike = {
      id: string
      labelTarget?: unknown
      businessObject?: {
        name?: unknown
        get?: (key: string) => unknown
      }
    }
    const registry = modeler.get('elementRegistry') as { getAll(): ElementLike[] }
    const canvas = modeler.get('canvas') as { getRootElement(): ElementLike }
    const modeling = modeler.get('modeling') as {
      updateProperties(element: unknown, properties: Record<string, unknown>): void
    }
    const seen = new Set<unknown>()
    for (const element of [...registry.getAll(), canvas.getRootElement()]) {
      const bo = element.businessObject
      if (!bo || element.labelTarget != null || seen.has(bo)) continue
      seen.add(bo)
      const viaGet = typeof bo.get === 'function' ? bo.get('name') : undefined
      const name = typeof viaGet === 'string' ? viaGet : typeof bo.name === 'string' ? bo.name : ''
      if (name.trim() === '') continue
      modeling.updateProperties(element, {
        'orbitpm:nameEn': name,
        'orbitpm:nameAr': overrides[element.id] ?? 'تسمية عربية'
      })
    }
    modeling.updateProperties(canvas.getRootElement(), {
      'orbitpm:activeLang': 'en'
    })
  }, arabicById)
}

async function readDiagramState(
  page: Page,
  id: string
): Promise<{
  name: string | null
  nameEn: string | null
  nameAr: string | null
  activeLang: string | null
}> {
  return page.evaluate((elementId) => {
    const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
    type BusinessObject = {
      name?: unknown
      get?: (key: string) => unknown
      $attrs?: Record<string, unknown>
    }
    const registry = modeler.get('elementRegistry') as {
      get(id: string): { businessObject?: BusinessObject } | undefined
    }
    const root = (
      modeler.get('canvas') as {
        getRootElement(): { businessObject?: BusinessObject }
      }
    ).getRootElement()
    const attr = (bo: BusinessObject | undefined, key: string): string | null => {
      const viaGet = typeof bo?.get === 'function' ? bo.get(key) : undefined
      const raw = viaGet ?? bo?.$attrs?.[key]
      return typeof raw === 'string' ? raw : null
    }
    const bo = registry.get(elementId)?.businessObject
    const viaGet = typeof bo?.get === 'function' ? bo.get('name') : undefined
    return {
      name: typeof viaGet === 'string' ? viaGet : typeof bo?.name === 'string' ? bo.name : null,
      nameEn: attr(bo, 'orbitpm:nameEn'),
      nameAr: attr(bo, 'orbitpm:nameAr'),
      activeLang: attr(root.businessObject, 'orbitpm:activeLang')
    }
  }, id)
}

async function readVisibleLocalizedValue(
  page: Page,
  id: string
): Promise<{
  visible: string | null
  nameEn: string | null
  nameAr: string | null
  activeLang: string | null
}> {
  return page.evaluate((elementId) => {
    const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
    type BusinessObject = {
      $type?: string
      name?: unknown
      text?: unknown
      get?: (key: string) => unknown
      $attrs?: Record<string, unknown>
    }
    const registry = modeler.get('elementRegistry') as {
      get(id: string): { businessObject?: BusinessObject } | undefined
    }
    const root = (
      modeler.get('canvas') as {
        getRootElement(): { businessObject?: BusinessObject }
      }
    ).getRootElement()
    const read = (bo: BusinessObject | undefined, key: string): unknown => {
      const viaGet = typeof bo?.get === 'function' ? bo.get(key) : undefined
      return viaGet ?? bo?.[key as keyof BusinessObject] ?? bo?.$attrs?.[key]
    }
    const bo = registry.get(elementId)?.businessObject
    const property = bo?.$type === 'bpmn:TextAnnotation' ? 'text' : 'name'
    const visible = read(bo, property)
    const nameEn = read(bo, 'orbitpm:nameEn')
    const nameAr = read(bo, 'orbitpm:nameAr')
    const activeLang = read(root.businessObject, 'orbitpm:activeLang')
    return {
      visible: typeof visible === 'string' ? visible : null,
      nameEn: typeof nameEn === 'string' ? nameEn : null,
      nameAr: typeof nameAr === 'string' ? nameAr : null,
      activeLang: typeof activeLang === 'string' ? activeLang : null
    }
  }, id)
}

test('language toggle: EN -> Arabic sets dir=rtl and translates chrome, then back to EN', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })

  // Starts English, ltr.
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('button', { name: /New process/i }).first()).toBeVisible()

  // Toggle to Arabic via the header language button.
  await page.getByRole('button', { name: /العربية/ }).click()

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')

  // A known button now shows Arabic text (New process -> ＋ عملية جديدة).
  await expect(
    page.getByRole('button', { name: 'عملية جديدة', exact: false }).first()
  ).toBeVisible()

  // Persisted across the toggle: localStorage carries the language.
  const stored = await page.evaluate(() => localStorage.getItem('orbitpm.lite.lang'))
  expect(stored).toBe('ar')

  // Toggle back to English (the control is explicitly labelled as interface language).
  await page.getByRole('button', { name: /EN/ }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('button', { name: /New process/i }).first()).toBeVisible()
})

test('header interface locale leaves diagram language and labels unchanged', async ({ page }) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await bootEnglishDiagram(page, 'Locale isolation')
  const taskId = await createNamedTask(page, {
    name: 'Review request',
    nameEn: 'Review request',
    nameAr: 'مراجعة الطلب'
  })
  await setActiveDiagramLang(page, 'en')

  await page.getByRole('button', { name: /العربية/ }).click()

  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect
    .poll(() => readDiagramState(page, taskId))
    .toMatchObject({
      name: 'Review request',
      activeLang: 'en'
    })
  await expect(page.locator(`.djs-element[data-element-id="${taskId}"] .djs-label`)).toContainText(
    'Review request'
  )
})

test('diagram toolbar toggle updates businessObject.name and rendered SVG text', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await bootEnglishDiagram(page, 'Toggle projection')
  const taskId = await createNamedTask(page, {
    name: 'Approve application',
    nameEn: 'Approve application',
    nameAr: 'اعتماد الطلب'
  })
  await makeNamedElementsBilingual(page, {
    [taskId]: 'اعتماد الطلب'
  })
  await setActiveDiagramLang(page, 'en')

  await page.getByRole('button', { name: /EN⇄AR/ }).click()

  await expect
    .poll(() => readDiagramState(page, taskId))
    .toMatchObject({
      name: 'اعتماد الطلب',
      nameEn: 'Approve application',
      nameAr: 'اعتماد الطلب',
      activeLang: 'ar'
    })
  await expect(
    page.locator(`.djs-element[data-element-id="${taskId}"] .djs-label tspan`, {
      hasText: 'اعتماد الطلب'
    })
  ).toBeVisible()
})

test('incomplete diagram toggle opens review without mutation/network; partial preview is explicit', async ({
  page
}) => {
  const translationCalls: string[] = []
  await page.route('https://translate.googleapis.com/**', async (route) => {
    translationCalls.push(route.request().url())
    await route.abort()
  })
  await page.route('https://api.mymemory.translated.net/**', async (route) => {
    translationCalls.push(route.request().url())
    await route.abort()
  })
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await bootEnglishDiagram(page, 'Incomplete projection')
  await makeNamedElementsBilingual(page)
  const taskId = await createNamedTask(page, {
    name: 'Manual review required',
    nameEn: 'Manual review required'
  })
  await setActiveDiagramLang(page, 'en')

  await page.getByRole('button', { name: /EN⇄AR/ }).click()
  const review = page.getByRole('dialog', { name: 'Review translation' })
  await expect(review).toBeVisible()
  await expect(review).toContainText('Manual review required')
  expect(translationCalls).toEqual([])
  await expect
    .poll(() => readDiagramState(page, taskId))
    .toMatchObject({
      name: 'Manual review required',
      nameAr: null,
      activeLang: 'en'
    })

  await review.getByRole('button', { name: 'Preview translated fields only' }).click()
  await expect(review).toBeHidden()
  await expect
    .poll(() => readDiagramState(page, taskId))
    .toMatchObject({
      name: 'Manual review required',
      nameEn: 'Manual review required',
      nameAr: null,
      activeLang: 'ar'
    })
  expect(translationCalls).toEqual([])
})

test('diagram language projection updates TextAnnotation text atomically and one undo restores every label', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await bootEnglishDiagram(page, 'Atomic annotation projection')
  const taskId = await createNamedTask(page, {
    name: 'Review request',
    nameEn: 'Review request',
    nameAr: 'مراجعة الطلب'
  })
  const annotationId = await page.evaluate(() => {
    const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
    const modeling = modeler.get('modeling') as {
      createShape(
        shape: unknown,
        position: { x: number; y: number },
        parent: unknown
      ): { id: string }
      updateProperties(element: unknown, properties: Record<string, unknown>): void
    }
    const factory = modeler.get('elementFactory') as {
      createShape(attributes: Record<string, unknown>): unknown
    }
    const canvas = modeler.get('canvas') as {
      getRootElement(): unknown
      zoom(mode: 'fit-viewport'): void
    }
    const annotation = modeling.createShape(
      factory.createShape({ type: 'bpmn:TextAnnotation' }),
      { x: 650, y: 220 },
      canvas.getRootElement()
    )
    modeling.updateProperties(annotation, {
      text: 'Check supporting documents',
      'orbitpm:nameEn': 'Check supporting documents',
      'orbitpm:nameAr': 'تحقق من المستندات الداعمة'
    })
    canvas.zoom('fit-viewport')
    return annotation.id
  })
  await makeNamedElementsBilingual(page, {
    [taskId]: 'مراجعة الطلب',
    [annotationId]: 'تحقق من المستندات الداعمة'
  })
  await setActiveDiagramLang(page, 'en')

  const stackBefore = await page.evaluate(() => {
    const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
    return (modeler.get('commandStack') as { _stackIdx: number })._stackIdx
  })
  await page.getByRole('button', { name: /EN⇄AR/ }).click()

  await expect
    .poll(() => readVisibleLocalizedValue(page, taskId))
    .toMatchObject({
      visible: 'مراجعة الطلب',
      activeLang: 'ar'
    })
  await expect
    .poll(() => readVisibleLocalizedValue(page, annotationId))
    .toMatchObject({
      visible: 'تحقق من المستندات الداعمة',
      nameEn: 'Check supporting documents',
      nameAr: 'تحقق من المستندات الداعمة',
      activeLang: 'ar'
    })
  await expect(
    page.locator(`.djs-element[data-element-id="${annotationId}"]`, {
      hasText: 'تحقق من المستندات الداعمة'
    })
  ).toBeVisible()
  expect(
    await page.evaluate(() => {
      const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
      return (modeler.get('commandStack') as { _stackIdx: number })._stackIdx
    })
  ).toBeGreaterThan(stackBefore)

  await page.evaluate(() => {
    const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
    ;(modeler.get('commandStack') as { undo(): void }).undo()
  })
  await expect
    .poll(() =>
      page.evaluate(() => {
        const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
        return (modeler.get('commandStack') as { _stackIdx: number })._stackIdx
      })
    )
    .toBe(stackBefore)
  await expect
    .poll(() => readVisibleLocalizedValue(page, taskId))
    .toMatchObject({
      visible: 'Review request',
      activeLang: 'en'
    })
  await expect
    .poll(() => readVisibleLocalizedValue(page, annotationId))
    .toMatchObject({
      visible: 'Check supporting documents',
      nameEn: 'Check supporting documents',
      nameAr: 'تحقق من المستندات الداعمة',
      activeLang: 'en'
    })
})

test.describe('Translate projects Arabic immediately', () => {
  let server: Server | undefined
  let baseUrl = ''

  test.beforeAll(async () => {
    const html = readFileSync(DIST, 'utf8')
    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(html)
    })
    await new Promise<void>((resolveListen) => server?.listen(0, '127.0.0.1', resolveListen))
    const { port } = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${port}/`
  })

  test.afterAll(async () => {
    if (server) {
      await new Promise<void>((resolveClose) => server?.close(() => resolveClose()))
    }
  })

  test('mocked EN-to-AR endpoint shows generated Arabic immediately', async ({ page }) => {
    const googleCalls: string[] = []
    const myMemoryCalls: string[] = []
    await page.route('https://translate.googleapis.com/**', async (route) => {
      googleCalls.push(route.request().url())
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*'
        },
        body: JSON.stringify([[['مراجعة الطلب', 'Review order', null, null]], null, 'en'])
      })
    })
    await page.route('https://api.mymemory.translated.net/**', async (route) => {
      myMemoryCalls.push(route.request().url())
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*'
        },
        body: JSON.stringify({
          responseStatus: 200,
          responseData: { translatedText: 'مراجعة الطلب' }
        })
      })
    })
    await forceFallbackMode(page)
    await page.goto(baseUrl, { waitUntil: 'load' })
    await bootEnglishDiagram(page, 'Translate projection')
    await makeNamedElementsBilingual(page)
    const taskId = await createNamedTask(page, {
      name: 'Review order',
      nameEn: 'Review order'
    })

    await page.getByRole('button', { name: /Translate/ }).click()
    const review = page.getByRole('dialog', { name: 'Review translation' })
    await expect(review).toBeVisible()
    await expect(review).toContainText('Review order')
    // Opening/reviewing the dialog is read-only: no text leaves the browser.
    expect(googleCalls).toHaveLength(0)
    expect(myMemoryCalls).toHaveLength(0)
    await review.getByLabel('Translation provider').selectOption('free')
    expect(googleCalls).toHaveLength(0)
    await review.getByRole('button', { name: 'Translate now' }).click()

    await expect
      .poll(() => readDiagramState(page, taskId), { timeout: 20_000 })
      .toMatchObject({
        name: 'مراجعة الطلب',
        nameEn: 'Review order',
        nameAr: 'مراجعة الطلب',
        activeLang: 'ar'
      })
    await expect(
      page.locator(`.djs-element[data-element-id="${taskId}"] .djs-label tspan`, {
        hasText: 'مراجعة الطلب'
      })
    ).toBeVisible()
    expect(googleCalls).toHaveLength(1)
    expect(googleCalls[0]).toContain('sl=en')
    expect(googleCalls[0]).toContain('tl=ar')
    expect(myMemoryCalls).toHaveLength(0)
  })

  test('zero-work Translate switches to stored Arabic without network', async ({ page }) => {
    const translationCalls: string[] = []
    for (const host of [
      'https://translate.googleapis.com/**',
      'https://api.mymemory.translated.net/**'
    ]) {
      await page.route(host, async (route) => {
        translationCalls.push(route.request().url())
        await route.fulfill({
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'access-control-allow-origin': '*'
          },
          body: JSON.stringify([[['غير متوقع', 'unexpected', null, null]], null, 'en'])
        })
      })
    }
    await forceFallbackMode(page)
    await page.goto(baseUrl, { waitUntil: 'load' })
    await bootEnglishDiagram(page, 'Already bilingual')
    const taskId = await createNamedTask(page, {
      name: 'Ready request',
      nameEn: 'Ready request',
      nameAr: 'طلب جاهز'
    })
    await makeNamedElementsBilingual(page, { [taskId]: 'طلب جاهز' })

    await page.getByRole('button', { name: /Translate/ }).click()

    await expect
      .poll(() => readDiagramState(page, taskId))
      .toMatchObject({
        name: 'طلب جاهز',
        nameEn: 'Ready request',
        nameAr: 'طلب جاهز',
        activeLang: 'ar'
      })
    await expect(
      page.locator(`.djs-element[data-element-id="${taskId}"] .djs-label`)
    ).toContainText('طلب جاهز')
    expect(translationCalls).toHaveLength(0)
  })

  test('mocked AR-to-EN endpoint translates Arabic-authored labels and projects English immediately', async ({
    page
  }) => {
    const googleCalls: string[] = []
    await page.route('https://translate.googleapis.com/**', async (route) => {
      googleCalls.push(route.request().url())
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*'
        },
        body: JSON.stringify([
          [['Review animal-owner request', 'مراجعة طلب مالك الحيوان', null, null]],
          null,
          'ar'
        ])
      })
    })
    await page.route('https://api.mymemory.translated.net/**', async (route) => {
      await route.abort()
    })
    await forceFallbackMode(page)
    await page.goto(baseUrl, { waitUntil: 'load' })
    await bootEnglishDiagram(page, 'Reverse translation')
    await makeNamedElementsBilingual(page)
    const taskId = await createNamedTask(page, {
      name: 'مراجعة طلب مالك الحيوان',
      nameAr: 'مراجعة طلب مالك الحيوان'
    })
    await setActiveDiagramLang(page, 'ar')

    await page.getByRole('button', { name: /Translate/ }).click()
    const review = page.getByRole('dialog', { name: 'Review translation' })
    await expect(review).toBeVisible()
    await expect(review).toContainText('مراجعة طلب مالك الحيوان')
    expect(googleCalls).toHaveLength(0)
    await review.getByLabel('Translation provider').selectOption('free')
    await review.getByRole('button', { name: 'Translate now' }).click()

    await expect
      .poll(() => readDiagramState(page, taskId), { timeout: 20_000 })
      .toMatchObject({
        name: 'Review animal-owner request',
        nameEn: 'Review animal-owner request',
        nameAr: 'مراجعة طلب مالك الحيوان',
        activeLang: 'en'
      })
    await expect(
      page.locator(`.djs-element[data-element-id="${taskId}"] .djs-label`)
    ).toContainText('Review animal-owner request')
    expect(googleCalls).toHaveLength(1)
    expect(googleCalls[0]).toContain('sl=ar')
    expect(googleCalls[0]).toContain('tl=en')
  })
})

test('create a process with an Arabic name (fallback mode) and export SVG containing the Arabic label', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })

  // Switch to Arabic first so the New-process dialog itself is Arabic too.
  await page.getByRole('button', { name: /العربية/ }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')

  await page
    .getByRole('button', { name: /عملية جديدة/ })
    .first()
    .click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const input = dialog.getByRole('textbox')
  await expect(input).toBeFocused()
  await input.fill('طلب العميل')
  await dialog.getByRole('button', { name: 'إنشاء', exact: true }).click()

  const svg = page.locator('.djs-container svg').first()
  await expect(svg).toBeVisible({ timeout: 20_000 })

  // Programmatically set an element's label to Arabic text via the exposed
  // automation hook (bpmn-js's own label-editing UI can't be driven headlessly
  // in this harness), then assert the rendered SVG <tspan> contains it —
  // proves bpmn-js correctly renders/shapes Arabic glyphs on the canvas.
  await page.waitForFunction(() => {
    const w = window as unknown as { __ORBITPM_LITE__?: { modeler?: unknown } }
    return !!w.__ORBITPM_LITE__?.modeler
  })
  const arabicLabel = 'مهمة الموافقة'
  await page.evaluate((label) => {
    const w = window as unknown as {
      __ORBITPM_LITE__: { modeler: { get(name: string): unknown } }
    }
    const m = w.__ORBITPM_LITE__.modeler
    const modeling = m.get('modeling') as {
      createShape(shape: unknown, pos: { x: number; y: number }, parent: unknown): unknown
      updateLabel(element: unknown, text: string): void
    }
    const elementFactory = m.get('elementFactory') as {
      createShape(attrs: { type: string }): unknown
    }
    const canvas = m.get('canvas') as { getRootElement(): unknown }
    const task = elementFactory.createShape({ type: 'bpmn:Task' }) as { businessObject?: unknown }
    const shape = modeling.createShape(task, { x: 420, y: 220 }, canvas.getRootElement())
    modeling.updateLabel(shape, label)
  }, arabicLabel)

  // The SVG canvas now renders a <tspan> containing the Arabic text.
  await expect(page.locator('.djs-container svg tspan', { hasText: arabicLabel })).toBeVisible({
    timeout: 10_000
  })

  // Export SVG: the downloaded file's content contains the Arabic string.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'تصدير SVG' }).click()
  ])
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const svgText = Buffer.concat(chunks).toString('utf8')
  expect(svgText).toContain('<svg')
  expect(svgText).toContain(arabicLabel)
})

test('Arabic editor panes mirror their layout and resizer while the bpmn-js canvas stays LTR', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page.getByRole('button', { name: /العربية/ }).click()
  await page
    .getByRole('button', { name: /عملية جديدة/ })
    .first()
    .click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'إنشاء', exact: true }).click()

  const editor = page.locator('.orbitpm-editor')
  await expect(editor).toBeVisible({ timeout: 20_000 })
  await expect(editor).toHaveAttribute('dir', 'rtl')
  await expect(editor.locator('.orbitpm-editor__body')).toHaveAttribute('dir', 'rtl')
  await expect(editor.locator('.orbitpm-editor__canvas')).toHaveAttribute('dir', 'ltr')

  // The Details pane is collapsed by default, while its logical-end rail stays
  // reachable and mirrors the chevron in RTL.
  const pane = editor.locator('[id^="orbitpm-details-pane-"][role="complementary"]')
  const paneId = await pane.getAttribute('id')
  if (!paneId) throw new Error('Details pane has no stable id')
  expect(paneId).toMatch(/^orbitpm-details-pane-/)
  const paneToggle = editor.locator('button[aria-controls^="orbitpm-details-pane-"]')
  await expect(pane).toBeHidden()
  await expect(paneToggle).toBeVisible()
  await expect(paneToggle).toHaveAccessibleName('التفاصيل')
  await expect(paneToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(paneToggle).toHaveAttribute('aria-controls', paneId)
  await expect(paneToggle.locator('.orbitpm-details-toggle__glyph')).not.toHaveCSS(
    'transform',
    'none'
  )

  // Keyboard expansion moves focus to the localized pane heading. Collapse
  // restores it to the persistent rail control.
  await paneToggle.focus()
  await paneToggle.press('Enter')
  await expect(pane).toBeVisible()
  await expect(pane.getByRole('heading', { name: 'التفاصيل' })).toBeFocused()
  await paneToggle.click()
  await expect(pane).toBeHidden()
  await expect(paneToggle).toBeFocused()

  const taskId = await createNamedTask(page, {
    name: 'مراجعة الطلب',
    nameEn: 'Review request',
    nameAr: 'مراجعة الطلب'
  })
  await page.locator(`.djs-element[data-element-id="${taskId}"] .djs-hit`).first().dblclick()

  await expect(paneToggle).toHaveAttribute('aria-controls', paneId)
  await expect(paneToggle).toHaveAttribute('aria-expanded', 'true')

  await expect(pane).toBeVisible()
  await expect(pane).toHaveAttribute('aria-label', 'تفاصيل الخطوة والخصائص')
  await expect(pane).toHaveAttribute('dir', 'rtl')
  await expect(pane.locator('.orbitpm-lite-details-card')).toHaveAttribute('dir', 'rtl')

  // border-inline-start maps to the physical right in RTL.
  const paneBorders = await pane.evaluate((element) => {
    const style = getComputedStyle(element)
    return { left: style.borderLeftWidth, right: style.borderRightWidth }
  })
  expect(paneBorders).toEqual({ left: '0px', right: '1px' })

  // The pane's inline-start resizer receives the real RTL direction:
  // ArrowRight grows it instead of applying the LTR shrink behavior.
  const resizer = page.getByRole('separator', { name: 'تغيير عرض لوحة الخصائص' })
  await expect(resizer).toHaveAttribute('aria-valuenow', '300')
  await resizer.focus()
  await resizer.press('ArrowRight')
  await expect(resizer).toHaveAttribute('aria-valuenow', '316')

  // ...while the app root stays rtl.
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
})

test('Arabic shape legend and node/decorative tooltips are translated', async ({ page }) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await bootEnglishDiagram(page, 'Arabic semantic help')
  const taskId = await createNamedTask(page, {
    name: 'Review request',
    nameEn: 'Review request',
    nameAr: 'مراجعة الطلب'
  })
  await page.evaluate((elementId) => {
    const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
    const registry = modeler.get('elementRegistry') as { get(id: string): unknown }
    const modeling = modeler.get('modeling') as {
      updateProperties(element: unknown, properties: Record<string, unknown>): void
    }
    modeling.updateProperties(registry.get(elementId), {
      'orbitpm:owner': 'فريق العمليات',
      'orbitpm:inputs': 'طلب العميل',
      'orbitpm:outputs': 'قرار المراجعة'
    })
  }, taskId)

  await page.getByRole('button', { name: /العربية/ }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')

  const legendToggle = page.getByTestId('shape-legend-toggle')
  await expect(legendToggle).toHaveAttribute('aria-expanded', 'false')
  const legendId = await legendToggle.getAttribute('aria-controls')
  if (!legendId) throw new Error('shape legend toggle has no aria-controls target')
  expect(legendId).toMatch(/^orbitpm-shape-legend-/)
  const legend = page.locator(`#${legendId}[role="region"]`)
  await expect(legend).toBeHidden()
  await legendToggle.click()
  await expect(legendToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(legend).toBeVisible()
  await expect(legend).toHaveAttribute('dir', 'rtl')
  await expect(legend).toContainText('دليل أشكال المخطط')
  await expect(legend).toContainText(/[\u0600-\u06ff]/)

  const taskGfx = page.locator(`.djs-element[data-element-id="${taskId}"]`)
  await taskGfx.evaluate((element) =>
    element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
  )
  const tooltip = page.locator('.orbitpm-editor .orbitpm-canvas-tooltip')
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toHaveAttribute('dir', 'auto')
  await expect(tooltip).toContainText(/[\u0600-\u06ff]/)

  // Decoration metadata takes precedence over the element-id fallback and is
  // localized too. OUTPUT keeps the layout lane's decoration contract.
  const output = taskGfx.locator('[data-org-decoration="outputs"]')
  await expect(output).toHaveAttribute('data-org-semantic', 'output')
  await expect(output).toHaveAttribute('data-org-tooltip', /[\u0600-\u06ff]/)
  await output.evaluate((element) =>
    element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
  )
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toContainText(/[\u0600-\u06ff]/)
})

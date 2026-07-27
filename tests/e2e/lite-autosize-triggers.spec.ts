import { test, expect, type Page } from '@playwright/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

// Integration coverage for Wave 2's two landed lanes. Like the other Lite
// specs, this runs the rebuilt single-file dist in fallback mode and reaches
// bpmn-js only through the product's __ORBITPM_LITE__ automation hook.

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()

test.beforeAll(() => {
  const html = readFileSync(DIST, 'utf8')
  expect(html.length, 'dist/index.html should be a multi-hundred-KB single file').toBeGreaterThan(
    500_000
  )
})

interface HookWindow {
  __ORBITPM_LITE__: {
    modeler: {
      importXML(xml: string): Promise<{ warnings: string[] }>
      saveXML(options: { format: boolean }): Promise<{ xml?: string }>
      get(name: string): unknown
    }
    autoSizeAll(): number
  }
}

interface Bounds {
  x: number
  y: number
  width: number
  height: number
  name: string
}

async function forceFallbackMode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete window.showDirectoryPicker
    delete window.showOpenFilePicker
  })
}

async function newProcess(page: Page, name: string): Promise<void> {
  await page
    .getByRole('button', { name: /New process/i })
    .first()
    .click()
  const dialog = page.getByRole('dialog', { name: /New Process/i })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox').fill(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForFunction(() => {
    const w = window as unknown as Partial<HookWindow>
    return !!w.__ORBITPM_LITE__?.modeler
  })
}

async function boot(page: Page, name: string): Promise<void> {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, name)
}

/**
 * The language toggle is audit-gated. Seed the named process template
 * elements (notably the process and start event) with genuine bilingual
 * counterparts so this autosize test reaches immediate language projection
 * for the right reason.
 */
async function makeNamedTemplateElementsBilingual(page: Page): Promise<void> {
  await page.evaluate(() => {
    const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
    type ElementLike = {
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
      const businessObject = element.businessObject
      if (!businessObject || element.labelTarget != null || seen.has(businessObject)) continue
      seen.add(businessObject)
      const viaGet = businessObject.get?.('name')
      const name =
        typeof viaGet === 'string'
          ? viaGet
          : typeof businessObject.name === 'string'
            ? businessObject.name
            : ''
      if (name.trim() === '') continue
      modeling.updateProperties(element, {
        'orbitpm:nameEn': name,
        'orbitpm:nameAr': 'تسمية عربية'
      })
    }
    modeling.updateProperties(canvas.getRootElement(), {
      'orbitpm:activeLang': 'en'
    })
  })
}

async function createShape(
  page: Page,
  type: string,
  pos: { x: number; y: number },
  opts?: { select?: boolean; extra?: Record<string, unknown> }
): Promise<string> {
  return page.evaluate(
    ({ type, pos, select, extra }) => {
      const w = window as unknown as HookWindow
      const modeler = w.__ORBITPM_LITE__.modeler
      const modeling = modeler.get('modeling') as {
        createShape(shape: unknown, pos: { x: number; y: number }, parent: unknown): { id: string }
      }
      const elementFactory = modeler.get('elementFactory') as {
        createShape(attrs: Record<string, unknown>): unknown
      }
      const canvas = modeler.get('canvas') as {
        getRootElement(): unknown
        zoom(mode: 'fit-viewport'): void
      }
      const selection = modeler.get('selection') as { select(element: unknown): void }
      const shape = elementFactory.createShape({ type, ...(extra ?? {}) })
      const placed = modeling.createShape(shape, pos, canvas.getRootElement())
      if (select) selection.select(placed)
      canvas.zoom('fit-viewport')
      return placed.id
    },
    { type, pos, select: opts?.select ?? false, extra: opts?.extra }
  )
}

async function readBounds(page: Page, id: string): Promise<Bounds> {
  return page.evaluate((elementId) => {
    const w = window as unknown as HookWindow
    const registry = w.__ORBITPM_LITE__.modeler.get('elementRegistry') as {
      get(id: string): {
        x: number
        y: number
        width: number
        height: number
        businessObject?: { name?: unknown }
      }
    }
    const element = registry.get(elementId)
    return {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      name: typeof element.businessObject?.name === 'string' ? element.businessObject.name : ''
    }
  }, id)
}

async function updateName(page: Page, id: string, name: string): Promise<void> {
  await page.evaluate(
    ({ elementId, name }) => {
      const w = window as unknown as HookWindow
      const modeler = w.__ORBITPM_LITE__.modeler
      const registry = modeler.get('elementRegistry') as { get(id: string): unknown }
      const modeling = modeler.get('modeling') as {
        updateProperties(element: unknown, properties: Record<string, unknown>): void
      }
      modeling.updateProperties(registry.get(elementId), { name })
    },
    { elementId: id, name }
  )
}

async function directEdit(page: Page, id: string, name: string): Promise<void> {
  const activated = await page.evaluate((elementId) => {
    const w = window as unknown as HookWindow
    const modeler = w.__ORBITPM_LITE__.modeler
    const registry = modeler.get('elementRegistry') as { get(id: string): unknown }
    const directEditing = modeler.get('directEditing') as {
      activate(element: unknown): boolean
    }
    return directEditing.activate(registry.get(elementId))
  }, id)
  expect(activated, `direct editing should activate for ${id}`).toBe(true)
  const editor = page.locator('.djs-direct-editing-content')
  await expect(editor).toBeVisible()
  await editor.fill(name)
  await page.keyboard.press('Enter')
  await expect(editor).toHaveCount(0)
  await expect.poll(async () => (await readBounds(page, id)).name).toBe(name)
}

async function selectElement(page: Page, id: string): Promise<void> {
  await page.evaluate((elementId) => {
    const w = window as unknown as HookWindow
    const modeler = w.__ORBITPM_LITE__.modeler
    const registry = modeler.get('elementRegistry') as { get(id: string): unknown }
    const selection = modeler.get('selection') as { select(element: unknown): void }
    selection.select(registry.get(elementId))
  }, id)
}

async function selectFirstOfType(page: Page, type: string): Promise<string> {
  return page.evaluate((wantedType) => {
    const w = window as unknown as HookWindow
    const modeler = w.__ORBITPM_LITE__.modeler
    const registry = modeler.get('elementRegistry') as {
      getAll(): Array<{ id: string; type?: string }>
    }
    const element = registry.getAll().find((candidate) => candidate.type === wantedType)
    if (!element) throw new Error(`No ${wantedType} found`)
    const selection = modeler.get('selection') as { select(selected: unknown): void }
    selection.select(element)
    return element.id
  }, type)
}

function fixedSizeXml(): string {
  const taskName = 'T'.repeat(100)
  const callName = 'C'.repeat(100)
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="Definitions_AutoSize" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_AutoSize" isExecutable="false">
    <bpmn:task id="Task_Long" name="${taskName}" />
    <bpmn:callActivity id="Call_Long" name="${callName}" calledElement="Process_Child" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_AutoSize">
    <bpmndi:BPMNPlane id="Plane_AutoSize" bpmnElement="Process_AutoSize">
      <bpmndi:BPMNShape id="Task_Long_di" bpmnElement="Task_Long">
        <dc:Bounds x="240" y="180" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Call_Long_di" bpmnElement="Call_Long">
        <dc:Bounds x="440" y="180" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`
}

function legacyTriggerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:orbitpm="http://orbitpm.ae/schema/bpmn/1.0"
  id="Definitions_Legacy" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Legacy" name="Legacy trigger" isExecutable="false">
    <bpmn:startEvent id="Start_Legacy" orbitpm:trigger="email"
      orbitpm:triggerDetail="legacy mailbox detail" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_Legacy">
    <bpmndi:BPMNPlane id="Plane_Legacy" bpmnElement="Process_Legacy">
      <bpmndi:BPMNShape id="Start_Legacy_di" bpmnElement="Start_Legacy">
        <dc:Bounds x="260" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`
}

test('direct editing auto-sizes activities, preserves anchor, and one undo restores label plus bounds', async ({
  page
}) => {
  await boot(page, 'Direct Edit Auto-size')
  const taskId = await createShape(page, 'bpmn:Task', { x: 420, y: 220 })
  const initial = await readBounds(page, taskId)
  expect({ width: initial.width, height: initial.height }).toEqual({ width: 100, height: 80 })
  const initialCenter = initial.x + initial.width / 2

  const medium = 'aaaaaaa bbbbbbb ccccccc ddddddd eeeeeee'
  await directEdit(page, taskId, medium)
  const mediumBounds = await readBounds(page, taskId)
  expect(mediumBounds.width).toBeGreaterThan(100)
  expect(mediumBounds.width).toBeLessThanOrEqual(160)
  expect(mediumBounds.height).toBe(80)
  expect(mediumBounds.y).toBe(initial.y)
  expect(mediumBounds.x + mediumBounds.width / 2).toBe(initialCenter)

  await page.locator('.djs-container svg').first().focus()
  await page.keyboard.press('Control+z')
  await expect
    .poll(async () => {
      const value = await readBounds(page, taskId)
      return [value.name, value.width, value.height]
    })
    .toEqual(['', 100, 80])

  const veryLong = 'L'.repeat(100)
  await directEdit(page, taskId, veryLong)
  const longBounds = await readBounds(page, taskId)
  expect(longBounds.width).toBe(160)
  expect(longBounds.height).toBeGreaterThan(80)
  expect(longBounds.y).toBe(initial.y)
  expect(longBounds.x + longBounds.width / 2).toBe(initialCenter)

  // Label synchronization and the nested resize join the originating command;
  // a single undo returns both the name and the original 100x80 box.
  await page.locator('.djs-container svg').first().focus()
  await page.keyboard.press('Control+z')
  await expect
    .poll(async () => {
      const value = await readBounds(page, taskId)
      return [value.name, value.x, value.y, value.width, value.height]
    })
    .toEqual(['', initial.x, initial.y, 100, 80])
})

test('Step Details name writes and EN⇄AR toggles re-fit the visible language', async ({ page }) => {
  await boot(page, 'Bilingual Auto-size')
  await makeNamedTemplateElementsBilingual(page)
  const taskId = await createShape(page, 'bpmn:Task', { x: 420, y: 220 }, { select: true })

  await page.getByRole('button', { name: 'Details…', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'Step details' })
  const longEnglish =
    'Review the complete customer application and all supporting evidence before approval'
  await dialog.getByLabel('Name (English)').fill(longEnglish)
  await dialog.getByLabel('Name (Arabic)').fill('مراجعة')
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expect(dialog).toBeHidden()
  let bounds = await readBounds(page, taskId)
  expect(bounds.name).toBe(longEnglish)
  expect(bounds.width).toBe(160)
  expect(bounds.height).toBeGreaterThan(80)

  // Arabic is short, so the toggle's updateProperties(name) path shrinks.
  const toggle = page.getByRole('button', { name: /EN⇄AR/ })
  await toggle.click()
  bounds = await readBounds(page, taskId)
  expect(bounds.name).toBe('مراجعة')
  expect({ width: bounds.width, height: bounds.height }).toEqual({ width: 100, height: 80 })

  // While Arabic is active, applying a long Arabic translation grows it; the
  // opposite-language short English value shrinks again on the next toggle.
  await selectElement(page, taskId)
  await page.getByRole('button', { name: 'Details…', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Step details' })
  const longArabic =
    'مراجعة جميع تفاصيل طلب العميل والمستندات الداعمة بعناية قبل اتخاذ قرار الموافقة النهائي'
  await dialog.getByLabel('Name (English)').fill('Review')
  await dialog.getByLabel('Name (Arabic)').fill(longArabic)
  await dialog.getByRole('button', { name: 'Apply' }).click()
  bounds = await readBounds(page, taskId)
  expect(bounds.name).toBe(longArabic)
  expect(bounds.width).toBeGreaterThan(100)

  await toggle.click()
  bounds = await readBounds(page, taskId)
  expect(bounds.name).toBe('Review')
  expect({ width: bounds.width, height: bounds.height }).toEqual({ width: 100, height: 80 })
})

test('call-activity label clears the sub chip and the stock marker stays removed', async ({
  page
}) => {
  await boot(page, 'Sub-chip Clearance')
  const callId = await createShape(page, 'bpmn:CallActivity', { x: 420, y: 220 })
  await updateName(
    page,
    callId,
    'Review the complete delegated case and all supporting evidence before continuing'
  )

  const gfx = page.locator(`.djs-element[data-element-id="${callId}"]`)
  const chip = gfx.locator('g.orbitpm-sub-chip')
  await expect(chip).toBeVisible()
  await expect(gfx.locator('path[data-marker="sub-process"]')).toHaveCount(0)
  const boxes = await gfx.evaluate((node) => {
    const label = node.querySelector<SVGGraphicsElement>('.djs-label')
    const subChip = node.querySelector<SVGGraphicsElement>('g.orbitpm-sub-chip')
    if (!label || !subChip) throw new Error('label/chip not rendered')
    const a = label.getBoundingClientRect()
    const b = subChip.getBoundingClientRect()
    return {
      label: { left: a.left, right: a.right, top: a.top, bottom: a.bottom },
      chip: { left: b.left, right: b.right, top: b.top, bottom: b.bottom }
    }
  })
  const intersects =
    boxes.label.left < boxes.chip.right &&
    boxes.label.right > boxes.chip.left &&
    boxes.label.top < boxes.chip.bottom &&
    boxes.label.bottom > boxes.chip.top
  expect(intersects, JSON.stringify(boxes)).toBe(false)
})

test('wide unbroken call label stays inside the shape and clear of the sub chip', async ({
  page
}) => {
  await boot(page, 'Wide Glyph Sub-chip Clearance')
  const callId = await createShape(page, 'bpmn:CallActivity', { x: 420, y: 220 })
  const gfx = page.locator(`.djs-element[data-element-id="${callId}"]`)

  const readLocalGeometry = async () =>
    gfx.evaluate((node, elementId) => {
      const w = window as unknown as HookWindow
      const registry = w.__ORBITPM_LITE__.modeler.get('elementRegistry') as {
        get(id: string): { width: number; height: number }
      }
      const element = registry.get(elementId)
      const label = node.querySelector<SVGGraphicsElement>('.djs-label')
      const subChip = node.querySelector<SVGGraphicsElement>('g.orbitpm-sub-chip')
      if (!label || !subChip) throw new Error('label/chip not rendered')
      const labelBox = label.getBBox()
      const chipBox = subChip.getBBox()
      return {
        shape: { x: 0, y: 0, width: element.width, height: element.height },
        label: {
          x: labelBox.x,
          y: labelBox.y,
          width: labelBox.width,
          height: labelBox.height
        },
        chip: {
          x: chipBox.x,
          y: chipBox.y,
          width: chipBox.width,
          height: chipBox.height
        }
      }
    }, callId)

  const intersects = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number }
  ): boolean =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

  const isContained = (
    inner: { x: number; y: number; width: number; height: number },
    outer: { x: number; y: number; width: number; height: number }
  ): boolean =>
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height

  // Exercise the actual direct-edit input path that triggered the audited
  // failure, not a synthetic business-object mutation.
  await directEdit(page, callId, 'C'.repeat(100))
  const uppercase = await readLocalGeometry()
  expect(uppercase.shape).toEqual({ x: 0, y: 0, width: 160, height: 138 })
  expect(intersects(uppercase.label, uppercase.chip), JSON.stringify(uppercase)).toBe(false)
  expect(isContained(uppercase.label, uppercase.shape), JSON.stringify(uppercase)).toBe(true)

  const sentence =
    'Review the complete delegated case and all supporting evidence before continuing'
  await directEdit(page, callId, sentence)
  const realistic = await readLocalGeometry()
  expect(realistic.shape).toEqual({ x: 0, y: 0, width: 160, height: 94 })
  expect(intersects(realistic.label, realistic.chip), JSON.stringify(realistic)).toBe(false)
  expect(isContained(realistic.label, realistic.shape), JSON.stringify(realistic)).toBe(true)
})

test('gateway, event, and expanded subprocess bounds do not change on rename', async ({ page }) => {
  await boot(page, 'Non-target Auto-size')
  const ids = [
    await createShape(page, 'bpmn:ExclusiveGateway', { x: 340, y: 180 }),
    await createShape(page, 'bpmn:IntermediateCatchEvent', { x: 500, y: 180 }),
    await createShape(page, 'bpmn:SubProcess', { x: 700, y: 260 }, { extra: { isExpanded: true } })
  ]
  const before = await Promise.all(ids.map((id) => readBounds(page, id)))
  for (const id of ids) {
    await updateName(
      page,
      id,
      'A deliberately very long non-target label that must not resize this BPMN element'
    )
  }
  const after = await Promise.all(ids.map((id) => readBounds(page, id)))
  expect(after.map(({ x, y, width, height }) => ({ x, y, width, height }))).toEqual(
    before.map(({ x, y, width, height }) => ({ x, y, width, height }))
  )
})

test('post-import AI sweep grows fixed-size task and call-activity shapes', async ({ page }) => {
  await boot(page, 'AI Sweep')
  const resized = await page.evaluate(async (xml) => {
    const w = window as unknown as HookWindow
    const modeler = w.__ORBITPM_LITE__.modeler
    await modeler.importXML(xml)
    const count = w.__ORBITPM_LITE__.autoSizeAll()
    ;(modeler.get('canvas') as { zoom(mode: 'fit-viewport'): void }).zoom('fit-viewport')
    return count
  }, fixedSizeXml())
  expect(resized).toBe(2)

  const task = await readBounds(page, 'Task_Long')
  const call = await readBounds(page, 'Call_Long')
  expect({ width: task.width, height: task.height }).toEqual({ width: 160, height: 102 })
  expect({ width: call.width, height: call.height }).toEqual({ width: 160, height: 138 })
  await expect(
    page.locator('.djs-element[data-element-id="Call_Long"] g.orbitpm-sub-chip')
  ).toBeVisible()
})

test('repeatable trigger dialog validates, tags, tooltips, and re-seeds every row', async ({
  page
}) => {
  await boot(page, 'Repeatable Triggers')
  const startId = await selectFirstOfType(page, 'bpmn:StartEvent')
  await page.getByRole('button', { name: 'Details…', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'Step details' })

  await dialog.getByRole('button', { name: '＋ Add trigger' }).click()
  await dialog.getByLabel('Trigger 1', { exact: true }).selectOption('dmthub')
  await expect(dialog.getByRole('alert')).toContainText('DMT Hub service name is required')
  await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled()
  await dialog.getByLabel('DMT Hub service').fill('ClaimsHub')
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Apply' })).toBeEnabled()

  await dialog.getByRole('button', { name: '＋ Add trigger' }).click()
  await expect(dialog.getByText('Trigger 1', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Trigger 2', { exact: true })).toBeVisible()
  await dialog.getByLabel('Trigger 2', { exact: true }).selectOption('email')
  await dialog.getByLabel('Trigger detail').nth(1).fill('customer email')
  await dialog.getByRole('button', { name: 'Apply' }).click()

  const startGfx = page.locator(`.djs-element[data-element-id="${startId}"]`)
  const triggerTag = startGfx.locator('g[data-org-tooltip]').filter({ hasText: 'DMT HUB +1' })
  await expect(triggerTag).toBeVisible()
  await expect(triggerTag).toContainText('DMT HUB +1')
  await triggerTag.hover()
  const tooltip = page.locator('.orbitpm-canvas-tooltip')
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toContainText('DMT HUB — ClaimsHub')
  await expect(tooltip).toContainText('EMAIL — customer email')

  await selectElement(page, startId)
  await page.getByRole('button', { name: 'Details…', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Step details' })
  await expect(dialog.getByRole('button', { name: 'Remove this trigger' })).toHaveCount(2)
  await expect(dialog.getByLabel('Trigger 1', { exact: true })).toHaveValue('dmthub')
  await expect(dialog.getByLabel('DMT Hub service')).toHaveValue('ClaimsHub')
  await expect(dialog.getByLabel('Trigger 2', { exact: true })).toHaveValue('email')
  await expect(dialog.getByLabel('Trigger detail').nth(1)).toHaveValue('customer email')
})

test('legacy trigger trio seeds one row and Apply adds canonical list plus legacy mirror', async ({
  page
}) => {
  await boot(page, 'Legacy Trigger')
  await page.evaluate(async (xml) => {
    const w = window as unknown as HookWindow
    const modeler = w.__ORBITPM_LITE__.modeler
    await modeler.importXML(xml)
    ;(modeler.get('canvas') as { zoom(mode: 'fit-viewport'): void }).zoom('fit-viewport')
  }, legacyTriggerXml())

  await selectElement(page, 'Start_Legacy')
  await page.getByRole('button', { name: 'Details…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Step details' })
  await expect(dialog.getByRole('button', { name: 'Remove this trigger' })).toHaveCount(1)
  await expect(dialog.getByLabel('Trigger 1', { exact: true })).toHaveValue('email')
  await expect(dialog.getByLabel('Trigger detail')).toHaveValue('legacy mailbox detail')
  await dialog.getByRole('button', { name: 'Apply' }).click()

  const attrs = await page.evaluate(async () => {
    const w = window as unknown as HookWindow
    const { xml } = await w.__ORBITPM_LITE__.modeler.saveXML({ format: true })
    if (!xml) throw new Error('saveXML returned no XML')
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    const start = doc.querySelector('[id="Start_Legacy"]')
    if (!start) throw new Error('Start_Legacy missing after save')
    return {
      triggers: start.getAttribute('orbitpm:triggers'),
      trigger: start.getAttribute('orbitpm:trigger'),
      triggerService: start.getAttribute('orbitpm:triggerService'),
      triggerDetail: start.getAttribute('orbitpm:triggerDetail')
    }
  })
  expect(attrs).toEqual({
    triggers: 'email —  — legacy mailbox detail',
    trigger: 'email',
    triggerService: null,
    triggerDetail: 'legacy mailbox detail'
  })
})

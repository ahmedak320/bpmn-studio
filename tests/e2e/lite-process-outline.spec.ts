import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()

async function openBlankDiagram(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete window.showDirectoryPicker
    delete window.showOpenFilePicker
  })
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page.getByRole('button', { name: /New blank diagram/i }).click()
  await expect(page.locator('.djs-container > svg').first()).toBeVisible({ timeout: 20_000 })
}

async function tabTo(
  page: Page,
  target: Locator,
  options: { reverse?: boolean; maxPresses?: number } = {}
): Promise<void> {
  const key = options.reverse ? 'Shift+Tab' : 'Tab'
  const maxPresses = options.maxPresses ?? 100
  for (let attempt = 0; attempt <= maxPresses; attempt += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return
    await page.keyboard.press(key)
  }
  const active = await page.evaluate(() => {
    const element = document.activeElement
    return element
      ? `${element.tagName.toLowerCase()}#${element.id}.${element.className}`
      : 'no active element'
  })
  throw new Error(`Keyboard focus did not reach the requested control; stopped at ${active}.`)
}

const keyboardJourneyLocales = [
  {
    language: 'en',
    direction: 'ltr',
    name: 'English LTR',
    blankDiagram: 'New blank diagram',
    outline: 'Process outline',
    list: 'Process nodes and flows',
    nodeType: 'Node type',
    nodeLabel: 'Node label',
    connectAfter: 'Connect after',
    addNode: 'Add node',
    nameEnglish: 'Name (English)',
    saveChanges: 'Save changes',
    initialName: 'Review request',
    revisedName: 'Review completed'
  },
  {
    language: 'ar',
    direction: 'rtl',
    name: 'Arabic RTL',
    blankDiagram: 'مخطط فارغ جديد',
    outline: 'المخطط التفصيلي للعملية',
    list: 'عقد العملية وتدفقاتها',
    nodeType: 'نوع العقدة',
    nodeLabel: 'تسمية العقدة',
    connectAfter: 'الاتصال بعد',
    addNode: 'إضافة عقدة',
    nameEnglish: 'الاسم (بالإنجليزية)',
    saveChanges: 'حفظ التغييرات',
    initialName: 'مراجعة الطلب',
    revisedName: 'اكتملت المراجعة'
  }
] as const

test.beforeAll(() => {
  expect(readFileSync(DIST, 'utf8').length).toBeGreaterThan(500_000)
})

test('process outline authors BPMN and synchronizes selection with the live canvas', async ({
  page
}) => {
  await openBlankDiagram(page)

  const toggle = page.getByRole('button', { name: 'Process outline', exact: true })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()

  const outline = page.getByRole('complementary', { name: 'Process outline' })
  const tree = outline.getByRole('tree', { name: 'Process nodes and flows' })
  await expect(outline).toBeVisible()
  await expect(tree).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')

  const start = tree.getByRole('treeitem', { name: /Start event:/ }).first()
  const startId = await start.getAttribute('data-outline-id')
  expect(startId).toBeTruthy()

  await start.focus()
  await start.press('Enter')
  await expect(page.locator(`.djs-element[data-element-id="${startId!}"]`)).toHaveClass(/selected/)

  const addForm = outline.getByRole('form', { name: 'Add node' })
  await addForm.getByLabel('Node type').selectOption('bpmn:Task')
  await addForm.getByLabel('Node label').fill('Review request')
  await addForm.getByLabel('Connect after').selectOption(startId!)
  await addForm.getByRole('button', { name: 'Add node', exact: true }).click()

  let task = tree.getByRole('treeitem', { name: /Task: Review request/ })
  await expect(task).toBeVisible()
  const taskId = await task.getAttribute('data-outline-id')
  expect(taskId).toBeTruthy()
  await expect(page.locator(`.djs-element[data-element-id="${taskId!}"]`)).toBeVisible()

  await task.focus()
  await task.press('F2')
  await outline.getByLabel('Name (English)', { exact: true }).fill('Review completed')
  await outline.getByRole('button', { name: 'Save changes' }).click()
  task = tree.getByRole('treeitem', { name: /Task: Review completed/ })
  await expect(task).toBeVisible()

  // Canvas → outline: selecting through the same public bpmn-js service used by
  // the graphical canvas updates aria-selected and the roving tab stop.
  await page.evaluate((id) => {
    const runtime = window as unknown as {
      __ORBITPM_LITE__: { modeler: { get(name: string): unknown } }
    }
    const registry = runtime.__ORBITPM_LITE__.modeler.get('elementRegistry') as {
      get(elementId: string): unknown
    }
    const selection = runtime.__ORBITPM_LITE__.modeler.get('selection') as {
      select(element: unknown): void
    }
    selection.select(registry.get(id))
  }, startId!)
  await expect(start).toHaveAttribute('aria-selected', 'true')
  await expect(start).toHaveAttribute('tabindex', '0')

  // Outline → canvas: keyboard activation selects and scrolls to the live BPMN
  // element instead of maintaining a disconnected React-only selection.
  await task.focus()
  await task.press('Enter')
  await expect(task).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator(`.djs-element[data-element-id="${taskId!}"]`)).toHaveClass(/selected/)

  await toggle.click()
  await expect(outline).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toBeFocused()
})

for (const locale of keyboardJourneyLocales) {
  test(`keyboard-only Process Outline create, edit, and save works in ${locale.name}`, async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.addInitScript((language) => {
      delete window.showDirectoryPicker
      delete window.showOpenFilePicker
      localStorage.setItem('orbitpm.lite.lang', language)
    }, locale.language)
    await page.goto(FILE_URL, { waitUntil: 'load' })
    await expect(page.locator('html')).toHaveAttribute('lang', locale.language)
    await expect(page.locator('html')).toHaveAttribute('dir', locale.direction)

    await page.evaluate(() => {
      const pointerActivity = { count: 0 }
      ;(
        window as unknown as {
          __ORBITPM_OUTLINE_POINTER_ACTIVITY__: { count: number }
        }
      ).__ORBITPM_OUTLINE_POINTER_ACTIVITY__ = pointerActivity
      for (const eventName of ['pointerdown', 'mousedown', 'touchstart']) {
        document.addEventListener(
          eventName,
          () => {
            pointerActivity.count += 1
          },
          true
        )
      }
    })

    const blankDiagram = page.getByRole('button', {
      name: locale.blankDiagram,
      exact: true
    })
    await tabTo(page, blankDiagram)
    await page.keyboard.press('Enter')
    await expect(page.locator('.djs-container > svg').first()).toBeVisible({ timeout: 20_000 })

    const toggle = page.getByRole('button', { name: locale.outline, exact: true })
    await tabTo(page, toggle)
    await page.keyboard.press('Enter')

    const outline = page.getByRole('complementary', { name: locale.outline })
    const tree = outline.getByRole('tree', { name: locale.list })
    await expect(outline).toBeVisible()
    await expect(outline).toHaveAttribute('dir', locale.direction)
    const start = tree.getByRole('treeitem').first()
    const startId = await start.getAttribute('data-outline-id')
    expect(startId).toBeTruthy()

    const addForm = outline.locator('.orbitpm-process-outline__form-grid form').first()
    await expect(addForm).toHaveAccessibleName(locale.addNode)
    const nodeType = addForm.locator('select').nth(0)
    await expect(nodeType).toHaveAccessibleName(locale.nodeType)
    await tabTo(page, nodeType)
    await page.keyboard.press('Home')
    for (let step = 0; step < 4; step += 1) await page.keyboard.press('ArrowDown')
    await expect(nodeType).toHaveValue('bpmn:Task')

    const nodeLabel = addForm.locator('input').first()
    await expect(nodeLabel).toHaveAccessibleName(locale.nodeLabel)
    await tabTo(page, nodeLabel)
    await page.keyboard.type(locale.initialName)

    const connectAfter = addForm.locator('select').nth(1)
    await expect(connectAfter).toHaveAccessibleName(locale.connectAfter)
    await tabTo(page, connectAfter)
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowDown')
    await expect(connectAfter).toHaveValue(startId!)

    const addNode = addForm.locator('button[type="submit"]')
    await expect(addNode).toHaveAccessibleName(locale.addNode)
    await tabTo(page, addNode)
    await page.keyboard.press('Enter')

    let task = tree.locator('[role="treeitem"][tabindex="0"]')
    await expect(task).toContainText(locale.initialName)
    const taskId = await task.getAttribute('data-outline-id')
    expect(taskId).toBeTruthy()

    await tabTo(page, task, { reverse: true, maxPresses: 40 })
    await page.keyboard.press('F2')
    const editForm = outline.locator('form').first()
    const nameEnglish = editForm.locator('input').first()
    await expect(nameEnglish).toHaveAccessibleName(locale.nameEnglish)
    await expect(nameEnglish).toBeFocused()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(locale.revisedName)

    const saveChanges = editForm.locator('button[type="submit"]')
    await expect(saveChanges).toHaveAccessibleName(locale.saveChanges)
    await tabTo(page, saveChanges)
    await page.keyboard.press('Enter')

    task = tree.locator(`[data-outline-id="${taskId!}"]`)
    await expect(task).toContainText(locale.revisedName)
    await expect(task).toBeFocused()
    await expect
      .poll(() =>
        page.evaluate((id) => {
          const modeler = (
            window as unknown as {
              __ORBITPM_LITE__: { modeler: { get(name: string): unknown } }
            }
          ).__ORBITPM_LITE__.modeler
          const element = (
            modeler.get('elementRegistry') as {
              get(elementId: string): { businessObject?: { name?: string } } | undefined
            }
          ).get(id)
          return element?.businessObject?.name ?? null
        }, taskId!)
      )
      .toBe(locale.revisedName)
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as {
              __ORBITPM_OUTLINE_POINTER_ACTIVITY__: { count: number }
            }
          ).__ORBITPM_OUTLINE_POINTER_ACTIVITY__.count
      )
    ).toBe(0)
  })
}

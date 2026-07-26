import { expect, test, type Page } from '@playwright/test'
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

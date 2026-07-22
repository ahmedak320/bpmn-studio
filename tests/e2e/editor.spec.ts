import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, openFromTree, shapeIn, activeCanvas } from './harness'
import { linearDiagram } from './diagrams'

const NEW_LABEL = 'Reviewed order [e2e]'

// Open a .bpmn -> canvas renders; edit a task label via bpmn-js direct editing
// -> dirty appears; Ctrl+S -> dirty clears and disk content changes; reopen the
// tab -> the edit persisted.
test('opens a diagram, edits a label, saves, and persists across reopen', async ({ launchApp }) => {
  const { window, workspaceDir } = await launchApp({
    seedRoot: true,
    seedFiles: { 'sales/order.bpmn': linearDiagram('Process_order', 'Order', 'Review order') }
  })

  await openFromTree(window, 'order.bpmn', 'sales')

  // Canvas renders with shapes.
  await expect(window.locator('.djs-container').first()).toBeVisible()
  expect(await activeCanvas(window).locator('.djs-shape').count()).toBeGreaterThan(0)
  await expect(shapeIn(window, 'Task_1')).toBeVisible()

  // Edit the task's label via bpmn-js direct editing (double-click -> type ->
  // commit by clicking empty canvas).
  await shapeIn(window, 'Task_1').dblclick()
  const editor = window.locator('.djs-direct-editing-content')
  await expect(editor).toBeVisible()
  await editor.fill(NEW_LABEL)
  await activeCanvas(window).click({ position: { x: 8, y: 8 } })

  // Dirty state shows in the toolbar and the tab title.
  await expect(window.locator('.orbitpm-editor:visible .orbitpm-editor__dirty-flag')).toHaveText(
    'Unsaved changes'
  )
  await expect(window.getByText(/●\s*order\.bpmn/)).toBeVisible()

  // Ctrl+S clears dirty…
  await window.keyboard.press('Control+s')
  await expect(window.locator('.orbitpm-editor:visible .orbitpm-editor__dirty-flag')).toHaveText(
    'Saved',
    { timeout: 15_000 }
  )

  // …and the change is on disk.
  const filePath = join(workspaceDir, 'sales', 'order.bpmn')
  await expect
    .poll(() => readFileSync(filePath, 'utf8').includes(NEW_LABEL), { timeout: 15_000 })
    .toBe(true)

  // Close the tab (not dirty after save -> no confirm) then reopen it, forcing a
  // fresh read from disk.
  await window.locator('[title="Close"]').first().click()
  await expect(window.locator('.orbitpm-editor')).toHaveCount(0)

  await openFromTree(window, 'order.bpmn', 'sales')
  await shapeIn(window, 'Task_1').dblclick()
  await expect(window.locator('.djs-direct-editing-content')).toHaveText(NEW_LABEL)
  await window.keyboard.press('Escape')
})

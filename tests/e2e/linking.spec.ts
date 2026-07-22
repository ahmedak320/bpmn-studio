import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, openFromTree, shapeIn, activeCanvas } from './harness'
import { linearDiagram, callActivityDiagram } from './diagrams'

// Two processes: a main flow with an (initially unlinked) call activity, and a
// sub-process to link to. Selecting the call activity reveals "Link to
// process…"; picking the sub-process writes calledElement (verified on the
// saved XML); double-clicking the call activity drills into the linked process.
test('links a call activity and drills into the linked process', async ({ launchApp }) => {
  const { window, workspaceDir } = await launchApp({
    seedRoot: true,
    seedFiles: {
      'sales/main.bpmn': callActivityDiagram('Process_main', 'Main Flow', {
        name: 'Run the sub-process'
      }),
      'sales/sub.bpmn': linearDiagram('Process_sub', 'Sub Process', 'Sub step')
    }
  })

  await openFromTree(window, 'main.bpmn', 'sales')
  await expect(shapeIn(window, 'CallActivity_1')).toBeVisible()

  // Selecting the call activity reveals the link button (only shown for a
  // single selected bpmn:CallActivity).
  await shapeIn(window, 'CallActivity_1').click()
  const linkButton = window.getByRole('button', { name: /link to process/i })
  await expect(linkButton).toBeVisible()

  // The picker lists the other process; pick it.
  await linkButton.click()
  const picker = window.getByRole('dialog', { name: 'Link to process' })
  await expect(picker).toBeVisible()
  await expect(picker.getByText('Sub Process')).toBeVisible()
  await picker.getByText('Sub Process').click()
  await expect(picker).toHaveCount(0)

  // Save, then verify calledElement landed in the on-disk XML.
  await window.keyboard.press('Control+s')
  const mainPath = join(workspaceDir, 'sales', 'main.bpmn')
  await expect
    .poll(() => readFileSync(mainPath, 'utf8').includes('calledElement="Process_sub"'), {
      timeout: 15_000
    })
    .toBe(true)

  // Double-clicking the (now linked) call activity drills into the sub-process:
  // a sub.bpmn tab opens (scoped to the tab strip) and its task renders.
  await shapeIn(window, 'CallActivity_1').dblclick()
  await expect(window.locator('section').getByText('sub.bpmn', { exact: true })).toBeVisible()
  await expect(shapeIn(window, 'Task_1')).toBeVisible()
})

// A call activity whose calledElement resolves to no known process must be
// surfaced by the footer's unresolved-links badge.
test('footer shows the unresolved-links badge for a dangling calledElement', async ({
  launchApp
}) => {
  const { window } = await launchApp({
    seedRoot: true,
    seedFiles: {
      'sales/broken.bpmn': callActivityDiagram('Process_broken', 'Broken', {
        name: 'Calls a missing process',
        calledElement: 'Process_missing'
      })
    }
  })

  await openFromTree(window, 'broken.bpmn', 'sales')
  await expect(activeCanvas(window).locator('.djs-shape').first()).toBeVisible()

  await expect(window.getByText(/\b1 unresolved link\b/)).toBeVisible()
})

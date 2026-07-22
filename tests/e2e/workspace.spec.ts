import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, setPromptValue } from './harness'
import { linearDiagram } from './diagrams'

// Pre-seeded root with a fixture tree (sales/ + hr/ folders, sample .bpmn
// files). The tree must render, and creating a process via the custom
// ContextMenu (not the native menu) must write the file to disk and surface it
// in the tree.
test('renders the seeded tree and creates a process via the context menu', async ({
  launchApp
}) => {
  const { window, workspaceDir } = await launchApp({
    seedRoot: true,
    seedFiles: {
      'sales/order.bpmn': linearDiagram('Process_order', 'Order', 'Review order'),
      'hr/onboarding.bpmn': linearDiagram('Process_onboarding', 'Onboarding', 'Welcome aboard')
    }
  })

  // Both seeded folders render in the sidebar.
  await expect(window.getByText('sales', { exact: true })).toBeVisible()
  await expect(window.getByText('hr', { exact: true })).toBeVisible()

  // Expanding a folder reveals its seeded file.
  await window.getByText('sales', { exact: true }).click()
  await expect(window.getByText('order.bpmn', { exact: true })).toBeVisible()

  // New process via the custom ContextMenu: right-click the folder row, click
  // the "New process" item; the (stubbed) prompt supplies the name.
  await setPromptValue(window, 'Quarterly Review')
  await window.getByText('sales', { exact: true }).click({ button: 'right' })
  await window.getByRole('button', { name: 'New process' }).click()

  // The file is written to disk under the right folder with the expected slug…
  const created = join(workspaceDir, 'sales', 'quarterly-review.bpmn')
  await expect.poll(() => existsSync(created), { timeout: 15_000 }).toBe(true)

  // …and shows up in the tree (scoped to the sidebar; it also opens as a tab).
  await expect(
    window.getByRole('complementary').getByText('quarterly-review.bpmn', { exact: true })
  ).toBeVisible()
})

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, forceOnline, activeCanvas, shapeIn } from './harness'

// With ORBITPM_E2E_FAKE_LLM on, the main process reports one fake-configured
// provider (so the AI panel is enabled without keys) and returns a deterministic
// fixture IR selected by a [fixture:NAME] marker. Here the marker picks B3's
// ex1_professor fixture (an exclusive-gateway process), proving the panel ->
// pipeline -> file -> tab flow end to end.
test('generates a diagram from a description via the fake LLM path', async ({ launchApp }) => {
  const { window, workspaceDir } = await launchApp({
    seedRoot: true,
    fakeLlm: true,
    seedDirs: ['sales']
  })

  // The AI panel is enabled (not the "no providers configured" state).
  await expect(window.getByRole('button', { name: 'Generate' })).toBeVisible()
  await expect(window.getByRole('button', { name: 'Open Settings' })).toHaveCount(0)

  // Fake path needs no network; make the panel treat us as online deterministically.
  await forceOnline(window)

  // Fill the form: description carries the fixture marker; Name drives the slug;
  // target the seeded "sales" folder.
  await window.getByPlaceholder(/Describe the process/i).fill('expense approval [fixture:exclusive]')
  await window.getByPlaceholder(/Order process/i).fill('Expense Approval')
  await window
    .locator('select')
    .filter({ hasText: /workspace root|sales/ })
    .selectOption('sales')

  await window.getByRole('button', { name: 'Generate' }).click()

  // A new editor tab opens and renders the generated diagram. (Scope to the tab
  // strip so we don't match the AI panel's "Created sales/expense-approval.bpmn"
  // result link.)
  await expect(
    window.locator('section').getByText('expense-approval.bpmn', { exact: true })
  ).toBeVisible({ timeout: 30_000 })
  await expect(activeCanvas(window).locator('.djs-shape').first()).toBeVisible({ timeout: 30_000 })

  // The exclusive fixture drove generation: its gateway id (from ex1_professor)
  // is present in the rendered diagram.
  await expect(shapeIn(window, 'exclusive1')).toBeVisible()

  // The .bpmn exists on disk in the chosen folder with the correct slug.
  const created = join(workspaceDir, 'sales', 'expense-approval.bpmn')
  await expect.poll(() => existsSync(created), { timeout: 30_000 }).toBe(true)
})

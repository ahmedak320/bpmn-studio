import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, submitPrompt } from './harness'
import { linearDiagram } from './diagrams'

// Regression guard for E1-1 / E2-1: the tree CRUD flows (New process, Rename,
// New folder) used window.prompt, which Electron does NOT support — in the real
// packaged app the handlers silently no-opped (prompt returned null / threw
// "prompt() is not supported"). The old e2e harness stubbed window.prompt, so
// the bug was invisible in CI. This spec removes that mask: it drives the REAL
// in-app TextInputModal end to end AND fails if a renderer pageerror mentioning
// prompt() ever fires again (i.e. someone reverts to window.prompt).
test('tree CRUD uses the in-app modal — no window.prompt, files land on disk', async ({
  launchApp
}) => {
  const { window, workspaceDir } = await launchApp({
    seedRoot: true,
    seedFiles: {
      'ops/intake.bpmn': linearDiagram('Process_intake', 'Intake', 'Do intake')
    }
  })

  // Collect any uncaught renderer error. window.prompt in Electron surfaces as
  // 'prompt() is not supported'; with the fix, nothing prompt-related must fire.
  const pageErrors: string[] = []
  window.on('pageerror', (err) => pageErrors.push(err.message))

  const tree = window.getByRole('complementary')
  await expect(tree.getByText('ops', { exact: true })).toBeVisible()

  // 1) NEW PROCESS — right-click the folder, pick the item, fill the real modal.
  await tree.getByText('ops', { exact: true }).click({ button: 'right' })
  await window.getByRole('button', { name: 'New process' }).click()
  await submitPrompt(window, 'Weekly Sync')

  const createdProcess = join(workspaceDir, 'ops', 'weekly-sync.bpmn')
  await expect
    .poll(() => existsSync(createdProcess), { timeout: 15_000 })
    .toBe(true)

  // 2) RENAME — expand the folder to reveal the seeded file, then rename it.
  await tree.getByText('ops', { exact: true }).click()
  await expect(tree.getByText('intake.bpmn', { exact: true })).toBeVisible()
  await tree.getByText('intake.bpmn', { exact: true }).click({ button: 'right' })
  await window.getByRole('button', { name: 'Rename' }).click()
  await submitPrompt(window, 'renamed-intake.bpmn')

  const renamed = join(workspaceDir, 'ops', 'renamed-intake.bpmn')
  const originalName = join(workspaceDir, 'ops', 'intake.bpmn')
  await expect.poll(() => existsSync(renamed), { timeout: 15_000 }).toBe(true)
  await expect.poll(() => existsSync(originalName), { timeout: 15_000 }).toBe(false)
  await expect(tree.getByText('renamed-intake.bpmn', { exact: true })).toBeVisible()

  // 3) NEW FOLDER — right-click the folder, pick the item, fill the real modal.
  await tree.getByText('ops', { exact: true }).click({ button: 'right' })
  await window.getByRole('button', { name: 'New folder' }).click()
  await submitPrompt(window, 'Archive')

  const createdFolder = join(workspaceDir, 'ops', 'Archive')
  await expect.poll(() => existsSync(createdFolder), { timeout: 15_000 }).toBe(true)

  // The whole journey must have run without any prompt() error reaching the page.
  const promptErrors = pageErrors.filter((m) => /prompt\(\)/i.test(m))
  expect(promptErrors, `unexpected renderer errors: ${pageErrors.join(' | ')}`).toEqual([])
})

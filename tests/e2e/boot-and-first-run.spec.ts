import { test, expect } from './harness'

// With NO persisted workspace root, the app must show the first-run
// WorkspacePicker. Choosing a folder needs the native OS directory dialog, so
// we assert visibility + copy only and never click through it (every other
// spec pre-seeds the root instead).
test('first run with no persisted root shows the workspace picker', async ({ launchApp }) => {
  const { window } = await launchApp({ seedRoot: false })

  // The contextBridge API is present (preload loaded correctly).
  expect(await window.evaluate(() => typeof (window as unknown as { orbitpm?: unknown }).orbitpm)).toBe(
    'object'
  )

  // Heading + explanatory copy.
  await expect(
    window.getByRole('heading', { name: /choose your processes folder/i })
  ).toBeVisible()
  await expect(window.getByText(/keeps your BPMN diagrams as plain files on disk/i)).toBeVisible()
  await expect(window.getByText(/OneDrive/i)).toBeVisible()

  // The choose-folder button is present (not clicked — it opens a native dialog).
  await expect(window.getByRole('button', { name: /choose folder/i })).toBeVisible()

  // The 3-pane workspace chrome is NOT shown yet: no folder tree, no AI panel,
  // no editor toolbar. (The product name itself appears in the picker copy, so
  // we assert on chrome that is unique to the workspace view instead.)
  await expect(window.getByText('✨ Generate with AI')).toHaveCount(0)
  await expect(window.getByRole('button', { name: /^Save$/ })).toHaveCount(0)
})

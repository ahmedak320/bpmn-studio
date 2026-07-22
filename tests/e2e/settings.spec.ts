import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from './harness'

// Settings modal: all seven provider sections render; entering a dummy DeepSeek
// key and saving reports success. safeStorage is typically unavailable on a
// headless Linux box, in which case the vault falls back to plaintext and the
// modal shows an encryption-warning banner — we read the vault file to know
// which state occurred and assert it deterministically.
test('settings modal renders 7 providers and persists a DeepSeek key', async ({ launchApp }) => {
  const { window, userDataDir } = await launchApp({ seedRoot: true })

  const openSettings = async (): Promise<void> => {
    // Scope to the header (banner) — the AI panel also has an "Open Settings" button.
    await window.getByRole('banner').getByRole('button', { name: /settings/i }).click()
    await expect(window.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  }

  await openSettings()

  // Seven provider sections.
  await expect(window.locator('.settings-provider')).toHaveCount(7)

  // Enter a dummy DeepSeek key and save.
  const deepseek = window.locator('.settings-provider[data-provider="deepseek"]')
  await expect(deepseek).toBeVisible()
  await deepseek.locator('input').first().fill('dummy-deepseek-key-123')
  await deepseek.getByRole('button', { name: 'Save', exact: true }).click()

  // The section reports a successful save.
  await expect(deepseek.locator('.settings-status--ok')).toHaveText('Saved')

  // Inspect the on-disk vault to learn whether encryption was available.
  const vault = JSON.parse(readFileSync(join(userDataDir, 'secrets.json'), 'utf8')) as {
    encryptionAvailable: boolean
  }

  // Reopen the modal (status is re-fetched on open) to verify persisted state.
  await window.locator('.settings-modal__close').click()
  await openSettings()

  // DeepSeek is now reported as configured.
  await expect(
    window.locator('.settings-provider[data-provider="deepseek"] .settings-badge--ok')
  ).toHaveText('Configured')

  // The plaintext-fallback warning banner appears iff encryption was unavailable.
  if (vault.encryptionAvailable) {
    await expect(window.locator('.settings-warning')).toHaveCount(0)
  } else {
    await expect(window.locator('.settings-warning')).toBeVisible()
  }
})

import type { Page } from '@playwright/test'

/** Keep unrelated browser flows deterministic now that every ARIS tab auto-translates. */
export async function disableAutoTranslate(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('orbitpm.lite.cfg.arisAutoTranslate', 'off')
  })
}

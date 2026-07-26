import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()
const OPEN_KEY = 'orbitpm.lite.preferences.v1.details.open'

test.beforeAll(() => {
  expect(readFileSync(DIST, 'utf8').length).toBeGreaterThan(500_000)
})

async function forceFallbackMode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // @ts-expect-error exercise the browser fallback workspace
    delete window.showDirectoryPicker
    // @ts-expect-error exercise the browser fallback workspace
    delete window.showOpenFilePicker
  })
}

async function newProcess(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /New process/i }).first().click()
  const dialog = page.getByRole('dialog', { name: /New Process/i })
  await dialog.getByRole('textbox').fill(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })
}

test('Details uses a viewport-safe modal drawer at 320, 375, and 768px', async ({ page }) => {
  await forceFallbackMode(page)

  for (const width of [320, 375, 768]) {
    await page.setViewportSize({ width, height: 720 })
    await page.goto(FILE_URL, { waitUntil: 'load' })
    await page.evaluate((key) => localStorage.removeItem(key), OPEN_KEY)
    await newProcess(page, `Drawer ${width}`)

    const editor = page.locator('.orbitpm-editor')
    const pane = editor.locator('.orbitpm-lite-sidepane')
    const toggle = editor.getByRole('button', { name: 'Details', exact: true })

    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')

    // Exercise the same pointer path used by touchscreens before the native
    // click activation.
    await toggle.dispatchEvent('pointerdown', {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true
    })
    await toggle.dispatchEvent('pointerup', {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true
    })
    await toggle.click()

    await expect(pane).toBeVisible()
    await expect(pane).toHaveAttribute('role', 'dialog')
    await expect(pane).toHaveAttribute('aria-modal', 'true')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(pane.getByRole('heading', { name: 'Details' })).toBeFocused()
    await expect(editor.locator('.orbitpm-details-backdrop')).toBeVisible()
    await expect(editor.locator('.orbitpm-editor__body > .orbitpm-lite-resizer')).toBeHidden()

    const geometry = await page.evaluate(() => {
      const editor = document.querySelector<HTMLElement>('.orbitpm-editor')
      const body = document.querySelector<HTMLElement>('.orbitpm-editor__body')
      const pane = document.querySelector<HTMLElement>('.orbitpm-lite-sidepane')
      const rail = document.querySelector<HTMLElement>('.orbitpm-details-rail')
      if (!editor || !body || !pane || !rail) throw new Error('Details drawer geometry unavailable')
      const bodyBox = body.getBoundingClientRect()
      const paneBox = pane.getBoundingClientRect()
      const railBox = rail.getBoundingClientRect()
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        editorWidth: editor.getBoundingClientRect().width,
        bodyWidth: bodyBox.width,
        paneWidth: paneBox.width,
        paneLeft: paneBox.left,
        paneRight: paneBox.right,
        bodyLeft: bodyBox.left,
        bodyRight: bodyBox.right,
        railWidth: railBox.width,
        railRight: railBox.right
      }
    })

    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth)
    expect(geometry.editorWidth).toBeLessThanOrEqual(width)
    expect(geometry.railWidth).toBeGreaterThanOrEqual(32)
    if (width < 768) {
      expect(geometry.paneWidth).toBeLessThanOrEqual(width - 32)
      expect(geometry.paneLeft).toBeGreaterThanOrEqual(-1)
      expect(geometry.paneRight).toBeLessThanOrEqual(width - 32 + 1)
      expect(geometry.railRight).toBeLessThanOrEqual(width + 1)
    } else {
      expect(geometry.paneWidth).toBeLessThanOrEqual(geometry.bodyWidth - 32)
      expect(geometry.paneLeft).toBeGreaterThanOrEqual(geometry.bodyLeft - 1)
      expect(geometry.paneRight).toBeLessThanOrEqual(geometry.bodyRight - 32 + 1)
      expect(geometry.railRight).toBeLessThanOrEqual(geometry.bodyRight + 1)
    }

    if (width === 320) {
      // A full editor dialog launched from the drawer temporarily owns Escape;
      // dismissing it must leave the underlying Details drawer open.
      await pane.getByRole('button', { name: 'Open Details…' }).click()
      const fullDialog = page.getByRole('dialog', { name: 'Process details', exact: true })
      await expect(fullDialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(fullDialog).toBeHidden()
      await expect(pane).toBeVisible()
    }

    // Shift+Tab from the programmatically-focused heading wraps to a control
    // inside the drawer instead of escaping into inert editor chrome.
    await pane.getByRole('heading', { name: 'Details' }).focus()
    await page.keyboard.press('Shift+Tab')
    expect(
      await pane.evaluate((node) => node.contains(document.activeElement)),
      'focus must remain inside the modal Details drawer'
    ).toBe(true)

    await page.keyboard.press('Escape')
    await expect(pane).toBeHidden()
    await expect(toggle).toBeVisible()
    await expect(toggle).toBeFocused()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(await page.evaluate((key) => localStorage.getItem(key), OPEN_KEY)).toBe('0')
    expect(
      await editor.locator('.orbitpm-editor__canvas-island').evaluate((node) => node.inert)
    ).toBe(false)
  }
})

test('the 375px drawer and rail move to logical inline-end in Arabic', async ({ page }) => {
  await forceFallbackMode(page)
  await page.setViewportSize({ width: 375, height: 720 })
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page.evaluate((key) => localStorage.removeItem(key), OPEN_KEY)
  await newProcess(page, 'Arabic drawer')
  await page.getByRole('button', { name: /العربية/ }).click()

  const editor = page.locator('.orbitpm-editor')
  const body = editor.locator('.orbitpm-editor__body')
  const pane = editor.locator('.orbitpm-lite-sidepane')
  const toggle = editor.getByRole('button', { name: 'التفاصيل', exact: true })

  await expect(editor).toHaveAttribute('dir', 'rtl')
  await expect(body).toHaveAttribute('dir', 'rtl')
  await expect(toggle.locator('.orbitpm-details-toggle__glyph')).not.toHaveCSS('transform', 'none')
  await toggle.click()
  await expect(pane).toBeVisible()
  await expect(pane).toHaveAttribute('role', 'dialog')
  await expect(pane).toHaveAttribute('dir', 'rtl')

  const geometry = await body.evaluate((bodyNode) => {
    const pane = bodyNode.querySelector<HTMLElement>('.orbitpm-lite-sidepane')
    const rail = bodyNode.querySelector<HTMLElement>('.orbitpm-details-rail')
    if (!pane || !rail) throw new Error('RTL drawer geometry unavailable')
    const bodyBox = bodyNode.getBoundingClientRect()
    const paneBox = pane.getBoundingClientRect()
    const railBox = rail.getBoundingClientRect()
    const paneStyle = getComputedStyle(pane)
    return {
      bodyLeft: bodyBox.left,
      bodyRight: bodyBox.right,
      railLeft: railBox.left,
      railRight: railBox.right,
      paneLeft: paneBox.left,
      paneRight: paneBox.right,
      paneBorderLeft: paneStyle.borderLeftWidth,
      paneBorderRight: paneStyle.borderRightWidth
    }
  })

  expect(geometry.railLeft).toBeLessThanOrEqual(geometry.bodyLeft + 1)
  expect(Math.abs(geometry.paneLeft - geometry.railRight)).toBeLessThanOrEqual(1)
  expect(geometry.paneRight).toBeLessThanOrEqual(376)
  expect(geometry.paneBorderLeft).toBe('0px')
  expect(geometry.paneBorderRight).toBe('1px')

  await page.keyboard.press('Escape')
  await expect(pane).toBeHidden()
  await expect(toggle).toBeFocused()
})

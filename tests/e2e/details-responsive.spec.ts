import { expect, test, type Locator, type Page } from '@playwright/test'
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
    delete window.showDirectoryPicker
    delete window.showOpenFilePicker
  })
}

async function newProcess(page: Page, name: string): Promise<void> {
  await page
    .getByRole('button', { name: /New process/i })
    .first()
    .click()
  const dialog = page.getByRole('dialog', { name: /New Process/i })
  await dialog.getByRole('textbox').fill(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })
}

function detailsPane(editor: Locator): Locator {
  return editor.locator('[id^="orbitpm-details-pane-"]')
}

test('Details uses a viewport-safe modal drawer at 320, 375, and 768px', async ({ page }) => {
  await forceFallbackMode(page)

  for (const width of [320, 375, 768]) {
    await page.setViewportSize({ width, height: 720 })
    await page.goto(FILE_URL, { waitUntil: 'load' })
    await page.evaluate((key) => localStorage.removeItem(key), OPEN_KEY)
    await newProcess(page, `Drawer ${width}`)

    const editor = page.locator('.orbitpm-editor:visible')
    const pane = detailsPane(editor)
    const toggle = editor.getByRole('button', { name: 'Details', exact: true })

    await expect(pane).toBeHidden()
    await expect(pane).toHaveAttribute('aria-hidden', 'true')
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
    await expect(pane).toHaveClass(
      new RegExp(`\\borbitpm-responsive-drawer--${width < 768 ? 'compact' : 'overlay'}\\b`)
    )
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(pane.getByRole('heading', { name: 'Details' })).toBeFocused()
    await expect(editor.locator('.orbitpm-responsive-drawer__backdrop')).toBeVisible()
    await expect(
      editor.getByRole('separator', { name: 'Resize the properties panel' })
    ).toHaveCount(0)

    const geometry = await pane.evaluate((paneNode) => {
      const editor = paneNode.closest<HTMLElement>('.orbitpm-editor')
      const body = paneNode.closest<HTMLElement>('.orbitpm-editor__body')
      const rail = paneNode.querySelector<HTMLElement>('.orbitpm-details-rail')
      const pane = paneNode as HTMLElement
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
        railLeft: railBox.left,
        railRight: railBox.right
      }
    })

    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth)
    expect(geometry.editorWidth).toBeLessThanOrEqual(width)
    expect(geometry.railWidth).toBeGreaterThanOrEqual(32)
    expect(geometry.paneLeft).toBeGreaterThanOrEqual(-1)
    expect(geometry.paneRight).toBeLessThanOrEqual(geometry.viewportWidth + 1)
    expect(Math.abs(geometry.paneRight - geometry.viewportWidth)).toBeLessThanOrEqual(1)
    expect(Math.abs(geometry.railLeft - geometry.paneLeft)).toBeLessThanOrEqual(1)
    expect(geometry.railRight).toBeLessThanOrEqual(geometry.paneRight + 1)

    if (width < 768) {
      // The fix-plan compact contract is a true full-width modal surface. It
      // must not retain the overlay mode's 44px reveal strip.
      expect(Math.abs(geometry.paneWidth - geometry.viewportWidth)).toBeLessThanOrEqual(1)
      expect(Math.abs(geometry.paneLeft)).toBeLessThanOrEqual(1)
    } else {
      // Exactly 768px is overlay mode: the default 300px Details width plus
      // its 36px rail, anchored to viewport inline-end.
      expect(Math.abs(geometry.paneWidth - 336)).toBeLessThanOrEqual(1)
      expect(Math.abs(geometry.paneLeft - (geometry.viewportWidth - 336))).toBeLessThanOrEqual(1)
      expect(geometry.paneWidth).toBeLessThan(geometry.bodyWidth)
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
      await editor
        .locator('.orbitpm-editor__canvas-island')
        .evaluate((node) => node instanceof HTMLElement && node.inert)
    ).toBe(false)
  }
})

test('the 375px drawer and rail move to logical inline-end in Arabic', async ({ page }) => {
  await forceFallbackMode(page)
  await page.setViewportSize({ width: 375, height: 720 })
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page.evaluate((key) => localStorage.removeItem(key), OPEN_KEY)
  await newProcess(page, 'Arabic drawer')
  const actionOverflow = page.getByRole('button', {
    name: 'More application actions',
    exact: true
  })
  await actionOverflow.click()
  await expect(actionOverflow).toHaveAttribute('aria-expanded', 'true')
  const actionMenu = page.getByRole('menu', { name: 'More application actions' })
  await actionMenu.getByRole('menuitem', { name: /Interface: العربية/ }).click()

  const editor = page.locator('.orbitpm-editor:visible')
  const body = editor.locator('.orbitpm-editor__body')
  const pane = detailsPane(editor)
  const toggle = editor.getByRole('button', { name: 'التفاصيل', exact: true })

  await expect(editor).toHaveAttribute('dir', 'rtl')
  await expect(body).toHaveAttribute('dir', 'rtl')
  await expect(toggle.locator('.orbitpm-details-rail__glyph')).not.toHaveCSS('transform', 'none')
  await toggle.click()
  await expect(pane).toBeVisible()
  await expect(pane).toHaveAttribute('role', 'dialog')
  await expect(pane).toHaveAttribute('dir', 'rtl')

  const geometry = await pane.evaluate((paneNode) => {
    const pane = paneNode as HTMLElement
    const bodyNode = pane.closest<HTMLElement>('.orbitpm-editor__body')
    const rail = pane.querySelector<HTMLElement>('.orbitpm-details-rail')
    if (!bodyNode || !rail) throw new Error('RTL drawer geometry unavailable')
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

  expect(Math.abs(geometry.paneLeft - geometry.bodyLeft)).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.railRight - geometry.paneRight)).toBeLessThanOrEqual(1)
  expect(geometry.paneRight).toBeLessThanOrEqual(376)
  expect(geometry.paneBorderLeft).toBe('0px')
  expect(geometry.paneBorderRight).toBe('1px')

  await page.keyboard.press('Escape')
  await expect(pane).toBeHidden()
  await expect(toggle).toBeFocused()
})

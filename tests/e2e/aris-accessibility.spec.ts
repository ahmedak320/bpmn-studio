import { expect, test, type Page } from '@playwright/test'
import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Mandatory UI/accessibility evidence (tests/e2e/mandatory-ui-accessibility-evidence.json)
// for the ARIS shell:
//
//  - UI-08 "NVDA on Windows and VoiceOver on macOS smoke tests." The manual
//    NVDA/VoiceOver runs themselves stay covered by
//    verify-external-release-evidence.mjs (supplementalGate) — that gate needs
//    a human with real assistive technology and cannot be replaced by
//    Playwright. What this file evidences is the automatable prerequisite a
//    screen reader depends on: real focus management (initial focus, Tab
//    containment, inertness of the rest of the page, and focus restoration) on
//    every dialog the ARIS shell opens.
//  - UI-04 "Semantic tabs, tree, search, menus, dialogs, and assistant." The
//    model explorer is the ARIS shell's list/tree surface; this file evidences
//    that it is keyboard-operable and synchronizes canvas selection, replacing
//    the deleted lite-process-outline.spec.ts binding.
//
// UI-03 ("Full keyboard-only creation and editing through the outline.") is
// deliberately NOT evidenced here — see the task record: the ARIS shell has no
// outline/tree-based creation-and-editing surface today, so there is nothing
// true to assert. See this spec's sibling report for the exact gap.

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()
const REFERENCE_AML = resolve(HERE, '../../../reference/AnimalWF/ARISAMLExport.xml')

test.beforeAll(() => {
  expect(readFileSync(DIST, 'utf8').length).toBeGreaterThan(500_000)
  expect(statSync(REFERENCE_AML).isFile(), `reference fixture missing at ${REFERENCE_AML}`).toBe(
    true
  )
})

async function forceFallbackMode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.clear()
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'storage', { configurable: true, value: {} })
  })
}

async function openReferenceExport(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 })
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page
    .getByRole('heading', { name: 'OrbitPM ARIS Studio Lite' })
    .waitFor({ state: 'visible' })
  await page.locator('input[type="file"]').first().setInputFiles(REFERENCE_AML)
  await expect(page.locator('[data-orbitpm-aris-model]')).toHaveCount(8)
  await page
    .locator('[data-orbitpm-aris-canvas] [data-element-id^="ObjOcc."]')
    .first()
    .waitFor({ state: 'attached' })
}

test('Settings dialog traps Tab at both ends and makes the rest of the page inert while open', async ({
  page
}) => {
  await openReferenceExport(page)

  const trigger = page.getByRole('banner').getByRole('button', { name: '⚙ Settings', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Settings — AI keys', exact: true })
  await expect(dialog).toBeVisible()

  // `getByLabel` targets the `aria-label` specifically: the dialog also has a
  // second, textual "Close" footer button (settings.close, distinct from the
  // icon close button's settings.close.aria), so a name-based role query is
  // ambiguous here.
  const closeButton = dialog.getByLabel('Close', { exact: true })
  await expect(closeButton).toBeFocused()

  // Shift+Tab from the first focusable control wraps to the last one inside
  // the dialog, never escaping it.
  await page.keyboard.press('Shift+Tab')
  const afterShiftTab = dialog.locator(':focus')
  await expect(afterShiftTab).toHaveCount(1)
  const wrappedToLast = await afterShiftTab.evaluate(
    (node, closeEl) => node !== closeEl,
    await closeButton.elementHandle()
  )
  expect(wrappedToLast).toBe(true)

  // Tab from that last control wraps back around to the close button.
  await page.keyboard.press('Tab')
  await expect(closeButton).toBeFocused()

  // While the dialog is open, a header control behind it cannot take focus:
  // AccessibleDialog marks every outside branch `inert`, and `inert` blocks
  // focus at the browser level.
  const assistantTrigger = page.getByRole('button', { name: 'Assistant', exact: true })
  const tookFocus = await assistantTrigger.evaluate((node) => {
    ;(node as HTMLElement).focus()
    return document.activeElement === node
  })
  expect(tookFocus).toBe(false)
  await expect(closeButton).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  // Focus returns to the exact control that opened the dialog.
  await expect(trigger).toBeFocused()

  // Now that the dialog is closed, the previously inert control is reachable again.
  const focusableAfterClose = await assistantTrigger.evaluate((node) => {
    ;(node as HTMLElement).focus()
    return document.activeElement === node
  })
  expect(focusableAfterClose).toBe(true)
})

test('Assistant dialog traps focus and restores it to its own trigger on close', async ({
  page
}) => {
  await openReferenceExport(page)

  const trigger = page.getByRole('button', { name: 'Assistant', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Process assistant', exact: true })
  await expect(dialog).toBeVisible()

  // Scoped by `aria-label`: the dialog also has a second, textual
  // "Close assistant" footer button distinct from the icon close button.
  const closeButton = dialog.getByLabel('Close assistant', { exact: true })
  await expect(closeButton).toBeFocused()

  await page.keyboard.press('Shift+Tab')
  const afterShiftTab = dialog.locator(':focus')
  await expect(afterShiftTab).toHaveCount(1)
  const wrappedToLast = await afterShiftTab.evaluate(
    (node, closeEl) => node !== closeEl,
    await closeButton.elementHandle()
  )
  expect(wrappedToLast).toBe(true)

  await page.keyboard.press('Tab')
  await expect(closeButton).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('the model explorer is a keyboard-operable list that synchronizes canvas selection without a pointer', async ({
  page
}) => {
  await openReferenceExport(page)

  const modelButtons = page.locator('[data-orbitpm-aris-model]:not([disabled])')
  const modelCount = await modelButtons.count()
  expect(modelCount).toBeGreaterThan(1)

  const occurrences = page.locator('[data-orbitpm-aris-canvas] [data-element-id^="ObjOcc."]')
  const firstModelOccurrenceId = await occurrences.first().getAttribute('data-element-id')

  // Reach the second model button by keyboard focus alone (no click on the
  // explorer), then activate it with Enter — the native semantics of a
  // `<button>`, exercised for real by dispatching a keyboard event, not
  // assumed.
  await modelButtons.nth(1).focus()
  await expect(modelButtons.nth(1)).toBeFocused()
  await page.keyboard.press('Enter')

  await page.waitForFunction(
    (previousId) =>
      document.querySelector(`[data-orbitpm-aris-canvas] [data-element-id="${previousId}"]`) ===
      null,
    firstModelOccurrenceId
  )
  await expect(modelButtons.nth(1)).toHaveAttribute('aria-current', 'true')
  await occurrences.first().waitFor({ state: 'attached' })
  const secondModelOccurrenceId = await occurrences.first().getAttribute('data-element-id')
  expect(secondModelOccurrenceId).not.toBe(firstModelOccurrenceId)

  // Space activates a button exactly like Enter does; switch again to prove
  // it, not merely assume it because Enter worked.
  const beforeThirdSwitchId = secondModelOccurrenceId
  await modelButtons.nth(0).focus()
  await page.keyboard.press(' ')

  await page.waitForFunction(
    (previousId) =>
      document.querySelector(`[data-orbitpm-aris-canvas] [data-element-id="${previousId}"]`) ===
      null,
    beforeThirdSwitchId
  )
  await expect(modelButtons.nth(0)).toHaveAttribute('aria-current', 'true')
})

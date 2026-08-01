import { expect, test, webkit, type BrowserContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { clearCanvasPoint } from './helpers/canvasOverlay'
import { disableAutoTranslate } from './helpers/prefs'

// Lane E1 — Wave 4 e2e: nested processes.
//
// A Function occurrence can be linked to a model living in a DIFFERENT
// workspace file (a cross-file process-interface assignment). This spec
// drives that whole lifecycle through the product's own DOM, on a real OPFS
// ("Browser workspace") origin: create a parent model, place a Function, link
// it to a model created inside a nested folder, and prove:
//  - the ⊞ assignment marker (`data-orbitpm-aris-assignment`) appears;
//  - the folder tree hides the linked file from its physical location and
//    shows it nested under its owner instead (`data-owned-subprocess`);
//  - double-clicking the Function shape activates the linked model's tab;
//  - renaming the linked file in the tree does not break the marker's
//    drill-down (the link resolves by Model.ID, not by file name);
//  - deleting the linked file leaves the assignment dangling, and
//    double-clicking the Function then opens a New-model dialog prefilled to
//    recreate it ("create-missing"), landing the recreated file back in the
//    owner's own folder.
//
// Harness convention copied verbatim from tests/e2e/aris-explorer-tree.spec.ts:
// the built dist/index.html served over a loopback HTTP origin (real OPFS
// refuses to operate under file://), plus the WebKit persistent-context
// accommodation OPFS needs. The rail-tools placement gesture — and the
// post-placement quick-pick + inline caption editor a fresh family-symbol
// shape always opens — is the same one tests/e2e/aris-canvas-interaction.spec.ts
// already proves against a blank EPC canvas.

test.describe.configure({ mode: 'serial' })

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')

let loopbackServer: Server
let HTTP_URL = ''

test.beforeAll(async () => {
  const html = readFileSync(DIST, 'utf8')
  expect(html.length, 'dist/index.html should be a built single file').toBeGreaterThan(500_000)
  loopbackServer = createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(html)
    })
    response.end(html)
  })
  await new Promise<void>((resolveListen, rejectListen) => {
    loopbackServer.once('error', rejectListen)
    loopbackServer.listen(0, '127.0.0.1', () => {
      loopbackServer.off('error', rejectListen)
      resolveListen()
    })
  })
  const address = loopbackServer.address() as AddressInfo
  HTTP_URL = `http://127.0.0.1:${address.port}/index.html`
})

test.afterAll(
  () =>
    new Promise<void>((resolveClose, rejectClose) => {
      loopbackServer.close((error) => (error ? rejectClose(error) : resolveClose()))
    })
)

/** Opens the built ARIS shell's landing screen over the loopback HTTP origin. */
async function gotoLanding(page: Page): Promise<void> {
  await disableAutoTranslate(page)
  await page.goto(HTTP_URL, { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'OrbitPM ARIS Studio Lite' })).toBeVisible({
    timeout: 20_000
  })
}

/**
 * Fills the imperative single-line TextInputModal used by new-folder and rename.
 * The modal has a labelled input and OK/Cancel footer buttons.
 */
async function fillPrompt(page: Page, value: string): Promise<void> {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.locator('input[type="text"]').fill(value)
  await dialog.getByRole('button', { name: /OK|Create|Rename/ }).click()
  await expect(dialog).toBeHidden()
}

/**
 * Places a Function on the active (blank) canvas via the docked tools rail, then
 * disposes of the two post-placement popovers a fresh family-symbol shape
 * always opens (`tests/e2e/aris-canvas-interaction.spec.ts` proves both): the
 * "Swap symbol" quick-pick and the inline caption editor. Returns the new
 * occurrence's `data-element-id` so callers can target the exact shape later.
 */
async function placeFunction(page: Page, caption: string): Promise<string> {
  const canvas = page.locator('[data-orbitpm-aris-canvas]')
  const tools = page.locator('[data-orbitpm-aris-rail] [data-orbitpm-aris-tools]')
  await expect(tools).toBeVisible()

  const functionEntry = tools.locator('[data-action="create.ot_func"]')
  await functionEntry.click()
  // Resolve a drop point clear of canvas overlays such as the empty-model hint
  // and minimap before completing the click-to-place gesture.
  const drop = await clearCanvasPoint(page)
  await page.mouse.click(drop.x, drop.y)

  const occurrences = canvas.locator('g.djs-element[data-element-id^="ObjOcc."]')
  await expect.poll(async () => occurrences.count(), { timeout: 20_000 }).toBe(1)
  const occurrence = occurrences.first()

  const editor = canvas.locator('.djs-direct-editing-content')
  await expect(editor).toBeVisible()
  const quickPick = canvas.getByRole('menu', { name: 'Swap symbol' })
  await expect(quickPick).toBeVisible()
  await quickPick.getByRole('menuitemradio', { name: 'System function' }).click()
  await expect(quickPick).toBeHidden()
  await expect(editor).toBeVisible()
  await editor.fill(caption)
  await editor.press('Enter')

  const id = await occurrence.getAttribute('data-element-id')
  expect(id, 'the placed Function has no data-element-id').not.toBeNull()
  return id as string
}

test('linking a Function to a workspace model nests it in the tree, survives a rename, and recreates it on delete', async ({
  browserName,
  page
}) => {
  test.setTimeout(120_000)

  // Real OPFS needs the same WebKit accommodation the pre-retarget OPFS test
  // used (see lite-mandatory-reliability.spec.ts). Playwright's WPE MiniBrowser
  // ships StorageAPI/FileSystem/FileSystemWritableStream/AccessHandle but
  // disables them by default, and a browser.newContext() page does not inherit
  // MiniBrowser's --features flags — only a persistent context launched directly
  // with them does.
  let webkitOpfsContext: BrowserContext | undefined
  let opfsPage = page

  if (browserName === 'webkit') {
    webkitOpfsContext = await webkit.launchPersistentContext('', {
      headless: true,
      locale: undefined,
      args: ['--features=StorageAPI,FileSystem,FileSystemWritableStream,AccessHandle']
    })
    opfsPage = webkitOpfsContext.pages()[0] ?? (await webkitOpfsContext.newPage())
    opfsPage.setDefaultTimeout(30_000)
    opfsPage.setDefaultNavigationTimeout(30_000)
  }

  try {
    // A generous viewport so the workspace tree, docked tools rail and canvas
    // all have room.
    await opfsPage.setViewportSize({ width: 1500, height: 950 })
    await gotoLanding(opfsPage)

    // Open a real OPFS ("Browser workspace") connection.
    await opfsPage
      .getByRole('button', { name: 'Open browser workspace' })
      .click({ timeout: 40_000 })
    const banner = opfsPage.getByRole('banner')
    await expect(banner).toContainText('Browser workspace', { timeout: 40_000 })

    const tree = opfsPage.locator('[role="tree"]')
    // Every open tab keeps its own `role="tabpanel"` mounted (state-preserving
    // across switches — src/ArisApp.tsx's `tabs.map`), so once Child's tab
    // opens there are two of everything a tab renders unconditionally (its own
    // toolbar, its own canvas). Scope those page-wide queries to whichever
    // tabpanel is not `hidden` right now.
    const activePanel = opfsPage.locator('[role="tabpanel"]:not([hidden])')

    // --- New model "Parent" from the empty-workspace card -------------------
    const emptyCard = opfsPage.getByRole('button', { name: '＋ Create your first model' })
    await expect(emptyCard).toBeVisible({ timeout: 20_000 })
    await emptyCard.click()

    const newModelDialog = opfsPage.locator('[data-orbitpm-aris-new-model]')
    await expect(newModelDialog).toBeVisible()
    await newModelDialog.locator('input[type="text"]').fill('Parent')
    await opfsPage
      .getByRole('dialog', { name: 'New ARIS model', exact: true })
      .getByRole('button', { name: 'Create model', exact: true })
      .click()
    await expect(newModelDialog).toBeHidden()
    await expect(opfsPage.locator('[data-orbitpm-aris-empty-hint]')).toBeVisible({
      timeout: 20_000
    })
    await expect(opfsPage.locator('[data-orbitpm-aris-canvas]')).toBeVisible()

    const parentRow = tree.getByRole('treeitem', { name: 'parent.aml' })
    await expect(parentRow).toBeVisible({ timeout: 20_000 })
    await expect(parentRow).toHaveAttribute('aria-current', 'page')
    await expect(parentRow).toHaveAttribute('data-tree-expandable', 'false')

    // --- Place a Function on Parent ------------------------------------------
    const functionOccId = await placeFunction(opfsPage, 'Handle request')
    const functionShape = opfsPage.locator(
      `[data-orbitpm-aris-canvas] g[data-element-id="${functionOccId}"]`
    )

    // --- New folder "subs" + New model "Child" inside ------------------------
    await opfsPage.getByRole('button', { name: 'New folder' }).click()
    await fillPrompt(opfsPage, 'subs')
    const subsFolder = tree.getByRole('treeitem', { name: 'subs' })
    await expect(subsFolder).toBeVisible({ timeout: 20_000 })

    await subsFolder.hover()
    await subsFolder.locator('button', { hasText: '＋' }).click()
    const childDialog = opfsPage.locator('[data-orbitpm-aris-new-model]')
    await expect(childDialog).toBeVisible()
    await childDialog.locator('input[type="text"]').fill('Child')
    await opfsPage
      .getByRole('dialog', { name: 'New ARIS model', exact: true })
      .getByRole('button', { name: 'Create model', exact: true })
      .click()
    await expect(childDialog).toBeHidden()
    await expect(activePanel.locator('[data-orbitpm-aris-canvas]')).toBeVisible({
      timeout: 20_000
    })

    // Creating Child opened its own tab and left it a plain (un-owned) row,
    // physically inside "subs" — the folder needs an explicit expand, exactly
    // like the equivalent nested-creation case in aris-explorer-tree.spec.ts.
    await expect(subsFolder).toHaveAttribute('data-tree-expandable', 'true', { timeout: 20_000 })
    await subsFolder.click()
    await expect(subsFolder).toHaveAttribute('aria-expanded', 'true')
    const childRow = tree.getByRole('treeitem', { name: 'child.aml' })
    await expect(childRow).toBeVisible({ timeout: 20_000 })
    await expect(childRow).toHaveAttribute('aria-current', 'page')
    await expect(childRow).not.toHaveAttribute('data-owned-subprocess')

    // --- Switch back to Parent, select the Function, and link it to Child ---
    await parentRow.click()
    await expect(functionShape).toBeVisible({ timeout: 20_000 })

    // Placement leaves the shape selected, and that selection persists across
    // the tab staying mounted-but-hidden while Child's tab was active (the
    // tabpanel is `hidden`, never unmounted). Clicking an ALREADY selected
    // element toggles it off (the same diagram-js behavior the context-pad
    // test in aris-authoring.spec.ts relies on), so only click if the Link
    // button isn't already armed — a click here should always select, never
    // accidentally deselect.
    const linkButton = activePanel.locator('[data-orbitpm-aris-link-model]')
    if (!(await linkButton.isEnabled())) {
      await functionShape.click()
    }
    await expect(linkButton).toBeEnabled({ timeout: 20_000 })
    await linkButton.click()

    const linkPicker = opfsPage.getByRole('dialog', { name: 'Link to process…' })
    await expect(linkPicker).toBeVisible()
    await linkPicker.locator('button', { hasText: 'subs/child.aml' }).click()
    await expect(linkPicker).toBeHidden()

    // --- The ⊞ assignment marker appears on the linked occurrence -----------
    const assignmentMarker = opfsPage.locator(`[data-orbitpm-aris-assignment="${functionOccId}"]`)
    await expect(assignmentMarker).toBeVisible({ timeout: 20_000 })

    // --- Tree shows Child nested under Parent (owned row) --------------------
    await expect(parentRow).toHaveAttribute('data-tree-expandable', 'true', { timeout: 20_000 })
    await expect(subsFolder).toHaveAttribute('data-tree-expandable', 'false', { timeout: 20_000 })
    await parentRow.locator('span').first().click()
    await expect(parentRow).toHaveAttribute('aria-expanded', 'true')
    await expect(childRow).toBeVisible({ timeout: 20_000 })
    await expect(childRow).toHaveAttribute('data-owned-subprocess', 'true')
    await expect(childRow).toHaveAttribute('data-rel-path', 'subs/child.aml')

    // --- Double-clicking the Function shape activates Child's tab -----------
    await functionShape.dblclick()
    await expect(opfsPage.getByRole('tab', { name: 'child.aml' })).toBeVisible({
      timeout: 20_000
    })
    await expect(childRow).toHaveAttribute('aria-current', 'page', { timeout: 20_000 })

    // --- Rename child.aml → Renamed.aml while nested under Parent ------------
    await childRow.hover()
    await childRow.locator('button', { hasText: '✎' }).click()
    await fillPrompt(opfsPage, 'Renamed')
    const renamedRow = tree.getByRole('treeitem', { name: 'Renamed.aml' })
    await expect(renamedRow).toBeVisible({ timeout: 20_000 })
    await expect(renamedRow).toHaveAttribute('data-owned-subprocess', 'true')

    // --- The marker survives the rename: dblclick still opens the model -----
    await parentRow.click()
    await expect(functionShape).toBeVisible({ timeout: 20_000 })
    await functionShape.dblclick()
    await expect(opfsPage.getByRole('tab', { name: 'Renamed.aml' })).toBeVisible({
      timeout: 20_000
    })
    await expect(renamedRow).toHaveAttribute('aria-current', 'page', { timeout: 20_000 })

    // --- Delete Renamed.aml; the assignment now dangles ----------------------
    await renamedRow.hover()
    await renamedRow.locator('button', { hasText: '🗑' }).click()
    const confirmDelete = opfsPage.getByRole('alertdialog')
    await expect(confirmDelete).toBeVisible()
    await confirmDelete.getByRole('button', { name: 'Confirm' }).click()
    await expect(confirmDelete).toBeHidden()
    await expect(renamedRow).toBeHidden({ timeout: 20_000 })
    await expect(parentRow).toHaveAttribute('data-tree-expandable', 'false', { timeout: 20_000 })

    // --- Double-clicking the dangling Function opens create-missing ---------
    await parentRow.click()
    await expect(functionShape).toBeVisible({ timeout: 20_000 })
    await functionShape.dblclick()

    const presetDialog = opfsPage.locator('[data-orbitpm-aris-new-model]')
    await expect(presetDialog).toBeVisible({ timeout: 20_000 })
    await expect(presetDialog.locator('select')).toBeDisabled()
    await expect(
      presetDialog.getByText(
        /The model will be created with id .+ so the assignment on .+ resolves immediately\./u
      )
    ).toBeVisible()

    const createMissingDialog = opfsPage.getByRole('dialog', {
      name: 'New ARIS model',
      exact: true
    })
    await createMissingDialog.getByRole('button', { name: 'Create model', exact: true }).click()
    await expect(presetDialog).toBeHidden()

    // --- The recreated file lands in Parent's own folder and re-nests -------
    await expect(parentRow).toHaveAttribute('data-tree-expandable', 'true', { timeout: 20_000 })
    if ((await parentRow.getAttribute('aria-expanded')) !== 'true') {
      await parentRow.locator('span').first().click()
    }
    const recreatedRow = tree.locator('[role="treeitem"][data-owned-subprocess="true"]')
    await expect(recreatedRow).toHaveCount(1, { timeout: 20_000 })
    await expect(recreatedRow).toHaveAttribute('data-rel-path', /^[^/]+\.aml$/u)
  } finally {
    await webkitOpfsContext?.close()
  }
})

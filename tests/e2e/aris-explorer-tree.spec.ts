import { expect, test, webkit, type BrowserContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Lane X3 — New e2e specs: explorer folder-tree CRUD + keyboard navigation.
//
// The ARIS shell replaces the old flat file list with a real folder tree in
// directory / OPFS workspaces (plan authorized change #3). This spec boots the
// built single file over a loopback HTTP origin because real OPFS refuses to
// operate under a file:// origin, then drives the tree through the product's
// own DOM exactly as a person would.

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

test('explorer folder tree: new model, folder, move, rename, delete and keyboard navigation', async ({
  browserName,
  page
}) => {
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
    await gotoLanding(opfsPage)

    // Open a real OPFS ("Browser workspace") connection.
    await opfsPage
      .getByRole('button', { name: 'Open browser workspace' })
      .click({ timeout: 40_000 })
    const banner = opfsPage.getByRole('banner')
    await expect(banner).toContainText('Browser workspace', { timeout: 40_000 })

    // Empty workspace shows the create-first card.
    const emptyCard = opfsPage.getByRole('button', { name: '＋ Create your first model' })
    await expect(emptyCard).toBeVisible({ timeout: 20_000 })
    await emptyCard.click()

    // New-model dialog.
    const newModelDialog = opfsPage.locator('[data-orbitpm-aris-new-model]')
    await expect(newModelDialog).toBeVisible()
    const nameInput = newModelDialog.locator('input[type="text"]')
    await nameInput.fill('intake')
    await opfsPage
      .getByRole('dialog', { name: 'New ARIS model', exact: true })
      .getByRole('button', { name: 'Create model', exact: true })
      .click()
    await expect(newModelDialog).toBeHidden()

    // Canvas mounts with the empty-model hint.
    await expect(opfsPage.locator('[data-orbitpm-aris-empty-hint]')).toBeVisible({
      timeout: 20_000
    })
    await expect(opfsPage.locator('[data-orbitpm-aris-canvas]')).toBeVisible()

    // The tree now shows the newly created source row.
    const tree = opfsPage.locator('[role="tree"]')
    await expect(tree).toBeVisible()
    const fileRow = tree.getByRole('treeitem', { name: /intake\.aml$/u })
    await expect(fileRow).toBeVisible({ timeout: 20_000 })
    await expect(fileRow).toHaveAttribute('aria-current', 'page')

    // Create a new folder 'Archive' via the 📁＋ toolbar button.
    await opfsPage.getByRole('button', { name: 'New folder' }).click()
    await fillPrompt(opfsPage, 'Archive')
    const folderRow = tree.getByRole('treeitem', { name: 'Archive' })
    await expect(folderRow).toBeVisible({ timeout: 20_000 })
    // Empty folders are not expandable, so FolderTreeLite omits aria-expanded.

    // Move the file into Archive using the row action.
    await fileRow.hover()
    await fileRow.locator('button', { hasText: '⤴' }).click()
    const moveDialog = opfsPage.getByRole('dialog', { name: /Move/i })
    await expect(moveDialog).toBeVisible()
    await moveDialog.locator('select').selectOption('Archive')
    await moveDialog.getByRole('button', { name: 'Move here' }).click()
    await expect(moveDialog).toBeHidden()

    // Expand Archive and verify the moved file is inside.
    await folderRow.click()
    await expect(folderRow).toHaveAttribute('aria-expanded', 'true')
    const movedFile = tree.getByRole('treeitem', { name: /intake\.aml$/u })
    await expect(movedFile).toBeVisible({ timeout: 20_000 })

    // Rename the file inside the folder.
    await movedFile.hover()
    await movedFile.locator('button', { hasText: '✎' }).click()
    await fillPrompt(opfsPage, 'archived')
    const renamedFile = tree.getByRole('treeitem', { name: /archived\.aml$/u })
    await expect(renamedFile).toBeVisible({ timeout: 20_000 })

    // Delete the file (file confirm dialog, no typed guard).
    await renamedFile.hover()
    await renamedFile.locator('button', { hasText: '🗑' }).click()
    const confirm = opfsPage.getByRole('alertdialog')
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Confirm' }).click()
    await expect(confirm).toBeHidden()

    // Empty workspace card returns.
    await expect(opfsPage.getByRole('button', { name: '＋ Create your first model' })).toBeVisible({
      timeout: 20_000
    })

    // Keyboard navigation: reuse the existing folder/file rows. The search tree
    // sorts folders before files alphabetically, so ArrowDown/ArrowRight move
    // between the Archive folder, the Banana folder, and its nested child.
    await opfsPage.getByRole('button', { name: '＋ Create your first model' }).click()
    const kbDialog = opfsPage.locator('[data-orbitpm-aris-new-model]')
    await kbDialog.locator('input[type="text"]').fill('Apple')
    await opfsPage
      .getByRole('dialog', { name: 'New ARIS model', exact: true })
      .getByRole('button', { name: 'Create model', exact: true })
      .click()
    const kbFile = opfsPage.getByRole('treeitem', { name: /apple\.aml$/iu })
    await expect(kbFile).toBeVisible({ timeout: 20_000 })

    // Create a folder and add a child model so ArrowRight has a collapsible row.
    await opfsPage.getByRole('button', { name: 'New folder' }).click()
    await fillPrompt(opfsPage, 'Banana')
    const kbFolder = opfsPage.getByRole('treeitem', { name: 'Banana' })
    await expect(kbFolder).toBeVisible({ timeout: 20_000 })
    await kbFolder.hover()
    await kbFolder.locator('button', { hasText: '＋' }).click()
    const nestedDialog = opfsPage.locator('[data-orbitpm-aris-new-model]')
    await nestedDialog.locator('input[type="text"]').fill('Cherry')
    await opfsPage
      .getByRole('dialog', { name: 'New ARIS model', exact: true })
      .getByRole('button', { name: 'Create model', exact: true })
      .click()

    // The child model lands inside the collapsed folder; expand it before
    // asserting on the nested treeitem.
    await kbFolder.click()
    await expect(kbFolder).toHaveAttribute('aria-expanded', 'true')
    const nestedFile = opfsPage.getByRole('treeitem', { name: /cherry\.aml$/iu })
    await expect(nestedFile).toBeVisible({ timeout: 20_000 })

    // The search tree sorts folders before files, so at this point the visible
    // order is: Archive, Banana (expanded), cherry.aml, apple.aml.
    const archiveRow = opfsPage.getByRole('treeitem', { name: 'Archive' })
    await expect(archiveRow).toBeVisible()
    await archiveRow.focus()
    await expect(archiveRow).toBeFocused()

    // ArrowDown moves focus to the next treeitem.
    await opfsPage.keyboard.press('ArrowDown')
    await expect
      .poll(async () =>
        opfsPage.evaluate(() => document.activeElement?.getAttribute('data-tree-key'))
      )
      .toBe('directory:Banana')

    // ArrowRight expands the folder and moves focus to its first child.
    await opfsPage.keyboard.press('ArrowRight')
    await expect(kbFolder).toHaveAttribute('aria-expanded', 'true')
    await expect(nestedFile).toBeVisible()
    await expect
      .poll(async () =>
        opfsPage.evaluate(() => document.activeElement?.getAttribute('data-tree-key'))
      )
      .toBe('file-path:"Banana/cherry.aml"')

    // Shift+F10 opens the context menu with menuitem roles.
    await opfsPage.keyboard.press('Shift+F10')
    const menu = opfsPage.getByRole('menu')
    await expect(menu).toBeVisible()
    const items = menu.getByRole('menuitem')
    await expect.poll(async () => items.count()).toBeGreaterThan(0)
    await expect(items.first()).toBeFocused()

    // Dismiss the menu with Escape and return focus to the tree.
    await opfsPage.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect
      .poll(async () =>
        opfsPage.evaluate(() => document.activeElement?.getAttribute('data-tree-key'))
      )
      .toBe('file-path:"Banana/cherry.aml"')

    // ArrowUp moves focus back to the folder; Enter toggles it closed again.
    await opfsPage.keyboard.press('ArrowUp')
    await expect
      .poll(async () =>
        opfsPage.evaluate(() => document.activeElement?.getAttribute('data-tree-key'))
      )
      .toBe('directory:Banana')
    await opfsPage.keyboard.press('Enter')
    await expect(kbFolder).toHaveAttribute('aria-expanded', 'false')
  } finally {
    await webkitOpfsContext?.close()
  }
})

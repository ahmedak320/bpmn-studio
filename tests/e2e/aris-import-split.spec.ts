import {
  expect,
  test,
  webkit,
  type BrowserContext,
  type Locator,
  type Page
} from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { disableAutoTranslate } from './helpers/prefs'

// Lane E2 — e2e: import split.
//
// Verifies the multi-file workspace split-import flow end-to-end against the
// built single file served over a loopback HTTP origin (real OPFS refuses a
// file:// origin). The harness mirrors aris-explorer-tree.spec.ts and the
// setInputFiles pattern mirrors aris-authoring.spec.ts.

test.describe.configure({ mode: 'serial' })

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const REFERENCE_AML = resolve(HERE, '../../../reference/AnimalWF/ARISAMLExport.xml')

let loopbackServer: Server
let HTTP_URL = ''

/**
 * Synthetic 2-group/3-model AML: bilingual + AR-only group names, a VACD with
 * two assignments to two EPCs. Adapted from src/aris/source/amlSplit.test.ts.
 */
const SYNTHETIC_AML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE AML SYSTEM "ARIS-Export.dtd" [
	<!ENTITY LocaleId.USen "1033">
	<!ENTITY LocaleId.AEar "1025">
]>
<AML>
	<Header-Info DatabaseName="Synthetic" UserName="test" ArisExeVersion="100"/>
	<Language LocaleId="&LocaleId.USen;"><LanguageName LocaleId="&LocaleId.USen;">English</LanguageName></Language>
	<Language LocaleId="&LocaleId.AEar;"><LanguageName LocaleId="&LocaleId.AEar;">Arabic</LanguageName></Language>
	<FontStyleSheet FontSS.ID="FontSS.1"><GUID>guid-fss-1</GUID></FontStyleSheet>
	<FFTextDef FFTextDef.ID="FFTextDef.1">
		<GUID>guid-fft-1</GUID>
		<AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.USen;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="Note one"/></StyledElement></StyledElement></AttrValue></AttrDef>
	</FFTextDef>
	<Group Group.ID="Group.Root">
		<ObjDef ObjDef.ID="ObjDef.Root1" TypeNum="OT_FUNC">
			<GUID>guid-root1</GUID>
			<AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.USen;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="Root Shared Def"/></StyledElement></StyledElement></AttrValue></AttrDef>
		</ObjDef>
		<Group Group.ID="Group.A" TypeNum="GT_MODEL" Creator="test">
			<GUID>guid-groupA</GUID>
			<AttrDef AttrDef.Type="AT_NAME">
				<AttrValue LocaleId="&LocaleId.USen;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="Process Folder"/></StyledElement></StyledElement></AttrValue>
				<AttrValue LocaleId="&LocaleId.AEar;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="مجلد العمليات"/></StyledElement></StyledElement></AttrValue>
			</AttrDef>
			<ObjDef ObjDef.ID="ObjDef.Shared" TypeNum="OT_FUNC" ToCxnDefs.IdRefs="CxnDef.1 CxnDef.2">
				<GUID>guid-shared</GUID>
				<AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.USen;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="Shared Function"/></StyledElement></StyledElement></AttrValue></AttrDef>
				<CxnDef CxnDef.ID="CxnDef.1" CxnDef.Type="CT_IS_PREDEC_OF_1" ToObjDef.IdRef="ObjDef.Target1"><GUID>guid-c1</GUID></CxnDef>
				<CxnDef CxnDef.ID="CxnDef.2" CxnDef.Type="CT_IS_PREDEC_OF_1" ToObjDef.IdRef="ObjDef.Target2"><GUID>guid-c2</GUID></CxnDef>
			</ObjDef>
			<ObjDef ObjDef.ID="ObjDef.Target1" TypeNum="OT_EVT"><GUID>guid-t1</GUID><AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.USen;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="Target One"/></StyledElement></StyledElement></AttrValue></AttrDef></ObjDef>
			<ObjDef ObjDef.ID="ObjDef.Target2" TypeNum="OT_EVT"><GUID>guid-t2</GUID><AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.USen;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="Target Two"/></StyledElement></StyledElement></AttrValue></AttrDef></ObjDef>
			<Model Model.ID="Model.1" Model.Type="MT_EEPC">
				<AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.USen;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="Duplicate Name"/></StyledElement></StyledElement></AttrValue></AttrDef>
				<ObjOcc ObjOcc.ID="ObjOcc.1" ObjDef.IdRef="ObjDef.Shared" ToCxnOccs.IdRefs="CxnOcc.1"><Position Pos.X="10" Pos.Y="10"/><Size Size.dX="100" Size.dY="50"/>
					<CxnOcc CxnOcc.ID="CxnOcc.1" CxnDef.IdRef="CxnDef.1" ToObjOcc.IdRef="ObjOcc.2"><Position Pos.X="10" Pos.Y="60"/></CxnOcc>
				</ObjOcc>
				<ObjOcc ObjOcc.ID="ObjOcc.2" ObjDef.IdRef="ObjDef.Target1"><Position Pos.X="10" Pos.Y="120"/><Size Size.dX="100" Size.dY="50"/></ObjOcc>
				<ObjOcc ObjOcc.ID="ObjOcc.RootRef" ObjDef.IdRef="ObjDef.Root1"><Position Pos.X="200" Pos.Y="10"/><Size Size.dX="100" Size.dY="50"/></ObjOcc>
				<FFTextOcc FFTextDef.IdRef="FFTextDef.1"><Position Pos.X="300" Pos.Y="10"/><Size Size.dX="80" Size.dY="20"/></FFTextOcc>
			</Model>
		</Group>
		<Group Group.ID="Group.B">
			<AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.AEar;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="قسم التسجيل"/></StyledElement></StyledElement></AttrValue></AttrDef>
			<Model Model.ID="Model.2" Model.Type="MT_EEPC">
				<AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.USen;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="Duplicate Name"/></StyledElement></StyledElement></AttrValue></AttrDef>
				<ObjOcc ObjOcc.ID="ObjOcc.3" ObjDef.IdRef="ObjDef.Shared" ToCxnOccs.IdRefs="CxnOcc.2"><Position Pos.X="10" Pos.Y="10"/><Size Size.dX="100" Size.dY="50"/>
					<CxnOcc CxnOcc.ID="CxnOcc.2" CxnDef.IdRef="CxnDef.2" ToObjOcc.IdRef="ObjOcc.4"><Position Pos.X="10" Pos.Y="60"/></CxnOcc>
				</ObjOcc>
				<ObjOcc ObjOcc.ID="ObjOcc.4" ObjDef.IdRef="ObjDef.Target2"><Position Pos.X="10" Pos.Y="120"/><Size Size.dX="100" Size.dY="50"/></ObjOcc>
			</Model>
		</Group>
		<Group Group.ID="Group.C">
			<AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.USen;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="Value Chain Folder"/></StyledElement></StyledElement></AttrValue></AttrDef>
			<ObjDef ObjDef.ID="ObjDef.Vfunc" TypeNum="OT_FUNC" LinkedModels.IdRefs="Model.1 Model.2"><GUID>guid-vfunc</GUID><AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.USen;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="Assign"/></StyledElement></StyledElement></AttrValue></AttrDef></ObjDef>
			<Model Model.ID="Model.3" Model.Type="MT_VAL_ADD_CHN_DGM">
				<AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.USen;"><StyledElement><Paragraph Alignment="UNDEFINED" Indent="0"/><StyledElement><PlainText TextValue="Value Chain"/></StyledElement></StyledElement></AttrValue></AttrDef>
				<ObjOcc ObjOcc.ID="ObjOcc.5" ObjDef.IdRef="ObjDef.Vfunc"><Position Pos.X="10" Pos.Y="10"/><Size Size.dX="100" Size.dY="50"/></ObjOcc>
			</Model>
		</Group>
	</Group>
</AML>
`

test.beforeAll(async () => {
  const html = readFileSync(DIST, 'utf8')
  expect(html.length, 'dist/index.html should be a built single file').toBeGreaterThan(500_000)
  expect(readFileSync(REFERENCE_AML).length, 'reference fixture missing').toBeGreaterThan(0)

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

async function gotoLanding(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await disableAutoTranslate(page)
  await page.goto(HTTP_URL, { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'OrbitPM ARIS Studio Lite' })).toBeVisible({
    timeout: 20_000
  })
}

async function openBrowserWorkspace(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open browser workspace' }).click({ timeout: 40_000 })
  await expect(page.getByRole('banner')).toContainText('Browser workspace', { timeout: 40_000 })
}

async function pickImportFile(
  page: Page,
  payload: string | { name: string; mimeType: string; buffer: Buffer }
): Promise<void> {
  // The import input is the hidden file input that accepts multiple files.
  await page.locator('input[type="file"][multiple]').setInputFiles(payload)
}

/**
 * Expand a tree row robustly on all three engines.
 *
 * The chevron span carries `aria-hidden="true"` and only fires `onToggle` from
 * a genuine click; that click does NOT toggle expansion on firefox/webkit
 * (the received `aria-expanded` stays "false"), so it is test fragility, not a
 * product bug. FolderTreeLite exposes a keyboard path instead: a focused row
 * with `data-tree-expandable="true"` expands on ArrowRight
 * (src/workspace/FolderTreeLite.tsx handleTreeKeyDown), and every row keeps a
 * roving `tabIndex` (0/-1) so `.focus()` always lands. ArrowRight only ever
 * expands (never collapses), and this is the cross-engine-proven mechanism —
 * see aris-explorer-tree.spec.ts:227-262, green on all three engines.
 */
async function expandRow(page: Page, row: Locator): Promise<void> {
  await expect(row).toBeVisible({ timeout: 20_000 })
  if ((await row.getAttribute('aria-expanded')) === 'true') return
  await row.focus()
  await page.keyboard.press('ArrowRight')
  await expect(row).toHaveAttribute('aria-expanded', 'true', { timeout: 20_000 })
}

async function expandTreeRow(page: Page, name: string | RegExp): Promise<void> {
  await expandRow(page, page.getByRole('treeitem', { name }))
}

async function confirmSplitImport(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Import into the workspace' })
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await dialog.getByRole('button', { name: /Import \d+ file\(s\)/ }).click()
  await expect(dialog).toBeHidden({ timeout: 60_000 })
}

test('synthetic AML splits into group folders, nests VACD-owned EPCs and opens one', async ({
  browserName,
  page
}) => {
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
    await openBrowserWorkspace(opfsPage)

    await opfsPage.getByRole('button', { name: 'Import' }).click()
    await pickImportFile(opfsPage, {
      name: 'synthetic-split.aml',
      mimeType: 'application/xml',
      buffer: Buffer.from(SYNTHETIC_AML)
    })

    const dialog = opfsPage.getByRole('dialog', { name: 'Import into the workspace' })
    await expect(dialog).toBeVisible({ timeout: 20_000 })
    const rows = dialog.locator('table tbody tr')
    await expect(rows).toHaveCount(3, { timeout: 20_000 })

    const rowTexts = await rows.allInnerTexts()
    const paths = rowTexts.map((text) => text.replace(/\s+/gu, ' '))
    expect(paths).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Process Folder/duplicate-name.aml'),
        expect.stringContaining('Value Chain Folder/value-chain.aml'),
        expect.stringContaining('قسم التسجيل/duplicate-name.aml')
      ])
    )

    await confirmSplitImport(opfsPage)

    // The tree now contains the three group folders.
    await expect(opfsPage.getByRole('treeitem', { name: 'Value Chain Folder' })).toBeVisible({
      timeout: 20_000
    })

    // Expand the folder so the VACD file row is rendered.
    await expandTreeRow(opfsPage, 'Value Chain Folder')

    // Expand the VACD row and assert it owns both EPCs.
    const vacdRow = opfsPage.locator('[data-process-ids="Model.3"]')
    await expandRow(opfsPage, vacdRow)
    await expect(opfsPage.locator('[data-owner-process-id="Model.3"]')).toHaveCount(2, {
      timeout: 20_000
    })

    // Open one of the owned EPC rows and assert the canvas draws it.
    const epcRow = opfsPage.locator('[data-owner-process-id="Model.3"]').first()
    await epcRow.click()
    await expect(opfsPage.getByRole('tab', { name: /duplicate-name\.aml$/u })).toBeVisible({
      timeout: 20_000
    })
    await expect(opfsPage.locator('[data-orbitpm-aris-canvas]')).toBeVisible({ timeout: 20_000 })
    await expect(
      opfsPage.locator('[data-orbitpm-aris-canvas] g.djs-element[data-element-id^="ObjOcc."]')
    ).toHaveCount(3, { timeout: 60_000 })
  } finally {
    await webkitOpfsContext?.close()
  }
})

test('reference AnimalWF import splits 8 files under Animal Welfare, VACD owns 7, re-import skips all', async ({
  browserName,
  page
}) => {
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
    await openBrowserWorkspace(opfsPage)

    await opfsPage.getByRole('button', { name: 'Import' }).click()
    await pickImportFile(opfsPage, REFERENCE_AML)

    const dialog = opfsPage.getByRole('dialog', { name: 'Import into the workspace' })
    await expect(dialog).toBeVisible({ timeout: 20_000 })
    const rows = dialog.locator('table tbody tr')
    await expect(rows).toHaveCount(8, { timeout: 20_000 })

    const rowTexts = await rows.allInnerTexts()
    const paths = rowTexts.map((text) => text.replace(/\s+/gu, ' '))
    expect(paths).toEqual(expect.arrayContaining([expect.stringContaining('Animal Welfare/')]))

    await confirmSplitImport(opfsPage)

    await expect(opfsPage.getByRole('treeitem', { name: 'Animal Welfare' })).toBeVisible({
      timeout: 20_000
    })

    // Expand the folder so the VACD file row is rendered.
    await expandTreeRow(opfsPage, 'Animal Welfare')

    const vacdModelId = 'Model.-64xG-AFMIgg-u-L'
    const vacdRow = opfsPage.locator(`[data-process-ids*="${vacdModelId}"]`)
    await expandRow(opfsPage, vacdRow)
    await expect(opfsPage.locator(`[data-owner-process-id="${vacdModelId}"]`)).toHaveCount(7, {
      timeout: 20_000
    })

    // Re-import the same file; every model is already present.
    await opfsPage.getByRole('button', { name: 'Import' }).click()
    await pickImportFile(opfsPage, REFERENCE_AML)

    const reimportDialog = opfsPage.getByRole('dialog', { name: 'Import into the workspace' })
    await expect(reimportDialog).toBeVisible({ timeout: 20_000 })
    const reimportRows = reimportDialog.locator('table tbody tr')
    await expect(reimportRows).toHaveCount(8, { timeout: 20_000 })

    const reimportTexts = await reimportRows.allInnerTexts()
    for (const text of reimportTexts) {
      expect(text).toMatch(/Skipped|already exists/u)
    }
  } finally {
    await webkitOpfsContext?.close()
  }
})

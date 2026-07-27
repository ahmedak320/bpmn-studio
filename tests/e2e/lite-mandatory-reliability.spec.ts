import { expect, test, type Locator, type Page, type Route } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  installReliabilityWorkspace,
  reliabilityPaths,
  reliabilityRead,
  reliabilitySnapshot
} from './fixtures/reliability-fsa'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()
let loopbackServer: Server
let HTTP_URL = ''

test.describe.configure({ mode: 'serial' })

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

function bpmn(processId: string, processName: string, taskName = 'Original task'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:orbitpm="http://orbitpm.ae/schema/bpmn/1.0"
  id="Definitions_${processId}" targetNamespace="https://orbitpm.ae/e2e/reliability">
  <bpmn:process id="${processId}" name="${processName}" isExecutable="false"
    orbitpm:nameEn="${processName}" orbitpm:nameAr="عملية اختبار" orbitpm:activeLang="en">
    <bpmn:startEvent id="Start_1" name="Start" orbitpm:nameEn="Start" orbitpm:nameAr="البداية">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_1" name="${taskName}" orbitpm:nameEn="${taskName}" orbitpm:nameAr="مهمة اختبار">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="End_1" name="End" orbitpm:nameEn="End" orbitpm:nameAr="النهاية">
      <bpmn:incoming>Flow_2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_${processId}">
    <bpmndi:BPMNPlane id="Plane_${processId}" bpmnElement="${processId}">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="150" y="122" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="240" y="100" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="395" y="122" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="186" y="140" /><di:waypoint x="240" y="140" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="340" y="140" /><di:waypoint x="395" y="140" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`
}

function callerBpmn(processId: string, processName: string, calledElement: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:orbitpm="http://orbitpm.ae/schema/bpmn/1.0"
  id="Definitions_${processId}" targetNamespace="https://orbitpm.ae/e2e/reliability">
  <bpmn:process id="${processId}" name="${processName}" isExecutable="false"
    orbitpm:nameEn="${processName}" orbitpm:nameAr="عملية رئيسية" orbitpm:activeLang="en">
    <bpmn:startEvent id="Start_1" name="Start" orbitpm:nameEn="Start" orbitpm:nameAr="البداية">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:callActivity id="Call_1" name="Call target" calledElement="${calledElement}"
      orbitpm:nameEn="Call target" orbitpm:nameAr="استدعاء العملية">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:callActivity>
    <bpmn:endEvent id="End_1" name="End" orbitpm:nameEn="End" orbitpm:nameAr="النهاية">
      <bpmn:incoming>Flow_2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Call_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Call_1" targetRef="End_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_${processId}">
    <bpmndi:BPMNPlane id="Plane_${processId}" bpmnElement="${processId}">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="150" y="122" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Call_1_di" bpmnElement="Call_1">
        <dc:Bounds x="240" y="100" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="395" y="122" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="186" y="140" /><di:waypoint x="240" y="140" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="340" y="140" /><di:waypoint x="395" y="140" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`
}

async function gotoBuiltApp(page: Page, url = FILE_URL): Promise<void> {
  await page.goto(url, { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'OrbitPM Process Studio Lite' })).toBeVisible({
    timeout: 20_000
  })
}

async function openDirectoryWorkspace(page: Page): Promise<void> {
  await gotoBuiltApp(page)
  await page.getByRole('button', { name: 'Choose folder workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Process catalog' })).toBeVisible({
    timeout: 25_000
  })
  await expect(page.getByText('Storage: Folder workspace')).toBeVisible()
}

async function waitForModeler(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Boolean(
            (
              window as unknown as {
                __ORBITPM_LITE__?: { modeler?: unknown }
              }
            ).__ORBITPM_LITE__?.modeler
          )
        ),
      { timeout: 25_000 }
    )
    .toBe(true)
  await expect(page.locator('.djs-container svg:visible').first()).toBeVisible({
    timeout: 25_000
  })
}

function physicalRow(page: Page, relPath: string): Locator {
  return page.locator(
    `.orbitpm-tree-row[data-rel-path="${relPath.replace(/"/gu, '\\"')}"][data-canonical="true"]`
  )
}

async function openDirectoryFile(page: Page, relPath: string): Promise<void> {
  const row = physicalRow(page, relPath)
  await expect(row).toBeVisible({ timeout: 20_000 })
  await row.click()
  await waitForModeler(page)
  await expect(
    page.getByRole('tab', { name: new RegExp(`${relPath.split('/').at(-1)}(?: —|$)`) })
  ).toBeVisible()
}

async function activeTaskName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const modeler = (
      window as unknown as {
        __ORBITPM_LITE__?: {
          modeler?: { get(name: string): unknown }
        }
      }
    ).__ORBITPM_LITE__?.modeler
    if (!modeler) throw new Error('No active OrbitPM modeler')
    const registry = modeler.get('elementRegistry') as {
      get(id: string): { businessObject?: { name?: string } } | undefined
    }
    return registry.get('Task_1')?.businessObject?.name ?? ''
  })
}

async function dirtyActiveTask(page: Page, label: string): Promise<void> {
  await waitForModeler(page)
  await page.evaluate((nextLabel) => {
    const modeler = (
      window as unknown as {
        __ORBITPM_LITE__?: {
          modeler?: { get(name: string): unknown }
        }
      }
    ).__ORBITPM_LITE__?.modeler
    if (!modeler) throw new Error('No active OrbitPM modeler')
    const registry = modeler.get('elementRegistry') as {
      get(id: string): unknown
    }
    const modeling = modeler.get('modeling') as {
      updateProperties(element: unknown, properties: Record<string, unknown>): void
    }
    const task = registry.get('Task_1')
    if (!task) throw new Error('Task_1 was not imported')
    modeling.updateProperties(task, {
      name: nextLabel,
      'orbitpm:nameEn': nextLabel,
      'orbitpm:nameAr': 'مهمة موثوقة'
    })
  }, label)
  await expect(page.locator('.orbitpm-editor__dirty-flag--dirty:visible')).toBeVisible({
    timeout: 10_000
  })
  await expect(
    page
      .getByRole('tablist', { name: 'Open process diagrams' })
      .locator('[role="tab"][aria-selected="true"]')
  ).toHaveAttribute('aria-label', /Unsaved changes/u, { timeout: 10_000 })
  // App serializes command-stack changes into the authoritative document
  // session/live index on a 120 ms debounce.
  await page.waitForTimeout(250)
}

async function dirtyActiveCaller(
  page: Page,
  processName: string,
  calledElement: string
): Promise<void> {
  await waitForModeler(page)
  await page.evaluate(
    ({ nextCalledElement, nextProcessName }) => {
      const modeler = (
        window as unknown as {
          __ORBITPM_LITE__?: {
            modeler?: { get(name: string): unknown }
          }
        }
      ).__ORBITPM_LITE__?.modeler
      if (!modeler) throw new Error('No active OrbitPM modeler')
      const canvas = modeler.get('canvas') as {
        getRootElement(): unknown
      }
      const registry = modeler.get('elementRegistry') as {
        get(id: string): unknown
      }
      const modeling = modeler.get('modeling') as {
        updateProperties(element: unknown, properties: Record<string, unknown>): void
      }
      const callActivity = registry.get('Call_1')
      if (!callActivity) throw new Error('Call_1 was not imported')
      modeling.updateProperties(canvas.getRootElement(), {
        name: nextProcessName,
        'orbitpm:nameEn': nextProcessName,
        'orbitpm:nameAr': 'عملية رئيسية محدثة'
      })
      modeling.updateProperties(callActivity, {
        calledElement: nextCalledElement
      })
    },
    { nextCalledElement: calledElement, nextProcessName: processName }
  )
  await expect(page.locator('.orbitpm-editor__dirty-flag--dirty:visible')).toBeVisible({
    timeout: 10_000
  })
  await page.waitForTimeout(250)
}

async function saveActive(page: Page): Promise<void> {
  await page.locator('button[title="Save (Ctrl+S)"]:visible').click()
  await expect(page.locator('.orbitpm-editor__dirty-flag--dirty:visible')).toHaveCount(0, {
    timeout: 25_000
  })
}

async function waitForDraftFlush(page: Page): Promise<void> {
  // Production draft persistence is deliberately debounced by 2 seconds.
  await page.waitForTimeout(2_300)
}

async function reloadToLanding(page: Page): Promise<void> {
  await page.reload({ waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'OrbitPM Process Studio Lite' })).toBeVisible({
    timeout: 20_000
  })
}

async function restoreDraft(page: Page, expectedLabel: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Review recovery draft' })
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await expect(dialog).toContainText(expectedLabel)
  await dialog.getByRole('button', { name: 'Restore draft' }).click()
  await waitForModeler(page)
  await expect.poll(() => activeTaskName(page), { timeout: 20_000 }).toBe(expectedLabel)
  await expect(page.locator('.orbitpm-editor__dirty-flag--dirty:visible')).toBeVisible()
}

async function configureOpenRouter(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: /Settings/i })
    .first()
    .click()
  const dialog = page.getByRole('dialog', { name: /Settings/i })
  await expect(dialog).toBeVisible()
  const selection = dialog.getByRole('region', { name: 'AI provider and model' })
  await selection.getByLabel('Provider').selectOption('openrouter')
  await selection.getByLabel('Model').fill('openai/gpt-4.1-mini')
  await dialog.getByLabel('OpenRouter API key').fill('sk-e2e-switch-cancellation')
  await dialog.getByRole('button', { name: 'Save keys' }).click()
  await expect(dialog).toContainText('Saved.')
  await dialog.getByText('Close', { exact: true }).click()
}

async function expandAiPanel(page: Page): Promise<Locator> {
  const aside = page.locator('aside').first()
  if (!(await aside.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Toggle side panel' }).click()
  }
  await expect(aside).toBeVisible()
  const header = aside.getByRole('button', { name: /Generate with AI/i })
  if ((await header.getAttribute('aria-expanded')) === 'false') await header.click()
  return aside
}

test('mandatory recovery: real OPFS restores a dirty draft after reload', async ({ page }) => {
  await page.addInitScript(() => {
    delete window.showDirectoryPicker
    delete window.showOpenFilePicker
  })
  await gotoBuiltApp(page, HTTP_URL)
  const xml = bpmn('Process_opfs_recovery', 'OPFS recovery')
  await page.evaluate(
    async ({ contents }) => {
      const originRoot = await navigator.storage.getDirectory()
      const workspace = await originRoot.getDirectoryHandle('orbitpm', { create: true })
      const file = await workspace.getFileHandle('opfs-recovery.bpmn', { create: true })
      const writable = await file.createWritable()
      await writable.write(contents)
      await writable.close()
    },
    { contents: xml }
  )
  await page.getByRole('button', { name: 'Open browser workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Process catalog' })).toBeVisible({
    timeout: 25_000
  })
  await openDirectoryFile(page, 'opfs-recovery.bpmn')
  await dirtyActiveTask(page, 'Recovered from real OPFS')
  await waitForDraftFlush(page)

  await reloadToLanding(page)
  await page.getByRole('button', { name: 'Open browser workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Process catalog' })).toBeVisible({
    timeout: 25_000
  })
  await physicalRow(page, 'opfs-recovery.bpmn').click()
  await restoreDraft(page, 'Recovered from real OPFS')
})

test('mandatory recovery: single-file upload restores a dirty draft after reload', async ({
  page
}) => {
  await page.addInitScript(() => {
    delete window.showDirectoryPicker
    delete window.showOpenFilePicker
  })
  const upload = {
    name: 'single-recovery.bpmn',
    mimeType: 'application/xml',
    buffer: Buffer.from(bpmn('Process_single_recovery', 'Single recovery'), 'utf8')
  }
  await gotoBuiltApp(page)
  await page.locator('input[type="file"][accept^=".bpmn"]').setInputFiles(upload)
  await waitForModeler(page)
  await dirtyActiveTask(page, 'Recovered from single file')
  await waitForDraftFlush(page)

  await reloadToLanding(page)
  await page.locator('input[type="file"][accept^=".bpmn"]').setInputFiles(upload)
  await restoreDraft(page, 'Recovered from single file')
})

test('mandatory recovery: directory/FSA workspace restores a dirty draft after reload', async ({
  page
}) => {
  await installReliabilityWorkspace(page, {
    name: 'DirectoryRecovery',
    seed: {
      'directory-recovery.bpmn': bpmn('Process_directory_recovery', 'Directory recovery')
    }
  })
  await openDirectoryWorkspace(page)
  await openDirectoryFile(page, 'directory-recovery.bpmn')
  await dirtyActiveTask(page, 'Recovered from directory FSA')
  await waitForDraftFlush(page)

  await reloadToLanding(page)
  await page.getByRole('button', { name: 'Choose folder workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Process catalog' })).toBeVisible({
    timeout: 25_000
  })
  await physicalRow(page, 'directory-recovery.bpmn').click()
  await restoreDraft(page, 'Recovered from directory FSA')
})

test('mandatory save: Ctrl+S saves only the active dirty tab', async ({ page }) => {
  await installReliabilityWorkspace(page, {
    name: 'ActiveOnly',
    seed: {
      'one.bpmn': bpmn('Process_active_one', 'Active one'),
      'two.bpmn': bpmn('Process_active_two', 'Active two')
    }
  })
  await openDirectoryWorkspace(page)
  await openDirectoryFile(page, 'one.bpmn')
  await dirtyActiveTask(page, 'Unsaved inactive edit')
  await openDirectoryFile(page, 'two.bpmn')
  await dirtyActiveTask(page, 'Saved active edit')
  await page.evaluate(() => window.__ORBITPM_RELIABILITY_FS__.clearWrites())

  await saveActive(page)

  const snapshot = await reliabilitySnapshot(page)
  expect(snapshot.writes.some(({ path }) => path === 'two.bpmn')).toBe(true)
  expect(snapshot.writes.some(({ path }) => path === 'one.bpmn')).toBe(false)
  expect(await reliabilityRead(page, 'two.bpmn')).toContain('Saved active edit')
  expect(await reliabilityRead(page, 'one.bpmn')).not.toContain('Unsaved inactive edit')
  await expect(page.getByRole('tab', { name: /one\.bpmn — .*Unsaved changes/ })).toBeVisible()
})

test('mandatory conflicts: compare, keep, reload, overwrite, and save-as preserve intent', async ({
  page
}) => {
  const original = bpmn('Process_conflict', 'Conflict process')
  await installReliabilityWorkspace(page, {
    name: 'ConflictChoices',
    seed: { 'conflict.bpmn': original }
  })
  await openDirectoryWorkspace(page)
  await openDirectoryFile(page, 'conflict.bpmn')

  await dirtyActiveTask(page, 'Local compare draft')
  const externalCompare = bpmn('Process_conflict', 'Conflict process', 'External compare')
  await page.evaluate(
    ({ xml }) => window.__ORBITPM_RELIABILITY_FS__.writeExternal('conflict.bpmn', xml),
    { xml: externalCompare }
  )
  await page.locator('button[title="Save (Ctrl+S)"]:visible').click()
  let dialog = page.getByRole('dialog', { name: '“conflict.bpmn” changed on disk' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Compare versions' }).click()
  await expect(dialog).toContainText('Local compare draft')
  await expect(dialog).toContainText('External compare')
  await dialog.getByRole('button', { name: 'Keep editing' }).click()
  await expect(page.locator('.orbitpm-editor__dirty-flag--dirty:visible')).toBeVisible()

  await page.locator('button[title="Save (Ctrl+S)"]:visible').click()
  dialog = page.getByRole('dialog', { name: '“conflict.bpmn” changed on disk' })
  await dialog.getByRole('button', { name: 'Reload disk version' }).click()
  await expect.poll(() => activeTaskName(page), { timeout: 25_000 }).toBe('External compare')
  await expect(page.locator('.orbitpm-editor__dirty-flag--dirty:visible')).toHaveCount(0)

  await dirtyActiveTask(page, 'Local overwrite winner')
  const externalOverwrite = bpmn('Process_conflict', 'Conflict process', 'External overwrite')
  await page.evaluate(
    ({ xml }) => window.__ORBITPM_RELIABILITY_FS__.writeExternal('conflict.bpmn', xml),
    { xml: externalOverwrite }
  )
  await page.locator('button[title="Save (Ctrl+S)"]:visible').click()
  dialog = page.getByRole('dialog', { name: '“conflict.bpmn” changed on disk' })
  await dialog.getByRole('button', { name: 'Overwrite disk version' }).click()
  await expect
    .poll(() => reliabilityRead(page, 'conflict.bpmn'), { timeout: 25_000 })
    .toContain('Local overwrite winner')
  await expect(page.locator('.orbitpm-editor__dirty-flag--dirty:visible')).toHaveCount(0)

  await dirtyActiveTask(page, 'Local save-as winner')
  const externalSaveAs = bpmn('Process_conflict', 'Conflict process', 'External save-as')
  await page.evaluate(
    ({ xml }) => window.__ORBITPM_RELIABILITY_FS__.writeExternal('conflict.bpmn', xml),
    { xml: externalSaveAs }
  )
  await page.locator('button[title="Save (Ctrl+S)"]:visible').click()
  dialog = page.getByRole('dialog', { name: '“conflict.bpmn” changed on disk' })
  await dialog.getByLabel('New relative .bpmn path').fill('conflict-copy.bpmn')
  await dialog.getByRole('button', { name: 'Save as a new file' }).click()
  await expect
    .poll(() => reliabilityPaths(page), { timeout: 25_000 })
    .toContain('conflict-copy.bpmn')
  expect(await reliabilityRead(page, 'conflict.bpmn')).toContain('External save-as')
  expect(await reliabilityRead(page, 'conflict-copy.bpmn')).toContain('Local save-as winner')
  await expect(page.getByRole('tab', { name: 'conflict-copy.bpmn' })).toBeVisible()
})

test('mandatory path transactions: dirty rename, move, and delete honor every gate', async ({
  page
}) => {
  await installReliabilityWorkspace(page, {
    name: 'DirtyPaths',
    seed: {
      'rename.bpmn': bpmn('Process_dirty_rename', 'Dirty rename'),
      'rename-discard.bpmn': bpmn('Process_dirty_rename_discard', 'Dirty rename discard'),
      'move.bpmn': bpmn('Process_dirty_move', 'Dirty move'),
      'delete.bpmn': bpmn('Process_dirty_delete', 'Dirty delete'),
      'Destination/.keep': ''
    }
  })
  await openDirectoryWorkspace(page)

  await openDirectoryFile(page, 'rename.bpmn')
  await dirtyActiveTask(page, 'Rename draft retained')
  await physicalRow(page, 'rename.bpmn').getByRole('button', { name: 'Rename rename.bpmn' }).click()
  let renameDialog = page.getByRole('dialog', { name: 'Rename' })
  await renameDialog.getByLabel('New name').fill('renamed.bpmn')
  await renameDialog.getByRole('button', { name: 'Rename' }).click()
  let dirtyDialog = page.getByRole('dialog', {
    name: 'Unsaved changes in affected documents'
  })
  await dirtyDialog.getByRole('button', { name: 'Cancel' }).click()
  expect(await reliabilityPaths(page)).toContain('rename.bpmn')

  await openDirectoryFile(page, 'rename-discard.bpmn')
  await dirtyActiveTask(page, 'Rename draft retained after relocation')
  await physicalRow(page, 'rename-discard.bpmn')
    .getByRole('button', { name: 'Rename rename-discard.bpmn' })
    .click()
  renameDialog = page.getByRole('dialog', { name: 'Rename' })
  await renameDialog.getByLabel('New name').fill('renamed-discard.bpmn')
  await renameDialog.getByRole('button', { name: 'Rename' }).click()
  dirtyDialog = page.getByRole('dialog', { name: 'Unsaved changes in affected documents' })
  await dirtyDialog.getByRole('button', { name: 'Continue without saving' }).click()
  await expect
    .poll(() => reliabilityPaths(page), { timeout: 25_000 })
    .toContain('renamed-discard.bpmn')
  expect(await reliabilityPaths(page)).not.toContain('rename-discard.bpmn')
  await expect(
    page.getByRole('tab', { name: /renamed-discard\.bpmn — .*Unsaved changes/ })
  ).toBeVisible()

  await openDirectoryFile(page, 'move.bpmn')
  await dirtyActiveTask(page, 'Move draft saved first')
  await physicalRow(page, 'move.bpmn').getByRole('button', { name: 'Move move.bpmn' }).click()
  const moveDialog = page.getByRole('dialog', { name: 'Move \"move.bpmn\"' })
  await moveDialog.getByLabel('Destination folder').selectOption('Destination')
  await moveDialog.getByRole('button', { name: 'Move here' }).click()
  dirtyDialog = page.getByRole('dialog', { name: 'Unsaved changes in affected documents' })
  await dirtyDialog.getByRole('button', { name: 'Save and continue' }).click()
  await expect
    .poll(() => reliabilityPaths(page), { timeout: 25_000 })
    .toContain('Destination/move.bpmn')
  expect(await reliabilityRead(page, 'Destination/move.bpmn')).toContain('Move draft saved first')
  expect(await reliabilityPaths(page)).not.toContain('move.bpmn')

  await openDirectoryFile(page, 'delete.bpmn')
  await dirtyActiveTask(page, 'Delete draft explicitly discarded')
  await physicalRow(page, 'delete.bpmn').getByRole('button', { name: 'Delete delete.bpmn' }).click()
  const deleteDialog = page.getByRole('dialog', { name: 'Delete process' })
  await deleteDialog.getByRole('button', { name: 'Delete' }).click()
  dirtyDialog = page.getByRole('dialog', { name: 'Unsaved changes in affected documents' })
  await dirtyDialog.getByRole('button', { name: 'Continue without saving' }).click()
  await expect.poll(() => reliabilityPaths(page), { timeout: 25_000 }).not.toContain('delete.bpmn')
  await expect(page.getByRole('tab', { name: /delete\.bpmn/ })).toHaveCount(0)
})

test('mandatory workspace switch and picker cancellation retain the current dirty workspace', async ({
  page
}) => {
  await installReliabilityWorkspace(page, {
    name: 'PickerCancellation',
    seed: { 'current.bpmn': bpmn('Process_picker', 'Picker process') }
  })
  await openDirectoryWorkspace(page)
  await openDirectoryFile(page, 'current.bpmn')

  await page.evaluate(() => window.__ORBITPM_RELIABILITY_FS__.setPickerBehavior('abort'))
  await page.getByRole('button', { name: 'Change folder…' }).click()
  await expect(page.getByRole('tab', { name: 'current.bpmn' })).toBeVisible()
  await expect(page.getByText('Storage: Folder workspace')).toBeVisible()

  await dirtyActiveTask(page, 'Switch cancellation keeps this draft')
  await page.evaluate(() => window.__ORBITPM_RELIABILITY_FS__.setPickerBehavior('resolve'))
  await page.getByRole('button', { name: 'Change folder…' }).click()
  const switchDialog = page.getByRole('dialog', { name: 'Unsaved changes' })
  await expect(switchDialog).toBeVisible()
  await switchDialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('tab', { name: /current\.bpmn — .*Unsaved changes/ })).toBeVisible()
  expect(await reliabilityRead(page, 'current.bpmn')).not.toContain(
    'Switch cancellation keeps this draft'
  )
  expect((await reliabilitySnapshot(page)).pickerCalls).toBe(3)
})

test('mandatory workspace switch aborts in-flight generation, assistant, and interview work', async ({
  page
}) => {
  test.setTimeout(90_000)
  await installReliabilityWorkspace(page, {
    name: 'AsyncSwitchCancellation',
    seed: {
      'switch-source.bpmn': bpmn('Process_async_switch', 'Async switch source')
    }
  })

  const heldRoutes: Array<{ phase: string; route: Route; release: () => void }> = []
  let requestPhase = 'setup'
  await page.route('https://openrouter.ai/**', async (route) => {
    if (route.request().url().includes('/credits')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { total_credits: 10, total_usage: 0 } })
      })
      return
    }
    let release!: () => void
    const held = new Promise<void>((resolveHeld) => {
      release = resolveHeld
    })
    heldRoutes.push({ phase: requestPhase, route, release })
    await held
    await route.abort('aborted').catch(() => undefined)
  })
  const waitForHeldRequest = async (phase: string): Promise<void> => {
    await expect
      .poll(() => heldRoutes.filter((entry) => entry.phase === phase).length, {
        timeout: 20_000
      })
      .toBeGreaterThanOrEqual(1)
  }
  const release = (phase: string): void => {
    const held = heldRoutes.find((entry) => entry.phase === phase)
    if (!held) throw new Error(`Held OpenRouter request for ${phase} was not registered`)
    held.release()
  }
  const switchWorkspace = async (): Promise<void> => {
    await page.getByRole('button', { name: 'Change folder…' }).click()
    await expect(page.getByRole('heading', { name: 'Process catalog' })).toBeVisible({
      timeout: 25_000
    })
    await expect(
      page.getByRole('tablist', { name: 'Open process diagrams' }).getByRole('tab')
    ).toHaveCount(0)
  }

  await openDirectoryWorkspace(page)
  await configureOpenRouter(page)

  const generator = await expandAiPanel(page)
  await generator
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('Generate a process that must not cross workspaces')
  await generator.getByRole('textbox', { name: 'Name', exact: true }).fill('generated-switch')
  await generator
    .getByLabel('I reviewed this request and consent to sending the listed data.')
    .check()
  requestPhase = 'generation'
  await generator.getByRole('button', { name: 'Generate', exact: true }).click()
  await waitForHeldRequest('generation')
  await expect(generator.getByRole('button', { name: 'Generating…' })).toBeVisible()
  await switchWorkspace()
  release('generation')
  await page.waitForTimeout(250)
  expect(await reliabilityPaths(page)).not.toContain('generated-switch.bpmn')

  await openDirectoryFile(page, 'switch-source.bpmn')
  await page.getByRole('button', { name: 'Ask the process assistant' }).click()
  let assistant = page.getByRole('complementary', { name: 'Process assistant' })
  await assistant.getByPlaceholder(/Ask what happens next/i).fill('Summarize this process remotely')
  await assistant.getByRole('button', { name: 'Send' }).click()
  let preview = assistant.getByRole('region', { name: 'External request preview' })
  await expect(preview).toBeVisible()
  await preview
    .getByLabel('I reviewed this request and consent to sending the listed data.')
    .check()
  requestPhase = 'assistant'
  await preview.getByRole('button', { name: 'Send' }).click()
  await waitForHeldRequest('assistant')
  await switchWorkspace()
  release('assistant')
  await expect(page.getByRole('button', { name: 'Ask the process assistant' })).toBeVisible()
  await expect(page.getByText('late response from prior workspace')).toHaveCount(0)

  await openDirectoryFile(page, 'switch-source.bpmn')
  await page.getByRole('button', { name: 'Ask the process assistant' }).click()
  assistant = page.getByRole('complementary', { name: 'Process assistant' })
  await assistant.getByRole('tab', { name: 'Complete this process' }).click()
  preview = assistant.getByRole('region', { name: 'External request preview' })
  await expect(preview).toBeVisible({ timeout: 20_000 })
  await preview
    .getByLabel('I reviewed this request and consent to sending the listed data.')
    .check()
  requestPhase = 'interview'
  await preview.getByRole('button', { name: 'Send' }).click()
  await waitForHeldRequest('interview')
  await switchWorkspace()
  release('interview')
  await expect(page.getByRole('button', { name: 'Ask the process assistant' })).toBeVisible()
  await expect(page.getByText('late response from prior workspace')).toHaveCount(0)
  expect(await reliabilityRead(page, 'switch-source.bpmn')).not.toContain(
    'late response from prior workspace'
  )
})

test('mandatory isolation: unreadable entries do not block good files and permission loss retains dirty XML', async ({
  page
}) => {
  await installReliabilityWorkspace(page, {
    name: 'FailureIsolation',
    seed: {
      'good.bpmn': bpmn('Process_good', 'Good process'),
      'unreadable.bpmn': bpmn('Process_unreadable', 'Unreadable process')
    },
    unreadable: ['unreadable.bpmn']
  })
  await openDirectoryWorkspace(page)
  await expect(physicalRow(page, 'good.bpmn')).toBeVisible()
  await openDirectoryFile(page, 'good.bpmn')
  await dirtyActiveTask(page, 'Permission-loss draft retained')
  await page.evaluate(() => window.__ORBITPM_RELIABILITY_FS__.setPermission('denied'))

  await page.locator('button[title="Save (Ctrl+S)"]:visible').click()
  await expect(page.locator('.orbitpm-editor__error')).toContainText(/permission|granted/iu, {
    timeout: 20_000
  })
  await expect(page.locator('.orbitpm-editor__dirty-flag--dirty:visible')).toBeVisible()
  expect(await reliabilityRead(page, 'good.bpmn')).not.toContain('Permission-loss draft retained')
})

test('mandatory coordination: simultaneous cross-tab saves never silently overwrite both drafts', async ({
  context,
  page
}) => {
  const seed = { 'shared.bpmn': bpmn('Process_shared', 'Shared process') }
  await installReliabilityWorkspace(page, { name: 'CrossTab', seed })
  const peer = await context.newPage()
  await installReliabilityWorkspace(peer, { name: 'CrossTab', seed })
  // Avoid racing first-run manifest creation; the save collision below is the
  // intentional concurrency under test.
  await openDirectoryWorkspace(page)
  await openDirectoryWorkspace(peer)
  await openDirectoryFile(page, 'shared.bpmn')
  await openDirectoryFile(peer, 'shared.bpmn')
  await dirtyActiveTask(page, 'Cross-tab draft A')
  await dirtyActiveTask(peer, 'Cross-tab draft B')

  await Promise.all([
    page.locator('button[title="Save (Ctrl+S)"]:visible').click(),
    peer.locator('button[title="Save (Ctrl+S)"]:visible').click()
  ])
  await expect
    .poll(
      async () => {
        const xml = await reliabilityRead(page, 'shared.bpmn')
        return [xml?.includes('Cross-tab draft A'), xml?.includes('Cross-tab draft B')].filter(
          Boolean
        ).length
      },
      { timeout: 25_000 }
    )
    .toBe(1)

  const collisionEvidence = `${await page.locator('body').innerText()}\n${await peer
    .locator('body')
    .innerText()}`
  expect(collisionEvidence).toMatch(
    /Another OrbitPM tab is saving|changed in another OrbitPM tab|changed on disk/iu
  )
  const dirtyCount =
    (await page.locator('.orbitpm-editor__dirty-flag--dirty').count()) +
    (await peer.locator('.orbitpm-editor__dirty-flag--dirty').count())
  expect(dirtyCount).toBeGreaterThanOrEqual(1)
  await peer.close()
})

test('mandatory recovery history restores a revision and quota failure keeps the live draft', async ({
  page
}) => {
  await installReliabilityWorkspace(page, {
    name: 'HistoryQuota',
    seed: { 'history.bpmn': bpmn('Process_history', 'History process') }
  })
  await openDirectoryWorkspace(page)
  await openDirectoryFile(page, 'history.bpmn')
  await dirtyActiveTask(page, 'History revision A')
  await saveActive(page)
  await dirtyActiveTask(page, 'History revision B')
  await saveActive(page)

  await page.getByRole('button', { name: 'Recovery history' }).click()
  const historyDialog = page.getByRole('dialog', { name: 'Recovery history' })
  await expect(historyDialog).toBeVisible()
  const revisions = historyDialog.locator('article')
  await expect(revisions).toHaveCount(2)
  await revisions.first().getByRole('button', { name: 'Preview revision' }).click()
  await expect(historyDialog).toContainText('History revision A')
  await revisions.first().getByRole('button', { name: 'Restore revision' }).click()
  await expect
    .poll(() => reliabilityRead(page, 'history.bpmn'), { timeout: 25_000 })
    .toContain('History revision A')
  await expect.poll(() => activeTaskName(page), { timeout: 25_000 }).toBe('History revision A')
  await historyDialog.getByRole('button', { name: 'Cancel' }).click()

  await dirtyActiveTask(page, 'Quota failure live draft')
  await page.evaluate(() =>
    window.__ORBITPM_RELIABILITY_FS__.failNextWrite('history.bpmn', 'QuotaExceededError')
  )
  await page.locator('button[title="Save (Ctrl+S)"]:visible').click()
  await expect(page.locator('.orbitpm-editor__error')).toContainText(/Save failed/iu, {
    timeout: 25_000
  })
  await expect(page.locator('.orbitpm-editor__dirty-flag--dirty:visible')).toBeVisible()
  expect((await reliabilitySnapshot(page)).failNextWrites['history.bpmn']).toBeUndefined()
  expect(await reliabilityRead(page, 'history.bpmn')).not.toContain('Quota failure live draft')
})

test('mandatory recovery history retains the newest 20 revisions and prunes the oldest first', async ({
  page
}) => {
  test.setTimeout(120_000)
  await installReliabilityWorkspace(page, {
    name: 'HistoryRetention',
    seed: {
      'retention.bpmn': bpmn('Process_history_retention', 'History retention', 'History seed zero')
    }
  })
  await openDirectoryWorkspace(page)
  await openDirectoryFile(page, 'retention.bpmn')

  for (let revision = 1; revision <= 21; revision += 1) {
    await dirtyActiveTask(page, `Retention version ${String(revision).padStart(2, '0')}`)
    await saveActive(page)
  }

  await page.getByRole('button', { name: 'Recovery history' }).click()
  const historyDialog = page.getByRole('dialog', { name: 'Recovery history' })
  await expect(historyDialog).toBeVisible()
  const revisions = historyDialog.locator('article')
  await expect(revisions).toHaveCount(20, { timeout: 25_000 })
  await revisions.last().getByRole('button', { name: 'Preview revision' }).click()
  await expect(historyDialog).toContainText('Retention version 01')
  await expect(historyDialog).not.toContainText('History seed zero')

  const historyPaths = (await reliabilityPaths(page)).filter((path) =>
    path.startsWith('.orbitpm/history/')
  )
  expect(historyPaths.filter((path) => path.endsWith('.bpmn'))).toHaveLength(20)
  expect(historyPaths.filter((path) => path.endsWith('.json'))).toHaveLength(20)
})

test('mandatory index integrity repairs duplicate IDs and projects unsaved XML into search, catalog, and links', async ({
  page
}) => {
  await installReliabilityWorkspace(page, {
    name: 'IndexIntegrity',
    seed: {
      'duplicate-a.bpmn': bpmn('Process_duplicate', 'Duplicate A'),
      'duplicate-b.bpmn': bpmn('Process_duplicate', 'Duplicate B'),
      'caller.bpmn': callerBpmn('Process_live_caller', 'Live caller', 'Process_live_index'),
      'live.bpmn': bpmn('Process_live_index', 'Live index')
    }
  })
  await openDirectoryWorkspace(page)
  await openDirectoryFile(page, 'duplicate-b.bpmn')
  const repair = page.getByRole('button', {
    name: 'Process_duplicate · Repair duplicate process IDs'
  })
  await expect(repair).toBeVisible()
  await repair.click()
  await expect(page.locator('.orbitpm-editor__dirty-flag--dirty:visible')).toBeVisible({
    timeout: 25_000
  })
  await page.locator('button[title="Save (Ctrl+S)"]:visible').click()
  await expect
    .poll(
      async () => {
        const first = await reliabilityRead(page, 'duplicate-a.bpmn')
        const second = await reliabilityRead(page, 'duplicate-b.bpmn')
        const firstId = first?.match(/<bpmn:process id="([^"]+)"/u)?.[1]
        const secondId = second?.match(/<bpmn:process id="([^"]+)"/u)?.[1]
        const snapshot = await reliabilitySnapshot(page)
        return JSON.stringify({
          distinct: Boolean(firstId && secondId && firstId !== secondId),
          firstId,
          secondId,
          writePaths: snapshot.writes.slice(-12).map(({ path }) => path),
          visibleErrors: await page
            .locator('[role="alert"]:visible, .orbitpm-editor__error:visible')
            .allTextContents()
        })
      },
      {
        timeout: 25_000,
        message: 'duplicate repair should persist distinct process IDs to both BPMN files'
      }
    )
    .toMatch(/"distinct":true/u)
  const first = await reliabilityRead(page, 'duplicate-a.bpmn')
  const second = await reliabilityRead(page, 'duplicate-b.bpmn')
  const firstId = first?.match(/<bpmn:process id="([^"]+)"/u)?.[1]
  const secondId = second?.match(/<bpmn:process id="([^"]+)"/u)?.[1]
  expect(firstId).toBeTruthy()
  expect(secondId).toBeTruthy()
  expect(firstId).not.toBe(secondId)

  const callerRow = physicalRow(page, 'caller.bpmn')
  await expect(callerRow).toHaveAttribute('data-tree-expandable', 'true')
  await openDirectoryFile(page, 'caller.bpmn')
  const liveToken = 'Live unsaved catalog sentinel'
  const missingTarget = 'Process_unsaved_missing_target'
  await dirtyActiveCaller(page, liveToken, missingTarget)

  await expect(callerRow).not.toHaveAttribute('data-tree-expandable', 'true', {
    timeout: 20_000
  })
  const detachedTarget = physicalRow(page, 'live.bpmn')
  await expect(detachedTarget).toBeVisible({ timeout: 20_000 })
  await expect(detachedTarget).not.toHaveAttribute('data-owned-subprocess', 'true')

  const search = page.getByPlaceholder('Search processes…')
  await search.fill(liveToken)
  const results = page.getByRole('listbox', { name: 'Search results' })
  await expect(results.getByRole('option')).toHaveCount(1, { timeout: 20_000 })
  await expect(results).toContainText('caller.bpmn')
  await search.fill('')

  const unresolvedBadge = page.getByRole('button', {
    name: '1 unresolved link',
    exact: true
  })
  await expect(unresolvedBadge).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: /Home/u }).first().click()
  const catalogRow = page.getByRole('button', {
    name: `Open ${liveToken}`
  })
  await expect(catalogRow).toBeVisible({ timeout: 20_000 })
  await expect(catalogRow).toContainText('⚠ 1')

  await unresolvedBadge.click()
  const unresolvedDialog = page.getByRole('dialog', { name: 'Unresolved links' })
  await expect(unresolvedDialog).toContainText(missingTarget)
  await expect(unresolvedDialog).toContainText('caller.bpmn')

  const durableCaller = await reliabilityRead(page, 'caller.bpmn')
  expect(durableCaller).not.toContain(liveToken)
  expect(durableCaller).not.toContain(missingTarget)
  expect(durableCaller).toContain('calledElement="Process_live_index"')
})

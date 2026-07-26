import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  createOfficialWorkbookTemplate,
  OFFICIAL_TEMPLATE_ASSET_NAMES
} from '../../src/spreadsheet/template'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()

const HAPPY_CSV = [
  'Process ID,Step ID,Order,Type,Name EN,Name AR',
  'process_1,Start_1,1,startEvent,Start,البداية',
  'process_1,Task_1,2,userTask,Review request,مراجعة الطلب',
  'process_1,End_1,3,endEvent,End,النهاية'
].join('\r\n')

const DUPLICATE_CSV = [
  'Process ID,Step ID,Order,Type,Name EN,Name AR',
  'process_1,Start_1,1,startEvent,Start,البداية',
  'process_1,Task_1,2,userTask,Review request,مراجعة الطلب',
  'process_1,Task_1,3,userTask,Archive request,أرشفة الطلب',
  'process_1,End_1,4,endEvent,End,النهاية'
].join('\r\n')

const EXISTING_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_existing" targetNamespace="https://orbitpm.ae/tests">
  <bpmn:process id="existing_process" name="Existing process" isExecutable="false">
    <bpmn:startEvent id="Start_existing" />
  </bpmn:process>
</bpmn:definitions>`

test.beforeAll(() => {
  const html = readFileSync(DIST, 'utf8')
  expect(html.length, 'dist/index.html should be a built single file').toBeGreaterThan(500_000)
})

async function forceSingleFileMode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete window.showDirectoryPicker
    delete window.showOpenFilePicker
  })
}

async function openSpreadsheetPanel(page: Page) {
  const blank = page.getByRole('button', { name: /New blank diagram/i })
  if (await blank.isVisible().catch(() => false)) {
    await blank.click()
    await expect(page.locator('.djs-container svg').first()).toBeVisible({
      timeout: 20_000
    })
  }
  const aside = page.locator('aside')
  if (!(await aside.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Toggle side panel' }).click()
  }
  const aiHeader = page.getByRole('button', { name: /Generate with AI/i })
  if ((await aiHeader.getAttribute('aria-expanded')) === 'false') {
    await aiHeader.click()
  }
  await page.getByRole('tab', { name: 'Excel / CSV' }).click()
  const panel = page.getByRole('region', { name: 'Import Excel or CSV' })
  await expect(panel).toBeVisible()
  return panel
}

async function uploadCsv(
  panel: Awaited<ReturnType<typeof openSpreadsheetPanel>>,
  contents: string,
  name = 'processes.csv'
): Promise<void> {
  await panel.locator('input[type="file"][accept*=".xlsx"]').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(contents, 'utf8')
  })
  await expect(panel.getByText(/Ordinary spreadsheet detected/i)).toBeVisible({
    timeout: 20_000
  })
}

async function fillDefaultProcessNames(
  panel: Awaited<ReturnType<typeof openSpreadsheetPanel>>
): Promise<void> {
  await panel.getByLabel('Default process name (English)').fill('Process One')
  await panel.getByLabel('Default process name (Arabic)').fill('العملية الأولى')
}

async function validateAndPrepare(
  panel: Awaited<ReturnType<typeof openSpreadsheetPanel>>
): Promise<void> {
  await panel.getByRole('button', { name: 'Validate and preview' }).click()
  await expect(panel.getByText('No workbook issues found.')).toBeVisible({
    timeout: 20_000
  })
  await panel.getByRole('button', { name: 'Prepare BPMN files' }).click()
  await expect(panel.getByText(/BPMN files are ready/i)).toBeVisible({
    timeout: 30_000
  })
}

async function installMockWorkspace(
  page: Page,
  options: {
    seed?: Record<string, string>
    failBpmnWrites?: boolean
  } = {}
): Promise<void> {
  await page.addInitScript((configuration) => {
    interface MockFile {
      kind: 'file'
      name: string
      getFile(): Promise<{
        text(): Promise<string>
        arrayBuffer(): Promise<ArrayBuffer>
        lastModified: number
        size: number
        type: string
      }>
      createWritable(): Promise<{
        write(value: string | Blob | ArrayBuffer | ArrayBufferView): Promise<void>
        close(): Promise<void>
        abort(): Promise<void>
      }>
    }
    interface MockDirectory {
      kind: 'directory'
      name: string
      queryPermission(): Promise<PermissionState>
      requestPermission(): Promise<PermissionState>
      entries(): AsyncIterableIterator<[string, MockFile | MockDirectory]>
      getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MockDirectory>
      getFileHandle(name: string, options?: { create?: boolean }): Promise<MockFile>
      removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>
    }

    const missing = (): Error => {
      const error = new Error('Not found')
      error.name = 'NotFoundError'
      return error
    }
    const owned = (source: Uint8Array): Uint8Array<ArrayBuffer> => {
      const copy = new Uint8Array(new ArrayBuffer(source.byteLength))
      copy.set(source)
      return copy
    }
    const asBytes = async (
      value: string | Blob | ArrayBuffer | ArrayBufferView
    ): Promise<Uint8Array<ArrayBuffer>> => {
      if (typeof value === 'string') return owned(new TextEncoder().encode(value))
      if (value instanceof Blob) return owned(new Uint8Array(await value.arrayBuffer()))
      if (ArrayBuffer.isView(value)) {
        return owned(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
      }
      return owned(new Uint8Array(value))
    }
    const fileHandle = (name: string, initial = ''): MockFile => {
      let bytes: Uint8Array<ArrayBuffer> = owned(new TextEncoder().encode(initial))
      let modified = Date.now()
      return {
        kind: 'file',
        name,
        async getFile() {
          const snapshot = owned(bytes)
          return {
            text: async () => new TextDecoder().decode(snapshot),
            arrayBuffer: async () => owned(snapshot).buffer,
            lastModified: modified,
            size: snapshot.byteLength,
            type: name.endsWith('.bpmn') ? 'application/xml' : 'application/octet-stream'
          }
        },
        async createWritable() {
          let next = new Uint8Array(new ArrayBuffer(0))
          return {
            write: async (value) => {
              if (configuration.failBpmnWrites === true && name.endsWith('.bpmn')) {
                throw new Error('Injected spreadsheet destination failure')
              }
              next = await asBytes(value)
            },
            close: async () => {
              bytes = owned(next)
              modified = Date.now()
            },
            abort: async () => undefined
          }
        }
      }
    }
    const directoryHandle = (
      name: string,
      initial: Record<string, MockFile | MockDirectory> = {}
    ): MockDirectory => {
      const children = new Map<string, MockFile | MockDirectory>(Object.entries(initial))
      return {
        kind: 'directory',
        name,
        async queryPermission() {
          return 'granted'
        },
        async requestPermission() {
          return 'granted'
        },
        async *entries() {
          for (const entry of children) yield entry
        },
        async getDirectoryHandle(childName, childOptions = {}) {
          const existing = children.get(childName)
          if (existing) {
            if (existing.kind !== 'directory') {
              throw new TypeError(`${childName} is a file`)
            }
            return existing
          }
          if (!childOptions.create) throw missing()
          const created = directoryHandle(childName)
          children.set(childName, created)
          return created
        },
        async getFileHandle(childName, childOptions = {}) {
          const existing = children.get(childName)
          if (existing) {
            if (existing.kind !== 'file') {
              throw new TypeError(`${childName} is a directory`)
            }
            return existing
          }
          if (!childOptions.create) throw missing()
          const created = fileHandle(childName)
          children.set(childName, created)
          return created
        },
        async removeEntry(childName) {
          if (!children.delete(childName)) throw missing()
        }
      }
    }

    const seeded = Object.fromEntries(
      Object.entries(configuration.seed ?? {}).map(([name, contents]) => [
        name,
        fileHandle(name, contents)
      ])
    )
    const root = directoryHandle('SpreadsheetWorkspace', seeded)
    const collectPaths = async (directory: MockDirectory, prefix = ''): Promise<string[]> => {
      const paths: string[] = []
      for await (const [name, entry] of directory.entries()) {
        const path = prefix ? `${prefix}/${name}` : name
        if (entry.kind === 'file') paths.push(path)
        else paths.push(...(await collectPaths(entry, path)))
      }
      return paths.sort()
    }
    ;(
      window as unknown as {
        showDirectoryPicker: () => Promise<MockDirectory>
        __SPREADSHEET_WORKSPACE_PATHS__: () => Promise<string[]>
      }
    ).showDirectoryPicker = async () => root
    ;(
      window as unknown as {
        __SPREADSHEET_WORKSPACE_PATHS__: () => Promise<string[]>
      }
    ).__SPREADSHEET_WORKSPACE_PATHS__ = () => collectPaths(root)
  }, options)
}

async function workspacePaths(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (
      window as unknown as {
        __SPREADSHEET_WORKSPACE_PATHS__: () => Promise<string[]>
      }
    ).__SPREADSHEET_WORKSPACE_PATHS__()
  )
}

test('official Excel template imports through the worker and opens validated BPMN', async ({
  page
}) => {
  await forceSingleFileMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  const panel = await openSpreadsheetPanel(page)
  const workbook = createOfficialWorkbookTemplate('example')
  await panel.locator('input[type="file"][accept*=".xlsx"]').setInputFiles({
    name: OFFICIAL_TEMPLATE_ASSET_NAMES.example,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(workbook)
  })

  await expect(panel.getByText(/Official OrbitPM template detected/i)).toBeVisible({
    timeout: 20_000
  })
  await validateAndPrepare(panel)
  await panel.getByRole('button', { name: 'Commit import' }).click()
  await expect(panel.getByText('Import committed successfully.')).toBeVisible({
    timeout: 30_000
  })
  await expect(page.locator('.djs-container:visible svg').first()).toBeVisible({
    timeout: 30_000
  })
  await expect(panel.getByText(/SHA-256/)).toBeVisible()
})

test('ordinary CSV maps bilingual steps, infers order flows, and commits', async ({ page }) => {
  await forceSingleFileMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  const panel = await openSpreadsheetPanel(page)
  await uploadCsv(panel, HAPPY_CSV)
  await fillDefaultProcessNames(panel)

  await validateAndPrepare(panel)
  await expect(panel.getByText('1 processes')).toBeVisible()
  await expect(panel.getByText('3 nodes')).toBeVisible()
  await expect(panel.getByText('2 flows')).toBeVisible()
  await panel.getByRole('button', { name: 'Commit import' }).click()
  await expect(panel.getByText('Import committed successfully.')).toBeVisible({
    timeout: 30_000
  })
  await expect(page.locator('.djs-container:visible svg').first()).toBeVisible({
    timeout: 30_000
  })
})

test('missing required mapping blocks review with an actionable issue', async ({ page }) => {
  await forceSingleFileMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  const panel = await openSpreadsheetPanel(page)
  await uploadCsv(
    panel,
    ['Process ID,Step ID,Order,Type,Name EN', 'process_1,Start_1,1,startEvent,Start'].join('\n'),
    'missing-arabic.csv'
  )

  await expect(panel.getByText('Confirm every required mapping before review.')).toBeVisible()
  await panel.getByRole('button', { name: 'Validate and preview' }).click()
  await expect(panel.getByText('missing-required-mapping')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Prepare BPMN files' })).toHaveCount(0)
})

test('duplicate step IDs are rejected before any BPMN preparation', async ({ page }) => {
  await forceSingleFileMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  const panel = await openSpreadsheetPanel(page)
  await uploadCsv(panel, DUPLICATE_CSV, 'duplicate-steps.csv')
  await fillDefaultProcessNames(panel)
  await panel.getByRole('button', { name: 'Validate and preview' }).click()

  await expect(panel.getByText('node-id-duplicate').first()).toBeVisible({
    timeout: 20_000
  })
  await expect(panel.getByRole('button', { name: 'Prepare BPMN files' })).toHaveCount(0)
})

test('directory collision policy blocks without modifying the destination', async ({ page }) => {
  await installMockWorkspace(page, {
    seed: { 'process-one.bpmn': EXISTING_BPMN }
  })
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page.getByRole('button', { name: /Choose folder workspace/i }).click()
  await expect(page.getByRole('heading', { name: 'Process catalog' })).toBeVisible({
    timeout: 20_000
  })
  const panel = await openSpreadsheetPanel(page)
  await uploadCsv(panel, HAPPY_CSV, 'collision.csv')
  await fillDefaultProcessNames(panel)
  await panel.getByLabel('If a file already exists').selectOption('error')
  await panel.getByRole('button', { name: 'Validate and preview' }).click()
  await expect(panel.getByText('No workbook issues found.')).toBeVisible()
  await panel.getByRole('button', { name: 'Prepare BPMN files' }).click()

  await expect(panel.getByText('destination-path-collision')).toBeVisible({
    timeout: 30_000
  })
  expect(await workspacePaths(page)).toEqual(['process-one.bpmn'])
})

test('directory write failure reports rollback and leaves no BPMN artifact', async ({ page }) => {
  await installMockWorkspace(page, { failBpmnWrites: true })
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page.getByRole('button', { name: /Choose folder workspace/i }).click()
  await expect(page.getByRole('heading', { name: 'Process catalog' })).toBeVisible({
    timeout: 20_000
  })
  const panel = await openSpreadsheetPanel(page)
  await uploadCsv(panel, HAPPY_CSV, 'rollback.csv')
  await fillDefaultProcessNames(panel)
  await validateAndPrepare(panel)
  await panel.getByRole('button', { name: 'Commit import' }).click()

  await expect(panel.getByText('Import failed; destination changes were rolled back.')).toBeVisible(
    { timeout: 30_000 }
  )
  expect((await workspacePaths(page)).filter((path) => path.endsWith('.bpmn'))).toEqual([])
})

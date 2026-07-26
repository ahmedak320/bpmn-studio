import { test, expect } from '@playwright/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

// W2B company-documentation e2e. Loads the BUILT single file over file:// and
// injects a MOCK File System Access directory picker (backed by an in-memory
// workspace) so directory-mode features — catalog, search, breadcrumb,
// back/forward, the unresolved-links panel and the print view — can be driven
// headlessly (the real picker opens a native dialog that can't be automated).
const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()

test.beforeAll(() => {
  const html = readFileSync(DIST, 'utf8')
  expect(html.length, 'dist/index.html should be a built single file').toBeGreaterThan(500_000)
})

function recordOffendingRequests(page: import('@playwright/test').Page): string[] {
  const offending: string[] = []
  page.on('request', (req) => {
    const url = req.url()
    if (url === FILE_URL) return
    if (url.startsWith('data:') || url.startsWith('blob:')) return
    offending.push(`${req.method()} ${url}`)
  })
  return offending
}

/** Install an in-memory workspace behind window.showDirectoryPicker, and stub
 *  window.print so the print flow doesn't open a native dialog. Runs before the
 *  app's own scripts (addInitScript), so directoryPickerSupported() is true. */
async function installMockWorkspace(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const NS = `xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC" xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI"`
    const orderXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions ${NS} id="definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn2:process id="Process_order" name="Order Fulfillment" isExecutable="false">
    <bpmn2:startEvent id="Start_1" name="Order received" />
    <bpmn2:callActivity id="Call_ship" name="Ship it" calledElement="Process_ship" />
    <bpmn2:callActivity id="Call_missing" name="Do magic" calledElement="Process_missing" />
  </bpmn2:process>
  <bpmndi:BPMNDiagram id="D1"><bpmndi:BPMNPlane id="P1" bpmnElement="Process_order">
    <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1"><omgdc:Bounds x="160" y="120" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Call_ship_di" bpmnElement="Call_ship"><omgdc:Bounds x="260" y="98" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Call_missing_di" bpmnElement="Call_missing"><omgdc:Bounds x="420" y="98" width="100" height="80" /></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn2:definitions>`
    const simple = (pid: string, name: string, taskName: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions ${NS} id="definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn2:process id="${pid}" name="${name}" isExecutable="false">
    <bpmn2:startEvent id="Start_x" name="Start" />
    <bpmn2:task id="Task_x" name="${taskName}" />
  </bpmn2:process>
  <bpmndi:BPMNDiagram id="D1"><bpmndi:BPMNPlane id="P1" bpmnElement="${pid}">
    <bpmndi:BPMNShape id="Start_x_di" bpmnElement="Start_x"><omgdc:Bounds x="160" y="120" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Task_x_di" bpmnElement="Task_x"><omgdc:Bounds x="240" y="98" width="100" height="80" /></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn2:definitions>`

    // A deliberately WIDE process (9 sequential tasks spanning ~2600px of DI) that
    // carries process-level org ownership. Wide enough that the print band engine
    // slices it into multiple stacked snake-order bands, and its orbitpm:owner /
    // orbitpm:ownerType feed the print header's owner line.
    const wide = (pid: string, name: string, owner: string, ownerType: string): string => {
      const TASKS = 9
      let nodes = '<bpmn2:startEvent id="Start_w" name="Begin" />'
      let shapes =
        '<bpmndi:BPMNShape id="Start_w_di" bpmnElement="Start_w"><omgdc:Bounds x="100" y="120" width="36" height="36" /></bpmndi:BPMNShape>'
      let edges = ''
      let prev = 'Start_w'
      let prevRight = 136 // Start_w right edge (100 + 36)
      for (let i = 1; i <= TASKS; i++) {
        const tid = `Task_${i}`
        const fid = `Flow_${i}`
        const x = 200 + (i - 1) * 300
        nodes += `<bpmn2:task id="${tid}" name="Step ${i}" /><bpmn2:sequenceFlow id="${fid}" sourceRef="${prev}" targetRef="${tid}" />`
        shapes += `<bpmndi:BPMNShape id="${tid}_di" bpmnElement="${tid}"><omgdc:Bounds x="${x}" y="98" width="100" height="80" /></bpmndi:BPMNShape>`
        edges += `<bpmndi:BPMNEdge id="${fid}_di" bpmnElement="${fid}"><omgdi:waypoint x="${prevRight}" y="138" /><omgdi:waypoint x="${x}" y="138" /></bpmndi:BPMNEdge>`
        prev = tid
        prevRight = x + 100
      }
      return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions ${NS} xmlns:orbitpm="http://orbitpm.ae/schema/bpmn/1.0" id="definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn2:process id="${pid}" name="${name}" isExecutable="false" orbitpm:owner="${owner}" orbitpm:ownerType="${ownerType}">
    ${nodes}
  </bpmn2:process>
  <bpmndi:BPMNDiagram id="D1"><bpmndi:BPMNPlane id="P1" bpmnElement="${pid}">
    ${shapes}${edges}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn2:definitions>`
    }

    interface FH {
      kind: 'file'
      name: string
      getFile(): Promise<{ text(): Promise<string>; lastModified: number; size: number }>
      createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }>
    }
    interface DH {
      kind: 'directory'
      name: string
      queryPermission(): Promise<string>
      requestPermission(): Promise<string>
      entries(): AsyncIterableIterator<[string, FH | DH]>
      getDirectoryHandle(n: string, o?: { create?: boolean }): Promise<DH>
      getFileHandle(n: string, o?: { create?: boolean }): Promise<FH>
      removeEntry(n: string, o?: { recursive?: boolean }): Promise<void>
    }
    const fileHandle = (name: string, content: string): FH => {
      let data = content
      let mtime = Date.now()
      return {
        kind: 'file',
        name,
        async getFile() {
          return { text: async () => data, lastModified: mtime, size: data.length }
        },
        async createWritable() {
          let buf = ''
          return {
            write: async (d: string) => {
              buf += d
            },
            close: async () => {
              data = buf
              mtime = Date.now()
            }
          }
        }
      }
    }
    const dirHandle = (name: string, children: Record<string, FH | DH>): DH => {
      const map = new Map<string, FH | DH>(Object.entries(children))
      const self: DH = {
        kind: 'directory',
        name,
        async queryPermission() {
          return 'granted'
        },
        async requestPermission() {
          return 'granted'
        },
        async *entries() {
          for (const [n, h] of map) yield [n, h]
        },
        async getDirectoryHandle(n: string, o: { create?: boolean } = {}) {
          const h = map.get(n)
          if (h) {
            if (h.kind !== 'directory') throw new Error(`${n} is a file`)
            return h
          }
          if (!o.create) {
            const e = new Error('nf')
            e.name = 'NotFoundError'
            throw e
          }
          const d = dirHandle(n, {})
          map.set(n, d)
          return d
        },
        async getFileHandle(n: string, o: { create?: boolean } = {}) {
          const h = map.get(n)
          if (h) {
            if (h.kind !== 'file') throw new Error(`${n} is a directory`)
            return h
          }
          if (!o.create) {
            const e = new Error('nf')
            e.name = 'NotFoundError'
            throw e
          }
          const f = fileHandle(n, '')
          map.set(n, f)
          return f
        },
        async removeEntry(n: string) {
          if (!map.has(n)) {
            const e = new Error('nf')
            e.name = 'NotFoundError'
            throw e
          }
          map.delete(n)
        }
      }
      return self
    }

    const root = dirHandle('CompanyProcesses', {
      Sales: dirHandle('Sales', {
        'order.bpmn': fileHandle('order.bpmn', orderXml),
        'ship.bpmn': fileHandle('ship.bpmn', simple('Process_ship', 'Shipping', 'Pack shipment')),
        'operations.bpmn': fileHandle(
          'operations.bpmn',
          wide('Process_ops', 'Operations Workflow', 'Operations', 'department')
        )
      }),
      HR: dirHandle('HR', {
        'hire.bpmn': fileHandle('hire.bpmn', simple('Process_hire', 'Hiring', 'Interview candidate'))
      }),
      'onboarding.bpmn': fileHandle(
        'onboarding.bpmn',
        simple('Process_onboarding', 'Onboarding', 'Prepare workstation')
      )
    })
    ;(window as unknown as { showDirectoryPicker: () => Promise<DH> }).showDirectoryPicker =
      async () => root
    // Stub print so the flow populates the print view without a native dialog.
    ;(window as unknown as { __printed: number }).__printed = 0
    window.print = () => {
      ;(window as unknown as { __printed: number }).__printed += 1
    }
  })
}

async function openWorkspace(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page.getByRole('button', { name: /Open a folder/i }).click()
  await expect(page.getByRole('heading', { name: 'Process catalog' })).toBeVisible({ timeout: 20_000 })
}

test('catalog lists every process and opens one, with a breadcrumb (directory mode)', async ({
  page
}) => {
  const offending = recordOffendingRequests(page)
  await installMockWorkspace(page)
  await openWorkspace(page)

  // Zero network requests during load — self-containment holds in directory mode.
  expect(offending, `unexpected load-time requests: ${offending.join(', ')}`).toEqual([])

  // Catalog shows all four processes across folders.
  for (const name of ['Order Fulfillment', 'Shipping', 'Hiring', 'Onboarding']) {
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible()
  }

  // Sort is interactive (clicking a column header keeps the rows rendered).
  await page.getByRole('button', { name: /^Folder/ }).click()
  await expect(page.getByText('Order Fulfillment').first()).toBeVisible()

  // Click a row → opens the file in an editor tab; the diagram renders.
  await page.getByRole('button', { name: /Open Order Fulfillment/i }).click()
  await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })
  expect(await page.locator('.djs-container svg circle').count()).toBeGreaterThan(0)

  // Breadcrumb shows the folder path of the active process.
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Sales')

  expect(offending, `unexpected requests: ${offending.join(', ')}`).toEqual([])
})

test('search filters across names / ids / content and opens a hit', async ({ page }) => {
  await installMockWorkspace(page)
  await openWorkspace(page)

  const box = page.getByPlaceholder(/Search processes/i)
  await box.fill('interview') // matches HR/hire diagram TEXT content only
  const results = page.getByRole('listbox', { name: 'Search results' })
  await expect(results).toBeVisible()
  await expect(results).toContainText('Hiring')
  await expect(results).not.toContainText('Order Fulfillment')

  // Clicking the hit opens the file.
  await results.getByRole('option').first().click()
  await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('HR')
})

test('unresolved-links panel lists dangling links and opens the source', async ({ page }) => {
  await installMockWorkspace(page)
  await openWorkspace(page)

  // The footer badge reflects the one unresolved link (order → Process_missing).
  // (Exact name avoids the catalog's "N with unresolved links" summary button.)
  const badge = page.getByRole('button', { name: '1 unresolved link', exact: true })
  await expect(badge).toBeVisible()
  await badge.click()

  const dialog = page.getByRole('dialog', { name: 'Unresolved links' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Process_missing')
  await expect(dialog.getByRole('button', { name: 'Create now' }).first()).toBeVisible()

  // "Open source" jumps to the file that owns the dangling call activity.
  await dialog.getByRole('button', { name: 'Open source' }).first().click()
  await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Sales')
})

test('back / forward navigate across tab activations', async ({ page }) => {
  await installMockWorkspace(page)
  await openWorkspace(page)

  await page.getByRole('button', { name: /Open Order Fulfillment/i }).click()
  await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Sales')

  // Home → catalog, open a second process.
  await page.getByRole('button', { name: /Home/i }).click()
  await page.getByRole('button', { name: /Open Hiring/i }).click()
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('HR')

  // Back → the order process again; Forward → hiring.
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Sales')
  await page.getByRole('button', { name: 'Forward', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('HR')
})

test('print view wraps a wide diagram into snake-order bands with a title + owner header', async ({
  page
}) => {
  await installMockWorkspace(page)
  await openWorkspace(page)

  await page.getByRole('button', { name: /Open Operations Workflow/i }).click()
  await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })

  // A dedicated print stylesheet is present in the shipped page.
  const styles = (await page.locator('style').allTextContents()).join('\n')
  expect(styles).toContain('orbitpm-print-root')
  expect(styles).toContain('landscape')

  // The document title before printing — restored once the print flow ends.
  const originalTitle = await page.evaluate(() => document.title)

  // Trigger Print → the print view is populated with the banded diagram + header.
  await page.getByRole('button', { name: 'Print / PDF' }).click()
  const printRoot = page.locator('[data-testid="print-root"]')
  await expect(printRoot).toBeAttached()
  await expect(printRoot).toContainText('Operations Workflow') // header = process name
  await expect(printRoot).toContainText('Sales') // folder header
  // The owner line surfaces the process-level orbitpm:owner.
  await expect(printRoot.locator('.orbitpm-print-owner')).toContainText('Operations')
  // A wide diagram is sliced into >= 2 stacked snake-order bands.
  expect(await page.locator('.orbitpm-print-band').count()).toBeGreaterThanOrEqual(2)
  expect(await printRoot.locator('svg').count()).toBeGreaterThan(0)
  // document.title was swapped to the process name (PDF filename default).
  await expect.poll(() => page.evaluate(() => document.title)).toBe('Operations Workflow')
  // window.print() was invoked (stubbed).
  expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBeGreaterThan(0)

  // After afterprint, the document title is restored.
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect.poll(() => page.evaluate(() => document.title)).toBe(originalTitle)
})

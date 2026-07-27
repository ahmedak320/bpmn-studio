import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Linked-process tree e2e. The fixture intentionally combines physical
// folders with a graph that has two distinct parents, a repeated call, an
// orphan and a back-edge. A separate multi-process file proves search forwards
// processId instead of treating relPath as identity.
const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()

test.beforeAll(() => {
  const html = readFileSync(DIST, 'utf8')
  expect(html.length, 'dist/index.html should be a built single file').toBeGreaterThan(500_000)
})

const BPMN_NS =
  'xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" ' +
  'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" ' +
  'xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" ' +
  'xmlns:di="http://www.omg.org/spec/DD/20100524/DI"'

interface CallSpec {
  id: string
  name: string
  calledElement: string
}

function oneProcessBpmn(
  processId: string,
  processName: string,
  calls: CallSpec[],
  taskName?: string
): string {
  const nodes = [
    `<bpmn2:startEvent id="Start_${processId}" name="Start" />`,
    ...calls.map(
      (call) =>
        `<bpmn2:callActivity id="${call.id}" name="${call.name}" calledElement="${call.calledElement}" />`
    ),
    ...(taskName ? [`<bpmn2:task id="Task_${processId}" name="${taskName}" />`] : [])
  ]
  const shapes = [
    `<bpmndi:BPMNShape id="Start_${processId}_di" bpmnElement="Start_${processId}"><dc:Bounds x="100" y="120" width="36" height="36" /></bpmndi:BPMNShape>`,
    ...calls.map(
      (call, index) =>
        `<bpmndi:BPMNShape id="${call.id}_di" bpmnElement="${call.id}"><dc:Bounds x="${200 + index * 160}" y="98" width="110" height="80" /></bpmndi:BPMNShape>`
    ),
    ...(taskName
      ? [
          `<bpmndi:BPMNShape id="Task_${processId}_di" bpmnElement="Task_${processId}"><dc:Bounds x="${200 + calls.length * 160}" y="98" width="110" height="80" /></bpmndi:BPMNShape>`
        ]
      : [])
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions ${BPMN_NS} id="Definitions_${processId}" targetNamespace="https://orbitpm.test/e2e">
  <bpmn2:process id="${processId}" name="${processName}" isExecutable="false">
    ${nodes.join('\n    ')}
  </bpmn2:process>
  <bpmndi:BPMNDiagram id="Diagram_${processId}">
    <bpmndi:BPMNPlane id="Plane_${processId}" bpmnElement="${processId}">
      ${shapes.join('\n      ')}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn2:definitions>`
}

function searchBundleBpmn(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions ${BPMN_NS} id="Definitions_search_bundle" targetNamespace="https://orbitpm.test/e2e">
  <bpmn2:process id="Process_search_decoy" name="Bundle Decoy" isExecutable="false">
    <bpmn2:task id="Task_search_decoy" name="Ordinary work" />
  </bpmn2:process>
  <bpmn2:process id="Process_search_target" name="Needle Target" isExecutable="false">
    <bpmn2:task id="Task_search_target" name="Only this process should open" />
  </bpmn2:process>
  <bpmndi:BPMNDiagram id="Diagram_search_decoy">
    <bpmndi:BPMNPlane id="Plane_search_decoy" bpmnElement="Process_search_decoy">
      <bpmndi:BPMNShape id="Task_search_decoy_di" bpmnElement="Task_search_decoy"><dc:Bounds x="180" y="100" width="110" height="80" /></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="Diagram_search_target">
    <bpmndi:BPMNPlane id="Plane_search_target" bpmnElement="Process_search_target">
      <bpmndi:BPMNShape id="Task_search_target_di" bpmnElement="Task_search_target"><dc:Bounds x="180" y="100" width="110" height="80" /></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn2:definitions>`
}

const WORKSPACE_FILES: Record<string, string> = {
  'Parents/parent-a.bpmn': oneProcessBpmn('Process_parent_a', 'Parent Alpha', [
    {
      id: 'Call_shared_a1',
      name: 'Shared review first call',
      calledElement: 'Process_shared'
    },
    {
      id: 'Call_shared_a2',
      name: 'Shared review repeated call',
      calledElement: 'Process_shared'
    }
  ]),
  'Parents/parent-b.bpmn': oneProcessBpmn('Process_parent_b', 'Parent Beta', [
    {
      id: 'Call_shared_b1',
      name: 'Shared review',
      calledElement: 'Process_shared'
    }
  ]),
  'Shared/shared-child.bpmn': oneProcessBpmn('Process_shared', 'Shared Review', [
    {
      id: 'Call_parent_a_back',
      name: 'Return to parent alpha',
      calledElement: 'Process_parent_a'
    }
  ]),
  'Independent/orphan.bpmn': oneProcessBpmn(
    'Process_orphan',
    'Independent Orphan',
    [],
    'Stand-alone work'
  ),
  'Search/bundle.bpmn': searchBundleBpmn()
}

/** Install the flat-path fixture as a writable in-memory directory tree. */
async function installMockWorkspace(page: Page): Promise<void> {
  await page.addInitScript((seedFiles: Record<string, string>) => {
    interface MockFile {
      kind: 'file'
      name: string
      getFile(): Promise<{
        text(): Promise<string>
        arrayBuffer(): Promise<ArrayBuffer>
        lastModified: number
        size: number
      }>
      createWritable(): Promise<{
        write(value: string | Blob | ArrayBuffer): Promise<void>
        close(): Promise<void>
      }>
    }
    interface MockDirectory {
      kind: 'directory'
      name: string
      children: Map<string, MockFile | MockDirectory>
      queryPermission(): Promise<PermissionState>
      requestPermission(): Promise<PermissionState>
      entries(): AsyncIterableIterator<[string, MockFile | MockDirectory]>
      getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MockDirectory>
      getFileHandle(name: string, options?: { create?: boolean }): Promise<MockFile>
      removeEntry(name: string): Promise<void>
    }

    const missing = (): Error => {
      const error = new Error('Not found')
      error.name = 'NotFoundError'
      return error
    }
    const asText = async (value: string | Blob | ArrayBuffer): Promise<string> => {
      if (typeof value === 'string') return value
      if (value instanceof Blob) return value.text()
      return new TextDecoder().decode(value)
    }
    const fileHandle = (name: string, initial: string): MockFile => {
      let text = initial
      let modified = Date.now()
      return {
        kind: 'file',
        name,
        async getFile() {
          const bytes = new TextEncoder().encode(text)
          return {
            text: async () => text,
            arrayBuffer: async () => bytes.buffer.slice(0),
            lastModified: modified,
            size: bytes.byteLength
          }
        },
        async createWritable() {
          let next = ''
          return {
            write: async (value) => {
              next += await asText(value)
            },
            close: async () => {
              text = next
              modified = Date.now()
            }
          }
        }
      }
    }
    const directoryHandle = (name: string): MockDirectory => {
      const directory: MockDirectory = {
        kind: 'directory',
        name,
        children: new Map(),
        async queryPermission() {
          return 'granted'
        },
        async requestPermission() {
          return 'granted'
        },
        async *entries() {
          for (const entry of directory.children) yield entry
        },
        async getDirectoryHandle(childName, options = {}) {
          const existing = directory.children.get(childName)
          if (existing) {
            if (existing.kind !== 'directory') throw new TypeError(`${childName} is a file`)
            return existing
          }
          if (!options.create) throw missing()
          const created = directoryHandle(childName)
          directory.children.set(childName, created)
          return created
        },
        async getFileHandle(childName, options = {}) {
          const existing = directory.children.get(childName)
          if (existing) {
            if (existing.kind !== 'file') throw new TypeError(`${childName} is a directory`)
            return existing
          }
          if (!options.create) throw missing()
          const created = fileHandle(childName, '')
          directory.children.set(childName, created)
          return created
        },
        async removeEntry(childName) {
          if (!directory.children.delete(childName)) throw missing()
        }
      }
      return directory
    }

    const root = directoryHandle('HierarchyWorkspace')
    for (const [relPath, xml] of Object.entries(seedFiles)) {
      const parts = relPath.split('/').filter(Boolean)
      const fileName = parts.pop()
      if (!fileName) continue
      let directory = root
      for (const segment of parts) {
        const existing = directory.children.get(segment)
        if (existing?.kind === 'directory') {
          directory = existing
        } else {
          const created = directoryHandle(segment)
          directory.children.set(segment, created)
          directory = created
        }
      }
      directory.children.set(fileName, fileHandle(fileName, xml))
    }
    ;(
      window as unknown as { showDirectoryPicker: () => Promise<MockDirectory> }
    ).showDirectoryPicker = async () => root
  }, WORKSPACE_FILES)
}

function physicalRow(page: Page, relPath: string): Locator {
  return page.locator(
    `.orbitpm-tree-row[data-rel-path="${relPath}"]:not(.orbitpm-tree-reference-row)`
  )
}

function referenceRow(page: Page, processId: string, referenceCount?: number): Locator {
  const count = referenceCount === undefined ? '' : `[data-reference-count="${referenceCount}"]`
  return page.locator(`.orbitpm-tree-reference-row[data-process-id="${processId}"]${count}`)
}

async function expandFolder(page: Page, relPath: string): Promise<void> {
  // title=relPath is the pre-existing physical-row contract; data-rel-path is
  // the stronger hierarchy contract. The union keeps directory expansion
  // independent of whether process metadata is attached to folder rows.
  const row = page
    .locator(
      `.orbitpm-tree-row[data-rel-path="${relPath}"]:not(.orbitpm-tree-reference-row), ` +
        `.orbitpm-tree-row[title="${relPath}"]:not(.orbitpm-tree-reference-row)`
    )
    .first()
  await expect(row).toBeVisible()
  await row.click()
}

async function expandLinkedChildren(row: Locator): Promise<void> {
  const expander = row.locator('[role="button"][aria-expanded]').first()
  await expect(expander).toHaveAttribute('aria-expanded', 'false')
  await expander.click()
  await expect(expander).toHaveAttribute('aria-expanded', 'true')
}

async function activeRootProcessId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const modeler = (
      window as unknown as {
        __ORBITPM_LITE__?: { modeler?: { get(name: string): unknown } }
      }
    ).__ORBITPM_LITE__?.modeler
    if (!modeler) return null
    const root = (
      modeler.get('canvas') as {
        getRootElement(): { id?: string; businessObject?: { id?: string } }
      }
    ).getRootElement()
    return root.businessObject?.id ?? root.id ?? null
  })
}

test('folder tree nests owned subprocesses once and shows reused/cyclic references clearly in EN/AR', async ({
  page
}) => {
  await installMockWorkspace(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page.getByRole('button', { name: /Open a folder/i }).click()
  await expect(page.getByRole('heading', { name: 'Process catalog' })).toBeVisible({
    timeout: 20_000
  })

  // The unreferenced process remains under Independent; no synthetic
  // "Orphans" bucket appears. The owned child will be removed from Shared and
  // nested under its deterministic owner (Parent Alpha).
  for (const folder of ['Parents', 'Shared', 'Independent']) {
    await expandFolder(page, folder)
  }
  const parentA = physicalRow(page, 'Parents/parent-a.bpmn')
  const parentB = physicalRow(page, 'Parents/parent-b.bpmn')
  const canonicalShared = physicalRow(page, 'Shared/shared-child.bpmn')
  const orphan = physicalRow(page, 'Independent/orphan.bpmn')
  for (const row of [parentA, parentB, orphan]) {
    await expect(row).toBeVisible()
  }
  await expect(canonicalShared).toHaveCount(0)
  await expect(page.locator('.orbitpm-tree-row[data-rel-path="Orphans"]')).toHaveCount(0)

  await expandLinkedChildren(parentA)
  await expect(canonicalShared).toBeVisible()

  // One actionable canonical occurrence only, now nested under its owner.
  // It retains real file actions/dragging and clearly exposes ownership,
  // sharing, and the repeated call count.
  await expect(
    page.locator(
      '.orbitpm-tree-row[data-process-id="Process_shared"]:not(.orbitpm-tree-reference-row)'
    )
  ).toHaveCount(1)
  await expect(canonicalShared).toHaveAttribute('draggable', 'true')
  await expect(canonicalShared).toHaveAttribute('data-owned-subprocess', 'true')
  await expect(canonicalShared).toHaveAttribute('data-owner-process-id', 'Process_parent_a')
  await expect(canonicalShared.locator('.orbitpm-tree-actions button')).toHaveCount(3)
  await expect(canonicalShared.locator('.orbitpm-tree-owned-pill')).toHaveText('Owned')
  await expect(canonicalShared.locator('[data-call-count="2"]')).toHaveText('×2')
  const canonicalSharedPill = canonicalShared.locator('.orbitpm-tree-shared-pill')
  await expect(canonicalSharedPill).toHaveText('Shared')
  await expect(canonicalSharedPill).toHaveAttribute('title', 'Referenced by 2 parent processes')

  await expandLinkedChildren(parentB)
  const singleRef = referenceRow(page, 'Process_shared', 1)
  await expect(singleRef).toHaveCount(1)
  await expect(referenceRow(page, 'Process_shared', 2)).toHaveCount(0)
  await expect(singleRef).toContainText('Shared Review')
  await expect(singleRef).toHaveAttribute('data-read-only', 'true')
  await expect(singleRef).toHaveAttribute('data-reference-kind', 'reused')
  await expect(singleRef).not.toHaveAttribute('draggable', 'true')
  await expect(singleRef.locator('.orbitpm-tree-actions')).toHaveCount(0)
  await expect(singleRef.locator('.orbitpm-tree-shared-pill')).toHaveText('Shared')
  await expect(singleRef.locator('.orbitpm-tree-reused-pill')).toHaveText('Reused')
  await expect(singleRef.locator('.orbitpm-tree-shared-pill')).toHaveAttribute(
    'title',
    'Referenced by 2 parent processes'
  )
  await expect(singleRef.locator('.orbitpm-tree-reference-path')).toHaveText(
    'Canonical file: Shared/shared-child.bpmn'
  )

  // A reference is navigation, not a second actionable file. It opens the
  // child by stable process id, expands the owner chain and focuses the one
  // canonical nested row.
  await singleRef.click()
  await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => activeRootProcessId(page)).toBe('Process_shared')
  await expect(canonicalShared).toBeVisible()
  await expect(canonicalShared).toBeFocused()

  // Parent Alpha -> Shared Review -> Parent Alpha is an owner-tree back edge.
  // It remains visible as a cycle leaf but has no expander/actions.
  await expandLinkedChildren(canonicalShared)
  const cycle = page.locator(
    '.orbitpm-tree-reference-row[data-process-id="Process_parent_a"][data-cycle="back"]'
  )
  await expect(cycle).toHaveCount(1)
  await expect(cycle).toContainText('Parent Alpha')
  await expect(cycle.locator('[aria-expanded]')).toHaveCount(0)
  await expect(cycle.locator('.orbitpm-tree-actions')).toHaveCount(0)
  await expect(cycle.locator('.orbitpm-tree-cycle-indicator')).toHaveAttribute(
    'title',
    'Cycle — this process already appears in this branch'
  )

  // Interface RTL/localization updates presentation only; the same stable rows
  // stay projected, with logical-direction styles supplied by app.css.
  await page.getByRole('button', { name: 'Interface: العربية', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(canonicalSharedPill).toHaveText('مشتركة')
  await expect(canonicalSharedPill).toHaveAttribute('title', 'تتم الإشارة إليها من 2 عمليات أصلية')
  await expect(canonicalShared.locator('.orbitpm-tree-owned-pill')).toHaveText('مملوكة')
  await expect(singleRef.locator('.orbitpm-tree-reused-pill')).toHaveText('معاد استخدامها')
  await expect(singleRef.locator('.orbitpm-tree-reference-path')).toHaveText(
    'الملف الأساسي: Shared/shared-child.bpmn'
  )
  await expect(cycle.locator('.orbitpm-tree-cycle-indicator')).toHaveAttribute(
    'title',
    'حلقة — تظهر هذه العملية بالفعل في هذا الفرع'
  )

  // Search emits exactly the matching process from a two-process physical
  // file. Clicking it must forward processId, select the SECOND BPMN root, and
  // reveal/focus the single canonical bundle row.
  await page.getByRole('button', { name: 'الواجهة: EN', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  const search = page.getByRole('searchbox', { name: 'Search processes' })
  await search.fill('Needle Target')
  const results = page.getByRole('listbox', { name: 'Search results' })
  await expect(results).toBeVisible()
  await expect(results.getByRole('option')).toHaveCount(1)
  await expect(results.getByRole('option')).toContainText('Needle Target')
  await results.getByRole('option').click()

  await expect
    .poll(() => activeRootProcessId(page), { timeout: 20_000 })
    .toBe('Process_search_target')
  const bundleCanonical = physicalRow(page, 'Search/bundle.bpmn')
  await expect(bundleCanonical).toBeVisible()
  await expect(bundleCanonical).toBeFocused()
  await expect(
    page.locator(
      '.orbitpm-tree-row[data-rel-path="Search/bundle.bpmn"]:not(.orbitpm-tree-reference-row)'
    )
  ).toHaveCount(1)
})

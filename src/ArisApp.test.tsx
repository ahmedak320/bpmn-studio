// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installJsdomSvgSupport } from './aris/canvas/testing/jsdomSvg'

const mockState = vi.hoisted(() => ({
  directoryPickerSupported: false,
  rememberedHandle: undefined as FileSystemDirectoryHandle | undefined,
  ensurePermission: 'granted' as 'granted' | 'denied' | 'prompt',
  directoryAdapter: null as unknown
}))

vi.mock('./ai/AiPanelLite', () => ({
  AiPanelLite: () => <div data-testid="mock-ai-panel">mock-ai-panel</div>
}))

vi.mock('./settings/SettingsDialogLite', () => ({
  SettingsDialogLite: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">mock-settings-dialog</div> : null
}))

vi.mock('./fs/workspaceHandle', () => ({
  classifyPickerError: () => 'unknown' as const,
  directoryPickerSupported: () => mockState.directoryPickerSupported,
  ensurePermission: async () => mockState.ensurePermission,
  loadRememberedWorkspace: async () => mockState.rememberedHandle,
  pickWorkspace: async () => null,
  rememberWorkspace: async () => undefined
}))

vi.mock('./workspace/adapters/directory', () => ({
  DirectoryWorkspaceAdapter: vi.fn(function DirectoryWorkspaceAdapter() {
    if (!mockState.directoryAdapter) {
      throw new Error('mock directory adapter not configured')
    }
    return mockState.directoryAdapter
  })
}))

vi.mock('./workspace/adapters/opfs', async () => {
  const actual = await vi.importActual<typeof import('./workspace/adapters/opfs')>(
    './workspace/adapters/opfs'
  )
  return {
    ...actual,
    opfsSupported: () => false
  }
})

import ArisApp, { downloadBytes } from './ArisApp'
import { ArisGenerationPanel } from './ArisGenerationPanel'
import { buildMinimalValidDraft } from './aris/ai/testFixtures'
import { buildLegacyBpmnWorkbook, buildValidFixtureWorkbook } from './aris/excel/testFixtures'
import type { FileSnapshot, WorkspaceAdapter, WorkspaceEntry } from './workspace/adapters/types'

/**
 * A two-model AML export shaped exactly like a real ARIS one: object
 * definitions and connection definitions in the group, occurrences carrying
 * `Position`/`Size`, and connection occurrences nested inside their source
 * occurrence with their route points as ordered `Position` children.
 */
const TWO_MODEL_AML = `<?xml version="1.0" encoding="UTF-8"?>
<AML>
  <Header-Info DatabaseName="AnimalWF" UserName="tester" ArisExeVersion="10"/>
  <Group Group.ID="Group.Root">
    <ObjDef ObjDef.ID="ObjDef.Start" TypeNum="OT_EVT" SymbolNum="ST_EV">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Request received</AttrValue></AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Check" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Check request</AttrValue></AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Done" TypeNum="OT_EVT" SymbolNum="ST_EV">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Request checked</AttrValue></AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Review" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Review outcome</AttrValue></AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Owner" TypeNum="OT_PERS" SymbolNum="ST_PERS">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Intake officer</AttrValue></AttrDef>
    </ObjDef>
    <CxnDef CxnDef.ID="CxnDef.1" CxnDef.Type="CT_ACTIV_1" ToObjDef.IdRef="ObjDef.Check"/>
    <CxnDef CxnDef.ID="CxnDef.2" CxnDef.Type="CT_CRT_1" ToObjDef.IdRef="ObjDef.Done"/>
    <CxnDef CxnDef.ID="CxnDef.3" CxnDef.Type="CT_ACTIV_1" ToObjDef.IdRef="ObjDef.Owner"/>
    <Model Model.ID="Model.Intake" Model.Type="MT_EEPC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Intake process</AttrValue></AttrDef>
      <ObjOcc ObjOcc.ID="ObjOcc.Start" ObjDef.IdRef="ObjDef.Start" SymbolNum="ST_EV" Zorder="1">
        <Position Pos.X="200" Pos.Y="100"/>
        <Size Size.dX="180" Size.dY="60"/>
        <CxnOcc CxnOcc.ID="CxnOcc.1" CxnDef.IdRef="CxnDef.1" ToObjOcc.IdRef="ObjOcc.Check" Zorder="5">
          <Position Pos.X="290" Pos.Y="160"/>
          <Position Pos.X="290" Pos.Y="260"/>
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Check" ObjDef.IdRef="ObjDef.Check" SymbolNum="ST_FUNC" Zorder="2">
        <Position Pos.X="200" Pos.Y="260"/>
        <Size Size.dX="180" Size.dY="80"/>
        <CxnOcc CxnOcc.ID="CxnOcc.2" CxnDef.IdRef="CxnDef.2" ToObjOcc.IdRef="ObjOcc.Done" Zorder="6">
          <Position Pos.X="290" Pos.Y="340"/>
          <Position Pos.X="290" Pos.Y="440"/>
        </CxnOcc>
        <CxnOcc CxnOcc.ID="CxnOcc.3" CxnDef.IdRef="CxnDef.3" ToObjOcc.IdRef="ObjOcc.Owner" Zorder="7">
          <Position Pos.X="380" Pos.Y="300"/>
          <Position Pos.X="520" Pos.Y="300"/>
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Owner" ObjDef.IdRef="ObjDef.Owner" SymbolNum="ST_PERS" Zorder="4">
        <Position Pos.X="520" Pos.Y="270"/>
        <Size Size.dX="160" Size.dY="60"/>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Done" ObjDef.IdRef="ObjDef.Done" SymbolNum="ST_EV" Zorder="3">
        <Position Pos.X="200" Pos.Y="440"/>
        <Size Size.dX="180" Size.dY="60"/>
      </ObjOcc>
    </Model>
    <Model Model.ID="Model.Review" Model.Type="MT_EEPC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Review process</AttrValue></AttrDef>
      <ObjOcc ObjOcc.ID="ObjOcc.Review" ObjDef.IdRef="ObjDef.Review" SymbolNum="ST_FUNC" Zorder="1">
        <Position Pos.X="640" Pos.Y="120"/>
        <Size Size.dX="200" Size.dY="90"/>
      </ObjOcc>
    </Model>
  </Group>
</AML>
`

/**
 * The same shape, with each `CxnDef` nested inside its SOURCE `ObjDef` — which is
 * how ARIS itself expresses a connection's source endpoint. `TWO_MODEL_AML` keeps
 * them as group-level siblings on purpose, so both the accepting and the refusing
 * side of the section 9.3 `connection-endpoints-exist` check are exercised.
 */
const NESTED_CXNDEF_AML = `<?xml version="1.0" encoding="UTF-8"?>
<AML>
  <Header-Info DatabaseName="AnimalWF" UserName="tester" ArisExeVersion="10"/>
  <Group Group.ID="Group.Root">
    <ObjDef ObjDef.ID="ObjDef.Start" TypeNum="OT_EVT" SymbolNum="ST_EV">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Request received</AttrValue></AttrDef>
      <CxnDef CxnDef.ID="CxnDef.1" CxnDef.Type="CT_ACTIV_1" ToObjDef.IdRef="ObjDef.Check"/>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Check" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Check request</AttrValue></AttrDef>
      <CxnDef CxnDef.ID="CxnDef.2" CxnDef.Type="CT_CRT_1" ToObjDef.IdRef="ObjDef.Done"/>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Done" TypeNum="OT_EVT" SymbolNum="ST_EV">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Request checked</AttrValue></AttrDef>
    </ObjDef>
    <Model Model.ID="Model.Nested" Model.Type="MT_EEPC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Nested process</AttrValue></AttrDef>
      <ObjOcc ObjOcc.ID="ObjOcc.Start" ObjDef.IdRef="ObjDef.Start" SymbolNum="ST_EV" Zorder="1">
        <Position Pos.X="200" Pos.Y="100"/>
        <Size Size.dX="180" Size.dY="60"/>
        <CxnOcc CxnOcc.ID="CxnOcc.1" CxnDef.IdRef="CxnDef.1" ToObjOcc.IdRef="ObjOcc.Check" Zorder="5">
          <Position Pos.X="290" Pos.Y="160"/>
          <Position Pos.X="290" Pos.Y="260"/>
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Check" ObjDef.IdRef="ObjDef.Check" SymbolNum="ST_FUNC" Zorder="2">
        <Position Pos.X="200" Pos.Y="260"/>
        <Size Size.dX="180" Size.dY="80"/>
        <CxnOcc CxnOcc.ID="CxnOcc.2" CxnDef.IdRef="CxnDef.2" ToObjOcc.IdRef="ObjOcc.Done" Zorder="6">
          <Position Pos.X="290" Pos.Y="340"/>
          <Position Pos.X="290" Pos.Y="440"/>
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Done" ObjDef.IdRef="ObjDef.Done" SymbolNum="ST_EV" Zorder="3">
        <Position Pos.X="200" Pos.Y="440"/>
        <Size Size.dX="180" Size.dY="60"/>
      </ObjOcc>
    </Model>
  </Group>
</AML>
`

const BPMN_XML =
  '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">' +
  '<bpmn:process id="Legacy_Process" />' +
  '</bpmn:definitions>'

function fileSnapshot(path: string, text: string, mimeType = 'application/xml'): FileSnapshot {
  const bytes = new TextEncoder().encode(text)
  return {
    path,
    bytes,
    hash: `hash:${path}`,
    size: bytes.byteLength,
    modifiedAt: 0,
    mimeType
  }
}

function workspaceFile(path: string): WorkspaceEntry {
  const lastSlash = path.lastIndexOf('/')
  return {
    kind: 'file',
    name: path.split('/').pop() ?? path,
    path,
    parentPath: lastSlash === -1 ? '' : path.slice(0, lastSlash),
    readable: true
  }
}

function makeDirectoryAdapter(
  entries: readonly WorkspaceEntry[],
  snapshots: Record<string, FileSnapshot>
): WorkspaceAdapter {
  // A minimal in-memory multi-file store so the New-model create path can write
  // a real source (writeAtomic), have it appear in the tree (list) and be
  // reopened on the canvas (read) — the same round trip a real adapter makes.
  const entryList: WorkspaceEntry[] = [...entries]
  const snapshotStore: Record<string, FileSnapshot> = { ...snapshots }
  return {
    id: 'directory:AnimalWF',
    mode: 'directory',
    storage: {
      label: 'AnimalWF',
      capabilities: {
        multipleFiles: true,
        directories: true,
        rename: true,
        move: true,
        remove: true,
        directoryHandle: true,
        writable: false,
        durable: true,
        export: false,
        import: false,
        history: false,
        backup: false
      }
    },
    list: vi.fn(async () => [...entryList]),
    read: vi.fn(async (path: string) => {
      const snapshot = snapshotStore[path]
      if (!snapshot) throw new Error(`missing snapshot for ${path}`)
      return snapshot
    }),
    write: vi.fn(async () => {
      throw new Error('not implemented in test')
    }),
    writeAtomic: vi.fn(
      async (
        path: string,
        bytes: Uint8Array,
        _expectedHash?: string,
        options?: { expectedMissing?: boolean }
      ) => {
        const exists = entryList.some((entry) => entry.path === path)
        if (options?.expectedMissing && exists) {
          return { ok: false, status: 'external-conflict', reason: 'already-exists' }
        }
        const stored = new Uint8Array(bytes)
        const snapshot: FileSnapshot = {
          path,
          bytes: stored,
          hash: `hash:${path}`,
          size: stored.byteLength,
          modifiedAt: 0,
          mimeType: 'application/xml'
        }
        snapshotStore[path] = snapshot
        if (!exists) entryList.push(workspaceFile(path))
        return {
          ok: true,
          status: 'success',
          snapshot,
          created: !exists,
          disposition: 'workspace'
        }
      }
    ),
    delete: vi.fn(async () => undefined),
    move: vi.fn(async () => undefined),
    copy: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    stat: vi.fn(async () => null),
    exists: vi.fn(async () => false)
  } as unknown as WorkspaceAdapter
}

/**
 * The paths handed to a directory adapter's `writeAtomic` as creation-only
 * writes (bytes + `{ expectedMissing: true }`, no expected hash). Asserting on
 * the recorded call avoids `expect.any(Uint8Array)` realm quirks under jsdom.
 */
function creationWritePaths(adapter: WorkspaceAdapter): string[] {
  const spy = adapter.writeAtomic as unknown as { mock: { calls: unknown[][] } }
  return spy.mock.calls
    .filter(
      (call) =>
        ArrayBuffer.isView(call[1]) &&
        call[2] === undefined &&
        JSON.stringify(call[3]) === '{"expectedMissing":true}'
    )
    .map((call) => call[0] as string)
}

function xmlFile(name: string, xml: string): File {
  const file = new File([xml], name, { type: 'application/xml' })
  Object.defineProperty(file, 'arrayBuffer', {
    configurable: true,
    value: async () => new TextEncoder().encode(xml).buffer
  })
  return file
}

function openFileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    'input[accept=".bpmn,.aml,.apc,.xml,application/xml,text/xml"]'
  )
  if (!input) throw new Error('missing ARIS shell file input')
  return input
}

/**
 * jsdom performs no layout, so diagram-js would measure a 0×0 viewport and
 * divide by zero in `zoom`/`viewbox`. Giving every element a fixed box plus the
 * canvas lane's own SVG-geometry shim runs the *production* canvas code paths
 * rather than avoiding them.
 */
function installCanvasGeometry(): void {
  installJsdomSvgSupport()
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 1200
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 800
  })
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
    return {
      width: 1200,
      height: 800,
      top: 0,
      left: 0,
      right: 1200,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect
  }
}

/**
 * Every file the app handed to the browser's download surface.
 *
 * jsdom has no `URL.createObjectURL`, so without this the single-file adapter's
 * download sink would fail — which would hide, rather than prove, what a
 * portable flush writes.
 */
const downloads: { name: string; bytes: Uint8Array }[] = []

function installDownloadCapture(): void {
  downloads.length = 0
  const blobs: Blob[] = []
  Object.defineProperty(globalThis.URL, 'createObjectURL', {
    configurable: true,
    value: (blob: Blob) => {
      blobs.push(blob)
      return `blob:orbitpm-test-${blobs.length - 1}`
    }
  })
  Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
    configurable: true,
    value: () => undefined
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(
    this: HTMLAnchorElement
  ) {
    const blob = blobs[blobs.length - 1]
    if (!blob) return
    const name = this.download
    void blob
      .arrayBuffer()
      .then((buffer) => downloads.push({ name, bytes: new Uint8Array(buffer) }))
  })
}

/** The diagram-js group rendered for one ARIS id, or `null`. */
function canvasElement(id: string): SVGGElement | null {
  return document.querySelector<SVGGElement>(`[data-element-id="${CSS.escape(id)}"]`)
}

/** The `matrix(a,b,c,d,e,f)` translation diagram-js applied to a rendered element. */
function canvasTranslation(id: string): { x: number; y: number } | null {
  const transform = canvasElement(id)?.getAttribute('transform')
  if (!transform) return null
  const match = /matrix\(([^)]*)\)/u.exec(transform)
  if (!match) return null
  const parts = match[1].split(',').map(Number)
  return { x: parts[4], y: parts[5] }
}

async function openAml(name = 'animalwf.aml', xml = TWO_MODEL_AML): Promise<void> {
  fireEvent.change(openFileInput(), { target: { files: [xmlFile(name, xml)] } })
  await waitFor(() => expect(document.querySelector('[data-orbitpm-aris-canvas]')).not.toBeNull())
  await waitFor(() => expect(canvasElement('ObjOcc.Start')).not.toBeNull())
}

function detailsTab(name: string): HTMLElement {
  const rail = document.querySelector<HTMLElement>('[data-orbitpm-aris-details]')
  if (!rail) throw new Error('missing details rail')
  return within(rail).getByRole('tab', { name })
}

function detailsRevision(): number {
  const rail = document.querySelector<HTMLElement>('[data-orbitpm-aris-details]')
  if (!rail) throw new Error('missing details rail')
  const terms = Array.from(rail.querySelectorAll('dt'))
  const revisionTerm = terms.find((term) => term.textContent === 'Revision')
  if (!revisionTerm) throw new Error('missing revision row')
  return Number(revisionTerm.nextElementSibling?.textContent)
}

describe('ArisApp production shell', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('dir')
    document.documentElement.removeAttribute('lang')
    document.title = ''
    installCanvasGeometry()
    installDownloadCapture()
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: undefined
    })
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {}
    })
    mockState.directoryPickerSupported = false
    mockState.rememberedHandle = undefined
    mockState.ensurePermission = 'granted'
    mockState.directoryAdapter = null
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('rejects BPMN files at the top-level ARIS shell boundary', async () => {
    render(<ArisApp />)

    fireEvent.change(openFileInput(), { target: { files: [xmlFile('legacy.bpmn', BPMN_XML)] } })

    expect(
      await screen.findByText('This ARIS-only build accepts ARIS AML/XML exports.')
    ).not.toBeNull()
    // Non-destructive: no canvas was mounted, no tab was opened, and the
    // workspace picker is still the surface on screen.
    expect(document.querySelector('[data-orbitpm-aris-canvas]')).toBeNull()
    expect(screen.queryByRole('tab', { name: 'legacy.bpmn' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open file…' })).not.toBeNull()
  })

  it('renders an opened AML export on the real ARIS canvas at its imported coordinates', async () => {
    render(<ArisApp />)
    await openAml()

    expect(screen.getByRole('tab', { name: 'animalwf.aml' })).not.toBeNull()

    // Every occurrence and connection of the first model is a real diagram-js
    // element, and Source Layout means the imported Position/Size verbatim.
    expect(canvasTranslation('ObjOcc.Start')).toEqual({ x: 200, y: 100 })
    expect(canvasTranslation('ObjOcc.Check')).toEqual({ x: 200, y: 260 })
    expect(canvasTranslation('ObjOcc.Done')).toEqual({ x: 200, y: 440 })
    expect(canvasElement('CxnOcc.1')).not.toBeNull()
    expect(canvasElement('CxnOcc.2')).not.toBeNull()

    // The second model's occurrence belongs to another model and must not be
    // on the canvas until the user switches to it.
    expect(canvasElement('ObjOcc.Review')).toBeNull()

    // The Phase 2 source facts survive alongside the canvas. ("Models" appears
    // twice now: once as the explorer heading, once as the source-fact label.)
    expect(screen.getAllByText('Models').length).toBeGreaterThan(1)
    expect(screen.getByText('Object occurrences')).not.toBeNull()
    expect(screen.getByText('Semantic diagnostics')).not.toBeNull()

    // Complete source accounting is wired, not stubbed.
    const accounting = document.querySelector<HTMLElement>('[data-orbitpm-aris-accounting]')
    expect(accounting).not.toBeNull()
    expect(accounting?.textContent).toContain('unaccounted')
  })

  it('switches between the models of one export through the model explorer', async () => {
    render(<ArisApp />)
    await openAml()

    const explorer = document.querySelector<HTMLElement>('[data-orbitpm-aris-model-explorer]')
    expect(explorer).not.toBeNull()
    const modelButtons = within(explorer!).getAllByRole('button')
    expect(modelButtons.map((button) => button.getAttribute('data-orbitpm-aris-model'))).toEqual([
      'Model.Intake',
      'Model.Review'
    ])

    fireEvent.click(within(explorer!).getByText('Review process'))

    await waitFor(() => expect(canvasElement('ObjOcc.Review')).not.toBeNull())
    expect(canvasTranslation('ObjOcc.Review')).toEqual({ x: 640, y: 120 })
    // The previous model's elements are gone, not merely hidden.
    expect(canvasElement('ObjOcc.Start')).toBeNull()

    fireEvent.click(within(explorer!).getByText('Intake process'))
    await waitFor(() => expect(canvasElement('ObjOcc.Start')).not.toBeNull())
    expect(canvasTranslation('ObjOcc.Start')).toEqual({ x: 200, y: 100 })
  })

  it('round-trips undo and redo through the ARIS command stack from the toolbar', async () => {
    render(<ArisApp />)
    await openAml()

    // Select something so the details rail (and its History tab, which reads
    // the ARIS working document's revision) has an element to describe.
    fireEvent.click(
      within(document.querySelector<HTMLElement>('[data-orbitpm-aris-accounting]')!).getByRole(
        'button',
        { name: 'Select ObjOcc.Start on the canvas' }
      )
    )
    await waitFor(() => expect(detailsTab('History')).not.toBeNull())
    fireEvent.click(detailsTab('History'))

    const sourceRevision = detailsRevision()
    const sourcePosition = canvasTranslation('ObjOcc.Check')
    expect(sourcePosition).toEqual({ x: 200, y: 260 })

    const undoButton = document.querySelector<HTMLButtonElement>('[data-orbitpm-aris-undo]')!
    const redoButton = document.querySelector<HTMLButtonElement>('[data-orbitpm-aris-redo]')!
    expect(undoButton.disabled).toBe(true)
    expect(redoButton.disabled).toBe(true)

    // Clean Layout is `src/aris/layout` applied through the canvas's documented
    // one-call seam, i.e. one undoable run of ARIS commands.
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-orbitpm-aris-clean-layout]')!)

    await waitFor(() => expect(undoButton.disabled).toBe(false))
    const cleanRevision = detailsRevision()
    expect(cleanRevision).toBeGreaterThan(sourceRevision)
    const cleanPosition = canvasTranslation('ObjOcc.Check')
    expect(cleanPosition).not.toEqual(sourcePosition)
    expect(document.querySelector('[data-orbitpm-aris-layout-mode="clean"]')).not.toBeNull()

    fireEvent.click(undoButton)

    // Undo restores the working document, the revision and the geometry.
    await waitFor(() => expect(canvasTranslation('ObjOcc.Check')).toEqual(sourcePosition))
    expect(detailsRevision()).toBe(sourceRevision)
    expect(redoButton.disabled).toBe(false)

    fireEvent.click(redoButton)

    await waitFor(() => expect(canvasTranslation('ObjOcc.Check')).toEqual(cleanPosition))
    expect(detailsRevision()).toBe(cleanRevision)
  })

  it('restores the imported geometry with Reset to Source Layout', async () => {
    render(<ArisApp />)
    await openAml()

    const source = canvasTranslation('ObjOcc.Check')
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-orbitpm-aris-clean-layout]')!)
    await waitFor(() => expect(canvasTranslation('ObjOcc.Check')).not.toEqual(source))

    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-orbitpm-aris-reset-layout]')!)

    await waitFor(() => expect(canvasTranslation('ObjOcc.Check')).toEqual(source))
    expect(canvasTranslation('ObjOcc.Start')).toEqual({ x: 200, y: 100 })
    expect(document.querySelector('[data-orbitpm-aris-layout-mode="source"]')).not.toBeNull()
  })

  it('selects the canvas element behind an accounting row and highlights its relations', async () => {
    render(<ArisApp />)
    await openAml()

    const accounting = document.querySelector<HTMLElement>('[data-orbitpm-aris-accounting]')!
    fireEvent.click(
      within(accounting).getByRole('button', { name: 'Select ObjOcc.Check on the canvas' })
    )

    // Plan 11.5: the selected occurrence is marked as the highlight owner and
    // both of its typed relations are highlighted.
    await waitFor(() =>
      expect(canvasElement('ObjOcc.Check')?.classList.contains('aris-highlight-owner')).toBe(true)
    )
    expect(canvasElement('CxnOcc.1')?.classList.contains('aris-highlight')).toBe(true)
    expect(canvasElement('CxnOcc.2')?.classList.contains('aris-highlight')).toBe(true)
    expect(canvasElement('ObjOcc.Start')?.classList.contains('aris-highlight')).toBe(true)

    // The details rail follows the same selection.
    const details = document.querySelector<HTMLElement>('[data-orbitpm-aris-details]')!
    expect(details.getAttribute('aria-label')).toContain('Check request')

    // Plan 13.1: the default metadata layers are live, with real counts drawn
    // from the details lane's satellite classification.
    const layers = document.querySelector<HTMLElement>('[data-orbitpm-aris-metadata-layers]')
    expect(layers).not.toBeNull()
    expect(within(layers!).getByText('Owner')).not.toBeNull()
  })

  it('keeps AI, settings and assistant surfaces wired next to the mounted canvas', async () => {
    render(<ArisApp />)
    await openAml()

    expect(
      screen.getByText(
        'Generate a native ARIS model — an EPC or a value-added chain diagram — from a plain-language description, a document, or the Excel template.'
      )
    ).not.toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: /Settings/ })[0]!)
    expect(await screen.findByText('mock-settings-dialog')).not.toBeNull()

    // The header Assistant button opens the process-assistant chat drawer, whose
    // library tab is present on open.
    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }))
    const drawer = await screen.findByRole('dialog', { name: 'Process assistant' })
    expect(within(drawer).getByRole('tab', { name: 'Ask the library' })).not.toBeNull()
  })

  it('rejects BPMN entries surfaced through remembered directory workspace browsing while still opening AML peers', async () => {
    const disguisedBpmnXml =
      '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"><process id="P" /></definitions>'
    mockState.directoryPickerSupported = true
    mockState.rememberedHandle = { name: 'AnimalWF' } as FileSystemDirectoryHandle
    mockState.directoryAdapter = makeDirectoryAdapter(
      [
        workspaceFile('legacy/process.bpmn'),
        workspaceFile('legacy/camouflaged.xml'),
        workspaceFile('legacy/process.aml')
      ],
      {
        'legacy/camouflaged.xml': fileSnapshot('legacy/camouflaged.xml', disguisedBpmnXml),
        'legacy/process.aml': fileSnapshot('legacy/process.aml', TWO_MODEL_AML)
      }
    )

    render(<ArisApp />)

    // The flat pills are gone: the three files live under a synthesized `legacy`
    // folder in the tree, which must be expanded before its files are clickable.
    fireEvent.click(await screen.findByRole('treeitem', { name: 'legacy' }))

    fireEvent.click(await screen.findByRole('treeitem', { name: 'process.bpmn' }))
    expect(
      await screen.findByText('This ARIS-only build accepts ARIS AML/XML exports.')
    ).not.toBeNull()
    expect(screen.queryByRole('tab', { name: 'process.bpmn' })).toBeNull()
    expect(document.querySelector('[data-orbitpm-aris-canvas]')).toBeNull()

    fireEvent.click(screen.getByRole('treeitem', { name: 'camouflaged.xml' }))
    expect(screen.queryByRole('tab', { name: 'camouflaged.xml' })).toBeNull()
    expect(document.querySelector('[data-orbitpm-aris-canvas]')).toBeNull()

    fireEvent.click(screen.getByRole('treeitem', { name: 'process.aml' }))
    expect(await screen.findByRole('tab', { name: 'process.aml' })).not.toBeNull()
    await waitFor(() => expect(canvasElement('ObjOcc.Start')).not.toBeNull())
  })

  it('renders the workspace as a folder tree with folders before files and .orbitpm hidden', async () => {
    mockState.directoryPickerSupported = true
    mockState.rememberedHandle = { name: 'AnimalWF' } as FileSystemDirectoryHandle
    mockState.directoryAdapter = makeDirectoryAdapter(
      [
        workspaceFile('zulu.aml'),
        workspaceFile('alpha/first.aml'),
        workspaceFile('.orbitpm/aris/x/manifest.json')
      ],
      {}
    )

    render(<ArisApp />)

    // The reserved .orbitpm subtree is never surfaced as a tree row.
    await waitFor(() => expect(screen.queryByRole('treeitem', { name: 'alpha' })).not.toBeNull())
    expect(screen.queryByRole('treeitem', { name: 'manifest.json' })).toBeNull()
    expect(screen.queryByRole('treeitem', { name: 'aris' })).toBeNull()

    // Folders sort ahead of files at the workspace root.
    const rootRows = screen.getAllByRole('treeitem').map((row) => row.getAttribute('aria-label'))
    expect(rootRows.indexOf('alpha')).toBeLessThan(rootRows.indexOf('zulu.aml'))
  })

  it('keeps accepting AML files during mixed import batches after rejecting BPMN files', async () => {
    render(<ArisApp />)

    const [openInput] = document.querySelectorAll<HTMLInputElement>(
      'input[accept=".bpmn,.aml,.apc,.xml,application/xml,text/xml"]'
    )
    if (!openInput) throw new Error('missing ARIS shell open-file input')

    fireEvent.change(openInput, {
      target: { files: [xmlFile('seed.aml', '<AML><Header-Info DatabaseName="Seed" /></AML>')] }
    })
    expect(await screen.findByRole('tab', { name: 'seed.aml' })).not.toBeNull()

    const importInput = document.querySelectorAll<HTMLInputElement>(
      'input[accept=".bpmn,.aml,.apc,.xml,application/xml,text/xml"]'
    )[1]
    if (!importInput) throw new Error('missing ARIS shell import input')

    fireEvent.change(importInput, {
      target: {
        files: [xmlFile('legacy.bpmn', BPMN_XML), xmlFile('accepted.aml', TWO_MODEL_AML)]
      }
    })

    expect(
      await screen.findByText('This ARIS-only build accepts ARIS AML/XML exports.')
    ).not.toBeNull()
    expect(await screen.findByRole('tab', { name: 'accepted.aml' })).not.toBeNull()
    expect(screen.queryByRole('tab', { name: 'legacy.bpmn' })).toBeNull()
    await waitFor(() => expect(canvasElement('ObjOcc.Start')).not.toBeNull())
  })

  it('shows an explicit empty canvas for an AML source that carries no model records', async () => {
    render(<ArisApp />)

    fireEvent.change(openFileInput(), {
      target: { files: [xmlFile('empty.aml', '<AML><Header-Info DatabaseName="Seed" /></AML>')] }
    })

    expect(await screen.findByRole('tab', { name: 'empty.aml' })).not.toBeNull()
    await waitFor(() =>
      expect(document.querySelector('[data-orbitpm-aris-canvas-empty]')).not.toBeNull()
    )
    expect(document.querySelector('[data-orbitpm-aris-model-explorer]')).toBeNull()
  })

  it('shows the §7.3 review before committing an import and writes nothing when it is cancelled', async () => {
    render(<ArisApp />)
    await openAml()

    fireEvent.click(
      document.querySelector<HTMLButtonElement>('[data-orbitpm-aris-import-package]')!
    )

    const dialog = await screen.findByRole('dialog', { name: 'Review this import' })
    // The review carries the exact digests, member list and fidelity summary the
    // commit will later be checked against.
    expect(within(dialog).getByText('animalwf.aml')).not.toBeNull()
    expect(within(dialog).getByText(/\/original\/source\.xml$/u)).not.toBeNull()
    expect(within(dialog).getByText(/\/manifest\.json$/u)).not.toBeNull()
    expect(within(dialog).getByText(/2 models/u)).not.toBeNull()
    expect(within(dialog).getByText(/0 unaccounted/u)).not.toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Review this import' })).toBeNull()
    )
    expect(downloads).toHaveLength(0)
  })

  it('commits a portable single-file import without overwriting the opened source', async () => {
    render(<ArisApp />)
    await openAml()

    fireEvent.click(
      document.querySelector<HTMLButtonElement>('[data-orbitpm-aris-import-package]')!
    )
    const dialog = await screen.findByRole('dialog', { name: 'Review this import' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Commit import' }))

    // Portable mode (plan §2.5): the package tree is flushed as one container
    // written to a *sibling* file, so the imported AML is never replaced.
    expect(
      await screen.findByText(
        'Imported animalwf.aml; the portable workspace container was downloaded rather than written in place.'
      )
    ).not.toBeNull()
    await waitFor(() => expect(downloads).toHaveLength(1))
    expect(downloads[0]?.name).toBe('animalwf.orbitpm-aris.json')
    const container = JSON.parse(new TextDecoder().decode(downloads[0]!.bytes)) as {
      format: string
      packages: { members: { path: string }[] }[]
    }
    expect(container.format).toBe('orbitpm-aris-portable-package')
    expect(container.packages).toHaveLength(1)
    expect(container.packages[0]?.members.map((member) => member.path)).toContain(
      'original/source.xml'
    )
  })

  it('dismisses a toast by clicking it, proving the toast id round-trips through onDismiss', async () => {
    render(<ArisApp />)

    // ArisApp mints toast ids with crypto.randomUUID() (a string), so this
    // exercises the exact `Toaster<string>` / `dismissToast: (id: string) =>
    // void` pairing the ToastMsg.id type contract fix depends on: if the
    // dismiss handler ever mismatched the id type again, the click below
    // would silently fail to remove the toast (`!==` between a string and a
    // number is always true) and this test would time out.
    fireEvent.change(openFileInput(), { target: { files: [xmlFile('legacy.bpmn', BPMN_XML)] } })

    const toastText = await screen.findByText('This ARIS-only build accepts ARIS AML/XML exports.')
    const toast = toastText.closest('[role="status"], [role="alert"]')
    if (!toast) throw new Error('missing rendered toast container')

    fireEvent.click(toast)

    await waitFor(() =>
      expect(screen.queryByText('This ARIS-only build accepts ARIS AML/XML exports.')).toBeNull()
    )
  })

  // --- integration wave 2 -------------------------------------------------

  it('exports a derived AML that is byte-identical to the untouched original, then carries the clean layout', async () => {
    render(<ArisApp />)
    await openAml('nested.aml', NESTED_CXNDEF_AML)

    const exportButton = document.querySelector<HTMLButtonElement>(
      '[data-orbitpm-aris-export-derived]'
    )!
    // Plan 9.5 fixes this wording until a live ARIS test passes.
    expect(exportButton.textContent).toBe('Experimental ARIS AML export')

    fireEvent.click(exportButton)
    await waitFor(() =>
      expect(downloads.some((file) => file.name.endsWith('.derived.aml'))).toBe(true)
    )

    const first = downloads.find((file) => file.name.endsWith('.derived.aml'))!
    expect(first.name).toBe('nested.derived.aml')
    // An export with an empty edit set copies every byte verbatim: the original
    // is read, never written (plan 9.6 "original source is unchanged").
    expect(new TextDecoder().decode(first.bytes)).toBe(NESTED_CXNDEF_AML)

    // Clean Layout moves occurrences, so the derived document must now differ —
    // and only in geometry, since nothing else was addressed.
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-orbitpm-aris-clean-layout]')!)
    await waitFor(() => expect(canvasTranslation('ObjOcc.Check')).not.toEqual({ x: 200, y: 260 }))

    downloads.length = 0
    fireEvent.click(exportButton)
    await waitFor(() =>
      expect(downloads.some((file) => file.name.endsWith('.derived.aml'))).toBe(true)
    )
    const derivedText = new TextDecoder().decode(
      downloads.find((file) => file.name.endsWith('.derived.aml'))!.bytes
    )
    expect(derivedText).not.toBe(NESTED_CXNDEF_AML)
    // Every byte nobody addressed survived: the header, the ids and the
    // attribute order are all still exactly as imported.
    expect(derivedText).toContain(
      '<Header-Info DatabaseName="AnimalWF" UserName="tester" ArisExeVersion="10"/>'
    )
    expect(derivedText).toContain('ObjDef.ID="ObjDef.Start"')
    expect(derivedText).toContain('CxnDef.ID="CxnDef.1" CxnDef.Type="CT_ACTIV_1"')

    // Downloading the source still yields the original bytes, unchanged.
    downloads.length = 0
    fireEvent.click(screen.getByRole('button', { name: 'Download exact source' }))
    await waitFor(() => expect(downloads.length).toBe(1))
    expect(new TextDecoder().decode(downloads[0]!.bytes)).toBe(NESTED_CXNDEF_AML)
  })

  it('refuses the derived export when a section 9.3 check fails, and downloads nothing', async () => {
    render(<ArisApp />)
    await openAml()

    // This fixture keeps its connection definitions as group-level siblings, so
    // none of them has a source endpoint — `connection-endpoints-exist` fails and
    // `exportDerivedAml` must refuse rather than hand the user unusable bytes.
    fireEvent.click(
      document.querySelector<HTMLButtonElement>('[data-orbitpm-aris-export-derived]')!
    )

    const toast = await screen.findByText(/The derived export was refused/u)
    expect(toast.textContent).toContain('connection-endpoints-exist')
    expect(downloads.some((file) => file.name.endsWith('.derived.aml'))).toBe(false)
  })

  it('lists EPC validation findings and selects the offending model, switching models when needed', async () => {
    render(<ArisApp />)
    await openAml()

    const rail = document.querySelector<HTMLElement>('[data-orbitpm-aris-epc]')!
    // Model.Review holds one unconnected function, so it has neither a start
    // event nor an end event (plan 14.1, `checkStartEndCompleteness`).
    await waitFor(() =>
      expect(rail.querySelectorAll('[data-orbitpm-aris-epc-finding]').length).toBeGreaterThan(0)
    )
    const missingStart = rail.querySelector<HTMLButtonElement>(
      '[data-orbitpm-aris-epc-finding="epc.startEnd.missingStart"]'
    )
    expect(missingStart).not.toBeNull()
    // The finding is rendered from its i18n key, never from prose in the module.
    expect(missingStart!.textContent).toContain('This model has no start event.')
    // A model-scoped finding names no shape, so it reveals its model.
    expect(missingStart!.getAttribute('aria-label')).toBe('Select Model.Review on the canvas')

    // Model.Intake is a valid event/function/event chain, so it contributes none.
    expect(rail.querySelectorAll('[data-orbitpm-aris-epc-finding="epc.alternation"]').length).toBe(
      0
    )

    fireEvent.click(missingStart!)

    // Revealing it switched the canvas to the other model.
    await waitFor(() => expect(canvasElement('ObjOcc.Review')).not.toBeNull())
    expect(canvasElement('ObjOcc.Start')).toBeNull()
  })

  it('answers a folder question with no provider and no key, and its chip selects the model', async () => {
    render(<ArisApp />)
    await openAml()

    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }))
    const panel = await screen.findByRole('button', { name: 'Which processes are available?' })
    fireEvent.click(panel)

    const answer = await waitFor(() => {
      const node = document.querySelector<HTMLElement>('[data-orbitpm-aris-assistant-answer]')
      if (!node) throw new Error('no answer rendered')
      return node
    })
    // Section 17.4 answer data, resolved by the assistant lane's own dictionary.
    expect(answer.textContent).toContain('Available processes:')

    const chip = answer.querySelector<HTMLButtonElement>('[data-orbitpm-aris-assistant-chip]')
    expect(chip).not.toBeNull()
    fireEvent.click(chip!)

    // Section 17.6: the chip selected a real ARIS element on the canvas.
    await waitFor(() =>
      expect(document.querySelector('[data-orbitpm-aris-assistant-answer]')).toBeNull()
    )
    expect(document.querySelector('[data-orbitpm-aris-canvas]')).not.toBeNull()
  })

  it('downloads the deterministic ARIS Excel templates from the single HTML', async () => {
    render(<ArisApp />)
    await openAml()

    fireEvent.click(
      document.querySelector<HTMLButtonElement>('[data-orbitpm-aris-create-excel-tab]')!
    )
    fireEvent.click(
      document.querySelector<HTMLButtonElement>('[data-orbitpm-aris-template-blank]')!
    )
    await waitFor(() => expect(downloads.some((file) => file.name.endsWith('.xlsx'))).toBe(true))

    const blank = downloads.find((file) => file.name.endsWith('.xlsx'))!
    // A real ZIP container, not a stub.
    expect(Array.from(blank.bytes.slice(0, 2))).toEqual([0x50, 0x4b])

    downloads.length = 0
    fireEvent.click(
      document.querySelector<HTMLButtonElement>('[data-orbitpm-aris-template-example]')!
    )
    await waitFor(() => expect(downloads.length).toBe(1))
    expect(downloads[0]!.name).not.toBe(blank.name)
  })

  it('completes a missing field through the chat interview, atomically and undoably', async () => {
    render(<ArisApp />)
    await openAml()

    // The interview now lives in the chat drawer: open the assistant and switch
    // to the 'Complete this process' tab so the interview surface is mounted.
    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Complete this process' }))

    const rail = await waitFor(() => {
      const node = document.querySelector<HTMLElement>('[data-orbitpm-aris-chat]')
      if (!node) throw new Error('no chat drawer interview surface')
      return node
    })
    // Plan 18.1: the deterministic gap scanner runs on the live document.
    await waitFor(() =>
      expect(rail.querySelectorAll('[data-orbitpm-aris-chat-gaps] li').length).toBeGreaterThan(0)
    )

    fireEvent.click(rail.querySelector<HTMLButtonElement>('[data-orbitpm-aris-chat-start]')!)
    const questions = await waitFor(() => {
      const found = rail.querySelectorAll<HTMLElement>('[data-orbitpm-aris-chat-question]')
      if (found.length === 0) throw new Error('no interview questions')
      return found
    })
    expect(questions.length).toBeLessThanOrEqual(3)

    let answered = 0
    questions.forEach((question) => {
      const input = question.querySelector<HTMLInputElement>('input:not([type="checkbox"])')
      if (!input) return
      answered += 1
      fireEvent.change(input, { target: { value: `Reviewed value ${answered}` } })
    })
    expect(answered).toBeGreaterThan(0)

    fireEvent.click(rail.querySelector<HTMLButtonElement>('[data-orbitpm-aris-chat-submit]')!)

    // Plan 18.5: the safe batch applied atomically and produced a receipt.
    await waitFor(() =>
      expect(rail.querySelectorAll('[data-orbitpm-aris-chat-receipts] li').length).toBe(answered)
    )
    // Plan 18.5 step 7 / 18.8: one Undo restores the prior revision.
    const undoButton = document.querySelector<HTMLButtonElement>('[data-orbitpm-aris-undo]')!
    expect(undoButton.disabled).toBe(false)
  })

  // --- New model (Lane L2d) --------------------------------------------------

  it('writes a blank model into the directory workspace, opens it on the canvas and shows the empty hint', async () => {
    const adapter = makeDirectoryAdapter([], {})
    mockState.directoryPickerSupported = true
    mockState.rememberedHandle = { name: 'AnimalWF' } as FileSystemDirectoryHandle
    mockState.directoryAdapter = adapter

    render(<ArisApp />)

    // Wait for the directory workspace to bind (the ready shell's header button)
    // so the explorer chrome — not the picker's own New-model action — is clicked.
    await screen.findByRole('button', { name: 'Assistant' })
    fireEvent.click(await screen.findByRole('button', { name: '＋ New model' }))
    const dialog = await screen.findByRole('dialog', { name: 'New ARIS model' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Intake' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create model' }))

    // §L2d: a real .aml source is created with a creation-only atomic write.
    await waitFor(() => expect(creationWritePaths(adapter)).toContain('intake.aml'))

    // The tree gains the new source, a tab opens, the canvas mounts and the
    // empty-model hint invites the first shape.
    expect(await screen.findByRole('treeitem', { name: 'intake.aml' })).not.toBeNull()
    expect(await screen.findByRole('tab', { name: 'intake.aml' })).not.toBeNull()
    await waitFor(() => expect(document.querySelector('[data-orbitpm-aris-canvas]')).not.toBeNull())
    await waitFor(() =>
      expect(document.querySelector('[data-orbitpm-aris-empty-hint]')).not.toBeNull()
    )
  })

  it('opens a blank model as an in-memory tab in the picker phase (no workspace bound)', async () => {
    render(<ArisApp />)

    // Default mock state: no directory picker, so the fallback picker offers the
    // named New-model action.
    fireEvent.click(await screen.findByRole('button', { name: '＋ New model' }))
    const dialog = await screen.findByRole('dialog', { name: 'New ARIS model' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Intake' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create model' }))

    expect(await screen.findByRole('tab', { name: 'intake.aml' })).not.toBeNull()
    await waitFor(() => expect(document.querySelector('[data-orbitpm-aris-canvas]')).not.toBeNull())
  })

  it('suffixes a colliding file name so a second blank model never overwrites the first', async () => {
    const adapter = makeDirectoryAdapter([workspaceFile('intake.aml')], {})
    mockState.directoryPickerSupported = true
    mockState.rememberedHandle = { name: 'AnimalWF' } as FileSystemDirectoryHandle
    mockState.directoryAdapter = adapter

    render(<ArisApp />)

    // Wait for the seeded source to reach the tree before creating.
    expect(await screen.findByRole('treeitem', { name: 'intake.aml' })).not.toBeNull()

    fireEvent.click(await screen.findByRole('button', { name: '＋ New model' }))
    const dialog = await screen.findByRole('dialog', { name: 'New ARIS model' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Intake' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create model' }))

    // The slug already exists, so the create suffixes rather than overwrites.
    await waitFor(() => expect(creationWritePaths(adapter)).toContain('intake-2.aml'))
    expect(creationWritePaths(adapter)).not.toContain('intake.aml')
    expect(await screen.findByRole('treeitem', { name: 'intake-2.aml' })).not.toBeNull()
  })
})

describe('downloadBytes', () => {
  afterEach(() => {
    cleanup()
  })

  it('produces a Blob with the exact byte length of the source bytes, including SharedArrayBuffer-backed input', () => {
    // The source `bytes` parameter is typed plain `Uint8Array` (no pinned
    // `ArrayBuffer` type argument), so a caller could in principle hand it a
    // SharedArrayBuffer-backed view — exactly the case TS 5.7's stricter
    // `BlobPart` type rejects at compile time. Constructing one directly here
    // proves the runtime fix (`bytes.slice()`) produces a correct,
    // exact-length Blob regardless of the backing buffer type.
    const bytes = new Uint8Array(new SharedArrayBuffer(5))
    bytes.set([1, 2, 3, 4, 5])

    // A plain `let` mutated only from inside the `createObjectURL` callback
    // below defeats TypeScript's narrowing (it never observes the closure's
    // assignment in this function's direct control flow, so it treats the
    // variable as permanently `null`); capturing it as an object property
    // sidesteps that and keeps the type honestly `Blob | null` at the read.
    const captured: { blob: Blob | null } = { blob: null }
    Object.defineProperty(globalThis.URL, 'createObjectURL', {
      configurable: true,
      value: (blob: Blob) => {
        captured.blob = blob
        return 'blob:orbitpm-test'
      }
    })
    Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
      configurable: true,
      value: () => undefined
    })
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    downloadBytes('source.xml', bytes)

    expect(captured.blob).not.toBeNull()
    expect(captured.blob?.size).toBe(bytes.byteLength)

    clickSpy.mockRestore()
  })
})

describe('ArisGenerationPanel — create with AI (plan section 16)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  function renderPanel(
    reply: string,
    created: { name: string; xml: string }[]
  ): { calls: { system: string; user: string }[] } {
    const calls: { system: string; user: string }[] = []
    render(
      <ArisGenerationPanel
        onCreateModel={(input) => {
          created.push(input)
        }}
        onDownloadFile={() => undefined}
        onOpenAssistant={() => undefined}
        onOpenSettings={() => undefined}
        callProvider={(prompt) => {
          calls.push(prompt)
          return Promise.resolve(reply)
        }}
      />
    )
    return { calls }
  }

  function fillAndSubmit(): void {
    const description = document.querySelector<HTMLTextAreaElement>(
      '[data-orbitpm-aris-create] textarea'
    )!
    fireEvent.change(description, {
      target: { value: 'A request is received, an officer checks it, the request is checked.' }
    })
    // The consent checkbox was removed from the Generate-with-AI create path
    // (authorized product change); description + submit is the whole flow now.
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-orbitpm-aris-create-submit]')!)
  }

  it('turns a valid ArisAiDraftV1 into canonical AML, never asking the model for AML', async () => {
    const created: { name: string; xml: string }[] = []
    const { calls } = renderPanel(JSON.stringify(buildMinimalValidDraft()), created)

    fillAndSubmit()

    await waitFor(() => expect(created.length).toBe(1))
    // Section 16.5: the prompt forbids AML/XML/ids/coordinates outright, and the
    // request that actually went out is the one the user could review.
    expect(calls.length).toBe(1)
    expect(calls[0]!.system).toContain('Use logical ids only.')
    expect(calls[0]!.system).toContain('strict JSON only')
    // The only mention of AML is the instruction never to emit it.
    expect(calls[0]!.system).toContain(
      'Never emit a real ARIS source id, raw AML, raw XML, coordinates'
    )

    // The AML is built locally, from the draft's logical ids.
    const xml = created[0]!.xml
    expect(xml).toContain('Model.Type="MT_EEPC"')
    expect(xml).toContain('ObjDef.ID="ObjDef.evt-start"')
    expect(xml).toContain('ObjOcc.ID="ObjOcc.evt-start"')
    // Coordinates never came from the model — they are shell-generated.
    expect(xml).toContain('<Position Pos.X="240"')
  })

  it("surfaces the validator's rejections verbatim and creates nothing", async () => {
    const created: { name: string; xml: string }[] = []
    const draft = buildMinimalValidDraft()
    const poisoned = {
      ...draft,
      objects: draft.objects.map((object, index) =>
        index === 0
          ? { ...object, names: { en: '<AML><ObjDef ObjDef.ID="ObjDef.real"/></AML>' } }
          : object
      )
    }
    const { calls } = renderPanel(JSON.stringify(poisoned), created)

    fillAndSubmit()

    const rejections = await waitFor(() => {
      const node = document.querySelector<HTMLElement>('[data-orbitpm-aris-create-rejections]')
      if (!node) throw new Error('no rejections rendered')
      return node
    })
    expect(rejections.querySelectorAll('li').length).toBeGreaterThan(0)
    expect(rejections.textContent).toContain('forbidden')
    expect(created.length).toBe(0)
    // Section 16.6 step 10: an invalid draft earns up to three semantic repair
    // turns (first attempt + three repairs = four requests) before the run is
    // abandoned. A provider that keeps returning the same forbidden content
    // exhausts them and still creates nothing.
    expect(calls.length).toBe(4)
    expect(
      screen.getByText(
        'The provider still returned an invalid draft after 3 repair turns; nothing was created.'
      )
    ).not.toBeNull()
  })
})

describe('ArisGenerationPanel — create from the ARIS workbook (plan section 15)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  function xlsxFile(name: string, bytes: Uint8Array): File {
    const file = new File([bytes.slice()], name, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: async () => bytes.slice().buffer
    })
    return file
  }

  function renderExcelTab(created: { name: string; xml: string }[]): HTMLInputElement {
    render(
      <ArisGenerationPanel
        onCreateModel={(input) => {
          created.push(input)
        }}
        onDownloadFile={() => undefined}
        onOpenAssistant={() => undefined}
        onOpenSettings={() => undefined}
      />
    )
    fireEvent.click(
      document.querySelector<HTMLButtonElement>('[data-orbitpm-aris-create-excel-tab]')!
    )
    return document.querySelector<HTMLInputElement>('input[accept=".xlsx"]')!
  }

  it('creates native AML from a filled-in ARIS workbook with no AI at all', async () => {
    const created: { name: string; xml: string }[] = []
    const input = renderExcelTab(created)

    fireEvent.change(input, {
      target: { files: [xlsxFile('process.xlsx', buildValidFixtureWorkbook())] }
    })

    await waitFor(() => expect(created.length).toBe(1))
    expect(created[0]!.name).toBe('process')
    const xml = created[0]!.xml
    expect(xml).toContain('<AML>')
    expect(xml).toContain('Model.Type="MT_EEPC"')
    // Section 15.6: object DEFINITIONS are shared, occurrences are per-model.
    expect(xml).toContain('ObjDef.ID="ObjDef.')
    expect(xml).toContain('ObjOcc.ID="ObjOcc.')
  })

  it('rejects the retired BPMN 0.4.5 workbook with migration guidance instead of treating it as ARIS', async () => {
    const created: { name: string; xml: string }[] = []
    const input = renderExcelTab(created)

    fireEvent.change(input, {
      target: { files: [xlsxFile('legacy.xlsx', buildLegacyBpmnWorkbook())] }
    })

    const issues = await waitFor(() => {
      const node = document.querySelector<HTMLElement>('[data-orbitpm-aris-excel-issues]')
      if (!node) throw new Error('no issues rendered')
      return node
    })
    expect(created.length).toBe(0)
    expect(
      screen.getByText(
        'That is the retired BPMN 0.4.5 workbook. Download the ARIS template below and re-enter the process there.'
      )
    ).not.toBeNull()
    expect(issues.textContent).toContain(
      'The workbook was rejected because it is a legacy BPMN workbook, which this ARIS-only build does not accept.'
    )
  })
})

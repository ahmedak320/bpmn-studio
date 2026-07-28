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
  return {
    id: 'directory:AnimalWF',
    mode: 'directory',
    storage: {
      label: 'AnimalWF',
      capabilities: {
        multipleFiles: true,
        directoryHandle: true,
        writable: false,
        durable: true,
        export: false,
        import: false,
        history: false,
        backup: false
      }
    },
    list: vi.fn(async () => [...entries]),
    read: vi.fn(async (path: string) => {
      const snapshot = snapshots[path]
      if (!snapshot) throw new Error(`missing snapshot for ${path}`)
      return snapshot
    }),
    write: vi.fn(async () => {
      throw new Error('not implemented in test')
    }),
    writeAtomic: vi.fn(async () => {
      throw new Error('not implemented in test')
    }),
    delete: vi.fn(async () => undefined),
    move: vi.fn(async () => undefined),
    copy: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    stat: vi.fn(async () => null),
    exists: vi.fn(async () => false)
  } as unknown as WorkspaceAdapter
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

    expect(await screen.findByText('This ARIS-only build accepts ARIS AML/XML exports.')).not.toBeNull()
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
    expect(
      document.querySelector('[data-orbitpm-aris-layout-mode="clean"]')
    ).not.toBeNull()

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
        'Create a reviewed ARIS placeholder source from a description while the ARIS-native generation pipeline is being rebuilt.'
      )
    ).not.toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: /Settings/ })[0]!)
    expect(await screen.findByText('mock-settings-dialog')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }))
    await waitFor(() =>
      expect(
        screen.getByText(
          'The ARIS assistant surface stays available in Phase 2 while BPMN-specific retrieval and interview flows are removed from the shipped artifact.'
        )
      ).not.toBeNull()
    )
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

    fireEvent.click(await screen.findByRole('button', { name: /legacy\/process\.bpmn/i }))
    expect(await screen.findByText('This ARIS-only build accepts ARIS AML/XML exports.')).not.toBeNull()
    expect(screen.queryByRole('tab', { name: 'process.bpmn' })).toBeNull()
    expect(document.querySelector('[data-orbitpm-aris-canvas]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /legacy\/camouflaged\.xml/i }))
    expect(screen.queryByRole('tab', { name: 'camouflaged.xml' })).toBeNull()
    expect(document.querySelector('[data-orbitpm-aris-canvas]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /legacy\/process\.aml/i }))
    expect(await screen.findByRole('tab', { name: 'process.aml' })).not.toBeNull()
    await waitFor(() => expect(canvasElement('ObjOcc.Start')).not.toBeNull())
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

    expect(await screen.findByText('This ARIS-only build accepts ARIS AML/XML exports.')).not.toBeNull()
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

    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-orbitpm-aris-import-package]')!)

    const dialog = await screen.findByRole('dialog', { name: 'Review this import' })
    // The review carries the exact digests, member list and fidelity summary the
    // commit will later be checked against.
    expect(within(dialog).getByText('animalwf.aml')).not.toBeNull()
    expect(within(dialog).getByText(/\/original\/source\.xml$/u)).not.toBeNull()
    expect(within(dialog).getByText(/\/manifest\.json$/u)).not.toBeNull()
    expect(within(dialog).getByText(/2 models/u)).not.toBeNull()
    expect(within(dialog).getByText(/0 unaccounted/u)).not.toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review this import' })).toBeNull())
    expect(downloads).toHaveLength(0)
  })

  it('commits a portable single-file import without overwriting the opened source', async () => {
    render(<ArisApp />)
    await openAml()

    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-orbitpm-aris-import-package]')!)
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
      expect(
        screen.queryByText('This ARIS-only build accepts ARIS AML/XML exports.')
      ).toBeNull()
    )
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

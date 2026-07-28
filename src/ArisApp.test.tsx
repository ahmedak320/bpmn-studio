// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('./assist/AssistantDrawer', () => ({
  AssistantDrawer: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">mock-assistant-drawer</div> : null
}))

vi.mock('./fs/workspaceHandle', () => ({
  classifyPickerError: () => 'unknown' as const,
  directoryPickerSupported: () => mockState.directoryPickerSupported,
  ensurePermission: async () => mockState.ensurePermission,
  loadRememberedWorkspace: async () => mockState.rememberedHandle,
  pickWorkspace: async () => null,
  rememberWorkspace: async () => undefined
}))

vi.mock('./workspace/adapters', async () => {
  const actual = await vi.importActual<typeof import('./workspace/adapters')>('./workspace/adapters')
  return {
    ...actual,
    DirectoryWorkspaceAdapter: vi.fn(function DirectoryWorkspaceAdapter() {
      if (!mockState.directoryAdapter) {
        throw new Error('mock directory adapter not configured')
      }
      return mockState.directoryAdapter
    }),
    opfsSupported: () => false
  }
})

import ArisApp from './ArisApp'
import type { FileSnapshot, WorkspaceAdapter, WorkspaceEntry } from './workspace/adapters'

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
  return {
    kind: 'file',
    name: path.split('/').pop() ?? path,
    path
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

describe('ArisApp production shell', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('dir')
    document.documentElement.removeAttribute('lang')
    document.title = ''
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

    const input = document.querySelector<HTMLInputElement>(
      'input[accept=".bpmn,.aml,.apc,.xml,application/xml,text/xml"]'
    )
    if (!input) throw new Error('missing ARIS shell file input')

    const xml =
      '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">' +
      '<bpmn:process id="Legacy_Process" />' +
      '</bpmn:definitions>'
    const file = new File([xml], 'legacy.bpmn', { type: 'application/xml' })
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: async () => new TextEncoder().encode(xml).buffer
    })

    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByText('This ARIS-only build accepts ARIS AML/XML exports.')).not.toBeNull()
    expect(screen.queryByText('ARIS placeholder canvas')).toBeNull()
    expect(screen.getByRole('button', { name: 'Open file…' })).not.toBeNull()
  })

  it('opens AML source tabs in the ARIS placeholder shell and keeps AI/settings/assistant surfaces wired', async () => {
    render(<ArisApp />)

    const input = document.querySelector<HTMLInputElement>(
      'input[accept=".bpmn,.aml,.apc,.xml,application/xml,text/xml"]'
    )
    if (!input) throw new Error('missing ARIS shell file input')

    const xml = '<AML><Header-Info DatabaseName="DMT" /></AML>'
    const file = new File([xml], 'source.aml', { type: 'application/xml' })
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: async () => new TextEncoder().encode(xml).buffer
    })

    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByText('ARIS placeholder canvas')).not.toBeNull()
    expect(screen.getByRole('tab', { name: 'source.aml' })).not.toBeNull()
    expect(screen.getAllByText('ARIS AML').length).toBeGreaterThan(0)
    expect(screen.getByTestId('mock-ai-panel')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Settings/ }))
    expect(await screen.findByText('mock-settings-dialog')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }))
    await waitFor(() => expect(screen.getByText('mock-assistant-drawer')).not.toBeNull())
  })

  it('rejects BPMN entries surfaced through remembered directory workspace browsing while still opening AML peers', async () => {
    const amlXml = '<AML><Header-Info DatabaseName="DMT" /></AML>'
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
        'legacy/process.aml': fileSnapshot('legacy/process.aml', amlXml)
      }
    )

    render(<ArisApp />)

    fireEvent.click(await screen.findByRole('button', { name: /legacy\/process\.bpmn/i }))
    expect(await screen.findByText('This ARIS-only build accepts ARIS AML/XML exports.')).not.toBeNull()
    expect(screen.queryByRole('tab', { name: 'process.bpmn' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /legacy\/camouflaged\.xml/i }))
    expect(screen.queryByRole('tab', { name: 'camouflaged.xml' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /legacy\/process\.aml/i }))
    expect(await screen.findByRole('tab', { name: 'process.aml' })).not.toBeNull()
    expect(screen.getByText('ARIS placeholder canvas')).not.toBeNull()
  })

  it('keeps accepting AML files during mixed import batches after rejecting BPMN files', async () => {
    render(<ArisApp />)

    const inputs = document.querySelectorAll<HTMLInputElement>(
      'input[accept=".bpmn,.aml,.apc,.xml,application/xml,text/xml"]'
    )
    const [openInput] = inputs
    if (!openInput) throw new Error('missing ARIS shell open-file input')

    const seedXml = '<AML><Header-Info DatabaseName="Seed" /></AML>'
    const seedFile = new File([seedXml], 'seed.aml', { type: 'application/xml' })
    Object.defineProperty(seedFile, 'arrayBuffer', {
      configurable: true,
      value: async () => new TextEncoder().encode(seedXml).buffer
    })
    fireEvent.change(openInput, { target: { files: [seedFile] } })

    expect(await screen.findByRole('tab', { name: 'seed.aml' })).not.toBeNull()

    const importInput = document.querySelectorAll<HTMLInputElement>(
      'input[accept=".bpmn,.aml,.apc,.xml,application/xml,text/xml"]'
    )[1]
    if (!importInput) throw new Error('missing ARIS shell import input')

    const bpmnXml =
      '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">' +
      '<bpmn:process id="Legacy_Process" />' +
      '</bpmn:definitions>'
    const rejectedFile = new File([bpmnXml], 'legacy.bpmn', { type: 'application/xml' })
    Object.defineProperty(rejectedFile, 'arrayBuffer', {
      configurable: true,
      value: async () => new TextEncoder().encode(bpmnXml).buffer
    })

    const amlXml = '<AML><Header-Info DatabaseName="Accepted" /></AML>'
    const acceptedFile = new File([amlXml], 'accepted.aml', { type: 'application/xml' })
    Object.defineProperty(acceptedFile, 'arrayBuffer', {
      configurable: true,
      value: async () => new TextEncoder().encode(amlXml).buffer
    })

    fireEvent.change(importInput, { target: { files: [rejectedFile, acceptedFile] } })

    expect(await screen.findByText('This ARIS-only build accepts ARIS AML/XML exports.')).not.toBeNull()
    expect(await screen.findByRole('tab', { name: 'accepted.aml' })).not.toBeNull()
    expect(screen.queryByRole('tab', { name: 'legacy.bpmn' })).toBeNull()
  })
})

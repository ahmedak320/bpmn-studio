// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LiteTreeNode } from '../../../fs/fsAccess'
import { MemoryWorkspaceAdapter } from '../../../workspace/adapters/memory'
import type { WorkspaceAdapter } from '../../../workspace/adapters/types'
import type { PromptText } from '../../../common/prompt'
import { buildLiteTreeFromEntries } from '../../../workspace/liteTreeFromEntries'
import { useArisExplorerActions, type ArisExplorerTabsController } from '../arisExplorerActions'

interface HarnessProps {
  adapter: WorkspaceAdapter | null
  tree: LiteTreeNode | null
  promptText: PromptText
  toast: (message: string, tone?: 'info' | 'error' | 'success') => void
  tabs: ArisExplorerTabsController
  refresh: () => Promise<void>
  node?: LiteTreeNode
  moveDrop?: { from: string; type: 'file' | 'directory'; to: string }
  importDrop?: { transfer: DataTransfer; to: string }
}

function Harness(props: HarnessProps): JSX.Element {
  const actions = useArisExplorerActions({
    adapter: props.adapter,
    tree: props.tree,
    rootName: 'workspace',
    promptText: props.promptText,
    refresh: props.refresh,
    toast: props.toast,
    tabs: props.tabs
  })
  return (
    <div>
      <button type="button" onClick={() => props.node && actions.onRename(props.node)}>
        run-rename
      </button>
      <button type="button" onClick={() => props.node && actions.onDelete(props.node)}>
        run-delete
      </button>
      <button
        type="button"
        onClick={() =>
          props.moveDrop &&
          actions.onMoveDrop(props.moveDrop.from, props.moveDrop.type, props.moveDrop.to)
        }
      >
        run-movedrop
      </button>
      <button
        type="button"
        onClick={() =>
          props.importDrop && actions.onImportDrop(props.importDrop.transfer, props.importDrop.to)
        }
      >
        run-import
      </button>
      {actions.dialogs}
    </div>
  )
}

function treeFromAdapterSeed(
  files: string[],
  folders: string[] = []
): { adapter: MemoryWorkspaceAdapter; tree: LiteTreeNode } {
  const adapter = new MemoryWorkspaceAdapter({
    folders,
    files: Object.fromEntries(files.map((path) => [path, '<AML></AML>']))
  })
  const tree = buildLiteTreeFromEntries(
    [
      ...folders.map((path) => ({
        path,
        name: path.split('/').pop() ?? path,
        parentPath: '',
        kind: 'directory' as const,
        readable: true
      })),
      ...files.map((path) => ({
        path,
        name: path.split('/').pop() ?? path,
        parentPath: '',
        kind: 'file' as const,
        readable: true
      }))
    ],
    'workspace'
  )
  return { adapter, tree }
}

function makeTabs(): ArisExplorerTabsController & {
  closeUnder: ReturnType<typeof vi.fn>
  remap: ReturnType<typeof vi.fn>
} {
  return { closeUnder: vi.fn(), remap: vi.fn() }
}

function droppedFile(
  name: string,
  text: string
): { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> } {
  const bytes = new TextEncoder().encode(text)
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer
  }
}

describe('useArisExplorerActions', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renames a file, preserving its extension and remapping the open tab', async () => {
    const { adapter, tree } = treeFromAdapterSeed(['process.aml'])
    const tabs = makeTabs()
    const toast = vi.fn()
    // The user typed a name with no extension; the original .aml must be kept.
    const promptText = vi.fn(async () => 'renamed') as unknown as PromptText

    render(
      <Harness
        adapter={adapter}
        tree={tree}
        promptText={promptText}
        toast={toast}
        tabs={tabs}
        refresh={async () => undefined}
        node={{ name: 'process.aml', relPath: 'process.aml', type: 'file' }}
      />
    )

    fireEvent.click(screen.getByText('run-rename'))

    await waitFor(() =>
      expect(tabs.remap).toHaveBeenCalledWith('process.aml', 'renamed.aml', 'file')
    )
    const entries = await adapter.list()
    expect(entries.map((entry) => entry.path)).toContain('renamed.aml')
    expect(entries.map((entry) => entry.path)).not.toContain('process.aml')
    expect(toast).not.toHaveBeenCalled()
  })

  it('requires typing the folder name before deleting a non-empty folder, then closes its tabs', async () => {
    const { adapter, tree } = treeFromAdapterSeed(['docs/a.aml'])
    const tabs = makeTabs()
    const toast = vi.fn()
    const node: LiteTreeNode = {
      name: 'docs',
      relPath: 'docs',
      type: 'directory',
      children: [{ name: 'a.aml', relPath: 'docs/a.aml', type: 'file' }]
    }

    render(
      <Harness
        adapter={adapter}
        tree={tree}
        promptText={vi.fn(async () => null) as unknown as PromptText}
        toast={toast}
        tabs={tabs}
        refresh={async () => undefined}
        node={node}
      />
    )

    fireEvent.click(screen.getByText('run-delete'))

    const dialog = await screen.findByRole('alertdialog')
    const confirmButton = screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement
    // A recursive delete of a non-empty folder is guarded: confirm is disabled
    // until the exact folder name is typed.
    expect(confirmButton.disabled).toBe(true)

    const input = dialog.querySelector<HTMLInputElement>('input[type="text"]')!
    fireEvent.change(input, { target: { value: 'docs' } })
    expect(confirmButton.disabled).toBe(false)
    fireEvent.click(confirmButton)

    await waitFor(() => expect(tabs.closeUnder).toHaveBeenCalledWith('docs', 'directory'))
    const entries = await adapter.list()
    expect(entries.map((entry) => entry.path)).not.toContain('docs')
    expect(entries.map((entry) => entry.path)).not.toContain('docs/a.aml')
  })

  it('refuses a move whose destination is inside the reserved .orbitpm namespace', async () => {
    const { adapter, tree } = treeFromAdapterSeed(['model.aml'])
    const moveSpy = vi.spyOn(adapter, 'move')
    const tabs = makeTabs()
    const toast = vi.fn()

    render(
      <Harness
        adapter={adapter}
        tree={tree}
        promptText={vi.fn(async () => null) as unknown as PromptText}
        toast={toast}
        tabs={tabs}
        refresh={async () => undefined}
        moveDrop={{ from: 'model.aml', type: 'file', to: '.orbitpm' }}
      />
    )

    fireEvent.click(screen.getByText('run-movedrop'))

    await waitFor(() => expect(toast).toHaveBeenCalled())
    expect(toast.mock.calls[0]?.[1]).toBe('error')
    expect(moveSpy).not.toHaveBeenCalled()
    expect(tabs.remap).not.toHaveBeenCalled()
    const entries = await adapter.list()
    expect(entries.map((entry) => entry.path)).toContain('model.aml')
  })

  it('imports ARIS files, rejects .bpmn with the arisOnly toast, and suffixes on collision', async () => {
    const { adapter, tree } = treeFromAdapterSeed(['target/model.aml'])
    const tabs = makeTabs()
    const toast = vi.fn()
    const transfer = {
      files: [droppedFile('model.aml', '<AML>new</AML>'), droppedFile('legacy.bpmn', 'x')]
    } as unknown as DataTransfer

    render(
      <Harness
        adapter={adapter}
        tree={tree}
        promptText={vi.fn(async () => null) as unknown as PromptText}
        toast={toast}
        tabs={tabs}
        refresh={async () => undefined}
        importDrop={{ transfer, to: 'target' }}
      />
    )

    fireEvent.click(screen.getByText('run-import'))

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Imported 1 file(s) into the workspace.', 'success')
    )
    // The .bpmn drop was refused with the ARIS-only message.
    expect(toast).toHaveBeenCalledWith('This ARIS-only build accepts ARIS AML/XML exports.')

    const entries = await adapter.list()
    const paths = entries.map((entry) => entry.path)
    // Collision with the existing target/model.aml forced a numeric suffix.
    expect(paths).toContain('target/model-2.aml')
    // The original file was never overwritten.
    const original = await adapter.read('target/model.aml')
    expect(new TextDecoder().decode(original.bytes)).toBe('<AML></AML>')
    // The rejected .bpmn was never written.
    expect(paths).not.toContain('target/legacy.bpmn')
  })
})

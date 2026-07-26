// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PortableHistoryManager } from './history'
import type { HistoryRevision } from './history/types'
import { HistoryDialog, type HistoryDialogRestoreResult } from './HistoryDialog'

vi.mock('../i18n', () => ({
  t: (key: string, vars?: Record<string, string | number>): string =>
    vars ? `${key} ${Object.values(vars).join(' ')}` : key
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const revision: HistoryRevision = {
  format: 'orbitpm-history-revision',
  version: 1,
  id: 'revision-1',
  originalPath: 'process.bpmn',
  contentPath: '.orbitpm/history/process/revision-1.bpmn',
  metadataPath: '.orbitpm/history/process/revision-1.json',
  hash: '1'.repeat(64),
  size: 12,
  createdAt: 1_700_000_000_000,
  reason: 'manual',
  storageBytes: 48
}

const successOutcome = {
  ok: true,
  status: 'success',
  snapshot: {
    path: revision.originalPath,
    bytes: new TextEncoder().encode('<old />'),
    hash: revision.hash,
    size: revision.size,
    modifiedAt: revision.createdAt
  },
  created: false,
  disposition: 'workspace'
} as const

function managerFixture() {
  const listRevisions = vi.fn(async () => ({
    revisions: [revision],
    issues: [],
    totalBytes: revision.storageBytes
  }))
  const restore = vi.fn()
  const restoreAsCopy = vi.fn(async () => successOutcome)
  const manager = {
    listRevisions,
    preview: vi.fn(),
    diff: vi.fn(),
    restore,
    restoreAsCopy
  } as unknown as PortableHistoryManager
  return { manager, listRevisions, restore, restoreAsCopy }
}

function renderHistory(
  manager: PortableHistoryManager,
  options: {
    onRestore?: (selected: HistoryRevision) => Promise<HistoryDialogRestoreResult>
    onChanged?: () => void | Promise<void>
  } = {}
) {
  return render(
    <HistoryDialog
      manager={manager}
      currentXml={() => '<current />'}
      onRestore={options.onRestore}
      onChanged={options.onChanged ?? vi.fn()}
      onClose={vi.fn()}
    />
  )
}

describe('HistoryDialog restore integration', () => {
  it('delegates in-place restore to the session-aware callback without calling manager.restore', async () => {
    const user = userEvent.setup()
    const { manager, listRevisions, restore } = managerFixture()
    const onChanged = vi.fn()
    const onRestore = vi.fn(async (): Promise<HistoryDialogRestoreResult> => ({
      status: 'restored',
      sessionId: 'open-session',
      outcome: successOutcome
    }))
    renderHistory(manager, { onRestore, onChanged })

    await user.click(await screen.findByRole('button', { name: 'workspace.history.restore' }))

    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(revision))
    expect(restore).not.toHaveBeenCalled()
    expect(onChanged).toHaveBeenCalledOnce()
    expect(listRevisions).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps in-place restore unavailable when no integration callback is supplied', async () => {
    const { manager, restore } = managerFixture()
    renderHistory(manager)

    const restoreButton = await screen.findByRole('button', {
      name: 'workspace.history.restore'
    })
    expect((restoreButton as HTMLButtonElement).disabled).toBe(true)
    expect(restore).not.toHaveBeenCalled()
  })

  it('refreshes committed storage and reports a live-session refresh failure truthfully', async () => {
    const user = userEvent.setup()
    const { manager, listRevisions, restore } = managerFixture()
    const onChanged = vi.fn()
    const onRestore = vi.fn(async (): Promise<HistoryDialogRestoreResult> => ({
      status: 'storage-restored-session-refresh-failed',
      sessionId: 'open-session',
      outcome: successOutcome,
      error: new Error('modeler rejected restored XML')
    }))
    renderHistory(manager, { onRestore, onChanged })

    await user.click(await screen.findByRole('button', { name: 'workspace.history.restore' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('workspace.history.restoreSessionRefreshFailed')
    expect(alert.textContent).toContain('modeler rejected restored XML')
    expect(onChanged).toHaveBeenCalledOnce()
    expect(listRevisions).toHaveBeenCalledTimes(2)
    expect(restore).not.toHaveBeenCalled()
  })

  it('does not refresh the workspace when compare-and-set rejects the restore', async () => {
    const user = userEvent.setup()
    const { manager, listRevisions } = managerFixture()
    const onChanged = vi.fn()
    const onRestore = vi.fn(async (): Promise<HistoryDialogRestoreResult> => ({
      status: 'not-restored',
      sessionId: null,
      outcome: {
        ok: false,
        status: 'external-conflict',
        reason: 'hash-mismatch',
        expectedHash: revision.hash
      }
    }))
    renderHistory(manager, { onRestore, onChanged })

    await user.click(await screen.findByRole('button', { name: 'workspace.history.restore' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('workspace.history.restoreNotComplete')
    expect(alert.textContent).toContain('external-conflict: hash-mismatch')
    expect(onChanged).not.toHaveBeenCalled()
    expect(listRevisions).toHaveBeenCalledOnce()
  })

  it('collects a restore-as-copy destination in an accessible modal without window.prompt', async () => {
    const user = userEvent.setup()
    const { manager, restoreAsCopy } = managerFixture()
    const onChanged = vi.fn()
    const prompt = vi.spyOn(window, 'prompt')
    renderHistory(manager, { onChanged })

    await user.click(await screen.findByRole('button', { name: 'workspace.history.restoreCopy' }))
    const dialog = screen.getByRole('dialog', {
      name: 'workspace.history.restoreCopy'
    })
    const input = within(dialog).getByRole('textbox', {
      name: 'workspace.history.copyPrompt'
    }) as HTMLInputElement
    expect(input.value).toBe('process-restored.bpmn')
    await user.clear(input)
    expect(within(dialog).getByText('workspace.history.copyDestinationRequired')).not.toBeNull()
    await user.type(input, '../outside.bpmn')
    expect(
      within(dialog).getByText('workspace.history.copyDestinationInvalid ../outside.bpmn')
    ).not.toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'workspace.history.restoreCopy' }))
    expect(restoreAsCopy).not.toHaveBeenCalled()
    await user.clear(input)
    await user.type(input, 'copies/process.bpmn')
    await user.click(within(dialog).getByRole('button', { name: 'workspace.history.restoreCopy' }))

    await waitFor(() => expect(restoreAsCopy).toHaveBeenCalledWith(revision, 'copies/process.bpmn'))
    expect(onChanged).toHaveBeenCalledOnce()
    expect(prompt).not.toHaveBeenCalled()
  })

  it('localizes restore-as-copy storage failures', async () => {
    const user = userEvent.setup()
    const { manager, restoreAsCopy } = managerFixture()
    restoreAsCopy.mockRejectedValueOnce(new Error('disk full'))
    renderHistory(manager)

    await user.click(await screen.findByRole('button', { name: 'workspace.history.restoreCopy' }))
    const dialog = screen.getByRole('dialog', {
      name: 'workspace.history.restoreCopy'
    })
    await user.click(within(dialog).getByRole('button', { name: 'workspace.history.restoreCopy' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('workspace.history.copyFailed')
    expect(alert.textContent).toContain('disk full')
  })
})

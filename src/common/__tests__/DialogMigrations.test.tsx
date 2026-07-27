// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProcessIndex } from '../../core/processIndex'
import { LinkPicker } from '../../links/LinkPicker'
import { DraftRecoveryDialog } from '../../sessions/DraftRecoveryDialog'
import type { DraftRecoveryComparison } from '../../sessions/draftJournal'
import { BackupImportDialog } from '../../workspace/BackupImportDialog'
import { HistoryDialog } from '../../workspace/HistoryDialog'
import { ConfirmDialog } from '../../workspace/ConfirmDialog'
import { Modal } from '../../workspace/Modal'
import type { WorkspaceBackupImportPlan } from '../../workspace/adapters'
import type { PortableHistoryManager } from '../../workspace/history'
import { SourceEditorDialog } from '../../validation/SourceEditorDialog'
import { SaveDraftDialog } from '../../validation/SaveDraftDialog'
import { ValidationCenter } from '../../validation/ValidationCenter'
import { createValidationSummary } from '../../validation/contracts'
import { TextInputModal } from '../prompt/TextInputModal'

vi.mock('../../i18n', () => ({
  t: (key: string): string => key
}))

vi.mock('../../i18n/useLang', () => ({
  useLang: (): 'en' => 'en'
}))

afterEach(cleanup)

function PromptHarness(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('Draft')
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open prompt
      </button>
      <TextInputModal
        open={open}
        title="Name process"
        label="Name"
        value={value}
        onChange={setValue}
        onOk={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    </>
  )
}

function ConfirmHarness(): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Delete process
      </button>
      {open ? (
        <ConfirmDialog
          title="Discard changes?"
          message="The current draft will be discarded."
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          danger
          role="alertdialog"
          onConfirm={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}

describe('dialog primitive migrations', () => {
  it('keeps TextInputModal autofocus, Escape, and trigger restoration', async () => {
    const user = userEvent.setup()
    render(<PromptHarness />)
    const trigger = screen.getByRole('button', { name: 'Open prompt' })
    await user.click(trigger)
    const input = screen.getByRole('textbox', { name: 'Name' })
    await waitFor(() => expect(document.activeElement).toBe(input))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Name process' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('gives LinkPicker a trapped initial search focus and Escape dismissal', () => {
    const index: ProcessIndex = new Map([
      ['Process_A', { processId: 'Process_A', processName: 'Process A', relPath: 'a.bpmn' }]
    ])
    const close = vi.fn()
    render(<LinkPicker open index={index} onPick={vi.fn()} onClose={close} />)
    const search = screen.getByPlaceholderText('linkPicker.searchPlaceholder')
    expect(document.activeElement).toBe(search)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
  })

  it('routes the workspace Modal shell through backdrop and Escape dismissal', () => {
    const close = vi.fn()
    render(
      <Modal title="Move item" onClose={close}>
        <button type="button">Move</button>
      </Modal>
    )
    fireEvent.mouseDown(document.querySelector<HTMLElement>('[role="presentation"]')!)
    expect(close).toHaveBeenCalledOnce()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('opens shared confirmations as alert dialogs with a safe initial action', async () => {
    const user = userEvent.setup()
    render(<ConfirmHarness />)
    const trigger = screen.getByRole('button', { name: 'Delete process' })
    await user.click(trigger)

    expect(screen.getByRole('alertdialog', { name: 'Discard changes?' })).not.toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep editing' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog', { name: 'Discard changes?' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps busy SaveDraftDialog non-dismissible and preserves alert semantics', () => {
    const cancel = vi.fn()
    const summary = createValidationSummary([])
    const { rerender } = render(
      <SaveDraftDialog summary={summary} busy onConfirm={vi.fn()} onCancel={cancel} />
    )
    expect(screen.getByRole('alertdialog')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(cancel).not.toHaveBeenCalled()

    rerender(
      <SaveDraftDialog summary={summary} busy={false} onConfirm={vi.fn()} onCancel={cancel} />
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('mounts backup, history, source, and validation shells as labelled dialogs', async () => {
    const plan = {
      files: [],
      collisions: [],
      declaredUncompressedBytes: 0
    } as unknown as WorkspaceBackupImportPlan
    const { unmount } = render(
      <BackupImportDialog plan={plan} onApply={vi.fn()} onCancel={vi.fn()} />
    )
    expect(screen.getByRole('dialog', { name: 'workspace.storage.collisionReview' })).not.toBeNull()
    unmount()

    const manager = {
      listRevisions: async () => ({ revisions: [], issues: [] })
    } as unknown as PortableHistoryManager
    const history = render(
      <HistoryDialog
        manager={manager}
        currentXml={() => undefined}
        onChanged={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByRole('dialog', { name: 'workspace.storage.history' })).not.toBeNull()
    history.unmount()

    const summary = createValidationSummary([])
    const source = render(
      <SourceEditorDialog
        open
        originalXml="<definitions />"
        validate={async () => summary}
        apply={async () => undefined}
        autoLayout={async (xml) => xml}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByRole('dialog', { name: 'sourceEditor.title' })).not.toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'sourceEditor.title' }))
    source.unmount()

    render(
      <ValidationCenter
        open
        summary={summary}
        running={false}
        onClose={vi.fn()}
        onRun={vi.fn()}
        onFocus={vi.fn()}
        onRepair={vi.fn()}
      />
    )
    expect(screen.getByRole('dialog', { name: 'validation.title' })).not.toBeNull()
  })

  it('keeps draft recovery decision-blocking while focusing Restore', () => {
    const comparison: DraftRecoveryComparison = {
      draft: {
        id: 'draft',
        workspaceId: 'workspace',
        path: 'process.bpmn',
        sessionId: 'session',
        xml: '<draft />',
        baseHash: 'base',
        timestamp: 0,
        appVersion: '0.4.5'
      },
      loadedXml: '<saved />',
      loadedBaseHash: 'base',
      relation: 'same-base',
      requiresReview: true
    }
    const decision = vi.fn()
    render(
      <DraftRecoveryDialog
        lang="en"
        title="Process"
        comparison={comparison}
        onDecision={decision}
        onDownload={vi.fn()}
      />
    )
    const restore = screen.getByRole('button', { name: 'draftRecovery.restore' })
    expect(document.activeElement).toBe(restore)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(decision).not.toHaveBeenCalled()
  })
})

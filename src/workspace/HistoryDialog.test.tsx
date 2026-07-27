// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SaveOutcome } from './adapters'
import type { PortableHistoryManager } from './history'
import { HISTORY_DIFF_BUDGETS, diffXml } from './history/diff'
import type {
  HistoryIssue,
  HistoryListing,
  HistoryRevision,
  HistoryRevisionReason
} from './history/types'
import {
  HISTORY_ISSUE_SUMMARY_MAX_CODE_POINTS,
  HISTORY_PREVIEW_MAX_CHARACTERS,
  HISTORY_TECHNICAL_DETAIL_MAX_CODE_POINTS,
  HistoryDialog,
  type HistoryDialogRestoreCopyHandler,
  type HistoryDialogRestoreResult
} from './HistoryDialog'

const language = vi.hoisted(() => ({ current: 'en' as 'en' | 'ar' }))
const arabicHistoryActionCopy = vi.hoisted(
  () =>
    ({
      'workspace.history.action.listFailed': 'تعذّر تحميل سجل الاسترداد.',
      'workspace.history.action.previewFailed': 'تعذّرت معاينة نسخة السجل هذه.',
      'workspace.history.action.diffFailed': 'تعذّرت مقارنة نسخة السجل هذه.',
      'workspace.history.action.restoreFailed': 'تعذّرت استعادة نسخة السجل هذه.',
      'workspace.history.action.restoreCopyFailed': 'تعذّرت استعادة نسخة السجل هذه كنسخة.',
      'workspace.history.action.workspaceRefreshAfterRestoreFailed':
        'تمت استعادة النسخة في التخزين، لكن تعذّر تحديث مساحة العمل.',
      'workspace.history.action.sessionRefreshAfterRestoreFailed':
        'تمت استعادة النسخة في التخزين، لكن تعذّر تحديث الجلسة المفتوحة.',
      'workspace.history.action.technicalDetails': 'التفاصيل التقنية:'
    }) as Readonly<Record<string, string>>
)

vi.mock('../i18n', () => ({
  t: (key: string, vars?: Record<string, string | number>): string => {
    const localized =
      language.current === 'ar' && arabicHistoryActionCopy[key] ? arabicHistoryActionCopy[key] : key
    return vars ? `${localized} ${Object.values(vars).join(' ')}` : localized
  }
}))

vi.mock('../i18n/useLang', () => ({
  useLang: (): 'en' | 'ar' => language.current
}))

beforeEach(() => {
  language.current = 'en'
})

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
  const listRevisions = vi.fn(
    async (
      _originalPath?: string,
      _options?: {
        cursor?: string
        limit?: number
        signal?: AbortSignal
      }
    ): Promise<HistoryListing> => ({
      revisions: [revision],
      issues: [],
      totalBytes: revision.storageBytes
    })
  )
  const restore = vi.fn()
  const restoreAsCopy = vi.fn(async () => successOutcome)
  const preview = vi.fn()
  const diff = vi.fn()
  const manager = {
    listRevisions,
    preview,
    diff,
    restore,
    restoreAsCopy
  } as unknown as PortableHistoryManager
  return { manager, listRevisions, preview, diff, restore, restoreAsCopy }
}

function renderHistory(
  manager: PortableHistoryManager,
  options: {
    onRestore?: (selected: HistoryRevision) => Promise<HistoryDialogRestoreResult>
    onRestoreCopy?: (
      selected: HistoryRevision,
      destination: string,
      signal: AbortSignal
    ) => Promise<SaveOutcome>
    onChanged?: () => void | Promise<void>
    onClose?: () => void
  } = {}
) {
  return render(
    <HistoryDialog
      manager={manager}
      currentXml={() => '<current />'}
      onRestore={options.onRestore}
      onRestoreCopy={options.onRestoreCopy}
      onChanged={options.onChanged ?? vi.fn()}
      onClose={options.onClose ?? vi.fn()}
    />
  )
}

describe('HistoryDialog restore integration', () => {
  it('keeps a thousands-entry history listing to one accessible fixed-size page', async () => {
    const user = userEvent.setup()
    const allRevisions = Array.from({ length: 2_001 }, (_, index) => ({
      ...revision,
      id: `revision-${index}`,
      originalPath: `process-${index}.bpmn`,
      contentPath: `.orbitpm/history/process-${index}/revision-${index}.bpmn`,
      metadataPath: `.orbitpm/history/process-${index}/revision-${index}.json`,
      createdAt: revision.createdAt - index
    }))
    const { manager, listRevisions } = managerFixture()
    listRevisions.mockImplementation(async (_originalPath, options) => {
      const start = Number(options?.cursor ?? 0)
      const limit = options?.limit ?? allRevisions.length
      const end = Math.min(allRevisions.length, start + limit)
      return {
        revisions: allRevisions.slice(start, end),
        issues: [],
        totalBytes: allRevisions
          .slice(start, end)
          .reduce((total, item) => total + item.storageBytes, 0),
        ...(end < allRevisions.length ? { nextCursor: String(end) } : {})
      }
    })

    const { container } = renderHistory(manager)

    await screen.findByText('process-0.bpmn')
    expect(container.querySelectorAll('.history-dialog__revision')).toHaveLength(25)
    const pagination = screen.getByRole('navigation', {
      name: 'workspace.history.pagination.label'
    })
    expect(within(pagination).getByText(/workspace\.history\.pagination\.status/u)).not.toBeNull()
    expect(listRevisions).toHaveBeenLastCalledWith(undefined, {
      cursor: undefined,
      limit: 25,
      signal: expect.any(AbortSignal)
    })

    await user.click(
      within(pagination).getByRole('button', {
        name: 'workspace.history.pagination.next'
      })
    )
    await screen.findByText('process-25.bpmn')
    expect(screen.queryByText('process-0.bpmn')).toBeNull()
    expect(container.querySelectorAll('.history-dialog__revision')).toHaveLength(25)
    expect(listRevisions).toHaveBeenLastCalledWith(undefined, {
      cursor: '25',
      limit: 25,
      signal: expect.any(AbortSignal)
    })

    await user.click(
      within(pagination).getByRole('button', {
        name: 'workspace.history.pagination.previous'
      })
    )
    await screen.findByText('process-0.bpmn')
    expect(screen.queryByText('process-25.bpmn')).toBeNull()
    expect(container.querySelectorAll('.history-dialog__revision')).toHaveLength(25)
  })

  it('aborts a pending listing when the history dialog closes', async () => {
    const user = userEvent.setup()
    const { manager, listRevisions } = managerFixture()
    const onClose = vi.fn()
    let listingSignal: AbortSignal | undefined
    listRevisions.mockImplementationOnce(
      async (_originalPath, options): Promise<HistoryListing> =>
        new Promise((_resolve, reject) => {
          listingSignal = options?.signal
          listingSignal?.addEventListener(
            'abort',
            () => reject(new DOMException('listing cancelled', 'AbortError')),
            { once: true }
          )
          if (listingSignal?.aborted) {
            reject(new DOMException('listing cancelled', 'AbortError'))
          }
        })
    )
    renderHistory(manager, { onClose })
    await waitFor(() => expect(listRevisions).toHaveBeenCalledOnce())

    const historyDialog = screen.getByRole('dialog', { name: 'workspace.storage.history' })
    await user.click(within(historyDialog).getByRole('button', { name: 'modal.cancel' }))

    expect(listingSignal?.aborted).toBe(true)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('localizes and bounds an initial listing failure as separate technical evidence', async () => {
    language.current = 'ar'
    const { manager, listRevisions } = managerFixture()
    const detail = `${'l'.repeat(510)}😀TAIL${'z'.repeat(1_000_000)}`
    listRevisions.mockRejectedValueOnce(new Error(detail))

    renderHistory(manager)

    const alert = await screen.findByRole('alert')
    expect(alert.querySelector('[data-history-error-summary]')?.textContent).toBe(
      'تعذّر تحميل سجل الاسترداد.'
    )
    const code = alert.querySelector('[data-history-error-technical] code')
    expect(code?.textContent).toBe(`${'l'.repeat(510)}😀…`)
    expect(Array.from(code?.textContent ?? '')).toHaveLength(
      HISTORY_TECHNICAL_DETAIL_MAX_CODE_POINTS
    )
    expect(code?.getAttribute('lang')).toBe('en')
    expect(code?.getAttribute('dir')).toBe('ltr')
  })

  it('localizes every listing issue code, uses an Arabic alert direction, and hides backend English', async () => {
    language.current = 'ar'
    const issueKeys: Record<HistoryIssue['code'], string> = {
      unreadable: 'workspace.history.issue.unreadable',
      'invalid-metadata': 'workspace.history.issue.invalidMetadata',
      'missing-content': 'workspace.history.issue.missingContent',
      'checksum-mismatch': 'workspace.history.issue.checksumMismatch',
      'orphan-content': 'workspace.history.issue.orphanContent',
      'retention-limit': 'workspace.history.issue.retentionLimit'
    }
    const codes = Object.keys(issueKeys) as HistoryIssue['code'][]
    const backendMessage = 'Backend English must not be rendered.'
    const { manager, listRevisions } = managerFixture()
    listRevisions.mockResolvedValueOnce({
      revisions: [],
      issues: [
        ...codes.map((code, index) => ({
          code,
          path: `.orbitpm/history/issue-${index}.json`,
          message: backendMessage
        })),
        {
          code: 'future-history-issue',
          path: '.orbitpm/history/future.json',
          message: backendMessage
        } as unknown as HistoryIssue
      ],
      totalBytes: 0
    })

    renderHistory(manager)

    const alert = await screen.findByRole('alert')
    for (const key of Object.values(issueKeys)) expect(alert.textContent).toContain(key)
    expect(alert.textContent).toContain('workspace.history.issue.unknown')
    expect(alert.textContent).not.toContain(backendMessage)
    expect(alert.getAttribute('dir')).toBe('rtl')
    expect(alert.style.textAlign).toBe('start')
  })

  it('bounds hostile issue paths and aggregation without reading backend messages', async () => {
    const oversizedPath = `${'p'.repeat(94)}😀TAIL${'z'.repeat(1_000_000)}`
    const hostileIssue = {} as HistoryIssue
    Object.defineProperties(hostileIssue, {
      code: {
        get(): never {
          throw new Error('hostile issue code getter')
        }
      },
      path: {
        get(): never {
          throw new Error('hostile issue path getter')
        }
      },
      message: {
        get(): never {
          throw new Error('backend message must not be read')
        }
      }
    })
    const { manager, listRevisions } = managerFixture()
    listRevisions.mockResolvedValueOnce({
      revisions: [],
      issues: [
        {
          code: 'unreadable',
          path: oversizedPath,
          message: 'backend detail must stay hidden'
        },
        hostileIssue,
        ...Array.from({ length: 100 }, (_, index) => ({
          code: 'invalid-metadata' as const,
          path: `issue-${index}-${'q'.repeat(500)}`,
          message: 'backend detail must stay hidden'
        }))
      ],
      totalBytes: 0
    })

    renderHistory(manager)

    const alert = await screen.findByRole('alert')
    const summary = alert.querySelector('[data-history-error-summary]')?.textContent ?? ''
    expect(Array.from(summary).length).toBeLessThanOrEqual(HISTORY_ISSUE_SUMMARY_MAX_CODE_POINTS)
    expect(summary).toContain(`${'p'.repeat(94)}😀…`)
    expect(summary).toContain('workspace.history.issue.unknown ?')
    expect(summary).not.toContain('TAIL')
    expect(summary).not.toContain('backend detail')
    expect(summary.endsWith('…')).toBe(true)
  })

  it('maps every revision reason to localized copy instead of rendering storage tokens', async () => {
    const reasons = [
      'overwrite',
      'delete',
      'restore',
      'manual',
      'backup-import'
    ] as const satisfies readonly HistoryRevisionReason[]
    const expectedKeys: Record<HistoryRevisionReason, string> = {
      overwrite: 'workspace.history.reason.overwrite',
      delete: 'workspace.history.reason.delete',
      restore: 'workspace.history.reason.restore',
      manual: 'workspace.history.reason.manual',
      'backup-import': 'workspace.history.reason.backupImport'
    }
    const futureReason = 'future-history-reason' as HistoryRevisionReason
    const { manager, listRevisions } = managerFixture()
    listRevisions.mockResolvedValueOnce({
      revisions: [...reasons, futureReason].map((reason, index) => ({
        ...revision,
        id: `revision-${index}`,
        contentPath: `.orbitpm/history/process/revision-${index}.bpmn`,
        metadataPath: `.orbitpm/history/process/revision-${index}.json`,
        reason
      })),
      issues: [],
      totalBytes: revision.storageBytes * (reasons.length + 1)
    })

    const { container } = renderHistory(manager)

    await screen.findAllByText('process.bpmn')
    const renderedReasons = [...container.querySelectorAll('[data-history-reason]')].map(
      (element) => element.textContent
    )
    expect(renderedReasons).toEqual([
      ...reasons.map((reason) => expectedKeys[reason]),
      'workspace.history.reason.unknown'
    ])
    expect(renderedReasons).not.toContain('backup-import')
    expect(renderedReasons).not.toContain(futureReason)
  })

  it('formats revision dates and sizes with the selected application locale', async () => {
    language.current = 'ar'
    const localeDate = vi
      .spyOn(Date.prototype, 'toLocaleString')
      .mockReturnValue('ARABIC-LOCALE-DATE')
    const { manager } = managerFixture()

    renderHistory(manager)

    const path = await screen.findByText('process.bpmn')
    const metadata = path.closest('article')?.querySelector('small')
    expect(metadata?.textContent).toContain('ARABIC-LOCALE-DATE')
    expect(metadata?.textContent).toContain(new Intl.NumberFormat('ar').format(0))
    expect(metadata?.querySelector('[lang="en"][dir="ltr"]')?.textContent).toBe('KiB')
    expect(localeDate).toHaveBeenCalledWith('ar')
  })

  it('keeps the title and close footer outside the sole scrollable dialog body', async () => {
    const { manager } = managerFixture()
    const { container } = renderHistory(manager)

    await screen.findByText('process.bpmn')
    const dialog = screen.getByRole('dialog', { name: 'workspace.storage.history' })
    const header = dialog.querySelector(':scope > .history-dialog__header')
    const body = dialog.querySelector(':scope > .history-dialog__body')
    const footer = dialog.querySelector(':scope > .history-dialog__footer')
    expect(header?.querySelector('#history-dialog-title')).not.toBeNull()
    expect(body?.querySelector('.history-dialog__revisions')).not.toBeNull()
    expect(footer?.querySelector('button')?.textContent).toBe('modal.cancel')
    expect(container.querySelectorAll('.history-dialog__body')).toHaveLength(1)
  })

  it('caps a raw revision preview and discloses the exact hidden character count', async () => {
    const user = userEvent.setup()
    const { manager, preview } = managerFixture()
    const omitted = 1_234
    const xml = 'x'.repeat(HISTORY_PREVIEW_MAX_CHARACTERS + omitted)
    preview.mockResolvedValueOnce({
      revision,
      bytes: new TextEncoder().encode(xml),
      xml
    })

    const { container } = renderHistory(manager)
    await user.click(await screen.findByRole('button', { name: 'workspace.history.preview' }))

    const notice = await screen.findByRole('status')
    expect(notice.textContent).toContain('workspace.history.previewTruncated')
    expect(notice.textContent).toContain(
      new Intl.NumberFormat('en').format(HISTORY_PREVIEW_MAX_CHARACTERS)
    )
    expect(notice.textContent).toContain(new Intl.NumberFormat('en').format(omitted))
    expect(container.querySelector('[data-history-preview]')?.textContent).toHaveLength(
      HISTORY_PREVIEW_MAX_CHARACTERS
    )
    expect(xml).toHaveLength(HISTORY_PREVIEW_MAX_CHARACTERS + omitted)
    expect(preview).toHaveBeenCalledWith(revision)
  })

  it('bounds preview by Unicode code points without emitting a lone surrogate', async () => {
    const user = userEvent.setup()
    const { manager, preview } = managerFixture()
    const xml = `${'x'.repeat(HISTORY_PREVIEW_MAX_CHARACTERS - 1)}😀جZ`
    preview.mockResolvedValueOnce({
      revision,
      bytes: new TextEncoder().encode(xml),
      xml
    })

    const { container } = renderHistory(manager)
    await user.click(await screen.findByRole('button', { name: 'workspace.history.preview' }))

    const visible = container.querySelector('[data-history-preview]')?.textContent ?? ''
    expect(Array.from(visible)).toHaveLength(HISTORY_PREVIEW_MAX_CHARACTERS)
    expect(visible.endsWith('😀')).toBe(true)
    expect(visible.charCodeAt(visible.length - 1)).toBeGreaterThanOrEqual(0xdc00)
    expect(screen.getByRole('status').textContent).toContain(new Intl.NumberFormat('en').format(2))
    expect(xml).toBe(`${'x'.repeat(HISTORY_PREVIEW_MAX_CHARACTERS - 1)}😀جZ`)
  })

  it('renders a bounded diff with localized omission disclosure', async () => {
    const user = userEvent.setup()
    language.current = 'ar'
    const { manager, diff } = managerFixture()
    const oldXml = Array.from({ length: 1_200 }, (_, index) => `old-${index}`).join('\n')
    const newXml = Array.from({ length: 1_200 }, (_, index) => `new-${index}`).join('\n')
    const bounded = diffXml(oldXml, newXml)
    diff.mockResolvedValueOnce(bounded)

    const { container } = renderHistory(manager)
    await user.click(await screen.findByRole('button', { name: 'workspace.history.diff' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('workspace.history.diffTruncated')
    expect(alert.textContent).toContain(
      new Intl.NumberFormat('ar').format(bounded.omitted.previewRows)
    )
    expect(alert.getAttribute('dir')).toBe('rtl')
    expect(screen.getByRole('status').textContent).toContain('workspace.history.diffBounded')
    expect(container.querySelectorAll('[data-history-diff-row]').length).toBeLessThanOrEqual(
      HISTORY_DIFF_BUDGETS.maxPreviewRows
    )
    expect(container.querySelectorAll('[data-history-diff-hunk]').length).toBeLessThanOrEqual(
      HISTORY_DIFF_BUDGETS.maxHunks
    )
    expect(diff).toHaveBeenCalledWith(revision, '<current />')
  })

  it.each([
    {
      action: 'preview',
      button: 'workspace.history.preview',
      summary: 'تعذّرت معاينة نسخة السجل هذه.',
      detail: 'Native history preview failed.'
    },
    {
      action: 'diff',
      button: 'workspace.history.diff',
      summary: 'تعذّرت مقارنة نسخة السجل هذه.',
      detail: 'Native history comparison failed.'
    }
  ] as const)(
    'shows an Arabic $action summary and isolates exact technical evidence',
    async ({ action, button, summary, detail }) => {
      const user = userEvent.setup()
      language.current = 'ar'
      const { manager, preview, diff } = managerFixture()
      const operation = action === 'preview' ? preview : diff
      operation.mockRejectedValueOnce(new Error(detail))
      renderHistory(manager)

      await user.click(await screen.findByRole('button', { name: button }))

      const alert = await screen.findByRole('alert')
      expect(alert.getAttribute('dir')).toBe('rtl')
      expect(alert.querySelector('[data-history-error-summary]')?.textContent).toBe(summary)
      const evidence = alert.querySelector('[data-history-error-technical]')
      expect(evidence?.textContent).toContain('التفاصيل التقنية:')
      const code = evidence?.querySelector('code')
      expect(code?.textContent).toBe(detail)
      expect(code?.getAttribute('lang')).toBe('en')
      expect(code?.getAttribute('dir')).toBe('ltr')
      expect(alert.querySelector('[data-history-error-summary]')?.textContent).not.toContain(detail)
    }
  )

  it('bounds million-character technical evidence by Unicode code points', async () => {
    const user = userEvent.setup()
    language.current = 'ar'
    const { manager, preview } = managerFixture()
    const detail = `${'x'.repeat(510)}😀TAIL${'z'.repeat(1_000_000)}`
    preview.mockRejectedValueOnce(new Error(detail))
    renderHistory(manager)

    await user.click(await screen.findByRole('button', { name: 'workspace.history.preview' }))

    const alert = await screen.findByRole('alert')
    expect(alert.querySelector('[data-history-error-summary]')?.textContent).toBe(
      'تعذّرت معاينة نسخة السجل هذه.'
    )
    const code = alert.querySelector('[data-history-error-technical] code')
    expect(code?.textContent).toBe(`${'x'.repeat(510)}😀…`)
    expect(Array.from(code?.textContent ?? '')).toHaveLength(
      HISTORY_TECHNICAL_DETAIL_MAX_CODE_POINTS
    )
    expect(code?.getAttribute('lang')).toBe('en')
    expect(code?.getAttribute('dir')).toBe('ltr')
  })

  it('suppresses a throwing Error.message while retaining the localized summary', async () => {
    const user = userEvent.setup()
    language.current = 'ar'
    const { manager, preview } = managerFixture()
    const hostile = new Error('placeholder')
    Object.defineProperty(hostile, 'message', {
      configurable: true,
      get(): never {
        throw new Error('hostile message getter')
      }
    })
    preview.mockRejectedValueOnce(hostile)
    renderHistory(manager)

    await user.click(await screen.findByRole('button', { name: 'workspace.history.preview' }))

    const alert = await screen.findByRole('alert')
    expect(alert.querySelector('[data-history-error-summary]')?.textContent).toBe(
      'تعذّرت معاينة نسخة السجل هذه.'
    )
    expect(alert.querySelector('[data-history-error-technical]')).toBeNull()
  })

  it('guards non-string Error.message conversion as technical evidence', async () => {
    const user = userEvent.setup()
    const { manager, preview } = managerFixture()
    const error = new Error('placeholder')
    Object.defineProperty(error, 'message', { configurable: true, value: 503 })
    preview.mockRejectedValueOnce(error)
    renderHistory(manager)

    await user.click(await screen.findByRole('button', { name: 'workspace.history.preview' }))

    const alert = await screen.findByRole('alert')
    expect(alert.querySelector('[data-history-error-summary]')?.textContent).toBe(
      'workspace.history.action.previewFailed'
    )
    expect(alert.querySelector('[data-history-error-technical] code')?.textContent).toBe('503')
  })

  it('shows an Arabic restore summary and isolates a rejected restore detail', async () => {
    const user = userEvent.setup()
    language.current = 'ar'
    const { manager } = managerFixture()
    const detail = 'Native restore transaction failed.'
    const onRestore = vi.fn(async (): Promise<HistoryDialogRestoreResult> => {
      throw new Error(detail)
    })
    renderHistory(manager, { onRestore })

    await user.click(await screen.findByRole('button', { name: 'workspace.history.restore' }))

    const alert = await screen.findByRole('alert')
    expect(alert.getAttribute('dir')).toBe('rtl')
    expect(alert.querySelector('[data-history-error-summary]')?.textContent).toBe(
      'تعذّرت استعادة نسخة السجل هذه.'
    )
    expect(alert.querySelector('[data-history-error-technical] span')?.textContent).toBe(
      'التفاصيل التقنية:'
    )
    const code = alert.querySelector('[data-history-error-technical] code')
    expect(code?.textContent).toBe(detail)
    expect(code?.getAttribute('lang')).toBe('en')
    expect(code?.getAttribute('dir')).toBe('ltr')
  })

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
    expect(alert.querySelector('[data-history-error-summary]')?.textContent).toBe(
      'workspace.history.action.sessionRefreshAfterRestoreFailed'
    )
    expect(alert.querySelector('[data-history-error-technical] code')?.textContent).toContain(
      'modeler rejected restored XML'
    )
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
    expect(alert.textContent).toContain('workspace.history.saveOutcome.externalConflict')
    expect(alert.textContent).toContain('workspace.history.conflictReason.hashMismatch')
    expect(alert.textContent).not.toContain('external-conflict')
    expect(alert.textContent).not.toContain('hash-mismatch')
    expect(onChanged).not.toHaveBeenCalled()
    expect(listRevisions).toHaveBeenCalledOnce()
  })

  it.each([
    ['review-required', 'workspace.history.restoreReason.reviewRequired'],
    ['stale', 'workspace.history.restoreReason.stale']
  ] as const)('localizes a %s restore preparation outcome', async (reason, expectedKey) => {
    const user = userEvent.setup()
    const { manager } = managerFixture()
    const onRestore = vi.fn(async (): Promise<HistoryDialogRestoreResult> => ({
      status: 'preparation-not-completed',
      sessionId: 'open-session',
      reason
    }))
    renderHistory(manager, { onRestore })

    await user.click(await screen.findByRole('button', { name: 'workspace.history.restore' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(expectedKey)
    expect(alert.textContent).not.toContain(` ${reason}`)
  })

  it('uses a localized safe fallback for an unexpected restore outcome code', async () => {
    const user = userEvent.setup()
    const { manager } = managerFixture()
    const onRestore = vi.fn(
      async (): Promise<HistoryDialogRestoreResult> =>
        ({
          status: 'not-restored',
          sessionId: null,
          outcome: {
            ok: false,
            status: 'future-storage-result'
          }
        }) as unknown as HistoryDialogRestoreResult
    )
    renderHistory(manager, { onRestore })

    await user.click(await screen.findByRole('button', { name: 'workspace.history.restore' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('workspace.history.saveOutcome.unknown')
    expect(alert.textContent).not.toContain('future-storage-result')
  })

  it('treats an explicitly cancelled restore as a quiet no-op', async () => {
    const user = userEvent.setup()
    const { manager, listRevisions, restore } = managerFixture()
    const onChanged = vi.fn()
    const onRestore = vi.fn(async (): Promise<HistoryDialogRestoreResult> => ({
      status: 'preparation-not-completed',
      sessionId: 'open-session',
      reason: 'cancelled'
    }))
    renderHistory(manager, { onRestore, onChanged })

    await user.click(await screen.findByRole('button', { name: 'workspace.history.restore' }))
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(revision))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(onChanged).not.toHaveBeenCalled()
    expect(listRevisions).toHaveBeenCalledOnce()
    expect(restore).not.toHaveBeenCalled()
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

    await waitFor(() =>
      expect(restoreAsCopy).toHaveBeenCalledWith(revision, 'copies/process.bpmn', expect.anything())
    )
    expect(onChanged).toHaveBeenCalledOnce()
    expect(prompt).not.toHaveBeenCalled()
  })

  it('delegates restore-as-copy through the workspace-aware handler with a live abort signal', async () => {
    const user = userEvent.setup()
    const { manager, restoreAsCopy } = managerFixture()
    const onChanged = vi.fn()
    const onRestoreCopy = vi.fn<HistoryDialogRestoreCopyHandler>(
      async (): Promise<SaveOutcome> => successOutcome
    )
    renderHistory(manager, { onChanged, onRestoreCopy })

    await user.click(await screen.findByRole('button', { name: 'workspace.history.restoreCopy' }))
    const prompt = screen.getByRole('dialog', {
      name: 'workspace.history.restoreCopy'
    })
    await user.click(within(prompt).getByRole('button', { name: 'workspace.history.restoreCopy' }))

    await waitFor(() => expect(onRestoreCopy).toHaveBeenCalledOnce())
    const [selected, destination, signal] = onRestoreCopy.mock.calls[0]
    expect(selected).toBe(revision)
    expect(destination).toBe('process-restored.bpmn')
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
    expect(restoreAsCopy).not.toHaveBeenCalled()
    expect(onChanged).toHaveBeenCalledOnce()
  })

  it('aborts an in-flight workspace-aware restore-as-copy when the dialog closes', async () => {
    const user = userEvent.setup()
    const { manager, restoreAsCopy } = managerFixture()
    const onChanged = vi.fn()
    const onClose = vi.fn()
    let operationSignal: AbortSignal | undefined
    const onRestoreCopy = vi.fn(
      async (
        _selected: HistoryRevision,
        _destination: string,
        signal: AbortSignal
      ): Promise<SaveOutcome> => {
        operationSignal = signal
        return new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () =>
              resolve({
                ok: false,
                status: 'cancelled',
                error: {
                  code: 'cancelled',
                  operation: 'write',
                  path: 'process-restored.bpmn',
                  message: 'Workspace write was cancelled.'
                }
              }),
            { once: true }
          )
        })
      }
    )
    renderHistory(manager, { onChanged, onClose, onRestoreCopy })

    await user.click(await screen.findByRole('button', { name: 'workspace.history.restoreCopy' }))
    const prompt = screen.getByRole('dialog', {
      name: 'workspace.history.restoreCopy'
    })
    await user.click(within(prompt).getByRole('button', { name: 'workspace.history.restoreCopy' }))
    await waitFor(() => expect(onRestoreCopy).toHaveBeenCalledOnce())

    const historyDialog = screen.getByRole('dialog', { name: 'workspace.storage.history' })
    await user.click(within(historyDialog).getByRole('button', { name: 'modal.cancel' }))

    expect(operationSignal?.aborted).toBe(true)
    expect(onClose).toHaveBeenCalledOnce()
    expect(restoreAsCopy).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('localizes restore-as-copy storage failures and isolates their technical evidence', async () => {
    const user = userEvent.setup()
    language.current = 'ar'
    const { manager, restoreAsCopy } = managerFixture()
    restoreAsCopy.mockRejectedValueOnce(new Error('disk full'))
    renderHistory(manager)

    await user.click(await screen.findByRole('button', { name: 'workspace.history.restoreCopy' }))
    const dialog = screen.getByRole('dialog', {
      name: 'workspace.history.restoreCopy'
    })
    await user.click(within(dialog).getByRole('button', { name: 'workspace.history.restoreCopy' }))

    const alert = await screen.findByRole('alert')
    expect(alert.getAttribute('dir')).toBe('rtl')
    expect(alert.querySelector('[data-history-error-summary]')?.textContent).toBe(
      'تعذّرت استعادة نسخة السجل هذه كنسخة.'
    )
    expect(alert.querySelector('[data-history-error-technical] span')?.textContent).toBe(
      'التفاصيل التقنية:'
    )
    const code = alert.querySelector('[data-history-error-technical] code')
    expect(code?.textContent).toBe('disk full')
    expect(code?.getAttribute('lang')).toBe('en')
    expect(code?.getAttribute('dir')).toBe('ltr')
  })
})

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CANONICAL_FIELDS_BY_SHEET } from '../aliases'
import {
  OFFICIAL_TEMPLATE_VERSION,
  type CanonicalSheet,
  type ParsedWorkbookData,
  type SpreadsheetImportReport,
  type TransactionalImportPlan,
  type WorkbookCell
} from '../contracts'
import type { BrowserSpreadsheetParseResult } from '../browserParserAdapters'
import { SpreadsheetError } from '../errors'
import { OFFICIAL_SHEET_NAMES } from '../officialTemplate'
import { OFFICIAL_TEMPLATE_ASSET_NAMES } from '../template'
import { validModel } from '../testFixtures'

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  draftLoad: vi.fn(),
  draftSave: vi.fn(),
  draftRemove: vi.fn(),
  downloadPreset: vi.fn(),
  readPreset: vi.fn(),
  downloadBlob: vi.fn(),
  prepare: vi.fn(),
  execute: vi.fn(),
  reviewWorkbook: vi.fn()
}))

vi.mock('../../i18n', () => ({
  t: (key: string): string => key
}))

vi.mock('../../i18n/useLang', () => ({
  useLang: (): 'en' => 'en'
}))

vi.mock('../browserParserAdapters', () => ({
  parseBrowserSpreadsheet: mocks.parse
}))

vi.mock('../browserDraftStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../browserDraftStore')>()
  return {
    ...actual,
    BrowserMappingDraftStore: class {
      load = mocks.draftLoad
      save = mocks.draftSave
      remove = mocks.draftRemove
    },
    downloadMappingPreset: mocks.downloadPreset,
    readMappingPresetFile: mocks.readPreset
  }
})

vi.mock('../destinationAdapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../destinationAdapters')>()
  return {
    ...actual,
    downloadSpreadsheetBlob: mocks.downloadBlob
  }
})

vi.mock('../transaction', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../transaction')>()
  return {
    ...actual,
    prepareTransactionalImportPlan: mocks.prepare,
    executeTransactionalImportPlan: mocks.execute
  }
})

vi.mock('../bilingualReview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../bilingualReview')>()
  return {
    ...actual,
    reviewProcessWorkbookBilingual: mocks.reviewWorkbook
  }
})

import { SpreadsheetImportPanel } from '../SpreadsheetImportPanel'

function cells(values: readonly unknown[]): WorkbookCell[] {
  return values.map((value) => ({
    value: value as WorkbookCell['value'],
    rawValue: value
  }))
}

function objectRow(
  role: CanonicalSheet,
  values: Readonly<Record<string, unknown>>
): WorkbookCell[] {
  return cells(CANONICAL_FIELDS_BY_SHEET[role].map((field) => values[field] ?? null))
}

function officialWorkbook(): ParsedWorkbookData {
  const rows: Record<CanonicalSheet, WorkbookCell[][]> = {
    processes: [
      cells(CANONICAL_FIELDS_BY_SHEET.processes),
      objectRow('processes', {
        process_id: 'leave_approval',
        name_en: 'Leave approval',
        name_ar: 'الموافقة على الإجازة',
        folder: 'hr',
        active_language: 'en'
      })
    ],
    participants: [cells(CANONICAL_FIELDS_BY_SHEET.participants)],
    steps: [
      cells(CANONICAL_FIELDS_BY_SHEET.steps),
      objectRow('steps', {
        process_id: 'leave_approval',
        step_id: 'Start_1',
        order: 1,
        type: 'startEvent',
        name_en: 'Start',
        name_ar: 'البداية'
      }),
      objectRow('steps', {
        process_id: 'leave_approval',
        step_id: 'Task_1',
        order: 2,
        type: 'userTask',
        name_en: 'Review',
        name_ar: 'مراجعة'
      }),
      objectRow('steps', {
        process_id: 'leave_approval',
        step_id: 'End_1',
        order: 3,
        type: 'endEvent',
        name_en: 'End',
        name_ar: 'النهاية'
      })
    ],
    flows: [
      cells(CANONICAL_FIELDS_BY_SHEET.flows),
      objectRow('flows', {
        process_id: 'leave_approval',
        flow_id: 'Flow_1',
        source_step_id: 'Start_1',
        target_step_id: 'Task_1',
        is_default: false
      }),
      objectRow('flows', {
        process_id: 'leave_approval',
        flow_id: 'Flow_2',
        source_step_id: 'Task_1',
        target_step_id: 'End_1',
        is_default: false
      })
    ],
    glossary: [cells(CANONICAL_FIELDS_BY_SHEET.glossary)]
  }
  return {
    customProperties: { OrbitPMTemplateVersion: OFFICIAL_TEMPLATE_VERSION },
    sheets: (Object.keys(OFFICIAL_SHEET_NAMES) as CanonicalSheet[]).map((role) => ({
      name: OFFICIAL_SHEET_NAMES[role],
      rows: rows[role]
    }))
  }
}

function ordinaryWorkbook(): ParsedWorkbookData {
  return {
    sheets: [
      {
        name: 'Activities',
        rows: [
          cells(['Workflow', 'Identifier', 'Sequence', 'Kind', 'English', 'Arabic']),
          cells(['leave', 'Review', 1, 'task', 'Review request', 'مراجعة الطلب'])
        ]
      }
    ]
  }
}

function parseResult(
  workbook: ParsedWorkbookData,
  format: 'xlsx' | 'csv'
): BrowserSpreadsheetParseResult {
  return {
    workbook,
    format,
    issues: []
  }
}

const model = validModel()
const graph = {
  process: model.processes[0]!,
  participants: model.participants,
  nodes: model.nodes,
  flows: model.flows,
  glossary: model.glossary
}
const translation = {
  complete: true,
  missing: 0,
  invalid: 0,
  translationRequired: false
}
const readyPlan: TransactionalImportPlan = {
  version: 1,
  id: 'import-ready',
  createdAt: '2026-07-26T00:00:00.000Z',
  sourceFile: 'official.xlsx',
  status: 'ready',
  mode: 'single-file',
  delivery: 'open-single',
  validation: {
    issues: [],
    blocking: false,
    errorCount: 0,
    reviewCount: 0,
    warningCount: 0
  },
  artifacts: [
    {
      graph,
      generated: {
        processId: graph.process.id,
        semanticXml: '<definitions />',
        layoutedXml: '<definitions />',
        bytes: new TextEncoder().encode('<definitions />'),
        diagnostics: []
      },
      destination: {
        processId: graph.process.id,
        path: 'leave-approval.bpmn',
        behavior: 'create'
      },
      checksumSha256: 'a'.repeat(64),
      translation
    }
  ],
  generatedIds: [],
  inferredFlows: [],
  warnings: [],
  skippedRows: []
}

const translationBlockedPlan: TransactionalImportPlan = {
  ...readyPlan,
  status: 'blocked',
  delivery: 'open-single',
  validation: {
    issues: [
      {
        code: 'translation-review-required',
        severity: 'review',
        messageKey: 'spreadsheet.validation.translation-review-required',
        processId: graph.process.id,
        details: { missing: 1, invalid: 0 }
      }
    ],
    blocking: true,
    errorCount: 0,
    reviewCount: 1,
    warningCount: 0
  },
  artifacts: [],
  blockingReason: 'translation-review'
}

const committedReport: SpreadsheetImportReport = {
  reportVersion: 1,
  planId: readyPlan.id,
  sourceFile: readyPlan.sourceFile,
  startedAt: readyPlan.createdAt,
  completedAt: '2026-07-26T00:00:01.000Z',
  status: 'committed',
  generatedIds: [],
  inferredFlows: [],
  issues: [],
  skippedRows: [],
  artifacts: [
    {
      processId: graph.process.id,
      destinationPath: 'leave-approval.bpmn',
      checksumSha256: 'a'.repeat(64),
      bytes: 15,
      translation
    }
  ]
}

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof SpreadsheetImportPanel>> = {}
): ReturnType<typeof render> {
  return render(
    <SpreadsheetImportPanel
      workspaceId="workspace-1"
      workspaceAdapter={null}
      folders={[{ relPath: 'hr', label: 'HR' }]}
      knownProcessIds={[]}
      onOpenSingle={vi.fn()}
      onCommitted={vi.fn()}
      {...overrides}
    />
  )
}

beforeEach(() => {
  mocks.parse.mockReset()
  mocks.draftLoad.mockReset().mockResolvedValue(undefined)
  mocks.draftSave.mockReset().mockResolvedValue(undefined)
  mocks.draftRemove.mockReset().mockResolvedValue(undefined)
  mocks.downloadPreset.mockReset()
  mocks.readPreset.mockReset()
  mocks.downloadBlob.mockReset()
  mocks.prepare.mockReset().mockResolvedValue(readyPlan)
  mocks.execute.mockReset().mockResolvedValue(committedReport)
  mocks.reviewWorkbook.mockReset().mockImplementation(async (reviewModel, options) => {
    const result = await options.review({
      version: 1,
      processId: reviewModel.processes[0]!.id,
      suggestedName: `${reviewModel.processes[0]!.id}.bpmn`,
      xml: '<definitions />',
      ordinal: 1,
      total: 1,
      signal: options.signal ?? new AbortController().signal
    })
    return result.status === 'cancelled'
      ? { status: 'cancelled', processId: reviewModel.processes[0]!.id }
      : { status: 'completed', model: reviewModel }
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('SpreadsheetImportPanel browser workflow', () => {
  it('downloads templates and completes the reviewed single-file transaction', async () => {
    const user = userEvent.setup()
    const onOpenSingle = vi.fn()
    const onCommitted = vi.fn()
    mocks.parse.mockImplementation(
      async (
        _file: File,
        options: {
          onProgress?: (progress: {
            phase: 'preflight' | 'parse' | 'validate'
            completed: number
            total: number
          }) => void
        }
      ) => {
        options.onProgress?.({ phase: 'parse', completed: 1, total: 2 })
        return parseResult(officialWorkbook(), 'xlsx')
      }
    )
    renderPanel({ onOpenSingle, onCommitted })

    await user.click(screen.getByRole('button', { name: 'spreadsheet.template.blank' }))
    await user.click(screen.getByRole('button', { name: 'spreadsheet.template.example' }))
    expect(mocks.downloadBlob).toHaveBeenCalledTimes(2)
    expect(mocks.downloadBlob).toHaveBeenNthCalledWith(
      1,
      expect.any(Blob),
      OFFICIAL_TEMPLATE_ASSET_NAMES.blank
    )
    expect(mocks.downloadBlob).toHaveBeenNthCalledWith(
      2,
      expect.any(Blob),
      OFFICIAL_TEMPLATE_ASSET_NAMES.example
    )

    const file = new File([new Uint8Array([80, 75, 3, 4])], 'official.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
    await user.upload(screen.getByLabelText(/spreadsheet\.upload/), file)

    expect(await screen.findByText('spreadsheet.officialDetected')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'spreadsheet.review' }))
    expect(await screen.findByRole('button', { name: 'spreadsheet.prepare' })).not.toBeNull()
    expect(screen.getByText('spreadsheet.validation.noIssues')).not.toBeNull()
    expect(screen.getByText('Review')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'spreadsheet.prepare' }))
    expect(await screen.findByText('spreadsheet.plan.ready')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'spreadsheet.commit' }))

    expect(await screen.findByText('spreadsheet.report.committed')).not.toBeNull()
    expect(mocks.prepare).toHaveBeenCalledOnce()
    expect(mocks.execute).toHaveBeenCalledOnce()
    expect(onCommitted).toHaveBeenCalledWith(committedReport)
    expect(mocks.draftRemove).toHaveBeenCalledWith('workspace-1\u001fofficial.xlsx')

    await user.click(screen.getByRole('button', { name: 'spreadsheet.report.download' }))
    expect(mocks.downloadBlob).toHaveBeenCalledTimes(3)
    await user.click(screen.getByRole('button', { name: 'spreadsheet.reset' }))
    expect(screen.queryByText('spreadsheet.officialDetected')).toBeNull()
  })

  it('supports ordinary-sheet mapping edits, draft save, and preset failures', async () => {
    mocks.parse.mockResolvedValue(parseResult(ordinaryWorkbook(), 'csv'))
    mocks.readPreset.mockRejectedValue(
      new SpreadsheetError('invalid-mapping-preset', { location: 'test' })
    )
    renderPanel()

    fireEvent.change(screen.getByLabelText(/spreadsheet\.upload/), {
      target: {
        files: [
          new File(['Workflow,Identifier'], 'ordinary.csv', {
            type: 'text/csv'
          })
        ]
      }
    })
    expect(await screen.findByText('spreadsheet.ordinaryDetected')).not.toBeNull()

    const defaultProcessId = screen.getByLabelText('spreadsheet.mapping.defaultProcessId')
    fireEvent.change(defaultProcessId, { target: { value: 'mapped_process' } })
    fireEvent.change(screen.getByLabelText('spreadsheet.mapping.defaultNameEn'), {
      target: { value: 'Mapped process' }
    })
    fireEvent.change(screen.getByLabelText('spreadsheet.mapping.defaultNameAr'), {
      target: { value: 'عملية مهيأة' }
    })
    fireEvent.change(screen.getByLabelText('spreadsheet.mapping.flowMode'), {
      target: { value: 'numeric-order' }
    })
    fireEvent.change(screen.getByLabelText('spreadsheet.mapping.delimiters'), {
      target: { value: ';' }
    })
    fireEvent.change(screen.getByLabelText(/spreadsheet\.destination\.folder/), {
      target: { value: 'imports' }
    })
    fireEvent.change(screen.getByLabelText('spreadsheet.destination.collision'), {
      target: { value: 'overwrite' }
    })

    fireEvent.click(screen.getByRole('button', { name: 'spreadsheet.mapping.saveDraft' }))
    expect(await screen.findByText('spreadsheet.mapping.draftSaved')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'spreadsheet.mapping.exportPreset' }))
    expect(mocks.downloadPreset).toHaveBeenCalledOnce()

    const presetInput = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept=".json,application/json"]'
    )
    expect(presetInput).not.toBeNull()
    fireEvent.change(presetInput!, {
      target: {
        files: [new File(['{}'], 'preset.json', { type: 'application/json' })]
      }
    })
    expect(await screen.findByText(/spreadsheet\.error\.review/)).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'spreadsheet.review' }))
    expect(await screen.findByText('spreadsheet.validation.title')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'spreadsheet.prepare' })).toBeNull()
  }, 10_000)

  it('reports a parser failure and supports explicit cancellation', async () => {
    const user = userEvent.setup()
    mocks.parse.mockRejectedValueOnce(new Error('corrupt workbook'))
    renderPanel()

    await user.upload(
      screen.getByLabelText(/spreadsheet\.upload/),
      new File(['broken'], 'broken.csv', { type: 'text/csv' })
    )
    expect((await screen.findByRole('alert')).textContent).toContain('spreadsheet.error.parse')

    mocks.parse.mockImplementationOnce(
      async (
        _file: File,
        options: {
          signal: AbortSignal
          onProgress?: (progress: {
            phase: 'preflight' | 'parse' | 'validate'
            completed: number
            total: number
          }) => void
        }
      ) => {
        options.onProgress?.({ phase: 'preflight', completed: 0, total: 1 })
        return await new Promise<BrowserSpreadsheetParseResult>((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => reject(new SpreadsheetError('parse-cancelled')),
            { once: true }
          )
        })
      }
    )
    await user.upload(
      screen.getByLabelText(/spreadsheet\.upload/),
      new File(['pending'], 'pending.csv', { type: 'text/csv' })
    )
    await user.click(await screen.findByRole('button', { name: 'spreadsheet.cancel' }))
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('spreadsheet.cancel')
    )
  })

  it('awaits reviewed XML, keeps writes at zero, then re-prepares the original plan', async () => {
    const user = userEvent.setup()
    mocks.parse.mockResolvedValue(parseResult(officialWorkbook(), 'xlsx'))
    mocks.prepare.mockResolvedValueOnce(translationBlockedPlan).mockResolvedValueOnce(readyPlan)
    let finishReview: ((result: { status: 'completed'; reviewedXml: string }) => void) | undefined
    const onReviewBilingual = vi.fn(
      async () =>
        await new Promise<{ status: 'completed'; reviewedXml: string }>((resolve) => {
          finishReview = resolve
        })
    )
    renderPanel({ onReviewBilingual })

    await user.upload(
      screen.getByLabelText(/spreadsheet\.upload/),
      new File([new Uint8Array([80, 75, 3, 4])], 'official.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      })
    )
    await user.click(await screen.findByRole('button', { name: 'spreadsheet.review' }))
    await user.click(await screen.findByRole('button', { name: 'spreadsheet.prepare' }))
    await user.click(await screen.findByRole('button', { name: 'spreadsheet.translation.handoff' }))

    await waitFor(() => expect(onReviewBilingual).toHaveBeenCalledOnce())
    expect(mocks.prepare).toHaveBeenCalledOnce()
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(finishReview).toBeTypeOf('function')

    finishReview?.({ status: 'completed', reviewedXml: '<reviewed />' })
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('spreadsheet.plan.ready')).not.toBeNull()
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.prepare.mock.calls[1]?.[1]).toMatchObject({
      collisionBehavior: 'rename'
    })
  })

  it('treats bilingual review cancellation as all-or-nothing', async () => {
    const user = userEvent.setup()
    mocks.parse.mockResolvedValue(parseResult(officialWorkbook(), 'xlsx'))
    mocks.prepare.mockResolvedValueOnce(translationBlockedPlan)
    const onReviewBilingual = vi.fn(async () => ({ status: 'cancelled' as const }))
    renderPanel({ onReviewBilingual })

    await user.upload(
      screen.getByLabelText(/spreadsheet\.upload/),
      new File([new Uint8Array([80, 75, 3, 4])], 'official.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      })
    )
    await user.click(await screen.findByRole('button', { name: 'spreadsheet.review' }))
    await user.click(await screen.findByRole('button', { name: 'spreadsheet.prepare' }))
    await user.click(await screen.findByRole('button', { name: 'spreadsheet.translation.handoff' }))

    await waitFor(() => expect(onReviewBilingual).toHaveBeenCalledOnce())
    expect(mocks.prepare).toHaveBeenCalledOnce()
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(screen.getByText('spreadsheet.cancel')).not.toBeNull()
  })

  it('aborts stale work when the workspace changes', async () => {
    const pending = new Promise<BrowserSpreadsheetParseResult>(() => undefined)
    mocks.parse.mockReturnValue(pending)
    const { rerender } = renderPanel()
    fireEvent.change(screen.getByLabelText(/spreadsheet\.upload/), {
      target: {
        files: [new File(['pending'], 'pending.csv', { type: 'text/csv' })]
      }
    })
    expect(await screen.findByRole('button', { name: 'spreadsheet.cancel' })).not.toBeNull()

    rerender(
      <SpreadsheetImportPanel
        workspaceId="workspace-2"
        workspaceAdapter={null}
        onOpenSingle={vi.fn()}
      />
    )
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'spreadsheet.cancel' })).toBeNull()
    )
  })
})

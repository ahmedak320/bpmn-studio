import { describe, expect, it, vi } from 'vitest'

import type {
  MappingPreset,
  ParsedWorkbookData,
  SpreadsheetValidationIssue,
  WorkbookCell
} from './contracts'
import {
  applyGraphInferencePlan,
  assignDeterministicIds,
  createGraphInferencePlan
} from './inference'
import { applySpreadsheetDestinationFolder, computeSpreadsheetModelReview } from './modelReview'
import type {
  SpreadsheetModelReviewInput,
  SpreadsheetModelReviewWorkerResponse
} from './modelReviewProtocol'
import { handleSpreadsheetModelReviewRequest } from './modelReview.worker'
import { buildProcessWorkbookModel } from './modelBuilder'
import { validateProcessWorkbookModel } from './validation'
import { suggestedMappingPreset } from './wizardMapping'

function cells(values: readonly WorkbookCell['value'][]): readonly WorkbookCell[] {
  return values.map((value) => ({ value, rawValue: value }))
}

function reviewInput(): SpreadsheetModelReviewInput {
  const workbook: ParsedWorkbookData = {
    sheets: [
      {
        name: 'Processes',
        rows: [
          cells(['process_id', 'name_en', 'name_ar', 'folder', 'active_language']),
          cells(['leave', 'Leave request', 'طلب إجازة', 'Operations', 'en'])
        ]
      },
      {
        name: 'Steps',
        rows: [
          cells(['process_id', 'step_id', 'order', 'type', 'name_en', 'name_ar']),
          cells(['leave', 'Start_1', 1, 'startEvent', 'Start', 'البداية']),
          cells(['leave', 'Review_1', 2, 'userTask', 'Review', 'مراجعة']),
          cells(['leave', 'End_1', 3, 'endEvent', 'End', 'النهاية'])
        ]
      }
    ]
  }
  const suggested = suggestedMappingPreset(workbook)
  const preset: MappingPreset = {
    ...suggested,
    inference: {
      ...suggested.inference,
      flowMode: 'numeric-order'
    }
  }
  const sourceIssue: SpreadsheetValidationIssue = {
    code: 'source-warning',
    severity: 'warning',
    messageKey: 'spreadsheet.validation.source-warning'
  }
  return {
    workbook,
    buildOptions: {
      fileName: 'leave.xlsx',
      format: 'xlsx',
      preset
    },
    destinationFolder: 'Department',
    knownProcessIds: [],
    sourceIssues: [sourceIssue],
    confirmSyntheticBoundaries: false
  }
}

describe('spreadsheet model review worker core', () => {
  it('matches the existing build, inference, and validation composition', () => {
    const input = reviewInput()
    const progress = vi.fn()

    const actual = computeSpreadsheetModelReview(input, { onProgress: progress })

    const built = buildProcessWorkbookModel(input.workbook, input.buildOptions)
    const destinationModel = applySpreadsheetDestinationFolder(built.model, input.destinationFolder)
    const inference = createGraphInferencePlan(destinationModel, {
      flowMode: input.buildOptions.preset.inference.flowMode
    })
    const additionalIssues = [...(input.sourceIssues ?? []), ...built.issues, ...inference.issues]
    let model = assignDeterministicIds(destinationModel).model
    let ready = false
    if (!inference.issues.some(({ severity }) => severity === 'error')) {
      model = applyGraphInferencePlan(destinationModel, inference, {
        confirmSyntheticBoundaries: false
      })
      ready = true
    }
    const validation = validateProcessWorkbookModel(model, {
      destinationProcessIds: new Set(input.knownProcessIds),
      additionalIssues
    })
    ready = ready && !validation.blocking

    expect(actual).toEqual({
      model,
      inference,
      validation,
      issues: validation.issues,
      additionalIssues,
      skippedRows: built.skippedRows,
      ready
    })
    expect(actual.model.processes[0]?.folder).toBe('Department/Operations')
    expect(actual.model.flows).toHaveLength(2)
    expect(actual.ready).toBe(true)
    expect(progress.mock.calls.map(([value]) => value)).toEqual([
      { phase: 'build-model', completed: 0, total: 5 },
      { phase: 'apply-destination', completed: 1, total: 5 },
      { phase: 'infer-graph', completed: 2, total: 5 },
      { phase: 'apply-inference', completed: 3, total: 5 },
      { phase: 'validate-model', completed: 4, total: 5 },
      { phase: 'validate-model', completed: 5, total: 5 }
    ])
    expect(() => structuredClone(input)).not.toThrow()
    expect(() => structuredClone(actual)).not.toThrow()
  })

  it('stops at a cancellation checkpoint without returning a partial result', () => {
    let checkpoints = 0
    expect(() =>
      computeSpreadsheetModelReview(reviewInput(), {
        isCancelled: () => {
          checkpoints += 1
          return checkpoints === 4
        }
      })
    ).toThrowError(
      expect.objectContaining({
        code: 'parse-cancelled'
      })
    )
  })

  it('emits staged worker progress and sanitizes arbitrary core failures', () => {
    const input = reviewInput()
    const responses: SpreadsheetModelReviewWorkerResponse[] = []
    handleSpreadsheetModelReviewRequest(
      { type: 'review', requestId: 'review-ok', input },
      (response) => responses.push(response)
    )
    expect(responses.filter(({ type }) => type === 'progress')).toHaveLength(6)
    expect(responses.at(-1)).toMatchObject({
      type: 'result',
      requestId: 'review-ok',
      result: { ready: true }
    })

    const invalidInput = {
      ...input,
      buildOptions: {
        ...input.buildOptions,
        preset: {
          ...input.buildOptions.preset,
          version: 999
        }
      }
    } as unknown as SpreadsheetModelReviewInput
    const failures: SpreadsheetModelReviewWorkerResponse[] = []
    handleSpreadsheetModelReviewRequest(
      { type: 'review', requestId: 'review-bad', input: invalidInput },
      (response) => failures.push(response)
    )
    expect(failures.at(-1)).toEqual({
      type: 'error',
      requestId: 'review-bad',
      code: 'adapter-contract-violation',
      details: { contract: 'spreadsheet-model-review-worker' }
    })
    expect(JSON.stringify(failures)).not.toContain('Unsupported mapping preset version')
  })
})

import { type ProcessWorkbookModel, type SpreadsheetValidationIssue } from './contracts'
import { SpreadsheetError } from './errors'
import {
  applyGraphInferencePlan,
  assignDeterministicIds,
  createGraphInferencePlan
} from './inference'
import { buildProcessWorkbookModel } from './modelBuilder'
import {
  SPREADSHEET_MODEL_REVIEW_STAGE_COUNT,
  type SpreadsheetModelReviewInput,
  type SpreadsheetModelReviewPhase,
  type SpreadsheetModelReviewProgress,
  type SpreadsheetModelReviewResult
} from './modelReviewProtocol'
import { validateProcessWorkbookModel } from './validation'
import { spreadsheetValidationMessageKey } from './issueCatalog'

export interface ComputeSpreadsheetModelReviewOptions {
  readonly onProgress?: (progress: SpreadsheetModelReviewProgress) => void
  /**
   * A worker is force-terminated by the browser wrapper on cancellation. This
   * hook also makes the pure pipeline stop cleanly between stages in direct
   * runtimes and deterministic tests.
   */
  readonly isCancelled?: () => boolean
}

export function applySpreadsheetDestinationFolder(
  model: ProcessWorkbookModel,
  destinationFolder: string
): ProcessWorkbookModel {
  const prefix = destinationFolder.trim().replace(/\/+$/g, '')
  if (!prefix) return model
  return Object.freeze({
    ...model,
    processes: Object.freeze(
      model.processes.map((process) =>
        Object.freeze({
          ...process,
          folder: process.folder ? `${prefix}/${process.folder.replace(/^\/+/g, '')}` : prefix
        })
      )
    )
  })
}

function syntheticConfirmationIssue(
  required: boolean,
  confirmed: boolean
): readonly SpreadsheetValidationIssue[] {
  if (!required || confirmed) return Object.freeze([])
  return Object.freeze([
    Object.freeze({
      code: 'synthetic-boundary-confirmation-required',
      severity: 'review',
      messageKey: spreadsheetValidationMessageKey('synthetic-boundary-confirmation-required')
    })
  ])
}

export function computeSpreadsheetModelReview(
  input: SpreadsheetModelReviewInput,
  options: ComputeSpreadsheetModelReviewOptions = {}
): SpreadsheetModelReviewResult {
  let completed = 0
  const checkpoint = (phase: SpreadsheetModelReviewPhase): void => {
    if (options.isCancelled?.()) throw new SpreadsheetError('parse-cancelled')
    options.onProgress?.(
      Object.freeze({
        phase,
        completed,
        total: SPREADSHEET_MODEL_REVIEW_STAGE_COUNT
      })
    )
  }
  const complete = (): void => {
    completed += 1
    if (options.isCancelled?.()) throw new SpreadsheetError('parse-cancelled')
  }

  checkpoint('build-model')
  const built = buildProcessWorkbookModel(input.workbook, input.buildOptions)
  complete()

  checkpoint('apply-destination')
  const destinationModel = applySpreadsheetDestinationFolder(built.model, input.destinationFolder)
  complete()

  checkpoint('infer-graph')
  const inference = createGraphInferencePlan(destinationModel, {
    flowMode: input.buildOptions.preset.inference.flowMode
  })
  complete()

  checkpoint('apply-inference')
  const confirmationIssues = syntheticConfirmationIssue(
    inference.requiresSyntheticBoundaryConfirmation,
    input.confirmSyntheticBoundaries
  )
  const additionalIssues = Object.freeze([
    ...(input.sourceIssues ?? []),
    ...built.issues,
    ...inference.issues,
    ...confirmationIssues
  ])
  let model = assignDeterministicIds(destinationModel).model
  let ready = false
  if (
    !inference.issues.some(({ severity }) => severity === 'error') &&
    (input.confirmSyntheticBoundaries || !inference.requiresSyntheticBoundaryConfirmation)
  ) {
    model = applyGraphInferencePlan(destinationModel, inference, {
      confirmSyntheticBoundaries: input.confirmSyntheticBoundaries
    })
    ready = true
  }
  complete()

  checkpoint('validate-model')
  const validation = validateProcessWorkbookModel(model, {
    destinationProcessIds: new Set(input.knownProcessIds),
    additionalIssues
  })
  ready = ready && !validation.blocking
  complete()
  options.onProgress?.(
    Object.freeze({
      phase: 'validate-model',
      completed,
      total: SPREADSHEET_MODEL_REVIEW_STAGE_COUNT
    })
  )

  return Object.freeze({
    model,
    inference,
    validation,
    issues: validation.issues,
    additionalIssues,
    skippedRows: built.skippedRows,
    ready
  })
}

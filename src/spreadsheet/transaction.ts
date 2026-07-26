import {
  type BpmnModelGenerationAdapter,
  type CollisionBehavior,
  type GeneratedIdRecord,
  type ImportDestination,
  type ImportDestinationInspector,
  type ImportReportArtifact,
  type ImportTransactionFactory,
  type InferredFlowRecord,
  type MappingPreset,
  type PreparedImportArtifact,
  type ProcessGraphModel,
  type ProcessWorkbookModel,
  type RecordProvenance,
  type SpreadsheetBilingualAuditAdapter,
  type SpreadsheetImportReport,
  type SpreadsheetValidationIssue,
  type TransactionalImportPlan,
  type WorkspaceDeliveryMode
} from './contracts'
import { SpreadsheetError, throwIfAborted } from './errors'
import { sha256Hex, stableHash } from './hash'
import { parseMappingPresetJson, serializeMappingPreset } from './mappingPreset'
import { validateProcessWorkbookModel } from './validation'

export interface PrepareTransactionalImportOptions {
  readonly mode: WorkspaceDeliveryMode
  readonly collisionBehavior: CollisionBehavior
  readonly inspector: ImportDestinationInspector
  readonly generator: BpmnModelGenerationAdapter
  readonly bilingualAudit: SpreadsheetBilingualAuditAdapter
  readonly destinationProcessIds?: ReadonlySet<string>
  readonly additionalIssues?: readonly SpreadsheetValidationIssue[]
  readonly generatedIds?: readonly GeneratedIdRecord[]
  readonly inferredFlows?: readonly InferredFlowRecord[]
  readonly skippedRows?: readonly RecordProvenance[]
  readonly mappingPreset?: MappingPreset
  readonly signal?: AbortSignal
  readonly now?: () => Date
}

export interface ExecuteTransactionalImportOptions {
  readonly transactionFactory: ImportTransactionFactory
  readonly now?: () => Date
}

function safeSlug(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .toLocaleLowerCase('en-US')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  const base = normalized || `process-${stableHash(value).slice(0, 8)}`
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)
    ? `${base}-file`
    : base
}

function pathForProcess(
  process: ProcessWorkbookModel['processes'][number],
  suffix?: number
): string {
  const displayName =
    process.activeLanguage === 'ar'
      ? process.name.ar || process.name.en || process.id
      : process.name.en || process.name.ar || process.id
  const slug = safeSlug(displayName)
  const file = `${slug}${suffix && suffix > 1 ? `-${suffix}` : ''}.bpmn`
  return process.folder ? `${process.folder.replace(/\/+$/g, '')}/${file}` : file
}

function graphForProcess(model: ProcessWorkbookModel, processId: string): ProcessGraphModel {
  const process = model.processes.find((candidate) => candidate.id === processId)
  if (!process) throw new TypeError(`Unknown process ${processId}`)
  return Object.freeze({
    process,
    participants: Object.freeze(
      model.participants.filter((participant) => participant.processId === processId)
    ),
    nodes: Object.freeze(model.nodes.filter((node) => node.processId === processId)),
    flows: Object.freeze(model.flows.filter((flow) => flow.processId === processId)),
    glossary: model.glossary
  })
}

async function inspectOne(
  inspector: ImportDestinationInspector,
  path: string
): Promise<{ readonly exists: boolean; readonly hash?: string }> {
  const states = await inspector.inspect([path])
  const state = states.find((candidate) => candidate.path === path)
  if (!state) {
    throw new SpreadsheetError('adapter-contract-violation', {
      contract: 'destination-inspector',
      path
    })
  }
  return state
}

async function resolveDestinations(
  model: ProcessWorkbookModel,
  behavior: CollisionBehavior,
  inspector: ImportDestinationInspector,
  issues: SpreadsheetValidationIssue[]
): Promise<readonly ImportDestination[]> {
  const claimed = new Set<string>()
  const destinations: ImportDestination[] = []
  for (const process of model.processes) {
    let suffix = 1
    let path = pathForProcess(process)
    let state = await inspectOne(inspector, path)
    while ((state.exists || claimed.has(path)) && behavior === 'rename') {
      suffix += 1
      path = pathForProcess(process, suffix)
      state = await inspectOne(inspector, path)
      if (suffix > 10_000) {
        throw new SpreadsheetError('adapter-contract-violation', {
          contract: 'collision-rename-limit'
        })
      }
    }
    if (claimed.has(path) || (state.exists && behavior === 'error')) {
      issues.push({
        code: 'destination-path-collision',
        severity: 'error',
        messageKey: 'spreadsheet.validation.destination-path-collision',
        guidanceKey: 'spreadsheet.guidance.choose-collision-behavior',
        processId: process.id,
        worksheet: process.provenance.worksheet,
        cellAddress: process.provenance.fields?.folder?.address,
        rawValue: path
      })
      continue
    }
    if (state.exists && behavior === 'overwrite' && !state.hash) {
      issues.push({
        code: 'destination-hash-missing',
        severity: 'error',
        messageKey: 'spreadsheet.validation.destination-hash-missing',
        guidanceKey: 'spreadsheet.guidance.refresh-destination-state',
        processId: process.id,
        worksheet: process.provenance.worksheet,
        rawValue: path
      })
      continue
    }
    const overwrite = state.exists && behavior === 'overwrite'
    destinations.push(
      Object.freeze({
        processId: process.id,
        path,
        behavior: overwrite ? 'overwrite' : 'create',
        ...(overwrite && state.hash ? { expectedHash: state.hash } : {})
      })
    )
    claimed.add(path)
  }
  return Object.freeze(destinations)
}

function validationIssueFromPipeline(
  processId: string,
  diagnostics: Awaited<
    ReturnType<BpmnModelGenerationAdapter['generate']>
  >['diagnostics']
): readonly SpreadsheetValidationIssue[] {
  return Object.freeze(
    diagnostics.map(
      (diagnostic): SpreadsheetValidationIssue => ({
        code: `pipeline-${diagnostic.stage}-${diagnostic.code}`,
        severity: diagnostic.severity,
        messageKey:
          `spreadsheet.validation.pipeline-${diagnostic.stage}-${diagnostic.code}` as const,
        processId,
        ...(diagnostic.details ? { details: diagnostic.details } : {})
      })
    )
  )
}

function blockedPlan(
  model: ProcessWorkbookModel,
  createdAt: string,
  validation: ReturnType<typeof validateProcessWorkbookModel>,
  options: PrepareTransactionalImportOptions,
  reason: TransactionalImportPlan['blockingReason'],
  artifacts: readonly PreparedImportArtifact[] = []
): TransactionalImportPlan {
  const sanitizedPreset = options.mappingPreset
    ? parseMappingPresetJson(serializeMappingPreset(options.mappingPreset))
    : undefined
  return Object.freeze({
    version: 1,
    id: `import-${stableHash(`${model.source.fileName}\u001f${createdAt}`)}`,
    createdAt,
    sourceFile: model.source.fileName,
    status: 'blocked',
    mode: options.mode,
    delivery:
      options.mode === 'single-file'
        ? model.processes.length === 1
          ? 'open-single'
          : 'zip'
        : 'workspace',
    validation,
    artifacts: Object.freeze(artifacts),
    generatedIds: Object.freeze([...(options.generatedIds ?? [])]),
    inferredFlows: Object.freeze([...(options.inferredFlows ?? [])]),
    warnings: Object.freeze(
      validation.issues.filter(({ severity }) => severity === 'warning')
    ),
    skippedRows: Object.freeze([...(options.skippedRows ?? [])]),
    ...(sanitizedPreset ? { mappingPreset: sanitizedPreset } : {}),
    blockingReason: reason
  })
}

/**
 * Prepare every artifact before opening a destination transaction. A blocking
 * model, translation, collision, or pipeline diagnostic therefore produces a
 * read-only preview/report and zero writes.
 */
export async function prepareTransactionalImportPlan(
  model: ProcessWorkbookModel,
  options: PrepareTransactionalImportOptions
): Promise<TransactionalImportPlan> {
  const now = options.now ?? (() => new Date())
  const createdAt = now().toISOString()
  throwIfAborted(options.signal)
  let validation = validateProcessWorkbookModel(model, {
    destinationProcessIds: options.destinationProcessIds,
    additionalIssues: options.additionalIssues
  })
  if (validation.blocking) {
    return blockedPlan(model, createdAt, validation, options, 'blocking-validation')
  }

  const collisionIssues: SpreadsheetValidationIssue[] = []
  let destinations: readonly ImportDestination[]
  try {
    destinations = await resolveDestinations(
      model,
      options.collisionBehavior,
      options.inspector,
      collisionIssues
    )
  } catch {
    collisionIssues.push({
      code: 'destination-inspection-failed',
      severity: 'error',
      messageKey: 'spreadsheet.validation.destination-inspection-failed',
      guidanceKey: 'spreadsheet.guidance.retry-destination-inspection'
    })
    destinations = Object.freeze([])
  }
  throwIfAborted(options.signal)
  if (collisionIssues.length > 0) {
    validation = validateProcessWorkbookModel(model, {
      destinationProcessIds: options.destinationProcessIds,
      additionalIssues: [...(options.additionalIssues ?? []), ...collisionIssues]
    })
    return blockedPlan(model, createdAt, validation, options, 'blocking-validation')
  }

  const auditByProcess = new Map<
    string,
    {
      readonly graph: ProcessGraphModel
      readonly summary: ReturnType<SpreadsheetBilingualAuditAdapter['audit']>
    }
  >()
  const auditFailures: SpreadsheetValidationIssue[] = []
  for (const process of model.processes) {
    const graph = graphForProcess(model, process.id)
    try {
      auditByProcess.set(process.id, {
        graph,
        summary: options.bilingualAudit.audit(graph)
      })
    } catch {
      auditFailures.push({
        code: 'bilingual-audit-failed',
        severity: 'error',
        messageKey: 'spreadsheet.validation.bilingual-audit-failed',
        processId: process.id,
        worksheet: process.provenance.worksheet
      })
    }
  }
  if (auditFailures.length > 0) {
    validation = validateProcessWorkbookModel(model, {
      destinationProcessIds: options.destinationProcessIds,
      additionalIssues: [...(options.additionalIssues ?? []), ...auditFailures]
    })
    return blockedPlan(model, createdAt, validation, options, 'translation-review')
  }
  const incomplete = [...auditByProcess.values()].filter(({ summary }) => !summary.complete)
  if (incomplete.length > 0) {
    const auditIssues: SpreadsheetValidationIssue[] = incomplete.map(({ graph, summary }) => ({
      code: 'translation-review-required',
      severity: 'review',
      messageKey: 'spreadsheet.validation.translation-review-required',
      processId: graph.process.id,
      worksheet: graph.process.provenance.worksheet,
      details: { missing: summary.missing, invalid: summary.invalid }
    }))
    validation = validateProcessWorkbookModel(model, {
      destinationProcessIds: options.destinationProcessIds,
      additionalIssues: [...(options.additionalIssues ?? []), ...auditIssues]
    })
    return blockedPlan(model, createdAt, validation, options, 'translation-review')
  }

  const prepared: PreparedImportArtifact[] = []
  const pipelineIssues: SpreadsheetValidationIssue[] = []
  for (const process of model.processes) {
    throwIfAborted(options.signal)
    const audit = auditByProcess.get(process.id)!
    try {
      const generated = await options.generator.generate(audit.graph, options.signal)
      if (
        generated.processId !== process.id ||
        !(generated.bytes instanceof Uint8Array) ||
        generated.bytes.length === 0
      ) {
        throw new SpreadsheetError('adapter-contract-violation', {
          contract: 'bpmn-generator',
          processId: process.id
        })
      }
      const diagnostics = validationIssueFromPipeline(process.id, generated.diagnostics)
      pipelineIssues.push(...diagnostics)
      const destination = destinations.find(
        (candidate) => candidate.processId === process.id
      )
      if (!destination) {
        throw new SpreadsheetError('adapter-contract-violation', {
          contract: 'destination-resolution',
          processId: process.id
        })
      }
      prepared.push(
        Object.freeze({
          graph: audit.graph,
          generated,
          destination,
          checksumSha256: sha256Hex(generated.bytes),
          translation: audit.summary
        })
      )
    } catch (cause) {
      if (cause instanceof SpreadsheetError && cause.code === 'parse-cancelled') throw cause
      pipelineIssues.push({
        code: 'pipeline-generation-failed',
        severity: 'error',
        messageKey: 'spreadsheet.validation.pipeline-generation-failed',
        processId: process.id
      })
    }
  }
  if (pipelineIssues.some(({ severity }) => severity === 'error')) {
    validation = validateProcessWorkbookModel(model, {
      destinationProcessIds: options.destinationProcessIds,
      additionalIssues: [...(options.additionalIssues ?? []), ...pipelineIssues]
    })
    return blockedPlan(
      model,
      createdAt,
      validation,
      options,
      'pipeline-validation',
      prepared
    )
  }
  validation = validateProcessWorkbookModel(model, {
    destinationProcessIds: options.destinationProcessIds,
    additionalIssues: [...(options.additionalIssues ?? []), ...pipelineIssues]
  })
  if (validation.blocking) {
    return blockedPlan(
      model,
      createdAt,
      validation,
      options,
      'pipeline-validation',
      prepared
    )
  }
  const sanitizedPreset = options.mappingPreset
    ? parseMappingPresetJson(serializeMappingPreset(options.mappingPreset))
    : undefined
  const planId = `import-${stableHash(
    JSON.stringify({
      source: model.source.fileName,
      createdAt,
      artifacts: prepared.map(({ destination, checksumSha256 }) => ({
        path: destination.path,
        checksumSha256
      }))
    })
  )}`
  return Object.freeze({
    version: 1,
    id: planId,
    createdAt,
    sourceFile: model.source.fileName,
    status: 'ready',
    mode: options.mode,
    delivery:
      options.mode === 'single-file'
        ? model.processes.length === 1
          ? 'open-single'
          : 'zip'
        : 'workspace',
    validation,
    artifacts: Object.freeze(prepared),
    generatedIds: Object.freeze([...(options.generatedIds ?? [])]),
    inferredFlows: Object.freeze([...(options.inferredFlows ?? [])]),
    warnings: Object.freeze(
      validation.issues.filter(({ severity }) => severity === 'warning')
    ),
    skippedRows: Object.freeze([...(options.skippedRows ?? [])]),
    ...(sanitizedPreset ? { mappingPreset: sanitizedPreset } : {})
  })
}

function reportArtifacts(plan: TransactionalImportPlan): readonly ImportReportArtifact[] {
  return Object.freeze(
    plan.artifacts.map((artifact) =>
      Object.freeze({
        processId: artifact.graph.process.id,
        destinationPath: artifact.destination.path,
        checksumSha256: artifact.checksumSha256,
        bytes: artifact.generated.bytes.length,
        translation: artifact.translation
      })
    )
  )
}

function makeReport(
  plan: TransactionalImportPlan,
  startedAt: string,
  completedAt: string,
  status: SpreadsheetImportReport['status'],
  failure?: SpreadsheetImportReport['failure']
): SpreadsheetImportReport {
  return Object.freeze({
    reportVersion: 1,
    planId: plan.id,
    sourceFile: plan.sourceFile,
    startedAt,
    completedAt,
    status,
    ...(plan.mappingPreset ? { mapping: plan.mappingPreset } : {}),
    generatedIds: plan.generatedIds,
    inferredFlows: plan.inferredFlows,
    issues: plan.validation.issues,
    skippedRows: plan.skippedRows,
    artifacts: reportArtifacts(plan),
    ...(failure ? { failure } : {})
  })
}

/**
 * Executes the already-reviewed plan through one adapter-owned atomic
 * transaction. Core never reports success until commit resolves.
 */
export async function executeTransactionalImportPlan(
  plan: TransactionalImportPlan,
  options: ExecuteTransactionalImportOptions
): Promise<SpreadsheetImportReport> {
  const now = options.now ?? (() => new Date())
  const startedAt = now().toISOString()
  if (plan.status !== 'ready') {
    return makeReport(plan, startedAt, now().toISOString(), 'blocked', {
      code: 'blocking-validation',
      stage: 'prepare'
    })
  }
  let transaction: Awaited<ReturnType<ImportTransactionFactory['begin']>>
  try {
    transaction = await options.transactionFactory.begin(plan.id)
  } catch {
    return makeReport(plan, startedAt, now().toISOString(), 'rolled-back', {
      code: 'transaction-failed',
      stage: 'stage'
    })
  }
  let failureStage: 'stage' | 'commit' = 'stage'
  try {
    for (const artifact of plan.artifacts) {
      await transaction.stage({
        path: artifact.destination.path,
        bytes: artifact.generated.bytes,
        expectedHash: artifact.destination.expectedHash,
        createRecoveryRevision: artifact.destination.behavior === 'overwrite'
      })
    }
    failureStage = 'commit'
    await transaction.commit()
    return makeReport(plan, startedAt, now().toISOString(), 'committed')
  } catch {
    try {
      await transaction.rollback()
      return makeReport(plan, startedAt, now().toISOString(), 'rolled-back', {
        code: 'transaction-failed',
        stage: failureStage
      })
    } catch {
      return makeReport(plan, startedAt, now().toISOString(), 'rollback-failed', {
        code: 'transaction-failed',
        stage: 'rollback'
      })
    }
  }
}

function sortForJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForJson)
  if (value === null || typeof value !== 'object' || value instanceof Date) return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, entry]) => [key, sortForJson(entry)])
  )
}

export function serializeSpreadsheetImportReport(report: SpreadsheetImportReport): string {
  return `${JSON.stringify(sortForJson(report), null, 2)}\n`
}

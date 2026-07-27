import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import { t, type Lang } from '../i18n'
import { useLang } from '../i18n/useLang'
import type { WorkspaceAdapter } from '../workspace/adapters'
import type { PortableHistoryManager } from '../workspace/history'
import {
  CANONICAL_FIELDS_BY_SHEET,
  REQUIRED_FIELDS_BY_SHEET,
  normalizeHeader,
  requiredFieldGroupForSheet
} from './aliases'
import { SpreadsheetBilingualAudit, SpreadsheetBpmnGenerator } from './bpmnGeneration'
import {
  BrowserMappingDraftStore,
  downloadMappingPreset,
  mappingDraftKey,
  readMappingPresetFile
} from './browserDraftStore'
import {
  parseBrowserSpreadsheet,
  type BrowserSpreadsheetParseResult
} from './browserParserAdapters'
import { runSpreadsheetModelReview } from './browserModelReview'
import {
  SPREADSHEET_MODEL_REVIEW_STAGE_COUNT,
  type SpreadsheetModelReviewProgress
} from './modelReviewProtocol'
import {
  BPMN_NODE_TYPES,
  type BpmnNodeType,
  type CanonicalSheet,
  type CollisionBehavior,
  type GraphInferencePlan,
  type MappingPreset,
  type ParticipantType,
  type ProcessWorkbookModel,
  type RecordProvenance,
  type SpreadsheetImportProgress,
  type SpreadsheetImportReport,
  type SpreadsheetValidationIssue,
  type TransactionalImportPlan,
  type WorkbookValidationReport
} from './contracts'
import {
  reviewProcessWorkbookBilingual,
  type SpreadsheetBilingualReviewCallback
} from './bilingualReview'
import {
  BrowserImportDeliveryTransactionFactory,
  EmptySpreadsheetDestinationInspector,
  WorkspaceImportTransactionFactory,
  WorkspaceSpreadsheetDestinationInspector,
  downloadSpreadsheetBlob,
  type WorkspaceSpreadsheetExclusiveRunner
} from './destinationAdapters'
import { SpreadsheetError } from './errors'
import {
  LOW_CONFIDENCE_REQUIRED_THRESHOLD,
  headerSignature,
  suggestHeaderMappings
} from './mapping'
import { presetMatchesHeaderSignatures } from './mappingPreset'
import { officialTemplatePreset } from './modelBuilder'
import { detectOfficialTemplate } from './officialTemplate'
import { SpreadsheetTopologyPreview } from './SpreadsheetTopologyPreview'
import { SpreadsheetValidationIssueList } from './SpreadsheetValidationIssueList'
import {
  executeTransactionalImportPlan,
  prepareTransactionalImportPlan,
  serializeSpreadsheetImportReport
} from './transaction'
import { createOfficialWorkbookTemplate, OFFICIAL_TEMPLATE_ASSET_NAMES } from './template'
import { validateProcessWorkbookModel } from './validation'
import {
  WIZARD_SHEET_ROLES,
  allMappedRequiredFields,
  headersForSelection,
  mappingReviewIssues,
  suggestedMappingPreset
} from './wizardMapping'

export interface SpreadsheetFolderOption {
  readonly relPath: string
  readonly label: string
}

export interface SpreadsheetImportPanelProps {
  readonly workspaceId: string
  readonly workspaceAdapter: WorkspaceAdapter | null
  readonly folders?: readonly SpreadsheetFolderOption[]
  readonly knownProcessIds?: readonly string[]
  readonly getCurrentWorkspaceId?: () => string | undefined
  readonly runWorkspaceExclusive?: WorkspaceSpreadsheetExclusiveRunner
  /** Reuse the App's bounded portable history for overwrite recovery. */
  readonly historyManager?: PortableHistoryManager | null
  readonly onOpenSingle: (xml: string, name: string) => void | Promise<void>
  /**
   * Awaited review protocol. The callback resolves only after the user
   * explicitly completes or cancels the named process review.
   */
  readonly onReviewBilingual?: SpreadsheetBilingualReviewCallback
  /**
   * @deprecated Compatibility placeholder for the old fire-and-forget App
   * integration. The panel intentionally never invokes it because opening an
   * orphan tab cannot complete an import transaction.
   */
  readonly onOpenBilingualReview?: (xml: string, name: string) => void | Promise<void>
  readonly onCommitted?: (report: SpreadsheetImportReport) => void | Promise<void>
}

interface WorkbookReview {
  readonly model?: ProcessWorkbookModel
  readonly inference?: GraphInferencePlan
  readonly validation?: WorkbookValidationReport
  readonly issues: readonly SpreadsheetValidationIssue[]
  readonly additionalIssues: readonly SpreadsheetValidationIssue[]
  readonly skippedRows: readonly RecordProvenance[]
  readonly ready: boolean
}

type PanelPhase =
  | 'idle'
  | 'parsing'
  | 'mapping'
  | 'reviewing'
  | 'review'
  | 'preparing'
  | 'plan'
  | 'committing'
  | 'report'

const draftStore = new BrowserMappingDraftStore()

interface SpreadsheetPanelError {
  readonly summary: string
  readonly context?: string
  readonly technical?: {
    readonly code: string
    readonly details?: string
  }
}

function localizedErrorDetails(
  details: SpreadsheetError['details'],
  lang: Lang
): Record<string, string | number> {
  const numberFormat = new Intl.NumberFormat(lang)
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      typeof value === 'number' ? numberFormat.format(value) : String(value)
    ])
  )
}

function panelError(error: unknown, fallback: string, lang: Lang): SpreadsheetPanelError {
  if (!(error instanceof SpreadsheetError)) {
    return { summary: fallback }
  }

  const details = localizedErrorDetails(error.details, lang)
  const actual = error.details.actual
  const limit = error.details.limit
  const row = error.details.row
  let context: string | undefined
  if (
    typeof actual === 'number' &&
    Number.isFinite(actual) &&
    typeof limit === 'number' &&
    Number.isFinite(limit)
  ) {
    context = t('spreadsheet.error.limitContext', {
      actual: details.actual!,
      limit: details.limit!
    })
  } else if (error.code === 'malformed-csv' && typeof row === 'number' && Number.isFinite(row)) {
    context = t('spreadsheet.error.rowContext', { row: details.row! })
  }

  const hasDetails = Object.keys(error.details).length > 0
  return {
    summary: t(error.messageKey, details),
    context,
    technical: {
      code: error.code,
      details: hasDetails ? JSON.stringify(error.details) : undefined
    }
  }
}

function progressPhase(
  phase:
    | 'preflight'
    | 'parse'
    | 'validate'
    | SpreadsheetModelReviewProgress['phase']
    | SpreadsheetImportProgress['phase']
): string {
  switch (phase) {
    case 'preflight':
      return t('spreadsheet.phase.preflight')
    case 'parse':
      return t('spreadsheet.phase.parse')
    case 'validate':
      return t('spreadsheet.phase.validate')
    case 'build-model':
      return t('spreadsheet.phase.buildModel')
    case 'apply-destination':
      return t('spreadsheet.phase.applyDestination')
    case 'infer-graph':
      return t('spreadsheet.phase.inferGraph')
    case 'apply-inference':
      return t('spreadsheet.phase.applyInference')
    case 'validate-model':
      return t('spreadsheet.phase.validateModel')
    case 'generate':
      return t('spreadsheet.phase.generate')
    case 'stage':
      return t('spreadsheet.phase.stage')
    case 'commit':
      return t('spreadsheet.phase.commit')
    case 'rollback':
      return t('spreadsheet.phase.rollback')
  }
}

function stepTypeLabel(type: BpmnNodeType): string {
  const keys: Readonly<Record<BpmnNodeType, Parameters<typeof t>[0]>> = {
    task: 'spreadsheet.type.task',
    userTask: 'spreadsheet.type.userTask',
    serviceTask: 'spreadsheet.type.serviceTask',
    sendTask: 'spreadsheet.type.sendTask',
    receiveTask: 'spreadsheet.type.receiveTask',
    businessRuleTask: 'spreadsheet.type.businessRuleTask',
    manualTask: 'spreadsheet.type.manualTask',
    scriptTask: 'spreadsheet.type.scriptTask',
    callActivity: 'spreadsheet.type.callActivity',
    subProcess: 'spreadsheet.type.subProcess',
    startEvent: 'spreadsheet.type.startEvent',
    endEvent: 'spreadsheet.type.endEvent',
    intermediateCatchEvent: 'spreadsheet.type.intermediateCatchEvent',
    intermediateThrowEvent: 'spreadsheet.type.intermediateThrowEvent',
    exclusiveGateway: 'spreadsheet.type.exclusiveGateway',
    inclusiveGateway: 'spreadsheet.type.inclusiveGateway',
    parallelGateway: 'spreadsheet.type.parallelGateway',
    complexGateway: 'spreadsheet.type.complexGateway',
    eventBasedGateway: 'spreadsheet.type.eventBasedGateway'
  }
  return t(keys[type])
}

function participantTypeLabel(type: ParticipantType): string {
  return type === 'lane' ? t('spreadsheet.type.lane') : t('spreadsheet.type.pool')
}

function spreadsheetSourceIdentity(file: Pick<File, 'size' | 'lastModified'>): string {
  return `${file.size}:${file.lastModified}`
}

function downloadWorkbookTemplate(kind: 'blank' | 'example'): void {
  const generated = createOfficialWorkbookTemplate(kind)
  const owned = new Uint8Array(generated.byteLength)
  owned.set(generated)
  const blob = new Blob([owned.buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
  downloadSpreadsheetBlob(blob, OFFICIAL_TEMPLATE_ASSET_NAMES[kind])
}

function downloadReport(report: SpreadsheetImportReport): void {
  const blob = new Blob([serializeSpreadsheetImportReport(report)], {
    type: 'application/json'
  })
  downloadSpreadsheetBlob(blob, `orbitpm-import-report-${report.planId}.json`)
}

export function SpreadsheetImportPanel({
  workspaceId,
  workspaceAdapter,
  folders = [],
  knownProcessIds = [],
  getCurrentWorkspaceId,
  runWorkspaceExclusive,
  historyManager,
  onOpenSingle,
  onReviewBilingual,
  onCommitted
}: SpreadsheetImportPanelProps): JSX.Element {
  const lang = useLang()
  const [phase, setPhase] = useState<PanelPhase>('idle')
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<BrowserSpreadsheetParseResult | null>(null)
  const [parseIssues, setParseIssues] = useState<readonly SpreadsheetValidationIssue[]>([])
  const [official, setOfficial] = useState(false)
  const [templateVersion, setTemplateVersion] = useState<string | undefined>()
  const [preset, setPreset] = useState<MappingPreset | null>(null)
  const [confirmedMappings, setConfirmedMappings] = useState<ReadonlySet<string>>(new Set())
  const [defaultProcessId, setDefaultProcessId] = useState('process_1')
  const [defaultNameEn, setDefaultNameEn] = useState('')
  const [defaultNameAr, setDefaultNameAr] = useState('')
  const [destinationFolder, setDestinationFolder] = useState('')
  const [collisionBehavior, setCollisionBehavior] = useState<CollisionBehavior>('rename')
  const [syntheticConfirmed, setSyntheticConfirmed] = useState(false)
  const [review, setReview] = useState<WorkbookReview | null>(null)
  const [plan, setPlan] = useState<TransactionalImportPlan | null>(null)
  const [report, setReport] = useState<SpreadsheetImportReport | null>(null)
  const [progress, setProgress] = useState<{
    phase:
      | 'preflight'
      | 'parse'
      | 'validate'
      | SpreadsheetModelReviewProgress['phase']
      | SpreadsheetImportProgress['phase']
    completed: number
    total: number
  } | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<SpreadsheetPanelError | null>(null)
  const [handoffBusy, setHandoffBusy] = useState(false)
  const [cancelRequested, setCancelRequested] = useState(false)
  const parserAbortRef = useRef<AbortController | null>(null)
  const reviewAbortRef = useRef<AbortController | null>(null)
  const preparationAbortRef = useRef<AbortController | null>(null)
  const commitAbortRef = useRef<AbortController | null>(null)
  const taskVersionRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const presetInputRef = useRef<HTMLInputElement | null>(null)

  const multipleFiles = workspaceAdapter?.storage.capabilities.multipleFiles === true
  const draftKey = sourceFile === null ? null : mappingDraftKey(workspaceId, sourceFile.name)

  const reset = (): void => {
    taskVersionRef.current += 1
    parserAbortRef.current?.abort()
    parserAbortRef.current = null
    reviewAbortRef.current?.abort()
    reviewAbortRef.current = null
    preparationAbortRef.current?.abort()
    preparationAbortRef.current = null
    commitAbortRef.current?.abort()
    commitAbortRef.current = null
    setPhase('idle')
    setSourceFile(null)
    setParsed(null)
    setParseIssues([])
    setOfficial(false)
    setTemplateVersion(undefined)
    setPreset(null)
    setConfirmedMappings(new Set())
    setDefaultProcessId('process_1')
    setDefaultNameEn('')
    setDefaultNameAr('')
    setDestinationFolder('')
    setCollisionBehavior('rename')
    setSyntheticConfirmed(false)
    setReview(null)
    setPlan(null)
    setReport(null)
    setProgress(null)
    setStatus(null)
    setError(null)
    setCancelRequested(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  useEffect(() => {
    taskVersionRef.current += 1
    parserAbortRef.current?.abort()
    parserAbortRef.current = null
    reviewAbortRef.current?.abort()
    reviewAbortRef.current = null
    preparationAbortRef.current?.abort()
    preparationAbortRef.current = null
    commitAbortRef.current?.abort()
    commitAbortRef.current = null
    setPhase('idle')
    setSourceFile(null)
    setParsed(null)
    setParseIssues([])
    setOfficial(false)
    setTemplateVersion(undefined)
    setPreset(null)
    setConfirmedMappings(new Set())
    setDefaultProcessId('process_1')
    setDefaultNameEn('')
    setDefaultNameAr('')
    setDestinationFolder('')
    setCollisionBehavior('rename')
    setSyntheticConfirmed(false)
    setReview(null)
    setPlan(null)
    setReport(null)
    setProgress(null)
    setStatus(null)
    setError(null)
    setHandoffBusy(false)
    setCancelRequested(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [workspaceId, workspaceAdapter])

  useEffect(
    () => () => {
      taskVersionRef.current += 1
      parserAbortRef.current?.abort()
      reviewAbortRef.current?.abort()
      preparationAbortRef.current?.abort()
      commitAbortRef.current?.abort()
    },
    []
  )

  useEffect(() => {
    if (!draftKey || !preset || phase === 'idle' || phase === 'parsing') return
    const timeout = window.setTimeout(() => {
      void draftStore
        .save({
          ...preset,
          draftKey,
          updatedAt: new Date().toISOString(),
          destinationFolder,
          collisionBehavior,
          confirmedMappings: Object.freeze([...confirmedMappings].sort()),
          defaultProcessId,
          defaultNameEn,
          defaultNameAr,
          syntheticBoundaryConfirmed: syntheticConfirmed,
          sourceIdentity: sourceFile ? spreadsheetSourceIdentity(sourceFile) : undefined
        })
        .catch(() => undefined)
    }, 350)
    return () => window.clearTimeout(timeout)
  }, [
    collisionBehavior,
    confirmedMappings,
    defaultNameAr,
    defaultNameEn,
    defaultProcessId,
    destinationFolder,
    draftKey,
    phase,
    preset,
    sourceFile,
    syntheticConfirmed
  ])

  const mappingIssues = useMemo(
    () =>
      parsed && preset
        ? mappingReviewIssues(parsed.workbook, preset, confirmedMappings, {
            defaultProcessId
          })
        : [],
    [confirmedMappings, defaultProcessId, parsed, preset]
  )

  const allIssues = review?.issues ?? mappingIssues
  const typeRepairIssues = useMemo(() => {
    const result: SpreadsheetValidationIssue[] = []
    const seen = new Set<string>()
    for (const issue of allIssues) {
      if (
        (issue.code !== 'unknown-step-type' && issue.code !== 'unknown-participant-type') ||
        typeof issue.rawValue !== 'string'
      ) {
        continue
      }
      const key = `${issue.code}\u001f${normalizeHeader(issue.rawValue)}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push(issue)
    }
    return result
  }, [allIssues])
  const translationCounts = useMemo(() => {
    const relevant =
      plan?.validation.issues.filter(({ code }) => code === 'translation-review-required') ?? []
    return relevant.reduce(
      (counts, issue) => ({
        missing: counts.missing + Number(issue.details?.missing ?? 0),
        invalid: counts.invalid + Number(issue.details?.invalid ?? 0)
      }),
      { missing: 0, invalid: 0 }
    )
  }, [plan])

  async function handleFile(file: File | null): Promise<void> {
    if (!file) return
    taskVersionRef.current += 1
    const taskVersion = taskVersionRef.current
    parserAbortRef.current?.abort()
    reviewAbortRef.current?.abort()
    preparationAbortRef.current?.abort()
    commitAbortRef.current?.abort()
    const controller = new AbortController()
    parserAbortRef.current = controller
    setCancelRequested(false)
    setSourceFile(file)
    setPhase('parsing')
    setParsed(null)
    setPreset(null)
    setReview(null)
    setPlan(null)
    setReport(null)
    setConfirmedMappings(new Set())
    setDefaultProcessId('process_1')
    setDefaultNameEn('')
    setDefaultNameAr('')
    setDestinationFolder('')
    setCollisionBehavior('rename')
    setSyntheticConfirmed(false)
    setError(null)
    setStatus(null)
    setProgress({ phase: 'preflight', completed: 0, total: 1 })
    try {
      const result = await parseBrowserSpreadsheet(file, {
        signal: controller.signal,
        onProgress: setProgress
      })
      if (controller.signal.aborted || taskVersion !== taskVersionRef.current) {
        throw new SpreadsheetError('parse-cancelled')
      }
      const detection = detectOfficialTemplate(result.workbook)
      let nextPreset = detection.official
        ? officialTemplatePreset(result.workbook, detection)
        : suggestedMappingPreset(result.workbook, {
            name: file.name.replace(/\.(?:xlsx|csv)$/i, ''),
            locale: lang
          })
      let nextConfirmedMappings: ReadonlySet<string> = detection.official
        ? allMappedRequiredFields(nextPreset)
        : new Set()
      const nextDraftKey = mappingDraftKey(workspaceId, file.name)
      const draft = await draftStore.load(nextDraftKey)
      if (controller.signal.aborted || taskVersion !== taskVersionRef.current) {
        throw new SpreadsheetError('parse-cancelled')
      }
      if (draft && !detection.official) {
        const signatures = Object.fromEntries(
          WIZARD_SHEET_ROLES.flatMap((role) => {
            const selection = draft.selectedSheets[role]
            if (!selection) return []
            const headers = headersForSelection(result.workbook, selection)
            if (headers.length === 0) return []
            return [[role, headerSignature(headers)]]
          })
        )
        if (presetMatchesHeaderSignatures(draft, signatures)) {
          const {
            draftKey: _draftKey,
            updatedAt: _updatedAt,
            destinationFolder: restoredFolder,
            collisionBehavior: restoredCollision,
            confirmedMappings: restoredConfirmedMappings,
            defaultProcessId: restoredDefaultProcessId,
            defaultNameEn: restoredDefaultNameEn,
            defaultNameAr: restoredDefaultNameAr,
            syntheticBoundaryConfirmed: restoredSyntheticConfirmed,
            sourceIdentity: restoredSourceIdentity,
            ...restoredPreset
          } = draft
          void _draftKey
          void _updatedAt
          nextPreset = restoredPreset
          nextConfirmedMappings = new Set(restoredConfirmedMappings ?? [])
          setDestinationFolder(restoredFolder ?? '')
          setCollisionBehavior(restoredCollision ?? 'rename')
          setDefaultProcessId(restoredDefaultProcessId ?? 'process_1')
          setDefaultNameEn(restoredDefaultNameEn ?? '')
          setDefaultNameAr(restoredDefaultNameAr ?? '')
          setSyntheticConfirmed(
            restoredSyntheticConfirmed === true &&
              restoredSourceIdentity === spreadsheetSourceIdentity(file)
          )
          setStatus(t('spreadsheet.mapping.presetLoaded'))
        }
      }
      setParsed(result)
      setOfficial(detection.official)
      setTemplateVersion(detection.templateVersion)
      setPreset(nextPreset)
      setParseIssues(
        Object.freeze([...result.issues, ...(detection.official ? detection.issues : [])])
      )
      setConfirmedMappings(nextConfirmedMappings)
      setPhase('mapping')
      setProgress(null)
    } catch (cause) {
      if (cause instanceof SpreadsheetError && cause.code === 'parse-cancelled') {
        setStatus(t('spreadsheet.cancelled'))
        setPhase('idle')
      } else {
        setError(panelError(cause, t('spreadsheet.error.parse'), lang))
        setPhase('idle')
      }
      setProgress(null)
    } finally {
      if (parserAbortRef.current === controller) {
        parserAbortRef.current = null
        setCancelRequested(false)
      }
    }
  }

  function updatePreset(update: (current: MappingPreset) => MappingPreset): void {
    reviewAbortRef.current?.abort()
    preparationAbortRef.current?.abort()
    commitAbortRef.current?.abort()
    setPreset((current) => (current ? update(current) : current))
    setReview(null)
    setPlan(null)
    setReport(null)
    setError(null)
    setStatus(null)
    setCancelRequested(false)
  }

  function repairTypeValue(
    issue: SpreadsheetValidationIssue,
    value: BpmnNodeType | ParticipantType
  ): void {
    if (typeof issue.rawValue !== 'string') return
    const normalized = normalizeHeader(issue.rawValue)
    if (!normalized) return
    updatePreset((current) => ({
      ...current,
      valueMappings: {
        stepTypes:
          issue.code === 'unknown-step-type'
            ? { ...current.valueMappings.stepTypes, [normalized]: value as BpmnNodeType }
            : current.valueMappings.stepTypes,
        participantTypes:
          issue.code === 'unknown-participant-type'
            ? {
                ...current.valueMappings.participantTypes,
                [normalized]: value as ParticipantType
              }
            : current.valueMappings.participantTypes
      }
    }))
  }

  function selectRoleSheet(role: CanonicalSheet, worksheet: string): void {
    if (!parsed) return
    updatePreset((current) => {
      if (!worksheet) {
        const selectedSheets = { ...current.selectedSheets }
        const fieldMappings = { ...current.fieldMappings }
        const headerSignatures = { ...current.headerSignatures }
        delete selectedSheets[role]
        delete fieldMappings[role]
        delete headerSignatures[role]
        return {
          ...current,
          selectedSheets,
          fieldMappings,
          headerSignatures
        }
      }
      const selection = { worksheet, headerRow: 1 }
      const headers = headersForSelection(parsed.workbook, selection)
      const mapping = Object.fromEntries(
        suggestHeaderMappings(role, headers)
          .filter(
            (suggestion): suggestion is typeof suggestion & { readonly header: string } =>
              suggestion.header !== undefined
          )
          .map(({ field, header }) => [field, header])
      )
      return {
        ...current,
        selectedSheets: { ...current.selectedSheets, [role]: selection },
        fieldMappings: { ...current.fieldMappings, [role]: mapping },
        headerSignatures: {
          ...current.headerSignatures,
          [role]: headerSignature(headers)
        }
      }
    })
    setConfirmedMappings((current) => {
      const next = new Set(current)
      for (const key of next) if (key.startsWith(`${role}.`)) next.delete(key)
      return next
    })
  }

  function changeHeaderRow(role: CanonicalSheet, headerRow: number): void {
    if (!parsed || !preset?.selectedSheets[role]) return
    const selection = {
      worksheet: preset.selectedSheets[role]!.worksheet,
      headerRow: Math.max(1, Math.floor(headerRow) || 1)
    }
    updatePreset((current) => {
      const headers = headersForSelection(parsed.workbook, selection)
      const mapping = Object.fromEntries(
        suggestHeaderMappings(role, headers)
          .filter(
            (suggestion): suggestion is typeof suggestion & { readonly header: string } =>
              suggestion.header !== undefined
          )
          .map(({ field, header }) => [field, header])
      )
      return {
        ...current,
        selectedSheets: { ...current.selectedSheets, [role]: selection },
        fieldMappings: { ...current.fieldMappings, [role]: mapping },
        headerSignatures: {
          ...current.headerSignatures,
          [role]: headerSignature(headers)
        }
      }
    })
    setConfirmedMappings((current) => {
      const next = new Set(current)
      for (const key of next) if (key.startsWith(`${role}.`)) next.delete(key)
      return next
    })
  }

  function changeField(role: CanonicalSheet, field: string, header: string): void {
    updatePreset((current) => {
      const mapping = { ...(current.fieldMappings[role] ?? {}) }
      for (const [mappedField, mappedHeader] of Object.entries(mapping)) {
        if (mappedField !== field && mappedHeader === header && header) {
          delete mapping[mappedField]
        }
      }
      if (header) mapping[field] = header
      else delete mapping[field]
      return {
        ...current,
        fieldMappings: { ...current.fieldMappings, [role]: mapping }
      }
    })
    setConfirmedMappings((current) => {
      const next = new Set(current)
      if (header) next.add(`${role}.${field}`)
      else next.delete(`${role}.${field}`)
      return next
    })
  }

  async function importPreset(file: File | null): Promise<void> {
    if (!file || !parsed) return
    try {
      const imported = await readMappingPresetFile(file)
      // Exact signatures are checked again by buildProcessWorkbookModel; this
      // early check prevents an apparently successful cross-workbook restore.
      const signatures = Object.fromEntries(
        WIZARD_SHEET_ROLES.flatMap((role) => {
          const selection = imported.selectedSheets[role]
          if (!selection) return []
          const headers = headersForSelection(parsed.workbook, selection)
          return headers.length > 0 ? [[role, headerSignature(headers)]] : []
        })
      )
      if (!presetMatchesHeaderSignatures(imported, signatures)) {
        throw new SpreadsheetError('invalid-mapping-preset', {
          location: 'header-signatures'
        })
      }
      setPreset(imported)
      setConfirmedMappings(allMappedRequiredFields(imported))
      setReview(null)
      setPlan(null)
      setStatus(t('spreadsheet.mapping.presetLoaded'))
      setError(null)
    } catch (cause) {
      setError(panelError(cause, t('spreadsheet.error.preset'), lang))
    } finally {
      if (presetInputRef.current) presetInputRef.current.value = ''
    }
  }

  async function buildReview(): Promise<void> {
    if (!parsed || !preset || !sourceFile) return
    reviewAbortRef.current?.abort()
    const controller = new AbortController()
    reviewAbortRef.current = controller
    const taskVersion = taskVersionRef.current
    setPhase('reviewing')
    setReview(null)
    setPlan(null)
    setReport(null)
    setError(null)
    setStatus(null)
    setCancelRequested(false)
    setProgress({
      phase: 'build-model',
      completed: 0,
      total: SPREADSHEET_MODEL_REVIEW_STAGE_COUNT
    })
    await Promise.resolve()
    if (controller.signal.aborted || taskVersion !== taskVersionRef.current) {
      if (reviewAbortRef.current === controller) reviewAbortRef.current = null
      setProgress(null)
      setCancelRequested(false)
      return
    }
    const requiredIssues = mappingReviewIssues(parsed.workbook, preset, confirmedMappings, {
      defaultProcessId
    })
    if (requiredIssues.length > 0) {
      setReview({
        issues: requiredIssues,
        additionalIssues: requiredIssues,
        skippedRows: [],
        ready: false
      })
      setPhase('review')
      setProgress(null)
      if (reviewAbortRef.current === controller) reviewAbortRef.current = null
      setCancelRequested(false)
      return
    }
    try {
      const nextReview = await runSpreadsheetModelReview(
        {
          workbook: parsed.workbook,
          buildOptions: {
            fileName: sourceFile.name,
            format: parsed.format,
            preset,
            officialTemplate: official,
            templateVersion,
            defaultProcessId: defaultProcessId.trim() || undefined,
            defaultProcessName:
              defaultNameEn.trim() || defaultNameAr.trim()
                ? {
                    en: defaultNameEn.trim() || undefined,
                    ar: defaultNameAr.trim() || undefined,
                    active: lang
                  }
                : undefined
          },
          destinationFolder,
          knownProcessIds,
          sourceIssues: parseIssues,
          confirmSyntheticBoundaries: syntheticConfirmed
        },
        {
          signal: controller.signal,
          onProgress: setProgress
        }
      )
      if (controller.signal.aborted || taskVersion !== taskVersionRef.current) return
      setReview(nextReview)
      setPhase('review')
    } catch (cause) {
      if (reviewAbortRef.current !== controller || taskVersion !== taskVersionRef.current) {
        return
      }
      if (cause instanceof SpreadsheetError && cause.code === 'parse-cancelled') {
        setStatus(t('spreadsheet.cancelled'))
        setPhase('mapping')
        return
      }
      setError(panelError(cause, t('spreadsheet.error.review'), lang))
      setReview({
        issues: [],
        additionalIssues: [],
        skippedRows: [],
        ready: false
      })
      setPhase('review')
    } finally {
      if (reviewAbortRef.current === controller) {
        reviewAbortRef.current = null
        setProgress(null)
        setCancelRequested(false)
      }
    }
  }

  async function preparePlan(): Promise<void> {
    if (!review?.model || !review.ready || !preset || !sourceFile) return
    preparationAbortRef.current?.abort()
    const controller = new AbortController()
    preparationAbortRef.current = controller
    const taskVersion = taskVersionRef.current
    const processCount = review.model.processes.length
    setPhase('preparing')
    setPlan(null)
    setReport(null)
    setError(null)
    setStatus(null)
    setCancelRequested(false)
    setProgress({ phase: 'generate', completed: 0, total: processCount })
    try {
      const nextPlan = await prepareModelPlan(
        review.model,
        review,
        controller.signal,
        (nextProgress) => {
          if (
            preparationAbortRef.current === controller &&
            taskVersion === taskVersionRef.current
          ) {
            setProgress(nextProgress)
          }
        }
      )
      if (taskVersion !== taskVersionRef.current) return
      if (controller.signal.aborted) throw new SpreadsheetError('parse-cancelled')
      setPlan(nextPlan)
      setPhase('plan')
    } catch (cause) {
      if (preparationAbortRef.current !== controller || taskVersion !== taskVersionRef.current) {
        return
      }
      if (cause instanceof SpreadsheetError && cause.code === 'parse-cancelled') {
        setStatus(t('spreadsheet.cancelled'))
        setPhase('review')
        return
      }
      setError(panelError(cause, t('spreadsheet.error.prepare'), lang))
      setPhase('review')
    } finally {
      if (preparationAbortRef.current === controller) {
        preparationAbortRef.current = null
        setProgress(null)
        setCancelRequested(false)
      }
    }
  }

  async function prepareModelPlan(
    model: ProcessWorkbookModel,
    currentReview: WorkbookReview,
    signal: AbortSignal,
    onProgress?: (progress: SpreadsheetImportProgress) => void
  ): Promise<TransactionalImportPlan> {
    if (!preset) {
      throw new SpreadsheetError('adapter-contract-violation', {
        contract: 'spreadsheet-mapping-preset'
      })
    }
    const inspector =
      multipleFiles && workspaceAdapter
        ? new WorkspaceSpreadsheetDestinationInspector(workspaceAdapter)
        : new EmptySpreadsheetDestinationInspector()
    return await prepareTransactionalImportPlan(model, {
      mode: multipleFiles && workspaceAdapter ? workspaceAdapter.mode : 'single-file',
      collisionBehavior,
      inspector,
      generator: new SpreadsheetBpmnGenerator({
        knownProcessIds
      }),
      bilingualAudit: new SpreadsheetBilingualAudit(),
      destinationProcessIds: new Set(knownProcessIds),
      additionalIssues: currentReview.additionalIssues,
      generatedIds: currentReview.inference?.generatedIds,
      inferredFlows: currentReview.inference?.inferredFlowRecords,
      syntheticBoundaries: currentReview.inference?.syntheticBoundaries,
      skippedRows: currentReview.skippedRows,
      mappingPreset: preset,
      signal,
      onProgress
    })
  }

  async function handoffBilingualReview(): Promise<void> {
    if (!review?.model || !onReviewBilingual) return
    preparationAbortRef.current?.abort()
    const controller = new AbortController()
    preparationAbortRef.current = controller
    const taskVersion = taskVersionRef.current
    const processCount = review.model.processes.length
    setHandoffBusy(true)
    setPhase('preparing')
    setError(null)
    setStatus(null)
    setCancelRequested(false)
    setProgress({ phase: 'generate', completed: 0, total: processCount })
    try {
      const outcome = await reviewProcessWorkbookBilingual(review.model, {
        generator: new SpreadsheetBpmnGenerator({
          knownProcessIds,
          requireBilingual: false
        }),
        review: onReviewBilingual,
        knownProcessIds,
        signal: controller.signal
      })
      if (taskVersion !== taskVersionRef.current) return
      if (controller.signal.aborted) throw new SpreadsheetError('parse-cancelled')
      setProgress({ phase: 'generate', completed: processCount, total: processCount })
      if (outcome.status === 'cancelled') {
        setStatus(t('spreadsheet.cancelled'))
        setPhase('plan')
        return
      }

      const validation = validateProcessWorkbookModel(outcome.model, {
        destinationProcessIds: new Set(knownProcessIds),
        additionalIssues: review.additionalIssues
      })
      const nextReview: WorkbookReview = {
        ...review,
        model: outcome.model,
        validation,
        issues: validation.issues,
        ready: !validation.blocking
      }
      setReview(nextReview)
      if (validation.blocking) {
        setPlan(null)
        setPhase('review')
        return
      }

      const nextPlan = await prepareModelPlan(
        outcome.model,
        nextReview,
        controller.signal,
        (nextProgress) => {
          if (
            preparationAbortRef.current === controller &&
            taskVersion === taskVersionRef.current
          ) {
            setProgress(nextProgress)
          }
        }
      )
      if (taskVersion !== taskVersionRef.current) return
      if (controller.signal.aborted) throw new SpreadsheetError('parse-cancelled')
      setPlan(nextPlan)
      setPhase('plan')
    } catch (cause) {
      if (preparationAbortRef.current !== controller || taskVersion !== taskVersionRef.current) {
        return
      }
      if (cause instanceof SpreadsheetError && cause.code === 'parse-cancelled') {
        setStatus(t('spreadsheet.cancelled'))
        setPhase(plan ? 'plan' : 'review')
        return
      }
      setError(panelError(cause, t('spreadsheet.error.bilingualReview'), lang))
      setPhase('plan')
    } finally {
      if (preparationAbortRef.current === controller) {
        preparationAbortRef.current = null
        setHandoffBusy(false)
        setProgress(null)
        setCancelRequested(false)
      }
    }
  }

  async function commitPlan(): Promise<void> {
    if (!plan || plan.status !== 'ready') return
    commitAbortRef.current?.abort()
    const controller = new AbortController()
    commitAbortRef.current = controller
    const taskVersion = taskVersionRef.current
    setPhase('committing')
    setError(null)
    setStatus(null)
    setCancelRequested(false)
    setProgress({ phase: 'stage', completed: 0, total: plan.artifacts.length })
    try {
      const transactionFactory =
        multipleFiles && workspaceAdapter
          ? new WorkspaceImportTransactionFactory(workspaceAdapter, {
              runExclusive: runWorkspaceExclusive,
              historyManager: historyManager ?? undefined,
              isCurrent: () =>
                getCurrentWorkspaceId ? getCurrentWorkspaceId() === workspaceId : true
            })
          : new BrowserImportDeliveryTransactionFactory({
              openSingle: async (xml, path) => await onOpenSingle(xml, path)
            })
      const nextReport = await executeTransactionalImportPlan(plan, {
        transactionFactory,
        signal: controller.signal,
        onProgress: (nextProgress) => {
          if (commitAbortRef.current === controller && taskVersion === taskVersionRef.current) {
            setProgress(nextProgress)
          }
        }
      })
      if (commitAbortRef.current !== controller || taskVersion !== taskVersionRef.current) {
        return
      }
      setReport(nextReport)
      setPhase('report')
      if (nextReport.failure?.code === 'parse-cancelled') {
        setStatus(t('spreadsheet.cancelled'))
      }
      if (nextReport.status === 'committed') {
        try {
          await onCommitted?.(nextReport)
          if (draftKey) await draftStore.remove(draftKey)
        } catch (cause) {
          setError(panelError(cause, t('spreadsheet.error.postCommit'), lang))
        }
      }
    } catch (cause) {
      if (commitAbortRef.current !== controller || taskVersion !== taskVersionRef.current) {
        return
      }
      if (cause instanceof SpreadsheetError && cause.code === 'parse-cancelled') {
        setStatus(t('spreadsheet.cancelled'))
      } else {
        setError(panelError(cause, t('spreadsheet.error.commit'), lang))
      }
      setPhase('plan')
    } finally {
      if (commitAbortRef.current === controller) {
        commitAbortRef.current = null
        setProgress(null)
        setCancelRequested(false)
      }
    }
  }

  const cancelActiveOperation = (): void => {
    setCancelRequested(true)
    switch (phase) {
      case 'parsing':
        parserAbortRef.current?.abort()
        break
      case 'reviewing':
        reviewAbortRef.current?.abort()
        break
      case 'preparing':
        preparationAbortRef.current?.abort()
        break
      case 'committing':
        commitAbortRef.current?.abort()
        break
    }
  }

  const percent = progress
    ? Math.max(
        0,
        Math.min(100, Math.round((progress.completed / Math.max(1, progress.total)) * 100))
      )
    : 0

  return (
    <section aria-labelledby="spreadsheet-import-title" style={panelStyle}>
      <div>
        <h3 id="spreadsheet-import-title" style={{ margin: 0, fontSize: 15 }}>
          {t('spreadsheet.title')}
        </h3>
        <p style={mutedText}>{t('spreadsheet.intro')}</p>
      </div>

      <div style={buttonRow}>
        <button
          type="button"
          style={secondaryButton}
          onClick={() => downloadWorkbookTemplate('blank')}
        >
          {t('spreadsheet.template.blank')}
        </button>
        <button
          type="button"
          style={secondaryButton}
          onClick={() => downloadWorkbookTemplate('example')}
        >
          {t('spreadsheet.template.example')}
        </button>
      </div>

      <label style={fieldStyle}>
        <span style={fieldLabel}>{t('spreadsheet.upload')}</span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv"
          disabled={phase === 'parsing' || phase === 'committing'}
          onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
        />
        <span style={mutedText}>{t('spreadsheet.uploadHint')}</span>
      </label>

      {(phase === 'parsing' ||
        phase === 'reviewing' ||
        phase === 'preparing' ||
        phase === 'committing') &&
        progress && (
          <div role="status" aria-live="polite" style={infoBox}>
            <div>
              {t('spreadsheet.progress', {
                phase: progressPhase(progress.phase),
                percent
              })}
            </div>
            <progress value={percent} max={100} style={{ width: '100%' }} />
            <button
              type="button"
              style={secondaryButton}
              disabled={cancelRequested}
              onClick={cancelActiveOperation}
            >
              {cancelRequested ? t('spreadsheet.cancelling') : t('spreadsheet.cancel')}
            </button>
          </div>
        )}

      {parsed && preset && sourceFile && (
        <>
          <div role="status" style={official ? okBox : infoBox}>
            {official
              ? t('spreadsheet.officialDetected', {
                  version: templateVersion ?? 'structural'
                })
              : t('spreadsheet.ordinaryDetected')}
          </div>

          <section aria-labelledby="spreadsheet-mapping-title" style={cardStyle}>
            <h4 id="spreadsheet-mapping-title" style={cardTitle}>
              {t('spreadsheet.mapping.title')}
            </h4>
            <label style={fieldStyle}>
              <span style={fieldLabel}>{t('spreadsheet.mapping.presetName')}</span>
              <input
                value={preset.name}
                maxLength={120}
                onChange={(event) =>
                  updatePreset((current) => ({
                    ...current,
                    name: event.target.value || 'Spreadsheet mapping'
                  }))
                }
                style={inputStyle}
              />
            </label>

            {!official &&
              WIZARD_SHEET_ROLES.map((role) => {
                const selection = preset.selectedSheets[role]
                const headers = headersForSelection(parsed.workbook, selection)
                const suggestions = new Map(
                  suggestHeaderMappings(role, headers).map((suggestion) => [
                    suggestion.field,
                    suggestion
                  ])
                )
                const required = new Set(REQUIRED_FIELDS_BY_SHEET[role])
                return (
                  <details key={role} open={role === 'steps'} style={mappingGroup}>
                    <summary style={{ cursor: 'pointer', fontWeight: 650 }}>
                      {t(
                        role === 'processes'
                          ? 'spreadsheet.mapping.role.processes'
                          : role === 'participants'
                            ? 'spreadsheet.mapping.role.participants'
                            : role === 'steps'
                              ? 'spreadsheet.mapping.role.steps'
                              : role === 'flows'
                                ? 'spreadsheet.mapping.role.flows'
                                : 'spreadsheet.mapping.role.glossary'
                      )}
                    </summary>
                    <div style={{ display: 'grid', gap: 9, marginTop: 10 }}>
                      <label style={fieldStyle}>
                        <span style={fieldLabel}>{t('spreadsheet.mapping.sheet')}</span>
                        <select
                          value={selection?.worksheet ?? ''}
                          onChange={(event) => selectRoleSheet(role, event.target.value)}
                          style={inputStyle}
                        >
                          <option value="">{t('spreadsheet.mapping.noSheet')}</option>
                          {parsed.workbook.sheets.map((sheet) => (
                            <option key={sheet.name} value={sheet.name}>
                              {sheet.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {selection && (
                        <>
                          <label style={fieldStyle}>
                            <span style={fieldLabel}>{t('spreadsheet.mapping.headerRow')}</span>
                            <input
                              type="number"
                              min={1}
                              max={
                                parsed.workbook.sheets.find(
                                  ({ name }) => name === selection.worksheet
                                )?.rows.length ?? 1
                              }
                              value={selection.headerRow}
                              onChange={(event) =>
                                changeHeaderRow(role, Number(event.target.value))
                              }
                              style={inputStyle}
                            />
                          </label>
                          <div style={mappingGrid}>
                            {CANONICAL_FIELDS_BY_SHEET[role].map((field) => {
                              const mapped = preset.fieldMappings[role]?.[field] ?? ''
                              const suggestion = suggestions.get(field)
                              const requiredGroup = requiredFieldGroupForSheet(role, field)
                              const confidence =
                                suggestion?.header === mapped ? suggestion.confidence : 0
                              const key = `${role}.${field}`
                              const needsConfirmation =
                                required.has(field) &&
                                Boolean(mapped) &&
                                confidence < LOW_CONFIDENCE_REQUIRED_THRESHOLD
                              return (
                                <label key={field} style={mappingField}>
                                  <span style={{ fontSize: 11.5 }}>
                                    <code>{field}</code>
                                    {required.has(field) && (
                                      <strong style={{ marginInlineStart: 5 }}>
                                        {requiredGroup && requiredGroup.length > 1
                                          ? t('spreadsheet.mapping.oneLanguageRequired')
                                          : t('spreadsheet.mapping.required')}
                                      </strong>
                                    )}
                                  </span>
                                  <select
                                    value={mapped}
                                    onChange={(event) =>
                                      changeField(role, field, event.target.value)
                                    }
                                    style={inputStyle}
                                  >
                                    <option value="">—</option>
                                    {headers.map((header, index) =>
                                      header ? (
                                        <option key={`${header}-${index}`} value={header}>
                                          {header}
                                        </option>
                                      ) : null
                                    )}
                                  </select>
                                  {mapped && (
                                    <span style={mutedText}>
                                      {t('spreadsheet.mapping.confidence', {
                                        percent: Math.round(confidence * 100)
                                      })}
                                    </span>
                                  )}
                                  {needsConfirmation && (
                                    <span
                                      style={{
                                        display: 'flex',
                                        gap: 6,
                                        alignItems: 'flex-start'
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={confirmedMappings.has(key)}
                                        onChange={(event) =>
                                          setConfirmedMappings((current) => {
                                            const next = new Set(current)
                                            if (event.target.checked) next.add(key)
                                            else next.delete(key)
                                            return next
                                          })
                                        }
                                      />
                                      <span style={{ fontSize: 11.5 }}>
                                        {t('spreadsheet.mapping.confirm')}
                                      </span>
                                    </span>
                                  )}
                                </label>
                              )
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  </details>
                )
              })}

            {!official && (
              <div style={mappingGrid}>
                <label style={fieldStyle}>
                  <span style={fieldLabel}>{t('spreadsheet.mapping.defaultProcessId')}</span>
                  <input
                    value={defaultProcessId}
                    onChange={(event) => setDefaultProcessId(event.target.value)}
                    style={inputStyle}
                    dir="ltr"
                  />
                </label>
                <label style={fieldStyle}>
                  <span style={fieldLabel}>{t('spreadsheet.mapping.defaultNameEn')}</span>
                  <input
                    value={defaultNameEn}
                    onChange={(event) => setDefaultNameEn(event.target.value)}
                    style={inputStyle}
                    dir="auto"
                  />
                </label>
                <label style={fieldStyle}>
                  <span style={fieldLabel}>{t('spreadsheet.mapping.defaultNameAr')}</span>
                  <input
                    value={defaultNameAr}
                    onChange={(event) => setDefaultNameAr(event.target.value)}
                    style={inputStyle}
                    dir="auto"
                  />
                </label>
              </div>
            )}

            <div style={mappingGrid}>
              <label style={fieldStyle}>
                <span style={fieldLabel}>{t('spreadsheet.mapping.delimiters')}</span>
                <input
                  value={preset.delimiters.list.join(' ')}
                  onChange={(event) => {
                    const delimiters = event.target.value
                      .split(/\s+/)
                      .filter((value) => value && value !== ',' && value.length <= 2)
                      .slice(0, 4)
                    if (delimiters.length === 0) return
                    updatePreset((current) => ({
                      ...current,
                      delimiters: { list: delimiters }
                    }))
                  }}
                  style={inputStyle}
                  dir="ltr"
                />
              </label>
              <label style={fieldStyle}>
                <span style={fieldLabel}>{t('spreadsheet.mapping.flowMode')}</span>
                <select
                  value={preset.inference.flowMode}
                  onChange={(event) =>
                    updatePreset((current) => ({
                      ...current,
                      inference: {
                        ...current.inference,
                        flowMode: event.target.value as MappingPreset['inference']['flowMode']
                      }
                    }))
                  }
                  style={inputStyle}
                >
                  <option value="auto">{t('spreadsheet.mapping.flow.auto')}</option>
                  <option value="explicit">{t('spreadsheet.mapping.flow.explicit')}</option>
                  <option value="next-step">{t('spreadsheet.mapping.flow.next')}</option>
                  <option value="numeric-order">{t('spreadsheet.mapping.flow.order')}</option>
                </select>
              </label>
            </div>

            <div style={buttonRow}>
              <button
                type="button"
                style={secondaryButton}
                onClick={() => {
                  if (!draftKey) return
                  void draftStore
                    .save({
                      ...preset,
                      draftKey,
                      updatedAt: new Date().toISOString(),
                      destinationFolder,
                      collisionBehavior,
                      confirmedMappings: Object.freeze([...confirmedMappings].sort()),
                      defaultProcessId,
                      defaultNameEn,
                      defaultNameAr,
                      syntheticBoundaryConfirmed: syntheticConfirmed,
                      sourceIdentity: sourceFile ? spreadsheetSourceIdentity(sourceFile) : undefined
                    })
                    .then(() => setStatus(t('spreadsheet.mapping.draftSaved')))
                    .catch((cause) =>
                      setError(panelError(cause, t('spreadsheet.error.draftSave'), lang))
                    )
                }}
              >
                {t('spreadsheet.mapping.saveDraft')}
              </button>
              <button
                type="button"
                style={secondaryButton}
                onClick={() => downloadMappingPreset(preset)}
              >
                {t('spreadsheet.mapping.exportPreset')}
              </button>
              <button
                type="button"
                style={secondaryButton}
                onClick={() => presetInputRef.current?.click()}
              >
                {t('spreadsheet.mapping.importPreset')}
              </button>
              <input
                ref={presetInputRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(event) => void importPreset(event.target.files?.[0] ?? null)}
              />
            </div>
          </section>

          <section aria-labelledby="spreadsheet-destination-title" style={cardStyle}>
            <h4 id="spreadsheet-destination-title" style={cardTitle}>
              {t('spreadsheet.destination.title')}
            </h4>
            <label style={fieldStyle}>
              <span style={fieldLabel}>{t('spreadsheet.destination.folder')}</span>
              <input
                list="spreadsheet-folder-options"
                value={destinationFolder}
                onChange={(event) => {
                  setDestinationFolder(event.target.value)
                  setReview(null)
                  setPlan(null)
                }}
                style={inputStyle}
                dir="auto"
              />
              <datalist id="spreadsheet-folder-options">
                {folders.map((folder) => (
                  <option key={folder.relPath} value={folder.relPath}>
                    {folder.label}
                  </option>
                ))}
              </datalist>
            </label>
            <label style={fieldStyle}>
              <span style={fieldLabel}>{t('spreadsheet.destination.collision')}</span>
              <select
                value={collisionBehavior}
                onChange={(event) => {
                  setCollisionBehavior(event.target.value as CollisionBehavior)
                  setPlan(null)
                }}
                style={inputStyle}
              >
                <option value="error">{t('spreadsheet.destination.error')}</option>
                <option value="overwrite">{t('spreadsheet.destination.overwrite')}</option>
                <option value="rename">{t('spreadsheet.destination.rename')}</option>
              </select>
            </label>
          </section>

          {mappingIssues.length > 0 && !review && (
            <div role="alert" style={warnBox}>
              {t('spreadsheet.validation.mappingBlocked')}
            </div>
          )}

          <button
            type="button"
            onClick={() => void buildReview()}
            disabled={phase === 'reviewing'}
            style={primaryButton}
          >
            {phase === 'reviewing' ? t('spreadsheet.reviewing') : t('spreadsheet.review')}
          </button>
        </>
      )}

      {review && (
        <>
          <section aria-labelledby="spreadsheet-validation-title" style={cardStyle}>
            <h4 id="spreadsheet-validation-title" style={cardTitle}>
              {t('spreadsheet.validation.title')}
            </h4>
            {review.validation ? (
              <strong>
                {t('spreadsheet.validation.summary', {
                  errors: review.validation.errorCount,
                  reviews: review.validation.reviewCount,
                  warnings: review.validation.warningCount
                })}
              </strong>
            ) : null}
            {allIssues.length === 0 ? (
              <div style={okBox}>{t('spreadsheet.validation.noIssues')}</div>
            ) : (
              <SpreadsheetValidationIssueList
                issues={allIssues.slice(0, 250)}
                listId="spreadsheet-workbook-issues"
                idPrefix="spreadsheet-workbook-review"
              />
            )}
            {typeRepairIssues.length > 0 && (
              <section
                aria-labelledby="spreadsheet-type-repair-title"
                style={{ display: 'grid', gap: 8 }}
              >
                <h5 id="spreadsheet-type-repair-title" style={{ margin: 0 }}>
                  {t('spreadsheet.typeRepair.title')}
                </h5>
                <p style={mutedText}>{t('spreadsheet.typeRepair.guidance')}</p>
                {typeRepairIssues.map((issue) => {
                  const step = issue.code === 'unknown-step-type'
                  const rawValue = String(issue.rawValue)
                  return (
                    <label key={`${issue.code}-${normalizeHeader(rawValue)}`} style={fieldStyle}>
                      <span style={fieldLabel}>
                        {step
                          ? t('spreadsheet.typeRepair.step', { value: rawValue })
                          : t('spreadsheet.typeRepair.participant', { value: rawValue })}
                      </span>
                      <select
                        value=""
                        aria-label={
                          step
                            ? t('spreadsheet.typeRepair.step', { value: rawValue })
                            : t('spreadsheet.typeRepair.participant', { value: rawValue })
                        }
                        onChange={(event) => {
                          if (!event.target.value) return
                          repairTypeValue(
                            issue,
                            event.target.value as BpmnNodeType | ParticipantType
                          )
                        }}
                        style={inputStyle}
                      >
                        <option value="">{t('spreadsheet.typeRepair.choose')}</option>
                        {step
                          ? BPMN_NODE_TYPES.map((type) => (
                              <option key={type} value={type}>
                                {stepTypeLabel(type)}
                              </option>
                            ))
                          : (['pool', 'lane'] as const).map((type) => (
                              <option key={type} value={type}>
                                {participantTypeLabel(type)}
                              </option>
                            ))}
                      </select>
                    </label>
                  )
                })}
              </section>
            )}
            {review.inference && review.inference.generatedIds.length > 0 && (
              <div style={infoBox}>
                {t('spreadsheet.repair.generatedIds', {
                  count: review.inference.generatedIds.length
                })}
              </div>
            )}
            {review.inference && review.inference.syntheticBoundaries.length > 0 && (
              <label style={warnBox}>
                <span>
                  {t('spreadsheet.repair.synthetic', {
                    count: review.inference.syntheticBoundaries.length
                  })}
                </span>
                <span
                  style={{
                    display: 'flex',
                    gap: 7,
                    alignItems: 'flex-start'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={syntheticConfirmed}
                    onChange={(event) => {
                      setSyntheticConfirmed(event.target.checked)
                      setReview(null)
                      setPlan(null)
                    }}
                  />
                  {t('spreadsheet.repair.confirmSynthetic')}
                </span>
              </label>
            )}
            {review.skippedRows.length > 0 && (
              <div style={infoBox}>
                {t('spreadsheet.repair.skippedRows', {
                  count: review.skippedRows.length
                })}
              </div>
            )}
          </section>

          {review.model && (
            <section aria-labelledby="spreadsheet-preview-title" style={cardStyle}>
              <h4 id="spreadsheet-preview-title" style={cardTitle}>
                {t('spreadsheet.preview.title')}
              </h4>
              <div style={buttonRow}>
                <span>
                  {t('spreadsheet.preview.processes', {
                    count: review.model.processes.length
                  })}
                </span>
                <span>
                  {t('spreadsheet.preview.nodes', {
                    count: review.model.nodes.length
                  })}
                </span>
                <span>
                  {t('spreadsheet.preview.flows', {
                    count: review.model.flows.length
                  })}
                </span>
              </div>
              <SpreadsheetTopologyPreview
                model={review.model}
                labels={{
                  process: t('spreadsheet.preview.process'),
                  node: t('spreadsheet.preview.node'),
                  type: t('spreadsheet.preview.type'),
                  participant: t('spreadsheet.preview.participant'),
                  flow: t('spreadsheet.preview.fromTo'),
                  condition: t('spreadsheet.preview.condition'),
                  defaultFlow: t('spreadsheet.preview.defaultFlow'),
                  generated: t('spreadsheet.preview.generated'),
                  explicit: t('spreadsheet.preview.origin.explicit'),
                  mapped: t('spreadsheet.preview.origin.mapped'),
                  inferred: t('spreadsheet.preview.origin.inferred'),
                  synthetic: t('spreadsheet.preview.origin.synthetic'),
                  unassigned: t('spreadsheet.preview.unassigned')
                }}
              />
            </section>
          )}

          {review.inference?.requiresSyntheticBoundaryConfirmation && !syntheticConfirmed && (
            <button type="button" style={secondaryButton} onClick={() => void buildReview()}>
              {t('spreadsheet.review')}
            </button>
          )}

          {review.ready && (
            <button
              type="button"
              onClick={() => void preparePlan()}
              disabled={phase === 'preparing'}
              style={primaryButton}
            >
              {phase === 'preparing' ? t('spreadsheet.preparing') : t('spreadsheet.prepare')}
            </button>
          )}
        </>
      )}

      {plan && (
        <section aria-labelledby="spreadsheet-plan-title" style={cardStyle}>
          <h4 id="spreadsheet-plan-title" style={cardTitle}>
            {plan.status === 'ready'
              ? t('spreadsheet.plan.ready', {
                  count: plan.artifacts.length
                })
              : t('spreadsheet.plan.blocked')}
          </h4>
          {plan.syntheticBoundaries.length > 0 && (
            <div style={infoBox}>
              {t('spreadsheet.repair.synthetic', {
                count: plan.syntheticBoundaries.length
              })}
            </div>
          )}
          {plan.blockingReason === 'translation-review' && (
            <div role="alert" style={warnBox}>
              <span>{t('spreadsheet.translation.required', translationCounts)}</span>
              {onReviewBilingual && review?.model && (
                <button
                  type="button"
                  style={secondaryButton}
                  disabled={handoffBusy}
                  onClick={() => void handoffBilingualReview()}
                >
                  {t('spreadsheet.translation.handoff')}
                </button>
              )}
            </div>
          )}
          {plan.status === 'blocked' && (
            <SpreadsheetValidationIssueList
              issues={plan.validation.issues.slice(0, 250)}
              listId="spreadsheet-plan-issues"
              idPrefix="spreadsheet-plan-review"
            />
          )}
          {plan.artifacts.length > 0 && (
            <ul style={issueList}>
              {plan.artifacts.map((artifact) => (
                <li key={artifact.graph.process.id} style={issueItem}>
                  <strong>{artifact.graph.process.id}</strong>
                  <span>{artifact.destination.path}</span>
                  <code dir="ltr">{artifact.checksumSha256}</code>
                </li>
              ))}
            </ul>
          )}
          {plan.status === 'ready' && (
            <button
              type="button"
              onClick={() => void commitPlan()}
              disabled={phase === 'committing'}
              style={primaryButton}
            >
              {phase === 'committing' ? t('spreadsheet.committing') : t('spreadsheet.commit')}
            </button>
          )}
        </section>
      )}

      {report && (
        <section aria-live="polite" style={cardStyle}>
          <div
            role={report.status === 'committed' ? 'status' : 'alert'}
            style={
              report.status === 'committed'
                ? okBox
                : report.status === 'rollback-failed'
                  ? errorBox
                  : warnBox
            }
          >
            {report.status === 'committed'
              ? t('spreadsheet.report.committed')
              : report.status === 'rollback-failed'
                ? t('spreadsheet.report.rollbackFailed')
                : t('spreadsheet.report.rolledBack')}
          </div>
          {report.syntheticBoundaries.length > 0 && (
            <div style={infoBox}>
              {t('spreadsheet.repair.synthetic', {
                count: report.syntheticBoundaries.length
              })}
            </div>
          )}
          <ul style={issueList}>
            {report.artifacts.map((artifact) => (
              <li key={artifact.processId} style={issueItem}>
                <strong>{artifact.processId}</strong>
                <span>
                  {t('spreadsheet.report.destination')}: {artifact.destinationPath}
                </span>
                <code dir="ltr">
                  {t('spreadsheet.report.checksum')}: {artifact.checksumSha256}
                </code>
              </li>
            ))}
          </ul>
          <button type="button" style={secondaryButton} onClick={() => downloadReport(report)}>
            {t('spreadsheet.report.download')}
          </button>
        </section>
      )}

      {status && (
        <div role="status" style={infoBox}>
          {status}
        </div>
      )}
      {error && (
        <div role="alert" style={errorBox}>
          <div>{error.summary}</div>
          {error.context && <div>{error.context}</div>}
          {error.technical && (
            <details>
              <summary>{t('spreadsheet.error.technicalEvidence')}</summary>
              <dl style={technicalEvidenceList}>
                <dt>{t('spreadsheet.error.technicalCode')}</dt>
                <dd style={technicalEvidenceValue}>
                  <code lang="en" dir="ltr">
                    {error.technical.code}
                  </code>
                </dd>
                {error.technical.details && (
                  <>
                    <dt>{t('spreadsheet.error.technicalDetails')}</dt>
                    <dd style={technicalEvidenceValue}>
                      <code lang="en" dir="ltr">
                        {error.technical.details}
                      </code>
                    </dd>
                  </>
                )}
              </dl>
            </details>
          )}
        </div>
      )}
      {sourceFile && phase !== 'parsing' && phase !== 'preparing' && phase !== 'committing' && (
        <button type="button" onClick={reset} style={secondaryButton}>
          {t('spreadsheet.reset')}
        </button>
      )}
    </section>
  )
}

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '0.8rem',
  minWidth: 0
}

const cardStyle: CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: 10,
  border: '1px solid var(--orbitpm-border)',
  borderRadius: 8,
  minWidth: 0
}

const cardTitle: CSSProperties = {
  margin: 0,
  fontSize: 13.5
}

const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  minWidth: 0
}

const fieldLabel: CSSProperties = {
  fontWeight: 600,
  fontSize: 12
}

const inputStyle: CSSProperties = {
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  padding: '0.45rem 0.55rem',
  borderRadius: 6,
  border: '1px solid var(--orbitpm-border)',
  color: 'inherit',
  background: 'var(--orbitpm-surface)'
}

const mutedText: CSSProperties = {
  margin: 0,
  color: 'var(--orbitpm-muted)',
  fontSize: 11.5,
  lineHeight: 1.45
}

const buttonRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  alignItems: 'center'
}

const secondaryButton: CSSProperties = {
  padding: '0.42rem 0.65rem',
  borderRadius: 6,
  border: '1px solid var(--orbitpm-border)',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer'
}

const primaryButton: CSSProperties = {
  ...secondaryButton,
  background: 'var(--orbitpm-accent)',
  borderColor: 'var(--orbitpm-accent)',
  color: '#fff',
  fontWeight: 700
}

const infoBox: CSSProperties = {
  display: 'grid',
  gap: 7,
  padding: 9,
  borderRadius: 7,
  border: '1px solid rgba(59,130,246,0.3)',
  background: 'rgba(59,130,246,0.09)',
  fontSize: 12
}

const okBox: CSSProperties = {
  ...infoBox,
  borderColor: 'rgba(22,163,74,0.3)',
  background: 'rgba(22,163,74,0.09)'
}

const warnBox: CSSProperties = {
  ...infoBox,
  borderColor: 'rgba(217,119,6,0.35)',
  background: 'rgba(217,119,6,0.10)'
}

const errorBox: CSSProperties = {
  ...infoBox,
  borderColor: 'rgba(220,38,38,0.35)',
  background: 'rgba(220,38,38,0.10)'
}

const technicalEvidenceList: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'max-content minmax(0, 1fr)',
  gap: '0.25rem 0.5rem',
  margin: '0.5rem 0 0'
}

const technicalEvidenceValue: CSSProperties = {
  margin: 0,
  minWidth: 0,
  overflowWrap: 'anywhere'
}

const mappingGroup: CSSProperties = {
  padding: 8,
  border: '1px solid var(--orbitpm-border)',
  borderRadius: 7
}

const mappingGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: 9
}

const mappingField: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 0,
  padding: 7,
  border: '1px solid var(--orbitpm-border)',
  borderRadius: 6
}

const issueList: CSSProperties = {
  display: 'grid',
  gap: 7,
  listStyle: 'none',
  padding: 0,
  margin: 0,
  maxHeight: 360,
  overflow: 'auto'
}

const issueItem: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '7px 8px',
  borderInlineStart: '3px solid var(--orbitpm-border)',
  background: 'rgba(127,127,127,0.06)',
  fontSize: 11.5,
  overflowWrap: 'anywhere'
}

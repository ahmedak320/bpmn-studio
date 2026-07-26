/**
 * Pure, durable contracts for OrbitPM's bilingual ingestion pipeline.
 *
 * This package deliberately contains no modeler, DOM, storage, or provider
 * dependency. Parsed moddle objects enter through the structural extractor;
 * callers apply the returned patches in their own single undoable transaction.
 */

export type LanguageCode = 'en' | 'ar'

export type ScriptClass = 'english' | 'arabic' | 'mixed' | 'neutral' | 'unknown'

/**
 * One common source vocabulary for every ingestion boundary named by the
 * 0.4.5 contract. The const-object form is enum-like at runtime while keeping
 * plain string literals assignable to the corresponding TypeScript type.
 */
export const LocalizationSource = {
  Xml: 'xml',
  Aris: 'aris',
  Ai: 'ai',
  Pdf: 'pdf',
  Image: 'image',
  Docx: 'docx',
  Excel: 'excel',
  Backup: 'backup',
  Editor: 'editor'
} as const

export type LocalizationSource = (typeof LocalizationSource)[keyof typeof LocalizationSource]

export const LOCALIZATION_SOURCES = Object.freeze(
  Object.values(LocalizationSource)
) as readonly LocalizationSource[]

export interface BilingualValue {
  en?: string
  ar?: string
  active: LanguageCode
}

export type LocalizationIssueCode =
  'missing' | 'wrong-script' | 'duplicate-counterpart' | 'mixed' | 'provider-failed'

export interface LocalizationIssue {
  source: LocalizationSource
  processId: string
  elementId: string
  field: string
  target: LanguageCode
  code: LocalizationIssueCode
  originalValue?: string
}

export type LocalizationFieldKind = 'name' | 'condition' | 'annotation' | 'notes' | 'metadata'

export type LocalizationValueOrigin = 'paired' | 'projection' | 'script-inferred'

/**
 * Property names are the keys expected by moddle/modeling updates:
 * registered extension attributes remain fully qualified (`orbitpm:*`).
 */
export interface LocalizationStorage {
  enProperty: string
  arProperty: string
  projectionProperty: string
}

/**
 * A normalized, read-only view of one translatable BPMN field.
 *
 * `projection` is the current legacy/visible value. `origins` records whether
 * a language was stored explicitly or inferred from that visible value; this
 * lets the local planning stage emit paired metadata without mutating input.
 */
export interface LocalizationField {
  source: LocalizationSource
  processId: string
  elementId: string
  elementType: string
  field: string
  kind: LocalizationFieldKind
  value: BilingualValue
  sourceLanguage?: LanguageCode
  projection?: string
  origins: Partial<Record<LanguageCode, LocalizationValueOrigin>>
  storage: LocalizationStorage
  planeIds: readonly string[]
}

export interface ProviderFailure {
  processId: string
  elementId: string
  field: string
  target: LanguageCode
  originalValue?: string
}

export interface GlossaryEntry {
  en: string
  ar: string
  /**
   * A neutral entry is explicitly approved to remain byte-for-byte equivalent
   * in both languages. Non-neutral entries are ordinary reviewed translations.
   */
  neutral?: boolean
}

export interface TranslationMemoryEntry {
  en: string
  ar: string
  /** Only explicitly accepted pairs are eligible for automatic local use. */
  accepted: true
  acceptedAt?: string
}

/**
 * Exact local resources used by ingestion/review. Workspace callers pass the
 * entries loaded from the public `.orbitpm/i18n` files; single-file callers
 * can continue using the built-in glossary and an empty translation memory.
 */
export interface LocalizationResources {
  glossary: readonly GlossaryEntry[]
  translationMemory: readonly TranslationMemoryEntry[]
}

export interface LocalizationAuditSummary {
  totalFields: number
  completeFields: number
  issueCount: number
  byCode: Record<LocalizationIssueCode, number>
  byTarget: Record<LanguageCode, number>
}

export interface LocalizationAuditReport {
  fields: LocalizationField[]
  issues: LocalizationIssue[]
  summary: LocalizationAuditSummary
}

export type LocalizationPatchReason =
  | 'source-seed'
  | 'glossary'
  | 'translation-memory'
  | 'neutral'
  | 'provider'
  | 'projection'
  | 'partial-fallback'

/**
 * A serializable mutation request. `expectedValue` is advisory optimistic
 * concurrency data for the integration layer; this pure package never applies
 * a patch itself.
 */
export interface LocalizationPatch {
  source: LocalizationSource
  processId: string
  elementId: string
  field: string
  property: string
  value: string
  expectedValue?: string
  target?: LanguageCode
  reason: LocalizationPatchReason
}

export interface LocalResourcePlan {
  fields: LocalizationField[]
  updates: LocalizationPatch[]
  issues: LocalizationIssue[]
  glossaryMatches: number
  translationMemoryMatches: number
  neutralMatches: number
}

export interface TranslationQueueItem {
  source: LocalizationSource
  processId: string
  elementId: string
  field: string
  sourceLanguage: LanguageCode
  sourceValue: string
  target: LanguageCode
  issues: LocalizationIssue[]
  /** Mixed source text must be segmented/manual-reviewed before execution. */
  requiresSegmentationReview?: boolean
}

export interface ProjectionPlan {
  language: LanguageCode
  complete: boolean
  updates: LocalizationPatch[]
  blockers: LocalizationIssue[]
  projected: number
  unchanged: number
  fallbackCount: number
}

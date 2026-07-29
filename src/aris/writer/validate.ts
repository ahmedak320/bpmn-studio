import { XmlTokenizerError, tokenizeXmlDocument } from '../source/xmlTokenizer'
import {
  buildWriterSourceView,
  declaredIds,
  isIdDeclarationAttribute,
  type WriterElement,
  type WriterSourceView
} from './sourceView'
import type { WriterSpan } from './spans'

/**
 * Export validation (plan section 9.3).
 *
 * Every check below must pass before a derived AML document may be downloaded. The checks are
 * run against the DERIVED text only — never against the writer's intent — so a bug anywhere in
 * the edit pipeline surfaces here rather than in ARIS.
 */
export type ArisExportCheck =
  | 'xml-well-formed'
  | 'unique-ids'
  | 'definition-references-resolve'
  | 'occurrences-belong-to-a-model'
  | 'connection-endpoints-exist'
  | 'linked-models-resolve'
  | 'attachment-references-resolve'
  | 'source-accounting-complete'
  | 'no-unsafe-content'

export const ARIS_EXPORT_CHECKS: readonly ArisExportCheck[] = Object.freeze([
  'xml-well-formed',
  'unique-ids',
  'definition-references-resolve',
  'occurrences-belong-to-a-model',
  'connection-endpoints-exist',
  'linked-models-resolve',
  'attachment-references-resolve',
  'source-accounting-complete',
  'no-unsafe-content'
])

export interface ArisExportIssue {
  readonly check: ArisExportCheck
  readonly message: string
  readonly path: string | null
  readonly sourceId: string | null
  readonly span: WriterSpan | null
}

export interface ArisExportCheckResult {
  readonly check: ArisExportCheck
  readonly passed: boolean
  readonly issues: readonly ArisExportIssue[]
}

export interface ArisExportValidationReport {
  readonly ok: boolean
  readonly checks: readonly ArisExportCheckResult[]
  readonly issues: readonly ArisExportIssue[]
}

/**
 * Source accounting inputs (plan section 9.3, "Source accounting is complete").
 *
 * The derived document must account for every id the original declared: an original id is
 * either still present or explicitly listed as removed, and every id that is new must be
 * explicitly listed as added. Silent disappearance and silent appearance are both failures.
 */
export interface ArisSourceAccounting {
  readonly originalIds: readonly string[]
  readonly removedIds?: readonly string[]
  readonly addedIds?: readonly string[]
}

export interface ArisExportValidationOptions {
  readonly accounting: ArisSourceAccounting
  /** DOCTYPE external identifier the ORIGINAL declared, so an unchanged one is not flagged. */
  readonly originalDoctypeExternalId?: string | null
  /** Linked model ids known to be absent from this export and deliberately marked missing. */
  readonly knownMissingLinkedModelIds?: readonly string[]
  /** Attachment (`OLEDef`) ids known to be absent and deliberately marked missing. */
  readonly knownMissingAttachmentIds?: readonly string[]
}

/** Element names whose records are occurrences and must therefore live inside a `<Model>`. */
const OCCURRENCE_ELEMENTS: ReadonlySet<string> = new Set([
  'ObjOcc',
  'CxnOcc',
  'OLEOcc',
  'FFTextOcc',
  'Lane'
])

/** Reference attributes handled by a dedicated check rather than the generic resolver. */
const SPECIAL_REFERENCE_ATTRIBUTES: ReadonlySet<string> = new Set([
  'LinkedModels.IdRefs',
  'OLEDef.IdRef'
])

function issue(
  check: ArisExportCheck,
  message: string,
  element?: WriterElement | null,
  span?: WriterSpan | null
): ArisExportIssue {
  return Object.freeze({
    check,
    message,
    path: element?.path ?? null,
    sourceId: element?.sourceId ?? null,
    span: span ?? element?.span ?? null
  })
}

function result(check: ArisExportCheck, issues: readonly ArisExportIssue[]): ArisExportCheckResult {
  return Object.freeze({ check, passed: issues.length === 0, issues: Object.freeze([...issues]) })
}

function report(checks: readonly ArisExportCheckResult[]): ArisExportValidationReport {
  const issues = checks.flatMap((entry) => entry.issues)
  return Object.freeze({
    ok: issues.length === 0,
    checks: Object.freeze([...checks]),
    issues: Object.freeze(issues)
  })
}

/** Everything the "no unsafe content" check looks for in a derived document. */
const UNSAFE_ELEMENT_NAMES: ReadonlySet<string> = new Set(['script', 'Script', 'SCRIPT'])
const UNSAFE_URL_RE = /(?:javascript|vbscript):|data:text\/html/i

function checkUnsafeContent(
  view: WriterSourceView,
  options: ArisExportValidationOptions
): ArisExportIssue[] {
  const issues: ArisExportIssue[] = []
  const originalExternalId = options.originalDoctypeExternalId ?? null
  if (view.doctypeExternalId !== originalExternalId) {
    issues.push(
      issue(
        'no-unsafe-content',
        `The derived document declares DOCTYPE external identifier ` +
          `"${view.doctypeExternalId ?? '(none)'}" but the original declared ` +
          `"${originalExternalId ?? '(none)'}". Introducing or changing an external ` +
          'identifier is not allowed.'
      )
    )
  }
  view.elements.forEach((element) => {
    if (UNSAFE_ELEMENT_NAMES.has(element.name)) {
      issues.push(
        issue('no-unsafe-content', `Executable element <${element.name}> is not allowed.`, element)
      )
    }
    element.attributes.forEach((attribute) => {
      if (UNSAFE_URL_RE.test(attribute.value)) {
        issues.push(
          issue(
            'no-unsafe-content',
            `Attribute "${attribute.name}" carries an executable URL scheme.`,
            element,
            attribute.valueSpan
          )
        )
      }
      if (attribute.name.toLowerCase().startsWith('on')) {
        issues.push(
          issue(
            'no-unsafe-content',
            `Event-handler attribute "${attribute.name}" is not allowed in AML.`,
            element,
            attribute.span
          )
        )
      }
    })
  })
  view.entities.forEach((value, name) => {
    if (value.includes('<') || UNSAFE_URL_RE.test(value)) {
      issues.push(
        issue('no-unsafe-content', `Internal entity "${name}" expands to markup or a URL scheme.`)
      )
    }
  })
  return issues
}

/**
 * Run every plan section 9.3 check against a derived AML document.
 *
 * A malformed document short-circuits: the remaining checks need a parse tree, and reporting
 * eight cascading failures for one syntax error helps nobody.
 */
export function validateDerivedAml(
  derivedText: string,
  options: ArisExportValidationOptions
): ArisExportValidationReport {
  let view: WriterSourceView
  try {
    view = buildWriterSourceView(derivedText, tokenizeXmlDocument(derivedText))
  } catch (error) {
    const tokenizerError = error instanceof XmlTokenizerError ? error : null
    const unsafe =
      tokenizerError?.code === 'external-entity' || tokenizerError?.code === 'entity-limit'
    const check: ArisExportCheck = unsafe ? 'no-unsafe-content' : 'xml-well-formed'
    const message = error instanceof Error ? error.message : String(error)
    const failed = issue(check, `The derived document could not be parsed: ${message}`)
    return report(
      ARIS_EXPORT_CHECKS.map((candidate) => result(candidate, candidate === check ? [failed] : []))
    )
  }

  const ids = declaredIds(view)
  const idCounts = new Map<string, number>()
  ids.forEach((id) => idCounts.set(id, (idCounts.get(id) ?? 0) + 1))

  // --- unique-ids ---
  const duplicateIssues: ArisExportIssue[] = []
  view.elements.forEach((element) => {
    element.attributes.forEach((attribute) => {
      if (!isIdDeclarationAttribute(attribute.name)) return
      if ((idCounts.get(attribute.value) ?? 0) > 1) {
        duplicateIssues.push(
          issue(
            'unique-ids',
            `Id "${attribute.value}" is declared ${idCounts.get(attribute.value)} times.`,
            element,
            attribute.valueSpan
          )
        )
      }
    })
  })

  // --- definition-references-resolve ---
  const referenceIssues: ArisExportIssue[] = []
  view.references.forEach((reference) => {
    if (SPECIAL_REFERENCE_ATTRIBUTES.has(reference.attributeName)) return
    if (view.byId.has(reference.targetId)) return
    referenceIssues.push(
      issue(
        'definition-references-resolve',
        `"${reference.attributeName}" on ${reference.elementPath} references "${reference.targetId}", ` +
          'which no record declares.',
        view.byPath.get(reference.elementPath) ?? null,
        reference.span
      )
    )
  })

  // --- occurrences-belong-to-a-model ---
  const occurrenceIssues: ArisExportIssue[] = []
  view.elements.forEach((element) => {
    if (!OCCURRENCE_ELEMENTS.has(element.name)) return
    let ancestorPath = element.parentPath
    let insideModel = false
    while (ancestorPath !== null) {
      const ancestor = view.byPath.get(ancestorPath)
      if (!ancestor) break
      if (ancestor.name === 'Model') {
        insideModel = true
        break
      }
      ancestorPath = ancestor.parentPath
    }
    if (!insideModel) {
      occurrenceIssues.push(
        issue(
          'occurrences-belong-to-a-model',
          `<${element.name}> "${element.sourceId ?? element.path}" is not inside a <Model>.`,
          element
        )
      )
    }
  })

  // --- connection-endpoints-exist ---
  const endpointIssues: ArisExportIssue[] = []
  view.elements.forEach((element) => {
    if (element.name === 'CxnDef') {
      const target = element.attributeByName.get('ToObjDef.IdRef')
      if (!target || !view.byId.has(target.value)) {
        endpointIssues.push(
          issue(
            'connection-endpoints-exist',
            `Connection definition "${element.sourceId ?? element.path}" has no resolvable target ` +
              'object definition.',
            element,
            target?.valueSpan ?? null
          )
        )
      }
      const parent = element.parentPath === null ? null : view.byPath.get(element.parentPath)
      if (!parent || parent.name !== 'ObjDef') {
        endpointIssues.push(
          issue(
            'connection-endpoints-exist',
            `Connection definition "${element.sourceId ?? element.path}" is not nested under a ` +
              'source <ObjDef>, so it has no source endpoint.',
            element
          )
        )
      }
    }
    if (element.name === 'CxnOcc') {
      const target = element.attributeByName.get('ToObjOcc.IdRef')
      if (!target || !view.byId.has(target.value)) {
        endpointIssues.push(
          issue(
            'connection-endpoints-exist',
            `Connection occurrence "${element.sourceId ?? element.path}" has no resolvable target ` +
              'object occurrence.',
            element,
            target?.valueSpan ?? null
          )
        )
      }
      const parent = element.parentPath === null ? null : view.byPath.get(element.parentPath)
      if (!parent || parent.name !== 'ObjOcc') {
        endpointIssues.push(
          issue(
            'connection-endpoints-exist',
            `Connection occurrence "${element.sourceId ?? element.path}" is not nested under a ` +
              'source <ObjOcc>, so it has no source endpoint.',
            element
          )
        )
      }
    }
  })

  // --- linked-models-resolve ---
  const knownMissingModels = new Set(options.knownMissingLinkedModelIds ?? [])
  const linkedModelIssues: ArisExportIssue[] = []
  view.references.forEach((reference) => {
    if (reference.attributeName !== 'LinkedModels.IdRefs') return
    if (view.byId.has(reference.targetId)) return
    if (knownMissingModels.has(reference.targetId)) return
    linkedModelIssues.push(
      issue(
        'linked-models-resolve',
        `Linked model "${reference.targetId}" referenced by ${reference.elementPath} neither ` +
          'resolves nor is marked missing.',
        view.byPath.get(reference.elementPath) ?? null,
        reference.span
      )
    )
  })

  // --- attachment-references-resolve ---
  const knownMissingAttachments = new Set(options.knownMissingAttachmentIds ?? [])
  const attachmentIssues: ArisExportIssue[] = []
  view.references.forEach((reference) => {
    if (reference.attributeName !== 'OLEDef.IdRef') return
    if (view.byId.has(reference.targetId)) return
    if (knownMissingAttachments.has(reference.targetId)) return
    attachmentIssues.push(
      issue(
        'attachment-references-resolve',
        `Attachment "${reference.targetId}" referenced by ${reference.elementPath} does not resolve.`,
        view.byPath.get(reference.elementPath) ?? null,
        reference.span
      )
    )
  })

  // --- source-accounting-complete ---
  const derivedIds = new Set(ids)
  const originalIds = new Set(options.accounting.originalIds)
  const removedIds = new Set(options.accounting.removedIds ?? [])
  const addedIds = new Set(options.accounting.addedIds ?? [])
  const accountingIssues: ArisExportIssue[] = []
  originalIds.forEach((id) => {
    if (derivedIds.has(id) || removedIds.has(id)) return
    accountingIssues.push(
      issue(
        'source-accounting-complete',
        `Source record "${id}" disappeared from the derived export without being recorded as removed.`
      )
    )
  })
  derivedIds.forEach((id) => {
    if (originalIds.has(id) || addedIds.has(id)) return
    accountingIssues.push(
      issue(
        'source-accounting-complete',
        `Derived record "${id}" is not in the original and was not recorded as added.`
      )
    )
  })
  removedIds.forEach((id) => {
    if (!derivedIds.has(id)) return
    accountingIssues.push(
      issue(
        'source-accounting-complete',
        `Record "${id}" is recorded as removed but is still present in the derived export.`
      )
    )
  })

  return report([
    result('xml-well-formed', []),
    result('unique-ids', duplicateIssues),
    result('definition-references-resolve', referenceIssues),
    result('occurrences-belong-to-a-model', occurrenceIssues),
    result('connection-endpoints-exist', endpointIssues),
    result('linked-models-resolve', linkedModelIssues),
    result('attachment-references-resolve', attachmentIssues),
    result('source-accounting-complete', accountingIssues),
    result('no-unsafe-content', checkUnsafeContent(view, options))
  ])
}

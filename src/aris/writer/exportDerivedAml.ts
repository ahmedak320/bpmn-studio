import {
  describeArisExportCompatibility,
  type ArisExportCompatibility
} from './compatibility'
import { ArisWriterError } from './errors'
import { applyAmlEdits, pruneNoOpEdits, type AmlEdit, type AmlPatchResult } from './patch'
import { byteLength } from './spans'
import { declaredIds, readWriterSourceView } from './sourceView'
import {
  validateDerivedAml,
  type ArisExportValidationReport,
  type ArisSourceAccounting
} from './validate'

/**
 * The derived-export pipeline (plan sections 9.1-9.6).
 *
 * The imported original is immutable: `original.text` is read, never written. The derived
 * document is produced entirely by applying byte-addressed edits to a copy, so an export with
 * an empty edit set is byte-identical to its source by construction.
 */
export interface DerivedAmlExportInput {
  /** The exact decoded text of the imported original. Never modified. */
  readonly originalText: string
  /** Edits addressed against `originalText`. */
  readonly edits: readonly AmlEdit[]
  /** Ids the edit set deliberately removes, for the source-accounting check. */
  readonly removedIds?: readonly string[]
  /** Ids the edit set deliberately adds, for the source-accounting check. */
  readonly addedIds?: readonly string[]
  readonly knownMissingLinkedModelIds?: readonly string[]
  readonly knownMissingAttachmentIds?: readonly string[]
  /** Drop edits that would replace bytes with themselves. Defaults to `true`. */
  readonly pruneNoOps?: boolean
}

export interface DerivedAmlExport {
  readonly text: string
  readonly bytes: Uint8Array
  readonly patch: AmlPatchResult
  readonly validation: ArisExportValidationReport
  readonly compatibility: ArisExportCompatibility
  readonly originalByteLength: number
  readonly derivedByteLength: number
  /** True when the derived bytes differ from the original bytes. */
  readonly changed: boolean
  readonly accounting: ArisSourceAccounting
}

/**
 * Build a derived export and run every section 9.3 validation, WITHOUT throwing.
 *
 * Use this to show a user why an export is blocked. Use {@link exportDerivedAml} when the file
 * is about to be written or downloaded.
 */
export function prepareDerivedAml(input: DerivedAmlExportInput): DerivedAmlExport {
  const original = input.originalText
  const originalView = readWriterSourceView(original)
  const accounting: ArisSourceAccounting = {
    originalIds: declaredIds(originalView),
    removedIds: input.removedIds ?? [],
    addedIds: input.addedIds ?? []
  }

  const edits = input.pruneNoOps === false ? input.edits : pruneNoOpEdits(original, input.edits)
  const patch = applyAmlEdits(original, edits)

  const validation = validateDerivedAml(patch.text, {
    accounting,
    originalDoctypeExternalId: originalView.doctypeExternalId,
    knownMissingLinkedModelIds: input.knownMissingLinkedModelIds,
    knownMissingAttachmentIds: input.knownMissingAttachmentIds
  })

  return Object.freeze({
    text: patch.text,
    bytes: patch.bytes,
    patch,
    validation,
    compatibility: describeArisExportCompatibility(),
    originalByteLength: byteLength(original),
    derivedByteLength: patch.derivedByteLength,
    changed: patch.text !== original,
    accounting
  })
}

/**
 * Build a derived export and refuse to return it unless every section 9.3 check passed.
 *
 * This is the only function a download path may call. Validation failure is a hard error, not a
 * warning: an AML that ARIS would reject (or that silently lost a record) must never reach a
 * user's disk labelled as an export of their model.
 */
export function exportDerivedAml(input: DerivedAmlExportInput): DerivedAmlExport {
  const prepared = prepareDerivedAml(input)
  if (!prepared.validation.ok) {
    const failed = prepared.validation.checks
      .filter((check) => !check.passed)
      .map((check) => check.check)
    throw new ArisWriterError(
      'validation-failed',
      `Derived AML export failed validation: ${failed.join(', ')}. ` +
        `First issue: ${prepared.validation.issues[0]?.message ?? 'unknown'}`,
      { detail: { failedChecks: failed.join(','), issueCount: prepared.validation.issues.length } }
    )
  }
  return prepared
}

/**
 * Own minimal working-document contracts for Phase 15 (chat improvement and
 * missing-information completion — plan section 18).
 *
 * ## The seam
 *
 * `src/aris/model` owns the real `ArisWorkingDocument` / `ArisEditCommand` types and is being
 * built out in parallel by another agent. Rather than importing those internals, this module
 * (like `src/aris/epc`) defines its own narrow, *structural* document shape below. Every field
 * name and nesting level here was chosen to match `src/aris/model/types.ts` exactly (read
 * read-only while authoring this module — see the mapping notes in `modelCommandMapping.ts`),
 * so the real `ArisWorkingDocument` can be handed to `scanArisChatGaps` / the apply engine
 * directly, with no adapter needed, as long as it has at least the fields below. If the real
 * document ever needs a field renamed, only this file (and the one seam function that builds
 * an `EpcGraph` from it, `toChatEpcGraph` in `gapScanner.ts`) need to change.
 *
 * This document type is intentionally read/write-agnostic: the apply engine in
 * `applyEngine.ts` never mutates it in place (every applier returns a new document), matching
 * the immutable-document convention already used by `src/aris/model/commands.ts`.
 */

/** Bilingual/multi-locale text, keyed by locale id — mirrors `ArisLocalizedValue`. */
export interface ArisChatLocalizedValue {
  readonly values: Readonly<Record<string, string>>
  readonly fallback: string | null
}

export interface ArisChatAttributeValue {
  readonly localeId: string | null
  readonly text: string
}

export interface ArisChatAttribute {
  readonly type: string
  readonly values: readonly ArisChatAttributeValue[]
}

export interface ArisChatObjectDefinition {
  readonly id: string
  readonly type: string
  readonly names: ArisChatLocalizedValue
  readonly attributes: readonly ArisChatAttribute[]
  readonly linkedModelIds: readonly string[]
}

export interface ArisChatConnectionDefinition {
  readonly id: string
  readonly type: string
  readonly fromObjectDefinitionId: string
  readonly toObjectDefinitionId: string
  readonly names: ArisChatLocalizedValue
  readonly attributes: readonly ArisChatAttribute[]
}

export interface ArisChatObjectOccurrence {
  readonly id: string
  readonly definitionId: string
  readonly modelId: string
  readonly symbol: string | null
}

export interface ArisChatConnectionOccurrence {
  readonly id: string
  readonly definitionId: string
  readonly modelId: string
  readonly sourceOccurrenceId: string
  readonly targetOccurrenceId: string
  /** Bend points. Optional — only the apply-engine test host and `setRoute` touch this. */
  readonly route?: readonly { readonly x: number; readonly y: number }[]
  /** Connection-occurrence-local label (e.g. an XOR branch outcome). */
  readonly names?: ArisChatLocalizedValue
}

export interface ArisChatModel {
  readonly id: string
  readonly names: ArisChatLocalizedValue
  readonly occurrences: readonly ArisChatObjectOccurrence[]
  readonly connectionOccurrences: readonly ArisChatConnectionOccurrence[]
  /**
   * The ARIS model type (e.g. `MT_EEPC`, `MT_VAL_ADD_CHN_DGM`). Optional in this
   * reduced shape so synthesized documents keep working; real
   * `ArisWorkingDocument` models always carry it. The gap scanner treats an
   * absent type as "unknown" and runs every check (never suppressing a
   * potentially real finding); a positively non-EPC type exempts the model from
   * the EPC-semantics checks.
   */
  readonly type?: string
}

/** A reference to a user-supplied attachment (plan 18.1 "missing attachment"). */
export interface ArisChatAttachmentRef {
  readonly id: string
  readonly ownerId: string
  readonly ownerKind: 'objectDefinition' | 'model'
  readonly name: string
}

/**
 * The editable ARIS working document, reduced to the fields Phase 15 needs. Structurally
 * compatible with `ArisWorkingDocument` (see module doc) plus two chat-only extension points
 * that the real document does not (yet) need to carry: `attachments` and
 * `unaccountedSourceIds`, both optional so a bare `ArisWorkingDocument` still satisfies this
 * shape.
 */
export interface ArisChatWorkingDocument {
  readonly revision: number
  readonly models: ReadonlyMap<string, ArisChatModel>
  readonly objectDefinitions: ReadonlyMap<string, ArisChatObjectDefinition>
  readonly connectionDefinitions: ReadonlyMap<string, ArisChatConnectionDefinition>
  /** Known attachments, keyed by attachment id. Absent means "no attachment tracking available". */
  readonly attachments?: ReadonlyMap<string, ArisChatAttachmentRef>
  /**
   * Source-record ids the import/source layer flagged as present in the original file but not
   * represented anywhere in this document (parallel to `ArisSourceIndexLike.unknownRecords` in
   * `src/aris/model/types.ts`). Absent means "nothing to report".
   */
  readonly unaccountedSourceIds?: readonly string[]
}

export type ArisChatSeverity = 'error' | 'warning'

// Phase 14 (aris_transformation.md Section 17) — folder-aware ARIS process
// assistant. This module owns the digest/index/retrieval/answer types and is
// intentionally self-contained: it does NOT import from `src/aris/model` or
// `src/aris/source`, both of which are being actively reshaped by other
// agents while this lane is being built. See `seamAdapter.ts` for the single
// documented boundary where a real parsed ARIS working document is expected
// to be adapted into the `ArisAssistantModelInput` shape defined here.

// ---------------------------------------------------------------------------
// Input seam — the assistant's OWN minimal contract for "a parsed ARIS
// model". Anything upstream (native working-document model, imported
// package, single-file source) must be adapted into this shape before it
// reaches `buildDigest`. Keeping this contract narrow and locally owned
// means the assistant lane never breaks when the real parser's internal
// types change shape mid-flight.
// ---------------------------------------------------------------------------

/** A name/text value resolved to the two locales the product supports. */
export interface ArisAssistantLocalizedText {
  readonly en: string | null
  readonly ar: string | null
  /** Best-effort display text when neither `en` nor `ar` could be resolved. */
  readonly fallback: string | null
}

/** One attribute value (e.g. AT_NAME, AT_PERS_RESP) already resolved to text per locale. */
export interface ArisAssistantAttribute {
  readonly type: string
  readonly text: ArisAssistantLocalizedText
}

/** An object occurrence, denormalized with its definition's name/attributes/type already resolved. */
export interface ArisAssistantObjectOccurrenceInput {
  readonly occurrenceId: string
  readonly definitionId: string
  /** Raw ARIS object type code, e.g. `OT_FUNC`, `OT_EVT`, `OT_RULE`, `OT_PERS`. */
  readonly objectType: string
  /** Raw ARIS symbol code, e.g. `ST_OPR_XOR_1`, used to distinguish gateway kinds. */
  readonly symbol: string | null
  readonly names: ArisAssistantLocalizedText
  readonly attributes: readonly ArisAssistantAttribute[]
  /** Model ids this occurrence's definition links to (assigned/linked sub-models). */
  readonly linkedModelIds: readonly string[]
}

/** A connection occurrence between two object occurrences in the SAME model. */
export interface ArisAssistantConnectionOccurrenceInput {
  readonly occurrenceId: string
  readonly definitionId: string
  /** Raw ARIS connection type code, e.g. `CT_ACTIV_1`, `CT_EXEC_1`, `CT_IS_INP_FOR`. */
  readonly connectionType: string
  readonly sourceOccurrenceId: string
  readonly targetOccurrenceId: string
  /** The connection's own label, when the source model gives branches explicit outcome text. */
  readonly names: ArisAssistantLocalizedText
}

/** The assistant's minimal view of one ARIS model (a single AML `<Model>`). */
export interface ArisAssistantModelInput {
  /** Workspace/package-relative path of the source file this model was read from. */
  readonly relPath: string
  readonly modelId: string
  /** Raw ARIS model type code, e.g. `MT_EEPC`, `MT_VAL_ADD_CHN_DGM`. */
  readonly modelType: string
  readonly names: ArisAssistantLocalizedText
  readonly attributes: readonly ArisAssistantAttribute[]
  readonly occurrences: readonly ArisAssistantObjectOccurrenceInput[]
  readonly connectionOccurrences: readonly ArisAssistantConnectionOccurrenceInput[]
  /** Monotonically increasing revision counter of the working copy this model came from. */
  readonly revision: number
  /** Stable content hash of the model's own source record, used for cache keys. */
  readonly sourceDigest: string
}

// ---------------------------------------------------------------------------
// Digest — Section 17.1, field-for-field as specified by the plan.
// ---------------------------------------------------------------------------

export interface ArisProcessDigest {
  readonly relPath: string
  readonly modelId: string
  readonly modelType: string
  readonly modelName: string
  readonly processCode?: string
  readonly owners: readonly string[]
  readonly triggers: readonly string[]
  readonly steps: readonly ArisDigestStep[]
  readonly decisions: readonly ArisDigestDecision[]
  readonly inputs: readonly string[]
  readonly outputs: readonly string[]
  readonly systems: readonly string[]
  readonly assignments: readonly ArisDigestAssignment[]
  readonly missingInformation: readonly ArisDigestGap[]
}

export interface ArisDigestStep {
  readonly occurrenceId: string
  readonly definitionId: string
  readonly name: string
  readonly nameEn?: string
  readonly nameAr?: string
  readonly objectType: string
  readonly responsible: readonly string[]
  readonly inputs: readonly string[]
  readonly outputs: readonly string[]
  readonly systems: readonly string[]
  readonly next: readonly {
    readonly targetOccurrenceId: string
    readonly relationType: string
    readonly outcome?: string
  }[]
}

/** A gateway/rule step's resolved outcome branches — Section 17.4 "what XOR outcomes exist". */
export interface ArisDigestDecision {
  readonly occurrenceId: string
  readonly definitionId: string
  readonly name: string
  readonly nameEn?: string
  readonly nameAr?: string
  /** Derived from the gateway's symbol: `XOR`, `AND`, `OR`, or `RULE` when the symbol is unrecognized. */
  readonly gatewayType: 'XOR' | 'AND' | 'OR' | 'RULE'
  readonly basis?: string
  readonly outcomes: readonly {
    readonly outcome: string
    readonly targetOccurrenceId: string
    readonly targetName: string
  }[]
}

/** An occurrence whose definition links to another model — Section 17.4 "which model is assigned". */
export interface ArisDigestAssignment {
  readonly occurrenceId: string
  readonly definitionId: string
  readonly name: string
  readonly nameEn?: string
  readonly nameAr?: string
  readonly linkedModelId: string
}

export type ArisDigestGapKind =
  | 'missingNameEn'
  | 'missingNameAr'
  | 'missingProcessCode'
  | 'missingOwner'
  | 'missingInputs'
  | 'missingOutputs'
  | 'missingSystem'
  | 'missingDecisionBasis'
  | 'missingOutcome'
  | 'danglingConnection'

/**
 * One deterministically-detected gap. This is the Section 17.1/17.4 subset
 * the assistant needs to answer "which information is missing" — NOT the
 * full Section 18.1 gap scanner (start/end event validity, unused
 * definitions, attachments, …), which belongs to the later Phase 15 lane.
 */
export interface ArisDigestGap {
  readonly kind: ArisDigestGapKind
  readonly occurrenceId?: string
  readonly definitionId?: string
  readonly stepName?: string
  readonly detail?: string
}

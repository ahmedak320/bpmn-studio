/**
 * Own minimal graph input contract for the EPC semantics module (plan section 14).
 *
 * ## The seam
 *
 * `src/aris/model` and `src/aris/source` are being reshaped by other agents while this
 * module is implemented. Rather than importing their concrete types, this module defines
 * its own narrow, structural graph shape (`EpcNode` / `EpcEdge` / `EpcGraph`) and adapts to
 * it at exactly one place: `toEpcGraph` in `./adapter.ts`. Everything else in `src/aris/epc`
 * depends only on the types in this file.
 *
 * Any caller — the working-model layer, the source-index layer, or a test fixture — can
 * produce an `EpcGraph` by constructing these plain objects directly, or by passing
 * structurally-compatible occurrence/definition arrays through `toEpcGraph`. Because the
 * adapter uses structural typing (no imported class/interface from `src/aris/model` or
 * `src/aris/source`), it keeps working even while those modules' concrete types are still
 * moving.
 */

/** ARIS object-type code, e.g. `OT_FUNC`, `OT_EVT`, `OT_RULE`, `OT_APPL_SYS`. */
export type EpcObjectType = string

/** ARIS symbol code, e.g. `ST_OPR_XOR_1`, `ST_OPR_AND_1`, `ST_EV`, `ST_FUNC`. */
export type EpcSymbolType = string

/** ARIS connection-type code, e.g. `CT_ACTIV_1`, `CT_CRT_1`, `CT_LEADS_TO_2`. */
export type EpcConnectionType = string

/** Bilingual (or multi-locale) display names, keyed by locale id or a short language tag. */
export type EpcLocalizedNames = Readonly<Record<string, string>>

/**
 * A single EPC (or satellite) object occurrence, reduced to the fields this module needs.
 * `id` must be stable and unique within the graph — it identifies the occurrence, not the
 * shared definition, so that repeated occurrences of one definition are never collapsed.
 */
export interface EpcNode {
  readonly id: string
  readonly objectType: EpcObjectType
  readonly symbolType: EpcSymbolType | null
  readonly names: EpcLocalizedNames
  /** Model ids this node's underlying definition is linked to (process-interface assignment). */
  readonly linkedModelIds?: readonly string[]
  /**
   * When true, this node's definition is not eligible as a return-path re-entry target (for
   * example, an imported/reference-only definition the current user cannot edit). Defaults
   * to editable (`false`/absent) when omitted — see `returnPath.ts`.
   */
  readonly locked?: boolean
}

/**
 * A single typed connection occurrence between two node ids in the same graph.
 * `id` identifies the occurrence; multiple edges between the same pair of nodes (parallel
 * edges, self-loops, or explicit cycles) are always preserved distinctly by `id`.
 */
export interface EpcEdge {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly connectionType: EpcConnectionType
  readonly names?: EpcLocalizedNames
}

/** A full EPC (or EPC-shaped) graph: every node/edge from one model. */
export interface EpcGraph {
  readonly modelId: string
  readonly nodes: readonly EpcNode[]
  readonly edges: readonly EpcEdge[]
}

/** A single route/bend point, used only by the return-path apply payload (14.3). */
export interface EpcPoint {
  readonly x: number
  readonly y: number
}

export type EpcSeverity = 'error' | 'warning'

/**
 * A single structured validation finding. Never prose: `messageKey` is an i18n lookup key
 * (see `src/i18n`), and any human text is produced later by `t(messageKey, messageParams)`.
 *
 * NOTE ON MESSAGE KEYS: this module cannot touch `src/i18n/dictionaries.ts` (out of scope /
 * mid-flight elsewhere), so the keys below are defined but not yet registered in the
 * dictionaries. See the module doc in `index.ts` for the exact list that must be added.
 */
export interface EpcFinding {
  readonly ruleId: string
  readonly severity: EpcSeverity
  readonly messageKey: string
  readonly messageParams?: Readonly<Record<string, string>>
  readonly nodeIds: readonly string[]
  readonly edgeIds: readonly string[]
}

/**
 * `buildVerificationPackage` — deterministic verification-package builder
 * (implementation plan Lane L-VPKG, Wave 19; deliverable 5; milestone
 * amendment at plan line 26 adds `purpose`/`approvals`).
 *
 * Turns a `CanonicalProcessV1` into the flat, portal-facing
 * `VerificationPackageV1` artifact used for per-element human verification
 * (Confirm/Correct): trigger, outcomes, owner, main flow (via the SAME
 * depth-first spine the EPC projection uses — `canonicalFlowOrder` from
 * `./projectToEpc` is IMPORTED, never re-implemented), roles, systems,
 * information objects, decisions, unknowns, an evidence summary with
 * reverse-references, a confidence rollup, and approvals. Pure and
 * deterministic: no clock or randomness, every array explicitly sorted
 * (see "Ordering" below), so two builds of the same input are
 * `canonicalJsonText`-identical (see `verificationPackage.test.ts`).
 *
 * `deriveTriggerEntries`/`deriveOutcomeEntries`/`deriveNarrativeSummary` are
 * exported so `./narrative.ts` (same lane) describes the identical trigger/
 * outcome set and opening paragraph the package reports — "consistency with
 * the model is by construction" rather than by two independently-written
 * derivations agreeing by luck. (`./narrative.ts` imports from this module;
 * this module imports nothing from `./narrative.ts` — the dependency is
 * one-directional, no cycle.)
 *
 * ## Fields with no direct 1:1 contract source (derivations — documented per
 * the lane brief's "hard constraints": faithful interpretation from what the
 * contract DOES provide, never an invented contract field)
 *
 *  1. **`trigger`** — nodes of kind `'event'` with in-degree 0 over
 *     control-flow edges (`sequence|conditional|parallel|handoff|
 *     exception-route`) PLUS decision-outcome targets. This mirrors
 *     `canonicalFlowOrder`'s own start-node rule exactly (`projectToEpc.ts`'s
 *     `hasIncoming` set), so `trigger` and the head of `mainFlow` always
 *     agree.
 *  2. **`outcomes`** — nodes of kind `'event'` with OUT-degree 0 over the
 *     `edges[]` array (the same control-flow kinds). A decision node's
 *     outgoing control flow is never expressed as a plain edge (`contract.ts`
 *     enforces this via its `decision-node-sequence-edge` rule), so decision
 *     nodes never spuriously qualify as "outcomes" by this rule. This single
 *     rule covers both a standalone terminal event AND a decision outcome
 *     that terminates directly: if an outcome's `targetNodeId` has no
 *     further outgoing control flow, that target is already an "end event"
 *     under this rule — no separate traversal is needed for "terminating
 *     decision outcomes" as a distinct category.
 *  3. **`owner`** — the role with `owner: true`, lowest id first if more than
 *     one is marked that way (the contract does not forbid multiple owners);
 *     `null` when no role has `owner: true` (never a throw — e.g.
 *     `VALID_CANONICAL_MISSING_ROLE`, which declares no roles at all; the gap
 *     is surfaced through the pre-existing `unknowns[]` entry, unchanged).
 *  4. **`decisions[].names`** — `CanonicalDecision` itself carries no `names`
 *     field; the entry's `names` is the underlying decision NODE's `names`
 *     (the `nodes[]` entry for `decision.nodeId`, i.e. the deciding step) —
 *     the only faithful source the contract provides.
 *  5. **`unknowns[]` sort key** — `CanonicalUnknown` has no `id` field (only
 *     `targetId`, which is not unique — two unknowns may target the same
 *     id, e.g. two different missing fields on one node). Sorted by
 *     `(targetId, kind, field ?? '')` as a documented stand-in for "sorted
 *     by id".
 *  6. **`evidenceSummary[].referencedBy`** — the reverse index of every
 *     entity's `factIds` across the exact 8 sources `contract.ts`'s own
 *     `checkFactReferences` refinement validates (nodes, decisions, edges,
 *     roles, systems, informationObjects, controls, unknowns), sorted and
 *     de-duplicated (an id can legitimately appear from more than one
 *     source, e.g. a node AND an unknown targeting that same node both
 *     citing the same fact). An `unknowns[]` entry contributes its
 *     `targetId` (its only id-like field, per point 5) as the referencing id.
 *  7. **`confidenceRollup`** — tallies `confidence` across `identity` plus
 *     every entity in the 8 top-level arrays that carries a `confidence`
 *     field (`unknowns` excluded — `CanonicalUnknown` has none; it records
 *     uncertainty about something else, it does not itself carry a
 *     confidence rating).
 *  8. **`approvals`** — one entry per `decisions[]` entry that carries an
 *     EXPLICIT `approval` block (`CanonicalApproval`), and NO entry for any
 *     decision without one. Authority is asserted by the contract, never
 *     inferred here: there is deliberately no fallback to a role that merely
 *     touches the deciding node, and none to the process-wide owner — a
 *     modelling relationship (owner-of, works-on) is not a business assertion
 *     about who approves a decision. Each entry resolves the block's
 *     `authorityRoleIds` to `{roleId, names, unit?}` authorities and its
 *     `thresholdControlIds` to `{controlId, names}` thresholds (both sorted by
 *     their own id), and carries the block's `status` and (sorted) `factIds`.
 *     A decision with no `approval` block — e.g. `VALID_CANONICAL_RETURN_PATH`
 *     — produces nothing, so an unverified authority is never fabricated.
 *  9. **`roles[].owner`** — coerced to a definite `boolean` (`role.owner ===
 *     true`) rather than passed through as `boolean | undefined`, so a
 *     consumer never has to special-case "field absent" vs "false".
 *  10. **`narrativeSummary`** — plan T3 (line 411): "the first paragraph of
 *      the narrative." `identity.purpose` verbatim when present, else a
 *      name-derived fallback sentence (`deriveNarrativeSummary`, below) — the
 *      exact SAME function `./narrative.ts` calls for its own opening
 *      "Purpose" paragraph, so the two artifacts never drift apart. Always
 *      present (never optional): the fallback branch only fires when
 *      `identity.purpose` is absent, and it derives from `identity.names`,
 *      which the contract already guarantees carries at least one locale.
 *
 * ## Ordering (binding: "every array explicitly sorted by id")
 *
 * Every array is sorted by its natural id field EXCEPT `mainFlow`, whose
 * entire purpose is to carry the flow ORDER (`canonicalFlowOrder`'s
 * depth-first spine) — sorting it by id would destroy the one thing it
 * exists to convey. This is the single, deliberate exception; every other
 * array (`trigger`, `outcomes`, `roles`, `systems`, `informationObjects`,
 * `decisions` and each decision's own `outcomes[]`, `unknowns`,
 * `evidenceSummary`, `approvals`) is explicitly sorted here, never left in
 * source-declaration order, so the package is stable under any equivalent
 * reordering of the source `CanonicalProcessV1`'s arrays.
 */

import type {
  CanonicalApprovalStatus,
  CanonicalConfidence,
  CanonicalEdgeKind,
  CanonicalNodeKind,
  CanonicalProcessV1,
  CanonicalText,
  CanonicalUnknownKind
} from './contract'
import { canonicalFlowOrder } from './projectToEpc'

export const VERIFICATION_PACKAGE_SCHEMA_VERSION = 1 as const

// ---------------------------------------------------------------------------
// Entry shapes
// ---------------------------------------------------------------------------

export interface VerificationPackageEntry {
  readonly id: string
  readonly names: CanonicalText
}

export interface VerificationPackageOwner {
  readonly id: string
  readonly names: CanonicalText
  readonly unit?: CanonicalText
}

export interface VerificationPackageMainFlowEntry {
  readonly id: string
  readonly kind: CanonicalNodeKind
  readonly names: CanonicalText
}

export interface VerificationPackageRoleEntry {
  readonly id: string
  readonly names: CanonicalText
  readonly unit?: CanonicalText
  readonly owner: boolean
}

export interface VerificationPackageSystemEntry {
  readonly id: string
  readonly names: CanonicalText
}

export interface VerificationPackageInformationObjectEntry {
  readonly id: string
  readonly names: CanonicalText
}

export interface VerificationPackageDecisionOutcomeEntry {
  readonly id: string
  readonly names: CanonicalText
  readonly targetNodeId: string
}

export interface VerificationPackageDecisionEntry {
  readonly id: string
  /** Sourced from the decision NODE's `names` — see module header, point 4. */
  readonly names: CanonicalText
  readonly criteria?: CanonicalText
  readonly outcomes: readonly VerificationPackageDecisionOutcomeEntry[]
}

export interface VerificationPackageUnknownEntry {
  readonly targetId: string
  readonly kind: CanonicalUnknownKind
  readonly field?: string
  readonly message: CanonicalText
  readonly factIds?: readonly string[]
}

export interface VerificationPackageEvidenceSummaryEntry {
  readonly factId: string
  readonly statement: CanonicalText
  readonly evidenceRefs: readonly string[]
  readonly referencedBy: readonly string[]
}

export interface VerificationPackageConfidenceRollup {
  readonly high: number
  readonly medium: number
  readonly low: number
}

export interface VerificationPackageApprovalAuthority {
  readonly roleId: string
  readonly names: CanonicalText
  readonly unit?: CanonicalText
}

export interface VerificationPackageApprovalThreshold {
  readonly controlId: string
  readonly names: CanonicalText
}

/**
 * An approval assertion — emitted ONLY for a decision that carries an explicit
 * `approval` block (see module header, point 8). There is no inference and no
 * fallback to the process owner: a decision without an `approval` block produces
 * NO entry here at all.
 */
export interface VerificationPackageApproval {
  readonly decisionId: string
  readonly status: CanonicalApprovalStatus
  readonly authorities: readonly VerificationPackageApprovalAuthority[]
  readonly thresholds: readonly VerificationPackageApprovalThreshold[]
  readonly factIds: readonly string[]
}

export interface VerificationPackageV1 {
  readonly schemaVersion: 1
  readonly processId: string
  readonly names: CanonicalText
  readonly code?: string
  readonly processVersion?: string
  readonly purpose?: CanonicalText
  readonly trigger: readonly VerificationPackageEntry[]
  readonly outcomes: readonly VerificationPackageEntry[]
  readonly owner: VerificationPackageOwner | null
  readonly mainFlow: readonly VerificationPackageMainFlowEntry[]
  readonly roles: readonly VerificationPackageRoleEntry[]
  readonly systems: readonly VerificationPackageSystemEntry[]
  readonly informationObjects: readonly VerificationPackageInformationObjectEntry[]
  readonly decisions: readonly VerificationPackageDecisionEntry[]
  readonly unknowns: readonly VerificationPackageUnknownEntry[]
  readonly evidenceSummary: readonly VerificationPackageEvidenceSummaryEntry[]
  readonly confidenceRollup: VerificationPackageConfidenceRollup
  readonly approvals: readonly VerificationPackageApproval[]
  /** The narrative's opening paragraph — see module header, point 10. */
  readonly narrativeSummary: CanonicalText
}

// ---------------------------------------------------------------------------
// Small local helpers
// ---------------------------------------------------------------------------

/**
 * The control-flow edge kinds `canonicalFlowOrder` (`./projectToEpc`) treats
 * as flow, kept in sync with that module's own (non-exported)
 * `CONTROL_FLOW_EDGE_KINDS` constant of the same five values.
 */
const CONTROL_FLOW_EDGE_KINDS: ReadonlySet<CanonicalEdgeKind> = new Set([
  'sequence',
  'conditional',
  'parallel',
  'handoff',
  'exception-route'
])

function byId<T extends { readonly id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function sortedById<T extends { readonly id: string }>(items: readonly T[]): T[] {
  return [...items].sort(byId)
}

function sortedStrings(items: readonly string[]): string[] {
  return [...items].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

interface ControlFlowDegrees {
  /** Node ids targeted by a control-flow edge OR a decision outcome. */
  readonly hasIncoming: ReadonlySet<string>
  /** Node id -> count of control-flow edges sourced from it. */
  readonly outgoingCount: ReadonlyMap<string, number>
}

function controlFlowDegrees(process: CanonicalProcessV1): ControlFlowDegrees {
  const hasIncoming = new Set<string>()
  const outgoingCount = new Map<string, number>()
  for (const edge of process.edges) {
    if (!CONTROL_FLOW_EDGE_KINDS.has(edge.kind)) continue
    hasIncoming.add(edge.targetNodeId)
    outgoingCount.set(edge.sourceNodeId, (outgoingCount.get(edge.sourceNodeId) ?? 0) + 1)
  }
  for (const decision of process.decisions) {
    for (const outcome of decision.outcomes) hasIncoming.add(outcome.targetNodeId)
  }
  return { hasIncoming, outgoingCount }
}

// ---------------------------------------------------------------------------
// Shared trigger/outcome derivation (exported for ./narrative.ts)
// ---------------------------------------------------------------------------

/** See module header, point 1. Exported so `./narrative.ts` stays consistent. */
export function deriveTriggerEntries(
  process: CanonicalProcessV1
): readonly VerificationPackageEntry[] {
  const { hasIncoming } = controlFlowDegrees(process)
  return sortedById(
    process.nodes
      .filter((node) => node.kind === 'event' && !hasIncoming.has(node.id))
      .map((node) => ({ id: node.id, names: node.names }))
  )
}

/** See module header, point 2. Exported so `./narrative.ts` stays consistent. */
export function deriveOutcomeEntries(
  process: CanonicalProcessV1
): readonly VerificationPackageEntry[] {
  const { outgoingCount } = controlFlowDegrees(process)
  return sortedById(
    process.nodes
      .filter((node) => node.kind === 'event' && (outgoingCount.get(node.id) ?? 0) === 0)
      .map((node) => ({ id: node.id, names: node.names }))
  )
}

/**
 * The narrative's opening paragraph / `narrativeSummary` — see module
 * header, point 10. `identity.purpose` verbatim when present; else a
 * name-derived fallback that always carries at least one locale (since
 * `identity.names`, its only source, is contract-guaranteed non-empty).
 * Exported so `./narrative.ts` renders the IDENTICAL text as its own first
 * paragraph, rather than an independently-derived paraphrase.
 */
export function deriveNarrativeSummary(process: CanonicalProcessV1): CanonicalText {
  const { purpose, names } = process.identity
  if (purpose !== undefined) return purpose
  const en =
    names.en !== undefined
      ? `This narrative describes the process "${names.en}"; no purpose statement is documented.`
      : undefined
  const ar =
    names.ar !== undefined
      ? `يصف هذا السرد العملية "${names.ar}"؛ لا يوجد بيان غرض موثّق لها.`
      : undefined
  return { ...(en !== undefined ? { en } : {}), ...(ar !== undefined ? { ar } : {}) }
}

// ---------------------------------------------------------------------------
// buildVerificationPackage
// ---------------------------------------------------------------------------

export function buildVerificationPackage(process: CanonicalProcessV1): VerificationPackageV1 {
  const nodeById = new Map(process.nodes.map((node) => [node.id, node] as const))

  // --- owner -----------------------------------------------------------------
  const ownerCandidates = sortedById(process.roles.filter((role) => role.owner === true))
  const ownerRole = ownerCandidates[0]
  const owner: VerificationPackageOwner | null = ownerRole
    ? {
        id: ownerRole.id,
        names: ownerRole.names,
        ...(ownerRole.unit !== undefined ? { unit: ownerRole.unit } : {})
      }
    : null

  // --- mainFlow: the projection's own DFS spine, imported verbatim -----------
  const mainFlow: VerificationPackageMainFlowEntry[] = canonicalFlowOrder(process).map((id) => {
    const node = nodeById.get(id)
    // Invariant: canonicalFlowOrder only ever emits ids from process.nodes.
    // Unreachable for any CanonicalProcessV1 that actually passed
    // parseCanonicalProcess (dangling references are rejected there); guarded
    // defensively rather than silently propagating `undefined`.
    if (!node) throw new Error(`canonicalFlowOrder produced an undeclared node id "${id}".`)
    return { id: node.id, kind: node.kind, names: node.names }
  })

  // --- roles / systems / informationObjects -----------------------------------
  const roles: VerificationPackageRoleEntry[] = sortedById(
    process.roles.map((role) => ({
      id: role.id,
      names: role.names,
      ...(role.unit !== undefined ? { unit: role.unit } : {}),
      owner: role.owner === true
    }))
  )
  const systems: VerificationPackageSystemEntry[] = sortedById(
    process.systems.map((system) => ({ id: system.id, names: system.names }))
  )
  const informationObjects: VerificationPackageInformationObjectEntry[] = sortedById(
    process.informationObjects.map((info) => ({ id: info.id, names: info.names }))
  )

  // --- decisions ---------------------------------------------------------------
  const decisions: VerificationPackageDecisionEntry[] = sortedById(
    process.decisions.map((decision) => {
      const decisionNode = nodeById.get(decision.nodeId)
      // Defensive fallback only — unreachable for a validated process (see
      // module header, point 4; contract.ts's decision-node-* refinements
      // guarantee decision.nodeId resolves to a declared 'decision' node).
      const names = decisionNode ? decisionNode.names : { en: decision.id }
      return {
        id: decision.id,
        names,
        ...(decision.criteria !== undefined ? { criteria: decision.criteria } : {}),
        outcomes: sortedById(
          decision.outcomes.map((outcome) => ({
            id: outcome.id,
            names: outcome.names,
            targetNodeId: outcome.targetNodeId
          }))
        )
      }
    })
  )

  // --- unknowns (see module header, point 5 for the sort key) ----------------
  const unknowns: VerificationPackageUnknownEntry[] = [...process.unknowns]
    .sort((a, b) => {
      if (a.targetId !== b.targetId) return a.targetId < b.targetId ? -1 : 1
      if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1
      const fieldA = a.field ?? ''
      const fieldB = b.field ?? ''
      return fieldA < fieldB ? -1 : fieldA > fieldB ? 1 : 0
    })
    .map((unknown) => ({
      targetId: unknown.targetId,
      kind: unknown.kind,
      ...(unknown.field !== undefined ? { field: unknown.field } : {}),
      message: unknown.message,
      ...(unknown.factIds !== undefined ? { factIds: sortedStrings(unknown.factIds) } : {})
    }))

  // --- evidenceSummary (reverse-referenced factIds, see point 6) -------------
  const referencedByFactId = new Map<string, Set<string>>()
  const addReference = (factIds: readonly string[] | undefined, referencerId: string): void => {
    if (!factIds) return
    for (const factId of factIds) {
      const bucket = referencedByFactId.get(factId) ?? new Set<string>()
      bucket.add(referencerId)
      referencedByFactId.set(factId, bucket)
    }
  }
  for (const node of process.nodes) addReference(node.factIds, node.id)
  for (const decision of process.decisions) addReference(decision.factIds, decision.id)
  for (const decision of process.decisions) addReference(decision.approval?.factIds, decision.id)
  for (const edge of process.edges) addReference(edge.factIds, edge.id)
  for (const role of process.roles) addReference(role.factIds, role.id)
  for (const system of process.systems) addReference(system.factIds, system.id)
  for (const info of process.informationObjects) addReference(info.factIds, info.id)
  for (const control of process.controls) addReference(control.factIds, control.id)
  for (const unknown of process.unknowns) addReference(unknown.factIds, unknown.targetId)

  const evidenceSummary: VerificationPackageEvidenceSummaryEntry[] = [...process.facts]
    .sort(byId)
    .map((fact) => ({
      factId: fact.id,
      statement: fact.statement,
      evidenceRefs: sortedStrings(fact.evidenceRefs),
      referencedBy: sortedStrings([...(referencedByFactId.get(fact.id) ?? [])])
    }))

  // --- confidenceRollup (see point 7) -----------------------------------------
  const confidenceRollup: VerificationPackageConfidenceRollup = (() => {
    let high = 0
    let medium = 0
    let low = 0
    const bump = (confidence: CanonicalConfidence): void => {
      if (confidence === 'high') high += 1
      else if (confidence === 'medium') medium += 1
      else low += 1
    }
    bump(process.identity.confidence)
    for (const node of process.nodes) bump(node.confidence)
    for (const decision of process.decisions) bump(decision.confidence)
    for (const edge of process.edges) bump(edge.confidence)
    for (const role of process.roles) bump(role.confidence)
    for (const system of process.systems) bump(system.confidence)
    for (const info of process.informationObjects) bump(info.confidence)
    for (const control of process.controls) bump(control.confidence)
    for (const fact of process.facts) bump(fact.confidence)
    return { high, medium, low }
  })()

  // --- approvals: EXPLICIT authority only (see point 8) -----------------------
  // An approval assertion is emitted for exactly the decisions that carry an
  // explicit `approval` block. There is deliberately NO inference and NO fallback
  // to the process owner or to a role that merely touches the deciding node — a
  // modelling relationship is not a business assertion about who signs off.
  const roleById = new Map(process.roles.map((role) => [role.id, role] as const))
  const controlById = new Map(process.controls.map((control) => [control.id, control] as const))
  const approvals: VerificationPackageApproval[] = []
  for (const decision of sortedById(process.decisions)) {
    const approval = decision.approval
    if (approval === undefined) continue
    const authorities: VerificationPackageApprovalAuthority[] = sortedStrings([
      ...approval.authorityRoleIds
    ]).map((roleId) => {
      const role = roleById.get(roleId)
      // roleId is contract-guaranteed to resolve (checkApprovalReferences); the
      // fallback keeps the builder total for any not-yet-validated input.
      return role
        ? { roleId, names: role.names, ...(role.unit !== undefined ? { unit: role.unit } : {}) }
        : { roleId, names: { en: roleId } }
    })
    const thresholds: VerificationPackageApprovalThreshold[] = sortedStrings([
      ...(approval.thresholdControlIds ?? [])
    ]).map((controlId) => {
      const control = controlById.get(controlId)
      return control ? { controlId, names: control.names } : { controlId, names: { en: controlId } }
    })
    // Iteration over sortedById(process.decisions) already yields decisionId order.
    approvals.push({
      decisionId: decision.id,
      status: approval.status,
      authorities,
      thresholds,
      factIds: sortedStrings([...(approval.factIds ?? [])])
    })
  }

  return {
    schemaVersion: VERIFICATION_PACKAGE_SCHEMA_VERSION,
    processId: process.identity.id,
    names: process.identity.names,
    ...(process.identity.code !== undefined ? { code: process.identity.code } : {}),
    ...(process.identity.processVersion !== undefined
      ? { processVersion: process.identity.processVersion }
      : {}),
    ...(process.identity.purpose !== undefined ? { purpose: process.identity.purpose } : {}),
    trigger: deriveTriggerEntries(process),
    outcomes: deriveOutcomeEntries(process),
    owner,
    mainFlow,
    roles,
    systems,
    informationObjects,
    decisions,
    unknowns,
    evidenceSummary,
    confidenceRollup,
    approvals,
    narrativeSummary: deriveNarrativeSummary(process)
  }
}

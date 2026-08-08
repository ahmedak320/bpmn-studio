/**
 * Process-wide DEFAULT detection for the top-right "default owner" legend
 * (rendering campaign 2026-08-08).
 *
 * A large process repeats the same assignment on many steps — the same process
 * owner "Survey Team", the same system, the same information carrier. Drawing
 * that satellite N times clutters the diagram. `computeDefaults` finds, per
 * kind, the ONE value that dominates so the render can declare it ONCE in a
 * top-right legend and collapse the redundant per-step satellites
 * (`computeSuppressedSatelliteDraftIds`).
 *
 * This module is PURE and notation-neutral: it reads a `CanonicalProcessV1` and
 * returns plain data. It never touches the projection, the AML, or the SVG —
 * the AML stays lossless (every step's real assignment still lives in its
 * ObjectDefinition + Connection); only the RENDER collapses the duplicates.
 *
 * ## Kinds
 *
 * Four satellite kinds are covered, matching the four canonical satellite
 * entity types: process-owner ROLE, default SYSTEM, default INFORMATION
 * carrier, default CONTROL. "Default org unit" is NOT a distinct kind: an org
 * unit lives only as `role.unit` (a `CanonicalText` variant with no id), so
 * there is no entity to declare a default on and no id to suppress by — it is
 * deliberately omitted rather than inventing a new type.
 *
 * ## Detection — declared, with a 60% auto-fallback
 *
 * For each kind, a DECLARED default wins first:
 *  - owner: a role with `owner === true`. Exactly one → that role. Two or more
 *    → NO default (user error; never guess between them).
 *  - system/information/control: an entity with `default === true`. Exactly one
 *    → that entity. Two or more → NO default.
 *
 * With nothing declared, auto-fallback picks the MAJORITY: over the kind's
 * OWNER SET (the distinct owner-node ids referenced by ANY satellite of that
 * kind), the satellite referenced by the most owner-nodes wins IFF its count is
 * at least 60% of the owner set AND no other satellite ties that count. Below
 * 60%, or on a tie for the top, there is NO default for that kind — no legend
 * line, no suppression.
 */

import type {
  CanonicalControl,
  CanonicalInformationObject,
  CanonicalProcessV1,
  CanonicalRole,
  CanonicalSystem,
  CanonicalText
} from './contract'

/** The four satellite kinds a default can be detected for. */
export type DefaultKind = 'owner' | 'system' | 'informationObject' | 'control'

/** A detected default: the canonical id that dominates and its bilingual name. */
export interface DefaultEntry {
  readonly id: string
  readonly names: CanonicalText
}

/**
 * The detected default per kind, each optional (absent = no default for that
 * kind). `owner` is the process-owner ROLE; `orgUnit` is intentionally NOT a
 * member (see module header).
 */
export interface DefaultsByKind {
  readonly owner?: DefaultEntry
  readonly system?: DefaultEntry
  readonly informationObject?: DefaultEntry
  readonly control?: DefaultEntry
}

/** The 60% majority threshold (see module header). */
export const DEFAULT_MAJORITY_RATIO = 0.6

/** Draft-object logicalId prefix per kind (mirrors `projectToEpc.ts`). */
const DRAFT_PREFIX: Readonly<Record<DefaultKind, string>> = Object.freeze({
  owner: 'r',
  system: 's',
  informationObject: 'io',
  control: 'c'
})

/** One candidate satellite reduced to the fields detection needs. */
interface Candidate {
  readonly id: string
  readonly names: CanonicalText
  /** Distinct owner-node ids this satellite is placed on. */
  readonly ownerNodes: readonly string[]
  /** `true` when the process explicitly declares this the default of its kind. */
  readonly declared: boolean
}

function distinct(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function roleCandidates(roles: readonly CanonicalRole[]): Candidate[] {
  return roles.map((role) => ({
    id: role.id,
    names: role.names,
    ownerNodes: distinct(role.nodeIds),
    declared: role.owner === true
  }))
}

function systemCandidates(systems: readonly CanonicalSystem[]): Candidate[] {
  return systems.map((system) => ({
    id: system.id,
    names: system.names,
    ownerNodes: distinct(system.nodeIds),
    declared: system.default === true
  }))
}

function informationObjectCandidates(infos: readonly CanonicalInformationObject[]): Candidate[] {
  return infos.map((info) => ({
    id: info.id,
    names: info.names,
    // The projection emits ONE deduped duplicate per (info, owner-node) across
    // both input and output edges, so the owner set unions both here too.
    ownerNodes: distinct([...info.inputToNodeIds, ...info.outputOfNodeIds]),
    declared: info.default === true
  }))
}

function controlCandidates(controls: readonly CanonicalControl[]): Candidate[] {
  return controls.map((control) => ({
    id: control.id,
    names: control.names,
    ownerNodes: distinct(control.nodeIds),
    declared: control.default === true
  }))
}

function candidatesFor(process: CanonicalProcessV1, kind: DefaultKind): Candidate[] {
  switch (kind) {
    case 'owner':
      return roleCandidates(process.roles)
    case 'system':
      return systemCandidates(process.systems)
    case 'informationObject':
      return informationObjectCandidates(process.informationObjects)
    case 'control':
      return controlCandidates(process.controls)
  }
}

/**
 * Pick the default from a kind's candidates: a single declared default wins; two
 * or more declared → undefined; otherwise the ≥60% unique-majority rule.
 */
function pickDefault(candidates: readonly Candidate[]): DefaultEntry | undefined {
  const declared = candidates.filter((candidate) => candidate.declared)
  if (declared.length === 1) {
    const winner = declared[0] as Candidate
    return { id: winner.id, names: winner.names }
  }
  if (declared.length > 1) return undefined

  // Auto-fallback: majority over the owner set.
  const ownerSet = new Set<string>()
  for (const candidate of candidates) {
    for (const nodeId of candidate.ownerNodes) ownerSet.add(nodeId)
  }
  if (ownerSet.size === 0) return undefined

  const threshold = DEFAULT_MAJORITY_RATIO * ownerSet.size
  let best: Candidate | undefined
  let bestCount = 0
  let tie = false
  for (const candidate of candidates) {
    const count = candidate.ownerNodes.length
    if (count > bestCount) {
      bestCount = count
      best = candidate
      tie = false
    } else if (count === bestCount && count > 0) {
      tie = true
    }
  }
  if (best === undefined || tie) return undefined
  if (bestCount < threshold) return undefined
  return { id: best.id, names: best.names }
}

/**
 * Detect the process-wide default per kind (see module header). Pure and
 * deterministic — candidate order follows declaration order, ties yield no
 * default.
 */
export function computeDefaults(process: CanonicalProcessV1): DefaultsByKind {
  const out: {
    owner?: DefaultEntry
    system?: DefaultEntry
    informationObject?: DefaultEntry
    control?: DefaultEntry
  } = {}
  const owner = pickDefault(candidatesFor(process, 'owner'))
  if (owner) out.owner = owner
  const system = pickDefault(candidatesFor(process, 'system'))
  if (system) out.system = system
  const informationObject = pickDefault(candidatesFor(process, 'informationObject'))
  if (informationObject) out.informationObject = informationObject
  const control = pickDefault(candidatesFor(process, 'control'))
  if (control) out.control = control
  return out
}

/**
 * The draft-object logicalIds (`r:<id>@<node>`, `s:…`, `io:…`, `c:…`) of the
 * per-step satellites the render should SUPPRESS: for each kind with a default
 * `D`, every owner-node `N` on which `D` is the ONLY satellite of that kind
 * (i.e. `N` carries no OTHER satellite of the same kind — no override). When a
 * node also carries an overriding satellite of that kind, BOTH are kept (the
 * override must stay visible, and the default beside it gives context).
 *
 * The returned ids are draft-object ids; the render maps them to canvas
 * occurrence ids as `ObjOcc.<logicalId>`. This never removes anything from the
 * AML — it only tells the render which occurrences to drop from the SVG.
 */
export function computeSuppressedSatelliteDraftIds(
  process: CanonicalProcessV1,
  defaults: DefaultsByKind
): ReadonlySet<string> {
  const suppressed = new Set<string>()
  const kinds: readonly DefaultKind[] = ['owner', 'system', 'informationObject', 'control']
  for (const kind of kinds) {
    const entry = defaults[kind]
    if (!entry) continue
    const candidates = candidatesFor(process, kind)
    // How many satellites of this kind sit on each owner-node.
    const perNodeCount = new Map<string, number>()
    for (const candidate of candidates) {
      for (const nodeId of candidate.ownerNodes) {
        perNodeCount.set(nodeId, (perNodeCount.get(nodeId) ?? 0) + 1)
      }
    }
    const target = candidates.find((candidate) => candidate.id === entry.id)
    if (!target) continue
    const prefix = DRAFT_PREFIX[kind]
    for (const nodeId of target.ownerNodes) {
      // Suppress only when the default is the SOLE satellite of its kind here.
      if ((perNodeCount.get(nodeId) ?? 0) === 1) {
        suppressed.add(`${prefix}:${entry.id}@${nodeId}`)
      }
    }
  }
  return suppressed
}

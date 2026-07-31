/**
 * Tuple-safe RACI derivation for connection label placements (plan Wave 6, V5+).
 *
 * An imported `<CxnOcc>` carries an `AT_TYPE_6` `<AttrOcc>` placement for the
 * connection's relationship badge, but the AnimalWF export stores no value for
 * it — the placements render as empty groups. The letter itself is derivable:
 * the DMT convention assigns exactly one RACI letter per connection type
 * (`RACI_BY_CONNECTION_TYPE`), and the PDF paints that letter at the placement.
 *
 * The derivation is deliberately *tuple-scoped* (plan §"Connections, canonical
 * labels, and RACI"): a letter is produced only when
 *
 *  1. the placement is the relationship-badge attribute (`AT_TYPE_6`) in TEXT
 *     mode with no source-authored value — an authored literal always wins and
 *     is never duplicated or overridden;
 *  2. the connection type carries a RACI letter at all;
 *  3. the source endpoint is an eligible executor (organizational unit,
 *     position, group/committee, role, or a person) — the same set the
 *     connection rules grant executor→Function RACI rules to; and
 *  4. the target endpoint is a Function.
 *
 * `CT_MUST_BE_INFO_ABT_1` from a *policy* is a regulation relationship, not an
 * "informed" badge, which is why rule 3 reads the endpoint types rather than
 * the connection type alone.
 */

import { RACI_BY_CONNECTION_TYPE, type RaciLetter } from '../conventions/connectionRules'

/** The `<AttrOcc>` attribute type that carries a connection's relationship badge. */
export const ARIS_RACI_ATTRIBUTE_TYPE = 'AT_TYPE_6'

/** Executor object types eligible for an R/A/C/I badge (plan: eligible executors). */
export const ARIS_RACI_EXECUTOR_OBJECT_TYPES: ReadonlySet<string> = new Set([
  'OT_ORG_UNIT',
  'OT_POS',
  'OT_GRP',
  'OT_PERS_TYPE',
  'OT_PERS'
])

/** A Function is the only RACI badge target. */
export const ARIS_RACI_TARGET_OBJECT_TYPE = 'OT_FUNC'

/** The endpoint triple a RACI decision is scoped to. */
export interface ArisRaciTuple {
  readonly connectionType: string
  readonly sourceObjectType: string
  readonly targetObjectType: string
}

/**
 * The RACI letter for one endpoint tuple, or `null` when the tuple is not an
 * eligible executor→Function assignment. Pure: no canvas, no document.
 */
export function resolveRaciLetter(tuple: ArisRaciTuple): RaciLetter | null {
  const letter = RACI_BY_CONNECTION_TYPE[tuple.connectionType]
  if (!letter) return null
  if (tuple.targetObjectType !== ARIS_RACI_TARGET_OBJECT_TYPE) return null
  if (!ARIS_RACI_EXECUTOR_OBJECT_TYPES.has(tuple.sourceObjectType)) return null
  return letter
}

/**
 * The letter a connection label placement should display, or `null` when the
 * placement must draw exactly what the source authored (which for a non-RACI
 * placement, a SYMBOL placement, or a placement with a stored value is whatever
 * the generic label path renders — this helper never invents content there).
 */
export function derivedRaciLabelText(
  placement: {
    readonly attributeType: string
    readonly symbolFlag: string
    readonly text: string
  },
  tuple: ArisRaciTuple | null
): RaciLetter | null {
  if (placement.attributeType !== ARIS_RACI_ATTRIBUTE_TYPE) return null
  if (placement.symbolFlag !== 'TEXT') return null
  if (placement.text.trim() !== '') return null
  if (tuple === null) return null
  return resolveRaciLetter(tuple)
}

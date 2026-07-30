/**
 * EPC validation for the mounted shell (plan §14.1).
 *
 * `src/aris/epc` is deliberately ignorant of `src/aris/model`: it declares the
 * structural shape it needs and adapts once, in its own `adapter.ts`. This module
 * is the other half of that seam — it walks the live working document, hands each
 * EPC model to `toEpcGraph` + `validateEpcGraph`, and tags every finding with the
 * model it came from so the rail can reveal the offending element.
 *
 * Only `MT_EEPC` models are validated. The EPC rule table (event/function
 * alternation, split/merge, start/end completeness) describes event-driven process
 * chains; applying it to a value-added chain diagram would manufacture findings
 * that are not defects.
 */

import type { ArisWorkingDocument } from '../model/types'
import { toEpcGraph, validateEpcGraph, type EpcFinding } from '../epc'

/** An EPC finding plus the model whose graph produced it. */
export interface ArisEpcModelFinding extends EpcFinding {
  readonly modelId: string
}

/** The EPC model type the §14.1 rule table applies to. */
const EPC_MODEL_TYPE = 'MT_EEPC'

/**
 * Validate every EPC model in `document`.
 *
 * @param document the live working document (imported or edited — both work).
 * @param modelIds restrict validation to these models; omit to validate all.
 * @param externallyKnownModelIds model ids that live in OTHER workspace files but
 *   are legitimate assignment targets. They union into the set an assignment is
 *   validated against, so a cross-file `LinkedModels.IdRef` is not flagged
 *   `epc.linkedModel.danglingReference` merely because it is not in THIS document.
 */
export function buildArisEpcFindings(
  document: ArisWorkingDocument,
  modelIds?: ReadonlySet<string>,
  externallyKnownModelIds?: ReadonlySet<string>
): readonly ArisEpcModelFinding[] {
  const knownModelIds = new Set(document.models.keys())
  if (externallyKnownModelIds) {
    for (const modelId of externallyKnownModelIds) knownModelIds.add(modelId)
  }
  const findings: ArisEpcModelFinding[] = []

  for (const [modelId, model] of document.models) {
    if (model.type !== EPC_MODEL_TYPE) continue
    if (modelIds && !modelIds.has(modelId)) continue

    const graph = toEpcGraph({
      modelId,
      objectOccurrences: model.occurrences.map((occurrence) => ({
        id: occurrence.id,
        definitionId: occurrence.definitionId,
        symbol: occurrence.symbol
      })),
      objectDefinitionById: document.objectDefinitions,
      connectionOccurrences: model.connectionOccurrences.map((connection) => ({
        id: connection.id,
        definitionId: connection.definitionId,
        sourceOccurrenceId: connection.sourceOccurrenceId,
        targetOccurrenceId: connection.targetOccurrenceId
      })),
      connectionDefinitionById: document.connectionDefinitions
    })

    for (const finding of validateEpcGraph(graph, { knownModelIds })) {
      findings.push({ ...finding, modelId })
    }
  }

  return Object.freeze(findings)
}

/** Count findings by severity, for the rail heading. */
export function countArisEpcFindings(findings: readonly ArisEpcModelFinding[]): {
  readonly errors: number
  readonly warnings: number
} {
  let errors = 0
  let warnings = 0
  for (const finding of findings) {
    if (finding.severity === 'error') errors += 1
    else warnings += 1
  }
  return { errors, warnings }
}

/** The element a finding should reveal: its first node, else its first edge. */
export function arisEpcFindingTargetId(finding: ArisEpcModelFinding): string | null {
  return finding.nodeIds[0] ?? finding.edgeIds[0] ?? null
}

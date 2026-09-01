import type { ArisWorkingDocument } from '../model/types'

/**
 * Return a working document with the given occurrence ids (and every connection
 * incident to them) removed from every model — the RENDER-only satellite
 * suppression. The source `aml.xml` string is a separate artifact and is never
 * touched, so `debugAml` stays lossless (all ObjectDefinitions + Occurrences +
 * Connections remain in the AML); only the canvas/SVG loses the duplicates.
 * `objectDefinitions` are also left intact — only per-model occurrences drop.
 */
export function pruneSuppressedOccurrences(
  document: ArisWorkingDocument,
  suppressedOccurrenceIds: ReadonlySet<string>
): ArisWorkingDocument {
  if (suppressedOccurrenceIds.size === 0) return document
  const models = new Map(document.models)
  for (const [id, model] of document.models) {
    const removed = new Set(
      model.occurrences
        .filter((occurrence) => suppressedOccurrenceIds.has(occurrence.id))
        .map((occurrence) => occurrence.id)
    )
    if (removed.size === 0) continue
    models.set(id, {
      ...model,
      occurrences: model.occurrences.filter((occurrence) => !removed.has(occurrence.id)),
      connectionOccurrences: model.connectionOccurrences.filter(
        (connection) =>
          !removed.has(connection.sourceOccurrenceId) && !removed.has(connection.targetOccurrenceId)
      )
    })
  }
  return { ...document, models }
}

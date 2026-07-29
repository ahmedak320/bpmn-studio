/**
 * Derived AML export (plan §9), composed for the mounted shell.
 *
 * The imported original is never touched. What the user edited on the canvas is
 * the *working document*; what ARIS reads is *bytes*. This module is the bridge:
 * it diffs the live working document against the pinned imported document and
 * expresses each difference as a byte-addressed {@link AmlEdit} built by the
 * writer's own edit builders, so every byte nobody changed is copied verbatim.
 *
 * Only geometry is diffed today, and deliberately so: `src/aris/canvas` publishes
 * a whole `ArisWorkingDocument` per revision rather than a per-command byte
 * intent, and occurrence geometry is the one part of that document whose mapping
 * back to source spans is unambiguous (`<Position>` / `<Size>` children of a
 * record addressed by its own id). That covers the gestures the shell actually
 * offers — Clean Layout, Reset to Source Layout, drag and resize — and is exactly
 * the "Move/resize occurrence. Reroute connection." row of plan §9.4. Anything
 * this module cannot express is REPORTED (`unmapped`), never silently dropped:
 * an export that quietly lost an edit would be worse than one that refuses.
 *
 * Nothing here decides whether a download may proceed. {@link exportArisDerivedAml}
 * delegates that to the writer's `exportDerivedAml`, which runs all nine §9.3
 * validations and throws rather than return unvalidated bytes.
 */

import type { ArisWorkingDocument } from '../model/types'
import {
  exportDerivedAml,
  moveOccurrenceEdits,
  prepareDerivedAml,
  readWriterSourceView,
  rerouteConnectionEdits,
  resizeOccurrenceEdits,
  type AmlEdit,
  type DerivedAmlExport,
  type WriterSourceView
} from '../writer'

/** One difference the writer could not address against the original bytes. */
export interface ArisUnmappedEdit {
  readonly sourceId: string
  readonly reason: string
}

export interface ArisDerivedEditSet {
  readonly edits: readonly AmlEdit[]
  readonly unmapped: readonly ArisUnmappedEdit[]
}

function collect(
  target: AmlEdit[],
  unmapped: ArisUnmappedEdit[],
  sourceId: string,
  build: () => readonly AmlEdit[]
): void {
  try {
    target.push(...build())
  } catch (error) {
    unmapped.push({
      sourceId,
      reason: error instanceof Error ? error.message : String(error)
    })
  }
}

function routesDiffer(
  left: readonly { readonly x: number; readonly y: number }[],
  right: readonly { readonly x: number; readonly y: number }[]
): boolean {
  if (left.length !== right.length) return true
  return left.some((point, index) => point.x !== right[index]!.x || point.y !== right[index]!.y)
}

/**
 * Diff `live` against `original` and express every geometry difference as edits
 * addressed at the original bytes.
 */
export function buildArisGeometryEdits(
  view: WriterSourceView,
  original: ArisWorkingDocument,
  live: ArisWorkingDocument
): ArisDerivedEditSet {
  const edits: AmlEdit[] = []
  const unmapped: ArisUnmappedEdit[] = []

  for (const [modelId, liveModel] of live.models) {
    const originalModel = original.models.get(modelId)
    if (!originalModel) continue

    const originalOccurrences = new Map(
      originalModel.occurrences.map((occurrence) => [occurrence.id, occurrence])
    )
    for (const occurrence of liveModel.occurrences) {
      const before = originalOccurrences.get(occurrence.id)
      if (!before) continue
      const bounds = occurrence.bounds
      if (bounds.x !== before.bounds.x || bounds.y !== before.bounds.y) {
        collect(edits, unmapped, occurrence.id, () =>
          moveOccurrenceEdits(view, occurrence.id, {
            x: Math.round(bounds.x),
            y: Math.round(bounds.y)
          })
        )
      }
      if (bounds.width !== before.bounds.width || bounds.height !== before.bounds.height) {
        collect(edits, unmapped, occurrence.id, () =>
          resizeOccurrenceEdits(view, occurrence.id, {
            dx: Math.round(bounds.width),
            dy: Math.round(bounds.height)
          })
        )
      }
    }

    const originalConnections = new Map(
      originalModel.connectionOccurrences.map((connection) => [connection.id, connection])
    )
    for (const connection of liveModel.connectionOccurrences) {
      const before = originalConnections.get(connection.id)
      if (!before) continue
      if (connection.route.length === 0) continue
      if (!routesDiffer(connection.route, before.route)) continue
      collect(edits, unmapped, connection.id, () =>
        rerouteConnectionEdits(
          view,
          connection.id,
          connection.route.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }))
        )
      )
    }
  }

  return Object.freeze({ edits: Object.freeze(edits), unmapped: Object.freeze(unmapped) })
}

export interface ArisDerivedExportPreview {
  readonly result: DerivedAmlExport
  readonly editCount: number
  readonly unmapped: readonly ArisUnmappedEdit[]
}

export interface ArisDerivedExportInput {
  /** The exact decoded text of the imported original. Read, never written. */
  readonly originalText: string
  /** The pinned imported working document. */
  readonly original: ArisWorkingDocument
  /** The document the canvas currently holds. */
  readonly live: ArisWorkingDocument
}

/**
 * Build the derived document and run every §9.3 validation WITHOUT throwing, so a
 * blocked export can be explained instead of silently failing.
 */
export function prepareArisDerivedExport(input: ArisDerivedExportInput): ArisDerivedExportPreview {
  const view = readWriterSourceView(input.originalText)
  const { edits, unmapped } = buildArisGeometryEdits(view, input.original, input.live)
  return Object.freeze({
    result: prepareDerivedAml({ originalText: input.originalText, edits }),
    editCount: edits.length,
    unmapped
  })
}

/**
 * The download path. Throws `ArisWriterError` when any §9.3 check failed, so bytes
 * ARIS would reject can never reach a user's disk labelled as their model.
 */
export function exportArisDerivedAml(input: ArisDerivedExportInput): ArisDerivedExportPreview {
  const view = readWriterSourceView(input.originalText)
  const { edits, unmapped } = buildArisGeometryEdits(view, input.original, input.live)
  return Object.freeze({
    result: exportDerivedAml({ originalText: input.originalText, edits }),
    editCount: edits.length,
    unmapped
  })
}

/** `animalwf.aml` → `animalwf.derived.aml`. */
export function derivedAmlFileName(sourceName: string): string {
  const trimmed = sourceName.trim() === '' ? 'export' : sourceName.trim()
  const dot = trimmed.lastIndexOf('.')
  if (dot <= 0) return `${trimmed}.derived.aml`
  return `${trimmed.slice(0, dot)}.derived${trimmed.slice(dot)}`
}

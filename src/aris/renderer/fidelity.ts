/**
 * Fidelity finding builders that are not owned by the symbol registry — Plan Section 12.3.
 *
 * `missing-font`, `unsupported-pen-effect`, and `unsupported-brush-effect` findings are built
 * where the corresponding value is resolved (`font.ts`, `color.ts`); `unknown-custom-symbol` and
 * `substituted-visual-resource` are built by the symbol registry and re-shaped by
 * `symbolAdapter.ts`; `text-wrap-difference` is built in `textWrap.ts`. This module covers the
 * remaining three finding kinds, which are model/attachment-level rather than tied to a single
 * resolved style value:
 *
 * - `missing-template`: the model declares a `TemplateGUID`, but this lane has no template
 *   store to resolve visual template content (borders, headers, stamp blocks) from — every
 *   templated model is an explicit, reported blocker per Section 20.2, never a silent omission.
 * - `unsupported-ole-rendering`: every `OLEOcc` (embedded OLE object placement) renders as a
 *   placeholder icon only; this renderer never decodes or previews the embedded binary.
 * - `missing-reference-export`: an `OLEDef` (attachment definition) has zero exported `Blob`
 *   children — the binary content that a full reference export would carry is absent from this
 *   package, so nothing at all can be rendered for it (not even a static preview).
 */

import type { ArisRenderFidelityFinding, ArisRenderFidelityKind } from './types'

export function buildMissingTemplateFinding(
  modelId: string,
  templateGuid: string
): ArisRenderFidelityFinding {
  return {
    kind: 'missing-template',
    messageKey: 'aris.fidelity.missingTemplate',
    modelId,
    elementId: null,
    sourceId: modelId,
    params: { templateGuid }
  }
}

export function buildUnsupportedOleRenderingFinding(
  modelId: string | null,
  attachmentOccurrenceId: string | null,
  attachmentId: string | null
): ArisRenderFidelityFinding {
  return {
    kind: 'unsupported-ole-rendering',
    messageKey: 'aris.fidelity.unsupportedOleRendering',
    modelId,
    elementId: attachmentOccurrenceId,
    sourceId: attachmentOccurrenceId,
    params: { attachmentId: attachmentId ?? '' }
  }
}

export function buildMissingReferenceExportFinding(
  modelId: string | null,
  attachmentOccurrenceId: string | null,
  attachmentId: string | null
): ArisRenderFidelityFinding {
  return {
    kind: 'missing-reference-export',
    messageKey: 'aris.fidelity.missingReferenceExport',
    modelId,
    elementId: attachmentOccurrenceId,
    sourceId: attachmentId,
    params: { attachmentId: attachmentId ?? '' }
  }
}

/** Deduplicates findings by their full identity, preserving first-seen order. */
export function mergeFidelityFindings(
  groups: readonly (readonly ArisRenderFidelityFinding[])[]
): readonly ArisRenderFidelityFinding[] {
  const seen = new Set<string>()
  const merged: ArisRenderFidelityFinding[] = []
  for (const group of groups) {
    for (const finding of group) {
      const identity = `${finding.kind}:${finding.modelId ?? ''}:${finding.elementId ?? ''}:${finding.sourceId ?? ''}:${JSON.stringify(finding.params)}`
      if (seen.has(identity)) continue
      seen.add(identity)
      merged.push(finding)
    }
  }
  return Object.freeze(merged)
}

export function countFidelityByKind(
  findings: readonly ArisRenderFidelityFinding[]
): Readonly<Record<ArisRenderFidelityKind, number>> {
  const counts: Record<ArisRenderFidelityKind, number> = {
    'missing-font': 0,
    'missing-template': 0,
    'unknown-custom-symbol': 0,
    'substituted-visual-resource': 0,
    'unsupported-pen-effect': 0,
    'unsupported-brush-effect': 0,
    'unsupported-ole-rendering': 0,
    'text-wrap-difference': 0,
    'missing-reference-export': 0
  }
  for (const finding of findings) {
    counts[finding.kind] += 1
  }
  return Object.freeze(counts)
}

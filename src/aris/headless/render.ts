/**
 * Headless canonical->SVG render entry (implementation plan Lane L-HEADLESS,
 * Wave 20; deliverable 3).
 *
 * `renderCanonicalProcess` runs the recommended headless pipeline VERBATIM: it
 * parses/validates a `CanonicalProcessV1`, projects it to an `ArisAiDraftV1`,
 * runs the structural EPC gate BEFORE any canvas boot, then — only on a clean
 * gate — turns the draft into AML, builds the working document, boots the live
 * diagram-js `ArisCanvas` under a headless jsdom DOM, applies the app's own
 * clean layout, stamps `data-epc-node`/`data-epc-edge` logicalId anchors and
 * versioned metadata, and captures byte-stable standalone SVG markup.
 *
 * Determinism (a first-class requirement — see Global Constraints): no
 * clock or randomness; bounds are pure model-space math
 * (`arisContentBounds`), the AML/layout/anchor steps are deterministic, and
 * `sourceVersionId` is an explicit caller input. The same process + same engine
 * version therefore yields a byte-identical `svg` string across runs (pinned by
 * a committed snapshot hash in `render.test.ts`).
 *
 * Boundary: this entry is NOT reachable from `src/main.tsx` (the studio browser
 * app never imports `src/aris/headless`), so it is not walked by the runtime
 * boundary check. It never imports `browserXmlTokenizer`/`sourcePackage` (the
 * `?worker&inline` Vite trap) — it calls `tokenizeXmlDocument` directly.
 *
 * PNG is consumer-side: rasterize `svg` via `arisSvgToPngDataUrl(markup, size,
 * deps)` (`../canvas/exportArisPdf`) with injected `createCanvas`/`loadImage`.
 * This campaign adds NO rasterizer dependency.
 */

import { ArisCanvas } from '../canvas/ArisCanvas'
import {
  captureArisCanvasSvg,
  findArisCanvasSvg,
  type ArisCanvasSvgBounds
} from '../canvas/exportArisPdf'
import { arisContentBounds } from '../canvas/fitView'
import type { ArisRenderer } from '../canvas/renderer'
import type { Element } from 'diagram-js/lib/model/Types'
import { createCanvasContainer } from '../canvas/testing/jsdomSvg'
import {
  buildProcessNarrative,
  buildVerificationPackage,
  computeDefaults,
  computeSuppressedSatelliteDraftIds,
  parseCanonicalProcess,
  projectCanonicalToDraft,
  validateProjectedDraft,
  PROJECTION_VERSION,
  type CanonicalParseIssue,
  type CanonicalProcessV1,
  type CanonicalProjectionAnchors,
  type EpcProjectionFindings,
  type ProcessNarrativeV1,
  type VerificationPackageV2
} from '../canonical'
import type { ArisAiDraftV1, ArisAiLocalizedText } from '../ai/contract'
import {
  detectReturnPathOutcomes,
  type EpcEdge,
  type EpcGraph,
  type EpcNode,
  type MissingReturnRoute
} from '../epc'
import { ArisDefaultLegend, type DefaultLegendLanguage } from '../canvas/defaultLegend'
import { buildFromSource } from '../model/buildFromSource'
import type { ArisWorkingDocument } from '../model/types'
import { buildAmlFromArisAiDraft } from '../shell/arisAiCreate'
import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import { cleanLayout } from '../layout/cleanLayout'
import { ensureHeadlessDom } from './environment'
import { EPC_ENGINE_VERSION } from './version'

/** The offscreen container the canvas mounts into, in CSS pixels. */
const HEADLESS_CONTAINER_WIDTH = 1600
const HEADLESS_CONTAINER_HEIGHT = 1200

/** Canvas element-id prefixes minted by `buildAmlFromArisAiDraft`. */
const OBJECT_OCCURRENCE_PREFIX = 'ObjOcc.'
const CONNECTION_OCCURRENCE_PREFIX = 'CxnOcc.'

/** Every metadata attribute stamped onto (and then stripped from) the SVG root. */
const ROOT_METADATA_ATTRIBUTES = [
  'data-epc-engine-version',
  'data-epc-schema-version',
  'data-epc-projection-version',
  'data-epc-input-sha256',
  'data-epc-source-version'
] as const

export interface RenderCanonicalProcessOptions {
  /** Which model of the projected draft to render (default 0 — the primary EEPC). */
  readonly modelIndex?: number
  /**
   * The caller's process version id (e.g. `v002`), stamped verbatim as
   * `data-epc-source-version` and mirrored into `metadata`. An explicit input,
   * so it does not break determinism.
   */
  readonly sourceVersionId?: string
  /**
   * Language of the top-right default-legend (EN labels vs AR labels). Defaults
   * to `'en'`. An explicit input, so it does not break determinism. The legend
   * (and the satellite suppression it summarizes) is SVG-only — the AML always
   * carries every per-step assignment regardless of this option.
   */
  readonly language?: DefaultLegendLanguage
  /**
   * Draw the A4 print frame (page border + title block + RACI + DMT symbol
   * legend, `../canvas/printFrame.ts` + `../canvas/legend.ts`) into the captured
   * SVG. Defaults to `false` (unset ⇒ no frame — byte-compatible with the
   * historical SVG/PNG preview capture). SVG-only page furniture; the AML is
   * unaffected. The calling service (`service/src/pipeline/render.ts`) is
   * expected to pass `printFrame: true` ONLY when rendering for PDF output
   * (`formats.includes('pdf')`); SVG/PNG previews leave it unset/false.
   */
  readonly printFrame?: boolean
}

/** Versioned metadata mirrored onto the SVG root and returned to the caller. */
export interface HeadlessRenderMetadata {
  readonly engineVersion: string
  readonly schemaVersion: 1
  readonly projectionVersion: 1
  /** SHA-256 (lowercase hex) of `canonicalJsonBytes(process)`. */
  readonly inputSha256: string
  readonly sourceVersionId?: string
  /** The rendered model's id (an `arisIdForLogicalId('Model', ...)` value). */
  readonly modelId: string
}

/**
 * One advisory return-path gap: an outcome node whose name reads as a
 * return/rework/reject term (`../epc/returnTerms.ts`) that is NOT already on an
 * explicit cycle, so no return route exists. Wraps the detector's own
 * `MissingReturnRoute` (`../epc/returnPath.ts`) with a `source` tag and the
 * draft model it was found in. Advisory ONLY — never fails the render.
 */
export interface ReturnPathFinding {
  readonly source: 'return-path'
  /** The draft model logicalId (e.g. `m:<identity.id>`) the outcome node lives in. */
  readonly modelId: string
  /** The detector's missing-return-route record (outcome id, ranked candidates, recommendation). */
  readonly route: MissingReturnRoute
}

export interface HeadlessRenderSuccess {
  readonly ok: true
  readonly svg: string
  readonly findings: EpcProjectionFindings
  /**
   * Deterministic bilingual (EN+AR) markdown narrative of the process
   * (`buildProcessNarrative`, `../canonical/narrative.ts`). No LLM; a separate
   * result field — never stamped into `svg`. EN-only inputs yield an empty
   * `ar` string.
   */
  readonly narrative: ProcessNarrativeV1
  /**
   * Deterministic per-element QA record (trigger, outcomes, owner, main flow,
   * decisions, unknowns, evidence/confidence rollup, approvals) via
   * `buildVerificationPackage` (`../canonical/verificationPackage.ts`). A
   * separate result field — never stamped into `svg`.
   */
  readonly verification: VerificationPackageV2
  /**
   * Advisory return-path gap findings (`detectReturnPathOutcomes`,
   * `../epc/returnPath.ts`), one per outcome node that reads as a
   * return/rework/reject term but has no explicit return route. Empty when the
   * process has no such gap. Never fails the render; a separate result field —
   * never stamped into `svg`. (The binding `findings` artifact above is the
   * structural-gate output and is left untouched.)
   */
  readonly returnPathFindings: readonly ReturnPathFinding[]
  readonly metadata: HeadlessRenderMetadata
  /** The generated AML, for debugging/round-trip; never part of the SVG. */
  readonly debugAml: string
}

/** The input was not a well-formed `CanonicalProcessV1` — no canvas was booted. */
export interface HeadlessRenderParseFailure {
  readonly ok: false
  readonly reason: 'parse'
  readonly issues: readonly CanonicalParseIssue[]
}

/** The projected draft failed the structural EPC gate — no canvas was booted. */
export interface HeadlessRenderValidationFailure {
  readonly ok: false
  readonly reason: 'validation'
  readonly findings: EpcProjectionFindings
}

export type HeadlessRenderResult =
  HeadlessRenderSuccess | HeadlessRenderParseFailure | HeadlessRenderValidationFailure

/**
 * Render a `CanonicalProcessV1` to standalone, byte-stable, anchored SVG markup.
 * Never throws for a bad or structurally-invalid input: a parse rejection
 * returns `{ok:false, reason:'parse', issues}` and a failing structural gate
 * returns `{ok:false, reason:'validation', findings}`, both WITHOUT booting the
 * canvas (`globalThis.document` is untouched on those paths under plain Node).
 */
export async function renderCanonicalProcess(
  process: CanonicalProcessV1,
  options: RenderCanonicalProcessOptions = {}
): Promise<HeadlessRenderResult> {
  // 1. Parse (never throws).
  const parsed = parseCanonicalProcess(process)
  if (!parsed.ok) return { ok: false, reason: 'parse', issues: parsed.issues }
  const canonical = parsed.process

  // 2. Project to a fully-valid ArisAiDraftV1 + anchor tables.
  const projection = projectCanonicalToDraft(canonical)

  // 3. STRUCTURAL VALIDATION BEFORE ANY CANVAS BOOT. On any error finding this
  //    returns without constructing a DOM. `findings.inputSha256` is the
  //    SHA-256 of `canonicalJsonBytes(canonical)` via `globalThis.crypto.subtle`
  //    — reused verbatim as the metadata/stamp input hash.
  const findings = await validateProjectedDraft(projection, canonical)
  if (!findings.ok) return { ok: false, reason: 'validation', findings }

  // 4. Draft -> AML -> tokens -> semantic -> working document (all pure Node).
  const aml = buildAmlFromArisAiDraft(projection.draft)
  const semantic = buildSemanticArisDocument(tokenizeXmlDocument(aml.xml))
  const builtDocument = buildFromSource(semantic.index)

  // 4b. Default-legend detection + per-step satellite SUPPRESSION. The defaults
  //     are declared once in a top-right legend (step 6) and the matching
  //     duplicate satellites are pruned from the working document BEFORE the
  //     canvas boots — so the SVG loses the redundant occurrences while the AML
  //     (`aml.xml` / `debugAml`) keeps every ObjectDefinition, Occurrence and
  //     Connection. Deterministic: pure functions over the parsed canonical.
  const defaults = computeDefaults(canonical)
  const suppressedDraftIds = computeSuppressedSatelliteDraftIds(canonical, defaults)
  const suppressedOccurrenceIds = new Set(
    [...suppressedDraftIds].map((draftId) => `${OBJECT_OCCURRENCE_PREFIX}${draftId}`)
  )
  const workingDocument = pruneSuppressedOccurrences(builtDocument, suppressedOccurrenceIds)

  const modelIds = [...workingDocument.models.keys()]
  const modelId = modelIds[options.modelIndex ?? 0] ?? modelIds[0]
  if (modelId === undefined) {
    // Unreachable after a passing gate — the primary model always carries the
    // projected occurrences — but keeps the invariant explicit.
    throw new Error('The projected draft produced no renderable model.')
  }

  // 5. Boot the live canvas under a headless DOM and capture.
  ensureHeadlessDom()
  const container = createCanvasContainer(HEADLESS_CONTAINER_WIDTH, HEADLESS_CONTAINER_HEIGHT)
  let canvas: ArisCanvas | undefined
  try {
    canvas = ArisCanvas.create({ container, document: workingDocument, modelId, minimap: false })
    canvas.applyCleanLayout((graph) => cleanLayout(graph))

    // Print frame (A4 border + title block + RACI + DMT symbol legend) is
    // SVG-only page furniture, OFF by default. The calling service
    // (`service/src/pipeline/render.ts`) is expected to pass `printFrame: true`
    // ONLY when rendering for PDF output. The renderer's `printFrameVisibleFlag`
    // defaults to `true` at construction, so a bare `setPrintFrameVisible(true)`
    // would early-return and keep the pre-clean-layout frame; toggle off→on to
    // force a fresh rebuild from the post-layout model. The `false` branch is
    // the historical single call, so the default capture is byte-unchanged.
    const renderer = canvas.get<ArisRenderer>('arisRenderer')
    if (options.printFrame ?? false) {
      renderer.setPrintFrameVisible(false)
      renderer.setPrintFrameVisible(true)
    } else {
      renderer.setPrintFrameVisible(false)
    }

    stampAnchors(canvas, projection.anchors)

    // Paint the top-right default legend (EN/AR per `language`). Seam-driven so
    // it runs AFTER clean layout — the content bounds are final, so the legend
    // lands at the true top-right corner and the capture is deterministic. No
    // detected defaults => the service paints nothing.
    canvas
      .get<ArisDefaultLegend>('arisDefaultLegend')
      .setDefaults(defaults, options.language ?? 'en')

    // The export capture reads the diagram-js `.djs-container` (whose direct
    // child is the rendered `<svg>`) — the same container the studio export
    // passes (`canvas.canvas.getContainer()`), NOT the outer mount node.
    const djsContainer = canvas.canvas.getContainer()
    const svgRoot = findArisCanvasSvg(djsContainer)
    const metadata = buildMetadata(findings.inputSha256, modelId, options.sourceVersionId)
    stampRootMetadata(svgRoot, metadata)

    // Model-derived bounds replace the jsdom-blind `getBBox`; the text-run
    // overlay is PDF-only and dropped.
    const bounds = arisContentBounds(
      canvas.elementRegistry.getAll() as Element[]
    ) as ArisCanvasSvgBounds | null
    const capture = captureArisCanvasSvg(djsContainer, {
      ...(bounds ? { bounds } : {}),
      includeTextRuns: false
    })

    // Leave the live root clean so the engine metadata lives only on the clone.
    stripRootMetadata(svgRoot)

    return {
      ok: true,
      svg: stabilizeCaptionClipIds(capture.markup),
      findings,
      // Deterministic, LLM-free companion artifacts derived purely from the
      // parsed canonical / projected draft. They are SEPARATE result fields and
      // are never stamped into `svg` — so adding them does not perturb the
      // byte-stable SVG snapshot.
      narrative: buildProcessNarrative(canonical),
      verification: buildVerificationPackage(canonical),
      returnPathFindings: collectReturnPathFindings(projection.draft),
      metadata,
      debugAml: aml.xml
    }
  } finally {
    canvas?.destroy()
    container.remove()
  }
}

/**
 * Stamp `data-epc-node`/`data-epc-edge` on each `.djs-element` group whose canvas
 * id maps back through the projection anchors (canvas ids are
 * `ObjOcc.<draftLogicalId>` / `CxnOcc.<draftLogicalId>`; strip the prefix to
 * recover the draft logicalId the anchor tables key on).
 */
function stampAnchors(canvas: ArisCanvas, anchors: CanonicalProjectionAnchors): void {
  const registry = canvas.elementRegistry
  for (const element of registry.getAll()) {
    const id = element.id
    let attribute: 'data-epc-node' | 'data-epc-edge'
    let canonicalId: string | undefined
    if (id.startsWith(OBJECT_OCCURRENCE_PREFIX)) {
      attribute = 'data-epc-node'
      canonicalId = anchors.nodeByDraftId[id.slice(OBJECT_OCCURRENCE_PREFIX.length)]
    } else if (id.startsWith(CONNECTION_OCCURRENCE_PREFIX)) {
      attribute = 'data-epc-edge'
      canonicalId = anchors.edgeByDraftId[id.slice(CONNECTION_OCCURRENCE_PREFIX.length)]
    } else {
      continue
    }
    if (canonicalId === undefined) continue
    const gfx = registry.getGraphics(element) as SVGElement | undefined
    if (gfx) gfx.setAttribute(attribute, canonicalId)
  }
}

/**
 * Return a working document with the given occurrence ids (and every connection
 * incident to them) removed from every model — the RENDER-only satellite
 * suppression. The source `aml.xml` string is a separate artifact and is never
 * touched, so `debugAml` stays lossless (all ObjectDefinitions + Occurrences +
 * Connections remain in the AML); only the canvas/SVG loses the duplicates.
 * `objectDefinitions` are also left intact — only per-model occurrences drop.
 */
function pruneSuppressedOccurrences(
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

function buildMetadata(
  inputSha256: string,
  modelId: string,
  sourceVersionId: string | undefined
): HeadlessRenderMetadata {
  return {
    engineVersion: EPC_ENGINE_VERSION,
    schemaVersion: 1,
    projectionVersion: PROJECTION_VERSION,
    inputSha256,
    modelId,
    ...(sourceVersionId !== undefined ? { sourceVersionId } : {})
  }
}

/** Stamp the metadata onto the live SVG root PRE-capture, so the clone carries it. */
function stampRootMetadata(svgRoot: SVGSVGElement, metadata: HeadlessRenderMetadata): void {
  svgRoot.setAttribute('data-epc-engine-version', metadata.engineVersion)
  svgRoot.setAttribute('data-epc-schema-version', String(metadata.schemaVersion))
  svgRoot.setAttribute('data-epc-projection-version', String(metadata.projectionVersion))
  svgRoot.setAttribute('data-epc-input-sha256', metadata.inputSha256)
  if (metadata.sourceVersionId !== undefined) {
    svgRoot.setAttribute('data-epc-source-version', metadata.sourceVersionId)
  }
}

function stripRootMetadata(svgRoot: SVGSVGElement): void {
  for (const attribute of ROOT_METADATA_ATTRIBUTES) svgRoot.removeAttribute(attribute)
}

/**
 * Renumber caption clip-path ids to a deterministic first-appearance sequence.
 *
 * The live renderer mints these ids from a MODULE-GLOBAL counter
 * (`captionClipSeq`, `renderer.ts`), so the raw markup's clip ids depend on how
 * many captions the Node process has drawn before — a fresh CLI process starts
 * at 0 (so separate processes on the same input already agree), but a second
 * render in the SAME process would otherwise drift. These ids are internal,
 * non-semantic plumbing (they anchor nothing — the `data-epc-*` anchors are
 * untouched), so renumbering both the `id="…"` definition and its
 * `url(#…)` reference by first appearance makes `svg` byte-identical across
 * runs regardless of process state, without editing the shared renderer. Same
 * markup structure ⇒ same left-to-right order ⇒ same mapping ⇒ deterministic.
 */
/** Localized draft names → the flat `EpcLocalizedNames` record the EPC layer reads. */
function localizedNames(names: ArisAiLocalizedText | undefined): Record<string, string> {
  const values: Record<string, string> = {}
  if (names?.en) values.en = names.en
  if (names?.ar) values.ar = names.ar
  return values
}

/**
 * Project one drafted model onto the narrow `EpcGraph` shape
 * `detectReturnPathOutcomes` consumes. Structural — reads the draft's own
 * per-model objects/relations; a fresh projection is never locked, so
 * `locked`/`linkedModelIds` (return-path eligibility hints) are left absent.
 */
function epcGraphForDraftModel(draft: ArisAiDraftV1, modelLogicalId: string): EpcGraph {
  const nodes: EpcNode[] = draft.objects
    .filter((object) => object.modelLogicalId === modelLogicalId)
    .map((object) => ({
      id: object.logicalId,
      objectType: object.objectType,
      symbolType: object.symbolType ?? null,
      names: localizedNames(object.names)
    }))
  const edges: EpcEdge[] = draft.relations
    .filter((relation) => relation.modelLogicalId === modelLogicalId)
    .map((relation) => ({
      id: relation.logicalId,
      source: relation.sourceLogicalId,
      target: relation.targetLogicalId,
      connectionType: relation.connectionType,
      ...(relation.names ? { names: localizedNames(relation.names) } : {})
    }))
  return { modelId: modelLogicalId, nodes, edges }
}

/**
 * Advisory return-path pass over every drafted model: reports each outcome node
 * that reads as a return/rework/reject term but has NO explicit return route
 * (`status: 'missing'`). Explicit (already-cyclic) matches produce no finding.
 * Deterministic: draft-model order, then the detector's own stable ordering.
 */
function collectReturnPathFindings(draft: ArisAiDraftV1): ReturnPathFinding[] {
  const findings: ReturnPathFinding[] = []
  for (const model of draft.models) {
    const graph = epcGraphForDraftModel(draft, model.logicalId)
    for (const result of detectReturnPathOutcomes(graph)) {
      if (result.status !== 'missing') continue
      findings.push({ source: 'return-path', modelId: model.logicalId, route: result })
    }
  }
  return findings
}

function stabilizeCaptionClipIds(svg: string): string {
  const remap = new Map<string, number>()
  return svg.replace(/aris-caption-clip-\d+/g, (original) => {
    let index = remap.get(original)
    if (index === undefined) {
      index = remap.size + 1
      remap.set(original, index)
    }
    return `aris-caption-clip-${index}`
  })
}

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
 * `Date.now`/`Math.random`; bounds are pure model-space math
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
  parseCanonicalProcess,
  projectCanonicalToDraft,
  validateProjectedDraft,
  PROJECTION_VERSION,
  type CanonicalParseIssue,
  type CanonicalProcessV1,
  type CanonicalProjectionAnchors,
  type EpcProjectionFindings
} from '../canonical'
import { buildFromSource } from '../model/buildFromSource'
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

export interface HeadlessRenderSuccess {
  readonly ok: true
  readonly svg: string
  readonly findings: EpcProjectionFindings
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
  const workingDocument = buildFromSource(semantic.index)

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
    canvas.get<ArisRenderer>('arisRenderer').setPrintFrameVisible(false)

    stampAnchors(canvas, projection.anchors)

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

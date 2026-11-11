/**
 * Pure canonical-process -> convention AML pipeline.
 *
 * This mirrors the pre-canvas portion of `renderCanonicalProcess`, then writes
 * the clean-layout geometry and the process-default legend into the persisted
 * AML view. It never boots diagram-js, jsdom, or a browser canvas.
 */

import { buildLayoutGraph } from '../canvas/layoutSeam'
import {
  computeDefaults,
  computeSuppressedSatelliteDraftIds,
  parseCanonicalProcess,
  projectCanonicalToDraft,
  validateProjectedDraft,
  type CanonicalParseIssue,
  type CanonicalProcessV1,
  type CanonicalProjectionResult,
  type DefaultKind,
  type DefaultsByKind,
  type EpcProjectionFindings
} from '../canonical'
import { cleanLayout } from '../layout/cleanLayout'
import type { ArisLayoutRect, ArisLayoutRejectionFinding } from '../layout/types'
import { buildFromSource } from '../model/buildFromSource'
import { arisIdForLogicalId, buildAmlFromArisAiDraft } from '../shell/arisAiCreate'
import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import { attrDefSpec, objectOccurrenceSpec, positionSpec, type ElementSpec } from '../writer'
import { pruneSuppressedOccurrences } from './suppression'

const OBJECT_OCCURRENCE_PREFIX = 'ObjOcc.'
const CONNECTION_OCCURRENCE_PREFIX = 'CxnOcc.'

// The legend sits one block gap right of the flow's real right edge, not the
// canvas margin, so it does not float far from the process it documents.
const LEGEND_GAP_X = 40
const HEADER_BAND = 56
const BLOCK_GAP = 40
const DMT_BLOCK_WIDTH = 180
const DMT_SATELLITE_GAP = 28
const DMT_CLUSTER_DISTANCE_LIMIT = 1.5 * (DMT_BLOCK_WIDTH + DMT_SATELLITE_GAP)
const BLOCK_HEIGHT = 70
const LEGEND_HEADER_DEFINITION_ID = 'FFTextDef.legend.defaults'

const LEGEND_ORDER: readonly DefaultKind[] = ['owner', 'system', 'informationObject', 'control']

const DRAFT_PREFIX: Readonly<Record<DefaultKind, string>> = Object.freeze({
  owner: 'r',
  system: 's',
  informationObject: 'io',
  control: 'c'
})

function isOrphanSatelliteLogicalId(logicalId: string): boolean {
  return Object.values(DRAFT_PREFIX).some(
    (prefix) => logicalId.startsWith(`${prefix}:`) && !logicalId.includes('@')
  )
}

export interface AmlLegendHeaderPlacement {
  readonly definitionId: string
  readonly position: { readonly x: number; readonly y: number }
}

export interface AmlLegendBlockPlacement {
  readonly kind: DefaultKind
  readonly entityId: string
  readonly logicalId: string
  readonly occurrenceId: string
  readonly objectDefinitionId: string
  readonly symbolNum: string
  readonly rect: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
}

/** Exact persisted ids and coordinates of the AML defaults legend. */
export interface AmlLegendPlacement {
  readonly header: AmlLegendHeaderPlacement
  readonly blocks: readonly AmlLegendBlockPlacement[]
}

export interface AmlDefaultLegendResult {
  readonly rootChildren: ElementSpec[]
  readonly modelChildren: ElementSpec[]
  readonly placement: AmlLegendPlacement
  readonly replacedOrphanIds: string[]
}

export interface ConventionAmlSuccess {
  readonly ok: true
  readonly xml: string
  readonly defaults: DefaultsByKind
  readonly suppressedOccurrenceCount: number
  readonly legend: AmlLegendPlacement
  readonly layoutAccepted: boolean
  readonly layoutFindings: readonly ArisLayoutRejectionFinding[]
  readonly counts: {
    readonly models: number
    readonly objects: number
    readonly relations: number
  }
}

export interface ConventionAmlParseFailure {
  readonly ok: false
  readonly reason: 'parse'
  readonly issues: readonly CanonicalParseIssue[]
}

export interface ConventionAmlValidationFailure {
  readonly ok: false
  readonly reason: 'validation'
  readonly findings: EpcProjectionFindings
}

export type ConventionAmlResult =
  ConventionAmlSuccess | ConventionAmlParseFailure | ConventionAmlValidationFailure

/** Reserved for caller options without permitting unspecified behavior. */
export type ConventionAmlOptions = Readonly<Record<string, never>>

/**
 * Build the free-text header and existing-definition-backed default blocks for
 * the persisted AML convention legend.
 */
export function computeAmlDefaultLegend(
  _canonical: CanonicalProcessV1,
  defaults: DefaultsByKind,
  projection: CanonicalProjectionResult,
  canvasRect: ArisLayoutRect,
  contentRight: number = canvasRect.x + canvasRect.width
): AmlDefaultLegendResult {
  const legendX = Math.round(contentRight) + LEGEND_GAP_X
  const y0 = Math.round(canvasRect.y)

  const rootChildren: ElementSpec[] = [
    {
      name: 'FFTextDef',
      attributes: [{ name: 'FFTextDef.ID', value: LEGEND_HEADER_DEFINITION_ID }],
      children: [
        attrDefSpec({
          type: 'AT_NAME',
          values: [
            { localeId: '1033', text: 'Defaults' },
            { localeId: '1025', text: 'الافتراضيات' }
          ]
        })
      ]
    }
  ]
  const modelChildren: ElementSpec[] = [
    {
      name: 'FFTextOcc',
      attributes: [{ name: 'FFTextDef.IdRef', value: LEGEND_HEADER_DEFINITION_ID }],
      children: [positionSpec({ x: legendX, y: y0 })]
    }
  ]
  const blocks: AmlLegendBlockPlacement[] = []
  const replacedOrphanIds: string[] = []

  for (const kind of LEGEND_ORDER) {
    const entry = defaults[kind]
    if (!entry) continue

    const prefix = DRAFT_PREFIX[kind]
    const ownedPrefix = `${prefix}:${entry.id}@`
    const orphanLogicalId = `${prefix}:${entry.id}`
    const draftObject =
      projection.draft.objects.find((object) => object.logicalId.startsWith(ownedPrefix)) ??
      projection.draft.objects.find((object) => object.logicalId === orphanLogicalId)
    if (!draftObject) {
      throw new Error(`Default ${kind} "${entry.id}" has no projected draft object.`)
    }

    const index = blocks.length
    const logicalId = draftObject.logicalId
    const occurrenceId = `ObjOcc.dl:${kind}:${entry.id}`
    const objectDefinitionId = arisIdForLogicalId('ObjDef', logicalId)
    const symbolNum = draftObject.symbolType
    if (!symbolNum) {
      throw new Error(`Default ${kind} "${entry.id}" has no projected symbol type.`)
    }
    const rect = {
      x: legendX,
      y: y0 + HEADER_BAND + index * (BLOCK_HEIGHT + BLOCK_GAP),
      width: DMT_BLOCK_WIDTH,
      height: BLOCK_HEIGHT
    }

    modelChildren.push(
      objectOccurrenceSpec({
        id: occurrenceId,
        objectDefinitionId,
        symbolNum,
        position: { x: rect.x, y: rect.y },
        size: { dx: rect.width, dy: rect.height }
      })
    )
    blocks.push({
      kind,
      entityId: entry.id,
      logicalId,
      occurrenceId,
      objectDefinitionId,
      symbolNum,
      rect
    })
    if (logicalId === orphanLogicalId) replacedOrphanIds.push(logicalId)
  }

  return {
    rootChildren,
    modelChildren,
    placement: {
      header: {
        definitionId: LEGEND_HEADER_DEFINITION_ID,
        position: { x: legendX, y: y0 }
      },
      blocks
    },
    replacedOrphanIds
  }
}

/**
 * Parse, project, structurally validate, lay out, and persist a convention AML
 * document. Bad inputs return the same parse/validation envelopes as the
 * canonical headless renderer.
 */
export async function buildConventionAml(
  process: unknown,
  _options: ConventionAmlOptions = {}
): Promise<ConventionAmlResult> {
  // 1. Parse (never throws for malformed input).
  const parsed = parseCanonicalProcess(process)
  if (!parsed.ok) return { ok: false, reason: 'parse', issues: parsed.issues }
  const canonical = parsed.process

  // 2. Project to the validated AI-draft representation and anchor tables.
  const projection = projectCanonicalToDraft(canonical)

  // 3. Run the structural gate before any AML layout work.
  const findings = await validateProjectedDraft(projection, canonical)
  if (!findings.ok) return { ok: false, reason: 'validation', findings }

  // 4. Draft -> base AML -> semantic index -> working document.
  const baseAml = buildAmlFromArisAiDraft(projection.draft)
  const builtDocument = buildFromSource(
    buildSemanticArisDocument(tokenizeXmlDocument(baseAml.xml)).index
  )

  // 4b. Reuse the canonical renderer's default detection and occurrence-only
  // suppression before computing clean layout.
  const defaults = computeDefaults(canonical)
  const suppressedDraftIds = computeSuppressedSatelliteDraftIds(canonical, defaults)
  const suppressedOccurrenceIds = new Set(
    [...suppressedDraftIds].map((logicalId) => `${OBJECT_OCCURRENCE_PREFIX}${logicalId}`)
  )
  const pruned = pruneSuppressedOccurrences(builtDocument, suppressedOccurrenceIds)

  const modelId = [...pruned.models.keys()][0]
  const model = modelId === undefined ? undefined : pruned.models.get(modelId)
  if (!model) {
    throw new Error('The projected draft produced no convention AML model.')
  }

  const graph = buildLayoutGraph(pruned, model)
  const layout = cleanLayout(graph, { satelliteClusterLimit: DMT_CLUSTER_DISTANCE_LIMIT })

  const geometry = new Map<
    string,
    { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  >()
  for (const node of layout.nodes) {
    const logicalId = node.id.startsWith(OBJECT_OCCURRENCE_PREFIX)
      ? node.id.slice(OBJECT_OCCURRENCE_PREFIX.length)
      : node.id
    geometry.set(logicalId, {
      x: Math.round(node.rect.x),
      y: Math.round(node.rect.y),
      width: Math.round(node.rect.width),
      height: Math.round(node.rect.height)
    })
  }

  const routes = new Map<string, readonly { readonly x: number; readonly y: number }[]>()
  for (const edge of layout.edges) {
    const logicalId = edge.id.startsWith(CONNECTION_OCCURRENCE_PREFIX)
      ? edge.id.slice(CONNECTION_OCCURRENCE_PREFIX.length)
      : edge.id
    routes.set(
      logicalId,
      edge.points.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }))
    )
  }

  // Right edge of the placed flow (nodes and their labels), without the canvas margin.
  const contentRight = layout.nodes.reduce((right, node) => {
    const nodeRight = node.rect.x + node.rect.width
    const labelRight = node.labelRect ? node.labelRect.x + node.labelRect.width : nodeRight
    return Math.max(right, nodeRight, labelRight)
  }, Number.NEGATIVE_INFINITY)
  const legend = computeAmlDefaultLegend(
    canonical,
    defaults,
    projection,
    layout.canvas,
    Number.isFinite(contentRight) ? contentRight : undefined
  )
  // Orphan definitions remain available for legend/default lookup and source
  // fidelity, but an unconnected orphan must never be rendered in the model.
  // Defaults represented by the legend are included too; their normal
  // occurrence is replaced by the legend occurrence using the same definition.
  const orphanSatelliteIds = projection.draft.objects
    .map((object) => object.logicalId)
    .filter(isOrphanSatelliteLogicalId)
  const omitOccurrences = new Set([
    ...suppressedDraftIds,
    ...orphanSatelliteIds,
    ...legend.replacedOrphanIds
  ])
  const finalAml = buildAmlFromArisAiDraft(projection.draft, {
    geometry,
    routes,
    omitOccurrences,
    extraRootChildren: legend.rootChildren,
    extraModelChildren: legend.modelChildren
  })

  return {
    ok: true,
    xml: finalAml.xml,
    defaults,
    suppressedOccurrenceCount: finalAml.omittedOccurrenceCount,
    legend: legend.placement,
    layoutAccepted: layout.accepted,
    layoutFindings: layout.findings,
    counts: {
      models: finalAml.modelCount,
      objects: finalAml.objectCount,
      relations: finalAml.relationCount
    }
  }
}

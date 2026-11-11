import { beforeAll, describe, expect, it } from 'vitest'

import parityFixture from '../../../tests/e2e/fixtures/epc-parity-canonical.json'
import {
  computeDefaults,
  computeSuppressedSatelliteDraftIds,
  projectCanonicalToDraft,
  validateProjectedDraft,
  type CanonicalProcessV1,
  type DefaultKind
} from '../canonical'
import { buildLayoutGraph } from '../canvas/layoutSeam'
import { cleanLayout } from '../layout/cleanLayout'
import { buildFromSource } from '../model/buildFromSource'
import { buildAmlFromArisAiDraft } from '../shell/arisAiCreate'
import { buildSemanticArisDocument } from '../source/semanticIndex'
import {
  tokenizeXmlDocument,
  type TokenizedXmlDocument,
  type XmlElementNode,
  type XmlNode
} from '../source/xmlTokenizer'
import {
  buildConventionAml,
  type AmlLegendPlacement,
  type ConventionAmlSuccess
} from './amlConvention'
import { pruneSuppressedOccurrences } from './suppression'

const PARITY_PROCESS = parityFixture as CanonicalProcessV1
const DMT_CLUSTER_DISTANCE_LIMIT = 312

const DMT_PROCESS: CanonicalProcessV1 = {
  version: 1,
  identity: {
    id: 'dmt-permit',
    names: { en: 'DMT Permit Review', ar: 'مراجعة تصريح دائرة البلديات والنقل' },
    confidence: 'high'
  },
  nodes: [
    { id: 'n-start', kind: 'event', names: { en: 'Request received' }, confidence: 'high' },
    { id: 'n-a1', kind: 'activity', names: { en: 'Register request' }, confidence: 'high' },
    { id: 'n-a2', kind: 'activity', names: { en: 'Review request' }, confidence: 'high' },
    { id: 'n-a3', kind: 'activity', names: { en: 'Issue response' }, confidence: 'high' },
    { id: 'n-a4', kind: 'activity', names: { en: 'Archive case' }, confidence: 'high' },
    { id: 'n-end', kind: 'event', names: { en: 'Case closed' }, confidence: 'high' }
  ],
  decisions: [],
  edges: [
    {
      id: 'e-1',
      kind: 'sequence',
      sourceNodeId: 'n-start',
      targetNodeId: 'n-a1',
      confidence: 'high'
    },
    {
      id: 'e-2',
      kind: 'sequence',
      sourceNodeId: 'n-a1',
      targetNodeId: 'n-a2',
      confidence: 'high'
    },
    {
      id: 'e-3',
      kind: 'sequence',
      sourceNodeId: 'n-a2',
      targetNodeId: 'n-a3',
      confidence: 'high'
    },
    {
      id: 'e-4',
      kind: 'sequence',
      sourceNodeId: 'n-a3',
      targetNodeId: 'n-a4',
      confidence: 'high'
    },
    {
      id: 'e-5',
      kind: 'sequence',
      sourceNodeId: 'n-a4',
      targetNodeId: 'n-end',
      confidence: 'high'
    }
  ],
  roles: [
    {
      id: 'r-owner',
      names: { en: 'Permitting Team', ar: 'فريق التصاريح' },
      nodeIds: ['n-a1', 'n-a2', 'n-a3', 'n-a4'],
      owner: true,
      confidence: 'high'
    }
  ],
  systems: [
    {
      id: 's-core',
      names: { en: 'Permit Platform', ar: 'منصة التصاريح' },
      nodeIds: ['n-a1', 'n-a2', 'n-a3'],
      confidence: 'high'
    },
    {
      id: 's-override',
      names: { en: 'GIS Review Tool', ar: 'أداة مراجعة نظم المعلومات الجغرافية' },
      nodeIds: ['n-a2'],
      confidence: 'high'
    }
  ],
  informationObjects: [],
  controls: [
    {
      id: 'c-orphan',
      names: { en: 'DMT Permit Policy', ar: 'سياسة تصاريح دائرة البلديات والنقل' },
      kind: 'policy',
      nodeIds: [],
      default: true,
      confidence: 'high'
    }
  ],
  facts: [],
  unknowns: []
}

const STRUCTURALLY_INVALID: CanonicalProcessV1 = {
  version: 1,
  identity: { id: 'invalid', names: { en: 'Invalid' }, confidence: 'high' },
  nodes: [{ id: 'n-only', kind: 'activity', names: { en: 'Only activity' }, confidence: 'high' }],
  decisions: [],
  edges: [],
  roles: [],
  systems: [],
  informationObjects: [],
  controls: [],
  facts: [],
  unknowns: []
}

interface ExpectedLegendBlock {
  readonly kind: DefaultKind
  readonly entityId: string
  readonly logicalId: string
  readonly symbolNum: string
}

const CASES: readonly {
  readonly name: string
  readonly process: CanonicalProcessV1
  readonly legendBlocks: readonly ExpectedLegendBlock[]
}[] = [
  {
    name: 'parity fixture',
    process: PARITY_PROCESS,
    legendBlocks: [
      {
        kind: 'owner',
        entityId: 'r-officer',
        logicalId: 'r:r-officer@n-intake',
        symbolNum: 'ST_EMPL_TYPE'
      },
      {
        kind: 'system',
        entityId: 's-crm',
        logicalId: 's:s-crm@n-intake',
        symbolNum: 'ST_APPL_SYS'
      }
    ]
  },
  {
    name: 'DMT declared-owner and majority-system fixture',
    process: DMT_PROCESS,
    legendBlocks: [
      {
        kind: 'owner',
        entityId: 'r-owner',
        logicalId: 'r:r-owner@n-a1',
        symbolNum: 'ST_EMPL_TYPE'
      },
      {
        kind: 'system',
        entityId: 's-core',
        logicalId: 's:s-core@n-a1',
        symbolNum: 'ST_APPL_SYS'
      },
      {
        kind: 'control',
        entityId: 'c-orphan',
        logicalId: 'c:c-orphan',
        symbolNum: 'ST_BUSINESS_POLICY'
      }
    ]
  }
]

function elementChildren(nodes: readonly XmlNode[]): XmlElementNode[] {
  return nodes.filter((node): node is XmlElementNode => node.kind === 'element')
}

function requiredChild(nodes: readonly XmlNode[], name: string): XmlElementNode {
  const child = elementChildren(nodes).find((node) => node.name === name)
  if (!child) throw new Error(`Expected direct <${name}> child.`)
  return child
}

function attribute(node: XmlElementNode, name: string): string | undefined {
  return node.startTag.attributes.find((candidate) => candidate.name === name)?.value
}

function primaryModelElement(document: TokenizedXmlDocument): XmlElementNode {
  const aml = requiredChild(document.children, 'AML')
  const group = requiredChild(aml.children, 'Group')
  return requiredChild(group.children, 'Model')
}

function requireSuccess(
  result: Awaited<ReturnType<typeof buildConventionAml>>
): ConventionAmlSuccess {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(`Expected convention AML success, received ${result.reason}.`)
  return result
}

async function expectedPipeline(process: CanonicalProcessV1) {
  const projection = projectCanonicalToDraft(process)
  const findings = await validateProjectedDraft(projection, process)
  expect(findings.ok).toBe(true)

  const baseAml = buildAmlFromArisAiDraft(projection.draft)
  const builtDocument = buildFromSource(
    buildSemanticArisDocument(tokenizeXmlDocument(baseAml.xml)).index
  )
  const defaults = computeDefaults(process)
  const suppressedDraftIds = computeSuppressedSatelliteDraftIds(process, defaults)
  const suppressedOccurrenceIds = new Set(
    [...suppressedDraftIds].map((logicalId) => `ObjOcc.${logicalId}`)
  )
  const pruned = pruneSuppressedOccurrences(builtDocument, suppressedOccurrenceIds)
  const modelId = [...pruned.models.keys()][0]
  if (!modelId) throw new Error('Expected a projected primary model.')
  const model = pruned.models.get(modelId)
  if (!model) throw new Error('Expected a projected primary model.')
  const graph = buildLayoutGraph(pruned, model)
  const layout = cleanLayout(graph, { satelliteClusterLimit: DMT_CLUSTER_DISTANCE_LIMIT })
  return { projection, defaults, suppressedDraftIds, layout }
}

function parsedOutput(xml: string) {
  const tokens = tokenizeXmlDocument(xml)
  const semantic = buildSemanticArisDocument(tokens)
  const document = buildFromSource(semantic.index)
  const modelId = [...document.models.keys()][0]
  if (!modelId) throw new Error('Expected a convention primary model.')
  const model = document.models.get(modelId)
  if (!model) throw new Error('Expected a convention primary model.')
  return { tokens, semantic, document, model }
}

/** Right edge of the placed flow, nodes and labels, without the canvas margin. */
function flowRight(nodes: readonly { readonly rect: { readonly x: number; readonly width: number }; readonly labelRect: { readonly x: number; readonly width: number } | null }[]): number {
  return nodes.reduce((right, node) => {
    const nodeRight = node.rect.x + node.rect.width
    const labelRight = node.labelRect ? node.labelRect.x + node.labelRect.width : nodeRight
    return Math.max(right, nodeRight, labelRight)
  }, Number.NEGATIVE_INFINITY)
}

function expectedPlacement(
  blocks: readonly ExpectedLegendBlock[],
  canvas: { readonly x: number; readonly y: number; readonly width: number },
  contentRight: number
): AmlLegendPlacement {
  const x = Math.round(contentRight) + 40
  const y = Math.round(canvas.y)
  return {
    header: {
      definitionId: 'FFTextDef.legend.defaults',
      position: { x, y }
    },
    blocks: blocks.map((block, index) => ({
      kind: block.kind,
      entityId: block.entityId,
      logicalId: block.logicalId,
      occurrenceId: `ObjOcc.dl:${block.kind}:${block.entityId}`,
      objectDefinitionId: `ObjDef.${block.logicalId}`,
      symbolNum: block.symbolNum,
      rect: { x, y: y + 56 + index * 110, width: 180, height: 70 }
    }))
  }
}

describe('buildConventionAml result discipline', () => {
  it('returns a parse envelope for malformed input instead of throwing', async () => {
    const result = await buildConventionAml({ version: 2 })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected a parse failure.')
    expect(result.reason).toBe('parse')
    if (result.reason !== 'parse') throw new Error('Expected a parse failure.')
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('returns a validation envelope for a structurally invalid process', async () => {
    const result = await buildConventionAml(STRUCTURALLY_INVALID)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected a validation failure.')
    expect(result.reason).toBe('validation')
    if (result.reason !== 'validation') throw new Error('Expected a validation failure.')
    expect(result.findings.ok).toBe(false)
  })
})

describe.each(CASES)('buildConventionAml — $name', ({ process, legendBlocks }) => {
  let result: ConventionAmlSuccess
  let expected: Awaited<ReturnType<typeof expectedPipeline>>

  beforeAll(async () => {
    expected = await expectedPipeline(process)
    result = requireSuccess(await buildConventionAml(process))
  })

  it('omits suppressed occurrences and incident connections while retaining definitions', () => {
    const { semantic, model } = parsedOutput(result.xml)
    const replacedOrphanIds = new Set(
      legendBlocks.filter((block) => !block.logicalId.includes('@')).map((block) => block.logicalId)
    )
    const omittedIds = new Set([...expected.suppressedDraftIds, ...replacedOrphanIds])

    expect(result.defaults).toEqual(expected.defaults)
    expect(result.suppressedOccurrenceCount).toBe(omittedIds.size)
    expect(semantic.index.objectDefinitions.size).toBe(expected.projection.draft.objects.length)
    expect(semantic.index.connectionDefinitions.size).toBe(
      expected.projection.draft.relations.length
    )

    for (const logicalId of expected.suppressedDraftIds) {
      const occurrenceId = `ObjOcc.${logicalId}`
      expect(semantic.index.objectOccurrences.has(occurrenceId), occurrenceId).toBe(false)
      expect(semantic.index.objectDefinitions.has(`ObjDef.${logicalId}`), logicalId).toBe(true)
      expect(
        model.connectionOccurrences.some(
          (connection) =>
            connection.sourceOccurrenceId === occurrenceId ||
            connection.targetOccurrenceId === occurrenceId
        ),
        occurrenceId
      ).toBe(false)

      const incidentRelations = expected.projection.draft.relations.filter(
        (relation) =>
          relation.sourceLogicalId === logicalId || relation.targetLogicalId === logicalId
      )
      expect(incidentRelations.length, logicalId).toBeGreaterThan(0)
      for (const relation of incidentRelations) {
        expect(
          semantic.index.connectionDefinitions.has(`CxnDef.${relation.logicalId}`),
          relation.logicalId
        ).toBe(true)
        expect(
          semantic.index.connectionOccurrences.has(`CxnOcc.${relation.logicalId}`),
          relation.logicalId
        ).toBe(false)
      }
    }
  })

  it('emits one bilingual defaults header and one exact top-right block per default', () => {
    const { tokens, semantic } = parsedOutput(result.xml)
    const contentRight = flowRight(expected.layout.nodes)
    const expectedLegend = expectedPlacement(legendBlocks, expected.layout.canvas, contentRight)
    const legendX = Math.round(contentRight) + 40
    // The legend hugs the flow: one block gap away, not a canvas margin away.
    expect(legendX - Math.round(contentRight)).toBe(40)

    expect(result.legend).toEqual(expectedLegend)
    expect(semantic.index.freeText.has('FFTextDef.legend.defaults')).toBe(true)
    expect(semantic.index.freeTextOccurrences).toHaveLength(1)
    expect(semantic.index.freeTextOccurrences[0]?.parsed).toMatchObject({
      freeTextDefinitionId: 'FFTextDef.legend.defaults',
      x: legendX,
      y: Math.round(expected.layout.canvas.y),
      dx: null,
      dy: null
    })

    const headerName = semantic.index.attributes.find(
      (entry) =>
        entry.parsed.ownerSourceId === 'FFTextDef.legend.defaults' &&
        entry.parsed.attributeType === 'AT_NAME'
    )
    expect(headerName?.parsed.values.map((value) => [value.localeId, value.text])).toEqual([
      ['1033', 'Defaults'],
      ['1025', 'الافتراضيات']
    ])

    const modelElement = primaryModelElement(tokens)
    const freeTextOccurrence = requiredChild(modelElement.children, 'FFTextOcc')
    expect(attribute(freeTextOccurrence, 'FFTextDef.IdRef')).toBe('FFTextDef.legend.defaults')
    expect(attribute(freeTextOccurrence, 'FFTextOcc.ID')).toBeUndefined()
    expect(elementChildren(freeTextOccurrence.children).map((child) => child.name)).toEqual([
      'Position'
    ])

    const legendOccurrences = [...semantic.index.objectOccurrences.values()].filter((entry) =>
      entry.parsed.objectOccurrenceId?.startsWith('ObjOcc.dl:')
    )
    expect(legendOccurrences).toHaveLength(legendBlocks.length)
    for (const block of expectedLegend.blocks) {
      const occurrence = semantic.index.objectOccurrences.get(block.occurrenceId)
      expect(occurrence?.parsed, block.occurrenceId).toMatchObject({
        objectDefinitionId: block.objectDefinitionId,
        symbolNum: block.symbolNum,
        x: block.rect.x,
        y: block.rect.y,
        dx: 180,
        dy: 70
      })
      expect(block.rect.x).toBeGreaterThanOrEqual(legendX)
      expect(semantic.index.objectDefinitions.has(block.objectDefinitionId)).toBe(true)
    }
  })

  it('persists rounded clean-layout geometry and keeps every visible satellite local', () => {
    const { semantic, model } = parsedOutput(result.xml)
    const replacedOrphanIds = new Set(
      legendBlocks.filter((block) => !block.logicalId.includes('@')).map((block) => block.logicalId)
    )
    const omittedIds = new Set([...expected.suppressedDraftIds, ...replacedOrphanIds])

    for (const node of expected.layout.nodes) {
      const logicalId = node.id.replace(/^ObjOcc\./u, '')
      if (replacedOrphanIds.has(logicalId)) continue
      expect(semantic.index.objectOccurrences.get(node.id)?.parsed, node.id).toMatchObject({
        x: Math.round(node.rect.x),
        y: Math.round(node.rect.y),
        dx: Math.round(node.rect.width),
        dy: Math.round(node.rect.height)
      })
    }

    for (const edge of expected.layout.edges) {
      const points = semantic.index.routePoints
        .filter((point) => point.connectionOccurrenceId === edge.id)
        .map((point) => ({ x: point.x, y: point.y }))
      expect(points, edge.id).toEqual(
        edge.points.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }))
      )
    }

    const satelliteLogicalIds = expected.projection.draft.objects
      .map((object) => object.logicalId)
      .filter((logicalId) => /^(?:r|s|io|c):/u.test(logicalId))
      .filter((logicalId) => !omittedIds.has(logicalId))
    for (const logicalId of satelliteLogicalIds) {
      const occurrenceId = `ObjOcc.${logicalId}`
      const incident = model.connectionOccurrences.filter(
        (connection) =>
          connection.sourceOccurrenceId === occurrenceId ||
          connection.targetOccurrenceId === occurrenceId
      )
      expect(incident, occurrenceId).toHaveLength(1)

      const connection = incident[0]
      if (!connection) throw new Error(`Expected one connection for ${occurrenceId}.`)
      const ownerOccurrenceId =
        connection.sourceOccurrenceId === occurrenceId
          ? connection.targetOccurrenceId
          : connection.sourceOccurrenceId
      const satellite = semantic.index.objectOccurrences.get(occurrenceId)?.parsed
      const owner = semantic.index.objectOccurrences.get(ownerOccurrenceId)?.parsed
      if (!satellite || !owner) throw new Error(`Expected persisted owner geometry for ${occurrenceId}.`)
      const { x: satelliteX, y: satelliteY, dx: satelliteDx, dy: satelliteDy } = satellite
      const { x: ownerX, y: ownerY, dx: ownerDx, dy: ownerDy } = owner
      if (
        satelliteX === null ||
        satelliteY === null ||
        satelliteDx === null ||
        satelliteDy === null ||
        ownerX === null ||
        ownerY === null ||
        ownerDx === null ||
        ownerDy === null
      ) {
        throw new Error(`Expected non-null persisted geometry for ${occurrenceId}.`)
      }
      const satelliteCenter = {
        x: satelliteX + satelliteDx / 2,
        y: satelliteY + satelliteDy / 2
      }
      const ownerCenter = { x: ownerX + ownerDx / 2, y: ownerY + ownerDy / 2 }
      expect(Math.hypot(satelliteCenter.x - ownerCenter.x, satelliteCenter.y - ownerCenter.y)).toBeLessThan(
        DMT_CLUSTER_DISTANCE_LIMIT
      )
    }
  })

  it('round-trips with expected graph counts and is byte-deterministic', async () => {
    const second = requireSuccess(await buildConventionAml(process))
    const { document, model } = parsedOutput(result.xml)
    const reopenedGraph = buildLayoutGraph(document, model)
    const replacedOrphanCount = legendBlocks.filter(
      (block) => !block.logicalId.includes('@')
    ).length

    expect(second.xml).toBe(result.xml)
    expect(result.layoutAccepted).toBe(expected.layout.accepted)
    expect(result.layoutFindings).toEqual(expected.layout.findings)
    expect(result.counts).toEqual({
      models: expected.projection.draft.models.length,
      objects: expected.projection.draft.objects.length - result.suppressedOccurrenceCount,
      relations: expected.layout.edges.length
    })
    expect(reopenedGraph.nodes).toHaveLength(
      expected.layout.nodes.length - replacedOrphanCount + legendBlocks.length
    )
    expect(reopenedGraph.edges).toHaveLength(expected.layout.edges.length)
  })
})

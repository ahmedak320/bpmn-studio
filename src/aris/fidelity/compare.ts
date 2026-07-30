/**
 * Pure comparator between an `ArisWorkingDocument` model and a hand-authored fidelity
 * expectation.
 *
 * The comparator reuses the EPC flow classification from `src/aris/epc` so the spine walk
 * follows exactly the same control-flow edges as the validator. Satellite side is determined
 * from occurrence geometry; colours are normalized through `occurrenceColorToCss` so authored
 * `#rrggbb` and AML bare-hex spellings compare equal.
 */

import type {
  ArisLocalizedValue,
  ArisModel,
  ArisObjectOccurrence,
  ArisSourceIndexLike,
  ArisWorkingDocument
} from '../model/types'
import { occurrenceColorToCss } from '../canvas/renderer'
import { toEpcGraph } from '../epc/adapter'
import { buildFlowGraphIndex, type FlowGraphIndex } from '../epc/flowGraph'
import { FLOW_CONNECTION_TYPES, FLOW_NODE_TYPES, classifyRuleSymbol } from '../epc/constants'
import type {
  FidelityDiffReport,
  FidelityDiffRow,
  FidelityExpectationDoc,
  GateExpectation,
  NoteExpectation,
  SatelliteExpectation,
  SpineStep
} from './expectationTypes'

const NUMBERING_ATTRIBUTE_TYPES = new Set(['AT_PROC_CODE', 'AT_ID'])

function normalizeColor(raw: string | null): string | null {
  return occurrenceColorToCss(raw) ?? null
}

function getNameEn(names: ArisLocalizedValue): string {
  return (
    names.values['en'] ??
    names.values['en-US'] ??
    names.fallback ??
    Object.values(names.values)[0] ??
    ''
  )
}

function getEpcNameEn(names: Readonly<Record<string, string>>): string {
  return names['en'] ?? names['en-US'] ?? Object.values(names)[0] ?? ''
}

function findAttributeText(
  sourceIndex: ArisSourceIndexLike,
  ownerId: string,
  attributeType: string
): string | null {
  for (const attribute of sourceIndex.attributes) {
    if (attribute.parsed.ownerSourceId !== ownerId) continue
    if (attribute.parsed.attributeType !== attributeType) continue
    for (const value of attribute.parsed.values) {
      const text = value.text.trim()
      if (text) return text
    }
  }
  return null
}

function extractNumbering(
  document: ArisWorkingDocument,
  occurrence: ArisObjectOccurrence
): string | null {
  const attributeType = occurrence.attributeOccurrences
    .map((attr) => attr.attributeType)
    .find((type) => NUMBERING_ATTRIBUTE_TYPES.has(type))
  if (attributeType) {
    const fromOccurrence = findAttributeText(document.sourceIndex, occurrence.id, attributeType)
    if (fromOccurrence) return fromOccurrence
  }
  const definition = document.objectDefinitions.get(occurrence.definitionId)
  if (definition) {
    for (const attr of definition.attributes) {
      if (attr.type === 'AT_ID' || attr.type === 'AT_PROC_CODE') {
        const text = attr.values[0]?.text.trim()
        if (text) return text
      }
    }
  }
  return null
}

function buildSpineStep(
  document: ArisWorkingDocument,
  occurrence: ArisObjectOccurrence,
  objectType: string
): SpineStep {
  const kind: SpineStep['kind'] =
    objectType === 'OT_FUNC' ? 'function' : objectType === 'OT_EVT' ? 'event' : 'rule'
  const definition = document.objectDefinitions.get(occurrence.definitionId)
  const nameEn = definition ? getNameEn(definition.names) : ''
  return {
    kind,
    nameEn,
    numbering: extractNumbering(document, occurrence),
    symbolNum: occurrence.symbol,
    fill: normalizeColor(occurrence.style.fillColor)
  }
}

function buildSpine(
  document: ArisWorkingDocument,
  model: ArisModel,
  index: FlowGraphIndex
): SpineStep[] {
  const occurrenceById = new Map<string, ArisObjectOccurrence>()
  for (const occurrence of model.occurrences) occurrenceById.set(occurrence.id, occurrence)

  const centerX = (occurrenceId: string): number => {
    const occurrence = occurrenceById.get(occurrenceId)
    if (!occurrence) return 0
    return occurrence.bounds.x + occurrence.bounds.width / 2
  }

  const flowNodeIds = new Set(
    index.graph.nodes.filter((node) => FLOW_NODE_TYPES.has(node.objectType)).map((node) => node.id)
  )
  const inDegree = new Map<string, number>()
  for (const nodeId of flowNodeIds) inDegree.set(nodeId, 0)
  for (const edge of index.flowEdges) {
    if (!flowNodeIds.has(edge.source) || !flowNodeIds.has(edge.target)) continue
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
  }

  const queue: string[] = []
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) queue.push(nodeId)
  }
  queue.sort((a, b) => centerX(a) - centerX(b))

  const visited = new Set<string>()
  const spine: SpineStep[] = []

  while (queue.length > 0) {
    const nodeId = queue.shift()!
    if (visited.has(nodeId)) continue
    visited.add(nodeId)
    const node = index.nodeById.get(nodeId)
    const occurrence = occurrenceById.get(nodeId)
    if (!node || !occurrence) continue
    spine.push(buildSpineStep(document, occurrence, node.objectType))

    const outgoing = index.flowEdgesBySource.get(nodeId) ?? []
    const successors = outgoing
      .filter((edge) => flowNodeIds.has(edge.target))
      .map((edge) => edge.target)
    for (const successor of successors) {
      const nextDegree = (inDegree.get(successor) ?? 1) - 1
      inDegree.set(successor, nextDegree)
      if (nextDegree === 0 && !visited.has(successor)) queue.push(successor)
    }
    queue.sort((a, b) => centerX(a) - centerX(b))
  }

  return spine
}

function raciForConnectionType(connectionType: string): 'R' | 'A' | 'C' | 'I' | null {
  if (connectionType === 'CT_EXEC_1' || connectionType === 'CT_EXEC_2') return 'R'
  if (connectionType === 'CT_DECID_ON') return 'A'
  if (connectionType === 'CT_MUST_BE_CONSLT_ABT_1') return 'C'
  if (connectionType === 'CT_MUST_BE_INFO_ABT_1') return 'I'
  return null
}

function buildSatellites(
  document: ArisWorkingDocument,
  model: ArisModel
): Record<string, SatelliteExpectation[]> {
  const satellites: Record<string, SatelliteExpectation[]> = {}

  for (const functionOccurrence of model.occurrences) {
    const functionDefinition = document.objectDefinitions.get(functionOccurrence.definitionId)
    if (!functionDefinition || functionDefinition.type !== 'OT_FUNC') continue

    const functionName = getNameEn(functionDefinition.names)
    const functionCenterX = functionOccurrence.bounds.x + functionOccurrence.bounds.width / 2
    const list: SatelliteExpectation[] = []

    for (const connection of model.connectionOccurrences) {
      const connectionDefinition = document.connectionDefinitions.get(connection.definitionId)
      if (!connectionDefinition) continue
      if (FLOW_CONNECTION_TYPES.has(connectionDefinition.type)) continue

      let satelliteOccurrence: ArisObjectOccurrence | null = null
      if (connection.sourceOccurrenceId === functionOccurrence.id) {
        satelliteOccurrence = occurrenceById(model, connection.targetOccurrenceId)
      } else if (connection.targetOccurrenceId === functionOccurrence.id) {
        satelliteOccurrence = occurrenceById(model, connection.sourceOccurrenceId)
      }
      if (!satelliteOccurrence) continue

      const satelliteDefinition = document.objectDefinitions.get(satelliteOccurrence.definitionId)
      if (!satelliteDefinition) continue
      if (FLOW_NODE_TYPES.has(satelliteDefinition.type)) continue

      const satelliteCenterX = satelliteOccurrence.bounds.x + satelliteOccurrence.bounds.width / 2
      const side = satelliteCenterX < functionCenterX ? 'left' : 'right'

      list.push({
        nameEn: getNameEn(satelliteDefinition.names),
        objectType: satelliteDefinition.type,
        side,
        connectionType: connectionDefinition.type,
        raci: raciForConnectionType(connectionDefinition.type),
        symbolNum: satelliteOccurrence.symbol,
        fill: normalizeColor(satelliteOccurrence.style.fillColor)
      })
    }

    if (list.length > 0) satellites[functionName] = list
  }

  return satellites
}

function occurrenceById(model: ArisModel, occurrenceId: string): ArisObjectOccurrence | null {
  return model.occurrences.find((occurrence) => occurrence.id === occurrenceId) ?? null
}

function buildGates(model: ArisModel, index: FlowGraphIndex): GateExpectation[] {
  const occurrenceById = new Map<string, ArisObjectOccurrence>()
  for (const occurrence of model.occurrences) occurrenceById.set(occurrence.id, occurrence)

  const gates: GateExpectation[] = []

  for (const node of index.graph.nodes) {
    if (node.objectType !== 'OT_RULE') continue
    const operator = classifyRuleSymbol(node.symbolType)
    if (operator === 'unknown') continue

    const outgoing = index.flowEdgesBySource.get(node.id) ?? []
    const outgoingToFlow = outgoing.filter((edge) => {
      const target = index.nodeById.get(edge.target)
      return target && FLOW_NODE_TYPES.has(target.objectType)
    })
    if (outgoingToFlow.length === 0) continue

    const incoming = index.flowEdgesByTarget.get(node.id) ?? []
    const predecessorEdge = incoming.find((edge) => {
      const source = index.nodeById.get(edge.source)
      return source && FLOW_NODE_TYPES.has(source.objectType)
    })
    if (!predecessorEdge) continue
    const predecessor = index.nodeById.get(predecessorEdge.source)
    if (!predecessor) continue
    const afterNameEn = getEpcNameEn(predecessor.names)

    const branchFirst = outgoingToFlow
      .map((edge) => {
        const target = index.nodeById.get(edge.target)!
        const occurrence = occurrenceById.get(edge.target)
        return {
          name: getEpcNameEn(target.names),
          centerX: occurrence ? occurrence.bounds.x + occurrence.bounds.width / 2 : 0
        }
      })
      .sort((a, b) => a.centerX - b.centerX)
      .map((branch) => branch.name)

    gates.push({ operator, afterNameEn, branchFirstNamesEn: branchFirst })
  }

  return gates
}

function buildNotes(model: ArisModel): NoteExpectation[] {
  return model.freeText.map((freeText) => {
    const contains =
      freeText.text.fallback ??
      freeText.text.values['en'] ??
      freeText.text.values['en-US'] ??
      Object.values(freeText.text.values)[0] ??
      ''
    return { contains }
  })
}

function buildCounts(
  document: ArisWorkingDocument,
  model: ArisModel
): FidelityExpectationDoc['counts'] {
  let functions = 0
  let events = 0
  let rules = 0
  for (const occurrence of model.occurrences) {
    const definition = document.objectDefinitions.get(occurrence.definitionId)
    if (!definition) continue
    if (definition.type === 'OT_FUNC') functions += 1
    else if (definition.type === 'OT_EVT') events += 1
    else if (definition.type === 'OT_RULE') rules += 1
  }
  return {
    functions,
    events,
    rules,
    connections: model.connectionOccurrences.length
  }
}

function spineKey(step: SpineStep): string {
  return `${step.kind}:${step.nameEn}${step.numbering ? ` (${step.numbering})` : ''}`
}

function spineIdentity(step: SpineStep): string {
  return `${step.kind}|${step.nameEn}|${step.numbering ?? ''}|${step.symbolNum ?? ''}|${step.fill ?? ''}`
}

function spineStepEqual(a: SpineStep, b: SpineStep): boolean {
  return (
    a.kind === b.kind &&
    a.nameEn === b.nameEn &&
    a.numbering === b.numbering &&
    a.symbolNum === b.symbolNum &&
    a.fill === b.fill
  )
}

function spineMultisetEqual(a: readonly SpineStep[], b: readonly SpineStep[]): boolean {
  if (a.length !== b.length) return false
  const counts = new Map<string, number>()
  for (const step of a) {
    const key = spineIdentity(step)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const step of b) {
    const key = spineIdentity(step)
    const count = counts.get(key) ?? 0
    if (count === 0) return false
    counts.set(key, count - 1)
  }
  return true
}

function diffSpine(
  expected: readonly SpineStep[],
  actual: readonly SpineStep[]
): FidelityDiffRow[] {
  const rows: FidelityDiffRow[] = []

  if (
    expected.length === actual.length &&
    expected.every((step, index) => spineStepEqual(step, actual[index]))
  ) {
    return rows
  }

  if (spineMultisetEqual(expected, actual)) {
    rows.push({
      category: 'spine',
      status: 'mismatched',
      expected: expected.map(spineKey).join(' → '),
      actual: actual.map(spineKey).join(' → '),
      where: 'spine sequence'
    })
    return rows
  }

  const minLength = Math.min(expected.length, actual.length)
  for (let index = 0; index < minLength; index += 1) {
    const exp = expected[index]
    const act = actual[index]
    if (spineStepEqual(exp, act)) continue

    if (exp.kind !== act.kind) {
      rows.push({
        category: 'spine',
        status: 'mismatched',
        expected: exp.kind,
        actual: act.kind,
        where: `spine[${index}].kind`
      })
    }
    if (exp.nameEn !== act.nameEn) {
      rows.push({
        category: 'spine',
        status: 'mismatched',
        expected: exp.nameEn,
        actual: act.nameEn,
        where: `spine[${index}].nameEn`
      })
    }
    if (exp.numbering !== act.numbering) {
      rows.push({
        category: 'numbering',
        status: 'mismatched',
        expected: exp.numbering,
        actual: act.numbering,
        where: `spine[${index}].numbering`
      })
    }
    if (exp.symbolNum !== act.symbolNum) {
      rows.push({
        category: 'symbol',
        status: 'mismatched',
        expected: exp.symbolNum,
        actual: act.symbolNum,
        where: `spine[${index}].symbolNum`
      })
    }
    if (exp.fill !== act.fill) {
      rows.push({
        category: 'color',
        status: 'mismatched',
        expected: exp.fill,
        actual: act.fill,
        where: `spine[${index}].fill`
      })
    }
  }

  for (let index = minLength; index < expected.length; index += 1) {
    rows.push({
      category: 'spine',
      status: 'missing',
      expected: spineKey(expected[index]),
      actual: null,
      where: `spine[${index}]`
    })
  }
  for (let index = minLength; index < actual.length; index += 1) {
    rows.push({
      category: 'spine',
      status: 'extra',
      expected: null,
      actual: spineKey(actual[index]),
      where: `spine[${index}]`
    })
  }

  return rows
}

function satelliteKey(satellite: SatelliteExpectation): string {
  return `${satellite.objectType}:${satellite.nameEn}`
}

function diffSatelliteList(
  functionName: string,
  expected: readonly SatelliteExpectation[],
  actual: readonly SatelliteExpectation[]
): FidelityDiffRow[] {
  const rows: FidelityDiffRow[] = []
  const matchedActual = new Set<number>()

  for (const exp of expected) {
    const matchIndex = actual.findIndex(
      (act, index) =>
        !matchedActual.has(index) &&
        act.nameEn === exp.nameEn &&
        act.objectType === exp.objectType &&
        act.side === exp.side
    )
    if (matchIndex === -1) {
      rows.push({
        category: 'satellite',
        status: 'missing',
        expected: satelliteKey(exp),
        actual: null,
        where: `satellite:${functionName}:${exp.side}:${exp.nameEn}`
      })
      continue
    }
    matchedActual.add(matchIndex)
    const act = actual[matchIndex]

    if (exp.connectionType !== act.connectionType || exp.raci !== act.raci) {
      rows.push({
        category: 'satellite',
        status: 'mismatched',
        expected: `${exp.connectionType}|${exp.raci ?? '-'}`,
        actual: `${act.connectionType}|${act.raci ?? '-'}`,
        where: `satellite:${functionName}:${exp.side}:${exp.nameEn}`
      })
    }
    if (exp.symbolNum !== act.symbolNum) {
      rows.push({
        category: 'symbol',
        status: 'mismatched',
        expected: exp.symbolNum,
        actual: act.symbolNum,
        where: `satellite:${functionName}:${exp.side}:${exp.nameEn}:symbol`
      })
    }
    if (exp.fill !== act.fill) {
      rows.push({
        category: 'color',
        status: 'mismatched',
        expected: exp.fill,
        actual: act.fill,
        where: `satellite:${functionName}:${exp.side}:${exp.nameEn}:fill`
      })
    }
  }

  for (let index = 0; index < actual.length; index += 1) {
    if (matchedActual.has(index)) continue
    const act = actual[index]
    rows.push({
      category: 'satellite',
      status: 'extra',
      expected: null,
      actual: satelliteKey(act),
      where: `satellite:${functionName}:${act.side}:${act.nameEn}`
    })
  }

  return rows
}

function diffSatellites(
  expected: Readonly<Record<string, readonly SatelliteExpectation[]>>,
  actual: Readonly<Record<string, readonly SatelliteExpectation[]>>
): FidelityDiffRow[] {
  const rows: FidelityDiffRow[] = []
  const functionNames = new Set([...Object.keys(expected), ...Object.keys(actual)])
  for (const functionName of functionNames) {
    rows.push(
      ...diffSatelliteList(functionName, expected[functionName] ?? [], actual[functionName] ?? [])
    )
  }
  return rows
}

function gateKey(gate: GateExpectation): string {
  return `${gate.operator} after "${gate.afterNameEn}" → [${gate.branchFirstNamesEn.join(', ')}]`
}

function diffGates(
  expected: readonly GateExpectation[],
  actual: readonly GateExpectation[]
): FidelityDiffRow[] {
  const rows: FidelityDiffRow[] = []
  const matchedActual = new Set<number>()

  for (const exp of expected) {
    const expectedBranches = [...exp.branchFirstNamesEn].sort().join(',')
    const matchIndex = actual.findIndex(
      (act, index) =>
        !matchedActual.has(index) &&
        act.afterNameEn === exp.afterNameEn &&
        [...act.branchFirstNamesEn].sort().join(',') === expectedBranches
    )
    if (matchIndex === -1) {
      rows.push({
        category: 'gate',
        status: 'missing',
        expected: gateKey(exp),
        actual: null,
        where: `gate:after ${exp.afterNameEn}`
      })
      continue
    }
    matchedActual.add(matchIndex)
    const act = actual[matchIndex]
    if (exp.operator !== act.operator) {
      rows.push({
        category: 'gate',
        status: 'mismatched',
        expected: exp.operator,
        actual: act.operator,
        where: `gate:after ${exp.afterNameEn}`
      })
    }
  }

  for (let index = 0; index < actual.length; index += 1) {
    if (matchedActual.has(index)) continue
    const act = actual[index]
    rows.push({
      category: 'gate',
      status: 'extra',
      expected: null,
      actual: gateKey(act),
      where: `gate:after ${act.afterNameEn}`
    })
  }

  return rows
}

function diffNotes(
  expected: readonly NoteExpectation[],
  actual: readonly NoteExpectation[]
): FidelityDiffRow[] {
  const rows: FidelityDiffRow[] = []
  const matchedActual = new Set<number>()

  for (const exp of expected) {
    const matchIndex = actual.findIndex(
      (act, index) => !matchedActual.has(index) && act.contains.includes(exp.contains)
    )
    if (matchIndex === -1) {
      rows.push({
        category: 'note',
        status: 'missing',
        expected: exp.contains,
        actual: null,
        where: 'notes'
      })
    } else {
      matchedActual.add(matchIndex)
    }
  }

  for (let index = 0; index < actual.length; index += 1) {
    if (matchedActual.has(index)) continue
    rows.push({
      category: 'note',
      status: 'extra',
      expected: null,
      actual: actual[index].contains,
      where: 'notes'
    })
  }

  return rows
}

function diffCounts(
  expected: FidelityExpectationDoc['counts'],
  actual: FidelityExpectationDoc['counts']
): FidelityDiffRow[] {
  const rows: FidelityDiffRow[] = []
  const keys: (keyof FidelityExpectationDoc['counts'])[] = [
    'functions',
    'events',
    'rules',
    'connections'
  ]
  for (const key of keys) {
    if (expected[key] !== actual[key]) {
      rows.push({
        category: 'count',
        status: 'mismatched',
        expected: String(expected[key]),
        actual: String(actual[key]),
        where: `counts.${key}`
      })
    }
  }
  return rows
}

function deriveActual(
  document: ArisWorkingDocument,
  model: ArisModel
): Pick<FidelityExpectationDoc, 'spine' | 'satellites' | 'gates' | 'notes' | 'counts'> {
  const graph = toEpcGraph({
    modelId: model.id,
    objectOccurrences: model.occurrences,
    objectDefinitionById: document.objectDefinitions,
    connectionOccurrences: model.connectionOccurrences,
    connectionDefinitionById: document.connectionDefinitions
  })
  const index = buildFlowGraphIndex(graph)

  return {
    spine: buildSpine(document, model, index),
    satellites: buildSatellites(document, model),
    gates: buildGates(model, index),
    notes: buildNotes(model),
    counts: buildCounts(document, model)
  }
}

function finalize(rows: FidelityDiffRow[]): FidelityDiffReport {
  const byCategory: Record<string, number> = {}
  for (const row of rows) {
    byCategory[row.category] = (byCategory[row.category] ?? 0) + 1
  }
  return Object.freeze({
    rows: Object.freeze(rows),
    byCategory: Object.freeze(byCategory),
    pass: rows.length === 0
  })
}

export function compareModelToExpectation(
  document: ArisWorkingDocument,
  modelId: string,
  expected: FidelityExpectationDoc
): FidelityDiffReport {
  const model = document.models.get(modelId)
  if (!model) {
    return finalize([
      {
        category: 'spine',
        status: 'missing',
        expected: expected.nameEn,
        actual: null,
        where: `model:${modelId}`
      }
    ])
  }

  const actual = deriveActual(document, model)
  const rows: FidelityDiffRow[] = [
    ...diffSpine(expected.spine, actual.spine),
    ...diffSatellites(expected.satellites, actual.satellites),
    ...diffGates(expected.gates, actual.gates),
    ...diffNotes(expected.notes, actual.notes),
    ...diffCounts(expected.counts, actual.counts)
  ]

  return finalize(rows)
}

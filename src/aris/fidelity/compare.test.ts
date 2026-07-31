import { describe, expect, it } from 'vitest'
import type {
  ArisConnectionDefinition,
  ArisConnectionOccurrence,
  ArisFreeText,
  ArisLocalizedValue,
  ArisModel,
  ArisObjectDefinition,
  ArisObjectOccurrence,
  ArisOccurrenceStyle,
  ArisSourceIndexLike,
  ArisWorkingDocument
} from '../model/types'
import { compareModelToExpectation } from './compare'
import type {
  FidelityExpectationDoc,
  GateExpectation,
  SatelliteExpectation,
  SpineStep
} from './expectationTypes'

function loc(en: string): ArisLocalizedValue {
  return Object.freeze({ values: Object.freeze({ en }), fallback: en })
}

function objectDefinition(
  id: string,
  type: string,
  name: string,
  opts: Partial<Omit<ArisObjectDefinition, 'id' | 'type' | 'names'>> = {}
): ArisObjectDefinition {
  return Object.freeze({
    id,
    type,
    defaultSymbol: opts.defaultSymbol ?? null,
    names: loc(name),
    attributes: opts.attributes ?? [],
    linkedModelIds: opts.linkedModelIds ?? [],
    rawAttributes: opts.rawAttributes ?? {}
  })
}

function objectOccurrence(
  id: string,
  definitionId: string,
  modelId: string,
  symbol: string,
  x: number,
  y: number,
  width: number,
  height: number,
  opts: Partial<
    Omit<ArisObjectOccurrence, 'id' | 'definitionId' | 'modelId' | 'symbol' | 'bounds' | 'style'>
  > & { style?: Partial<ArisOccurrenceStyle> } = {}
): ArisObjectOccurrence {
  return Object.freeze({
    id,
    definitionId,
    modelId,
    symbol,
    bounds: Object.freeze({ x, y, width, height }),
    style: Object.freeze({
      symbol: opts.style?.symbol ?? symbol,
      fillColor: opts.style?.fillColor ?? null,
      strokeColor: opts.style?.strokeColor ?? null,
      strokeWidth: opts.style?.strokeWidth ?? null,
      lineStyle: opts.style?.lineStyle ?? null,
      fontStyleSheetId: opts.style?.fontStyleSheetId ?? null,
      zOrder: opts.style?.zOrder ?? null
    }),
    attributeOccurrences: opts.attributeOccurrences ?? [],
    rawAttributes: opts.rawAttributes ?? {}
  })
}

function connectionDefinition(
  id: string,
  type: string,
  fromObjectDefinitionId: string,
  toObjectDefinitionId: string
): ArisConnectionDefinition {
  return Object.freeze({
    id,
    type,
    fromObjectDefinitionId,
    toObjectDefinitionId,
    names: loc(''),
    attributes: []
  })
}

function connectionOccurrence(
  id: string,
  definitionId: string,
  modelId: string,
  sourceOccurrenceId: string,
  targetOccurrenceId: string
): ArisConnectionOccurrence {
  return Object.freeze({
    id,
    definitionId,
    modelId,
    sourceOccurrenceId,
    targetOccurrenceId,
    route: [],
    style: Object.freeze({
      color: null,
      width: null,
      lineStyle: null,
      srcArrow: null,
      tgtArrow: null,
      fontStyleSheetId: null,
      zOrder: null
    }),
    attributeOccurrences: [],
    rawAttributes: {}
  })
}

function freeText(id: string, modelId: string, text: string): ArisFreeText {
  return Object.freeze({
    id,
    modelId,
    definitionId: null,
    text: loc(text),
    attributes: [],
    bounds: Object.freeze({ x: 0, y: 0, width: 100, height: 20 }),
    style: Object.freeze({
      symbol: null,
      fillColor: null,
      strokeColor: null,
      strokeWidth: null,
      lineStyle: null,
      fontStyleSheetId: null,
      zOrder: null
    })
  })
}

function makeDocument(
  model: ArisModel,
  objectDefinitions: readonly ArisObjectDefinition[],
  connectionDefinitions: readonly ArisConnectionDefinition[]
): ArisWorkingDocument {
  const sourceIndex: ArisSourceIndexLike = Object.freeze({
    database: null,
    models: new Map(),
    objectDefinitions: new Map(),
    objectOccurrences: new Map(),
    connectionDefinitions: new Map(),
    connectionOccurrences: new Map(),
    attributes: [],
    attributeOccurrences: [],
    lanes: new Map(),
    freeText: new Map(),
    freeTextOccurrences: [],
    styles: { fontStyleSheets: new Map() },
    unknownRecords: [],
    routePoints: []
  })

  return Object.freeze({
    database: Object.freeze({
      databaseName: 'Test',
      createDate: null,
      createTime: null,
      userName: null,
      arisExeVersion: null
    }),
    models: new Map([[model.id, model]]),
    objectDefinitions: new Map(objectDefinitions.map((definition) => [definition.id, definition])),
    connectionDefinitions: new Map(
      connectionDefinitions.map((definition) => [definition.id, definition])
    ),
    styleCatalog: Object.freeze({ styles: new Map() }),
    sourceIndex,
    revision: 0
  })
}

function makeModel(
  occurrences: readonly ArisObjectOccurrence[],
  connectionOccurrences: readonly ArisConnectionOccurrence[],
  freeTexts: readonly ArisFreeText[] = []
): ArisModel {
  return Object.freeze({
    id: 'model-1',
    type: 'MT_EEPC',
    names: loc('Test model'),
    attributes: [],
    occurrences,
    connectionOccurrences,
    lanes: [],
    freeText: freeTexts,
    attachments: [],
    layout: Object.freeze({
      scale: null,
      gridSize: null,
      backColor: null,
      printScale: null,
      curveRadius: null,
      arcRadius: null
    }),
    unsupported: false,
    rawSourceRecord: null
  })
}

const BASE_SPINE: SpineStep[] = [
  { kind: 'event', nameEn: 'Start', numbering: null, symbolNum: 'ST_EV', fill: '#dcbbed' },
  {
    kind: 'function',
    nameEn: 'First step',
    numbering: '01',
    symbolNum: 'ST_FUNC',
    fill: '#339900'
  },
  {
    kind: 'function',
    nameEn: 'Second step',
    numbering: '02',
    symbolNum: 'ST_FUNC',
    fill: '#339900'
  },
  { kind: 'event', nameEn: 'End', numbering: null, symbolNum: 'ST_EV', fill: '#dcbbed' }
]

const BASE_SATELLITES: Record<string, readonly SatelliteExpectation[]> = {
  'First step': [
    {
      nameEn: 'App System',
      objectType: 'OT_APPL_SYS',
      side: 'left',
      connectionType: 'CT_SUPP_3',
      raci: null,
      symbolNum: 'ST_APPL_SYS',
      fill: '#000099'
    }
  ]
}

function baseExpectation(): FidelityExpectationDoc {
  return Object.freeze({
    modelKey: 'test-model',
    modelIdHint: 'model-1',
    nameEn: 'Test model',
    spine: BASE_SPINE,
    satellites: BASE_SATELLITES,
    gates: [],
    notes: [{ contains: 'Important note' }],
    counts: { functions: 2, events: 2, rules: 0, connections: 4 }
  })
}

function buildBaseDocument(): ArisWorkingDocument {
  const definitions: ArisObjectDefinition[] = [
    objectDefinition('od-start', 'OT_EVT', 'Start'),
    objectDefinition('od-f1', 'OT_FUNC', 'First step', {
      attributes: [{ type: 'AT_ID', values: [{ localeId: 'en', text: '01' }] }]
    }),
    objectDefinition('od-f2', 'OT_FUNC', 'Second step', {
      attributes: [{ type: 'AT_ID', values: [{ localeId: 'en', text: '02' }] }]
    }),
    objectDefinition('od-end', 'OT_EVT', 'End'),
    objectDefinition('od-app', 'OT_APPL_SYS', 'App System')
  ]

  const occurrences: ArisObjectOccurrence[] = [
    objectOccurrence('occ-start', 'od-start', 'model-1', 'ST_EV', 100, 10, 40, 30, {
      style: { fillColor: '#dcbbed' }
    }),
    objectOccurrence('occ-f1', 'od-f1', 'model-1', 'ST_FUNC', 80, 60, 80, 40, {
      style: { fillColor: '#339900' }
    }),
    objectOccurrence('occ-f2', 'od-f2', 'model-1', 'ST_FUNC', 80, 120, 80, 40, {
      style: { fillColor: '#339900' }
    }),
    objectOccurrence('occ-end', 'od-end', 'model-1', 'ST_EV', 100, 180, 40, 30, {
      style: { fillColor: '#dcbbed' }
    }),
    objectOccurrence('occ-app', 'od-app', 'model-1', 'ST_APPL_SYS', 10, 70, 40, 30, {
      style: { fillColor: '#000099' }
    })
  ]

  const connectionDefinitions: ArisConnectionDefinition[] = [
    connectionDefinition('cd1', 'CT_ACTIV_1', 'od-start', 'od-f1'),
    connectionDefinition('cd2', 'CT_CRT_1', 'od-f1', 'od-f2'),
    connectionDefinition('cd3', 'CT_ACTIV_1', 'od-f2', 'od-end'),
    connectionDefinition('cd4', 'CT_SUPP_3', 'od-app', 'od-f1')
  ]

  const connectionOccurrences: ArisConnectionOccurrence[] = [
    connectionOccurrence('cx1', 'cd1', 'model-1', 'occ-start', 'occ-f1'),
    connectionOccurrence('cx2', 'cd2', 'model-1', 'occ-f1', 'occ-f2'),
    connectionOccurrence('cx3', 'cd3', 'model-1', 'occ-f2', 'occ-end'),
    connectionOccurrence('cx4', 'cd4', 'model-1', 'occ-app', 'occ-f1')
  ]

  const model = makeModel(occurrences, connectionOccurrences, [
    freeText('ft1', 'model-1', 'Important note')
  ])
  return makeDocument(model, definitions, connectionDefinitions)
}

describe('compareModelToExpectation', () => {
  it('passes when the document matches the expectation', () => {
    const document = buildBaseDocument()
    const report = compareModelToExpectation(document, 'model-1', baseExpectation())
    expect(report.pass).toBe(true)
    expect(report.rows).toHaveLength(0)
  })

  it('reports one spine mismatch for a renamed function', () => {
    const document = buildBaseDocument()
    const expectation = baseExpectation()
    const renamedSpine: SpineStep[] = expectation.spine.map((step, index) =>
      index === 1 ? { ...step, nameEn: 'Renamed step' } : step
    )
    const report = compareModelToExpectation(document, 'model-1', {
      ...expectation,
      spine: renamedSpine
    })
    expect(report.pass).toBe(false)
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]).toMatchObject({
      category: 'spine',
      status: 'mismatched',
      expected: 'Renamed step',
      actual: 'First step',
      where: 'spine[1].nameEn'
    })
  })

  it('reports one satellite missing row when a satellite is absent', () => {
    const document = buildBaseDocument()
    const expectation = baseExpectation()
    const report = compareModelToExpectation(document, 'model-1', {
      ...expectation,
      satellites: {
        ...expectation.satellites,
        'First step': [
          ...expectation.satellites['First step'],
          {
            nameEn: 'Missing satellite',
            objectType: 'OT_ENT_TYPE',
            side: 'left',
            connectionType: 'CT_IS_INP_FOR',
            raci: null,
            symbolNum: 'ST_ENT_TYPE',
            fill: '#b6dce9'
          }
        ]
      }
    })
    expect(report.pass).toBe(false)
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]).toMatchObject({
      category: 'satellite',
      status: 'missing',
      where: 'satellite:First step:left:Missing satellite'
    })
  })

  it('reports one satellite mismatch for wrong RACI/connection type', () => {
    const document = buildBaseDocument()
    const expectation = baseExpectation()
    const report = compareModelToExpectation(document, 'model-1', {
      ...expectation,
      satellites: {
        'First step': [
          {
            ...expectation.satellites['First step'][0],
            connectionType: 'CT_EXEC_1',
            raci: 'R'
          }
        ]
      }
    })
    expect(report.pass).toBe(false)
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]).toMatchObject({
      category: 'satellite',
      status: 'mismatched',
      expected: 'CT_EXEC_1|R',
      actual: 'CT_SUPP_3|-',
      where: 'satellite:First step:left:App System'
    })
  })

  it('reports one color mismatch for a wrong fill', () => {
    const document = buildBaseDocument()
    const expectation = baseExpectation()
    const wrongFillSpine: SpineStep[] = expectation.spine.map((step, index) =>
      index === 1 ? { ...step, fill: '#ff0000' } : step
    )
    const report = compareModelToExpectation(document, 'model-1', {
      ...expectation,
      spine: wrongFillSpine
    })
    expect(report.pass).toBe(false)
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]).toMatchObject({
      category: 'color',
      status: 'mismatched',
      expected: '#ff0000',
      actual: '#339900',
      where: 'spine[1].fill'
    })
  })

  it('reports one spine mismatch for a reordered spine', () => {
    const document = buildBaseDocument()
    const expectation = baseExpectation()
    const reorderedSpine: SpineStep[] = [
      expectation.spine[0],
      expectation.spine[2],
      expectation.spine[1],
      expectation.spine[3]
    ]
    const report = compareModelToExpectation(document, 'model-1', {
      ...expectation,
      spine: reorderedSpine
    })
    expect(report.pass).toBe(false)
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]).toMatchObject({
      category: 'spine',
      status: 'mismatched',
      where: 'spine sequence'
    })
  })

  it('reports one count mismatch for wrong counts', () => {
    const document = buildBaseDocument()
    const expectation = baseExpectation()
    const report = compareModelToExpectation(document, 'model-1', {
      ...expectation,
      counts: { ...expectation.counts, functions: 3 }
    })
    expect(report.pass).toBe(false)
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]).toMatchObject({
      category: 'count',
      status: 'mismatched',
      expected: '3',
      actual: '2',
      where: 'counts.functions'
    })
  })
})

describe('compareModelToExpectation — gates', () => {
  function buildGatedDocument(): ArisWorkingDocument {
    const definitions: ArisObjectDefinition[] = [
      objectDefinition('od-start', 'OT_EVT', 'Start'),
      objectDefinition('od-f1', 'OT_FUNC', 'First step'),
      objectDefinition('od-rule', 'OT_RULE', 'Decision', { defaultSymbol: 'ST_OPR_XOR_1' }),
      objectDefinition('od-yes', 'OT_EVT', 'Approved'),
      objectDefinition('od-no', 'OT_EVT', 'Rejected'),
      objectDefinition('od-end', 'OT_EVT', 'End')
    ]

    const occurrences: ArisObjectOccurrence[] = [
      objectOccurrence('occ-start', 'od-start', 'model-1', 'ST_EV', 100, 10, 40, 30),
      objectOccurrence('occ-f1', 'od-f1', 'model-1', 'ST_FUNC', 80, 60, 80, 40),
      objectOccurrence('occ-rule', 'od-rule', 'model-1', 'ST_OPR_XOR_1', 100, 110, 40, 40),
      objectOccurrence('occ-yes', 'od-yes', 'model-1', 'ST_EV', 40, 170, 40, 30),
      objectOccurrence('occ-no', 'od-no', 'model-1', 'ST_EV', 160, 170, 40, 30),
      objectOccurrence('occ-end', 'od-end', 'model-1', 'ST_EV', 100, 230, 40, 30)
    ]

    const connectionDefinitions: ArisConnectionDefinition[] = [
      connectionDefinition('cd1', 'CT_ACTIV_1', 'od-start', 'od-f1'),
      connectionDefinition('cd2', 'CT_LEADS_TO_1', 'od-f1', 'od-rule'),
      connectionDefinition('cd3', 'CT_LEADS_TO_2', 'od-rule', 'od-yes'),
      connectionDefinition('cd4', 'CT_LEADS_TO_2', 'od-rule', 'od-no'),
      connectionDefinition('cd5', 'CT_ACTIV_1', 'od-yes', 'od-end'),
      connectionDefinition('cd6', 'CT_ACTIV_1', 'od-no', 'od-end')
    ]

    const connectionOccurrences: ArisConnectionOccurrence[] = [
      connectionOccurrence('cx1', 'cd1', 'model-1', 'occ-start', 'occ-f1'),
      connectionOccurrence('cx2', 'cd2', 'model-1', 'occ-f1', 'occ-rule'),
      connectionOccurrence('cx3', 'cd3', 'model-1', 'occ-rule', 'occ-yes'),
      connectionOccurrence('cx4', 'cd4', 'model-1', 'occ-rule', 'occ-no'),
      connectionOccurrence('cx5', 'cd5', 'model-1', 'occ-yes', 'occ-end'),
      connectionOccurrence('cx6', 'cd6', 'model-1', 'occ-no', 'occ-end')
    ]

    const model = makeModel(occurrences, connectionOccurrences)
    return makeDocument(model, definitions, connectionDefinitions)
  }

  // Depth-first preorder over the flow graph: after the geometrically-first branch (Approved) the
  // walk dives to its successor (End) before backtracking to the second branch (Rejected).
  const gateSpine: SpineStep[] = [
    { kind: 'event', nameEn: 'Start', numbering: null, symbolNum: 'ST_EV', fill: null },
    { kind: 'function', nameEn: 'First step', numbering: null, symbolNum: 'ST_FUNC', fill: null },
    { kind: 'rule', nameEn: 'Decision', numbering: null, symbolNum: 'ST_OPR_XOR_1', fill: null },
    { kind: 'event', nameEn: 'Approved', numbering: null, symbolNum: 'ST_EV', fill: null },
    { kind: 'event', nameEn: 'End', numbering: null, symbolNum: 'ST_EV', fill: null },
    { kind: 'event', nameEn: 'Rejected', numbering: null, symbolNum: 'ST_EV', fill: null }
  ]

  const gateGates: GateExpectation[] = [
    { operator: 'XOR', afterNameEn: 'First step', branchFirstNamesEn: ['Approved', 'Rejected'] }
  ]

  const gateExpectation: FidelityExpectationDoc = Object.freeze({
    modelKey: 'gate-model',
    modelIdHint: 'model-1',
    nameEn: 'Gate model',
    spine: gateSpine,
    satellites: {},
    gates: gateGates,
    notes: [],
    counts: { functions: 1, events: 4, rules: 1, connections: 6 }
  })

  it('passes when the gate model matches the expectation', () => {
    const document = buildGatedDocument()
    const report = compareModelToExpectation(document, 'model-1', gateExpectation)
    expect(report.pass).toBe(true)
    expect(report.rows).toHaveLength(0)
  })

  it('reports one gate mismatch for a swapped operator', () => {
    const document = buildGatedDocument()
    const report = compareModelToExpectation(document, 'model-1', {
      ...gateExpectation,
      gates: [
        { operator: 'AND', afterNameEn: 'First step', branchFirstNamesEn: ['Approved', 'Rejected'] }
      ]
    })
    expect(report.pass).toBe(false)
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]).toMatchObject({
      category: 'gate',
      status: 'mismatched',
      expected: 'AND',
      actual: 'XOR',
      where: 'gate:after First step'
    })
  })
})

describe('compareModelToExpectation — canonical flow, DFS walk, normalization', () => {
  const evt = (nameEn: string): SpineStep => ({
    kind: 'event',
    nameEn,
    numbering: null,
    symbolNum: 'ST_EV',
    fill: null
  })
  const fn = (nameEn: string): SpineStep => ({
    kind: 'function',
    nameEn,
    numbering: null,
    symbolNum: 'ST_FUNC',
    fill: null
  })

  it('follows CT_IS_PREDEC_OF_1 as a direct Function→Function sequence in the spine', () => {
    const definitions: ArisObjectDefinition[] = [
      objectDefinition('od-start', 'OT_EVT', 'Start'),
      objectDefinition('od-a', 'OT_FUNC', 'Step A'),
      objectDefinition('od-b', 'OT_FUNC', 'Step B'),
      objectDefinition('od-end', 'OT_EVT', 'End')
    ]
    const occurrences: ArisObjectOccurrence[] = [
      objectOccurrence('occ-start', 'od-start', 'model-1', 'ST_EV', 100, 10, 40, 30),
      objectOccurrence('occ-a', 'od-a', 'model-1', 'ST_FUNC', 80, 60, 80, 40),
      objectOccurrence('occ-b', 'od-b', 'model-1', 'ST_FUNC', 80, 120, 80, 40),
      objectOccurrence('occ-end', 'od-end', 'model-1', 'ST_EV', 100, 180, 40, 30)
    ]
    const connectionDefinitions: ArisConnectionDefinition[] = [
      connectionDefinition('cd1', 'CT_ACTIV_1', 'od-start', 'od-a'),
      connectionDefinition('cd2', 'CT_IS_PREDEC_OF_1', 'od-a', 'od-b'),
      connectionDefinition('cd3', 'CT_CRT_1', 'od-b', 'od-end')
    ]
    const connectionOccurrences: ArisConnectionOccurrence[] = [
      connectionOccurrence('cx1', 'cd1', 'model-1', 'occ-start', 'occ-a'),
      connectionOccurrence('cx2', 'cd2', 'model-1', 'occ-a', 'occ-b'),
      connectionOccurrence('cx3', 'cd3', 'model-1', 'occ-b', 'occ-end')
    ]
    const document = makeDocument(
      makeModel(occurrences, connectionOccurrences),
      definitions,
      connectionDefinitions
    )
    const expectation: FidelityExpectationDoc = {
      modelKey: 'predec',
      modelIdHint: 'model-1',
      nameEn: 'Predec model',
      spine: [evt('Start'), fn('Step A'), fn('Step B'), evt('End')],
      satellites: {},
      gates: [],
      notes: [],
      counts: { functions: 2, events: 2, rules: 0, connections: 3 }
    }
    const report = compareModelToExpectation(document, 'model-1', expectation)
    expect(report.rows, JSON.stringify(report.rows)).toHaveLength(0)
    expect(report.pass).toBe(true)
  })

  it('walks a return-loop cycle to completion, emitting every flow node exactly once', () => {
    const definitions: ArisObjectDefinition[] = [
      objectDefinition('od-start', 'OT_EVT', 'Start'),
      objectDefinition('od-a', 'OT_FUNC', 'Step A'),
      objectDefinition('od-b', 'OT_FUNC', 'Step B'),
      objectDefinition('od-end', 'OT_EVT', 'End')
    ]
    const occurrences: ArisObjectOccurrence[] = [
      objectOccurrence('occ-start', 'od-start', 'model-1', 'ST_EV', 100, 10, 40, 30),
      objectOccurrence('occ-a', 'od-a', 'model-1', 'ST_FUNC', 80, 60, 80, 40),
      objectOccurrence('occ-b', 'od-b', 'model-1', 'ST_FUNC', 80, 120, 80, 40),
      objectOccurrence('occ-end', 'od-end', 'model-1', 'ST_EV', 100, 180, 40, 30)
    ]
    // a → b → a is a cycle: neither a nor b is ever in-degree-0. A Kahn walk would stall; the
    // geometric DFS still emits all four nodes exactly once.
    const connectionDefinitions: ArisConnectionDefinition[] = [
      connectionDefinition('cd1', 'CT_ACTIV_1', 'od-start', 'od-a'),
      connectionDefinition('cd2', 'CT_IS_PREDEC_OF_1', 'od-a', 'od-b'),
      connectionDefinition('cd3', 'CT_IS_PREDEC_OF_1', 'od-b', 'od-a'),
      connectionDefinition('cd4', 'CT_CRT_1', 'od-b', 'od-end')
    ]
    const connectionOccurrences: ArisConnectionOccurrence[] = [
      connectionOccurrence('cx1', 'cd1', 'model-1', 'occ-start', 'occ-a'),
      connectionOccurrence('cx2', 'cd2', 'model-1', 'occ-a', 'occ-b'),
      connectionOccurrence('cx3', 'cd3', 'model-1', 'occ-b', 'occ-a'),
      connectionOccurrence('cx4', 'cd4', 'model-1', 'occ-b', 'occ-end')
    ]
    const document = makeDocument(
      makeModel(occurrences, connectionOccurrences),
      definitions,
      connectionDefinitions
    )
    const expectation: FidelityExpectationDoc = {
      modelKey: 'cycle',
      modelIdHint: 'model-1',
      nameEn: 'Cycle model',
      spine: [evt('Start'), fn('Step A'), fn('Step B'), evt('End')],
      satellites: {},
      gates: [],
      notes: [],
      counts: { functions: 2, events: 2, rules: 0, connections: 4 }
    }
    const report = compareModelToExpectation(document, 'model-1', expectation)
    expect(report.rows, JSON.stringify(report.rows)).toHaveLength(0)
    expect(report.pass).toBe(true)
  })

  it('does not treat a single-outgoing merge rule as a gate', () => {
    const definitions: ArisObjectDefinition[] = [
      objectDefinition('od-e1', 'OT_EVT', 'E1'),
      objectDefinition('od-e2', 'OT_EVT', 'E2'),
      objectDefinition('od-rule', 'OT_RULE', 'Merge', { defaultSymbol: 'ST_OPR_XOR_1' }),
      objectDefinition('od-f', 'OT_FUNC', 'After')
    ]
    const occurrences: ArisObjectOccurrence[] = [
      objectOccurrence('occ-e1', 'od-e1', 'model-1', 'ST_EV', 40, 10, 40, 30),
      objectOccurrence('occ-e2', 'od-e2', 'model-1', 'ST_EV', 160, 10, 40, 30),
      objectOccurrence('occ-rule', 'od-rule', 'model-1', 'ST_OPR_XOR_1', 100, 80, 40, 40),
      objectOccurrence('occ-f', 'od-f', 'model-1', 'ST_FUNC', 80, 140, 80, 40)
    ]
    const connectionDefinitions: ArisConnectionDefinition[] = [
      connectionDefinition('cd1', 'CT_IS_EVAL_BY_1', 'od-e1', 'od-rule'),
      connectionDefinition('cd2', 'CT_IS_EVAL_BY_1', 'od-e2', 'od-rule'),
      connectionDefinition('cd3', 'CT_ACTIV_1', 'od-rule', 'od-f')
    ]
    const connectionOccurrences: ArisConnectionOccurrence[] = [
      connectionOccurrence('cx1', 'cd1', 'model-1', 'occ-e1', 'occ-rule'),
      connectionOccurrence('cx2', 'cd2', 'model-1', 'occ-e2', 'occ-rule'),
      connectionOccurrence('cx3', 'cd3', 'model-1', 'occ-rule', 'occ-f')
    ]
    const document = makeDocument(
      makeModel(occurrences, connectionOccurrences),
      definitions,
      connectionDefinitions
    )
    const expectation: FidelityExpectationDoc = {
      modelKey: 'merge',
      modelIdHint: 'model-1',
      nameEn: 'Merge model',
      spine: [
        evt('E1'),
        { kind: 'rule', nameEn: 'Merge', numbering: null, symbolNum: 'ST_OPR_XOR_1', fill: null },
        fn('After'),
        evt('E2')
      ],
      satellites: {},
      gates: [],
      notes: [],
      counts: { functions: 1, events: 2, rules: 1, connections: 3 }
    }
    const report = compareModelToExpectation(document, 'model-1', expectation)
    expect(report.rows.filter((row) => row.category === 'gate')).toHaveLength(0)
    expect(report.rows, JSON.stringify(report.rows)).toHaveLength(0)
    expect(report.pass).toBe(true)
  })

  it('normalizes internal whitespace in names on both sides', () => {
    const definitions: ArisObjectDefinition[] = [
      objectDefinition('od-start', 'OT_EVT', 'Start'),
      objectDefinition('od-f', 'OT_FUNC', 'Login  to\tTAMM\nportal'),
      objectDefinition('od-end', 'OT_EVT', 'End')
    ]
    const occurrences: ArisObjectOccurrence[] = [
      objectOccurrence('occ-start', 'od-start', 'model-1', 'ST_EV', 100, 10, 40, 30),
      objectOccurrence('occ-f', 'od-f', 'model-1', 'ST_FUNC', 80, 60, 80, 40),
      objectOccurrence('occ-end', 'od-end', 'model-1', 'ST_EV', 100, 120, 40, 30)
    ]
    const connectionDefinitions: ArisConnectionDefinition[] = [
      connectionDefinition('cd1', 'CT_ACTIV_1', 'od-start', 'od-f'),
      connectionDefinition('cd2', 'CT_CRT_1', 'od-f', 'od-end')
    ]
    const connectionOccurrences: ArisConnectionOccurrence[] = [
      connectionOccurrence('cx1', 'cd1', 'model-1', 'occ-start', 'occ-f'),
      connectionOccurrence('cx2', 'cd2', 'model-1', 'occ-f', 'occ-end')
    ]
    const document = makeDocument(
      makeModel(occurrences, connectionOccurrences),
      definitions,
      connectionDefinitions
    )
    const expectation: FidelityExpectationDoc = {
      modelKey: 'ws',
      modelIdHint: 'model-1',
      nameEn: 'Whitespace model',
      // Authored with clean single spaces; the model carries irregular whitespace.
      spine: [evt('Start'), fn('Login to TAMM portal'), evt('End')],
      satellites: {},
      gates: [],
      notes: [],
      counts: { functions: 1, events: 2, rules: 0, connections: 2 }
    }
    const report = compareModelToExpectation(document, 'model-1', expectation)
    expect(report.rows, JSON.stringify(report.rows)).toHaveLength(0)
    expect(report.pass).toBe(true)
  })

  it('resolves the English caption of a bilingual object whose Arabic value is written first', () => {
    const bilingual: ArisLocalizedValue = Object.freeze({
      values: Object.freeze({
        '&LocaleId.AEar;': 'الاسم العربي',
        '&LocaleId.USen;': 'English Caption'
      }),
      fallback: 'الاسم العربي'
    })
    const definitions: ArisObjectDefinition[] = [
      objectDefinition('od-start', 'OT_EVT', 'Start'),
      Object.freeze({
        id: 'od-f',
        type: 'OT_FUNC',
        defaultSymbol: null,
        names: bilingual,
        attributes: [],
        linkedModelIds: [],
        rawAttributes: {}
      }),
      objectDefinition('od-end', 'OT_EVT', 'End')
    ]
    const occurrences: ArisObjectOccurrence[] = [
      objectOccurrence('occ-start', 'od-start', 'model-1', 'ST_EV', 100, 10, 40, 30),
      objectOccurrence('occ-f', 'od-f', 'model-1', 'ST_FUNC', 80, 60, 80, 40),
      objectOccurrence('occ-end', 'od-end', 'model-1', 'ST_EV', 100, 120, 40, 30)
    ]
    const connectionDefinitions: ArisConnectionDefinition[] = [
      connectionDefinition('cd1', 'CT_ACTIV_1', 'od-start', 'od-f'),
      connectionDefinition('cd2', 'CT_CRT_1', 'od-f', 'od-end')
    ]
    const connectionOccurrences: ArisConnectionOccurrence[] = [
      connectionOccurrence('cx1', 'cd1', 'model-1', 'occ-start', 'occ-f'),
      connectionOccurrence('cx2', 'cd2', 'model-1', 'occ-f', 'occ-end')
    ]
    const document = makeDocument(
      makeModel(occurrences, connectionOccurrences),
      definitions,
      connectionDefinitions
    )
    const expectation: FidelityExpectationDoc = {
      modelKey: 'bilingual',
      modelIdHint: 'model-1',
      nameEn: 'Bilingual model',
      spine: [evt('Start'), fn('English Caption'), evt('End')],
      satellites: {},
      gates: [],
      notes: [],
      counts: { functions: 1, events: 2, rules: 0, connections: 2 }
    }
    const report = compareModelToExpectation(document, 'model-1', expectation)
    expect(report.rows, JSON.stringify(report.rows)).toHaveLength(0)
    expect(report.pass).toBe(true)
  })

  it('drops whitespace-only free text so it is never a phantom note', () => {
    const definitions: ArisObjectDefinition[] = [
      objectDefinition('od-start', 'OT_EVT', 'Start'),
      objectDefinition('od-f', 'OT_FUNC', 'Only step'),
      objectDefinition('od-end', 'OT_EVT', 'End')
    ]
    const occurrences: ArisObjectOccurrence[] = [
      objectOccurrence('occ-start', 'od-start', 'model-1', 'ST_EV', 100, 10, 40, 30),
      objectOccurrence('occ-f', 'od-f', 'model-1', 'ST_FUNC', 80, 60, 80, 40),
      objectOccurrence('occ-end', 'od-end', 'model-1', 'ST_EV', 100, 120, 40, 30)
    ]
    const connectionDefinitions: ArisConnectionDefinition[] = [
      connectionDefinition('cd1', 'CT_ACTIV_1', 'od-start', 'od-f'),
      connectionDefinition('cd2', 'CT_CRT_1', 'od-f', 'od-end')
    ]
    const connectionOccurrences: ArisConnectionOccurrence[] = [
      connectionOccurrence('cx1', 'cd1', 'model-1', 'occ-start', 'occ-f'),
      connectionOccurrence('cx2', 'cd2', 'model-1', 'occ-f', 'occ-end')
    ]
    const model = makeModel(occurrences, connectionOccurrences, [
      freeText('ft-empty', 'model-1', '   \n\t  ')
    ])
    const document = makeDocument(model, definitions, connectionDefinitions)
    const expectation: FidelityExpectationDoc = {
      modelKey: 'empty-note',
      modelIdHint: 'model-1',
      nameEn: 'Empty note model',
      spine: [evt('Start'), fn('Only step'), evt('End')],
      satellites: {},
      gates: [],
      notes: [],
      counts: { functions: 1, events: 2, rules: 0, connections: 2 }
    }
    const report = compareModelToExpectation(document, 'model-1', expectation)
    expect(report.rows.filter((row) => row.category === 'note')).toHaveLength(0)
    expect(report.rows, JSON.stringify(report.rows)).toHaveLength(0)
    expect(report.pass).toBe(true)
  })
})

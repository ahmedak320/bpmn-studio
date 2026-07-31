import { describe, expect, it } from 'vitest'
import { buildConventionFindings, CONVENTION_RULE_IDS } from './validate'
import type {
  ArisAttribute,
  ArisConnectionDefinition,
  ArisConnectionOccurrence,
  ArisLocalizedValue,
  ArisModel,
  ArisModelType,
  ArisObjectDefinition,
  ArisObjectOccurrence,
  ArisWorkingDocument
} from '../model/types'

// --- minimal, fully-typed ArisWorkingDocument fixture builders -------------------------------
// `buildConventionFindings` takes the REAL `ArisWorkingDocument` shape (not the lighter
// `src/aris/chat` mirror types used elsewhere), so these helpers construct genuine
// `ArisModel` / `ArisObjectDefinition` / occurrence records with every mandatory field
// filled in with an inert default. Only the fields a rule actually reads vary per test.

function localized(en: string | null, ar: string | null = null): ArisLocalizedValue {
  const values: Record<string, string> = {}
  if (en !== null) values.en = en
  if (ar !== null) values.ar = ar
  return { values, fallback: en ?? ar }
}

function attr(type: string, text: string): ArisAttribute {
  return { type, values: [{ localeId: null, text }] }
}

const EMPTY_BOUNDS = Object.freeze({ x: 0, y: 0, width: 0, height: 0 })
const EMPTY_OCCURRENCE_STYLE = Object.freeze({
  symbol: null,
  fillColor: null,
  strokeColor: null,
  strokeWidth: null,
  lineStyle: null,
  fontStyleSheetId: null,
  zOrder: null
})
const EMPTY_CONNECTION_STYLE = Object.freeze({
  color: null,
  width: null,
  lineStyle: null,
  srcArrow: null,
  tgtArrow: null,
  fontStyleSheetId: null,
  zOrder: null
})
const EMPTY_LAYOUT = Object.freeze({
  scale: null,
  gridSize: null,
  backColor: null,
  printScale: null,
  curveRadius: null,
  arcRadius: null
})

function objectDefinition(
  id: string,
  type: string,
  name: string | null,
  attributes: readonly ArisAttribute[] = []
): ArisObjectDefinition {
  return {
    id,
    type,
    defaultSymbol: null,
    names: localized(name),
    attributes,
    linkedModelIds: [],
    rawAttributes: {}
  }
}

function objectOccurrence(
  id: string,
  definitionId: string,
  modelId: string,
  symbol = 'ST_FUNC'
): ArisObjectOccurrence {
  return {
    id,
    definitionId,
    modelId,
    symbol,
    bounds: EMPTY_BOUNDS,
    style: EMPTY_OCCURRENCE_STYLE,
    attributeOccurrences: [],
    rawAttributes: {}
  }
}

function connectionDefinition(
  id: string,
  type: string,
  fromObjectDefinitionId: string,
  toObjectDefinitionId: string
): ArisConnectionDefinition {
  return {
    id,
    type,
    fromObjectDefinitionId,
    toObjectDefinitionId,
    names: localized(null),
    attributes: []
  }
}

function connectionOccurrence(
  id: string,
  definitionId: string,
  modelId: string,
  sourceOccurrenceId: string,
  targetOccurrenceId: string
): ArisConnectionOccurrence {
  return {
    id,
    definitionId,
    modelId,
    sourceOccurrenceId,
    targetOccurrenceId,
    route: [],
    style: EMPTY_CONNECTION_STYLE,
    attributeOccurrences: [],
    rawAttributes: {}
  }
}

function model(
  id: string,
  occurrences: readonly ArisObjectOccurrence[],
  connectionOccurrences: readonly ArisConnectionOccurrence[],
  attributes: readonly ArisAttribute[] = [],
  type: ArisModelType = 'MT_EEPC'
): ArisModel {
  return {
    id,
    type,
    names: localized('Model'),
    attributes,
    occurrences,
    connectionOccurrences,
    lanes: [],
    freeText: [],
    attachments: [],
    layout: EMPTY_LAYOUT,
    unsupported: false,
    rawSourceRecord: null
  }
}

function workingDocument(
  models: readonly ArisModel[],
  objectDefinitions: readonly ArisObjectDefinition[],
  connectionDefinitions: readonly ArisConnectionDefinition[] = []
): ArisWorkingDocument {
  return {
    database: {
      databaseName: null,
      createDate: null,
      createTime: null,
      userName: null,
      arisExeVersion: null
    },
    models: new Map(models.map((entry) => [entry.id, entry])),
    objectDefinitions: new Map(objectDefinitions.map((entry) => [entry.id, entry])),
    connectionDefinitions: new Map(connectionDefinitions.map((entry) => [entry.id, entry])),
    styleCatalog: { styles: new Map() },
    sourceIndex: {
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
    },
    revision: 0
  }
}

describe('CONVENTION_RULE_IDS', () => {
  it('lists the five convention rule ids in run order', () => {
    expect(CONVENTION_RULE_IDS).toEqual([
      'conv.connection.illegal',
      'conv.function.missingIdentifier',
      'conv.function.noExecutor',
      'conv.model.missingAttribute',
      'conv.naming.hint'
    ])
  })
})

describe('conv.connection.illegal', () => {
  it('flags a connection type illegal for its from/to object types', () => {
    const startDef = objectDefinition('D_E1', 'OT_EVT', 'Start')
    const endDef = objectDefinition('D_E2', 'OT_EVT', 'End')
    const cxnDef = connectionDefinition('CD1', 'CT_ACTIV_1', 'D_E1', 'D_E2')
    const startOcc = objectOccurrence('O_E1', 'D_E1', 'M1', 'ST_EV')
    const endOcc = objectOccurrence('O_E2', 'D_E2', 'M1', 'ST_EV')
    const cxnOcc = connectionOccurrence('C1', 'CD1', 'M1', 'O_E1', 'O_E2')
    const m = model('M1', [startOcc, endOcc], [cxnOcc], [attr('AT_ID', 'AWF.01.01')])
    const document = workingDocument([m], [startDef, endDef], [cxnDef])

    const findings = buildConventionFindings(document)

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      ruleId: 'conv.connection.illegal',
      severity: 'warning',
      messageKey: 'aris.conv.finding.illegalConnection.body',
      messageParams: { from: 'OT_EVT', to: 'OT_EVT', type: 'CT_ACTIV_1' },
      nodeIds: ['C1'],
      edgeIds: [],
      modelId: 'M1'
    })
  })

  it('does not flag a legal EEPC control-flow connection', () => {
    const startDef = objectDefinition('D_E1', 'OT_EVT', 'Start')
    const funcDef = objectDefinition('D_F1', 'OT_FUNC', 'Do work', [attr('AT_ID', 'AWF.01.01')])
    const cxnDef = connectionDefinition('CD1', 'CT_ACTIV_1', 'D_E1', 'D_F1')
    const startOcc = objectOccurrence('O_E1', 'D_E1', 'M1', 'ST_EV')
    const funcOcc = objectOccurrence('O_F1', 'D_F1', 'M1', 'ST_FUNC')
    const cxnOcc = connectionOccurrence('C1', 'CD1', 'M1', 'O_E1', 'O_F1')
    const m = model('M1', [startOcc, funcOcc], [cxnOcc], [attr('AT_ID', 'AWF.01.01')])
    const document = workingDocument([m], [startDef, funcDef], [cxnDef])

    const findings = buildConventionFindings(document)

    expect(findings.filter((f) => f.ruleId === 'conv.connection.illegal')).toHaveLength(0)
  })
})

describe('conv.function.missingIdentifier', () => {
  it('flags a Function definition with no AT_ID attribute', () => {
    const funcDef = objectDefinition('D_FUNC', 'OT_FUNC', 'Do work') // no AT_ID
    const personDef = objectDefinition('D_PERS', 'OT_PERS', 'Reviewer')
    const cxnDef = connectionDefinition('CD1', 'CT_EXEC_1', 'D_PERS', 'D_FUNC')
    const funcOcc = objectOccurrence('O_FUNC', 'D_FUNC', 'M1', 'ST_FUNC')
    const personOcc = objectOccurrence('O_PERS', 'D_PERS', 'M1', 'ST_PERS_EXT')
    const cxnOcc = connectionOccurrence('C1', 'CD1', 'M1', 'O_PERS', 'O_FUNC')
    const m = model('M1', [funcOcc, personOcc], [cxnOcc], [attr('AT_ID', 'AWF.01.01')])
    const document = workingDocument([m], [funcDef, personDef], [cxnDef])

    const findings = buildConventionFindings(document)

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      ruleId: 'conv.function.missingIdentifier',
      severity: 'warning',
      messageKey: 'aris.conv.finding.missingIdentifier.body',
      nodeIds: ['O_FUNC'],
      edgeIds: [],
      modelId: 'M1'
    })
  })
})

describe('conv.function.noExecutor', () => {
  it('flags a Function occurrence with no incoming R-executor connection', () => {
    const funcDef = objectDefinition('D_FUNC', 'OT_FUNC', 'Do work', [attr('AT_ID', 'AWF.01.01')])
    const funcOcc = objectOccurrence('O_FUNC', 'D_FUNC', 'M1', 'ST_FUNC')
    const m = model('M1', [funcOcc], [], [attr('AT_ID', 'AWF.01.01')])
    const document = workingDocument([m], [funcDef], [])

    const findings = buildConventionFindings(document)

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      ruleId: 'conv.function.noExecutor',
      severity: 'warning',
      messageKey: 'aris.conv.finding.noExecutor.body',
      nodeIds: ['O_FUNC'],
      edgeIds: [],
      modelId: 'M1'
    })
  })

  it('does not flag a Function with an incoming CT_EXEC_2 (role) R connection', () => {
    const funcDef = objectDefinition('D_FUNC', 'OT_FUNC', 'Do work', [attr('AT_ID', 'AWF.01.01')])
    const roleDef = objectDefinition('D_ROLE', 'OT_PERS_TYPE', 'Approver role')
    const cxnDef = connectionDefinition('CD1', 'CT_EXEC_2', 'D_ROLE', 'D_FUNC')
    const funcOcc = objectOccurrence('O_FUNC', 'D_FUNC', 'M1', 'ST_FUNC')
    const roleOcc = objectOccurrence('O_ROLE', 'D_ROLE', 'M1', 'ST_EMPL_TYPE')
    const cxnOcc = connectionOccurrence('C1', 'CD1', 'M1', 'O_ROLE', 'O_FUNC')
    const m = model('M1', [funcOcc, roleOcc], [cxnOcc], [attr('AT_ID', 'AWF.01.01')])
    const document = workingDocument([m], [funcDef, roleDef], [cxnDef])

    const findings = buildConventionFindings(document)

    expect(findings.filter((f) => f.ruleId === 'conv.function.noExecutor')).toHaveLength(0)
  })

  it('does not flag a VACD Function occurrence — executor wiring is an EPC-only relationship', () => {
    // The DMT convention manual documents the R/A/C/I executor relationship solely as an
    // EPC Objects Relationship; VACD chain elements carry no executor wiring (the AnimalWF
    // VACD produced 14 false warnings before this scoping).
    const funcDef = objectDefinition('D_FUNC', 'OT_FUNC', 'Chain element', [
      attr('AT_ID', 'AWF.01')
    ])
    const funcOcc = objectOccurrence('O_FUNC', 'D_FUNC', 'M_VACD', 'ST_FUNC')
    const m = model('M_VACD', [funcOcc], [], [], 'MT_VAL_ADD_CHN_DGM')
    const document = workingDocument([m], [funcDef], [])

    expect(buildConventionFindings(document)).toEqual([])
  })
})

describe('conv.model.missingAttribute', () => {
  it('flags an EEPC model missing its own AT_ID (Identifier) attribute', () => {
    const m = model('M1', [], [], [])
    const document = workingDocument([m], [], [])

    const findings = buildConventionFindings(document)

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      ruleId: 'conv.model.missingAttribute',
      severity: 'warning',
      messageKey: 'aris.conv.finding.missingAttribute.body',
      nodeIds: [],
      edgeIds: [],
      modelId: 'M1'
    })
  })

  it('does not flag a model that carries its own AT_ID attribute', () => {
    const m = model('M1', [], [], [attr('AT_ID', 'AWF.01.01')])
    const document = workingDocument([m], [], [])

    const findings = buildConventionFindings(document)

    expect(findings.filter((f) => f.ruleId === 'conv.model.missingAttribute')).toHaveLength(0)
  })
})

describe('conv.naming.hint', () => {
  it('flags a definition whose name exceeds 60 characters', () => {
    const longName = 'N'.repeat(61)
    const funcDef = objectDefinition('D_FUNC', 'OT_FUNC', longName, [attr('AT_ID', 'AWF.01.01')])
    const personDef = objectDefinition('D_PERS', 'OT_PERS', 'Reviewer')
    const cxnDef = connectionDefinition('CD1', 'CT_EXEC_1', 'D_PERS', 'D_FUNC')
    const funcOcc = objectOccurrence('O_FUNC', 'D_FUNC', 'M1', 'ST_FUNC')
    const personOcc = objectOccurrence('O_PERS', 'D_PERS', 'M1', 'ST_PERS_EXT')
    const cxnOcc = connectionOccurrence('C1', 'CD1', 'M1', 'O_PERS', 'O_FUNC')
    const m = model('M1', [funcOcc, personOcc], [cxnOcc], [attr('AT_ID', 'AWF.01.01')])
    const document = workingDocument([m], [funcDef, personDef], [cxnDef])

    expect(longName.length).toBeGreaterThan(60)
    const findings = buildConventionFindings(document)

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      ruleId: 'conv.naming.hint',
      severity: 'warning',
      messageKey: 'aris.conv.finding.namingHint.body',
      nodeIds: ['O_FUNC'],
      edgeIds: [],
      modelId: 'M1'
    })
  })

  it('flags a definition whose name ends with a trailing period', () => {
    const funcDef = objectDefinition('D_FUNC', 'OT_FUNC', 'Do work.', [attr('AT_ID', 'AWF.01.01')])
    const personDef = objectDefinition('D_PERS', 'OT_PERS', 'Reviewer')
    const cxnDef = connectionDefinition('CD1', 'CT_EXEC_1', 'D_PERS', 'D_FUNC')
    const funcOcc = objectOccurrence('O_FUNC', 'D_FUNC', 'M1', 'ST_FUNC')
    const personOcc = objectOccurrence('O_PERS', 'D_PERS', 'M1', 'ST_PERS_EXT')
    const cxnOcc = connectionOccurrence('C1', 'CD1', 'M1', 'O_PERS', 'O_FUNC')
    const m = model('M1', [funcOcc, personOcc], [cxnOcc], [attr('AT_ID', 'AWF.01.01')])
    const document = workingDocument([m], [funcDef, personDef], [cxnDef])

    const findings = buildConventionFindings(document)

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      ruleId: 'conv.naming.hint',
      nodeIds: ['O_FUNC'],
      modelId: 'M1'
    })
  })

  it('does not flag a short name with no trailing period', () => {
    const funcDef = objectDefinition('D_FUNC', 'OT_FUNC', 'Do work', [attr('AT_ID', 'AWF.01.01')])
    const m = model(
      'M1',
      [objectOccurrence('O_FUNC', 'D_FUNC', 'M1', 'ST_FUNC')],
      [],
      [attr('AT_ID', 'AWF.01.01')]
    )
    const document = workingDocument([m], [funcDef], [])

    const findings = buildConventionFindings(document)

    expect(findings.filter((f) => f.ruleId === 'conv.naming.hint')).toHaveLength(0)
  })
})

describe('a legal DMT wiring', () => {
  it('triggers no convention findings at all', () => {
    const startDef = objectDefinition('D_START', 'OT_EVT', 'Request received')
    const funcDef = objectDefinition('D_FUNC', 'OT_FUNC', 'Review request', [
      attr('AT_ID', 'AWF.01.01')
    ])
    const endDef = objectDefinition('D_END', 'OT_EVT', 'Request approved')
    const personDef = objectDefinition('D_PERS', 'OT_PERS', 'Reviewer')

    const cxnActivates = connectionDefinition('CD1', 'CT_ACTIV_1', 'D_START', 'D_FUNC')
    const cxnCreates = connectionDefinition('CD2', 'CT_CRT_1', 'D_FUNC', 'D_END')
    const cxnExecutes = connectionDefinition('CD3', 'CT_EXEC_1', 'D_PERS', 'D_FUNC')

    const startOcc = objectOccurrence('O_START', 'D_START', 'M1', 'ST_EV')
    const funcOcc = objectOccurrence('O_FUNC', 'D_FUNC', 'M1', 'ST_FUNC')
    const endOcc = objectOccurrence('O_END', 'D_END', 'M1', 'ST_EV')
    const personOcc = objectOccurrence('O_PERS', 'D_PERS', 'M1', 'ST_PERS_EXT')

    const cxnOccActivates = connectionOccurrence('C1', 'CD1', 'M1', 'O_START', 'O_FUNC')
    const cxnOccCreates = connectionOccurrence('C2', 'CD2', 'M1', 'O_FUNC', 'O_END')
    const cxnOccExecutes = connectionOccurrence('C3', 'CD3', 'M1', 'O_PERS', 'O_FUNC')

    const m = model(
      'M1',
      [startOcc, funcOcc, endOcc, personOcc],
      [cxnOccActivates, cxnOccCreates, cxnOccExecutes],
      [attr('AT_ID', 'AWF.01.01')]
    )
    const document = workingDocument(
      [m],
      [startDef, funcDef, endDef, personDef],
      [cxnActivates, cxnCreates, cxnExecutes]
    )

    expect(buildConventionFindings(document)).toEqual([])
  })
})

describe('buildConventionFindings modelIds filtering', () => {
  it('excludes models not present in the supplied modelIds set', () => {
    const startDef = objectDefinition('D_E1', 'OT_EVT', 'Start')
    const endDef = objectDefinition('D_E2', 'OT_EVT', 'End')
    const cxnDef = connectionDefinition('CD1', 'CT_ACTIV_1', 'D_E1', 'D_E2')
    const startOcc = objectOccurrence('O_E1', 'D_E1', 'M1', 'ST_EV')
    const endOcc = objectOccurrence('O_E2', 'D_E2', 'M1', 'ST_EV')
    const cxnOcc = connectionOccurrence('C1', 'CD1', 'M1', 'O_E1', 'O_E2')
    const m = model('M1', [startOcc, endOcc], [cxnOcc], [attr('AT_ID', 'AWF.01.01')])
    const document = workingDocument([m], [startDef, endDef], [cxnDef])

    expect(buildConventionFindings(document)).toHaveLength(1)
    expect(buildConventionFindings(document, new Set(['OTHER_MODEL']))).toEqual([])
    expect(buildConventionFindings(document, new Set(['M1']))).toHaveLength(1)
  })
})

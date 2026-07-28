/**
 * Test helpers for the details layer.
 *
 * These build minimal `ArisWorkingDocument` instances directly so tests do not
 * couple to the in-flight source index.
 */

import type {
  ArisBounds,
  ArisConnectionDefinition,
  ArisConnectionOccurrence,
  ArisDatabase,
  ArisModel,
  ArisObjectDefinition,
  ArisObjectOccurrence,
  ArisOccurrenceStyle,
  ArisStyleCatalog,
  ArisWorkingDocument,
} from '../model/types'

function bounds(x: number, y: number, width: number, height: number): ArisBounds {
  return { x, y, width, height }
}

function emptyStyle(): ArisOccurrenceStyle {
  return {
    symbol: null,
    fillColor: null,
    strokeColor: null,
    strokeWidth: null,
    lineStyle: null,
    fontStyleSheetId: null,
    zOrder: null,
  }
}

function localized(values: Record<string, string>) {
  return { values, fallback: Object.values(values)[0] ?? null }
}

export function buildSatelliteDocument(): ArisWorkingDocument {
  const database: ArisDatabase = {
    databaseName: 'TestDB',
    createDate: '2026-07-28',
    createTime: '21:45:00',
    userName: 'tester',
    arisExeVersion: '0.1.0',
  }

  const funcDef: ArisObjectDefinition = {
    id: 'od-func-1',
    type: 'OT_FUNC',
    defaultSymbol: 'ST_FUNC',
    names: localized({ 'en-US': 'Approve' }),
    attributes: [],
    linkedModelIds: [],
    rawAttributes: {},
  }

  const ownerDef: ArisObjectDefinition = {
    id: 'od-owner-1',
    type: 'OT_PERS',
    defaultSymbol: 'ST_PERS_EXT',
    names: localized({ 'en-US': 'Veterinary', 'ar-SA': 'الطبيب البيطري' }),
    attributes: [
      {
        type: 'AT_DESC',
        values: [
          { localeId: 'en-US', text: 'Responsible party' },
          { localeId: 'ar-SA', text: 'الجهة المسؤولة' },
        ],
      },
    ],
    linkedModelIds: [],
    rawAttributes: {},
  }

  const inputDef: ArisObjectDefinition = {
    id: 'od-input-1',
    type: 'OT_INFO_CARR',
    defaultSymbol: 'ST_INFO_CARR_HANDY',
    names: localized({ 'en-US': 'Application form' }),
    attributes: [],
    linkedModelIds: [],
    rawAttributes: {},
  }

  const objectDefinitions = new Map<string, ArisObjectDefinition>([
    [funcDef.id, funcDef],
    [ownerDef.id, ownerDef],
    [inputDef.id, inputDef],
  ])

  const funcOcc: ArisObjectOccurrence = {
    id: 'occ-func-1',
    definitionId: funcDef.id,
    modelId: 'm1',
    symbol: 'ST_FUNC',
    bounds: bounds(100, 100, 120, 60),
    style: emptyStyle(),
    attributeOccurrences: [],
    rawAttributes: {},
  }

  const ownerOcc: ArisObjectOccurrence = {
    id: 'occ-owner-1',
    definitionId: ownerDef.id,
    modelId: 'm1',
    symbol: 'ST_PERS_EXT',
    bounds: bounds(300, 100, 100, 50),
    style: emptyStyle(),
    attributeOccurrences: [],
    rawAttributes: {},
  }

  const inputOcc: ArisObjectOccurrence = {
    id: 'occ-input-1',
    definitionId: inputDef.id,
    modelId: 'm1',
    symbol: 'ST_INFO_CARR_HANDY',
    bounds: bounds(100, 300, 100, 50),
    style: emptyStyle(),
    attributeOccurrences: [],
    rawAttributes: {},
  }

  const ownerCxnDef: ArisConnectionDefinition = {
    id: 'cd-owner-1',
    type: 'CT_ACTIV_1',
    fromObjectDefinitionId: funcDef.id,
    toObjectDefinitionId: ownerDef.id,
    names: localized({}),
    attributes: [],
  }

  const inputCxnDef: ArisConnectionDefinition = {
    id: 'cd-input-1',
    type: 'CT_IS_INP_FOR',
    fromObjectDefinitionId: inputDef.id,
    toObjectDefinitionId: funcDef.id,
    names: localized({}),
    attributes: [],
  }

  const connectionDefinitions = new Map<string, ArisConnectionDefinition>([
    [ownerCxnDef.id, ownerCxnDef],
    [inputCxnDef.id, inputCxnDef],
  ])

  const ownerCxn: ArisConnectionOccurrence = {
    id: 'cxn-owner-1',
    definitionId: ownerCxnDef.id,
    modelId: 'm1',
    sourceOccurrenceId: funcOcc.id,
    targetOccurrenceId: ownerOcc.id,
    route: [],
    style: {
      color: null,
      width: null,
      lineStyle: null,
      srcArrow: null,
      tgtArrow: null,
      fontStyleSheetId: null,
      zOrder: null,
    },
    rawAttributes: {},
  }

  const inputCxn: ArisConnectionOccurrence = {
    id: 'cxn-input-1',
    definitionId: inputCxnDef.id,
    modelId: 'm1',
    sourceOccurrenceId: inputOcc.id,
    targetOccurrenceId: funcOcc.id,
    route: [],
    style: {
      color: null,
      width: null,
      lineStyle: null,
      srcArrow: null,
      tgtArrow: null,
      fontStyleSheetId: null,
      zOrder: null,
    },
    rawAttributes: {},
  }

  const model: ArisModel = {
    id: 'm1',
    type: 'MT_EEPC',
    names: localized({ 'en-US': 'Test model' }),
    attributes: [],
    occurrences: [funcOcc, ownerOcc, inputOcc],
    connectionOccurrences: [ownerCxn, inputCxn],
    lanes: [],
    freeText: [],
    layout: {
      scale: null,
      gridSize: null,
      backColor: null,
      printScale: null,
      curveRadius: null,
      arcRadius: null,
    },
    unsupported: false,
    rawSourceRecord: null,
  }

  const styleCatalog: ArisStyleCatalog = { styles: new Map() }

  return {
    database,
    models: new Map([['m1', model]]),
    objectDefinitions,
    connectionDefinitions,
    styleCatalog,
    sourceIndex: {
      database: { parsed: database },
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
      routePoints: [],
    },
    revision: 1,
  }
}

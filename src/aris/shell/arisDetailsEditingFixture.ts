/**
 * Fixture for the writable details rail. Test support only.
 *
 * Deliberately shaped like the real AnimalWF export rather than like a
 * convenient synthetic one:
 *
 *  - locale ids are the RAW, unexpanded AML entity references
 *    (`"&LocaleId.USen;"`, `"&LocaleId.AEar;"`), which is what actually reaches
 *    the details layer — entity references inside attribute values are never
 *    expanded upstream;
 *  - one value is Arabic prose filed under the ENGLISH locale tag, the case
 *    that covers 35 of the 60 Arabic strings in the reference export;
 *  - one definition has three occurrences spread over two models, so the §8.2
 *    blast radius is a real number and not always 1.
 */

import type {
  ArisBounds,
  ArisModel,
  ArisObjectDefinition,
  ArisObjectOccurrence,
  ArisOccurrenceStyle,
  ArisWorkingDocument
} from '../model/types'

export const EN_LOCALE = '&LocaleId.USen;'
export const AR_LOCALE = '&LocaleId.AEar;'

const EMPTY_STYLE: ArisOccurrenceStyle = Object.freeze({
  symbol: null,
  fillColor: null,
  strokeColor: null,
  strokeWidth: null,
  lineStyle: null,
  fontStyleSheetId: null,
  zOrder: null
})

function bounds(x: number, y: number): ArisBounds {
  return { x, y, width: 100, height: 50 }
}

function occurrence(
  id: string,
  definitionId: string,
  modelId: string,
  style: ArisOccurrenceStyle = EMPTY_STYLE
): ArisObjectOccurrence {
  return {
    id,
    definitionId,
    modelId,
    symbol: 'ST_FUNC',
    bounds: bounds(10, 10),
    style,
    attributeOccurrences: [],
    rawAttributes: {}
  }
}

export function buildModel(
  id: string,
  name: string,
  occurrences: ArisObjectOccurrence[]
): ArisModel {
  return {
    id,
    type: 'MT_EEPC',
    names: { values: { [EN_LOCALE]: name }, fallback: name },
    attributes: [],
    occurrences,
    connectionOccurrences: [],
    lanes: [],
    freeText: [],
    attachments: [],
    layout: {
      scale: null,
      gridSize: null,
      backColor: null,
      printScale: null,
      curveRadius: null,
      arcRadius: null
    },
    unsupported: false,
    rawSourceRecord: null
  }
}

/** Three occurrences of `od-shared` across two models, plus a lone `od-solo`. */
export function buildEditingFixture(): ArisWorkingDocument {
  const shared: ArisObjectDefinition = {
    id: 'od-shared',
    type: 'OT_FUNC',
    defaultSymbol: 'ST_FUNC',
    names: {
      values: { [EN_LOCALE]: 'Approve request', [AR_LOCALE]: 'اعتماد الطلب' },
      fallback: 'Approve request'
    },
    attributes: [
      {
        type: 'AT_DESC',
        values: [
          { localeId: EN_LOCALE, text: 'Approval step' },
          { localeId: AR_LOCALE, text: 'خطوة الاعتماد' },
          { localeId: 'de-DE', text: 'Genehmigungsschritt' }
        ]
      },
      {
        // The 35-of-60 case: Arabic prose filed under the ENGLISH locale tag.
        type: 'AT_REM',
        values: [{ localeId: EN_LOCALE, text: 'ملاحظة تشغيلية' }]
      }
    ],
    linkedModelIds: ['m2'],
    rawAttributes: {}
  }

  const solo: ArisObjectDefinition = {
    id: 'od-solo',
    type: 'OT_EVT',
    defaultSymbol: 'ST_EVT',
    names: { values: {}, fallback: null },
    attributes: [],
    linkedModelIds: [],
    rawAttributes: {}
  }

  const occ1 = occurrence('occ-1', 'od-shared', 'm1')
  const occ2 = occurrence('occ-2', 'od-shared', 'm1', { ...EMPTY_STYLE, fillColor: '#ff0000' })
  const occ3 = occurrence('occ-3', 'od-shared', 'm2')
  const occ4 = occurrence('occ-4', 'od-solo', 'm1')

  return {
    database: {
      databaseName: 'TestDB',
      createDate: null,
      createTime: null,
      userName: null,
      arisExeVersion: null
    },
    models: new Map([
      ['m1', buildModel('m1', 'Main process', [occ1, occ2, occ4])],
      ['m2', buildModel('m2', 'Sub process', [occ3])]
    ]),
    objectDefinitions: new Map([
      [shared.id, shared],
      [solo.id, solo]
    ]),
    connectionDefinitions: new Map(),
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
    revision: 1
  }
}

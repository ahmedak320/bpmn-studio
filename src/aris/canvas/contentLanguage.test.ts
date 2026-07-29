// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import type {
  ArisConnectionDefinition,
  ArisConnectionOccurrence,
  ArisFreeText,
  ArisLane,
  ArisModel,
  ArisObjectDefinition,
  ArisObjectOccurrence,
  ArisWorkingDocument
} from '../model/types'
import { ArisCanvas } from './ArisCanvas'
import { createEmptyArisDocument, createEmptyArisModel } from './emptyDocument'
import { ARIS_CONTENT_LOCALE_IDS } from './localization'
import { AT_NAME } from './vocabulary'
import { createCanvasContainer, installJsdomSvgSupport } from './testing/jsdomSvg'

let canvas: ArisCanvas | null = null
let container: HTMLElement | null = null

afterEach(() => {
  canvas?.destroy()
  container?.remove()
  canvas = null
  container = null
})

function bilingualNames(
  english: string,
  arabic: string
): {
  values: Record<string, string>
  fallback: string
} {
  return {
    values: {
      'en-US': english,
      'ar-AE': arabic,
      '&LocaleId.USen;': english,
      '&LocaleId.AEar;': arabic
    },
    fallback: english
  }
}

function buildBilingualDocument(): ArisWorkingDocument {
  const modelId = 'Model.Bilingual'
  const occurrenceId = 'ObjOcc.1'
  const definitionId = 'ObjDef.1'
  const arabicOnlyDefinitionId = 'ObjDef.2'
  const arabicOnlyOccurrenceId = 'ObjOcc.2'
  const englishOnlyDefinitionId = 'ObjDef.3'
  const englishOnlyOccurrenceId = 'ObjOcc.3'
  const connectionDefinitionId = 'CxnDef.1'
  const connectionOccurrenceId = 'CxnOcc.1'

  const model: ArisModel = {
    ...createEmptyArisModel({ id: modelId, type: 'MT_EEPC', name: 'Process' }),
    names: bilingualNames('Process', 'العملية'),
    occurrences: [
      occurrence(definitionId, occurrenceId, modelId, true),
      occurrence(arabicOnlyDefinitionId, arabicOnlyOccurrenceId, modelId, false),
      occurrence(englishOnlyDefinitionId, englishOnlyOccurrenceId, modelId, false)
    ] as ArisObjectOccurrence[],
    lanes: [
      {
        id: 'Lane.1',
        modelId,
        names: bilingualNames('Swimlane', 'الممر'),
        laneType: 'LT_DEFAULT',
        orientation: 'horizontal',
        startBorder: null,
        endBorder: null
      } as ArisLane
    ],
    freeText: [
      {
        id: 'FFTextOcc.1',
        modelId,
        definitionId: 'FFTextDef.1',
        text: bilingualNames('Note', 'ملاحظة'),
        attributes: [],
        bounds: { x: 500, y: 500, width: 160, height: 32 },
        style: emptyStyle()
      } as ArisFreeText
    ],
    connectionOccurrences: [
      {
        id: connectionOccurrenceId,
        definitionId: connectionDefinitionId,
        modelId,
        sourceOccurrenceId: occurrenceId,
        targetOccurrenceId: englishOnlyOccurrenceId,
        route: [
          { x: 150, y: 75 },
          { x: 450, y: 75 }
        ],
        style: {
          color: null,
          width: null,
          lineStyle: null,
          srcArrow: null,
          tgtArrow: null,
          fontStyleSheetId: null,
          zOrder: null
        },
        attributeOccurrences: [
          {
            attributeType: AT_NAME,
            port: null,
            orderNum: null,
            alignment: null,
            offsetX: 0,
            offsetY: 0,
            width: null,
            height: null,
            rotation: null,
            symbolFlag: null,
            fontStyleSheetId: null
          }
        ],
        rawAttributes: {}
      } as ArisConnectionOccurrence
    ]
  }

  const objectDefinitions = new Map<string, ArisObjectDefinition>([
    [
      definitionId,
      {
        id: definitionId,
        type: 'OT_FUNC',
        defaultSymbol: null,
        names: bilingualNames('Function', 'وظيفة'),
        attributes: [],
        linkedModelIds: [],
        rawAttributes: {}
      }
    ],
    [
      arabicOnlyDefinitionId,
      {
        id: arabicOnlyDefinitionId,
        type: 'OT_FUNC',
        defaultSymbol: null,
        names: { values: { '&LocaleId.AEar;': 'وحدة' }, fallback: 'وحدة' },
        attributes: [],
        linkedModelIds: [],
        rawAttributes: {}
      }
    ],
    [
      englishOnlyDefinitionId,
      {
        id: englishOnlyDefinitionId,
        type: 'OT_FUNC',
        defaultSymbol: null,
        names: { values: { '&LocaleId.USen;': 'Unit' }, fallback: 'Unit' },
        attributes: [],
        linkedModelIds: [],
        rawAttributes: {}
      }
    ]
  ])

  const connectionDefinitions = new Map<string, ArisConnectionDefinition>([
    [
      connectionDefinitionId,
      {
        id: connectionDefinitionId,
        type: 'CT_FUNC',
        fromObjectDefinitionId: definitionId,
        toObjectDefinitionId: englishOnlyDefinitionId,
        names: bilingualNames('Link', 'رابط'),
        attributes: [
          {
            type: AT_NAME,
            values: [
              { localeId: '&LocaleId.USen;', text: 'Link' },
              { localeId: '&LocaleId.AEar;', text: 'رابط' }
            ]
          }
        ]
      }
    ]
  ])

  const base = createEmptyArisDocument({ models: [model] })
  return {
    ...base,
    objectDefinitions: Object.freeze(objectDefinitions),
    connectionDefinitions: Object.freeze(connectionDefinitions)
  }
}

function occurrence(
  definitionId: string,
  id: string,
  modelId: string,
  hasExternalLabel: boolean
): ArisObjectOccurrence {
  return {
    id,
    definitionId,
    modelId,
    symbol: 'ST_FUNC',
    bounds: { x: 100, y: 100, width: 120, height: 60 },
    style: emptyStyle(),
    attributeOccurrences: hasExternalLabel
      ? [
          {
            attributeType: AT_NAME,
            port: null,
            orderNum: null,
            alignment: null,
            offsetX: 0,
            offsetY: -30,
            width: null,
            height: null,
            rotation: null,
            symbolFlag: null,
            fontStyleSheetId: null
          }
        ]
      : [],
    rawAttributes: {}
  } as ArisObjectOccurrence
}

function emptyStyle() {
  return {
    symbol: null,
    fillColor: null,
    strokeColor: null,
    strokeWidth: null,
    lineStyle: null,
    fontStyleSheetId: null,
    zOrder: null
  }
}

function bootBilingual(): ArisCanvas {
  installJsdomSvgSupport()
  container = createCanvasContainer()
  return ArisCanvas.create({
    container,
    document: buildBilingualDocument(),
    modelId: 'Model.Bilingual',
    minimap: false
  })
}

describe('ArisCanvas content language projection', () => {
  it('renders Arabic names after setContentLanguage(ar)', () => {
    canvas = bootBilingual()
    canvas.setContentLanguage('ar')

    const occurrence = canvas.elementRegistry.get('ObjOcc.1') as
      { businessObject: { name: string } } | undefined
    expect(occurrence?.businessObject.name).toBe('وظيفة')

    const lane = canvas.elementRegistry.get('lane:Lane.1') as
      { businessObject: { name: string } } | undefined
    expect(lane?.businessObject.name).toBe('الممر')

    const freeText = canvas.elementRegistry.get('text:FFTextOcc.1') as
      { businessObject: { text: string } } | undefined
    expect(freeText?.businessObject.text).toBe('ملاحظة')
  })

  it('restores English names after switching back to en', () => {
    canvas = bootBilingual()
    canvas.setContentLanguage('ar')
    canvas.setContentLanguage('en')

    const occurrence = canvas.elementRegistry.get('ObjOcc.1') as
      { businessObject: { name: string } } | undefined
    expect(occurrence?.businessObject.name).toBe('Function')
  })

  it('falls back to Arabic when no English value exists', () => {
    canvas = bootBilingual()
    canvas.setContentLanguage('en')

    const occurrence = canvas.elementRegistry.get('ObjOcc.2') as
      { businessObject: { name: string } } | undefined
    expect(occurrence?.businessObject.name).toBe('وحدة')
  })

  it('falls back to English when no Arabic value exists', () => {
    canvas = bootBilingual()
    canvas.setContentLanguage('ar')

    const occurrence = canvas.elementRegistry.get('ObjOcc.3') as
      { businessObject: { name: string } } | undefined
    expect(occurrence?.businessObject.name).toBe('Unit')
  })

  it('leaves the undo stack untouched across many toggles', () => {
    canvas = bootBilingual()
    const initialCommandCount = canvas.commandLog.length
    expect(canvas.canUndo).toBe(false)

    for (let index = 0; index < 10; index += 1) {
      canvas.setContentLanguage(index % 2 === 0 ? 'ar' : 'en')
    }

    expect(canvas.commandLog).toHaveLength(initialCommandCount)
    expect(canvas.canUndo).toBe(false)
  })

  it('resolves raw entity locale keys under Arabic', () => {
    canvas = bootBilingual()
    canvas.setContentLanguage('ar')

    const connection = canvas.elementRegistry.get('CxnOcc.1') as
      { businessObject: { name: string } } | undefined
    expect(connection?.businessObject.name).toBe('رابط')

    const connectionLabel = canvas.elementRegistry.get('cxnlabel:CxnOcc.1:0:AT_NAME') as
      { businessObject: { text: string } } | undefined
    expect(connectionLabel?.businessObject.text).toBe('رابط')
  })

  it('sets direction=rtl on Arabic caption nodes', () => {
    canvas = bootBilingual()
    canvas.setContentLanguage('ar')

    const textNode = container?.querySelector('[data-aris-caption]')
    expect(textNode).toBeTruthy()
    expect(textNode?.getAttribute('direction')).toBe('rtl')
    expect(textNode?.getAttribute('unicode-bidi')).toBe('plaintext')
  })

  it('exposes the current content language', () => {
    canvas = bootBilingual()
    expect(canvas.contentLanguage).toBe('en')
    canvas.setContentLanguage('ar')
    expect(canvas.contentLanguage).toBe('ar')
    expect(ARIS_CONTENT_LOCALE_IDS.en).toBe('en-US')
    expect(ARIS_CONTENT_LOCALE_IDS.ar).toBe('ar-AE')
  })
})

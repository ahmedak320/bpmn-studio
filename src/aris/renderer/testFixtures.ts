/**
 * Hand-built `ArisRenderSourceInput` fixtures for renderer unit tests. Not a `.test.ts` file
 * itself — a shared builder consumed by the suites in this directory. Field values are shaped
 * exactly like the real semantic index (`src/aris/source/semanticIndex.ts`) so a fixture here is
 * a faithful (if smaller) stand-in for the real AnimalWF export used by
 * `animalWfRealData.test.ts`.
 */

import type {
  ArisRenderSourceInput,
  RenderSourceAttachment,
  RenderSourceAttachmentOccurrence,
  RenderSourceAttribute,
  RenderSourceAttributeOccurrence,
  RenderSourceBrush,
  RenderSourceConnectionDefinition,
  RenderSourceConnectionOccurrence,
  RenderSourceFont,
  RenderSourceFontStyleSheet,
  RenderSourceFreeTextOccurrence,
  RenderSourceGuidReference,
  RenderSourceLane,
  RenderSourceModel,
  RenderSourceObjectDefinition,
  RenderSourceObjectOccurrence,
  RenderSourcePen,
  RenderSourceRoutePoint
} from './input'

export function rec<T>(sourceId: string | null, path: string, parsed: T): { sourceId: string | null; path: string; parsed: T } {
  return { sourceId, path, parsed }
}

/** A single EEPC model: Function --(CT_EXEC)--> Event, one lane, one free text, one OLE attachment. */
export function buildHappyPathInput(): ArisRenderSourceInput {
  const models = new Map<string, RenderSourceModel>([
    [
      'Model.1',
      rec('Model.1', 'AML[1]/Group[1]/Model[1]', {
        modelId: 'Model.1',
        modelType: 'MT_EEPC',
        gridUse: 'YES',
        gridSize: 50,
        scale: 80,
        printScale: 54,
        backColor: '-1',
        templateGuid: null
      })
    ]
  ])

  const objectDefinitions = new Map<string, RenderSourceObjectDefinition>([
    [
      'ObjDef.1',
      rec('ObjDef.1', 'AML[1]/Group[1]/ObjDef[1]', { objectDefinitionId: 'ObjDef.1', typeNum: 'OT_FUNC', symbolNum: 'ST_FUNC' })
    ],
    [
      'ObjDef.2',
      rec('ObjDef.2', 'AML[1]/Group[1]/ObjDef[2]', { objectDefinitionId: 'ObjDef.2', typeNum: 'OT_EVT', symbolNum: 'ST_EV' })
    ],
    [
      'ObjDef.3',
      rec('ObjDef.3', 'AML[1]/Group[1]/ObjDef[3]', { objectDefinitionId: 'ObjDef.3', typeNum: 'OT_FUNC', symbolNum: 'ST_FUNC' })
    ]
  ])

  const objectOccurrences = new Map<string, RenderSourceObjectOccurrence>([
    [
      'ObjOcc.1',
      rec('ObjOcc.1', 'AML[1]/Group[1]/Model[1]/ObjOcc[1]', {
        objectOccurrenceId: 'ObjOcc.1',
        modelId: 'Model.1',
        objectDefinitionId: 'ObjDef.1',
        symbolNum: 'ST_FUNC',
        zorder: 2,
        x: 100,
        y: 200,
        dx: 140,
        dy: 60,
        symbolGuid: null
      })
    ],
    [
      'ObjOcc.2',
      rec('ObjOcc.2', 'AML[1]/Group[1]/Model[1]/ObjOcc[2]', {
        objectOccurrenceId: 'ObjOcc.2',
        modelId: 'Model.1',
        objectDefinitionId: 'ObjDef.2',
        symbolNum: 'ST_EV',
        zorder: 1,
        x: 100,
        y: 400,
        dx: 100,
        dy: 100,
        symbolGuid: null
      })
    ],
    [
      'ObjOcc.3',
      rec('ObjOcc.3', 'AML[1]/Group[1]/Model[1]/ObjOcc[3]', {
        objectOccurrenceId: 'ObjOcc.3',
        modelId: 'Model.1',
        objectDefinitionId: 'ObjDef.3',
        symbolNum: 'ST_FUNC',
        zorder: 6,
        x: 400,
        y: 250,
        dx: 140,
        dy: 60,
        symbolGuid: null
      })
    ]
  ])

  const connectionDefinitions = new Map<string, RenderSourceConnectionDefinition>([
    ['CxnDef.1', rec('CxnDef.1', 'AML[1]/Group[1]/ObjDef[1]/CxnDef[1]', { connectionDefinitionId: 'CxnDef.1', connectionType: 'CT_EXEC_1' })]
  ])

  const connectionOccurrences = new Map<string, RenderSourceConnectionOccurrence>([
    [
      'CxnOcc.1',
      rec('CxnOcc.1', 'AML[1]/Group[1]/Model[1]/ObjOcc[1]/CxnOcc[1]', {
        connectionOccurrenceId: 'CxnOcc.1',
        modelId: 'Model.1',
        fromObjectOccurrenceId: 'ObjOcc.1',
        toObjectOccurrenceId: 'ObjOcc.2',
        connectionDefinitionId: 'CxnDef.1',
        zorder: 3,
        srcArrow: 'NONE',
        tgtArrow: 'NORMAL',
        visible: 'YES'
      })
    ]
  ])

  // Deliberately out of pointIndex order, to prove the renderer sorts route points itself
  // rather than trusting source document order.
  const routePoints: RenderSourceRoutePoint[] = [
    { connectionOccurrenceId: 'CxnOcc.1', modelId: 'Model.1', pointIndex: 2, x: 150, y: 400 },
    { connectionOccurrenceId: 'CxnOcc.1', modelId: 'Model.1', pointIndex: 0, x: 170, y: 260 },
    { connectionOccurrenceId: 'CxnOcc.1', modelId: 'Model.1', pointIndex: 1, x: 170, y: 330 }
  ]

  const attributes: RenderSourceAttribute[] = [
    rec('AttrDef.1', 'AML[1]/Group[1]/ObjDef[1]/AttrDef[1]', {
      ownerSourceId: 'ObjDef.1',
      attributeType: 'AT_NAME',
      values: [
        { locale: 'en', text: 'Register Owner' },
        { locale: 'ar', text: 'تسجيل المالك' }
      ]
    }),
    rec('AttrDef.2', 'AML[1]/Group[1]/ObjDef[2]/AttrDef[1]', {
      ownerSourceId: 'ObjDef.2',
      attributeType: 'AT_NAME',
      values: [{ locale: 'en', text: 'Owner Registered' }]
    }),
    rec('AttrDef.3', 'AML[1]/Group[1]/Model[1]/Lane[1]/AttrDef[1]', {
      ownerSourceId: 'Lane.1',
      attributeType: 'AT_NAME',
      values: [{ locale: 'en', text: 'Operations' }]
    }),
    rec('AttrDef.4', 'AML[1]/Group[1]/FFTextDef[1]/AttrDef[1]', {
      ownerSourceId: 'FFTextDef.1',
      attributeType: 'AT_NAME',
      values: [{ locale: 'en', text: 'Note: manual step' }]
    }),
    rec('AttrDef.5', 'AML[1]/Group[1]/ObjDef[3]/AttrDef[1]', {
      ownerSourceId: 'ObjDef.3',
      attributeType: 'AT_NAME',
      values: [{ locale: 'ar', text: 'إدارة الحيوان' }]
    })
  ]

  const attributeOccurrences: RenderSourceAttributeOccurrence[] = [
    rec('AttrOcc.1', 'AML[1]/Group[1]/Model[1]/ObjOcc[1]/AttrOcc[1]', {
      ownerSourceId: 'ObjOcc.1',
      attributeType: 'AT_NAME',
      port: null,
      orderNum: 0,
      alignment: 'CENTER',
      fontStyleSheetId: 'FontSS.1',
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      dx: 140,
      dy: 40
    }),
    rec('AttrOcc.2', 'AML[1]/Group[1]/Model[1]/ObjOcc[3]/AttrOcc[1]', {
      ownerSourceId: 'ObjOcc.3',
      attributeType: 'AT_NAME',
      port: null,
      orderNum: 0,
      alignment: 'CENTER',
      fontStyleSheetId: 'FontSS.1',
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      dx: 140,
      dy: 40
    })
  ]

  const lanes = new Map<string, RenderSourceLane>([
    [
      'Lane.1',
      rec('Lane.1', 'AML[1]/Group[1]/Model[1]/Lane[1]', {
        laneId: 'Lane.1',
        modelId: 'Model.1',
        laneType: 'LT_DEFAULT',
        orientation: 'VERTICAL',
        startBorder: 0,
        endBorder: 50000
      })
    ]
  ])

  const freeTextOccurrences: RenderSourceFreeTextOccurrence[] = [
    rec('FFTextOcc.1', 'AML[1]/Group[1]/Model[1]/FFTextOcc[1]', {
      modelId: 'Model.1',
      freeTextDefinitionId: 'FFTextDef.1',
      fontStyleSheetId: 'FontSS.1',
      zorder: 5,
      x: 400,
      y: 100,
      dx: 120,
      dy: 40
    })
  ]

  const attachments = new Map<string, RenderSourceAttachment>([
    ['OLEDef.1', rec('OLEDef.1', 'AML[1]/Group[1]/OLEDef[1]', { attachmentId: 'OLEDef.1', blobCount: 2 })]
  ])

  const attachmentOccurrences: RenderSourceAttachmentOccurrence[] = [
    rec('OLEOcc.1', 'AML[1]/Group[1]/Model[1]/OLEOcc[1]', {
      modelId: 'Model.1',
      attachmentOccurrenceId: 'OLEOcc.1',
      attachmentId: 'OLEDef.1',
      zorder: 4,
      x: 500,
      y: 500,
      dx: 64,
      dy: 64
    })
  ]

  const pens: RenderSourcePen[] = [
    rec('Pen.1', 'AML[1]/Group[1]/Model[1]/ObjOcc[1]/Brush[1]', {
      ownerSourceId: 'ObjOcc.1',
      color: '339900',
      style: '0',
      width: 1
    }),
    rec('Pen.2', 'AML[1]/Group[1]/Model[1]/ObjOcc[1]/CxnOcc[1]/Pen[1]', {
      ownerSourceId: 'CxnOcc.1',
      color: '0',
      style: '0',
      width: 1
    })
  ]

  const brushes: RenderSourceBrush[] = [
    rec('Brush.1', 'AML[1]/Group[1]/Model[1]/ObjOcc[1]/Brush[1]', {
      ownerSourceId: 'ObjOcc.1',
      color: 'b6dce9',
      color2: '0',
      brushType: 'SOLID'
    })
  ]

  const fontStyleSheets = new Map<string, RenderSourceFontStyleSheet>([
    ['FontSS.1', rec('FontSS.1', 'AML[1]/Group[1]/FontStyleSheet[1]', { fontStyleSheetId: 'FontSS.1' })]
  ])

  const fonts: RenderSourceFont[] = [
    rec('FontNode.1', 'AML[1]/Group[1]/FontStyleSheet[1]/FontNode[1]', {
      ownerSourceId: 'FontSS.1',
      localeId: '1033',
      locale: 'en',
      faceName: 'Arial',
      height: -13,
      weight: 400,
      italic: 'NO',
      underline: 'NO',
      strikeOut: 'NO',
      color: '0'
    }),
    rec('FontNode.2', 'AML[1]/Group[1]/FontStyleSheet[1]/FontNode[2]', {
      ownerSourceId: 'FontSS.1',
      localeId: '14337',
      locale: 'ar',
      faceName: 'Simplified Arabic',
      height: -13,
      weight: 400,
      italic: 'NO',
      underline: 'NO',
      strikeOut: 'NO',
      color: '0'
    })
  ]

  const guidReferences: RenderSourceGuidReference[] = []

  return {
    models,
    objectDefinitions,
    objectOccurrences,
    connectionDefinitions,
    connectionOccurrences,
    routePoints,
    attributes,
    attributeOccurrences,
    lanes,
    freeTextOccurrences,
    attachments,
    attachmentOccurrences,
    styles: { fontStyleSheets, fonts, pens, brushes },
    guidReferences
  }
}

/** An otherwise-empty single-model input, useful as a base for fidelity-finding fixtures. */
export function buildEmptyModelInput(modelOverrides?: Partial<{
  readonly modelType: string | null
  readonly templateGuid: string | null
  readonly backColor: string | null
}>): ArisRenderSourceInput {
  const models = new Map<string, RenderSourceModel>([
    [
      'Model.1',
      rec('Model.1', 'AML[1]/Group[1]/Model[1]', {
        modelId: 'Model.1',
        modelType: modelOverrides?.modelType ?? 'MT_EEPC',
        gridUse: 'YES',
        gridSize: 50,
        scale: 100,
        printScale: 100,
        backColor: modelOverrides?.backColor ?? '-1',
        templateGuid: modelOverrides?.templateGuid ?? null
      })
    ]
  ])

  return {
    models,
    objectDefinitions: new Map(),
    objectOccurrences: new Map(),
    connectionDefinitions: new Map(),
    connectionOccurrences: new Map(),
    routePoints: [],
    attributes: [],
    attributeOccurrences: [],
    lanes: new Map(),
    freeTextOccurrences: [],
    attachments: new Map(),
    attachmentOccurrences: [],
    styles: { fontStyleSheets: new Map(), fonts: [], pens: [], brushes: [] },
    guidReferences: []
  }
}

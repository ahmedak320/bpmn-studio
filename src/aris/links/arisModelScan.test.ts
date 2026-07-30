import { describe, expect, it } from 'vitest'

import type { ArisWorkingDocument } from '@/aris/model/types'

import {
  deriveArisLinksFromDocument,
  scanArisModelSource,
  type ArisModelScanResult
} from './arisModelScan'

const DOCTYPE = `<!DOCTYPE AML [<!ENTITY LocaleId.USen "1033"><!ENTITY LocaleId.AEar "14337">]>`

function aml(xmlBody: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${DOCTYPE}\n<AML>\n${xmlBody}\n</AML>`
}

function model(id: string, type: string, attrs: string, body = ''): string {
  return `<Model Model.ID="${id}" Model.Type="${type}"${attrs}>${body}</Model>`
}

function modelName(name: string, locale = '&LocaleId.USen;'): string {
  return `<AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="${locale}">${name}</AttrValue></AttrDef>`
}

function objOcc(id: string, defId: string): string {
  return `<ObjOcc ObjOcc.ID="${id}" ObjDef.IdRef="${defId}"/>`
}

function objDef(id: string, linkedIds: string, body = ''): string {
  const linkedAttr = linkedIds ? ` LinkedModels.IdRefs="${linkedIds}"` : ''
  return `<ObjDef ObjDef.ID="${id}"${linkedAttr}>${body}</ObjDef>`
}

describe('scanArisModelSource', () => {
  it('finds a two-model assignment with padded LinkedModels.IdRefs', () => {
    const xml = aml(`
      ${model(
        'Model.A',
        'MT_EEPC',
        '',
        `
        ${modelName('Model A')}
        ${objOcc('Occ.A1', 'Def.L1')}
        ${objOcc('Occ.A2', 'Def.L1')}
      `
      )}
      ${model('Model.B', 'MT_EEPC', '', modelName('Model B'))}
      ${objDef('Def.L1', ' Model.B ')}
    `)

    const result = scanArisModelSource(xml)

    expect(result.models).toHaveLength(2)
    expect(result.models.map((m) => m.modelId)).toEqual(['Model.A', 'Model.B'])
    expect(result.models.find((m) => m.modelId === 'Model.A')!.name).toBe('Model A')
    expect(result.models.find((m) => m.modelId === 'Model.B')!.name).toBe('Model B')

    expect(result.assignments).toHaveLength(1)
    expect(result.assignments[0]).toEqual({
      parentModelId: 'Model.A',
      childModelId: 'Model.B',
      occurrenceIds: ['Occ.A1', 'Occ.A2'],
      count: 2
    })
  })

  it('emits no edge when a linking def has zero occurrences in the parent model', () => {
    const xml = aml(`
      ${model('Model.A', 'MT_EEPC', '', modelName('Model A'))}
      ${model('Model.B', 'MT_EEPC', '', modelName('Model B'))}
      ${objDef('Def.L1', 'Model.B')}
    `)

    const result = scanArisModelSource(xml)

    expect(result.models).toHaveLength(2)
    expect(result.assignments).toHaveLength(0)
  })

  it('ignores a commented-out Model tag', () => {
    const xml = aml(`
      <!-- ${model('Model.C', 'MT_EEPC', '', modelName('Model C'))} -->
      ${model('Model.A', 'MT_EEPC', '', modelName('Model A'))}
    `)

    const result = scanArisModelSource(xml)

    expect(result.models).toHaveLength(1)
    expect(result.models[0]!.modelId).toBe('Model.A')
  })

  it('prefers English, falls back to Arabic, then null', () => {
    const xml = aml(`
      ${model(
        'Model.A',
        'MT_EEPC',
        '',
        `
        <AttrDef AttrDef.Type="AT_NAME">
          <AttrValue LocaleId="&LocaleId.AEar;">عربي</AttrValue>
          <AttrValue LocaleId="&LocaleId.USen;">English</AttrValue>
        </AttrDef>
      `
      )}
    `)

    expect(scanArisModelSource(xml).models[0]!.name).toBe('English')
  })

  it('returns the Arabic name when no English value is present', () => {
    const xml = aml(`
      ${model(
        'Model.A',
        'MT_EEPC',
        '',
        `
        <AttrDef AttrDef.Type="AT_NAME">
          <AttrValue LocaleId="&LocaleId.AEar;">عربي</AttrValue>
        </AttrDef>
      `
      )}
    `)

    expect(scanArisModelSource(xml).models[0]!.name).toBe('عربي')
  })

  it('returns null name when the model has no AT_NAME', () => {
    const xml = aml(
      model('Model.A', 'MT_EEPC', '', '<ObjOcc ObjOcc.ID="Occ.1" ObjDef.IdRef="Def.1"/>')
    )

    expect(scanArisModelSource(xml).models[0]!.name).toBeNull()
  })

  it('does not confuse a Lane AT_NAME with the model AT_NAME', () => {
    const xml = aml(`
      ${model(
        'Model.A',
        'MT_EEPC',
        '',
        `
        ${modelName('Model A')}
        <Lane Lane.ID="Lane.1">
          <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="&LocaleId.USen;">.</AttrValue></AttrDef>
        </Lane>
        ${objOcc('Occ.1', 'Def.1')}
      `
      )}
    `)

    expect(scanArisModelSource(xml).models[0]!.name).toBe('Model A')
  })

  it('ignores a model AT_NAME that appears after the first ObjOcc', () => {
    const xml = aml(`
      ${model(
        'Model.A',
        'MT_EEPC',
        '',
        `
        ${objOcc('Occ.1', 'Def.1')}
        ${modelName('Late Name')}
      `
      )}
    `)

    expect(scanArisModelSource(xml).models[0]!.name).toBeNull()
  })

  it('merges edges from multiple defs linking the same child in the same parent', () => {
    const xml = aml(`
      ${model(
        'Model.A',
        'MT_EEPC',
        '',
        `
        ${modelName('Model A')}
        ${objOcc('Occ.A1', 'Def.L1')}
        ${objOcc('Occ.A2', 'Def.L2')}
      `
      )}
      ${model('Model.B', 'MT_EEPC', '', modelName('Model B'))}
      ${objDef('Def.L1', 'Model.B')}
      ${objDef('Def.L2', 'Model.B')}
    `)

    const result = scanArisModelSource(xml)

    expect(result.assignments).toHaveLength(1)
    expect(result.assignments[0]).toEqual({
      parentModelId: 'Model.A',
      childModelId: 'Model.B',
      occurrenceIds: ['Occ.A1', 'Occ.A2'],
      count: 2
    })
  })
})

describe('deriveArisLinksFromDocument', () => {
  it('matches the text scan of equivalent AML', () => {
    const xml = aml(`
      ${model(
        'Model.A',
        'MT_EEPC',
        '',
        `
        ${modelName('Model A')}
        ${objOcc('Occ.A1', 'Def.L1')}
        ${objOcc('Occ.A2', 'Def.L1')}
      `
      )}
      ${model('Model.B', 'MT_EEPC', '', modelName('Model B'))}
      ${objDef('Def.L1', 'Model.B')}
    `)

    const textResult = scanArisModelSource(xml)
    const document = buildWorkingDocument(textResult)
    const derived = deriveArisLinksFromDocument(document)

    expect(derived.models).toEqual(textResult.models)
    expect(derived.assignments).toEqual(textResult.assignments)
  })
})

interface MutableModel {
  id: string
  type: string | null
  names: { values: Record<string, string>; fallback: null }
  attributes: unknown[]
  occurrences: MutableOccurrence[]
  connectionOccurrences: unknown[]
  lanes: unknown[]
  freeText: unknown[]
  attachments: unknown[]
  layout: {
    scale: null
    gridSize: null
    backColor: null
    printScale: null
    curveRadius: null
    arcRadius: null
  }
  unsupported: false
  rawSourceRecord: null
}

interface MutableOccurrence {
  id: string
  definitionId: string
  modelId: string
  symbol: string
  bounds: { x: number; y: number; width: number; height: number }
  style: {
    symbol: null
    fillColor: null
    strokeColor: null
    strokeWidth: null
    lineStyle: null
    fontStyleSheetId: null
    zOrder: null
  }
  attributeOccurrences: unknown[]
  rawAttributes: Record<string, never>
}

interface MutableObjectDefinition {
  id: string
  type: string
  defaultSymbol: null
  names: { values: Record<string, string>; fallback: null }
  attributes: unknown[]
  linkedModelIds: string[]
  rawAttributes: Record<string, never>
}

function buildWorkingDocument(result: ArisModelScanResult): ArisWorkingDocument {
  const models = new Map<string, MutableModel>()
  for (const m of result.models) {
    models.set(m.modelId, {
      id: m.modelId,
      type: m.modelType,
      names: { values: m.name ? { en: m.name } : {}, fallback: null },
      attributes: [],
      occurrences: [],
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
    })
  }

  const objectDefinitions = new Map<string, MutableObjectDefinition>()
  const occsByDef = new Map<string, string[]>()
  for (const a of result.assignments) {
    for (const occId of a.occurrenceIds) {
      const list = occsByDef.get(a.childModelId) ?? []
      list.push(occId)
      occsByDef.set(a.childModelId, list)
    }
  }

  for (const a of result.assignments) {
    const defId = `Def.${a.childModelId}`
    if (!objectDefinitions.has(defId)) {
      objectDefinitions.set(defId, {
        id: defId,
        type: 'OT_FUNC',
        defaultSymbol: null,
        names: { values: {}, fallback: null },
        attributes: [],
        linkedModelIds: [a.childModelId],
        rawAttributes: {}
      })
    }
  }

  for (const a of result.assignments) {
    const parentModel = models.get(a.parentModelId)
    if (!parentModel) continue
    for (const occId of a.occurrenceIds) {
      parentModel.occurrences.push({
        id: occId,
        definitionId: `Def.${a.childModelId}`,
        modelId: a.parentModelId,
        symbol: 'ST_FUNC',
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        style: {
          symbol: null,
          fillColor: null,
          strokeColor: null,
          strokeWidth: null,
          lineStyle: null,
          fontStyleSheetId: null,
          zOrder: null
        },
        attributeOccurrences: [],
        rawAttributes: {}
      })
    }
  }

  return {
    database: {
      databaseName: null,
      createDate: null,
      createTime: null,
      userName: null,
      arisExeVersion: null
    },
    models,
    objectDefinitions,
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
  } as unknown as ArisWorkingDocument
}

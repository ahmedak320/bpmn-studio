import { describe, expect, it } from 'vitest'

import { buildValidFixtureWorkbook } from '../excel/testFixtures'
import { parseArisWorkbook } from '../excel/workbookParser'
import type { ArisWorkbookModel } from '../excel/workbookModel'
import { buildAmlFromArisWorkbook } from './arisExcelCreate'

function acceptedModel(
  overrides: Parameters<typeof buildValidFixtureWorkbook>[0]
): ArisWorkbookModel {
  const result = parseArisWorkbook('auto-chain.xlsx', buildValidFixtureWorkbook(overrides))
  expect(result.status).toBe('accepted')
  if (result.status !== 'accepted' || !result.model) throw new Error('Expected accepted workbook')
  return result.model
}

describe('create-from-Excel auto-chain synthesis', () => {
  it('chains only control-flow objects by order, then row, with deterministic ids and types', () => {
    const model = acceptedModel({
      Objects: [
        {
          model_id: 'MDL_1',
          object_id: 'OBJ_EVT',
          occurrence_id: 'OCC_EVT',
          object_type: 'OT_EVT',
          symbol_type: 'ST_EV',
          name_en: 'Event',
          order: 2
        },
        {
          model_id: 'MDL_1',
          object_id: 'OBJ_SATELLITE',
          occurrence_id: 'OCC_SATELLITE',
          object_type: 'OT_APPL_SYS',
          symbol_type: 'ST_APPL_SYS',
          name_en: 'System',
          order: 0
        },
        {
          model_id: 'MDL_1',
          object_id: 'OBJ_FUNC',
          occurrence_id: 'OCC_FUNC',
          object_type: 'OT_FUNC',
          symbol_type: 'ST_FUNC',
          name_en: 'Function',
          order: 1
        },
        {
          model_id: 'MDL_1',
          object_id: 'OBJ_RULE',
          occurrence_id: 'OCC_RULE',
          object_type: 'OT_RULE',
          symbol_type: 'ST_OPR_XOR_1',
          name_en: 'Rule'
        }
      ],
      Connections: []
    })

    const aml = buildAmlFromArisWorkbook(model)
    expect(aml.connectionCount).toBe(2)
    expect(aml.xml).toContain('CxnDef.ID="CxnDef.auto.MDL_1.1" CxnDef.Type="CT_CRT_1"')
    expect(aml.xml).toContain('CxnOcc.ID="CxnOcc.auto.MDL_1.1"')
    expect(aml.xml).toContain('ToObjOcc.IdRef="ObjOcc.OCC_EVT"')
    expect(aml.xml).toContain('CxnDef.ID="CxnDef.auto.MDL_1.2" CxnDef.Type="CT_ACT_1"')
    expect(aml.xml).toContain('ToObjOcc.IdRef="ObjOcc.OCC_RULE"')
    expect(aml.xml).not.toContain('ToObjOcc.IdRef="ObjOcc.OCC_SATELLITE"')
  })

  it('leaves a model with any authored connection completely untouched', () => {
    const model = acceptedModel({})
    const aml = buildAmlFromArisWorkbook(model)
    expect(aml.connectionCount).toBe(1)
    expect(aml.xml).toContain('CxnDef.CXN_1')
    expect(aml.xml).not.toContain('CxnDef.auto.')
  })
})

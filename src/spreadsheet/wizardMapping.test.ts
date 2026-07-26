import { describe, expect, it } from 'vitest'

import type { ParsedWorkbookData } from './contracts'
import { mappingReviewIssues, suggestedMappingPreset } from './wizardMapping'

const workbook: ParsedWorkbookData = {
  sheets: [
    {
      name: 'Data',
      rows: [
        [
          { value: 'Process ID' },
          { value: 'Step ID' },
          { value: 'Order' },
          { value: 'Type' },
          { value: 'Name EN' },
          { value: 'Name AR' }
        ],
        [
          { value: 'p1' },
          { value: 's1' },
          { value: 1 },
          { value: 'task' },
          { value: 'Review' },
          { value: 'مراجعة' }
        ]
      ]
    }
  ]
}

describe('spreadsheet mapping wizard helpers', () => {
  it('suggests the steps sheet, header and bilingual/ID/order/type columns', () => {
    const preset = suggestedMappingPreset(workbook)
    expect(preset.selectedSheets.steps).toEqual({
      worksheet: 'Data',
      headerRow: 1
    })
    expect(preset.fieldMappings.steps).toMatchObject({
      process_id: 'Process ID',
      step_id: 'Step ID',
      order: 'Order',
      type: 'Type',
      name_en: 'Name EN',
      name_ar: 'Name AR'
    })
    expect(preset.selectedSheets.processes).toBeUndefined()
    expect(preset.selectedSheets.participants).toBeUndefined()
    expect(preset.selectedSheets.flows).toBeUndefined()
    expect(preset.selectedSheets.glossary).toBeUndefined()
    expect(mappingReviewIssues(workbook, preset, new Set())).toEqual([])
  })

  it('requires explicit confirmation for a manually chosen low-confidence header', () => {
    const base = suggestedMappingPreset(workbook)
    const preset = {
      ...base,
      fieldMappings: {
        ...base.fieldMappings,
        steps: {
          ...base.fieldMappings.steps,
          type: 'Order'
        }
      }
    }
    expect(
      mappingReviewIssues(workbook, preset, new Set()).some(
        ({ code }) => code === 'low-confidence-mapping'
      )
    ).toBe(true)
    expect(
      mappingReviewIssues(workbook, preset, new Set(['steps.type'])).some(
        ({ code }) => code === 'low-confidence-mapping'
      )
    ).toBe(false)
  })
})

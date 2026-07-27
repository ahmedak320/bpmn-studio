import { describe, expect, it } from 'vitest'

import type { ParsedWorkbookData } from './contracts'
import {
  allMappedRequiredFields,
  mappingReviewIssues,
  suggestedMappingPreset
} from './wizardMapping'

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

  it.each([
    ['English', 'Name EN'],
    ['Arabic', 'Name AR']
  ])(
    'hands off ordinary %s-only process, participant, and step sheets for bilingual review',
    (_, nameHeader) => {
      const singleLanguageWorkbook: ParsedWorkbookData = {
        sheets: [
          {
            name: 'Processes',
            rows: [
              [{ value: 'Process ID' }, { value: nameHeader }, { value: 'Description EN' }],
              [{ value: 'p1' }, { value: 'Onboarding' }, { value: 'Employee onboarding' }]
            ]
          },
          {
            name: 'Participants',
            rows: [
              [
                { value: 'Process ID' },
                { value: 'Participant ID' },
                { value: 'Type' },
                { value: nameHeader }
              ],
              [{ value: 'p1' }, { value: 'pool-1' }, { value: 'pool' }, { value: 'People' }]
            ]
          },
          {
            name: 'Steps',
            rows: [
              [
                { value: 'Process ID' },
                { value: 'Step ID' },
                { value: 'Type' },
                { value: nameHeader }
              ],
              [{ value: 'p1' }, { value: 'step-1' }, { value: 'task' }, { value: 'Review' }]
            ]
          }
        ]
      }
      const preset = suggestedMappingPreset(singleLanguageWorkbook)
      const mappedLanguage = nameHeader === 'Name EN' ? 'name_en' : 'name_ar'
      const missingLanguage = nameHeader === 'Name EN' ? 'name_ar' : 'name_en'

      expect(preset.selectedSheets).toMatchObject({
        processes: { worksheet: 'Processes', headerRow: 1 },
        participants: { worksheet: 'Participants', headerRow: 1 },
        steps: { worksheet: 'Steps', headerRow: 1 }
      })
      for (const role of ['processes', 'participants', 'steps'] as const) {
        expect(preset.fieldMappings[role]?.[mappedLanguage]).toBe(nameHeader)
        expect(preset.fieldMappings[role]?.[missingLanguage]).toBeUndefined()
      }
      expect(
        mappingReviewIssues(singleLanguageWorkbook, preset, allMappedRequiredFields(preset))
      ).toEqual([])
    }
  )

  it('keeps English and Arabic glossary columns independently required', () => {
    const preset = suggestedMappingPreset(workbook)
    const glossaryWorkbook: ParsedWorkbookData = {
      ...workbook,
      sheets: [
        ...workbook.sheets,
        {
          name: 'Glossary',
          rows: [[{ value: 'English' }], [{ value: 'Approve' }]]
        }
      ]
    }
    const withGlossary = {
      ...preset,
      selectedSheets: {
        ...preset.selectedSheets,
        glossary: { worksheet: 'Glossary', headerRow: 1 }
      },
      fieldMappings: {
        ...preset.fieldMappings,
        glossary: { english: 'English' }
      }
    }

    expect(
      mappingReviewIssues(glossaryWorkbook, withGlossary, allMappedRequiredFields(withGlossary))
    ).toContainEqual(
      expect.objectContaining({
        code: 'missing-required-mapping',
        normalizedValue: 'arabic'
      })
    )
  })
})

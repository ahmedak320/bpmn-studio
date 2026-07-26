import { describe, expect, it } from 'vitest'
import { localizationSourceForGeneration } from '../generationSource'
import { LocalizationSource } from '../types'

describe('localizationSourceForGeneration', () => {
  it.each([
    [{ mode: 'description' as const }, LocalizationSource.Ai],
    [
      {
        mode: 'description' as const,
        descriptionAttachmentKind: 'docx' as const
      },
      LocalizationSource.Docx
    ],
    [
      {
        mode: 'description' as const,
        descriptionAttachmentKind: 'pdf' as const
      },
      LocalizationSource.Pdf
    ],
    [{ mode: 'pdf' as const, documentKind: 'pdf' as const }, LocalizationSource.Pdf],
    [{ mode: 'pdf' as const, documentKind: 'image' as const }, LocalizationSource.Image],
    [{ mode: 'spreadsheet' as const }, LocalizationSource.Excel]
  ])('maps %o to %s provenance', (input, expected) => {
    expect(localizationSourceForGeneration(input)).toBe(expected)
  })
})

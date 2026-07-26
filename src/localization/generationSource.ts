import { LocalizationSource, type LocalizationSource as LocalizationSourceType } from './types'

export interface GenerationLocalizationInput {
  mode: 'description' | 'pdf' | 'spreadsheet'
  documentKind?: 'pdf' | 'image'
  descriptionAttachmentKind?: 'docx' | 'pdf'
}

/**
 * Preserve the user-visible ingestion boundary that supplied an AI-generated
 * diagram. The generated XML is still provider output, but audit provenance
 * must identify whether its source material was typed, PDF, image, DOCX, or a
 * spreadsheet.
 */
export function localizationSourceForGeneration(
  input: GenerationLocalizationInput
): LocalizationSourceType {
  if (input.mode === 'spreadsheet') return LocalizationSource.Excel
  if (input.mode === 'pdf') {
    return input.documentKind === 'image' ? LocalizationSource.Image : LocalizationSource.Pdf
  }
  if (input.descriptionAttachmentKind === 'docx') {
    return LocalizationSource.Docx
  }
  if (input.descriptionAttachmentKind === 'pdf') {
    return LocalizationSource.Pdf
  }
  return LocalizationSource.Ai
}

import { describe, expect, it } from 'vitest'
import { CANONICAL_FIELDS_BY_SHEET, normalizeHeader } from './aliases'
import {
  MAPPING_PRESET_VERSION,
  OFFICIAL_TEMPLATE_VERSION,
  type MappingPreset,
  type ParsedWorkbookData
} from './contracts'
import { SpreadsheetError } from './errors'
import { headerSignature, mappingConfirmationIssues, suggestHeaderMappings } from './mapping'
import {
  parseMappingPresetJson,
  presetMatchesHeaderSignatures,
  serializeMappingPreset
} from './mappingPreset'
import { detectOfficialTemplate, OFFICIAL_SHEET_NAMES } from './officialTemplate'

function validPreset(): MappingPreset {
  const signature = headerSignature(['process_id', 'type', 'name_en', 'name_ar'])
  return {
    version: MAPPING_PRESET_VERSION,
    name: 'HR recurring workbook',
    headerSignatures: { steps: signature },
    selectedSheets: { steps: { worksheet: 'Activities', headerRow: 2 } },
    fieldMappings: {
      steps: {
        process_id: 'Process Code',
        type: 'Activity Type',
        name_en: 'English name',
        name_ar: 'الاسم بالعربية'
      }
    },
    valueMappings: {
      stepTypes: { approval: 'userTask' },
      participantTypes: { department: 'lane' }
    },
    delimiters: { list: ['\n', ';'] },
    inference: {
      flowMode: 'auto',
      syntheticBoundaries: 'review',
      requireGatewayConditions: true
    },
    locale: 'ar'
  }
}

describe('English and Arabic header mapping', () => {
  it('normalizes diacritics, Arabic letter variants, punctuation, and BOM', () => {
    expect(normalizeHeader('\ufeff مُعَرِّفُ العَمَليّة ')).toBe('معرف العملية')
    expect(normalizeHeader('Process_ID')).toBe('process id')
    expect(normalizeHeader('إلى-الخطوة')).toBe('الي الخطوة')
  })

  it('maps common English and Arabic aliases with explicit confidence', () => {
    const suggestions = suggestHeaderMappings('steps', [
      'رمز العملية',
      'معرف الخطوة',
      'الترتيب',
      'نوع النشاط',
      'English name',
      'الاسم بالعربية',
      'معرفات الخطوات التالية'
    ])
    const byField = new Map(suggestions.map((suggestion) => [suggestion.field, suggestion]))
    expect(byField.get('process_id')).toMatchObject({
      header: 'رمز العملية',
      confidence: 0.98,
      confirmationRequired: false
    })
    expect(byField.get('type')).toMatchObject({
      header: 'نوع النشاط',
      confidence: 0.98
    })
    expect(byField.get('name_ar')).toMatchObject({
      header: 'الاسم بالعربية',
      confidence: 0.98
    })
    expect(byField.get('next_step_ids')?.header).toBe('معرفات الخطوات التالية')
  })

  it('requires confirmation for missing or low-confidence required mappings', () => {
    const suggestions = suggestHeaderMappings('steps', ['proces ident', 'kind-ish', 'label maybe'])
    const issues = mappingConfirmationIssues('Sheet1', suggestions, new Set())
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.every(({ severity }) => severity === 'review')).toBe(true)
    expect(issues.some(({ normalizedValue }) => normalizedValue === 'name_ar')).toBe(true)
    expect(issues.every(({ guidanceKey }) => guidanceKey?.includes('confirm-field-mapping'))).toBe(
      true
    )
  })

  it('creates stable, order-sensitive header signatures', () => {
    expect(headerSignature(['Process ID', 'Name EN'])).toBe(
      headerSignature([' process_id ', 'name-en'])
    )
    expect(headerSignature(['Process ID', 'Name EN'])).not.toBe(
      headerSignature(['Name EN', 'Process ID'])
    )
  })
})

describe('versioned mapping presets', () => {
  it('round-trips a strict data-free preset with stable JSON', () => {
    const preset = validPreset()
    const serialized = serializeMappingPreset(preset)
    const parsed = parseMappingPresetJson(serialized)

    expect(parsed).toEqual(preset)
    expect(serializeMappingPreset(parsed)).toBe(serialized)
    expect(serialized).not.toMatch(/credential|password|apiKey|workbookData/)
    expect(
      presetMatchesHeaderSignatures(parsed, {
        steps: preset.headerSignatures.steps
      })
    ).toBe(true)
    expect(
      presetMatchesHeaderSignatures(parsed, {
        steps: headerSignature(['different'])
      })
    ).toBe(false)
  })

  it('migrates version 1 presets with empty reviewed value mappings', () => {
    const legacy = JSON.parse(JSON.stringify(validPreset())) as Record<string, unknown>
    legacy.version = 1
    delete legacy.valueMappings

    expect(parseMappingPresetJson(JSON.stringify(legacy))).toMatchObject({
      version: MAPPING_PRESET_VERSION,
      valueMappings: { stepTypes: {}, participantTypes: {} }
    })
  })

  it('normalizes and strictly validates reviewed type-value mappings', () => {
    const raw = JSON.parse(JSON.stringify(validPreset())) as Record<string, unknown>
    raw.valueMappings = {
      stepTypes: { '  مُوَافَقَة  ': 'userTask' },
      participantTypes: { Department: 'lane' }
    }
    expect(parseMappingPresetJson(JSON.stringify(raw)).valueMappings).toEqual({
      stepTypes: { موافقة: 'userTask' },
      participantTypes: { department: 'lane' }
    })

    const invalid = JSON.parse(JSON.stringify(validPreset())) as Record<string, unknown>
    invalid.valueMappings = { stepTypes: { custom: 'madeUpType' }, participantTypes: {} }
    expect(() => parseMappingPresetJson(JSON.stringify(invalid))).toThrow(SpreadsheetError)
  })

  it('rejects workbook rows, credentials, comma list defaults, and widened fields', () => {
    for (const mutate of [
      (preset: Record<string, unknown>) => {
        preset.rows = [['secret workbook value']]
      },
      (preset: Record<string, unknown>) => {
        preset.apiKey = 'secret'
      },
      (preset: Record<string, unknown>) => {
        ;(preset.delimiters as { list: string[] }).list = [',']
      },
      (preset: Record<string, unknown>) => {
        ;(preset.fieldMappings as Record<string, Record<string, string>>).steps.unknown_field =
          'Anything'
      }
    ]) {
      const raw = JSON.parse(JSON.stringify(validPreset())) as Record<string, unknown>
      mutate(raw)
      expect(() => parseMappingPresetJson(JSON.stringify(raw))).toThrow(SpreadsheetError)
    }
  })

  it('fails closed for every malformed preset contract branch', () => {
    const reject = (mutate: (raw: Record<string, unknown>) => void): void => {
      const raw = JSON.parse(JSON.stringify(validPreset())) as Record<string, unknown>
      mutate(raw)
      expect(() => parseMappingPresetJson(JSON.stringify(raw))).toThrow(SpreadsheetError)
    }

    expect(() => parseMappingPresetJson('{')).toThrow(SpreadsheetError)
    expect(() => parseMappingPresetJson('[]')).toThrow(SpreadsheetError)
    reject((raw) => {
      raw.version = 99
    })
    reject((raw) => {
      raw.name = ''
    })
    reject((raw) => {
      raw.name = 'x'.repeat(121)
    })
    reject((raw) => {
      raw.locale = 'fr'
    })
    reject((raw) => {
      raw.headerSignatures = []
    })
    reject((raw) => {
      raw.headerSignatures = { unknown: 'orbitpm-header-v1-0000000000000000' }
    })
    reject((raw) => {
      raw.headerSignatures = { steps: 'bad-signature' }
    })
    reject((raw) => {
      raw.selectedSheets = []
    })
    reject((raw) => {
      ;(raw.selectedSheets as Record<string, unknown>).steps = 'Activities'
    })
    reject((raw) => {
      ;(raw.selectedSheets as Record<string, unknown>).steps = {
        worksheet: '',
        headerRow: 1
      }
    })
    for (const headerRow of [0, 1.5, 50_001]) {
      reject((raw) => {
        ;(raw.selectedSheets as Record<string, unknown>).steps = {
          worksheet: 'Activities',
          headerRow
        }
      })
    }
    reject((raw) => {
      raw.fieldMappings = []
    })
    reject((raw) => {
      ;(raw.fieldMappings as Record<string, unknown>).steps = 'bad'
    })
    reject((raw) => {
      ;(raw.fieldMappings as Record<string, Record<string, string>>).steps = {
        process_id: 'Same',
        type: 'Same'
      }
    })
    reject((raw) => {
      raw.delimiters = []
    })
    for (const list of [[], [';', '|', '\n', '/', ':'], ['']]) {
      reject((raw) => {
        raw.delimiters = { list }
      })
    }
    reject((raw) => {
      raw.delimiters = { list: ['abc'] }
    })
    reject((raw) => {
      raw.inference = []
    })
    reject((raw) => {
      raw.inference = {
        flowMode: 'guess',
        syntheticBoundaries: 'review',
        requireGatewayConditions: true
      }
    })
    reject((raw) => {
      raw.inference = {
        flowMode: 'auto',
        syntheticBoundaries: 'always',
        requireGatewayConditions: true
      }
    })
    reject((raw) => {
      raw.inference = {
        flowMode: 'auto',
        syntheticBoundaries: 'review',
        requireGatewayConditions: false
      }
    })

    expect(presetMatchesHeaderSignatures({ ...validPreset(), headerSignatures: {} }, {})).toBe(
      false
    )
  })
})

describe('official-template detection', () => {
  function officialWorkbook(): ParsedWorkbookData {
    return {
      customProperties: { OrbitPMTemplateVersion: OFFICIAL_TEMPLATE_VERSION },
      sheets: (Object.keys(OFFICIAL_SHEET_NAMES) as Array<keyof typeof OFFICIAL_SHEET_NAMES>).map(
        (role) => ({
          name: OFFICIAL_SHEET_NAMES[role],
          rows: [CANONICAL_FIELDS_BY_SHEET[role].map((value) => ({ value }))]
        })
      )
    }
  }

  it('requires all five official sheets/full header contracts and recognizes the version', () => {
    const result = detectOfficialTemplate(officialWorkbook())
    expect(result.official).toBe(true)
    expect(result.confidence).toBe(1)
    expect(result.templateVersion).toBe(OFFICIAL_TEMPLATE_VERSION)
    expect(Object.keys(result.selectedSheets)).toHaveLength(5)
    expect(result.issues).toEqual([])
  })

  it('does not misclassify an ordinary workbook or an unsupported template version', () => {
    const missing = officialWorkbook()
    const missingResult = detectOfficialTemplate({
      ...missing,
      sheets: missing.sheets.slice(0, 4)
    })
    expect(missingResult.official).toBe(false)
    expect(missingResult.issues.some(({ code }) => code.includes('sheet-missing'))).toBe(true)

    const versionResult = detectOfficialTemplate({
      ...officialWorkbook(),
      customProperties: { OrbitPMTemplateVersion: '99' }
    })
    expect(versionResult.official).toBe(false)
    expect(versionResult.issues).toContainEqual(
      expect.objectContaining({ code: 'official-template-version-unsupported' })
    )
  })

  it('accepts a structural template without a marker and reports partial headers', () => {
    const structural = officialWorkbook()
    const withoutMarker = { sheets: structural.sheets }
    expect(detectOfficialTemplate(withoutMarker)).toMatchObject({
      official: true,
      confidence: 0.95
    })

    const processes = structural.sheets.find(({ name }) => name === OFFICIAL_SHEET_NAMES.processes)!
    const requiredOnly = CANONICAL_FIELDS_BY_SHEET.processes.slice(0, 3)
    const partial = detectOfficialTemplate({
      ...structural,
      sheets: structural.sheets.map((sheet) =>
        sheet === processes
          ? {
              ...sheet,
              rows: [[{ value: null }], requiredOnly.map((value) => ({ value }))]
            }
          : sheet
      )
    })
    expect(partial.official).toBe(false)
    expect(partial.issues).toContainEqual(
      expect.objectContaining({
        code: 'official-template-header-mismatch',
        details: expect.objectContaining({ requiredFieldsFound: true })
      })
    )
  })
})

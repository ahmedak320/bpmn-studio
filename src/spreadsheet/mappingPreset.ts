import {
  CANONICAL_FIELDS_BY_SHEET
} from './aliases'
import {
  MAPPING_PRESET_VERSION,
  type CanonicalSheet,
  type MappingPreset
} from './contracts'
import { SpreadsheetError } from './errors'

const SHEETS: readonly CanonicalSheet[] = [
  'processes',
  'participants',
  'steps',
  'flows',
  'glossary'
]
const FORBIDDEN_KEY =
  /^(?:credentials?|password|secret|api.?key|tokens?|rows?|cells?|workbook.?data)$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  location: string
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key) || FORBIDDEN_KEY.test(key)) {
      throw new SpreadsheetError('invalid-mapping-preset', { location, key })
    }
  }
}

function assertString(value: unknown, location: string, maximum = 512): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new SpreadsheetError('invalid-mapping-preset', { location })
  }
}

function readSheetRecord(
  value: unknown,
  location: string,
  read: (entry: unknown, sheet: CanonicalSheet) => unknown
): Partial<Record<CanonicalSheet, unknown>> {
  if (!isRecord(value)) throw new SpreadsheetError('invalid-mapping-preset', { location })
  assertExactKeys(value, SHEETS, location)
  const output: Partial<Record<CanonicalSheet, unknown>> = {}
  for (const sheet of SHEETS) {
    if (value[sheet] !== undefined) output[sheet] = read(value[sheet], sheet)
  }
  return output
}

export function parseMappingPresetJson(json: string): MappingPreset {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (cause) {
    throw new SpreadsheetError('invalid-mapping-preset', { location: 'json' }, { cause })
  }
  if (!isRecord(raw)) throw new SpreadsheetError('invalid-mapping-preset', { location: 'root' })
  assertExactKeys(
    raw,
    [
      'version',
      'name',
      'headerSignatures',
      'selectedSheets',
      'fieldMappings',
      'delimiters',
      'inference',
      'locale'
    ],
    'root'
  )
  if (raw.version !== MAPPING_PRESET_VERSION) {
    throw new SpreadsheetError('invalid-mapping-preset', { location: 'version' })
  }
  assertString(raw.name, 'name', 120)
  if (raw.locale !== 'en' && raw.locale !== 'ar') {
    throw new SpreadsheetError('invalid-mapping-preset', { location: 'locale' })
  }

  const headerSignatures = readSheetRecord(
    raw.headerSignatures,
    'headerSignatures',
    (entry, sheet) => {
      assertString(entry, `headerSignatures.${sheet}`, 128)
      if (!/^orbitpm-header-v1-[0-9a-f]{16}$/.test(entry)) {
        throw new SpreadsheetError('invalid-mapping-preset', {
          location: `headerSignatures.${sheet}`
        })
      }
      return entry
    }
  ) as Partial<Record<CanonicalSheet, string>>

  const selectedSheets = readSheetRecord(
    raw.selectedSheets,
    'selectedSheets',
    (entry, sheet) => {
      if (!isRecord(entry)) {
        throw new SpreadsheetError('invalid-mapping-preset', {
          location: `selectedSheets.${sheet}`
        })
      }
      assertExactKeys(entry, ['worksheet', 'headerRow'], `selectedSheets.${sheet}`)
      assertString(entry.worksheet, `selectedSheets.${sheet}.worksheet`, 128)
      if (
        !Number.isInteger(entry.headerRow) ||
        (entry.headerRow as number) < 1 ||
        (entry.headerRow as number) > 50_000
      ) {
        throw new SpreadsheetError('invalid-mapping-preset', {
          location: `selectedSheets.${sheet}.headerRow`
        })
      }
      return Object.freeze({ worksheet: entry.worksheet, headerRow: entry.headerRow as number })
    }
  ) as MappingPreset['selectedSheets']

  const fieldMappings = readSheetRecord(
    raw.fieldMappings,
    'fieldMappings',
    (entry, sheet) => {
      if (!isRecord(entry)) {
        throw new SpreadsheetError('invalid-mapping-preset', {
          location: `fieldMappings.${sheet}`
        })
      }
      assertExactKeys(entry, CANONICAL_FIELDS_BY_SHEET[sheet], `fieldMappings.${sheet}`)
      const mapping: Record<string, string> = {}
      const seenHeaders = new Set<string>()
      for (const [field, header] of Object.entries(entry)) {
        assertString(header, `fieldMappings.${sheet}.${field}`, 256)
        if (seenHeaders.has(header)) {
          throw new SpreadsheetError('invalid-mapping-preset', {
            location: `fieldMappings.${sheet}.${field}`,
            reason: 'duplicate-header'
          })
        }
        seenHeaders.add(header)
        mapping[field] = header
      }
      return Object.freeze(mapping)
    }
  ) as MappingPreset['fieldMappings']

  if (!isRecord(raw.delimiters)) {
    throw new SpreadsheetError('invalid-mapping-preset', { location: 'delimiters' })
  }
  assertExactKeys(raw.delimiters, ['list'], 'delimiters')
  if (
    !Array.isArray(raw.delimiters.list) ||
    raw.delimiters.list.length === 0 ||
    raw.delimiters.list.length > 4
  ) {
    throw new SpreadsheetError('invalid-mapping-preset', { location: 'delimiters.list' })
  }
  const delimiters = raw.delimiters.list.map((delimiter, index) => {
    assertString(delimiter, `delimiters.list.${index}`, 2)
    if (delimiter === ',') {
      throw new SpreadsheetError('invalid-mapping-preset', {
        location: `delimiters.list.${index}`,
        reason: 'comma-is-not-default-list-delimiter'
      })
    }
    return delimiter
  })

  if (!isRecord(raw.inference)) {
    throw new SpreadsheetError('invalid-mapping-preset', { location: 'inference' })
  }
  assertExactKeys(
    raw.inference,
    ['flowMode', 'syntheticBoundaries', 'requireGatewayConditions'],
    'inference'
  )
  if (
    !['explicit', 'next-step', 'numeric-order', 'auto'].includes(
      raw.inference.flowMode as string
    ) ||
    !['review', 'never'].includes(raw.inference.syntheticBoundaries as string) ||
    raw.inference.requireGatewayConditions !== true
  ) {
    throw new SpreadsheetError('invalid-mapping-preset', { location: 'inference' })
  }

  return Object.freeze({
    version: MAPPING_PRESET_VERSION,
    name: raw.name,
    headerSignatures: Object.freeze(headerSignatures),
    selectedSheets: Object.freeze(selectedSheets),
    fieldMappings: Object.freeze(fieldMappings),
    delimiters: Object.freeze({ list: Object.freeze(delimiters) }),
    inference: Object.freeze({
      flowMode: raw.inference.flowMode as MappingPreset['inference']['flowMode'],
      syntheticBoundaries:
        raw.inference.syntheticBoundaries as MappingPreset['inference']['syntheticBoundaries'],
      requireGatewayConditions: true
    }),
    locale: raw.locale
  })
}

function sortForJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForJson)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortForJson(value[key])])
  )
}

export function serializeMappingPreset(preset: MappingPreset): string {
  // Round-trip through the strict allowlist before export. This prevents a
  // structurally widened runtime object from leaking workbook rows/credentials.
  const validated = parseMappingPresetJson(JSON.stringify(preset))
  return `${JSON.stringify(sortForJson(validated), null, 2)}\n`
}

export function presetMatchesHeaderSignatures(
  preset: MappingPreset,
  signatures: Readonly<Partial<Record<CanonicalSheet, string>>>
): boolean {
  const expected = Object.entries(preset.headerSignatures)
  return (
    expected.length > 0 &&
    expected.every(([sheet, signature]) => signatures[sheet as CanonicalSheet] === signature)
  )
}

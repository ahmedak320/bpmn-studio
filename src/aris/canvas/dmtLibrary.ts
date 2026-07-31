import { ar, en } from '../../i18n/dictionaries'
import { ARIS_CONVENTION_SYMBOLS, type ArisConventionSymbol } from '../conventions/catalog'
import {
  ARIS_CONNECTION_RULES,
  isLegalConnection,
  type ArisConnectionRule
} from '../conventions/connectionRules'
import { DMT_SYMBOL_FINGERPRINTS, type DmtSymbolDescriptor } from '../symbols/shapes'
import { resolveArisCatalogSymbol } from '../symbols'
import type { DmtLibraryMessageKey } from '../shell/dmtLibraryI18n'

export type DmtLibraryGroupId =
  | 'flow-decisions'
  | 'roles-organization'
  | 'systems-data'
  | 'governance-performance'
  | 'services'
  | 'vacd'

export interface DmtLibraryGroup {
  readonly id: DmtLibraryGroupId
  readonly labelKey: DmtLibraryMessageKey
  readonly order: number
}

export const DMT_LIBRARY_GROUPS: readonly DmtLibraryGroup[] = Object.freeze([
  Object.freeze({
    id: 'flow-decisions',
    labelKey: 'aris.library.group.flowDecisions',
    order: 10
  }),
  Object.freeze({
    id: 'roles-organization',
    labelKey: 'aris.library.group.rolesOrganization',
    order: 20
  }),
  Object.freeze({
    id: 'systems-data',
    labelKey: 'aris.library.group.systemsData',
    order: 30
  }),
  Object.freeze({
    id: 'governance-performance',
    labelKey: 'aris.library.group.governancePerformance',
    order: 40
  }),
  Object.freeze({ id: 'services', labelKey: 'aris.library.group.services', order: 50 }),
  Object.freeze({ id: 'vacd', labelKey: 'aris.library.group.vacd', order: 60 })
])

const GROUP_ORDER = new Map(DMT_LIBRARY_GROUPS.map((group) => [group.id, group.order]))

/**
 * Search-only synonyms from the convention manual. They never render as UI
 * copy; localized display names come from the registered symbol dictionaries.
 */
const SEARCH_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'epc.function': Object.freeze(['manual function', 'activity', 'step']),
  'epc.system-function': Object.freeze(['automated function', 'system activity']),
  'governance.business-rule': Object.freeze(['rule']),
  'governance.business-policy': Object.freeze(['policy']),
  'governance.sla': Object.freeze(['sla', 'service level agreement']),
  'governance.law-regulation': Object.freeze(['law', 'regulation', 'legislation']),
  'performance.measure': Object.freeze(['kpi', 'measure', 'performance']),
  'information.sms': Object.freeze(['sms', 'mobile', 'phone', 'handy']),
  'information.electronic-file': Object.freeze(['electronic document', 'folder', 'file']),
  'service.product-service': Object.freeze(['product', 'service']),
  'organization.committee-team': Object.freeze(['committee', 'team']),
  'organization.role': Object.freeze(['role', 'executor'])
})

export interface DmtLibraryItem {
  readonly catalog: ArisConventionSymbol
  readonly descriptor: DmtSymbolDescriptor
  readonly catalogId: string
  readonly objectType: string
  readonly symbolNum: string
  readonly labelKey: string
  readonly englishLabel: string
  readonly arabicLabel: string
  readonly aliases: readonly string[]
  readonly group: DmtLibraryGroupId
  readonly paletteOrder: number
  readonly variantCount: number
  /** V10 provider override: every convention presentation is authorable here. */
  readonly placementEnabled: true
  readonly catalogPlacementEnabled: boolean
  readonly descriptorFingerprint: string
}

function groupFor(entry: ArisConventionSymbol): DmtLibraryGroupId {
  if (entry.modelTypes.includes('MT_VAL_ADD_CHN_DGM')) return 'vacd'
  if (entry.objectType === 'OT_SERVICE') return 'services'
  if (entry.paletteGroup === 'flow' || entry.paletteGroup === 'rule') {
    return 'flow-decisions'
  }
  if (entry.paletteGroup === 'org') return 'roles-organization'
  if (entry.paletteGroup === 'data' || entry.paletteGroup === 'system') return 'systems-data'
  return 'governance-performance'
}

function dictionaryLabel(
  dictionary: Readonly<Record<string, string>>,
  entry: ArisConventionSymbol
): string {
  return dictionary[entry.labelKey] ?? entry.accessibleLabel
}

function variantCount(entry: ArisConventionSymbol): number {
  if (entry.family === null) return 1
  return ARIS_CONVENTION_SYMBOLS.filter((candidate) => candidate.family === entry.family).length
}

function itemFor(entry: ArisConventionSymbol): DmtLibraryItem {
  const descriptor = resolveArisCatalogSymbol(entry.catalogId)
  if (descriptor === null) {
    throw new Error(`The DMT library has no shared descriptor for ${entry.catalogId}.`)
  }
  return Object.freeze({
    catalog: entry,
    descriptor,
    catalogId: entry.catalogId,
    objectType: entry.objectType,
    symbolNum: entry.symbolNum,
    labelKey: entry.labelKey,
    englishLabel: dictionaryLabel(en, entry),
    arabicLabel: dictionaryLabel(ar, entry),
    aliases: SEARCH_ALIASES[entry.catalogId] ?? Object.freeze([]),
    group: groupFor(entry),
    paletteOrder: entry.paletteOrder,
    variantCount: variantCount(entry),
    placementEnabled: true,
    catalogPlacementEnabled: entry.placementEnabled,
    descriptorFingerprint: DMT_SYMBOL_FINGERPRINTS[entry.catalogId] ?? descriptor.key
  })
}

const ALL_ITEMS = Object.freeze(
  ARIS_CONVENTION_SYMBOLS.map(itemFor).sort((left, right) => {
    const groupDelta = (GROUP_ORDER.get(left.group) ?? 0) - (GROUP_ORDER.get(right.group) ?? 0)
    if (groupDelta !== 0) return groupDelta
    return left.paletteOrder - right.paletteOrder
  })
)

/** The authoritative, exact 36-presentation drawing-library inventory. */
export function dmtLibraryItems(modelType?: string): readonly DmtLibraryItem[] {
  if (modelType === undefined) return ALL_ITEMS
  return Object.freeze(ALL_ITEMS.filter((item) => item.catalog.modelTypes.includes(modelType)))
}

export function dmtLibraryItem(catalogId: string): DmtLibraryItem | null {
  return ALL_ITEMS.find((item) => item.catalogId === catalogId) ?? null
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLocaleLowerCase()
    .replace(/[_./-]+/gu, ' ')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
}

function searchableValues(item: DmtLibraryItem): readonly string[] {
  return [
    item.englishLabel,
    item.arabicLabel,
    item.catalog.accessibleLabel,
    item.objectType,
    item.symbolNum,
    item.catalogId,
    item.catalog.family ?? '',
    ...item.aliases
  ].map(normalize)
}

function isSubsequence(needle: string, haystack: string): boolean {
  let cursor = 0
  for (const character of haystack) {
    if (character === needle[cursor]) cursor += 1
    if (cursor === needle.length) return true
  }
  return needle.length === 0
}

function editDistance(left: string, right: string, ceiling: number): number {
  if (Math.abs(left.length - right.length) > ceiling) return ceiling + 1
  let previous = Array.from({ length: right.length + 1 }, (_unused, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    let rowMinimum = current[0]!
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1
      const value = Math.min(
        previous[rightIndex]! + 1,
        current[rightIndex - 1]! + 1,
        previous[rightIndex - 1]! + substitution
      )
      current.push(value)
      rowMinimum = Math.min(rowMinimum, value)
    }
    if (rowMinimum > ceiling) return ceiling + 1
    previous = current
  }
  return previous[right.length]!
}

function tokenMatches(token: string, values: readonly string[]): boolean {
  if (values.some((value) => value.includes(token))) return true
  if (token.length >= 3 && values.some((value) => isSubsequence(token, value))) return true
  if (token.length < 4) return false
  const ceiling = token.length >= 8 ? 2 : 1
  return values.some((value) =>
    value.split(' ').some((word) => editDistance(token, word, ceiling) <= ceiling)
  )
}

/**
 * Fuzzy, bilingual catalog search. Results remain in canonical group/order
 * rather than being flattened into a relevance-ranked list.
 */
export function searchDmtLibrary(query: string, modelType?: string): readonly DmtLibraryItem[] {
  const tokens = normalize(query).split(' ').filter(Boolean)
  if (tokens.length === 0) return Object.freeze([])
  return Object.freeze(
    dmtLibraryItems(modelType).filter((item) => {
      const values = searchableValues(item)
      return tokens.every((token) => tokenMatches(token, values))
    })
  )
}

export type DmtConnectionDirection = 'outgoing' | 'incoming'

export interface DmtConnectionHelper {
  readonly id: string
  readonly direction: DmtConnectionDirection
  readonly peerObjectType: string
  readonly peerCatalogId: string
  readonly connectionType: string
  readonly labelKey: string
  readonly raci: ArisConnectionRule['raci']
  readonly rule: ArisConnectionRule
}

function helperId(
  direction: DmtConnectionDirection,
  rule: ArisConnectionRule,
  peerCatalogId: string,
  ordinal: number
): string {
  const safe = (value: string): string => value.toLocaleLowerCase().replace(/[^a-z0-9]+/gu, '-')
  return [
    'quick-connect',
    direction,
    safe(rule.connectionType),
    safe(peerCatalogId),
    String(ordinal)
  ].join('.')
}

/**
 * Legal next-object affordances for one selected/hovered object. There is no
 * fallback helper: each result is backed by an exact connection-rule tuple.
 */
export function dmtConnectionHelpers(
  modelType: string,
  objectType: string
): readonly DmtConnectionHelper[] {
  const items = dmtLibraryItems(modelType)
  const helpers: DmtConnectionHelper[] = []
  for (const rule of ARIS_CONNECTION_RULES) {
    if (rule.modelType !== null && rule.modelType !== modelType) continue
    const directions: readonly DmtConnectionDirection[] =
      rule.from === objectType && rule.to === objectType
        ? ['outgoing', 'incoming']
        : rule.from === objectType
          ? ['outgoing']
          : rule.to === objectType
            ? ['incoming']
            : []
    for (const direction of directions) {
      const peerObjectType = direction === 'outgoing' ? rule.to : rule.from
      const peers = items.filter((item) => item.objectType === peerObjectType)
      for (const peer of peers) {
        const from = direction === 'outgoing' ? objectType : peerObjectType
        const to = direction === 'outgoing' ? peerObjectType : objectType
        if (!isLegalConnection(modelType, from, to, rule.connectionType)) continue
        helpers.push(
          Object.freeze({
            id: helperId(direction, rule, peer.catalogId, helpers.length),
            direction,
            peerObjectType,
            peerCatalogId: peer.catalogId,
            connectionType: rule.connectionType,
            labelKey: rule.labelKey,
            raci: rule.raci,
            rule
          })
        )
      }
    }
  }
  return Object.freeze(helpers)
}

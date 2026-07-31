/**
 * DMT presentation catalog.
 *
 * `catalogId` is the presentation identity. It deliberately does not collapse
 * the seven manual variants whose currently known objectType:symbolNum pair is
 * shared. Those rows remain discoverable but are excluded from placement until
 * a real export supplies an independent round-trip discriminator.
 *
 * Color values remain the convention-token inputs owned by the color lane.
 * Shape/icon metadata here mirrors `symbols/shapes.ts` and lets every preview
 * surface select the same descriptor without maintaining a glyph map.
 */

export type ArisSymbolVerification = 'fixture' | 'aris-doc' | 'unverified'

export type ArisSymbolFamilyId =
  'function' | 'infoCarrier' | 'orgPeople' | 'governance' | 'rule' | 'valueChain'

export type ArisCatalogSilhouette =
  | 'card'
  | 'event-chevron'
  | 'operator-circle'
  | 'process-interface'
  | 'value-chain-start'
  | 'value-chain-successor'

export interface ArisConventionSymbol {
  readonly catalogId: string
  readonly objectType: string
  readonly symbolNum: string
  readonly labelKey: string
  readonly accessibleLabel: string
  readonly family: ArisSymbolFamilyId | null
  readonly silhouette: ArisCatalogSilhouette
  readonly icon: string
  readonly operator: 'AND' | 'OR' | 'XOR' | null
  readonly defaultFill: string
  readonly defaultStroke: string
  readonly paletteGroup: 'flow' | 'rule' | 'org' | 'data' | 'system' | 'governance'
  readonly paletteOrder: number
  readonly modelTypes: readonly string[]
  readonly verification: ArisSymbolVerification
  readonly placementEnabled: boolean
  readonly placementDisabledReason: string | null
}

export const DEFAULT_STROKE = '#1a1a1a'
export const ROUND_TRIP_IDENTITY_UNVERIFIED = 'Round-trip identity not yet verified'

type CatalogInput = Omit<
  ArisConventionSymbol,
  'defaultStroke' | 'operator' | 'placementEnabled' | 'placementDisabledReason'
> & {
  readonly operator?: ArisConventionSymbol['operator']
  readonly placementEnabled?: boolean
}

function symbol(input: CatalogInput): ArisConventionSymbol {
  const placementEnabled = input.placementEnabled ?? true
  return Object.freeze({
    ...input,
    operator: input.operator ?? null,
    defaultStroke: DEFAULT_STROKE,
    modelTypes: Object.freeze([...input.modelTypes]),
    placementEnabled,
    placementDisabledReason: placementEnabled ? null : ROUND_TRIP_IDENTITY_UNVERIFIED
  })
}

export const ARIS_CONVENTION_SYMBOLS: readonly ArisConventionSymbol[] = Object.freeze([
  symbol({
    catalogId: 'epc.function',
    objectType: 'OT_FUNC',
    symbolNum: 'ST_FUNC',
    labelKey: 'aris.symbol.function',
    accessibleLabel: 'Function',
    family: 'function',
    silhouette: 'card',
    icon: 'double-chevron',
    // Wave 9 P8 (fixplan §4.3): the corrected function green. The AML brush is raw `339900`, whose
    // COLORREF decode `#009933` is a print outlier (RMSE 24); `#339933` is the drift-correct sRGB
    // (p8-analysis §5). Imported occurrences reach the same value via the display correction in
    // `renderer.occurrenceColorToCss`; this is the legend/palette/new-object default.
    defaultFill: '#339933',
    paletteGroup: 'flow',
    paletteOrder: 10,
    modelTypes: ['MT_EEPC'],
    verification: 'fixture'
  }),
  symbol({
    catalogId: 'epc.system-function',
    objectType: 'OT_FUNC',
    symbolNum: 'ST_SYS_FUNC_ACT',
    labelKey: 'aris.symbol.systemFunction',
    accessibleLabel: 'System function',
    family: 'function',
    silhouette: 'card',
    icon: 'application-window',
    // Wave 9 P8 (fixplan §4.3): corrected function green — see the ST_FUNC row above.
    defaultFill: '#339933',
    paletteGroup: 'flow',
    paletteOrder: 11,
    modelTypes: ['MT_EEPC'],
    verification: 'fixture'
  }),
  symbol({
    catalogId: 'epc.process-interface',
    objectType: 'OT_FUNC',
    symbolNum: 'ST_PRCS_IF',
    labelKey: 'aris.symbol.processInterface',
    accessibleLabel: 'Process interface',
    family: 'function',
    silhouette: 'process-interface',
    icon: 'flag',
    defaultFill: '#c0c0c0',
    paletteGroup: 'flow',
    paletteOrder: 12,
    modelTypes: ['MT_EEPC'],
    verification: 'fixture'
  }),
  symbol({
    catalogId: 'epc.event',
    objectType: 'OT_EVT',
    symbolNum: 'ST_EV',
    labelKey: 'aris.symbol.event',
    accessibleLabel: 'Event',
    family: null,
    silhouette: 'event-chevron',
    icon: 'flag',
    defaultFill: '#edbbdc',
    paletteGroup: 'flow',
    paletteOrder: 20,
    modelTypes: ['MT_EEPC'],
    verification: 'fixture'
  }),
  symbol({
    catalogId: 'decision.and',
    objectType: 'OT_RULE',
    symbolNum: 'ST_OPR_AND_1',
    labelKey: 'aris.symbol.and',
    accessibleLabel: 'AND decision',
    family: 'rule',
    silhouette: 'operator-circle',
    icon: 'unknown',
    operator: 'AND',
    defaultFill: '#999999',
    paletteGroup: 'rule',
    paletteOrder: 30,
    modelTypes: ['MT_EEPC'],
    verification: 'fixture'
  }),
  symbol({
    catalogId: 'decision.or',
    objectType: 'OT_RULE',
    symbolNum: 'ST_OPR_OR_1',
    labelKey: 'aris.symbol.or',
    accessibleLabel: 'OR decision',
    family: 'rule',
    silhouette: 'operator-circle',
    icon: 'unknown',
    operator: 'OR',
    defaultFill: '#999999',
    paletteGroup: 'rule',
    paletteOrder: 31,
    modelTypes: ['MT_EEPC'],
    verification: 'aris-doc'
  }),
  symbol({
    catalogId: 'decision.xor',
    objectType: 'OT_RULE',
    symbolNum: 'ST_OPR_XOR_1',
    labelKey: 'aris.symbol.xor',
    accessibleLabel: 'XOR decision',
    family: 'rule',
    silhouette: 'operator-circle',
    icon: 'unknown',
    operator: 'XOR',
    defaultFill: '#999999',
    paletteGroup: 'rule',
    paletteOrder: 32,
    modelTypes: ['MT_EEPC'],
    verification: 'fixture'
  }),
  symbol({
    catalogId: 'vacd.successor-chain',
    objectType: 'OT_FUNC',
    symbolNum: 'ST_VAL_ADD_CHN_SML_1',
    labelKey: 'aris.symbol.valueAddedChain',
    accessibleLabel: 'Successor value-added chain',
    family: 'valueChain',
    silhouette: 'value-chain-successor',
    icon: 'double-chevron',
    // Wave 9 P8 (fixplan §4.3): corrected function green — see the ST_FUNC row above.
    defaultFill: '#339933',
    paletteGroup: 'flow',
    paletteOrder: 13,
    modelTypes: ['MT_VAL_ADD_CHN_DGM'],
    verification: 'fixture'
  }),
  symbol({
    catalogId: 'vacd.start-chain',
    objectType: 'OT_FUNC',
    symbolNum: 'ST_VAL_ADD_CHN_SML_1',
    labelKey: 'aris.symbol.valueAddedChainStart',
    accessibleLabel: 'Start value-added chain',
    family: 'valueChain',
    silhouette: 'value-chain-start',
    icon: 'double-chevron',
    // Wave 9 P8 (fixplan §4.3): corrected function green — see the ST_FUNC row above.
    defaultFill: '#339933',
    paletteGroup: 'flow',
    paletteOrder: 12.5,
    modelTypes: ['MT_VAL_ADD_CHN_DGM'],
    verification: 'aris-doc',
    placementEnabled: false
  }),
  symbol({
    catalogId: 'organization.org-unit',
    objectType: 'OT_ORG_UNIT',
    symbolNum: 'ST_ORG_UNIT_1',
    labelKey: 'aris.symbol.organizationalUnit',
    accessibleLabel: 'Organizational unit',
    family: 'orgPeople',
    silhouette: 'card',
    icon: 'org-unit',
    defaultFill: '#f59e0b',
    paletteGroup: 'org',
    paletteOrder: 84,
    modelTypes: ['MT_EEPC'],
    verification: 'fixture'
  }),
  symbol({
    catalogId: 'organization.position',
    objectType: 'OT_POS',
    symbolNum: 'ST_POS',
    labelKey: 'aris.symbol.position',
    accessibleLabel: 'Position',
    family: 'orgPeople',
    silhouette: 'card',
    icon: 'position',
    defaultFill: '#facc15',
    paletteGroup: 'org',
    paletteOrder: 85,
    modelTypes: ['MT_EEPC'],
    verification: 'unverified'
  }),
  symbol({
    catalogId: 'organization.group',
    objectType: 'OT_GRP',
    symbolNum: 'ST_GRP_1',
    labelKey: 'aris.symbol.group',
    accessibleLabel: 'Group',
    family: 'orgPeople',
    silhouette: 'card',
    icon: 'group',
    defaultFill: '#a16207',
    paletteGroup: 'org',
    paletteOrder: 86,
    modelTypes: ['MT_EEPC'],
    verification: 'unverified'
  }),
  symbol({
    catalogId: 'organization.committee-team',
    objectType: 'OT_ORG_UNIT',
    symbolNum: 'ST_ORG_UNIT_1',
    labelKey: 'aris.symbol.committeeTeam',
    accessibleLabel: 'Committee or team',
    family: 'orgPeople',
    silhouette: 'card',
    icon: 'committee-team',
    // Wave 9 P8: store the DECODED sRGB (raw COLORREF `996600` → `#006699`) — see the blue rows.
    defaultFill: '#006699',
    paletteGroup: 'org',
    paletteOrder: 86.5,
    modelTypes: ['MT_EEPC'],
    verification: 'unverified',
    placementEnabled: false
  }),
  symbol({
    catalogId: 'organization.role',
    objectType: 'OT_PERS_TYPE',
    symbolNum: 'ST_EMPL_TYPE',
    labelKey: 'aris.symbol.personType',
    accessibleLabel: 'Role',
    family: 'orgPeople',
    silhouette: 'card',
    icon: 'person',
    // Wave 9 P8: store the DECODED sRGB (raw COLORREF `d7c49d` → `#9dc4d7`) so the legend/palette
    // match the imported occurrences, which already render the decoded value.
    defaultFill: '#9dc4d7',
    paletteGroup: 'org',
    paletteOrder: 83,
    modelTypes: ['MT_EEPC'],
    verification: 'fixture'
  }),
  symbol({
    catalogId: 'organization.external-person',
    objectType: 'OT_PERS',
    symbolNum: 'ST_PERS_EXT',
    labelKey: 'aris.symbol.externalPerson',
    accessibleLabel: 'External person or entity',
    family: 'orgPeople',
    silhouette: 'card',
    icon: 'person',
    // Wave 9 P8: store the DECODED sRGB (raw COLORREF `d7c49d` → `#9dc4d7`) so the legend/palette
    // match the imported occurrences, which already render the decoded value.
    defaultFill: '#9dc4d7',
    paletteGroup: 'org',
    paletteOrder: 80,
    modelTypes: ['MT_EEPC'],
    verification: 'fixture'
  }),
  symbol({
    catalogId: 'organization.related-entity',
    objectType: 'OT_PERS',
    symbolNum: 'ST_PERS_EXT',
    labelKey: 'aris.symbol.relatedEntity',
    accessibleLabel: 'Related entity',
    family: 'orgPeople',
    silhouette: 'card',
    icon: 'related-entity',
    defaultFill: '#c2bcae',
    paletteGroup: 'org',
    paletteOrder: 82,
    modelTypes: ['MT_EEPC'],
    verification: 'unverified',
    placementEnabled: false
  }),
  symbol({
    catalogId: 'organization.internal-person',
    objectType: 'OT_PERS',
    symbolNum: 'ST_PERS',
    labelKey: 'aris.symbol.internalPerson',
    accessibleLabel: 'Internal person',
    family: 'orgPeople',
    silhouette: 'card',
    icon: 'person',
    defaultFill: '#e6cf7a',
    paletteGroup: 'org',
    paletteOrder: 81,
    modelTypes: ['MT_EEPC'],
    verification: 'aris-doc'
  }),
  symbol({
    catalogId: 'governance.business-rule',
    objectType: 'OT_BUSINESS_RULE',
    symbolNum: 'ST_BUSINESS_RULE',
    labelKey: 'aris.symbol.businessRule',
    accessibleLabel: 'Business rule',
    family: 'governance',
    silhouette: 'card',
    icon: 'business-rule',
    defaultFill: '#c82830',
    paletteGroup: 'governance',
    paletteOrder: 70,
    modelTypes: ['MT_EEPC'],
    verification: 'aris-doc'
  }),
  symbol({
    catalogId: 'governance.business-policy',
    objectType: 'OT_POLICY',
    symbolNum: 'ST_BUSINESS_POLICY',
    labelKey: 'aris.symbol.policy',
    accessibleLabel: 'Business policy',
    family: 'governance',
    silhouette: 'card',
    icon: 'business-policy',
    defaultFill: '#c82830',
    paletteGroup: 'governance',
    paletteOrder: 72,
    modelTypes: ['MT_EEPC'],
    verification: 'aris-doc'
  }),
  symbol({
    catalogId: 'governance.sla',
    objectType: 'OT_POLICY',
    symbolNum: 'ST_BUSINESS_POLICY',
    labelKey: 'aris.symbol.sla',
    accessibleLabel: 'Service-level agreement',
    family: 'governance',
    silhouette: 'card',
    icon: 'service-level-shield',
    defaultFill: '#c82830',
    paletteGroup: 'governance',
    paletteOrder: 73,
    modelTypes: ['MT_EEPC'],
    verification: 'aris-doc',
    placementEnabled: false
  }),
  symbol({
    catalogId: 'governance.law-regulation',
    objectType: 'OT_POLICY',
    symbolNum: 'ST_BUSINESS_POLICY',
    labelKey: 'aris.symbol.lawRegulation',
    accessibleLabel: 'Law or regulation',
    family: 'governance',
    silhouette: 'card',
    icon: 'law-shield',
    defaultFill: '#c82830',
    paletteGroup: 'governance',
    paletteOrder: 74,
    modelTypes: ['MT_EEPC'],
    verification: 'aris-doc',
    placementEnabled: false
  }),
  symbol({
    catalogId: 'governance.risk',
    objectType: 'OT_RISK',
    symbolNum: 'ST_RISK_1',
    labelKey: 'aris.symbol.risk',
    accessibleLabel: 'Risk',
    family: 'governance',
    silhouette: 'card',
    icon: 'risk',
    defaultFill: '#f7d5d5',
    paletteGroup: 'governance',
    paletteOrder: 76,
    modelTypes: ['MT_EEPC'],
    verification: 'unverified'
  }),
  symbol({
    catalogId: 'performance.measure',
    objectType: 'OT_PERF',
    symbolNum: 'ST_PERFORM',
    labelKey: 'aris.symbol.performance',
    accessibleLabel: 'Measure or KPI',
    family: 'governance',
    silhouette: 'card',
    icon: 'measure',
    defaultFill: '#3c78a6',
    paletteGroup: 'governance',
    paletteOrder: 71,
    modelTypes: ['MT_EEPC'],
    verification: 'fixture'
  }),
  symbol({
    catalogId: 'service.product-service',
    objectType: 'OT_SERVICE',
    symbolNum: 'ST_SERVICE',
    labelKey: 'aris.symbol.productService',
    accessibleLabel: 'Product or service',
    family: null,
    silhouette: 'card',
    icon: 'cube',
    defaultFill: '#8b7355',
    paletteGroup: 'governance',
    paletteOrder: 77,
    modelTypes: ['MT_EEPC'],
    verification: 'unverified'
  }),
  symbol({
    catalogId: 'technology.application-system',
    objectType: 'OT_APPL_SYS',
    symbolNum: 'ST_APPL_SYS',
    labelKey: 'aris.symbol.applicationSystem',
    accessibleLabel: 'Application system',
    family: null,
    silhouette: 'card',
    icon: 'application-window',
    defaultFill: '#9dc4d7',
    paletteGroup: 'system',
    paletteOrder: 60,
    modelTypes: ['MT_EEPC'],
    verification: 'fixture'
  }),
  symbol({
    catalogId: 'data.data-entity',
    objectType: 'OT_ENT_TYPE',
    symbolNum: 'ST_ENT_TYPE',
    labelKey: 'aris.symbol.dataEntity',
    accessibleLabel: 'Data entity',
    family: null,
    silhouette: 'card',
    icon: 'data-entity',
    defaultFill: '#c43422',
    paletteGroup: 'data',
    paletteOrder: 40,
    modelTypes: ['MT_EEPC'],
    verification: 'fixture'
  }),
  symbol({
    catalogId: 'data.entity-type',
    objectType: 'OT_ENT_TYPE',
    symbolNum: 'ST_ENT_TYPE',
    labelKey: 'aris.symbol.entityType',
    accessibleLabel: 'Entity type',
    family: null,
    silhouette: 'card',
    icon: 'entity-type',
    defaultFill: '#c43422',
    paletteGroup: 'data',
    paletteOrder: 40.5,
    modelTypes: ['MT_EEPC'],
    verification: 'unverified',
    placementEnabled: false
  }),
  symbol({
    catalogId: 'data.requirement',
    objectType: 'OT_REQUIREMENT',
    symbolNum: 'ST_REQUIREMENT',
    labelKey: 'aris.symbol.requirement',
    accessibleLabel: 'Requirement',
    family: 'governance',
    silhouette: 'card',
    icon: 'requirement',
    defaultFill: '#f7d5d5',
    paletteGroup: 'governance',
    paletteOrder: 75,
    modelTypes: ['MT_EEPC'],
    verification: 'fixture'
  }),
  symbol({
    catalogId: 'information.generic',
    objectType: 'OT_INFO_CARR',
    symbolNum: 'ST_INFO_CARR_1',
    labelKey: 'aris.symbol.infoCarrier',
    accessibleLabel: 'Generic information carrier',
    family: 'infoCarrier',
    silhouette: 'card',
    icon: 'information',
    defaultFill: '#cccccc',
    paletteGroup: 'data',
    paletteOrder: 50,
    modelTypes: ['MT_EEPC'],
    verification: 'aris-doc'
  }),
  symbol({
    catalogId: 'information.document',
    objectType: 'OT_INFO_CARR',
    symbolNum: 'ST_DOC',
    labelKey: 'aris.symbol.document',
    accessibleLabel: 'Document',
    family: 'infoCarrier',
    silhouette: 'card',
    icon: 'document',
    defaultFill: '#cccccc',
    paletteGroup: 'data',
    paletteOrder: 51,
    modelTypes: ['MT_EEPC'],
    verification: 'fixture'
  }),
  symbol({
    catalogId: 'information.email',
    objectType: 'OT_INFO_CARR',
    symbolNum: 'ST_EMAIL_1',
    labelKey: 'aris.symbol.email',
    accessibleLabel: 'E-mail',
    family: 'infoCarrier',
    silhouette: 'card',
    icon: 'email',
    defaultFill: '#cccccc',
    paletteGroup: 'data',
    paletteOrder: 52,
    modelTypes: ['MT_EEPC'],
    verification: 'fixture'
  }),
  symbol({
    catalogId: 'information.sms',
    objectType: 'OT_INFO_CARR',
    symbolNum: 'ST_INFO_CARR_HANDY',
    labelKey: 'aris.symbol.mobile',
    accessibleLabel: 'SMS',
    family: 'infoCarrier',
    silhouette: 'card',
    icon: 'mobile',
    defaultFill: '#cccccc',
    paletteGroup: 'data',
    paletteOrder: 53,
    modelTypes: ['MT_EEPC'],
    verification: 'fixture'
  }),
  symbol({
    catalogId: 'information.log',
    objectType: 'OT_INFO_CARR',
    symbolNum: 'ST_LOG',
    labelKey: 'aris.symbol.log',
    accessibleLabel: 'Log',
    family: 'infoCarrier',
    silhouette: 'card',
    icon: 'log',
    defaultFill: '#cccccc',
    paletteGroup: 'data',
    paletteOrder: 56,
    modelTypes: ['MT_EEPC'],
    verification: 'unverified'
  }),
  symbol({
    catalogId: 'information.aris-model',
    objectType: 'OT_INFO_CARR',
    symbolNum: 'DMT_UNVERIFIED_ARIS_MODEL',
    labelKey: 'aris.symbol.infoCarrier',
    accessibleLabel: 'ARIS model carrier',
    family: 'infoCarrier',
    silhouette: 'card',
    icon: 'aris-model',
    defaultFill: '#cccccc',
    paletteGroup: 'data',
    paletteOrder: 56.5,
    modelTypes: ['MT_EEPC'],
    verification: 'unverified',
    placementEnabled: false
  }),
  symbol({
    catalogId: 'information.letter',
    objectType: 'OT_INFO_CARR',
    symbolNum: 'ST_LETTER',
    labelKey: 'aris.symbol.letter',
    accessibleLabel: 'Letter',
    family: 'infoCarrier',
    silhouette: 'card',
    icon: 'letter',
    defaultFill: '#cccccc',
    paletteGroup: 'data',
    paletteOrder: 54,
    modelTypes: ['MT_EEPC'],
    verification: 'unverified'
  }),
  symbol({
    catalogId: 'information.electronic-file',
    objectType: 'OT_INFO_CARR',
    symbolNum: 'ST_INFO_CARR_EDOC',
    labelKey: 'aris.symbol.eDocument',
    accessibleLabel: 'Electronic file or folder',
    family: 'infoCarrier',
    silhouette: 'card',
    icon: 'electronic-file',
    defaultFill: '#cccccc',
    paletteGroup: 'data',
    paletteOrder: 55,
    modelTypes: ['MT_EEPC'],
    verification: 'fixture'
  })
])

const SYMBOL_BY_CATALOG_ID: ReadonlyMap<string, ArisConventionSymbol> = (() => {
  const map = new Map<string, ArisConventionSymbol>()
  for (const entry of ARIS_CONVENTION_SYMBOLS) map.set(entry.catalogId, entry)
  return map
})()

const SYMBOL_BY_OBJECT_AND_NUM: ReadonlyMap<string, ArisConventionSymbol> = (() => {
  const map = new Map<string, ArisConventionSymbol>()
  for (const entry of ARIS_CONVENTION_SYMBOLS) {
    const key = `${entry.objectType}:${entry.symbolNum}`
    if (!map.has(key) && entry.placementEnabled) map.set(key, entry)
  }
  return map
})()

/** Placement-safe rows for one model. Disabled discovery rows are intentionally excluded. */
export function getPaletteSymbols(modelType: string): readonly ArisConventionSymbol[] {
  return Object.freeze(
    ARIS_CONVENTION_SYMBOLS.filter(
      (entry) => entry.placementEnabled && entry.modelTypes.includes(modelType)
    ).sort((a, b) => a.paletteOrder - b.paletteOrder)
  )
}

/** Resolve a presentation without collapsing catalog variants. */
export function conventionSymbolByCatalogId(catalogId: string): ArisConventionSymbol | null {
  return SYMBOL_BY_CATALOG_ID.get(catalogId) ?? null
}

/** Resolve the verified/default imported presentation for a persisted pair. */
export function conventionSymbol(
  objectType: string,
  symbolNum: string
): ArisConventionSymbol | null {
  return SYMBOL_BY_OBJECT_AND_NUM.get(`${objectType}:${symbolNum}`) ?? null
}

export function conventionDefaultFill(objectType: string, symbolNum: string): string | null {
  return conventionSymbol(objectType, symbolNum)?.defaultFill ?? null
}

export function getVariantFamily(
  objectType: string,
  symbolNum: string
): readonly ArisConventionSymbol[] {
  const matched = conventionSymbol(objectType, symbolNum)
  if (!matched || matched.family === null) return Object.freeze([])

  return Object.freeze(
    ARIS_CONVENTION_SYMBOLS.filter(
      (entry) =>
        entry.placementEnabled &&
        entry.family === matched.family &&
        (entry.objectType !== objectType || entry.symbolNum !== symbolNum)
    )
  )
}

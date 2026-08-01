/**
 * The ARIS-native workbook template schema (aris_transformation.md §15.1/§15.2).
 *
 * Sheet names and column names are transcribed verbatim from the plan: nine
 * sheets, and for `Objects`/`Connections` the plan's own required/optional
 * split. Columns the plan lists without a required/optional split are required
 * headers; per-row value requirements are declared separately by
 * `valueRequired`, so an empty optional cell is not an error.
 */

export const ARIS_TEMPLATE_VERSION = '1'

/** The machine-readable identity string embedded in every official template. */
export const ARIS_TEMPLATE_IDENTITY = `OrbitPMArisTemplateVersion=${ARIS_TEMPLATE_VERSION}`

/** Custom document property (docProps/custom.xml) carrying the version. */
export const ARIS_TEMPLATE_PROPERTY = 'OrbitPMArisTemplateVersion'

/** Custom document property carrying the full identity string verbatim. */
export const ARIS_TEMPLATE_IDENTITY_PROPERTY = 'OrbitPMArisTemplateIdentity'

/** Custom document property naming the generated template flavour. */
export const ARIS_TEMPLATE_KIND_PROPERTY = 'OrbitPMArisTemplateKind'

/**
 * Custom properties written by the retired BPMN-oriented 0.4.5 workbook.
 * Their presence without an ARIS identity is a migration case, never a model.
 */
export const LEGACY_TEMPLATE_PROPERTY = 'OrbitPMTemplateVersion'

/** Sheet names of the retired BPMN-oriented 0.4.5 workbook. */
export const LEGACY_SHEET_NAMES = Object.freeze([
  'Processes',
  'Participants',
  'Steps',
  'Flows'
] as const)

export const ARIS_SHEET_NAMES = Object.freeze([
  'Models',
  'Objects',
  'Connections',
  'Attributes',
  'Assignments',
  'Lanes',
  'FreeText',
  'Styles',
  'Glossary'
] as const)

export type ArisSheetName = (typeof ARIS_SHEET_NAMES)[number]

/** Model types allowed by §15.2 (and §11.2). */
export const ARIS_MODEL_TYPES = Object.freeze(['MT_EEPC', 'MT_VAL_ADD_CHN_DGM'] as const)
export type ArisTemplateModelType = (typeof ARIS_MODEL_TYPES)[number]

/** Supported AnimalWF object types (§11.3). */
export const ARIS_OBJECT_TYPES = Object.freeze([
  'OT_FUNC',
  'OT_EVT',
  'OT_RULE',
  'OT_ENT_TYPE',
  'OT_INFO_CARR',
  'OT_BUSINESS_RULE',
  'OT_PERF',
  'OT_APPL_SYS',
  'OT_PERS',
  'OT_REQUIREMENT',
  'OT_POLICY',
  'OT_PERS_TYPE'
] as const)
export type ArisObjectType = (typeof ARIS_OBJECT_TYPES)[number]

/**
 * Objects that participate in the EPC control flow. The §15.4 per-model and
 * warning thresholds count only these; satellites are unbounded by that rule.
 */
export const ARIS_CONTROL_FLOW_OBJECT_TYPES = Object.freeze([
  'OT_FUNC',
  'OT_EVT',
  'OT_RULE'
] as const)

/**
 * Symbols the renderer draws natively. Unknown but well-formed `ST_*` symbols
 * are accepted with a warning so §12.2's visible-fallback rule can apply.
 */
export const ARIS_KNOWN_SYMBOL_TYPES = Object.freeze([
  'ST_FUNC',
  'ST_EV',
  'ST_OPR_AND_1',
  'ST_OPR_OR_1',
  'ST_OPR_XOR_1',
  'ST_ENT_TYPE',
  'ST_INFO_CARR',
  'ST_BUSINESS_RULE',
  'ST_PERF',
  'ST_APPL_SYS_TYPE',
  'ST_PERS',
  'ST_REQUIREMENT',
  'ST_POLICY',
  'ST_PERS_TYPE',
  'ST_VAL_ADD_CHN',
  'ST_SYS_FUNC_ACT',
  'ST_APPL_SYS',
  'ST_PERS_EXT',
  'ST_EMPL_TYPE',
  'ST_BUSINESS_POLICY',
  'ST_DOC',
  'ST_EMAIL_1',
  'ST_INFO_CARR_HANDY',
  'ST_INFO_CARR_EDOC',
  'ST_INFO_CARR_1',
  'ST_LETTER',
  'ST_LOG',
  'ST_ORG_UNIT_1',
  'ST_PERFORM',
  'ST_POS',
  'ST_PRCS_IF',
  'ST_GRP_1',
  'ST_RISK_1',
  'ST_SERVICE',
  'ST_VAL_ADD_CHN_SML_1'
] as const)

/**
 * Default descriptor-backed presentation for each object type accepted by the
 * Excel schema. This mirrors the renderer catalog, except decisions default to
 * XOR because that is the dominant authoring intent for an unnamed rule.
 */
export const ARIS_DEFAULT_SYMBOL_BY_OBJECT_TYPE: Readonly<Record<ArisObjectType, string>> =
  Object.freeze({
    OT_FUNC: 'ST_FUNC',
    OT_EVT: 'ST_EV',
    OT_RULE: 'ST_OPR_XOR_1',
    OT_ENT_TYPE: 'ST_ENT_TYPE',
    OT_INFO_CARR: 'ST_INFO_CARR_EDOC',
    OT_BUSINESS_RULE: 'ST_BUSINESS_RULE',
    OT_PERF: 'ST_PERFORM',
    OT_APPL_SYS: 'ST_APPL_SYS',
    OT_PERS: 'ST_PERS_EXT',
    OT_REQUIREMENT: 'ST_REQUIREMENT',
    OT_POLICY: 'ST_BUSINESS_POLICY',
    OT_PERS_TYPE: 'ST_EMPL_TYPE'
  })

/** Infer a drawable symbol without guessing or changing the authored object type. */
export function inferSymbolType(objectType: ArisObjectType, nameEn: string): string {
  if (objectType === 'OT_RULE') {
    const tokens = nameEn.toUpperCase().split(/[^A-Z0-9]+/)
    if (tokens.includes('XOR')) return 'ST_OPR_XOR_1'
    if (tokens.includes('AND')) return 'ST_OPR_AND_1'
    if (tokens.includes('OR')) return 'ST_OPR_OR_1'
  }
  return ARIS_DEFAULT_SYMBOL_BY_OBJECT_TYPE[objectType]
}

export const ARIS_SYMBOL_TYPE_PATTERN = /^ST_[A-Z0-9_]+$/
export const ARIS_CONNECTION_TYPE_PATTERN = /^CT_[A-Z0-9_]+$/
export const ARIS_ATTRIBUTE_TYPE_PATTERN = /^AT_[A-Z0-9_]+$/
export const ARIS_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/

/** Orientation vocabulary shared by `Models` and `Lanes`. */
export const ARIS_ORIENTATIONS = Object.freeze(['horizontal', 'vertical'] as const)

/** Owner kinds addressable by the `Attributes` sheet. */
export const ARIS_ATTRIBUTE_OWNER_KINDS = Object.freeze([
  'model',
  'object',
  'occurrence',
  'connection',
  'lane',
  'free_text'
] as const)
export type ArisAttributeOwnerKind = (typeof ARIS_ATTRIBUTE_OWNER_KINDS)[number]

export const ARIS_ATTRIBUTE_VALUE_TYPES = Object.freeze([
  'text',
  'number',
  'boolean',
  'date'
] as const)

export const ARIS_ATTRIBUTE_LANGUAGES = Object.freeze(['en', 'ar'] as const)

export const ARIS_ASSIGNMENT_TYPES = Object.freeze(['model', 'detail'] as const)

export const ARIS_LINE_STYLES = Object.freeze(['solid', 'dashed', 'dotted', 'dash_dot'] as const)

export const ARIS_FONT_WEIGHTS = Object.freeze(['normal', 'bold'] as const)

/** Targets a column value must resolve to when it is a cross-sheet reference. */
export type ArisReferenceTarget =
  'model' | 'object' | 'occurrence' | 'lane' | 'style' | 'attribute-owner'

export type ArisColumnKind =
  'text' | 'identifier' | 'integer' | 'number' | 'boolean' | 'enum' | 'color' | 'route'

export interface ArisColumnSpec {
  readonly name: string
  /** Whether the header must be present in the sheet. */
  readonly presence: 'required' | 'optional'
  readonly kind: ArisColumnKind
  /** Whether a non-empty value is required on every data row. */
  readonly valueRequired: boolean
  readonly values?: readonly string[]
  readonly reference?: ArisReferenceTarget
  /** A reference that must resolve inside the row's own model. */
  readonly referenceScope?: 'workbook' | 'model'
}

export interface ArisSheetSpec {
  readonly name: ArisSheetName
  readonly columns: readonly ArisColumnSpec[]
}

function column(
  name: string,
  kind: ArisColumnKind,
  options: {
    readonly presence?: 'required' | 'optional'
    readonly valueRequired?: boolean
    readonly values?: readonly string[]
    readonly reference?: ArisReferenceTarget
    readonly referenceScope?: 'workbook' | 'model'
  } = {}
): ArisColumnSpec {
  return Object.freeze({
    name,
    presence: options.presence ?? 'required',
    kind,
    valueRequired: options.valueRequired ?? false,
    ...(options.values ? { values: options.values } : {}),
    ...(options.reference ? { reference: options.reference } : {}),
    ...(options.referenceScope ? { referenceScope: options.referenceScope } : {})
  })
}

export const ARIS_SHEET_SPECS: readonly ArisSheetSpec[] = Object.freeze([
  Object.freeze({
    name: 'Models',
    columns: Object.freeze([
      column('model_id', 'identifier', { valueRequired: true }),
      column('model_type', 'enum', { valueRequired: true, values: ARIS_MODEL_TYPES }),
      column('name_en', 'text', { valueRequired: true }),
      column('name_ar', 'text'),
      column('process_code', 'text'),
      column('description_en', 'text'),
      column('description_ar', 'text'),
      column('orientation', 'enum', { values: ARIS_ORIENTATIONS })
    ])
  }),
  Object.freeze({
    name: 'Objects',
    columns: Object.freeze([
      column('model_id', 'identifier', {
        valueRequired: true,
        reference: 'model',
        referenceScope: 'workbook'
      }),
      column('object_id', 'identifier', { valueRequired: true }),
      column('occurrence_id', 'identifier', { valueRequired: true }),
      column('object_type', 'enum', { valueRequired: true, values: ARIS_OBJECT_TYPES }),
      column('symbol_type', 'text'),
      column('name_en', 'text', { valueRequired: true }),
      column('name_ar', 'text'),
      column('lane_id', 'identifier', {
        presence: 'optional',
        reference: 'lane',
        referenceScope: 'model'
      }),
      column('order', 'integer', { presence: 'optional' }),
      column('x', 'number', { presence: 'optional' }),
      column('y', 'number', { presence: 'optional' }),
      column('width', 'number', { presence: 'optional' }),
      column('height', 'number', { presence: 'optional' }),
      column('assigned_model_id', 'identifier', {
        presence: 'optional',
        reference: 'model',
        referenceScope: 'workbook'
      }),
      column('style_id', 'identifier', {
        presence: 'optional',
        reference: 'style',
        referenceScope: 'workbook'
      })
    ])
  }),
  Object.freeze({
    name: 'Connections',
    columns: Object.freeze([
      column('model_id', 'identifier', {
        valueRequired: true,
        reference: 'model',
        referenceScope: 'workbook'
      }),
      column('connection_id', 'identifier', { valueRequired: true }),
      column('source_occurrence_id', 'identifier', {
        valueRequired: true,
        reference: 'occurrence',
        referenceScope: 'model'
      }),
      column('target_occurrence_id', 'identifier', {
        valueRequired: true,
        reference: 'occurrence',
        referenceScope: 'model'
      }),
      column('connection_type', 'text', { valueRequired: true }),
      column('name_en', 'text', { presence: 'optional' }),
      column('name_ar', 'text', { presence: 'optional' }),
      column('route_points', 'route', { presence: 'optional' }),
      column('style_id', 'identifier', {
        presence: 'optional',
        reference: 'style',
        referenceScope: 'workbook'
      })
    ])
  }),
  Object.freeze({
    name: 'Attributes',
    columns: Object.freeze([
      column('owner_kind', 'enum', {
        valueRequired: true,
        values: ARIS_ATTRIBUTE_OWNER_KINDS
      }),
      column('owner_id', 'identifier', {
        valueRequired: true,
        reference: 'attribute-owner',
        referenceScope: 'workbook'
      }),
      column('attribute_type', 'text', { valueRequired: true }),
      column('language', 'enum', { values: ARIS_ATTRIBUTE_LANGUAGES }),
      column('value', 'text'),
      column('value_type', 'enum', { values: ARIS_ATTRIBUTE_VALUE_TYPES }),
      column('sequence', 'integer')
    ])
  }),
  Object.freeze({
    name: 'Assignments',
    columns: Object.freeze([
      column('source_object_id', 'identifier', {
        valueRequired: true,
        reference: 'object',
        referenceScope: 'workbook'
      }),
      column('target_model_id', 'identifier', {
        valueRequired: true,
        reference: 'model',
        referenceScope: 'workbook'
      }),
      column('assignment_type', 'enum', {
        valueRequired: true,
        values: ARIS_ASSIGNMENT_TYPES
      })
    ])
  }),
  Object.freeze({
    name: 'Lanes',
    columns: Object.freeze([
      column('model_id', 'identifier', {
        valueRequired: true,
        reference: 'model',
        referenceScope: 'workbook'
      }),
      column('lane_id', 'identifier', { valueRequired: true }),
      column('name_en', 'text', { valueRequired: true }),
      column('name_ar', 'text'),
      column('x', 'number'),
      column('y', 'number'),
      column('width', 'number'),
      column('height', 'number'),
      column('orientation', 'enum', { values: ARIS_ORIENTATIONS })
    ])
  }),
  Object.freeze({
    name: 'FreeText',
    columns: Object.freeze([
      column('model_id', 'identifier', {
        valueRequired: true,
        reference: 'model',
        referenceScope: 'workbook'
      }),
      column('text_id', 'identifier', { valueRequired: true }),
      column('text_en', 'text', { valueRequired: true }),
      column('text_ar', 'text'),
      column('x', 'number'),
      column('y', 'number'),
      column('width', 'number'),
      column('height', 'number'),
      column('style_id', 'identifier', {
        reference: 'style',
        referenceScope: 'workbook'
      })
    ])
  }),
  Object.freeze({
    name: 'Styles',
    columns: Object.freeze([
      column('style_id', 'identifier', { valueRequired: true }),
      column('fill_color', 'color'),
      column('stroke_color', 'color'),
      column('stroke_width', 'number'),
      column('line_style', 'enum', { values: ARIS_LINE_STYLES }),
      column('font_family', 'text'),
      column('font_size', 'number'),
      column('font_weight', 'enum', { values: ARIS_FONT_WEIGHTS }),
      column('text_color', 'color'),
      column('z_order', 'integer')
    ])
  }),
  Object.freeze({
    name: 'Glossary',
    columns: Object.freeze([
      column('english', 'text', { valueRequired: true }),
      column('arabic', 'text', { valueRequired: true }),
      column('do_not_translate', 'boolean'),
      column('case_sensitive', 'boolean')
    ])
  })
])

const SHEET_SPEC_BY_NAME: ReadonlyMap<string, ArisSheetSpec> = new Map(
  ARIS_SHEET_SPECS.map((spec) => [spec.name, spec])
)

export function arisSheetSpec(name: string): ArisSheetSpec | undefined {
  return SHEET_SPEC_BY_NAME.get(name)
}

export function isArisSheetName(name: string): name is ArisSheetName {
  return SHEET_SPEC_BY_NAME.has(name)
}

export function isControlFlowObjectType(objectType: string): boolean {
  return (ARIS_CONTROL_FLOW_OBJECT_TYPES as readonly string[]).includes(objectType)
}

export interface ArisRoutePoint {
  readonly x: number
  readonly y: number
}

export type ArisRouteParseResult =
  | { readonly ok: true; readonly points: readonly ArisRoutePoint[] }
  | { readonly ok: false; readonly reason: 'empty-segment' | 'malformed-point' }

const ROUTE_COORDINATE = /^-?\d+(?:\.\d+)?$/

/**
 * Parses the §15.2 route syntax `x:y|x:y|x:y`.
 * An empty string is not a route; callers treat it as "no explicit route".
 */
export function parseRoutePoints(raw: string): ArisRouteParseResult {
  const segments = raw.split('|')
  const points: ArisRoutePoint[] = []
  for (const segment of segments) {
    const trimmed = segment.trim()
    if (trimmed.length === 0) return { ok: false, reason: 'empty-segment' }
    const parts = trimmed.split(':')
    if (parts.length !== 2) return { ok: false, reason: 'malformed-point' }
    const [x, y] = parts as [string, string]
    if (!ROUTE_COORDINATE.test(x) || !ROUTE_COORDINATE.test(y)) {
      return { ok: false, reason: 'malformed-point' }
    }
    points.push(Object.freeze({ x: Number(x), y: Number(y) }))
  }
  return { ok: true, points: Object.freeze(points) }
}

/** Serializes route points back into the §15.2 syntax. */
export function formatRoutePoints(points: readonly ArisRoutePoint[]): string {
  return points.map((point) => `${point.x}:${point.y}`).join('|')
}

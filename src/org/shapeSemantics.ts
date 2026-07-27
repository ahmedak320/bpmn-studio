import { ar, en } from '../i18n/dictionaries'
import { getLang, type Key, type Lang } from '../i18n'
import { PALETTE, type PaletteKey } from './palette'
import { SEMANTIC_NAMING, type SemanticGatewayType } from './semanticNaming'

/**
 * Stable semantic identifiers shared by the canvas tooltip resolver, renderer
 * decoration wrappers, and the shape legend.
 */
export const SHAPE_SEMANTIC_KINDS = Object.freeze([
  'event-start',
  'event-intermediate',
  'event-end',
  'step',
  'subprocess',
  'gateway-exclusive',
  'gateway-inclusive',
  'gateway-parallel',
  'gateway-event-based',
  'gateway-complex',
  'participant',
  'lane',
  'annotation',
  'data-object',
  'data-store',
  'owner',
  'input',
  'output',
  'cc',
  'basis',
  'subprocess-chip'
] as const)

export type ShapeSemanticKind = (typeof SHAPE_SEMANTIC_KINDS)[number]

export type ShapeSemanticIcon =
  | 'start-circle'
  | 'intermediate-circle'
  | 'end-circle'
  | 'exclusive-diamond'
  | 'inclusive-diamond'
  | 'parallel-diamond'
  | 'event-based-diamond'
  | 'complex-diamond'
  | 'rounded-rect'
  | 'double-rounded-rect'
  | 'participant'
  | 'lane'
  | 'annotation'
  | 'data-object'
  | 'data-store'
  | 'chip'

export interface ShapeSemanticSwatch {
  readonly fill: PaletteKey
  readonly stroke: PaletteKey
}

export interface I18nSemanticText {
  readonly source: 'i18n'
  readonly labelKey: Key
  readonly explanationKey: Key
}

export type SemanticGatewayNaming = (typeof SEMANTIC_NAMING)[SemanticGatewayType]

export interface GatewaySemanticText {
  readonly source: 'semanticNaming'
  readonly gatewayType: SemanticGatewayType
  /**
   * The exact frozen naming-table entry, rather than copied strings. This is
   * intentionally public so consumers/tests can verify the single-source
   * contract.
   */
  readonly naming: SemanticGatewayNaming
}

export interface ShapeSemanticDescriptor {
  readonly kind: ShapeSemanticKind
  readonly text: I18nSemanticText | GatewaySemanticText
  readonly icon: ShapeSemanticIcon
  readonly swatch: ShapeSemanticSwatch
}

export interface ResolvedShapeSemantic {
  readonly kind: ShapeSemanticKind
  readonly label: string
  readonly explanation: string
  readonly aliases: readonly string[]
  readonly icon: ShapeSemanticIcon
  readonly swatch: ShapeSemanticSwatch
}

export interface ShapeSemanticElementLike {
  readonly type?: string
  readonly labelTarget?: unknown
  readonly waypoints?: unknown
  readonly businessObject?: {
    readonly $type?: string
  }
}

const EMPTY_ALIASES: readonly string[] = Object.freeze([])

function swatch(fill: PaletteKey, stroke: PaletteKey): ShapeSemanticSwatch {
  return Object.freeze({ fill, stroke })
}

function i18nDescriptor(
  kind: ShapeSemanticKind,
  labelKey: Key,
  explanationKey: Key,
  icon: ShapeSemanticIcon,
  fill: PaletteKey,
  stroke: PaletteKey
): ShapeSemanticDescriptor {
  return Object.freeze({
    kind,
    text: Object.freeze({
      source: 'i18n' as const,
      labelKey,
      explanationKey
    }),
    icon,
    swatch: swatch(fill, stroke)
  })
}

function gatewayDescriptor(
  kind: ShapeSemanticKind,
  gatewayType: SemanticGatewayType
): ShapeSemanticDescriptor {
  return Object.freeze({
    kind,
    text: Object.freeze({
      source: 'semanticNaming' as const,
      gatewayType,
      naming: SEMANTIC_NAMING[gatewayType]
    }),
    icon: `${gatewayType.slice(5, -7).toLowerCase()}-diamond` as
      'exclusive-diamond' | 'inclusive-diamond' | 'parallel-diamond',
    swatch: swatch('basisFill', 'basisBorder')
  })
}

/**
 * Typed, frozen descriptor table. Palette values are references rather than
 * duplicated colors; non-gateway text is represented by dictionary keys.
 * Gateway display names, explanations, and ARIS aliases retain direct
 * identity with SEMANTIC_NAMING.
 */
export const SHAPE_SEMANTICS: Readonly<Record<ShapeSemanticKind, ShapeSemanticDescriptor>> =
  Object.freeze({
    'event-start': i18nDescriptor(
      'event-start',
      'legend.event.start',
      'semantic.event.start.tooltip',
      'start-circle',
      'startFill',
      'startBorder'
    ),
    'event-intermediate': i18nDescriptor(
      'event-intermediate',
      'legend.event.intermediate',
      'semantic.event.intermediate.tooltip',
      'intermediate-circle',
      'startFill',
      'basisBorder'
    ),
    'event-end': i18nDescriptor(
      'event-end',
      'legend.event.end',
      'semantic.event.end.tooltip',
      'end-circle',
      'endFill',
      'endBorder'
    ),
    step: i18nDescriptor(
      'step',
      'legend.step',
      'semantic.step.tooltip',
      'rounded-rect',
      'startFill',
      'stepGreenBorder'
    ),
    subprocess: i18nDescriptor(
      'subprocess',
      'legend.subprocess',
      'semantic.subprocess.tooltip',
      'double-rounded-rect',
      'subChipFill',
      'subChipBorder'
    ),
    'gateway-exclusive': gatewayDescriptor('gateway-exclusive', 'bpmn:ExclusiveGateway'),
    'gateway-inclusive': gatewayDescriptor('gateway-inclusive', 'bpmn:InclusiveGateway'),
    'gateway-parallel': gatewayDescriptor('gateway-parallel', 'bpmn:ParallelGateway'),
    'gateway-event-based': i18nDescriptor(
      'gateway-event-based',
      'legend.gateway.eventBased',
      'semantic.gateway.eventBased.tooltip',
      'event-based-diamond',
      'basisFill',
      'basisBorder'
    ),
    'gateway-complex': i18nDescriptor(
      'gateway-complex',
      'legend.gateway.complex',
      'semantic.gateway.complex.tooltip',
      'complex-diamond',
      'basisFill',
      'basisBorder'
    ),
    participant: i18nDescriptor(
      'participant',
      'legend.participant',
      'semantic.participant.tooltip',
      'participant',
      'startFill',
      'stepGreenBorder'
    ),
    lane: i18nDescriptor(
      'lane',
      'legend.lane',
      'semantic.lane.tooltip',
      'lane',
      'startFill',
      'stepGreenBorder'
    ),
    annotation: i18nDescriptor(
      'annotation',
      'legend.annotation',
      'semantic.annotation.tooltip',
      'annotation',
      'noteFill',
      'noteBorder'
    ),
    'data-object': i18nDescriptor(
      'data-object',
      'legend.dataObject',
      'semantic.dataObject.tooltip',
      'data-object',
      'inputFill',
      'inputBorder'
    ),
    'data-store': i18nDescriptor(
      'data-store',
      'legend.dataStore',
      'semantic.dataStore.tooltip',
      'data-store',
      'inputFill',
      'inputBorder'
    ),
    owner: i18nDescriptor(
      'owner',
      'legend.owner',
      'semantic.owner.tooltip',
      'chip',
      'ownerFill',
      'ownerBorder'
    ),
    input: i18nDescriptor(
      'input',
      'legend.input',
      'semantic.input.tooltip',
      'rounded-rect',
      'inputFill',
      'inputBorder'
    ),
    output: i18nDescriptor(
      'output',
      'legend.output',
      'semantic.output.tooltip',
      'rounded-rect',
      'outputFill',
      'outputBorder'
    ),
    cc: i18nDescriptor(
      'cc',
      'legend.cc',
      'semantic.cc.tooltip',
      'rounded-rect',
      'ccFill',
      'ccBorder'
    ),
    basis: i18nDescriptor(
      'basis',
      'legend.basis',
      'semantic.basis.tooltip',
      'chip',
      'basisFill',
      'basisBorder'
    ),
    'subprocess-chip': i18nDescriptor(
      'subprocess-chip',
      'legend.subprocessChip',
      'semantic.subprocessChip.tooltip',
      'chip',
      'subChipFill',
      'subChipBorder'
    )
  })

/** Default display order for the legend. */
export const SHAPE_LEGEND_KINDS: readonly ShapeSemanticKind[] = SHAPE_SEMANTIC_KINDS

const DICTIONARIES: Record<Lang, Record<Key, string>> = { en, ar }

export function resolveShapeSemantic(
  kind: ShapeSemanticKind,
  lang: Lang = getLang()
): ResolvedShapeSemantic {
  const descriptor = SHAPE_SEMANTICS[kind]
  let label: string
  let explanation: string
  let aliases: readonly string[] = EMPTY_ALIASES

  if (descriptor.text.source === 'semanticNaming') {
    const naming = descriptor.text.naming
    label = naming[lang].display
    explanation = naming[lang].tooltip
    aliases = Object.freeze([naming.arisAlias])
  } else {
    const dictionary = DICTIONARIES[lang]
    label = dictionary[descriptor.text.labelKey]
    explanation = dictionary[descriptor.text.explanationKey]
  }

  return Object.freeze({
    kind,
    label,
    explanation,
    aliases,
    icon: descriptor.icon,
    swatch: descriptor.swatch
  })
}

const SUBPROCESS_TYPES: ReadonlySet<string> = new Set([
  'bpmn:CallActivity',
  'bpmn:SubProcess',
  'bpmn:Transaction',
  'bpmn:AdHocSubProcess'
])

const STEP_TYPES: ReadonlySet<string> = new Set([
  'bpmn:Activity',
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:ManualTask',
  'bpmn:BusinessRuleTask',
  'bpmn:ScriptTask'
])

const GATEWAY_KINDS: Readonly<Partial<Record<string, ShapeSemanticKind>>> = Object.freeze({
  'bpmn:ExclusiveGateway': 'gateway-exclusive',
  'bpmn:InclusiveGateway': 'gateway-inclusive',
  'bpmn:ParallelGateway': 'gateway-parallel',
  'bpmn:EventBasedGateway': 'gateway-event-based',
  'bpmn:ComplexGateway': 'gateway-complex'
})

/**
 * Classify a real diagram shape. Labels, connections, diagram roots, and
 * unsupported BPMN kinds intentionally resolve to null.
 */
export function shapeSemanticKindForElement(
  element: ShapeSemanticElementLike | null | undefined
): ShapeSemanticKind | null {
  if (!element || element.labelTarget != null || element.waypoints != null) {
    return null
  }

  const type = typeof element.type === 'string' ? element.type : element.businessObject?.$type
  if (typeof type !== 'string' || !type.startsWith('bpmn:')) return null

  const gatewayKind = GATEWAY_KINDS[type]
  if (gatewayKind) return gatewayKind
  if (SUBPROCESS_TYPES.has(type)) return 'subprocess'
  if (STEP_TYPES.has(type)) return 'step'
  if (type === 'bpmn:StartEvent') return 'event-start'
  if (type === 'bpmn:EndEvent') return 'event-end'
  if (/^bpmn:[A-Za-z]*Event$/.test(type)) return 'event-intermediate'
  if (type === 'bpmn:Participant') return 'participant'
  if (type === 'bpmn:Lane') return 'lane'
  if (type === 'bpmn:TextAnnotation') return 'annotation'
  if (
    type === 'bpmn:DataObjectReference' ||
    type === 'bpmn:DataInput' ||
    type === 'bpmn:DataOutput'
  ) {
    return 'data-object'
  }
  if (type === 'bpmn:DataStoreReference') return 'data-store'
  return null
}

export function shapeSemanticForElement(
  element: ShapeSemanticElementLike | null | undefined,
  lang: Lang = getLang()
): ResolvedShapeSemantic | null {
  const kind = shapeSemanticKindForElement(element)
  return kind ? resolveShapeSemantic(kind, lang) : null
}

const DECORATION_KINDS: Readonly<Record<string, ShapeSemanticKind>> = Object.freeze({
  owner: 'owner',
  responsible: 'owner',
  'responsible-owner': 'owner',
  input: 'input',
  inputs: 'input',
  output: 'output',
  // Layout/rendering contract: the output wrapper is plural.
  outputs: 'output',
  cc: 'cc',
  informed: 'cc',
  basis: 'basis',
  'decision-basis': 'basis',
  'subprocess-chip': 'subprocess-chip',
  subprocessChip: 'subprocess-chip',
  subChip: 'subprocess-chip'
})

/**
 * Resolve either a canonical data-org-semantic value or one of the renderer's
 * established data-org-decoration values.
 */
export function shapeSemanticForDecoration(
  token: string | null | undefined,
  lang: Lang = getLang()
): ResolvedShapeSemantic | null {
  if (!token) return null
  const kind = DECORATION_KINDS[token]
  return kind ? resolveShapeSemantic(kind, lang) : null
}

/** Resolve palette references only at the final paint/render boundary. */
export function shapeSemanticColors(
  semantic: Pick<ResolvedShapeSemantic, 'swatch'>
): Readonly<{ fill: string; stroke: string }> {
  return Object.freeze({
    fill: PALETTE[semantic.swatch.fill],
    stroke: PALETTE[semantic.swatch.stroke]
  })
}

/**
 * Stable names for BPMN gateway semantics.
 *
 * Keep this table independent of React and i18n so import, layout, and
 * rendering code share the same standards-based wording. Importers may
 * persist these names when replacing a stock operator alias; the renderer
 * also uses them as a presentation fallback for genuinely unnamed gateways.
 */
export const SEMANTIC_NAMING = Object.freeze({
  'bpmn:ExclusiveGateway': Object.freeze({
    en: Object.freeze({
      display: 'Exclusive gateway',
      tooltip: 'Selects exactly one outgoing path, or merges alternative paths.'
    }),
    ar: Object.freeze({
      display: 'بوابة حصرية',
      tooltip: 'تختار مسارًا صادرًا واحدًا فقط، أو تدمج المسارات البديلة.'
    }),
    arisAlias: 'XOR rule'
  }),
  'bpmn:InclusiveGateway': Object.freeze({
    en: Object.freeze({
      display: 'Inclusive gateway',
      tooltip: 'Selects one or more matching paths, or synchronizes the paths that were activated.'
    }),
    ar: Object.freeze({
      display: 'بوابة شاملة',
      tooltip: 'تختار مسارًا واحدًا أو أكثر عند تحقق شروطه، أو تزامن المسارات التي تم تفعيلها.'
    }),
    arisAlias: 'OR rule'
  }),
  'bpmn:ParallelGateway': Object.freeze({
    en: Object.freeze({
      display: 'Parallel gateway',
      tooltip:
        'Starts concurrent paths, or waits for all incoming paths without evaluating conditions.'
    }),
    ar: Object.freeze({
      display: 'بوابة متوازية',
      tooltip: 'تبدأ مسارات متزامنة، أو تنتظر جميع المسارات الواردة من دون تقييم الشروط.'
    }),
    arisAlias: 'AND rule'
  })
})

export type SemanticGatewayType = keyof typeof SEMANTIC_NAMING
export type SemanticLang = 'en' | 'ar'

export interface LocalizedGatewayText {
  readonly en?: string
  readonly ar?: string
}

export interface GatewayNamingNeighbour {
  readonly name?: LocalizedGatewayText
}

export interface GatewayNamingContext {
  readonly type: SemanticGatewayType
  readonly name?: LocalizedGatewayText
  readonly decisionBasis?: LocalizedGatewayText
  readonly incoming?: readonly GatewayNamingNeighbour[]
  readonly outgoing?: readonly GatewayNamingNeighbour[]
  readonly incomingCount?: number
  readonly outgoingCount?: number
}

/**
 * ARIS' stock rule labels are aliases for the symbol, not business names.
 * Matching is deliberately conservative: trim the whole value and case-fold
 * it, but never normalize spacing or remove an alias from a larger label.
 */
export function matchesGenericSemanticAlias(value: string | undefined, alias: string): boolean {
  return value !== undefined && value.trim().toLowerCase() === alias.trim().toLowerCase()
}

/**
 * Treat ARIS' stock operator aliases as symbol metadata, never as business
 * language. This intentionally recognises all three aliases so a neighbouring
 * gateway cannot leak "XOR rule" into a contextual label.
 */
export function isGenericGatewayLabel(value: string | undefined): boolean {
  if (value === undefined || value.trim() === '') return false
  return Object.values(SEMANTIC_NAMING).some((entry) =>
    matchesGenericSemanticAlias(value, entry.arisAlias)
  )
}

function meaningful(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed && !isGenericGatewayLabel(trimmed) ? trimmed : undefined
}

function localeValues(
  neighbours: readonly GatewayNamingNeighbour[] | undefined,
  lang: SemanticLang
): string[] {
  const result: string[] = []
  for (const neighbour of neighbours ?? []) {
    const value = meaningful(neighbour.name?.[lang])
    if (value && !result.includes(value)) result.push(value)
  }
  return result
}

function shorten(value: string, max = 72): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(1, max - 1)).trimEnd()}…`
}

function joinedChoices(values: readonly string[], lang: SemanticLang): string {
  const visible = values.slice(0, 3)
  if (visible.length <= 1) return visible[0] ?? ''
  const last = visible[visible.length - 1]
  const head = visible.slice(0, -1).join(' / ')
  return `${head}${lang === 'ar' ? ' أم ' : ' or '}${last}`
}

function contextualNameForLocale(context: GatewayNamingContext, lang: SemanticLang): string {
  const genuine = meaningful(context.name?.[lang])
  if (genuine) return genuine

  const basis = meaningful(context.decisionBasis?.[lang])
  if (basis) {
    return shorten(lang === 'ar' ? `قرار: ${basis}` : `Decision: ${basis}`)
  }

  const incoming = localeValues(context.incoming, lang)
  const outgoing = localeValues(context.outgoing, lang)
  const incomingCount = context.incomingCount ?? context.incoming?.length ?? 0
  const outgoingCount = context.outgoingCount ?? context.outgoing?.length ?? 0
  const isSplit = outgoingCount > 1
  const isMerge = incomingCount > 1 && !isSplit

  if (isSplit && outgoing.length > 1) {
    const choices = joinedChoices(outgoing, lang)
    if (context.type === 'bpmn:ParallelGateway') {
      return shorten(lang === 'ar' ? `بدء: ${choices}` : `Start: ${choices}`)
    }
    if (context.type === 'bpmn:InclusiveGateway') {
      return shorten(
        lang === 'ar'
          ? `اختيار المسارات المناسبة: ${choices}`
          : `Select applicable paths: ${choices}`
      )
    }
    return shorten(`${choices}${lang === 'ar' ? '؟' : '?'}`)
  }

  if (isSplit && incoming.length > 0) {
    const source = incoming[0]
    if (context.type === 'bpmn:ParallelGateway') {
      return shorten(lang === 'ar' ? `بدء المسارات بعد ${source}` : `Start paths after ${source}`)
    }
    return shorten(lang === 'ar' ? `نتيجة ${source}؟` : `Outcome of ${source}?`)
  }

  if (isMerge && incoming.length > 1) {
    const sources = incoming.slice(0, 3).join(' / ')
    if (context.type === 'bpmn:ParallelGateway') {
      return shorten(lang === 'ar' ? `ضمّ: ${sources}` : `Join: ${sources}`)
    }
    return shorten(lang === 'ar' ? `دمج: ${sources}` : `Merge: ${sources}`)
  }

  if (isSplit) {
    if (context.type === 'bpmn:ParallelGateway') {
      return lang === 'ar' ? 'بدء مسارات متوازية' : 'Start parallel paths'
    }
    if (context.type === 'bpmn:InclusiveGateway') {
      return lang === 'ar' ? 'اختيار مسار واحد أو أكثر' : 'Choose one or more paths'
    }
    return lang === 'ar' ? 'اختيار مسار واحد' : 'Choose one path'
  }

  if (isMerge) {
    if (context.type === 'bpmn:ParallelGateway') {
      return lang === 'ar' ? 'ضمّ المسارات المتوازية' : 'Join parallel paths'
    }
    if (context.type === 'bpmn:InclusiveGateway') {
      return lang === 'ar' ? 'دمج المسارات المفعّلة' : 'Merge activated paths'
    }
    return lang === 'ar' ? 'دمج المسارات البديلة' : 'Merge alternative paths'
  }

  return SEMANTIC_NAMING[context.type][lang].display
}

/**
 * Return a stable bilingual business-facing label for a gateway. Genuine
 * names win, then decision criteria and neighbouring step names are used.
 * Standards-based split/merge wording is the final fallback, so stock labels
 * such as "XOR rule" never reach the drawing or a converted BPMN file.
 */
export function deriveContextualGatewayNames(
  context: GatewayNamingContext
): Readonly<Required<LocalizedGatewayText>> {
  return Object.freeze({
    en: contextualNameForLocale(context, 'en'),
    ar: contextualNameForLocale(context, 'ar')
  })
}

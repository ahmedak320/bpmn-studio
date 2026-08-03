/**
 * `buildProcessNarrative` — deterministic bilingual (EN + AR) process
 * narrative, derived BY TEMPLATE from a `CanonicalProcessV1` (implementation
 * plan Lane L-VPKG, Wave 19, folded into the same lane as
 * `./verificationPackage.ts`; milestone amendment at plan line 22; BINDING
 * shape per plan line 411's Lane L-VPKG T3).
 *
 * NO LLM: every sentence is assembled from fixed EN/AR phrase templates plus
 * the canonical data itself, so the same input always yields byte-identical
 * output (see `narrative.test.ts`'s double-run assertion) — "consistency
 * with the model is by construction" (master-plan Gold-Case criterion 3).
 *
 * `ProcessNarrativeV1` is the plan's exact flat shape: `{schemaVersion:1, en,
 * ar}`, where `en`/`ar` are each the FULL markdown narrative body for that
 * locale, built over the canonical spine in this order: purpose -> trigger ->
 * main flow (activity/decision/outcome sentences, via `canonicalFlowOrder`,
 * IMPORTED from `./projectToEpc` — never re-implemented) -> end outcomes ->
 * roles/systems -> open unknowns. A `# <title>` heading precedes that content
 * order (a document heading, not one of the enumerated content sections).
 *
 * The purpose paragraph is `deriveNarrativeSummary` from
 * `./verificationPackage` (same lane) — the SAME function
 * `buildVerificationPackage` uses for its own `narrativeSummary` field, so
 * the two artifacts' opening paragraph is identical "by construction" rather
 * than by two independent derivations agreeing by luck. The `trigger`/
 * `outcomes` sections likewise reuse `deriveTriggerEntries`/
 * `deriveOutcomeEntries` from the same module.
 *
 * ## Graceful degradation (never the literal text `"undefined"` in the output)
 *
 * Every locale-specific string is built by first reading the underlying
 * `CanonicalText`'s `en`/`ar` field; when that locale is absent for a given
 * node/decision/etc., the corresponding SENTENCE for THAT item is omitted
 * from THAT locale's body entirely (never string-interpolated as the literal
 * text `"undefined"`). The overall `en`/`ar` bodies are never empty for a
 * validly-typed `CanonicalProcessV1`, because `identity.names` guarantees at
 * least one locale project-wide, and the `# <title>` heading falls back to
 * the other locale rather than rendering blank.
 */

import type {
  CanonicalDecision,
  CanonicalNode,
  CanonicalNodeKind,
  CanonicalProcessV1,
  CanonicalText
} from './contract'
import { canonicalFlowOrder } from './projectToEpc'
import {
  deriveNarrativeSummary,
  deriveOutcomeEntries,
  deriveTriggerEntries
} from './verificationPackage'

export const NARRATIVE_SCHEMA_VERSION = 1 as const

// ---------------------------------------------------------------------------
// Shape (BINDING — plan line 411, Lane L-VPKG T3)
// ---------------------------------------------------------------------------

export interface ProcessNarrativeV1 {
  readonly schemaVersion: 1
  readonly en: string
  readonly ar: string
}

// ---------------------------------------------------------------------------
// Small local helpers
// ---------------------------------------------------------------------------

type Locale = 'en' | 'ar'

function localeOf(text: CanonicalText | undefined, locale: Locale): string | undefined {
  return text?.[locale]
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}

function byId<T extends { readonly id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

const STEP_LABEL: Readonly<Record<Locale, Readonly<Record<CanonicalNodeKind, string>>>> = {
  en: {
    event: 'Event',
    activity: 'Step',
    decision: 'Decision',
    wait: 'Wait',
    handoff: 'Handoff',
    exception: 'Exception'
  },
  ar: {
    event: 'حدث',
    activity: 'خطوة',
    decision: 'قرار',
    wait: 'انتظار',
    handoff: 'تسليم',
    exception: 'استثناء'
  }
}

const SECTION_LABEL: Readonly<
  Record<
    Locale,
    {
      purpose: string
      trigger: string
      steps: string
      outcomes: string
      rolesAndSystems: string
      unknowns: string
      owner: string
    }
  >
> = {
  en: {
    purpose: 'Purpose',
    trigger: 'Trigger',
    steps: 'Main Flow',
    outcomes: 'Outcomes',
    rolesAndSystems: 'Roles & Systems',
    unknowns: 'Open Questions',
    owner: 'owner'
  },
  ar: {
    purpose: 'الغرض',
    trigger: 'المحفّز',
    steps: 'التدفق الرئيسي',
    outcomes: 'النتائج',
    rolesAndSystems: 'الأدوار والأنظمة',
    unknowns: 'أسئلة مفتوحة',
    owner: 'المالك'
  }
}

/** One bilingual sentence per canonical node, kind-specific extra clauses appended. */
function stepTextForLocale(
  node: CanonicalNode,
  decision: CanonicalDecision | undefined,
  locale: Locale
): string | undefined {
  const name = localeOf(node.names, locale)
  if (name === undefined) return undefined
  let sentence = `${STEP_LABEL[locale][node.kind]}: ${name}.`

  if (node.kind === 'decision' && decision) {
    const criteria = localeOf(decision.criteria, locale)
    if (criteria !== undefined) {
      sentence += locale === 'en' ? ` Criteria: ${criteria}.` : ` المعيار: ${criteria}.`
    }
    const outcomeNames = decision.outcomes
      .map((outcome) => localeOf(outcome.names, locale))
      .filter(isDefined)
    if (outcomeNames.length > 0) {
      const joined = outcomeNames.join(locale === 'en' ? ', ' : '، ')
      sentence += locale === 'en' ? ` Outcomes: ${joined}.` : ` النتائج: ${joined}.`
    }
  }

  if (node.kind === 'wait') {
    const detail = localeOf(node.waitDetail, locale)
    if (detail !== undefined) {
      sentence += locale === 'en' ? ` Detail: ${detail}.` : ` التفاصيل: ${detail}.`
    }
  }

  if (node.kind === 'handoff' && node.targetProcessRef !== undefined) {
    sentence +=
      locale === 'en'
        ? ` Continues in process ${node.targetProcessRef}.`
        : ` يستمر في العملية ${node.targetProcessRef}.`
  }

  if (node.kind === 'exception') {
    const detail = localeOf(node.description, locale)
    if (detail !== undefined) {
      sentence += locale === 'en' ? ` Detail: ${detail}.` : ` التفاصيل: ${detail}.`
    }
  }

  return sentence
}

function titleTextForLocale(process: CanonicalProcessV1, locale: Locale): string {
  const names = process.identity.names
  return localeOf(names, locale) ?? names.en ?? names.ar ?? ''
}

/**
 * Renders ONE locale's full markdown body, in the BINDING order: purpose ->
 * trigger -> main flow -> end outcomes -> roles/systems -> open unknowns
 * (preceded by a `# <title>` heading).
 */
function renderNarrativeLocale(process: CanonicalProcessV1, locale: Locale): string {
  const labels = SECTION_LABEL[locale]
  const lines: string[] = []

  lines.push(`# ${titleTextForLocale(process, locale)}`)

  const purpose = localeOf(deriveNarrativeSummary(process), locale)
  if (purpose !== undefined) {
    lines.push('', `## ${labels.purpose}`, purpose)
  }

  const triggerNames = deriveTriggerEntries(process)
    .map((entry) => localeOf(entry.names, locale))
    .filter(isDefined)
  if (triggerNames.length > 0) {
    lines.push('', `## ${labels.trigger}`, triggerNames.join(locale === 'en' ? ', ' : '، '))
  }

  const nodeById = new Map(process.nodes.map((node) => [node.id, node] as const))
  const decisionByNodeId = new Map(
    process.decisions.map((decision) => [decision.nodeId, decision] as const)
  )
  const stepLines = canonicalFlowOrder(process)
    .map((id) => {
      const node = nodeById.get(id)
      // Invariant: canonicalFlowOrder only ever emits ids from process.nodes.
      // Unreachable for any CanonicalProcessV1 that actually passed
      // parseCanonicalProcess; guarded defensively (see verificationPackage.ts
      // for the identical invariant on its own mainFlow).
      if (!node) throw new Error(`canonicalFlowOrder produced an undeclared node id "${id}".`)
      return stepTextForLocale(node, decisionByNodeId.get(node.id), locale)
    })
    .filter(isDefined)
  if (stepLines.length > 0) {
    lines.push('', `## ${labels.steps}`)
    stepLines.forEach((line, index) => lines.push(`${index + 1}. ${line}`))
  }

  const outcomeNames = deriveOutcomeEntries(process)
    .map((entry) => localeOf(entry.names, locale))
    .filter(isDefined)
  if (outcomeNames.length > 0) {
    lines.push('', `## ${labels.outcomes}`, outcomeNames.join(locale === 'en' ? ', ' : '، '))
  }

  const roleLines = [...process.roles]
    .sort(byId)
    .map((role) => {
      const name = localeOf(role.names, locale)
      if (name === undefined) return undefined
      return role.owner === true ? `${name} (${labels.owner})` : name
    })
    .filter(isDefined)
  const systemLines = [...process.systems]
    .sort(byId)
    .map((system) => localeOf(system.names, locale))
    .filter(isDefined)
  if (roleLines.length > 0 || systemLines.length > 0) {
    lines.push('', `## ${labels.rolesAndSystems}`)
    for (const line of roleLines) lines.push(`- ${line}`)
    for (const line of systemLines) lines.push(`- ${line}`)
  }

  const unknownLines = [...process.unknowns]
    .sort((a, b) => (a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0))
    .map((unknown) => localeOf(unknown.message, locale))
    .filter(isDefined)
  if (unknownLines.length > 0) {
    lines.push('', `## ${labels.unknowns}`)
    for (const line of unknownLines) lines.push(`- ${line}`)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// buildProcessNarrative
// ---------------------------------------------------------------------------

export function buildProcessNarrative(process: CanonicalProcessV1): ProcessNarrativeV1 {
  return {
    schemaVersion: NARRATIVE_SCHEMA_VERSION,
    en: renderNarrativeLocale(process, 'en'),
    ar: renderNarrativeLocale(process, 'ar')
  }
}

/**
 * Pure presentation helpers for the "complete this process" chat.
 *
 * The interview core decides WHICH gaps are asked and in what order
 * (`prioritizeGaps`). These helpers only describe a question for the reader:
 * which step it belongs to, a short plain question to ask, how many open items
 * fall in each priority band, and which name a missing-translation question can
 * translate from.
 */
import { DEFAULT_ARABIC_LOCALE_IDS, DEFAULT_ENGLISH_LOCALE_IDS } from '../chat/locale'
import { GAP_PRIORITY, type ArisChatQuestion } from '../chat/interviewLoop'
import type { ArisChatGap } from '../chat/gapScanner'
import type {
  ArisLocalizedValue,
  ArisModel,
  ArisObjectOccurrence,
  ArisWorkingDocument
} from '../model/types'
import { tk } from './shellI18n'

export type InterviewPriorityBand = 'critical' | 'content' | 'simple'

export function interviewPriorityBand(kind: ArisChatGap['kind']): InterviewPriorityBand {
  const rank = GAP_PRIORITY[kind]
  return rank === 0 ? 'critical' : rank === 1 ? 'content' : 'simple'
}

export function countInterviewBands(gaps: readonly ArisChatGap[]): Record<InterviewPriorityBand, number> {
  const counts: Record<InterviewPriorityBand, number> = { critical: 0, content: 0, simple: 0 }
  for (const gap of gaps) counts[interviewPriorityBand(gap.kind)] += 1
  return counts
}

/** The English or Arabic text of a localized value, else its fallback. */
export function localizedText(
  value: ArisLocalizedValue | undefined,
  localeIds: ReadonlySet<string>
): string | null {
  if (!value) return null
  for (const [locale, text] of Object.entries(value.values)) {
    if (localeIds.has(locale) && text.trim() !== '') return text.trim()
  }
  return value.fallback && value.fallback.trim() !== '' ? value.fallback.trim() : null
}

/** The names of the model or definition a gap points at, if the document has it. */
function namesOf(document: ArisWorkingDocument, id: string): ArisLocalizedValue | undefined {
  return (
    document.models.get(id)?.names ??
    document.objectDefinitions.get(id)?.names ??
    document.connectionDefinitions.get(id)?.names
  )
}

/** A readable name for the step a question is about: English first, then any name. */
export function stepNameFor(document: ArisWorkingDocument | null, id: string | undefined): string | null {
  if (!document || id === undefined) return null
  const names = namesOf(document, id)
  if (!names) return null
  return localizedText(names, DEFAULT_ENGLISH_LOCALE_IDS) ?? localizedText(names, DEFAULT_ARABIC_LOCALE_IDS)
}

export function questionStepLabel(
  document: ArisWorkingDocument | null,
  question: ArisChatQuestion
): string | null {
  return stepNameFor(document, question.targetIds[0])
}

/** Where a question points: the process, the step inside it, and the step before that step. */
export interface InterviewQuestionContext {
  readonly process: string | null
  readonly step: string | null
  /** Name of the step that connects into `step`, when the document has one. */
  readonly previous: string | null
}

function nameOrNull(value: ArisLocalizedValue | undefined): string | null {
  return localizedText(value, DEFAULT_ENGLISH_LOCALE_IDS) ?? localizedText(value, DEFAULT_ARABIC_LOCALE_IDS)
}

/** A readable kind for a step with no name yet, e.g. "function" for OT_FUNC. */
const TYPE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  OT_FUNC: 'function',
  OT_EVT: 'event',
  OT_RULE: 'rule',
  OT_ORG_UNIT: 'organisation unit',
  OT_POS: 'position',
  OT_APPL_SYS: 'application system',
  OT_INFO_CARR: 'information carrier'
})

function typeLabel(type: string | undefined): string {
  if (!type) return 'item'
  return TYPE_LABELS[type] ?? type.replace(/^OT_/, '').toLowerCase()
}

/**
 * The name of a step, or, when the step has no name yet, "unnamed <kind>". A step
 * always has a label, so a question never falls back to naming only the process.
 */
function stepLabelOf(document: ArisWorkingDocument, definitionId: string): string {
  const definition = document.objectDefinitions.get(definitionId)
  return nameOrNull(definition?.names) ?? `unnamed ${typeLabel(definition?.type)}`
}

/**
 * Resolves a question's target id (a model, object definition, occurrence,
 * connection or decision node) into the process it sits in, the step inside it,
 * and the step that flows into that step. A link between two steps is described
 * as "A → B". Unknown ids resolve to nothing.
 */
export function describeQuestionContext(
  document: ArisWorkingDocument | null,
  question: ArisChatQuestion
): InterviewQuestionContext {
  const empty: InterviewQuestionContext = { process: null, step: null, previous: null }
  const id = question.targetIds[0]
  if (!document || id === undefined) return empty

  const model = document.models.get(id)
  if (model) return { ...empty, process: nameOrNull(model.names) }

  for (const host of document.models.values()) {
    const connection = host.connectionOccurrences.find((item) => item.id === id)
    if (!connection) continue
    const from = host.occurrences.find((item) => item.id === connection.sourceOccurrenceId)
    const to = host.occurrences.find((item) => item.id === connection.targetOccurrenceId)
    const fromName = from ? stepLabelOf(document, from.definitionId) : null
    const toName = to ? stepLabelOf(document, to.definitionId) : null
    return {
      process: nameOrNull(host.names),
      step: fromName !== null && toName !== null ? `${fromName} → ${toName}` : fromName ?? toName,
      previous: fromName
    }
  }

  let host: ArisModel | null = null
  let occurrence: ArisObjectOccurrence | null = null
  for (const candidate of document.models.values()) {
    const found = candidate.occurrences.find((item) => item.id === id)
    if (found) {
      host = candidate
      occurrence = found
      break
    }
  }
  if (!occurrence) {
    // A definition used by a process: describe it through its first placement.
    for (const candidate of document.models.values()) {
      const found = candidate.occurrences.find((item) => item.definitionId === id)
      if (found) {
        host = candidate
        occurrence = found
        break
      }
    }
  }
  if (!occurrence || !host) {
    const definition = document.objectDefinitions.get(id)
    const connectionName = document.connectionDefinitions.get(id)?.names
    if (definition) return { ...empty, step: stepLabelOf(document, id) }
    return { ...empty, step: nameOrNull(connectionName) }
  }

  const step = stepLabelOf(document, occurrence.definitionId)
  const incoming = host.connectionOccurrences.find((connection) => connection.targetOccurrenceId === occurrence.id)
  const source = incoming
    ? host.occurrences.find((item) => item.id === incoming.sourceOccurrenceId)
    : undefined
  const previous = source ? stepLabelOf(document, source.definitionId) : null
  return { process: nameOrNull(host.names), step, previous }
}

const ASK_FALLBACKS: Readonly<Record<ArisChatGap['kind'], string>> = Object.freeze({
  missingEnglishName: '{where}{after} has no English name. What should its English name be?',
  missingArabicName: '{where}{after} has no Arabic name. What should its Arabic name be?',
  missingProcessCode: '{where}{after} has no process code. What is its process code?',
  missingOwner: '{where}{after} has no owner. Which role or department is responsible for it?',
  missingInputsOutputsSystems:
    '{where}{after} has no input, output or system. Name the document it reads or writes, or the system it uses.',
  missingDecisionBasis: '{where}{after} is a decision with no stated basis. What question does it decide?',
  missingXorOutcomes:
    '{where}{after} has unlabelled or repeated branch outcomes. Name each outcome, for example Yes and No.',
  missingReturnTarget: '{where}{after} loops back, but no return target is set. Which earlier step should it return to?',
  missingStartOrEndEvent: '{where} has no start or end event. Which event is missing?',
  invalidSequence: '{where}{after} is not followed by a valid next step. Which step should come after it?',
  danglingObjectOrConnection:
    '{where} links to something that no longer exists. Which object should it link to, or should it be removed?',
  missingLinkedModel: '{where} has no linked model. Which model should it link to?',
  missingAttachment: '{where} has no attached document. Which document belongs here?',
  unusedDefinition: '{where} is defined but not used in any process. Remove it?',
  unaccountedSourceContent: '{where} contains source content that is not placed in the model. What does it mean?'
})

/**
 * The one question to put to the user for a gap, naming the process, the exact
 * step and the step before it, so the user can tell which step is meant.
 */
export function questionAsk(question: ArisChatQuestion, document: ArisWorkingDocument | null = null): string {
  const context = describeQuestionContext(document, question)
  const where =
    context.step !== null && context.process !== null
      ? tk('aris.chat.where.stepInProcess', 'the step “{step}” in process “{process}”', {
          step: context.step,
          process: context.process
        })
      : context.step !== null
        ? tk('aris.chat.where.step', 'the step “{step}”', { step: context.step })
        : context.process !== null
          ? tk('aris.chat.where.process', 'the process “{process}”', { process: context.process })
          : tk('aris.chat.where.item', 'this item')
  const after =
    context.previous !== null && context.step !== null
      ? tk('aris.chat.where.after', ', which comes after “{previous}”', { previous: context.previous })
      : ''
  const vars = { where, after, step: context.step ?? '', process: context.process ?? '', previous: context.previous ?? '' }
  return tk(`aris.chat.ask.${question.gapKind}`, ASK_FALLBACKS[question.gapKind], vars)
}

export function isTranslationQuestion(question: ArisChatQuestion): boolean {
  return question.gapKind === 'missingEnglishName' || question.gapKind === 'missingArabicName'
}

/**
 * The text a missing-name question translates from: the English name for a
 * missing Arabic one, and the reverse. Null when the step has no name to start from.
 */
export function translationSource(
  document: ArisWorkingDocument | null,
  question: ArisChatQuestion
): { text: string; from: 'en' | 'ar'; to: 'en' | 'ar' } | null {
  const id = question.targetIds[0]
  if (!document || id === undefined || !isTranslationQuestion(question)) return null
  const names = namesOf(document, id)
  if (!names) return null
  const toArabic = question.gapKind === 'missingArabicName'
  const text = toArabic
    ? localizedText(names, DEFAULT_ENGLISH_LOCALE_IDS)
    : localizedText(names, DEFAULT_ARABIC_LOCALE_IDS)
  if (text === null) return null
  return toArabic ? { text, from: 'en', to: 'ar' } : { text, from: 'ar', to: 'en' }
}

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
import type { ArisLocalizedValue, ArisWorkingDocument } from '../model/types'
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

const ASK_FALLBACKS: Readonly<Record<ArisChatGap['kind'], string>> = Object.freeze({
  missingEnglishName: 'What is the English name?',
  missingArabicName: 'What is the Arabic name?',
  missingProcessCode: 'What is the process code?',
  missingOwner: 'Who is responsible for it?',
  missingInputsOutputsSystems: 'Which inputs, outputs or systems does it use? Name them.',
  missingDecisionBasis: 'What is the basis for this decision?',
  missingXorOutcomes: 'What are the outcomes of this decision?',
  missingReturnTarget: 'Which step should this loop return to?',
  missingStartOrEndEvent: 'Which start or end event is missing?',
  invalidSequence: 'What should come after this step?',
  danglingObjectOrConnection: 'Which object should this link to? Or should it be removed?',
  missingLinkedModel: 'Which model should this link to?',
  missingAttachment: 'Which document belongs here? Name it.',
  unusedDefinition: 'Remove this unused definition?',
  unaccountedSourceContent: 'What does this part of the source mean?'
})

/** The one short question to put to the user for a gap. */
export function questionAsk(question: ArisChatQuestion): string {
  return tk(`aris.chat.ask.${question.gapKind}`, ASK_FALLBACKS[question.gapKind])
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

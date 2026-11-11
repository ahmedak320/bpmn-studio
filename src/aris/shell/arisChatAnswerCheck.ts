/**
 * Checks what the user types into the completion interview before it is used.
 *
 * Three things are decided here, all without a provider:
 *
 *  - A reply that is a question or shows confusion ("what do you mean?") is a
 *    clarification request. The chat explains what is needed and asks again;
 *    the reply is not stored as an answer.
 *  - An answer must fit the gap it answers. A name must use the right script, a
 *    process code must look like a code, an owner must be a short role name, and
 *    a decision basis must be a phrase. A non-answer such as "idk" is refused.
 *  - A gap the chat cannot fill (a missing link, a missing outcome) says so
 *    plainly instead of silently dropping the answer.
 */
import type { ArisChatGap } from '../chat/gapScanner'
import type { ArisChatQuestion } from '../chat/interviewLoop'
import type { ArisWorkingDocument } from '../model/types'
import { questionAsk, describeQuestionContext } from './arisInterviewChatView'
import { tk } from './shellI18n'

type GapKind = ArisChatGap['kind']

/** Gap kinds whose answer the chat can turn into a change (see arisChatProposal.ts). */
const CHAT_FILLABLE: ReadonlySet<GapKind> = new Set<GapKind>([
  'missingEnglishName',
  'missingArabicName',
  'missingProcessCode',
  'missingOwner',
  'missingDecisionBasis',
  'unusedDefinition'
])

const QUESTION_OPENERS = /^(what|why|how|who|which|where|when|is|are|do|does|did|can|could|should|would)\b/i
const CONFUSION =
  /\b(don'?t|do not|dont)\s+(know|understand|get it)\b|\bnot\s+sure\b|\bconfus\w*|\bunclear\b|\bi'?m\s+lost\b|\bwhat do you mean\b|\bexplain\b|\bclarify\b|\bhelp me\b/i
const NON_ANSWERS = new Set(['idk', 'i dont know', "i don't know", 'no idea', 'none', 'n/a', 'na', '?', '-', 'unknown', 'not sure'])
const ARABIC_LETTERS = /[؀-ۿ]/
const LATIN_LETTERS = /[A-Za-z]/
const CODE_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,29}$/

export type AnswerProblem =
  | 'notFillable'
  | 'notAnAnswer'
  | 'tooShort'
  | 'tooLong'
  | 'notLatinName'
  | 'notArabicName'
  | 'notCode'
  | 'notPhrase'

export type AnswerCheck = { readonly ok: true } | { readonly ok: false; readonly problem: AnswerProblem }

/** True when the reply asks a question or shows confusion instead of answering. */
export function isClarificationRequest(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '') return false
  return trimmed.endsWith('?') || QUESTION_OPENERS.test(trimmed) || CONFUSION.test(trimmed)
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word !== '').length
}

/** Whether an answer fits the gap it answers. An empty answer is a skip and always passes. */
export function checkInterviewAnswer(gapKind: GapKind, answer: string): AnswerCheck {
  const value = answer.trim()
  if (value === '') return { ok: true }
  if (!CHAT_FILLABLE.has(gapKind)) return { ok: false, problem: 'notFillable' }
  if (NON_ANSWERS.has(value.toLowerCase())) return { ok: false, problem: 'notAnAnswer' }

  switch (gapKind) {
    case 'missingEnglishName':
      if (ARABIC_LETTERS.test(value) || !LATIN_LETTERS.test(value)) return { ok: false, problem: 'notLatinName' }
      if (value.length < 2) return { ok: false, problem: 'tooShort' }
      return value.length > 120 ? { ok: false, problem: 'tooLong' } : { ok: true }
    case 'missingArabicName':
      if (!ARABIC_LETTERS.test(value)) return { ok: false, problem: 'notArabicName' }
      if (value.length < 2) return { ok: false, problem: 'tooShort' }
      return value.length > 120 ? { ok: false, problem: 'tooLong' } : { ok: true }
    case 'missingProcessCode':
      return CODE_SHAPE.test(value) ? { ok: true } : { ok: false, problem: 'notCode' }
    case 'missingOwner':
      if (value.length < 2) return { ok: false, problem: 'tooShort' }
      if (wordCount(value) > 12) return { ok: false, problem: 'tooLong' }
      return { ok: true }
    case 'missingDecisionBasis':
      return wordCount(value) < 3 ? { ok: false, problem: 'notPhrase' } : { ok: true }
    case 'unusedDefinition':
      return { ok: true }
    default:
      return { ok: false, problem: 'notFillable' }
  }
}

const PROBLEM_FALLBACKS: Readonly<Record<AnswerProblem, string>> = Object.freeze({
  notFillable: 'The chat cannot fill this gap yet. Add it on the canvas, or type Skip.',
  notAnAnswer: 'That does not answer the question. Give the actual value, or type Skip.',
  tooShort: 'That is too short to use. Give a fuller answer.',
  tooLong: 'That is too long for this field. Use a short name or phrase.',
  notLatinName: 'The English name should use English letters.',
  notArabicName: 'The Arabic name should use Arabic letters.',
  notCode: 'A process code uses letters, numbers, dots, dashes or slashes, for example SRV-01.',
  notPhrase: 'Give the question this decision answers, as a short sentence.'
})

/** The reason an answer was refused, in the user's language. */
export function describeAnswerProblem(problem: AnswerProblem): string {
  return tk(`aris.chat.problem.${problem}`, PROBLEM_FALLBACKS[problem])
}

const NEEDS_FALLBACKS: Readonly<Partial<Record<GapKind, string>>> = Object.freeze({
  missingEnglishName: 'the English name of this step, as it should show on the diagram. Example: “Review answers”.',
  missingArabicName: 'the Arabic name of this step, in Arabic letters. Example: “مراجعة الإجابات”.',
  missingProcessCode: 'a short code that identifies the process. Example: “SRV-01”.',
  missingOwner: 'the role, department or person responsible for this step. Example: “Operations section”.',
  missingDecisionBasis: 'the question this decision answers, as a short sentence. Example: “Are all answers complete?”',
  unusedDefinition: 'whether to propose removing this item, which is not used by any process.',
  missingXorOutcomes: 'the name of each outcome of this decision, for example Yes and No. This is changed on the canvas.',
  missingReturnTarget: 'the earlier step this loop goes back to. This is changed on the canvas.',
  invalidSequence: 'the step that comes next after this one. This is changed on the canvas.',
  missingInputsOutputsSystems: 'the document this step reads or writes, or the system it uses. This is changed on the canvas.',
  missingStartOrEndEvent: 'the start or end event this process is missing. This is added on the canvas.',
  danglingObjectOrConnection: 'the object this link should point to, or a decision to remove the link. This is changed on the canvas.',
  missingLinkedModel: 'the process model this should link to. This is set on the canvas.',
  missingAttachment: 'the document that belongs here. This is attached on the canvas.',
  unaccountedSourceContent: 'what this source text means, so it can be placed in the model. This is added on the canvas.'
})

/** The detail a gap needs, as a short phrase, shown on its question card. */
export function questionNeeds(gapKind: GapKind): string {
  const needs = NEEDS_FALLBACKS[gapKind] ?? 'the missing detail for this item.'
  return tk(`aris.chat.needs.${gapKind}`, needs)
}

/**
 * A plain explanation of what the question needs, for a user who is unsure. It
 * names the process, the step and the step before it, like the question itself.
 */
export function explainQuestion(question: ArisChatQuestion, document: ArisWorkingDocument | null): string {
  const needsText = questionNeeds(question.gapKind)
  const context = describeQuestionContext(document, question)
  const where = context.step ?? context.process ?? 'this item'
  const fillable = CHAT_FILLABLE.has(question.gapKind)
    ? tk('aris.chat.explain.reply', 'Reply with the value itself. Reply Skip to leave it for later.')
    : tk('aris.chat.explain.canvas', 'The chat cannot change this one yet, so it is best fixed on the canvas.')
  return [
    tk('aris.chat.explain.intro', 'For {where} I need {needs}', { where, needs: needsText }),
    fillable,
    tk('aris.chat.explain.question', 'The question was: {question}', { question: questionAsk(question, document) })
  ].join(' ')
}

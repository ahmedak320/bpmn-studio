// Routes a free-text question (English OR Arabic) to the matching Section
// 17.4 answerer. Intent detection is deterministic keyword matching, not a
// classifier: each intent has a small EN + AR keyword/phrase list, and a
// query matches an intent when at least one of its phrases has ALL of its
// (normalized, clitic-expanded) tokens present in the query's expanded
// token set. Order matters — intents are checked most-specific-first so a
// phrase like "which model is assigned to X" (assignment) is not
// swallowed by the more general "which" (topic) fallback.
//
// When no intent keyword matches, the router falls back to topic matching
// (Section 17.4 "which process matches a topic") and only returns `none`
// when even that finds nothing with positive confidence — an honest
// "no confident local answer" rather than a low-quality guess.

import {
  answerAssignment,
  answerBefore,
  answerIo,
  answerMissingInfo,
  answerNext,
  answerProcessList,
  answerResponsible,
  answerReturnBranch,
  answerSystem,
  answerTopicMatch,
  answerXorOutcomes,
  noneAnswer,
  type ArisAssistantAnswer
} from './answer'
import type { ArisAssistantLang } from './i18n'
import { expandedTokens } from './retrieval'
import type { ArisProcessDigest } from './types'

type Answerer = (digests: readonly ArisProcessDigest[], query: string) => ArisAssistantAnswer

interface IntentRule {
  readonly answer: Answerer | 'processList'
  readonly phrases: readonly string[]
}

// Keyword phrases are matched as an AND of their own tokens against the
// query's expanded token set — so `'loop back'` matches "loops back to" too.
const INTENT_RULES: readonly IntentRule[] = [
  {
    answer: 'processList',
    phrases: [
      'available processes',
      'list processes',
      'all processes',
      'which processes',
      'العمليات المتاحة',
      'قائمة العمليات',
      'جميع العمليات'
    ]
  },
  {
    answer: answerMissingInfo,
    phrases: ['missing', 'incomplete', 'gap', 'ناقص', 'ناقصة', 'مفقود', 'مفقودة', 'نقص']
  },
  {
    answer: answerAssignment,
    phrases: [
      'assigned model',
      'linked model',
      'sub process',
      'نموذج مرتبط',
      'مرتبط بنموذج',
      'نموذج فرعي'
    ]
  },
  {
    answer: answerReturnBranch,
    phrases: ['return branch', 'loop back', 'go back', 'back to', 'يعود', 'رجوع', 'العودة']
  },
  {
    answer: answerXorOutcomes,
    phrases: [
      'xor',
      'outcome',
      'branch',
      'decision options',
      'بديل',
      'بدائل',
      'خيارات القرار',
      'نتائج القرار'
    ]
  },
  {
    answer: answerSystem,
    phrases: ['system', 'application', 'نظام', 'تطبيق']
  },
  {
    answer: answerIo,
    phrases: ['input', 'output', 'مدخلات', 'مخرجات']
  },
  {
    // Deliberately NOT including a bare "owner" / "المالك" keyword here: ARIS
    // process content routinely names a domain "owner" object (e.g. an
    // animal/application owner) inside step/model names, and that would
    // otherwise hijack unrelated questions into this intent.
    answer: answerResponsible,
    phrases: ['who', 'owns', 'responsible', 'مسؤول', 'مسؤولية', 'يملك']
  },
  {
    answer: answerBefore,
    phrases: ['before', 'previous', 'prior to', 'precedes', 'قبل', 'سابق', 'السابقة']
  },
  {
    answer: answerNext,
    phrases: ['next', 'after', 'then what', 'التالي', 'بعد', 'التالية']
  }
]

function matchesPhrase(queryTokens: ReadonlySet<string>, phrase: string): boolean {
  const phraseTokens = expandedTokens(phrase)
  return phraseTokens.length > 0 && phraseTokens.every((t) => queryTokens.has(t))
}

function detectIntent(query: string): Answerer | 'processList' | null {
  const queryTokens = new Set(expandedTokens(query))
  for (const rule of INTENT_RULES) {
    if (rule.phrases.some((phrase) => matchesPhrase(queryTokens, phrase))) return rule.answer
  }
  return null
}

/**
 * Route `question` to the matching deterministic answerer. `lang` is
 * accepted for API symmetry with the rest of the assistant (display strings
 * are resolved by the caller via `i18n.ts`); intent detection itself already
 * checks both English and Arabic phrasing regardless of `lang`.
 */
export function routeQuestion(
  digests: readonly ArisProcessDigest[],
  question: string,
  _lang: ArisAssistantLang
): ArisAssistantAnswer {
  const intent = detectIntent(question)
  if (intent === 'processList') return answerProcessList(digests)
  if (intent) {
    const answer = intent(digests, question)
    if (answer.kind !== 'none') return answer
    // A recognized intent that still found nothing confident falls through
    // to topic matching rather than giving up immediately — the question
    // may simply be phrased more like a topic search than the intent
    // keyword suggested.
  }
  const topic = answerTopicMatch(digests, question)
  if (topic.kind !== 'none') return topic
  return noneAnswer()
}

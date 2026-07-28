// Resolves an `ArisAssistantAnswer` (pure data — message keys, vars, chip
// references) into display strings for a given UI language. Kept separate
// from `answer.ts` so the answerers themselves never format text — only this
// module (and, transitively, whatever draws the assistant drawer) needs to
// know about `i18n.ts`. Mirrors the DATA -> display split
// `src/assist/formatLocal.ts` uses for the BPMN assistant.

import type { ArisAnswerChip, ArisAnswerListItem, ArisAssistantAnswer } from './answer'
import { tAssistant, type ArisAssistantLang } from './i18n'

export interface ArisFormattedAnswerLine {
  readonly text: string
  readonly chip?: ArisAnswerChip
}

export interface ArisFormattedAnswer {
  readonly lines: readonly ArisFormattedAnswerLine[]
  readonly chips: readonly ArisAnswerChip[]
}

function formatItem(lang: ArisAssistantLang, item: ArisAnswerListItem): ArisFormattedAnswerLine {
  const base = item.messageKey ? tAssistant(lang, item.messageKey, item.vars) : (item.text ?? '')
  const text = item.detail && !item.messageKey ? `${base} (${item.detail})` : base
  return item.chip ? { text, chip: item.chip } : { text }
}

export function formatAnswer(lang: ArisAssistantLang, answer: ArisAssistantAnswer): ArisFormattedAnswer {
  const lines: ArisFormattedAnswerLine[] = []
  for (const part of answer.parts) {
    lines.push({ text: tAssistant(lang, part.messageKey, part.vars) })
    for (const item of part.items ?? []) lines.push(formatItem(lang, item))
  }
  return { lines, chips: answer.chips }
}

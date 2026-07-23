// Render a deterministic answerLocally() result into the assistant drawer's
// display string plus the set of openable source processes. Kept pure (only
// depends on i18n) so the branch logic — next / complete / candidates / none,
// the bulleted next-steps with owner + condition suffixes — is unit-testable.

import { t } from '../i18n'
import type { LocalAnswer } from './answerLocal'

export interface AssistantSource {
  processName: string
  relPath: string
}

export function formatLocalAnswer(answer: LocalAnswer): { text: string; sources: AssistantSource[] } {
  if (answer.kind === 'next') {
    const step = answer.step?.name ?? ''
    const process = answer.process?.processName ?? ''
    const sources: AssistantSource[] = answer.process
      ? [{ processName: answer.process.processName, relPath: answer.process.relPath }]
      : []
    // An empty `nexts` means the matched step ENDS the process — word it as
    // complete rather than showing an empty next-step list.
    if (!answer.nexts || answer.nexts.length === 0) {
      return { text: t('assist.local.complete', { step, process }), sources }
    }
    const lines = answer.nexts.map((n) => {
      let line = `• ${n.name}`
      if (n.owner) line += ` — ${n.owner}`
      if (n.condition) line += ` (${n.condition})`
      return line
    })
    return { text: `${t('assist.local.next', { step, process })}\n${lines.join('\n')}`, sources }
  }

  const candidates = answer.candidates ?? []
  const sources: AssistantSource[] = candidates.map((c) => ({
    processName: c.processName,
    relPath: c.relPath
  }))
  const bullets = candidates.map((c) => `• ${c.processName}`).join('\n')
  if (answer.kind === 'candidates') {
    return { text: `${t('assist.local.candidates')}\n${bullets}`, sources }
  }
  // none — append suggestions when general retrieval offered any.
  const text = bullets ? `${t('assist.local.none')}\n${bullets}` : t('assist.local.none')
  return { text, sources }
}

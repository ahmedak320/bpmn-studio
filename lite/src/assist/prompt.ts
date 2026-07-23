// LLM prompt builder for the OrbitPM Lite process assistant.
//
// Produces a single grounded prompt string: a tight instruction block that
// pins the model to the documented processes (no outside knowledge, always name
// the process + exact step, always give the next step and who owns it), then
// the rendered process context (from retrieval.buildContext) and the user's
// question. The reply language follows `lang`.

/**
 * Build the grounded assistant prompt from a rendered process `context` and the
 * user's `question`, instructing a reply in Arabic when `lang === 'ar'`,
 * otherwise English.
 */
export function buildAssistantPrompt(context: string, question: string, lang: 'en' | 'ar'): string {
  const replyLanguage = lang === 'ar' ? 'Arabic' : 'English'
  const instructions = [
    'You are a process guide for this organization.',
    'Answer ONLY from the documented processes below — do not use outside knowledge or invent steps.',
    'Always name the process and the exact step you are referring to.',
    'Always state the next step(s) and their responsible party.',
    'If the answer is not in the documented processes, say you cannot find it and suggest the closest documented process.',
    'Be concise: at most 8 sentences.',
    `Reply in ${replyLanguage}.`
  ].join('\n')

  return `${instructions}\n\n# Documented processes\n${context}\n# Question\n${question}`
}

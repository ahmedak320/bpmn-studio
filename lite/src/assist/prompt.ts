// LLM prompt builder + reply extractor for the OrbitPM Lite process assistant.
//
// Produces a grounded prompt: a tight instruction block that pins the model to
// the documented processes (no outside knowledge, always name the process +
// exact step, always give the next step and who owns it), then the rendered
// process context (from retrieval.buildContext) and the user's question. The
// reply language follows `lang`.
//
// WHY the JSON wrapper: the shared browser transport (makeBrowserCallLLM)
// hard-enables provider JSON mode for every request — OpenRouter gets
// `response_format: {type: "json_object"}` (which OpenAI-compatible backends
// REJECT with HTTP 400 unless the prompt itself mentions JSON) and Gemini gets
// `responseMimeType: application/json` (which FORCES a JSON body). A plain
// free-text prompt therefore either 400s or comes back as raw JSON pasted into
// the chat bubble. Asking for `{"answer": "…"}` explicitly makes every
// provider happy, and extractAssistantAnswer unwraps it (leniently — plain
// text from providers that ignore the mode flag passes straight through).

import { parseJsonLoose } from '@app/gen'

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
    'Use the recorded details when they are present: owners, responsible people, inputs, outputs, CC recipients and their purposes, decision basis, systems, and triggers.',
    'If the answer is not in the documented processes, say you cannot find it and suggest the closest documented process.',
    'Be concise: at most 8 sentences.',
    `Reply in ${replyLanguage}.`,
    'Respond with ONLY a JSON object of exactly this form: {"answer": "<your reply>"} — no other keys, no markdown.'
  ].join('\n')

  return `${instructions}\n\n# Documented processes\n${context}\n# Question\n${question}`
}

/**
 * Unwrap a model reply produced under the {"answer": "…"} contract into the
 * display text. Lenient by design:
 *   - loose-parsed JSON object with a string `answer` -> that answer;
 *   - object with a DIFFERENT single string value (model renamed the key) ->
 *     that value;
 *   - anything else (plain text, arrays, numbers, unparseable prose) -> the
 *     raw reply, trimmed.
 * Never throws.
 */
export function extractAssistantAnswer(raw: string): string {
  const fallback = raw.trim()
  let parsed: unknown
  try {
    parsed = parseJsonLoose(raw)
  } catch {
    return fallback
  }
  if (typeof parsed === 'string') return parsed.trim() || fallback
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>
    const answer = record.answer
    if (typeof answer === 'string' && answer.trim()) return answer.trim()
    const stringValues = Object.values(record).filter(
      (v): v is string => typeof v === 'string' && v.trim() !== ''
    )
    if (stringValues.length === 1) return stringValues[0].trim()
  }
  return fallback
}

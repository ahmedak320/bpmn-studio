import {
  SEEDED_GLOSSARY,
  approvedNeutralTerms,
  normalizeLocalizationLookup
} from './glossary'
import type { GlossaryEntry, LanguageCode, ScriptClass } from './types'

const ARABIC_SCRIPT = /\p{Script=Arabic}/u
const LATIN_SCRIPT = /\p{Script=Latin}/u
const LETTER = /\p{Letter}/u
const NUMBER = /\p{Number}/u

const URL_VALUE =
  /^(?:(?:https?|ftp):\/\/|(?:mailto|tel):|www\.)[^\s]+$/iu
const EMAIL_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

/**
 * Conservative identifier/code recognition. A plain uppercase word or phrase
 * is intentionally NOT accepted. Structural evidence (digit, underscore,
 * namespace/path delimiter, or camelCase) is required; a single Latin letter
 * covers reviewed one-letter codes such as RACI values.
 */
function isIdentifierOrCode(value: string): boolean {
  if (/\s/u.test(value) || !/^[\p{L}\p{N}_:./#-]+$/u.test(value)) return false
  if (/^[A-Za-z]$/u.test(value)) return true
  if (/[_:/#]/u.test(value)) return true
  if (/\p{Number}/u.test(value) && /\p{Letter}/u.test(value)) return true
  return /^[a-z]+(?:[A-Z][A-Za-z0-9]*)+$/u.test(value)
}

function isNumericOnly(value: string): boolean {
  let numberSeen = false
  for (const char of value) {
    if (NUMBER.test(char)) {
      numberSeen = true
      continue
    }
    if (LETTER.test(char) || /\p{Symbol}/u.test(char)) return false
  }
  return numberSeen
}

function neutralKey(value: string): string {
  return normalizeLocalizationLookup(value).toLocaleLowerCase('en-US')
}

export interface ScriptClassifierOptions {
  /**
   * Exact approved neutral values. When omitted, the seeded glossary is used;
   * when supplied (even as []), it is the complete editable workspace list.
   */
  approvedNeutralTerms?: Iterable<string>
}

function neutralSet(options: ScriptClassifierOptions): Set<string> {
  const terms =
    options.approvedNeutralTerms === undefined
      ? approvedNeutralTerms(SEEDED_GLOSSARY)
      : [...options.approvedNeutralTerms]
  return new Set(
    terms
      .map((term) => neutralKey(String(term)))
      .filter((term) => term !== '')
  )
}

export function classifyScript(
  input: string | null | undefined,
  options: ScriptClassifierOptions = {}
): ScriptClass {
  if (input == null) return 'unknown'
  const value = normalizeLocalizationLookup(String(input))
  if (!value) return 'unknown'

  if (
    neutralSet(options).has(neutralKey(value)) ||
    URL_VALUE.test(value) ||
    EMAIL_VALUE.test(value) ||
    isNumericOnly(value) ||
    isIdentifierOrCode(value)
  ) {
    return 'neutral'
  }

  let arabic = false
  let latin = false
  let otherLetters = false
  for (const char of value) {
    if (!LETTER.test(char)) continue
    if (ARABIC_SCRIPT.test(char)) arabic = true
    else if (LATIN_SCRIPT.test(char)) latin = true
    else otherLetters = true
  }

  const scriptKinds = Number(arabic) + Number(latin) + Number(otherLetters)
  if (scriptKinds > 1) return 'mixed'
  if (arabic) return 'arabic'
  if (latin) return 'english'
  return 'unknown'
}

export interface ScriptSegment {
  text: string
  script: ScriptClass
}

/**
 * Token-preserving segmentation for mixed-field review. Whitespace is kept
 * with the preceding segment, so joining segment text always reconstructs the
 * exact input.
 */
export function segmentByScript(
  input: string,
  options: ScriptClassifierOptions = {}
): ScriptSegment[] {
  const tokens = input.match(/\s+|[^\s]+/gu) ?? []
  const output: ScriptSegment[] = []
  for (const token of tokens) {
    if (/^\s+$/u.test(token)) {
      if (output.length === 0) {
        output.push({ text: token, script: 'unknown' })
      } else {
        output[output.length - 1].text += token
      }
      continue
    }
    const script = classifyScript(token, options)
    const previous = output[output.length - 1]
    if (previous?.script === script) previous.text += token
    else output.push({ text: token, script })
  }
  return output
}

export interface TargetValidationOptions extends ScriptClassifierOptions {
  approvedEnglishBilingualExceptions?: Iterable<string>
}

function exactApproved(
  value: string,
  approved: Iterable<string> | undefined
): boolean {
  if (!approved) return false
  const key = neutralKey(value)
  for (const candidate of approved) {
    if (neutralKey(String(candidate)) === key) return true
  }
  return false
}

export interface TargetValidation {
  valid: boolean
  script: ScriptClass
}

export function validateTargetScript(
  value: string | null | undefined,
  target: LanguageCode,
  options: TargetValidationOptions = {}
): TargetValidation {
  const script = classifyScript(value, options)
  if (script === 'neutral') return { valid: true, script }
  if (target === 'ar') return { valid: script === 'arabic', script }
  if (script === 'english') return { valid: true, script }
  if (
    script === 'mixed' &&
    value != null &&
    exactApproved(value, options.approvedEnglishBilingualExceptions)
  ) {
    return { valid: true, script }
  }
  return { valid: false, script }
}

export function classifierOptionsFromGlossary(
  glossary: readonly GlossaryEntry[]
): ScriptClassifierOptions {
  return { approvedNeutralTerms: approvedNeutralTerms(glossary) }
}


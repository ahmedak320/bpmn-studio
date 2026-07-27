import type { LlmMessage } from '@/generation'
import type { ProcessDigest } from './digest'
import { buildContext } from './retrieval'
import { buildAssistantPrompt } from './prompt'
import {
  createExternalRequestDisclosure,
  type ExternalRequestDisclosure
} from '../localization/externalRequestReview'
import { UNTRUSTED_WORKSPACE_SYSTEM_GUARD } from '../ai/untrustedPrompt'

export interface RankedProcessDigest {
  digest: ProcessDigest
  score: number
}

export interface ReviewedLlmRequest {
  messages: LlmMessage[]
  disclosure: ReviewedExternalRequestDisclosure
}

export interface OutboundSensitivity {
  containsNames: boolean
  containsSensitiveMetadata: boolean
}

/**
 * The consent schema stays provider-agnostic and fingerprinted over the exact
 * outbound payload. These two derived flags are display-only annotations over
 * that reviewed payload; they are never supplied by a caller.
 */
export type ReviewedExternalRequestDisclosure = ExternalRequestDisclosure & OutboundSensitivity

export interface BuildMessageDisclosureInput {
  purpose: string
  providerId: string
  modelId: string
  messages: readonly LlmMessage[]
  estimatedRequests?: { min: number; max: number }
  /** Mark every message that contains raw workspace text as sensitive. */
  sensitiveMessageIndexes?: readonly number[]
  /**
   * Exact dynamic text fragments encoded into `messages` (question, prior
   * turns, diagram summary, and similar untrusted data). Supplying these avoids
   * classifying static prompt examples as user data.
   */
  sensitivityTexts?: readonly string[]
}

function redactedStepName(index: number): string {
  return `Step ${index + 1}`
}

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const EMAIL_RE_GLOBAL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/
const SECRETISH_RE = /\b(?:api[_ -]?key|password|secret|token)\b/i
const MULTIWORD_PERSON_NAME_RE =
  /(?:^|[^\p{L}\p{M}])(?:\p{Lu}[\p{Ll}\p{M}'’.-]{1,})(?:[ \t]+\p{Lu}[\p{Ll}\p{M}'’.-]{1,})+(?=$|[^\p{L}\p{M}])/u
const LABELED_PERSON_RE =
  /\b(?:approver|customer|employee|manager|owner|requester|responsible|recipient|contact)\s*[:=-]\s*[\p{L}\p{M}'’.-]{2,}/iu
const PERSON_ACTION_RE =
  /(?:^|[.!?]\s+)\p{Lu}[\p{Ll}\p{M}'’.-]{1,}\s+(?:approves?|reviews?|requests?|sends?|submits?|notifies?|calls?|emails?|owns?|manages?)\b/u
const ARABIC_PERSON_LABEL_RE =
  /(?:السيد(?:ة)?|الموظف(?:ة)?|المدير(?:ة)?|المسؤول(?:ة)?|العميل(?:ة)?)[ \t]+[\p{Script=Arabic}\p{M}]{2,}(?:[ \t]+[\p{Script=Arabic}\p{M}]{2,})?/u
const ARABIC_NAME_ACTION_RE =
  /(?:^|[.!؟?][ \t]+)[\p{Script=Arabic}\p{M}]{2,}(?:[ \t]+[\p{Script=Arabic}\p{M}]{2,}){1,2}[ \t]+(?:يوافق|توافق|يراجع|تراجع|يرسل|ترسل|يعتمد|تعتمد|يتصل|تتصل)(?=$|[^\p{Script=Arabic}\p{M}])/u
const ARABIC_ACTION_NAME_RE =
  /(?:يوافق|توافق|يراجع|تراجع|يرسل|ترسل|يعتمد|تعتمد|يتصل|تتصل)[ \t]+[\p{Script=Arabic}\p{M}]{2,}(?:[ \t]+[\p{Script=Arabic}\p{M}]{2,}){1,2}/u
const ARABIC_MULTIWORD_RE = /[\p{Script=Arabic}\p{M}]{2,}[ \t]+[\p{Script=Arabic}\p{M}]{2,}/u
const TITLE_CASE_WORD_RE = /\b\p{Lu}[\p{Ll}\p{M}'’.-]{1,}\b/gu

const SAFE_REDACTION_WORDS = new Set([
  'Arabic',
  'Bpmn',
  'English',
  'Element',
  'Process',
  'Step',
  'Task',
  'Trigger',
  'What',
  'Who',
  'When',
  'Where',
  'Why',
  'How',
  'Please',
  'Does',
  'Do',
  'Is',
  'Are',
  'Can',
  'Could',
  'Would',
  'Contact'
])

function combinedSensitivityText(values: readonly string[]): string {
  return values.join('\n')
}

/** Classify only the exact dynamic text encoded into the reviewed messages. */
export function inspectOutboundSensitivity(values: readonly string[]): OutboundSensitivity {
  const text = combinedSensitivityText(values)
  return {
    containsNames: containsDetectedPersonName(text),
    containsSensitiveMetadata: EMAIL_RE.test(text) || PHONE_RE.test(text) || SECRETISH_RE.test(text)
  }
}

function containsDetectedPersonName(text: string): boolean {
  const titleCaseWords = text.match(TITLE_CASE_WORD_RE) ?? []
  return (
    MULTIWORD_PERSON_NAME_RE.test(text) ||
    titleCaseWords.some((word) => !SAFE_REDACTION_WORDS.has(word)) ||
    LABELED_PERSON_RE.test(text) ||
    PERSON_ACTION_RE.test(text) ||
    ARABIC_PERSON_LABEL_RE.test(text) ||
    ARABIC_NAME_ACTION_RE.test(text) ||
    ARABIC_ACTION_NAME_RE.test(text) ||
    ARABIC_MULTIWORD_RE.test(text)
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Conservative local name redaction for free-text fields. Structured process
 * metadata is removed separately; here title-cased tokens and explicit known
 * names are aliased so descriptions, questions, and prior answers cannot put
 * those names back into the outbound prompt. Email addresses are removed too
 * because their local part commonly embeds a person's name.
 */
export function redactPersonNames(value: string, explicitNames: readonly string[] = []): string {
  let aliasIndex = 0
  const aliases = new Map<string, string>()
  const aliasFor = (raw: string): string => {
    const key = raw.toLocaleLowerCase()
    const existing = aliases.get(key)
    if (existing) return existing
    const alias = `[redacted name ${++aliasIndex}]`
    aliases.set(key, alias)
    return alias
  }

  let redacted = value.replace(EMAIL_RE_GLOBAL, '[redacted sensitive metadata]')
  for (const candidate of [...explicitNames]
    .map((name) => name.trim())
    .filter((name) => name.length >= 2)
    .sort((left, right) => right.length - left.length)) {
    redacted = redacted.replace(new RegExp(escapeRegExp(candidate), 'giu'), () =>
      aliasFor(candidate)
    )
  }

  redacted = redacted.replace(TITLE_CASE_WORD_RE, (word) =>
    SAFE_REDACTION_WORDS.has(word) ? word : aliasFor(word)
  )
  redacted = redacted.replace(
    /((?:السيد(?:ة)?|الموظف(?:ة)?|المدير(?:ة)?|المسؤول(?:ة)?|العميل(?:ة)?)[ \t]+)([\p{Script=Arabic}\p{M}]{2,}(?:[ \t]+[\p{Script=Arabic}\p{M}]{2,})?)/gu,
    (_match, label: string, name: string) => `${label}${aliasFor(name)}`
  )
  redacted = redacted.replace(
    /(^|[.!؟?][ \t]+)([\p{Script=Arabic}\p{M}]{2,}(?:[ \t]+[\p{Script=Arabic}\p{M}]{2,}){1,2})([ \t]+(?:يوافق|توافق|يراجع|تراجع|يرسل|ترسل|يعتمد|تعتمد|يتصل|تتصل)(?=$|[^\p{Script=Arabic}\p{M}]))/gu,
    (_match, prefix: string, name: string, action: string) => `${prefix}${aliasFor(name)}${action}`
  )
  redacted = redacted.replace(
    /((?:يوافق|توافق|يراجع|تراجع|يرسل|ترسل|يعتمد|تعتمد|يتصل|تتصل)[ \t]+)([\p{Script=Arabic}\p{M}]{2,}(?:[ \t]+[\p{Script=Arabic}\p{M}]{2,}){1,2})/gu,
    (_match, action: string, name: string) => `${action}${aliasFor(name)}`
  )
  return containsDetectedPersonName(redacted) ? '[redacted free text]' : redacted
}

export function redactLlmMessageNames(messages: readonly LlmMessage[]): LlmMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: redactPersonNames(message.content)
  }))
}

/** Fail closed if execution attempts to send anything other than the preview. */
export function assertLlmMessagesMatchDisclosure(
  messages: readonly LlmMessage[],
  disclosure: ExternalRequestDisclosure
): void {
  if (
    messages.length !== disclosure.outbound.length ||
    messages.some((message, index) => {
      const item = disclosure.outbound[index]
      return item?.text !== message.content || item.context !== message.role
    })
  ) {
    throw new Error('External request changed after consent; review it again.')
  }
}

/**
 * Remove process, path, person, party, system, note, and free-text detail names
 * while retaining stable BPMN ids and enough topology for grounded answers.
 */
export function redactAssistantDigests(
  ranked: readonly RankedProcessDigest[]
): RankedProcessDigest[] {
  return ranked.map(({ digest, score }, processIndex) => {
    const stepNames = new Map(
      digest.steps.map((step, stepIndex) => [step.id, redactedStepName(stepIndex)])
    )
    return {
      score,
      digest: {
        ...digest,
        relPath: `${digest.processId}.bpmn`,
        folder: '',
        processName: `Process ${processIndex + 1}`,
        owner: undefined,
        trigger: digest.trigger ? { type: redactPersonNames(digest.trigger.type) } : undefined,
        notes: [],
        steps: digest.steps
          .map((step, stepIndex) => ({
            id: step.id,
            name: redactedStepName(stepIndex),
            type: step.type,
            calledProcess: step.calledProcess,
            nexts: step.nexts.map((next) => ({
              ...next,
              // Conditions can carry names and operational details. Preserve the
              // branch topology but require the user to send the raw wording
              // explicitly by turning redaction off.
              condition: next.condition ? '[redacted condition]' : undefined
            })),
            // Keep a deterministic alias available to context rendering even
            // when a target id is absent from the selected digest.
            nameEn: undefined,
            nameAr: undefined,
            owner: undefined,
            ownerRole: undefined,
            respList: undefined,
            channel: undefined,
            channelDetail: undefined,
            ccTo: undefined,
            ccList: undefined,
            system: undefined
          }))
          .map((step) => ({
            ...step,
            name: stepNames.get(step.id) ?? step.name
          }))
      }
    }
  })
}

export function createLlmMessageDisclosure(
  input: BuildMessageDisclosureInput
): ReviewedExternalRequestDisclosure {
  const sensitiveIndexes = new Set(input.sensitiveMessageIndexes ?? [])
  const disclosure = createExternalRequestDisclosure({
    purpose: input.purpose,
    providerId: input.providerId,
    modelId: input.modelId,
    outbound: input.messages.map((message, index) => ({
      id: `message-${index + 1}`,
      text: message.content,
      context: message.role,
      sensitive: sensitiveIndexes.has(index)
    })),
    estimatedRequests: input.estimatedRequests ?? { min: 1, max: 1 }
  })
  return {
    ...disclosure,
    ...inspectOutboundSensitivity(
      input.sensitivityTexts ?? input.messages.map((message) => message.content)
    )
  }
}

export function buildReviewedLibraryRequest(input: {
  providerId: string
  modelId: string
  question: string
  history: readonly LlmMessage[]
  rankedDigests: readonly RankedProcessDigest[]
  lang: 'en' | 'ar'
  includeWorkspaceContext: boolean
  redactNames: boolean
  estimatedRequests?: { min: number; max: number }
}): ReviewedLlmRequest {
  const selected = input.includeWorkspaceContext
    ? input.redactNames
      ? redactAssistantDigests(input.rankedDigests)
      : input.rankedDigests.map(({ digest, score }) => ({ digest, score }))
    : []
  const context = buildContext(selected)
  const history = input.redactNames
    ? redactLlmMessageNames(input.history)
    : input.history.map((message) => ({ ...message }))
  const question = input.redactNames ? redactPersonNames(input.question) : input.question
  const messages: LlmMessage[] = [
    { role: 'system', content: UNTRUSTED_WORKSPACE_SYSTEM_GUARD },
    ...history,
    {
      role: 'user',
      content: buildAssistantPrompt(context, question, input.lang)
    }
  ]
  const disclosure = createLlmMessageDisclosure({
    purpose: 'assistant-library-answer',
    providerId: input.providerId,
    modelId: input.modelId,
    messages,
    sensitiveMessageIndexes: input.includeWorkspaceContext ? [messages.length - 1] : [],
    sensitivityTexts: [...history.map((message) => message.content), context, question],
    estimatedRequests: input.estimatedRequests
  })
  if (input.redactNames && disclosure.containsNames) {
    throw new Error('Name redaction could not safely prepare this request.')
  }
  return {
    messages,
    disclosure
  }
}

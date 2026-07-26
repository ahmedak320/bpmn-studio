import type { LlmMessage } from '@/generation'
import type { ProcessDigest } from './digest'
import { buildContext } from './retrieval'
import { buildAssistantPrompt } from './prompt'
import {
  createExternalRequestDisclosure,
  type ExternalRequestDisclosure
} from '../localization/externalRequestReview'

export interface RankedProcessDigest {
  digest: ProcessDigest
  score: number
}

export interface ReviewedLlmRequest {
  messages: LlmMessage[]
  disclosure: ExternalRequestDisclosure
}

export interface BuildMessageDisclosureInput {
  purpose: string
  providerId: string
  modelId: string
  messages: readonly LlmMessage[]
  estimatedRequests?: { min: number; max: number }
  /** Mark every message that contains raw workspace text as sensitive. */
  sensitiveMessageIndexes?: readonly number[]
}

function redactedStepName(index: number): string {
  return `Step ${index + 1}`
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
        trigger: digest.trigger ? { type: digest.trigger.type } : undefined,
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
): ExternalRequestDisclosure {
  const sensitiveIndexes = new Set(input.sensitiveMessageIndexes ?? [])
  return createExternalRequestDisclosure({
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
  const messages: LlmMessage[] = [
    ...input.history,
    {
      role: 'user',
      content: buildAssistantPrompt(context, input.question, input.lang)
    }
  ]
  return {
    messages,
    disclosure: createLlmMessageDisclosure({
      purpose: 'assistant-library-answer',
      providerId: input.providerId,
      modelId: input.modelId,
      messages,
      sensitiveMessageIndexes: input.includeWorkspaceContext ? [messages.length - 1] : [],
      estimatedRequests: input.estimatedRequests
    })
  }
}

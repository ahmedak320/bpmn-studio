// @vitest-environment jsdom

import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LlmMessage, GenerateOptions, GenerateResult, CallLLM } from '@/generation'
import { composeCreateBpmn, messageHistoryToString } from '@/generation'
import { UNTRUSTED_WORKSPACE_SYSTEM_GUARD } from '../../ai/untrustedPrompt'
import type { LiteProviderId } from '../../ai/providersLite'

const state = vi.hoisted(() => ({
  selection: {
    providerId: 'anthropic' as LiteProviderId,
    modelId: 'claude-sonnet-4-5-20250929'
  }
}))

const mocks = vi.hoisted(() => ({
  llmCall: vi.fn(),
  generateFromDescription: vi.fn()
}))

vi.mock('../../i18n', () => ({
  getLang: (): 'en' => 'en',
  t: (key: string): string => key
}))

vi.mock('../../i18n/useLang', () => ({
  useLang: (): 'en' => 'en'
}))

vi.mock('../../ai/keys', () => ({
  getKey: (): string => 'session-key'
}))

vi.mock('../../ai/providerSelection', () => ({
  getProviderSelection: () => state.selection
}))

vi.mock('../../ai/browserAi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ai/browserAi')>()
  return {
    ...actual,
    makeBrowserCallLLM: vi.fn(() => mocks.llmCall),
    classifyBrowserError: (error: unknown) => ({
      code: error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'unknown',
      message: error instanceof Error ? error.message : String(error),
      offline: false
    })
  }
})

vi.mock('@/generation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/generation')>()
  return {
    ...actual,
    generateFromDescription: mocks.generateFromDescription
  }
})

import {
  AssistantDrawer,
  type AssistantDrawerProps,
  type InterviewApplyRequest
} from '../AssistantDrawer'

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const root = {
  id: 'Process_interview',
  type: 'bpmn:Process',
  businessObject: { id: 'Process_interview', $type: 'bpmn:Process' }
}
const task = {
  id: 'Task_review',
  type: 'bpmn:UserTask',
  businessObject: {
    name: 'Alice Review',
    $attrs: {
      'orbitpm:owner': 'Bob Owner',
      'orbitpm:inputs': 'Carol dossier',
      'orbitpm:outputs': 'Diana memo',
      'orbitpm:system': 'Grace Hub'
    }
  }
}
const start = {
  id: 'Start_private',
  type: 'bpmn:StartEvent',
  businessObject: {
    name: 'Private Start',
    $attrs: {
      'orbitpm:trigger': 'Ivan called',
      'orbitpm:triggerService': 'Judy Desk'
    }
  }
}
const gateway = {
  id: 'Gateway_private',
  type: 'bpmn:ExclusiveGateway',
  businessObject: {
    name: 'Private Decision',
    $attrs: {
      'orbitpm:decisionBasis': 'Mallory policy'
    }
  }
}
const modeler = {
  get(service: string): unknown {
    if (service === 'elementRegistry') return { getAll: () => [start, task, gateway] }
    if (service === 'canvas') return { getRootElement: () => root }
    throw new Error(`Unexpected modeler service: ${service}`)
  }
}

function result(xml = '<definitions id="generated" />'): GenerateResult {
  return {
    ir: [],
    semanticXml: xml,
    layoutedXml: xml,
    preLayoutValidation: {} as GenerateResult['preLayoutValidation'],
    postLayoutValidation: {} as GenerateResult['postLayoutValidation']
  }
}

async function callReviewedGenerationPayload(
  callLLM: CallLLM,
  history: LlmMessage[] | undefined,
  options: GenerateOptions | undefined
): Promise<void> {
  const baseHistory = history ?? []
  const prompt = composeCreateBpmn(messageHistoryToString(baseHistory), options?.processCatalog)
  await callLLM(
    [
      { role: 'system', content: UNTRUSTED_WORKSPACE_SYSTEM_GUARD },
      { role: 'user', content: prompt }
    ],
    { maxTokens: 6000 }
  )
}

function ControlledDrawer(props: Pick<AssistantDrawerProps, 'onApplyXml'>): JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <AssistantDrawer
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      printing={false}
      mode="directory"
      keysVersion={1}
      getDigests={vi.fn().mockResolvedValue([])}
      onOpenProcess={vi.fn()}
      getActiveInterviewTarget={() => ({
        tabKey: 'tab-interview',
        modeler,
        description: 'Zuleika Request starts when Frank Caller emails grace@example.test'
      })}
      interviewRequest={{ token: 1, tabKey: 'tab-interview' }}
      onApplyXml={props.onApplyXml}
    />
  )
}

async function reachRegenerationPreview(
  user: ReturnType<typeof userEvent.setup>
): Promise<HTMLElement> {
  const questionPreview = await screen.findByRole('region', {
    name: 'ai.privacy.preview.title'
  })
  expectPrivateNamesAbsent(questionPreview.textContent ?? '')
  await user.click(within(questionPreview).getByLabelText('ai.privacy.consent'))
  await user.click(within(questionPreview).getByRole('button', { name: 'assist.send' }))
  expect(await screen.findByText('Who approves this step?')).not.toBeNull()
  const questionMessages = mocks.llmCall.mock.calls[0]?.[0] as LlmMessage[]
  expect(questionMessages.map((message) => message.content)).toEqual(
    previewOutboundTexts(questionPreview)
  )
  expectPrivateNamesAbsent(JSON.stringify(questionMessages))

  fireEvent.change(screen.getByLabelText('assist.placeholder'), {
    target: { value: 'Heidi Reviewer approves it' }
  })
  await user.click(screen.getByRole('button', { name: 'assist.send' }))
  const regenerationPreview = await screen.findByRole('region', {
    name: 'ai.privacy.preview.title'
  })
  expectPrivateNamesAbsent(regenerationPreview.textContent ?? '')
  return regenerationPreview
}

async function confirmPreview(
  user: ReturnType<typeof userEvent.setup>,
  preview: HTMLElement
): Promise<void> {
  await user.click(within(preview).getByLabelText('ai.privacy.consent'))
  await user.click(within(preview).getByRole('button', { name: 'assist.send' }))
}

const PRIVATE_VALUES = [
  'Alice',
  'Bob',
  'Carol',
  'Diana',
  'Zuleika',
  'Frank',
  'Grace',
  'Heidi',
  'Ivan',
  'Judy',
  'Mallory',
  'grace@example.test'
]

function expectPrivateNamesAbsent(text: string): void {
  for (const value of PRIVATE_VALUES) expect(text).not.toContain(value)
}

function previewOutboundTexts(preview: HTMLElement): string[] {
  return [...preview.querySelectorAll('ol li > div')].map((element) => element.textContent ?? '')
}

beforeEach(() => {
  mocks.llmCall.mockReset().mockResolvedValue('{"questions":["Who approves this step?"]}')
  mocks.generateFromDescription.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('AssistantDrawer interview cancellation', () => {
  it('does not apply when cancelled after the model response but before generation returns', async () => {
    const user = userEvent.setup()
    const afterModel = deferred<void>()
    const finishGeneration = deferred<void>()
    const onApplyXml = vi.fn()
    mocks.generateFromDescription.mockImplementation(
      async (
        callLLM: CallLLM,
        _description: string,
        history?: LlmMessage[],
        options?: GenerateOptions
      ) => {
        await callReviewedGenerationPayload(callLLM, history, options)
        afterModel.resolve()
        await finishGeneration.promise
        return result()
      }
    )

    render(<ControlledDrawer onApplyXml={onApplyXml} />)
    const preview = await reachRegenerationPreview(user)
    await confirmPreview(user, preview)
    await afterModel.promise
    const regenerationMessages = mocks.llmCall.mock.calls[1]?.[0] as LlmMessage[]
    expect(regenerationMessages.map((message) => message.content)).toEqual(
      previewOutboundTexts(preview)
    )
    expectPrivateNamesAbsent(JSON.stringify(regenerationMessages))

    await user.click(within(preview).getByRole('button', { name: 'ai.cancel' }))
    finishGeneration.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))

    await waitFor(() => expect(onApplyXml).not.toHaveBeenCalled())
    expect(screen.queryByText('assist.interview.applied')).toBeNull()
    expect(screen.queryByRole('region', { name: 'ai.privacy.preview.title' })).toBeNull()
    expect(mocks.llmCall).toHaveBeenCalledTimes(2)
  })

  it('aborts the apply contract and starts no success or next round when closed during apply', async () => {
    const user = userEvent.setup()
    const applyStarted = deferred<void>()
    const finishApply = deferred<void>()
    const onApplyXml = vi.fn(
      async (_tabKey: string, _xml: string, _request: InterviewApplyRequest) => {
        applyStarted.resolve()
        await finishApply.promise
      }
    )
    mocks.generateFromDescription.mockImplementation(
      async (
        callLLM: CallLLM,
        _description: string,
        history?: LlmMessage[],
        options?: GenerateOptions
      ) => {
        await callReviewedGenerationPayload(callLLM, history, options)
        return result()
      }
    )

    render(<ControlledDrawer onApplyXml={onApplyXml} />)
    const preview = await reachRegenerationPreview(user)
    await confirmPreview(user, preview)
    await applyStarted.promise
    const regenerationMessages = mocks.llmCall.mock.calls[1]?.[0] as LlmMessage[]
    expect(regenerationMessages.map((message) => message.content)).toEqual(
      previewOutboundTexts(preview)
    )
    expectPrivateNamesAbsent(JSON.stringify(regenerationMessages))

    await user.click(screen.getByRole('button', { name: 'assist.close' }))
    const observedApplyRequest: InterviewApplyRequest | undefined = onApplyXml.mock.calls[0]?.[2]
    if (!observedApplyRequest) throw new Error('Expected the apply request contract')
    expect(observedApplyRequest.signal.aborted).toBe(true)
    expect(observedApplyRequest.requestToken).toEqual(expect.any(Number))
    finishApply.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))

    await waitFor(() => expect(screen.getByRole('button', { name: 'assist.open' })).not.toBeNull())
    await user.click(screen.getByRole('button', { name: 'assist.open' }))
    expect(screen.queryByText('assist.interview.applied')).toBeNull()
    expect(screen.queryByRole('region', { name: 'ai.privacy.preview.title' })).toBeNull()
    expect(mocks.llmCall).toHaveBeenCalledTimes(2)
  })
})

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LiteProviderId } from '../../ai/providersLite'
import type { ProcessDigest } from '../digest'

const state = vi.hoisted(() => ({
  selection: null as { providerId: LiteProviderId; modelId: string } | null,
  keyed: new Set<LiteProviderId>()
}))

const mocks = vi.hoisted(() => ({
  makeCallFactory: vi.fn(),
  llmCall: vi.fn(),
  classify: vi.fn()
}))

vi.mock('../../i18n', () => ({
  getLang: (): 'en' => 'en',
  t: (key: string): string => key
}))

vi.mock('../../i18n/useLang', () => ({
  useLang: (): 'en' => 'en'
}))

vi.mock('../../ai/keys', () => ({
  getKey: (providerId: LiteProviderId): string | null =>
    state.keyed.has(providerId) ? `${providerId}-session-key` : null
}))

vi.mock('../../ai/providerSelection', () => ({
  getProviderSelection: () => state.selection
}))

vi.mock('../../ai/browserAi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ai/browserAi')>()
  return {
    ...actual,
    makeBrowserCallLLM: mocks.makeCallFactory,
    classifyBrowserError: mocks.classify
  }
})

import { AssistantDrawer, type AssistantDrawerProps } from '../AssistantDrawer'

const digest: ProcessDigest = {
  relPath: 'HR/Employee_Exit.bpmn',
  folder: 'HR',
  processId: 'Proc_exit',
  processName: 'Employee Exit',
  owner: 'Fatima Al Mansoori',
  steps: [
    {
      id: 'Task_review',
      name: 'Conduct exit interview',
      type: 'UserTask',
      owner: 'HR Operations',
      nexts: [{ targetId: 'End_done', condition: 'Employee cleared' }]
    },
    {
      id: 'End_done',
      name: 'Exit complete',
      type: 'EndEvent',
      nexts: []
    }
  ],
  notes: ['Private employee record 7842'],
  callsTo: []
}

function renderDrawer(overrides: Partial<AssistantDrawerProps> = {}): ReturnType<typeof render> {
  return render(
    <AssistantDrawer
      open
      onOpen={vi.fn()}
      onClose={vi.fn()}
      printing={false}
      mode="directory"
      keysVersion={1}
      getDigests={vi.fn().mockResolvedValue([digest])}
      onOpenProcess={vi.fn()}
      {...overrides}
    />
  )
}

function selectAnthropic(): void {
  state.selection = {
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-5-20250929'
  }
  state.keyed.add('anthropic')
}

async function queueLibraryRequest(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  fireEvent.change(screen.getByLabelText('assist.placeholder'), {
    target: { value: 'What follows the exit interview?' }
  })
  await user.click(screen.getByRole('button', { name: 'assist.send' }))
  return await screen.findByRole('region', { name: 'ai.privacy.preview.title' })
}

beforeEach(() => {
  state.selection = null
  state.keyed.clear()
  mocks.llmCall.mockReset().mockResolvedValue('{"answer":"Grounded response"}')
  mocks.makeCallFactory.mockReset().mockImplementation(() => mocks.llmCall)
  mocks.classify.mockReset().mockImplementation((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    return {
      code: /abort|cancel/i.test(message) ? 'cancelled' : 'unknown',
      message,
      offline: false
    }
  })
})

afterEach(() => {
  cleanup()
})

describe('AssistantDrawer browser consent workflows', () => {
  it('keeps the open drawer out of the reserved bpmn.io attribution strip', () => {
    renderDrawer()
    const drawer = screen.getByLabelText('assist.title')
    expect(drawer.style.insetBlockEnd).toBe('80px')
  })

  it('keeps the closed launcher above the reserved bpmn.io attribution zone', () => {
    renderDrawer({ open: false })
    const launcher = screen.getByRole('button', { name: 'assist.open' })
    expect(launcher.style.insetBlockEnd).toBe('72px')
  })

  it('answers locally without constructing any external request', async () => {
    const user = userEvent.setup()
    const getDigests = vi.fn().mockResolvedValue([digest])
    renderDrawer({ getDigests })

    fireEvent.change(screen.getByLabelText('assist.placeholder'), {
      target: { value: 'Who owns the employee exit?' }
    })
    await user.click(screen.getByRole('button', { name: 'assist.send' }))

    await waitFor(() => expect(getDigests).toHaveBeenCalledOnce())
    expect(mocks.makeCallFactory).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'ai.privacy.preview.title' })).toBeNull()
    expect(screen.getByText('assist.localMode')).not.toBeNull()
  })

  it('keeps the network silent until exact consent and sends redacted opt-in context', async () => {
    selectAnthropic()
    const user = userEvent.setup()
    const onOpenProcess = vi.fn()
    renderDrawer({ onOpenProcess })

    const preview = await queueLibraryRequest(user)
    expect(mocks.makeCallFactory).not.toHaveBeenCalled()
    expect(mocks.llmCall).not.toHaveBeenCalled()

    const confirm = within(preview).getByRole('button', { name: 'assist.send' })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    await user.click(within(preview).getByLabelText('ai.privacy.includeWorkspace'))
    expect(within(preview).getByText(/Process 1/)).not.toBeNull()
    expect(preview.textContent).not.toContain('Fatima Al Mansoori')
    expect(preview.textContent).not.toContain('Private employee record 7842')

    await user.click(within(preview).getByLabelText('ai.privacy.consent'))
    await user.click(confirm)

    await waitFor(() => expect(mocks.llmCall).toHaveBeenCalledOnce())
    const messages = mocks.llmCall.mock.calls[0]?.[0] as Array<{ content: string }>
    expect(messages.at(-1)?.content).toContain('Process 1')
    expect(messages.at(-1)?.content).toContain('Step 1')
    expect(messages.at(-1)?.content).not.toContain('Employee Exit')
    expect(messages.at(-1)?.content).not.toContain('HR Operations')
    expect(await screen.findByText('Grounded response')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Employee Exit' }))
    expect(onOpenProcess).toHaveBeenCalledWith('HR/Employee_Exit.bpmn')
  })

  it('invalidates consent when privacy controls change and supports preview cancellation', async () => {
    selectAnthropic()
    const user = userEvent.setup()
    renderDrawer()

    const preview = await queueLibraryRequest(user)
    const consent = within(preview).getByLabelText('ai.privacy.consent')
    const include = within(preview).getByLabelText('ai.privacy.includeWorkspace')
    await user.click(consent)
    expect((consent as HTMLInputElement).checked).toBe(true)
    await user.click(include)
    expect((consent as HTMLInputElement).checked).toBe(false)

    await user.click(within(preview).getByRole('button', { name: 'ai.cancel' }))
    expect(screen.queryByRole('region', { name: 'ai.privacy.preview.title' })).toBeNull()
    expect(mocks.makeCallFactory).not.toHaveBeenCalled()
  })

  it('shows retry state and aborts an in-flight reviewed request', async () => {
    selectAnthropic()
    const user = userEvent.setup()
    let observedSignal: AbortSignal | null = null
    mocks.makeCallFactory.mockImplementation(
      (
        _config: unknown,
        options: {
          signal: AbortSignal
          onAttempt?: (attempt: {
            attempt: number
            maxAttempts: number
            retryInMs?: number
          }) => void
        }
      ) => {
        observedSignal = options.signal
        options.onAttempt?.({ attempt: 2, maxAttempts: 3, retryInMs: 1_200 })
        return vi.fn(
          async () =>
            await new Promise<string>((_resolve, reject) => {
              options.signal.addEventListener(
                'abort',
                () => reject(new DOMException('Operation was aborted', 'AbortError')),
                { once: true }
              )
            })
        )
      }
    )
    renderDrawer()

    const preview = await queueLibraryRequest(user)
    await user.click(within(preview).getByLabelText('ai.privacy.consent'))
    await user.click(within(preview).getByRole('button', { name: 'assist.send' }))

    expect(await screen.findByText('ai.retry.waiting')).not.toBeNull()
    await user.click(within(preview).getByRole('button', { name: 'ai.cancel' }))
    await waitFor(() => expect(observedSignal?.aborted).toBe(true))
    expect(await screen.findByText('ai.error.cancelled')).not.toBeNull()
  })

  it('handles digest failures, interview-without-modeler, close, and Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderDrawer({
      onClose,
      getDigests: vi.fn().mockRejectedValue(new Error('unreadable workspace'))
    })

    fireEvent.change(screen.getByLabelText('assist.placeholder'), {
      target: { value: 'What happens?' }
    })
    await user.click(screen.getByRole('button', { name: 'assist.send' }))
    expect(await screen.findByText('assist.local.none')).not.toBeNull()

    await user.click(screen.getByRole('tab', { name: 'assist.tab.interview' }))
    expect(await screen.findByText('assist.interview.noModeler')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'assist.close' }))
    expect(onClose).toHaveBeenCalledOnce()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

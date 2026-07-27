// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LiteProviderId } from '../../ai/providersLite'
import { ar } from '../../i18n/dictionaries'
import type { ProcessDigest } from '../digest'

const state = vi.hoisted(() => ({
  selection: null as { providerId: LiteProviderId; modelId: string } | null,
  keyed: new Set<LiteProviderId>(),
  lang: 'en' as 'en' | 'ar'
}))

const mocks = vi.hoisted(() => ({
  makeCallFactory: vi.fn(),
  llmCall: vi.fn(),
  classify: vi.fn()
}))

vi.mock('../../i18n', () => ({
  getLang: (): 'en' | 'ar' => state.lang,
  t: (key: string): string => {
    if (key === 'ai.error.provider') {
      return state.lang === 'ar'
        ? 'أعاد مزوّد الذكاء الاصطناعي خطأً. حاول مرة أخرى أو اختر مزوّدًا آخر.'
        : 'The AI provider returned an error. Try again or choose another provider.'
    }
    if (key === 'ai.error.technicalDetail') {
      return state.lang === 'ar' ? 'تفصيل تقني:' : 'Technical detail:'
    }
    return key
  }
}))

vi.mock('../../i18n/useLang', () => ({
  useLang: (): 'en' | 'ar' => state.lang
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

function AccessibleDrawerHarness(): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button">Outside action</button>
      <AssistantDrawer
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        printing={false}
        mode="directory"
        keysVersion={1}
        getDigests={vi.fn().mockResolvedValue([digest])}
        onOpenProcess={vi.fn()}
      />
    </div>
  )
}

function ProgrammaticDrawerHarness(): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Fill gaps in chat
      </button>
      <AssistantDrawer
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        printing={false}
        mode="directory"
        keysVersion={1}
        getDigests={vi.fn().mockResolvedValue([digest])}
        onOpenProcess={vi.fn()}
      />
    </div>
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
  state.lang = 'en'
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
  it('uses the shared modal focus, inertness, Escape, and trigger-restoration contract', async () => {
    const user = userEvent.setup()
    render(<AccessibleDrawerHarness />)
    const outside = screen.getByRole('button', { name: 'Outside action' })
    const launcher = screen.getByRole('button', { name: 'assist.open' })

    await user.click(launcher)
    const dialog = screen.getByRole('dialog', { name: 'assist.title' })
    const close = within(dialog).getByRole('button', { name: 'assist.close' })
    const textarea = within(dialog).getByRole('textbox', { name: 'assist.placeholder' })
    await waitFor(() => expect(document.activeElement).toBe(close))
    expect(outside.inert).toBe(true)
    expect(launcher.inert).toBe(true)

    textarea.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(textarea)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'assist.title' })).toBeNull())
    expect(outside.inert).toBe(false)
    expect(document.activeElement).toBe(launcher)
  })

  it('restores focus to a non-launcher control that programmatically opened the drawer', async () => {
    const user = userEvent.setup()
    render(<ProgrammaticDrawerHarness />)
    const trigger = screen.getByRole('button', { name: 'Fill gaps in chat' })

    await user.click(trigger)
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', {
          name: 'assist.close'
        })
      )
    )
    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'assist.title' })).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })

  it('binds tabs to panels and supports roving Arrow, Home, and End navigation', async () => {
    renderDrawer()
    const dialog = screen.getByRole('dialog', { name: 'assist.title' })
    const library = within(dialog).getByRole('tab', { name: 'assist.tab.library' })
    const interview = within(dialog).getByRole('tab', { name: 'assist.tab.interview' })
    const libraryPanel = document.getElementById(library.getAttribute('aria-controls') ?? '')
    const interviewPanel = document.getElementById(interview.getAttribute('aria-controls') ?? '')

    expect(library.tabIndex).toBe(0)
    expect(interview.tabIndex).toBe(-1)
    expect(libraryPanel?.getAttribute('role')).toBe('tabpanel')
    expect(libraryPanel?.getAttribute('aria-labelledby')).toBe(library.id)
    expect(interviewPanel?.getAttribute('aria-labelledby')).toBe(interview.id)
    expect(libraryPanel?.hidden).toBe(false)
    expect(interviewPanel?.hidden).toBe(true)
    expect(within(libraryPanel!).getByRole('log')).not.toBeNull()

    library.focus()
    fireEvent.keyDown(library, { key: 'ArrowRight' })
    await waitFor(() => expect(interview.getAttribute('aria-selected')).toBe('true'))
    expect(document.activeElement).toBe(interview)
    expect(library.tabIndex).toBe(-1)
    expect(interview.tabIndex).toBe(0)
    expect(libraryPanel?.hidden).toBe(true)
    expect(interviewPanel?.hidden).toBe(false)
    expect(within(interviewPanel!).getByRole('log')).not.toBeNull()

    fireEvent.keyDown(interview, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(library)
    fireEvent.keyDown(library, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(interview)
    fireEvent.keyDown(interview, { key: 'Home' })
    expect(document.activeElement).toBe(library)
    fireEvent.keyDown(library, { key: 'End' })
    expect(document.activeElement).toBe(interview)
    fireEvent.keyDown(interview, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(library)
  })

  it('uses the active language direction on the modal drawer', () => {
    state.lang = 'ar'
    renderDrawer()
    const dialog = screen.getByRole('dialog', { name: 'assist.title' })
    const library = within(dialog).getByRole('tab', { name: 'assist.tab.library' })
    const interview = within(dialog).getByRole('tab', { name: 'assist.tab.interview' })
    expect(dialog.getAttribute('dir')).toBe('rtl')

    library.focus()
    fireEvent.keyDown(library, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(interview)
    fireEvent.keyDown(interview, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(library)
  })

  it('keeps the open drawer out of the reserved bpmn.io attribution strip', () => {
    renderDrawer()
    const drawer = screen.getByRole('dialog', { name: 'assist.title' })
    expect(drawer.style.insetBlockEnd).toBe('100px')
  })

  it('keeps the closed launcher above the reserved bpmn.io attribution zone', () => {
    renderDrawer({ open: false })
    const launcher = screen.getByRole('button', { name: 'assist.open' })
    expect(launcher.style.insetBlockEnd).toBe('72px')
    expect(launcher.style.insetInlineEnd).toBe('4px')
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
    const response = await screen.findByText('Grounded response')
    expect(response.closest('[role="alert"]')).toBeNull()
    const log = screen.getByRole('log')
    expect(log.getAttribute('aria-live')).toBe('polite')

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
    const onChangeWorkspace = vi.fn()
    let observedSignal: AbortSignal | null = null
    const currentSignal = (): AbortSignal | null => observedSignal
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
    renderDrawer({ onChangeWorkspace })

    const preview = await queueLibraryRequest(user)
    await user.click(within(preview).getByLabelText('ai.privacy.consent'))
    await user.click(within(preview).getByRole('button', { name: 'assist.send' }))

    expect(await screen.findByText('ai.retry.waiting')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'app.changeFolder' }))
    expect(onChangeWorkspace).toHaveBeenCalledOnce()
    expect(currentSignal()?.aborted).toBe(false)
    expect(screen.getByRole('dialog', { name: 'assist.title' })).not.toBeNull()
    await user.click(within(preview).getByRole('button', { name: 'ai.cancel' }))
    await waitFor(() => expect(observedSignal?.aborted).toBe(true))
    expect(screen.queryByRole('region', { name: 'ai.privacy.preview.title' })).toBeNull()
    expect(screen.queryByText('ai.error.cancelled')).toBeNull()
  })

  it('localizes provider failures in Arabic and keeps diagnostics in an English code span', async () => {
    state.lang = 'ar'
    selectAnthropic()
    const user = userEvent.setup()
    const providerDiagnostic = 'anthropic 503: upstream unavailable'
    mocks.llmCall.mockRejectedValueOnce(new Error('raw provider response'))
    mocks.classify.mockReturnValueOnce({
      code: 'provider',
      message: 'The AI provider returned an error.',
      offline: false,
      technicalDetail: providerDiagnostic
    })
    renderDrawer()

    const preview = await queueLibraryRequest(user)
    await user.click(within(preview).getByLabelText('ai.privacy.consent'))
    await user.click(within(preview).getByRole('button', { name: 'assist.send' }))

    expect(await screen.findByText(ar['ai.error.provider'])).not.toBeNull()
    const alert = screen.getByRole('alert')
    expect(alert.getAttribute('aria-live')).toBe('assertive')
    expect(alert.getAttribute('aria-atomic')).toBe('true')
    expect(screen.getByRole('log').getAttribute('aria-live')).toBe('polite')
    expect(within(alert).getByText(ar['ai.error.provider'])).not.toBeNull()
    const detail = document.querySelector<HTMLElement>('[data-ai-technical-detail]')
    expect(detail).not.toBeNull()
    expect(within(detail!).getByText(ar['ai.error.technicalDetail'])).not.toBeNull()
    const code = within(detail!).getByText(providerDiagnostic)
    expect(code.tagName).toBe('CODE')
    expect(code.getAttribute('lang')).toBe('en')
    expect(code.getAttribute('dir')).toBe('ltr')
    expect(screen.queryByText('raw provider response')).toBeNull()
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

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GenerateOutput, ProposedLink } from '../browserAi'
import { LITE_PROVIDERS, type LiteProviderId } from '../providersLite'
import { ar, en } from '../../i18n/dictionaries'

const state = vi.hoisted(() => ({
  lang: 'en' as 'en' | 'ar',
  selection: null as { providerId: LiteProviderId; modelId: string } | null,
  keyed: new Set<LiteProviderId>(),
  providerListeners: new Set<
    (selection: { providerId: LiteProviderId; modelId: string } | null) => void
  >()
}))

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  generateDocument: vi.fn(),
  classify: vi.fn(),
  getKey: vi.fn(),
  setSelection: vi.fn(),
  fetchCredits: vi.fn(),
  resetUsage: vi.fn(),
  extractDocx: vi.fn(),
  fileToBase64: vi.fn(),
  checkAttachmentSize: vi.fn(),
  applyLinkDecisions: vi.fn(),
  triggerDownload: vi.fn(),
  spreadsheetPanel: vi.fn()
}))

vi.mock('../../i18n', () => ({
  t: (key: string, values?: Record<string, unknown>): string => {
    if (key === 'ai.privacy.providerModel') {
      return `${String(values?.provider ?? '')} / ${String(values?.model ?? '')}`
    }
    if (key === 'ai.noKeyForProvider') return String(values?.providerLabel ?? '')
    const failureTranslations: Record<string, string> =
      state.lang === 'ar'
        ? {
            'ai.error.provider':
              'أعاد مزوّد الذكاء الاصطناعي خطأً. حاول مرة أخرى أو اختر مزوّدًا آخر.',
            'ai.error.technicalDetail': 'تفصيل تقني:',
            'ai.attach.docxError.tooLarge':
              'يتجاوز الملف {name} حدود أمان أرشيف المستند. استخدم مستندًا أصغر.'
          }
        : {
            'ai.error.provider':
              'The AI provider returned an error. Try again or choose another provider.',
            'ai.error.technicalDetail': 'Technical detail:',
            'ai.attach.docxError.tooLarge':
              '{name} exceeds the safe document archive limits. Use a smaller document.'
          }
    const template = failureTranslations[key]
    if (template) {
      return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
        String(values?.[name] ?? `{${name}}`)
      )
    }
    return key
  }
}))

vi.mock('../../i18n/useLang', () => ({
  useLang: (): 'en' | 'ar' => state.lang
}))

vi.mock('../keys', () => ({
  hasKey: (providerId: LiteProviderId): boolean => state.keyed.has(providerId),
  getKey: mocks.getKey
}))

vi.mock('../providerSelection', () => ({
  getProviderSelection: () => state.selection,
  setProviderSelection: (providerId: LiteProviderId, modelId: string) => {
    const result = mocks.setSelection(providerId, modelId)
    if (result.ok) {
      state.selection = { providerId, modelId }
      for (const listener of state.providerListeners) listener(state.selection)
    }
    return result
  },
  subscribeProviderSelection: (
    listener: (selection: { providerId: LiteProviderId; modelId: string } | null) => void
  ) => {
    state.providerListeners.add(listener)
    return () => state.providerListeners.delete(listener)
  }
}))

vi.mock('../browserAi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../browserAi')>()
  return {
    ...actual,
    generateDiagramXml: mocks.generateText,
    generateDiagramXmlFromDocument: mocks.generateDocument,
    classifyBrowserError: mocks.classify
  }
})

vi.mock('../credits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../credits')>()
  const totals = {
    requests: 1,
    inputTokens: 10,
    outputTokens: 5,
    reasoningTokens: 2,
    costUsd: 0.001,
    costKind: 'provider' as const,
    since: 1
  }
  return {
    ...actual,
    fetchOpenRouterCredits: mocks.fetchCredits,
    getUsageSnapshot: () => ({ session: totals, allTime: totals }),
    resetUsage: mocks.resetUsage,
    subscribeUsage: () => () => undefined
  }
})

vi.mock('../browserDocxParser', () => {
  return {
    parseDocxFileInWorker: mocks.extractDocx
  }
})

vi.mock('../pdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pdf')>()
  return {
    ...actual,
    checkAttachmentSize: mocks.checkAttachmentSize,
    fileToBase64: mocks.fileToBase64
  }
})

vi.mock('../linkReview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../linkReview')>()
  return {
    ...actual,
    applyLinkDecisions: mocks.applyLinkDecisions
  }
})

vi.mock('../../spreadsheet/SpreadsheetImportPanel', () => ({
  SpreadsheetImportPanel: (props: unknown) => {
    mocks.spreadsheetPanel(props)
    return (
      <div data-testid="spreadsheet-panel">
        spreadsheet-panel
        <input aria-label="spreadsheet-draft-probe" defaultValue="" />
      </div>
    )
  }
}))

vi.mock('../../common/exportImage', () => ({
  triggerDownload: mocks.triggerDownload
}))

import { AiPanelLite, type AiPanelLiteProps } from '../AiPanelLite'
import { DocxParseError } from '../docx'
import { clearGeneratedRecovery, type GeneratedPlacementOutcome } from '../placementOutcome'

const success: GenerateOutput = {
  xml: '<definitions />',
  links: []
}

function renderPanel(overrides: Partial<AiPanelLiteProps> = {}): ReturnType<typeof render> {
  return render(
    <AiPanelLite
      folders={[
        { relPath: 'hr', label: 'HR' },
        { relPath: 'finance', label: 'Finance' }
      ]}
      onPlaceGenerated={vi.fn().mockResolvedValue({ status: 'persisted', label: 'generated.bpmn' })}
      getWorkspaceGen={() => 7}
      onOpenSettings={vi.fn()}
      collapsed={false}
      onToggle={vi.fn()}
      keysVersion={1}
      mode="directory"
      processCatalog={[
        { id: 'leave', name: 'Leave approval' },
        { id: 'finance', name: 'Invoice approval' }
      ]}
      isKnownProcess={(id) => id === 'leave'}
      resolveProcessName={(id) => (id === 'leave' ? 'Leave approval' : id)}
      {...overrides}
    />
  )
}

function selectAnthropic(): void {
  state.selection = {
    providerId: 'anthropic',
    modelId: LITE_PROVIDERS.find(({ id }) => id === 'anthropic')!.models[0]!.id
  }
  state.keyed.add('anthropic')
}

function selectGemini(): void {
  state.selection = {
    providerId: 'gemini',
    modelId: LITE_PROVIDERS.find(({ id }) => id === 'gemini')!.models[0]!.id
  }
  state.keyed.add('gemini')
}

function attachArrayBuffer(file: File, bytes = new Uint8Array([1, 2, 3])): File {
  Object.defineProperty(file, 'arrayBuffer', {
    configurable: true,
    value: async () => bytes.buffer
  })
  return file
}

beforeEach(() => {
  state.lang = 'en'
  state.selection = null
  state.keyed.clear()
  state.providerListeners.clear()
  mocks.generateText.mockReset().mockResolvedValue(success)
  mocks.generateDocument.mockReset().mockResolvedValue(success)
  mocks.classify.mockReset().mockImplementation((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    const cancelled = /abort|cancel/i.test(message)
    return {
      code: cancelled ? 'cancelled' : 'unknown',
      message,
      offline: /offline|network/i.test(message)
    }
  })
  mocks.getKey
    .mockReset()
    .mockImplementation((providerId: LiteProviderId) =>
      state.keyed.has(providerId) ? `${providerId}-key` : null
    )
  mocks.setSelection.mockReset().mockReturnValue({ ok: true })
  mocks.fetchCredits.mockReset().mockResolvedValue({
    totalCredits: 20,
    totalUsage: 5,
    remaining: 15
  })
  mocks.resetUsage.mockReset()
  mocks.extractDocx.mockReset().mockResolvedValue('Extracted document text')
  mocks.fileToBase64.mockReset().mockResolvedValue('AQID')
  mocks.checkAttachmentSize.mockReset().mockReturnValue({ ok: true })
  mocks.applyLinkDecisions.mockReset().mockImplementation((xml: string) => `${xml}:reviewed`)
  mocks.triggerDownload.mockReset()
  mocks.spreadsheetPanel.mockReset()
  clearGeneratedRecovery()
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: true
  })
})

afterEach(() => {
  cleanup()
})

describe('AiPanelLite consented browser workflows', () => {
  it('renders collapsed and embedded shells without issuing a request', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    const onOpenSettings = vi.fn()
    const { rerender } = renderPanel({ collapsed: true, onToggle, onOpenSettings })

    await user.click(screen.getByRole('button', { name: 'ai.collapsedButton' }))
    expect(onToggle).toHaveBeenCalledOnce()
    expect(mocks.generateText).not.toHaveBeenCalled()

    rerender(
      <AiPanelLite
        folders={[]}
        onPlaceGenerated={vi.fn()}
        onOpenSettings={onOpenSettings}
        collapsed={false}
        onToggle={onToggle}
        keysVersion={2}
        mode="fallback"
        processCatalog={[]}
        isKnownProcess={() => false}
        resolveProcessName={(id) => id}
        embedded
        spreadsheet={{
          workspaceId: 'workspace',
          workspaceAdapter: null,
          onOpenSingle: vi.fn()
        }}
      />
    )
    await user.click(screen.getByRole('button', { name: 'ai.noKeysAtAll.link' }))
    expect(onOpenSettings).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('tab', { name: 'spreadsheet.tab' }))
    expect(screen.getByTestId('spreadsheet-panel')).not.toBeNull()
    expect(mocks.spreadsheetPanel).toHaveBeenCalled()
  })

  it('preserves generation and spreadsheet drafts while their tabs are hidden', async () => {
    const user = userEvent.setup()
    renderPanel({
      embedded: true,
      spreadsheet: {
        workspaceId: 'workspace',
        workspaceAdapter: null,
        onOpenSingle: vi.fn()
      }
    })

    fireEvent.change(screen.getByLabelText('ai.description.label'), {
      target: { value: 'Keep this prompt while browsing' }
    })
    fireEvent.change(screen.getByLabelText('ai.name.label'), {
      target: { value: 'Retained process name' }
    })
    fireEvent.change(screen.getByLabelText('ai.targetFolder.label'), {
      target: { value: 'finance' }
    })

    await user.click(screen.getByRole('tab', { name: 'spreadsheet.tab' }))
    fireEvent.change(screen.getByLabelText('spreadsheet-draft-probe'), {
      target: { value: 'retained mapping draft' }
    })
    await user.click(screen.getByRole('tab', { name: 'ai.tab.description' }))

    expect(screen.getByLabelText<HTMLInputElement>('ai.description.label').value).toBe(
      'Keep this prompt while browsing'
    )
    expect(screen.getByLabelText<HTMLInputElement>('ai.name.label').value).toBe(
      'Retained process name'
    )
    expect(screen.getByLabelText<HTMLSelectElement>('ai.targetFolder.label').value).toBe('finance')

    await user.click(screen.getByRole('tab', { name: 'spreadsheet.tab' }))
    expect(screen.getByLabelText<HTMLInputElement>('spreadsheet-draft-probe').value).toBe(
      'retained mapping draft'
    )
  })

  it('implements an automatically activated roving tab stop with Home/End and RTL arrows', async () => {
    selectAnthropic()
    const user = userEvent.setup()
    renderPanel({
      embedded: true,
      spreadsheet: {
        workspaceId: 'workspace',
        workspaceAdapter: null,
        onOpenSingle: vi.fn()
      }
    })

    const descriptionTab = screen.getByRole('tab', { name: 'ai.tab.description' })
    const documentTab = screen.getByRole('tab', { name: 'ai.tab.pdf' })
    const spreadsheetTab = screen.getByRole('tab', { name: 'spreadsheet.tab' })
    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('horizontal')
    expect(descriptionTab.tabIndex).toBe(0)
    expect(documentTab.tabIndex).toBe(-1)
    expect(spreadsheetTab.tabIndex).toBe(-1)

    descriptionTab.focus()
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(documentTab)
    expect(documentTab.getAttribute('aria-selected')).toBe('true')
    expect(documentTab.tabIndex).toBe(0)
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(
      'orbitpm-ai-document-tab'
    )

    await user.keyboard('{End}')
    expect(document.activeElement).toBe(spreadsheetTab)
    expect(spreadsheetTab.getAttribute('aria-selected')).toBe('true')
    expect(
      (screen.getByTestId('spreadsheet-panel').closest('[role="tabpanel"]') as HTMLElement | null)
        ?.hidden
    ).toBe(false)

    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(descriptionTab)
    expect(descriptionTab.getAttribute('aria-selected')).toBe('true')

    state.lang = 'ar'
    const rtlPanel = renderPanel({
      embedded: true,
      spreadsheet: {
        workspaceId: 'rtl-workspace',
        workspaceAdapter: null,
        onOpenSingle: vi.fn()
      }
    })
    const rtlDescriptionTabs = screen.getAllByRole('tab', { name: 'ai.tab.description' })
    const rtlDescription = rtlDescriptionTabs[rtlDescriptionTabs.length - 1]!
    rtlDescription.focus()
    await user.keyboard('{ArrowRight}')
    const rtlSpreadsheetTabs = screen.getAllByRole('tab', { name: 'spreadsheet.tab' })
    expect(document.activeElement).toBe(rtlSpreadsheetTabs[rtlSpreadsheetTabs.length - 1])
    rtlPanel.unmount()
  })

  it('formats attachment megabytes with Arabic digits while keeping the unit English LTR', async () => {
    state.lang = 'ar'
    selectAnthropic()
    const user = userEvent.setup()
    renderPanel()
    const pdf = new File(['pdf'], 'policy.pdf', { type: 'application/pdf' })
    Object.defineProperty(pdf, 'size', {
      configurable: true,
      value: 1.5 * 1024 * 1024
    })

    await user.upload(screen.getByLabelText(/ai\.attach\.label/), pdf)

    const formatted = new Intl.NumberFormat('ar', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format(1.5)
    const size = screen.getByText(formatted)
    const unit = screen.getByText('MB')
    expect(size.getAttribute('lang')).toBe('ar')
    expect(unit.getAttribute('lang')).toBe('en')
    expect(unit.getAttribute('dir')).toBe('ltr')
  })

  it('marks selected provider/model controls, options, privacy, and no-key values English LTR', () => {
    state.lang = 'ar'
    const anthropic = LITE_PROVIDERS.find(({ id }) => id === 'anthropic')!
    state.selection = {
      providerId: anthropic.id,
      modelId: anthropic.models[0]!.id
    }
    renderPanel()

    const providerControl = screen.getByLabelText<HTMLSelectElement>('ai.provider.label')
    const modelControl = screen.getByLabelText<HTMLSelectElement>('ai.model.label')
    expect(providerControl.getAttribute('lang')).toBe('en')
    expect(providerControl.getAttribute('dir')).toBe('ltr')
    expect(modelControl.getAttribute('lang')).toBe('en')
    expect(modelControl.getAttribute('dir')).toBe('ltr')
    for (const option of [...providerControl.options].filter(({ value }) => value !== '')) {
      expect(option.getAttribute('lang')).toBe('en')
      expect(option.getAttribute('dir')).toBe('ltr')
    }
    for (const option of [...modelControl.options]) {
      expect(option.getAttribute('lang')).toBe('en')
      expect(option.getAttribute('dir')).toBe('ltr')
    }

    const providerSpans = screen
      .getAllByText(anthropic.label)
      .filter((node) => node.tagName === 'SPAN')
    const modelSpans = screen
      .getAllByText(anthropic.models[0]!.id)
      .filter((node) => node.tagName === 'SPAN')
    expect(providerSpans.length).toBeGreaterThanOrEqual(2)
    expect(modelSpans).toHaveLength(1)
    for (const node of [...providerSpans, ...modelSpans]) {
      expect(node.getAttribute('lang')).toBe('en')
      expect(node.getAttribute('dir')).toBe('ltr')
    }
  })

  it('uses the theme primary contrast pair for the selected spreadsheet tab', async () => {
    const user = userEvent.setup()
    renderPanel({
      embedded: true,
      spreadsheet: {
        workspaceId: 'workspace',
        workspaceAdapter: null,
        onOpenSingle: vi.fn()
      }
    })

    const spreadsheetTab = screen.getByRole('tab', { name: 'spreadsheet.tab' })
    await user.click(spreadsheetTab)

    expect(spreadsheetTab.getAttribute('aria-selected')).toBe('true')
    expect(spreadsheetTab.style.background).toBe('var(--orbitpm-primary-bg)')
    expect(spreadsheetTab.style.color).toBe('var(--orbitpm-primary-fg)')
  })

  it('keeps the network silent until consent, then places a redacted text result', async () => {
    selectAnthropic()
    const user = userEvent.setup()
    const onPlaceGenerated = vi.fn().mockResolvedValue({ status: 'persisted', label: 'leave.bpmn' })
    const onContinueInChat = vi.fn()
    renderPanel({ onPlaceGenerated, onContinueInChat })

    const description = screen.getByLabelText('ai.description.label')
    fireEvent.change(description, {
      target: { value: 'Approve the employee leave request with payroll metadata' }
    })
    const generate = screen.getByRole('button', { name: 'ai.generate' })
    expect((generate as HTMLButtonElement).disabled).toBe(true)
    expect(mocks.generateText).not.toHaveBeenCalled()

    await user.click(screen.getByLabelText('ai.privacy.includeWorkspace'))
    expect(screen.getByText('Process 1')).not.toBeNull()
    await user.click(screen.getByLabelText('ai.privacy.consent'))
    expect((generate as HTMLButtonElement).disabled).toBe(false)
    await user.click(generate)

    await waitFor(() => expect(mocks.generateText).toHaveBeenCalledOnce())
    expect(mocks.generateText.mock.calls[0]?.[0]).toMatchObject({
      providerId: 'anthropic',
      apiKey: 'anthropic-key'
    })
    expect(mocks.generateText.mock.calls[0]?.[0].processCatalog).toEqual([
      { id: 'leave', name: 'Process 1' }
    ])
    expect(onPlaceGenerated).toHaveBeenCalledWith('<definitions />', {
      name: '',
      targetFolder: 'hr',
      gen: 7,
      localizationSource: 'ai',
      signal: expect.any(AbortSignal)
    })
    expect(await screen.findByText('ai.created')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'ai.continueInChat' }))
    expect(onContinueInChat).toHaveBeenCalledWith({
      description: 'Approve the employee leave request with payroll metadata'
    })
    expect((screen.getByLabelText('ai.privacy.consent') as HTMLInputElement).checked).toBe(false)
  })

  it('retains a stale workspace result across the panel remount and downloads exact XML', async () => {
    selectAnthropic()
    const user = userEvent.setup()
    const xml = '<definitions name="طلب &amp; review" />'
    mocks.generateText.mockResolvedValue({
      xml,
      links: [
        {
          elementId: 'Call_leave',
          label: 'Leave call',
          calledProcess: 'leave',
          confidence: 'high'
        }
      ]
    })
    let resolvePlacement: ((outcome: GeneratedPlacementOutcome) => void) | undefined
    const onPlaceGenerated = vi.fn(
      async () =>
        await new Promise<GeneratedPlacementOutcome>((resolve) => {
          resolvePlacement = resolve
        })
    )
    const firstPanel = renderPanel({ onPlaceGenerated, onContinueInChat: vi.fn() })
    fireEvent.change(screen.getByLabelText('ai.description.label'), {
      target: { value: 'A process generated during a workspace switch' }
    })
    fireEvent.change(screen.getByLabelText('ai.name.label'), {
      target: { value: 'Switch Victim' }
    })
    await user.click(screen.getByLabelText('ai.privacy.consent'))
    await user.click(screen.getByRole('button', { name: 'ai.generate' }))
    await waitFor(() => expect(onPlaceGenerated).toHaveBeenCalledOnce())

    firstPanel.unmount()
    renderPanel()
    await act(async () => {
      resolvePlacement?.({
        status: 'discarded',
        reason: 'stale-workspace'
      })
    })

    expect(await screen.findByText('ai.placement.discarded.staleWorkspace')).not.toBeNull()
    expect(screen.queryByText('ai.created')).toBeNull()
    expect(screen.queryByText('ai.linked.summary')).toBeNull()
    expect(screen.queryByRole('button', { name: 'ai.continueInChat' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'ai.placement.downloadRecovery' }))
    expect(mocks.triggerDownload).toHaveBeenCalledWith(
      'switch-victim-recovery.bpmn',
      `data:application/xml;charset=utf-8,${encodeURIComponent(xml)}`
    )
  })

  it('shows retry state and cancels an in-flight request', async () => {
    selectAnthropic()
    const user = userEvent.setup()
    mocks.generateText.mockImplementation(
      async (args: {
        signal: AbortSignal
        onAttempt?: (status: { attempt: number; maxAttempts: number; retryInMs?: number }) => void
      }) => {
        args.onAttempt?.({ attempt: 2, maxAttempts: 3, retryInMs: 1_500 })
        return await new Promise<GenerateOutput>((_resolve, reject) => {
          args.signal.addEventListener(
            'abort',
            () => reject(new DOMException('Operation was aborted', 'AbortError')),
            { once: true }
          )
        })
      }
    )
    renderPanel()
    fireEvent.change(screen.getByLabelText('ai.description.label'), {
      target: { value: 'A cancellable process' }
    })
    await user.click(screen.getByLabelText('ai.privacy.consent'))
    await user.click(screen.getByRole('button', { name: 'ai.generate' }))

    expect(await screen.findByText('ai.retry.waiting')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'ai.cancel' }))
    expect(await screen.findByText('ai.error.cancelled')).not.toBeNull()
  })

  it('renders an Arabic provider summary while isolating bounded English diagnostics', async () => {
    state.lang = 'ar'
    selectAnthropic()
    const user = userEvent.setup()
    const providerDiagnostic = 'anthropic 503: upstream unavailable'
    mocks.generateText.mockRejectedValueOnce(new Error('raw provider response'))
    mocks.classify.mockReturnValueOnce({
      code: 'provider',
      message: 'The AI provider returned an error.',
      offline: false,
      technicalDetail: providerDiagnostic
    })
    renderPanel()

    fireEvent.change(screen.getByLabelText('ai.description.label'), {
      target: { value: 'عملية موافقات قابلة للاختبار' }
    })
    await user.click(screen.getByLabelText('ai.privacy.consent'))
    await user.click(screen.getByRole('button', { name: 'ai.generate' }))

    expect(await screen.findByText(ar['ai.error.provider'])).not.toBeNull()
    const detail = document.querySelector<HTMLElement>('[data-ai-technical-detail]')
    expect(detail).not.toBeNull()
    expect(within(detail!).getByText(ar['ai.error.technicalDetail'])).not.toBeNull()
    const code = within(detail!).getByText(providerDiagnostic)
    expect(code.tagName).toBe('CODE')
    expect(code.getAttribute('lang')).toBe('en')
    expect(code.getAttribute('dir')).toBe('ltr')
    expect(screen.queryByText('raw provider response')).toBeNull()
  })

  it('recovers exact output without opening link review when generation resolves after cancellation', async () => {
    selectAnthropic()
    const user = userEvent.setup()
    const xml = '<definitions id="cancelled-output" />'
    const lateLinks: ProposedLink[] = [
      {
        elementId: 'Call_leave',
        label: 'Late uncertain call',
        calledProcess: 'leave',
        confidence: 'low'
      }
    ]
    mocks.generateText.mockImplementation(
      async (args: { signal: AbortSignal }) =>
        await new Promise<GenerateOutput>((resolve) => {
          args.signal.addEventListener('abort', () => resolve({ xml, links: lateLinks }), {
            once: true
          })
        })
    )
    const onPlaceGenerated = vi.fn()
    renderPanel({ onPlaceGenerated })
    fireEvent.change(screen.getByLabelText('ai.description.label'), {
      target: { value: 'A provider that resolves after cancellation' }
    })
    await user.click(screen.getByLabelText('ai.privacy.consent'))
    await user.click(screen.getByRole('button', { name: 'ai.generate' }))
    await user.click(await screen.findByRole('button', { name: 'ai.cancel' }))

    expect(await screen.findByText('ai.placement.discarded.cancelled')).not.toBeNull()
    expect(onPlaceGenerated).not.toHaveBeenCalled()
    expect(screen.queryByText('ai.linkVerify.title')).toBeNull()
    expect(mocks.applyLinkDecisions).not.toHaveBeenCalled()
    expect(screen.queryByText('ai.created')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'ai.placement.downloadRecovery' }))
    expect(mocks.triggerDownload).toHaveBeenCalledWith(
      'process-recovery.bpmn',
      `data:application/xml;charset=utf-8,${encodeURIComponent(xml)}`
    )
  })

  it('portals a late link review outside a hidden preserved panel without losing its draft', async () => {
    selectAnthropic()
    const user = userEvent.setup()
    let resolveGeneration!: (output: GenerateOutput) => void
    mocks.generateText.mockReturnValue(
      new Promise<GenerateOutput>((resolve) => {
        resolveGeneration = resolve
      })
    )
    const view = renderPanel({ embedded: true })
    const draft = screen.getByLabelText<HTMLTextAreaElement>('ai.description.label')
    fireEvent.change(draft, {
      target: { value: 'Keep this draft after the explorer is hidden' }
    })
    await user.click(screen.getByLabelText('ai.privacy.consent'))
    await user.click(screen.getByRole('button', { name: 'ai.generate' }))
    await waitFor(() => expect(mocks.generateText).toHaveBeenCalledOnce())
    const preservedAncestor = view.container.firstElementChild as HTMLElement
    preservedAncestor.hidden = true

    await act(async () => {
      resolveGeneration({
        xml: '<definitions id="late-review" />',
        links: [
          {
            elementId: 'Call_leave',
            label: 'Late uncertain call',
            calledProcess: 'leave',
            confidence: 'low'
          }
        ]
      })
    })

    const dialog = await screen.findByRole('dialog', { name: 'ai.linkVerify.title' })
    expect(dialog.closest('[hidden]')).toBeNull()
    expect(draft.isConnected).toBe(true)
    expect(draft.value).toBe('Keep this draft after the explorer is hidden')
  })

  it('validates document types and generates from an accepted image', async () => {
    selectAnthropic()
    const user = userEvent.setup()
    const onPlaceGenerated = vi
      .fn()
      .mockResolvedValue({ status: 'opened-in-memory', label: 'process.bpmn' })
    renderPanel({ onPlaceGenerated })

    await user.click(screen.getByRole('tab', { name: 'ai.tab.pdf' }))
    const input = screen.getByLabelText('ai.pdfDocument.label')
    fireEvent.change(input, {
      target: {
        files: [new File(['bad'], 'notes.txt', { type: 'text/plain' })]
      }
    })
    expect(await screen.findByText('ai.image.unsupportedType')).not.toBeNull()

    fireEvent.change(input, {
      target: {
        files: [new File(['png'], 'flow.png', { type: 'image/png' })]
      }
    })
    fireEvent.change(screen.getByLabelText(/ai\.pdfHint\.label/), {
      target: { value: 'Model this photographed process' }
    })
    expect((screen.getByLabelText('ai.privacy.description') as HTMLTextAreaElement).value).toBe(
      'Model this photographed process'
    )
    await user.click(screen.getByLabelText('ai.privacy.consent'))
    await user.click(screen.getByRole('button', { name: 'ai.generateFromPdf' }))

    await waitFor(() => expect(mocks.generateDocument).toHaveBeenCalledOnce())
    expect(mocks.fileToBase64).toHaveBeenCalledOnce()
    expect(mocks.generateDocument.mock.calls[0]?.[0]).toMatchObject({
      providerId: 'anthropic',
      attachment: {
        kind: 'image',
        fileName: 'flow.png',
        mediaType: 'image/png'
      },
      hint: 'Model this photographed process'
    })
    expect(onPlaceGenerated).toHaveBeenCalledWith(
      '<definitions />',
      expect.objectContaining({ localizationSource: 'image' })
    )
    expect(await screen.findByText('ai.created')).not.toBeNull()
  })

  it('blocks undocumented Gemini GIF input before encoding or network', async () => {
    selectGemini()
    const user = userEvent.setup()
    const onPlaceGenerated = vi.fn()
    renderPanel({ onPlaceGenerated })

    await user.click(screen.getByRole('tab', { name: 'ai.tab.pdf' }))
    fireEvent.change(screen.getByLabelText('ai.pdfDocument.label'), {
      target: {
        files: [new File(['gif'], 'animated-flow.gif', { type: 'image/gif' })]
      }
    })
    fireEvent.change(screen.getByLabelText(/ai\.pdfHint\.label/), {
      target: { value: 'Model the animated process' }
    })
    await user.click(screen.getByLabelText('ai.privacy.consent'))

    expect(await screen.findByText('ai.attach.unsupportedProvider')).not.toBeNull()
    expect(en['ai.attach.unsupportedProvider']).toContain('selected provider and model')
    expect(ar['ai.attach.unsupportedProvider']).toContain('المزوّد والنموذج المحددين')
    expect(en['ai.tab.pdf.title.unsupported']).toContain('selected provider and model')
    expect(ar['ai.tab.pdf.title.unsupported']).toContain('المزوّد والنموذج المحددين')
    expect(
      (screen.getByRole('button', { name: 'ai.generateFromPdf' }) as HTMLButtonElement).disabled
    ).toBe(true)
    expect(mocks.fileToBase64).not.toHaveBeenCalled()
    expect(mocks.generateDocument).not.toHaveBeenCalled()
    expect(onPlaceGenerated).not.toHaveBeenCalled()
  })

  it('extracts DOCX text, removes it, and sends an attached PDF natively', async () => {
    selectAnthropic()
    const user = userEvent.setup()
    renderPanel()

    const attachmentInput = screen.getByLabelText(/ai\.attach\.label/)
    const docx = attachArrayBuffer(
      new File(['docx'], 'process.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      })
    )
    await user.upload(attachmentInput, docx)
    expect(await screen.findByText('ai.attach.extracted')).not.toBeNull()
    expect(mocks.extractDocx).toHaveBeenCalledWith(
      docx,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    fireEvent.change(screen.getByLabelText('ai.description.label'), {
      target: { value: 'Use this extracted brief' }
    })
    const exactDocxDescription =
      'Use this extracted brief\n\n--- Attached document: process.docx ---\nExtracted document text'
    expect((screen.getByLabelText('ai.privacy.description') as HTMLTextAreaElement).value).toBe(
      exactDocxDescription
    )
    await user.click(screen.getByLabelText('ai.privacy.consent'))
    await user.click(screen.getByRole('button', { name: 'ai.generate' }))
    await waitFor(() => expect(mocks.generateText).toHaveBeenCalledOnce())
    expect(mocks.generateText.mock.calls[0]?.[0].description).toBe(exactDocxDescription)

    await user.click(screen.getByRole('button', { name: 'ai.attach.remove' }))

    await user.upload(
      attachmentInput,
      new File(['pdf'], 'process.pdf', { type: 'application/pdf' })
    )
    fireEvent.change(screen.getByLabelText('ai.description.label'), {
      target: { value: 'Use this policy' }
    })
    expect((screen.getByLabelText('ai.privacy.description') as HTMLTextAreaElement).value).toBe(
      'Use this policy'
    )
    await user.click(screen.getByLabelText('ai.privacy.consent'))
    await user.click(screen.getByRole('button', { name: 'ai.generate' }))

    await waitFor(() => expect(mocks.generateDocument).toHaveBeenCalledOnce())
    expect(mocks.generateDocument.mock.calls[0]?.[0]).toMatchObject({
      attachment: {
        kind: 'pdf',
        fileName: 'process.pdf'
      },
      hint: 'Use this policy'
    })
  })

  it('renders a typed DOCX failure in Arabic and isolates its stable technical code', async () => {
    state.lang = 'ar'
    const user = userEvent.setup()
    renderPanel()

    mocks.extractDocx.mockRejectedValueOnce(
      new DocxParseError('archive-too-large', 'Unsafe archive implementation diagnostic')
    )
    const rejected = new File([], 'rejected.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    })

    await user.upload(screen.getByLabelText(/ai\.attach\.label/), rejected)

    expect(
      await screen.findByText(ar['ai.attach.docxError.tooLarge'].replace('{name}', 'rejected.docx'))
    ).not.toBeNull()
    const detail = document.querySelector<HTMLElement>('[data-ai-technical-detail]')
    expect(detail).not.toBeNull()
    expect(within(detail!).getByText(ar['ai.error.technicalDetail'])).not.toBeNull()
    const code = within(detail!).getByText('archive-too-large')
    expect(code.tagName).toBe('CODE')
    expect(code.getAttribute('lang')).toBe('en')
    expect(code.getAttribute('dir')).toBe('ltr')
    expect(screen.queryByText('Unsafe archive implementation diagnostic')).toBeNull()
    expect(mocks.extractDocx).toHaveBeenCalledOnce()
  })

  it('places only on review confirmation while cancel and close remain non-mutating', async () => {
    selectAnthropic()
    const user = userEvent.setup()
    const links: ProposedLink[] = [
      {
        elementId: 'Call_known',
        label: 'Known call',
        calledProcess: 'leave',
        confidence: 'low'
      },
      {
        elementId: 'Call_missing',
        label: 'Missing call',
        calledProcess: 'missing',
        confidence: 'high'
      }
    ]
    mocks.generateText.mockResolvedValue({ xml: '<definitions />', links })
    const onPlaceGenerated = vi
      .fn()
      .mockResolvedValue({ status: 'persisted', label: 'reviewed.bpmn' })
    renderPanel({ onPlaceGenerated })

    const generateOnce = async (): Promise<void> => {
      fireEvent.change(screen.getByLabelText('ai.description.label'), {
        target: { value: 'Process with calls' }
      })
      await user.click(screen.getByLabelText('ai.privacy.consent'))
      await user.click(screen.getByRole('button', { name: 'ai.generate' }))
      expect(await screen.findByText('ai.linkVerify.title')).not.toBeNull()
    }

    await generateOnce()
    await user.click(screen.getByRole('button', { name: 'ai.linkVerify.confirm' }))
    await waitFor(() => expect(onPlaceGenerated).toHaveBeenCalledTimes(1))
    expect(mocks.applyLinkDecisions).toHaveBeenCalledWith(
      '<definitions />',
      links,
      new Set(['Call_known'])
    )
    expect(await screen.findByText('ai.linked.summary')).not.toBeNull()

    await generateOnce()
    await user.click(screen.getByRole('button', { name: 'ai.linkVerify.cancel' }))
    expect(onPlaceGenerated).toHaveBeenCalledTimes(1)
    expect(mocks.applyLinkDecisions).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('ai.placement.discarded.cancelled')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'ai.placement.downloadRecovery' }))
    expect(mocks.triggerDownload).toHaveBeenCalledWith(
      'process-recovery.bpmn',
      `data:application/xml;charset=utf-8,${encodeURIComponent('<definitions />')}`
    )

    await generateOnce()
    await user.click(screen.getByRole('button', { name: 'modal.close.aria' }))
    expect(onPlaceGenerated).toHaveBeenCalledTimes(1)
    expect(mocks.applyLinkDecisions).toHaveBeenCalledTimes(1)
  })

  it('keeps post-review placement cancellable and recovers the reviewed XML', async () => {
    selectAnthropic()
    const user = userEvent.setup()
    const links: ProposedLink[] = [
      {
        elementId: 'Call_known',
        label: 'Known call',
        calledProcess: 'leave',
        confidence: 'low'
      }
    ]
    mocks.generateText.mockResolvedValue({ xml: '<definitions />', links })
    const onPlaceGenerated = vi.fn(
      async (_xml: string, options: { signal: AbortSignal }): Promise<GeneratedPlacementOutcome> =>
        await new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => reject(new DOMException('cancelled', 'AbortError')),
            { once: true }
          )
        })
    )
    renderPanel({ onPlaceGenerated })
    fireEvent.change(screen.getByLabelText('ai.description.label'), {
      target: { value: 'Review then cancel placement' }
    })
    await user.click(screen.getByLabelText('ai.privacy.consent'))
    await user.click(screen.getByRole('button', { name: 'ai.generate' }))
    await user.click(await screen.findByRole('button', { name: 'ai.linkVerify.confirm' }))
    await waitFor(() => expect(onPlaceGenerated).toHaveBeenCalledOnce())
    const placementSignal = onPlaceGenerated.mock.calls[0]?.[1]?.signal as AbortSignal
    expect(placementSignal.aborted).toBe(false)

    await user.click(screen.getByRole('button', { name: 'ai.cancel' }))

    expect(placementSignal.aborted).toBe(true)
    expect(await screen.findByText('ai.placement.discarded.cancelled')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'ai.placement.downloadRecovery' }))
    expect(mocks.triggerDownload).toHaveBeenCalledWith(
      'process-recovery.bpmn',
      `data:application/xml;charset=utf-8,${encodeURIComponent('<definitions />:reviewed')}`
    )
  })

  it('handles provider selection failure, offline changes, and balance refresh errors', async () => {
    const user = userEvent.setup()
    state.keyed.add('openrouter')
    mocks.setSelection.mockReturnValueOnce({
      ok: false,
      code: 'storage-failed',
      error: 'selection failed'
    })
    renderPanel()

    await user.selectOptions(screen.getByLabelText('ai.provider.label'), 'openrouter')
    expect(await screen.findByText('selection failed')).not.toBeNull()
    expect(screen.getByText('settings.storageError.providerSelection')).not.toBeNull()
    const technicalCode = screen.getByText('selection failed')
    expect(technicalCode.tagName).toBe('CODE')
    expect(technicalCode.getAttribute('lang')).toBe('en')
    expect(technicalCode.getAttribute('dir')).toBe('ltr')
    expect(screen.getByText('ai.usage.sessionDetailed')).not.toBeNull()
    expect(screen.getByText('ai.usage.allTimeDetailed')).not.toBeNull()

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false
    })
    window.dispatchEvent(new Event('offline'))
    expect(await screen.findByText('ai.offlineWarning')).not.toBeNull()
    window.dispatchEvent(new Event('online'))
    await waitFor(() => expect(screen.queryByText('ai.offlineWarning')).toBeNull())

    mocks.fetchCredits.mockRejectedValueOnce(new Error('credits failed'))
    await user.click(screen.getByRole('button', { name: 'ai.credits.refresh' }))
    expect(await screen.findByText('ai.credits.error.unexpected')).not.toBeNull()
  })
})

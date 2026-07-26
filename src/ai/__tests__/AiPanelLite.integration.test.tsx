// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GenerateOutput, ProposedLink } from '../browserAi'
import { LITE_PROVIDERS, type LiteProviderId } from '../providersLite'

const state = vi.hoisted(() => ({
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
  spreadsheetPanel: vi.fn()
}))

vi.mock('../../i18n', () => ({
  t: (key: string): string => key
}))

vi.mock('../../i18n/useLang', () => ({
  useLang: (): 'en' => 'en'
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

vi.mock('../docx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../docx')>()
  return {
    ...actual,
    extractDocxTextAsync: mocks.extractDocx
  }
})

vi.mock('../pdf', () => ({
  ACCEPTED_IMAGE_TYPES: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  checkAttachmentSize: mocks.checkAttachmentSize,
  fileToBase64: mocks.fileToBase64,
  imageMediaTypeFromName: (name: string): string | null =>
    name.toLowerCase().endsWith('.png') ? 'image/png' : null
}))

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
    return <div data-testid="spreadsheet-panel">spreadsheet-panel</div>
  }
}))

import { AiPanelLite, type AiPanelLiteProps } from '../AiPanelLite'
import { DOCX_ARCHIVE_LIMITS } from '../docx'

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
      onPlaceGenerated={vi.fn().mockResolvedValue({ label: 'generated.bpmn' })}
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

function attachArrayBuffer(file: File, bytes = new Uint8Array([1, 2, 3])): File {
  Object.defineProperty(file, 'arrayBuffer', {
    configurable: true,
    value: async () => bytes.buffer
  })
  return file
}

beforeEach(() => {
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
  mocks.spreadsheetPanel.mockReset()
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
    expect(mocks.spreadsheetPanel).toHaveBeenCalledOnce()
  })

  it('keeps the network silent until consent, then places a redacted text result', async () => {
    selectAnthropic()
    const user = userEvent.setup()
    const onPlaceGenerated = vi.fn().mockResolvedValue({ label: 'leave.bpmn' })
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
      localizationSource: 'ai'
    })
    expect(await screen.findByText('ai.created')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'ai.continueInChat' }))
    expect(onContinueInChat).toHaveBeenCalledWith({
      description: 'Approve the employee leave request with payroll metadata'
    })
    expect((screen.getByLabelText('ai.privacy.consent') as HTMLInputElement).checked).toBe(false)
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

  it('validates document types and generates from an accepted image', async () => {
    selectAnthropic()
    const user = userEvent.setup()
    const onPlaceGenerated = vi.fn().mockResolvedValue(null)
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
    expect(mocks.extractDocx).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'ai.attach.remove' }))

    await user.upload(
      attachmentInput,
      new File(['pdf'], 'process.pdf', { type: 'application/pdf' })
    )
    fireEvent.change(screen.getByLabelText('ai.description.label'), {
      target: { value: 'Use this policy' }
    })
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

  it('rejects an oversized DOCX before allocating its bytes', async () => {
    const user = userEvent.setup()
    renderPanel()

    const arrayBuffer = vi.fn(async () => {
      throw new Error('oversized DOCX must not be read')
    })
    const oversized = new File([], 'oversized.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    })
    Object.defineProperties(oversized, {
      size: {
        configurable: true,
        value: DOCX_ARCHIVE_LIMITS.maxCompressedBytes + 1
      },
      arrayBuffer: {
        configurable: true,
        value: arrayBuffer
      }
    })

    await user.upload(screen.getByLabelText(/ai\.attach\.label/), oversized)

    expect(await screen.findByText('ai.attach.readFailed')).not.toBeNull()
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(mocks.extractDocx).not.toHaveBeenCalled()
  })

  it('requires review for uncertain links and applies confirm and cancel decisions', async () => {
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
    const onPlaceGenerated = vi.fn().mockResolvedValue({ label: 'reviewed.bpmn' })
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
    await waitFor(() => expect(onPlaceGenerated).toHaveBeenCalledTimes(2))
  })

  it('handles provider selection failure, offline changes, and balance refresh errors', async () => {
    const user = userEvent.setup()
    state.keyed.add('openrouter')
    mocks.setSelection.mockReturnValueOnce({ ok: false, error: 'selection failed' })
    renderPanel()

    await user.selectOptions(screen.getByLabelText('ai.provider.label'), 'openrouter')
    expect(await screen.findByText('selection failed')).not.toBeNull()
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

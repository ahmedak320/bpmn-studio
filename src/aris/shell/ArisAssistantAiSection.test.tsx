// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TransportError } from '../../ai/browserAi'
import { resetSessionKeysForTests, setKey } from '../../ai/keys'
import { buildSyntheticModel } from '../assistant/__tests__/fixtures'
import type { ArisAnswerChip } from '../assistant/answer'
import { buildDigest } from '../assistant/digest'
import { ArisAssistantAiSection } from './ArisAssistantAiSection'
import type { ArisAssistantAiTurn } from './arisAssistantAi'

const makeBrowserCallLLMMock = vi.fn()

// Only the transport factory is mocked — `classifyBrowserError`, `TransportError`,
// etc. stay real, so the fallback/cancellation classification exercised here is
// the genuine production logic, not a stub of it. No real `fetch` is ever
// reachable through this mock.
vi.mock('../../ai/browserAi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ai/browserAi')>()
  return {
    ...actual,
    makeBrowserCallLLM: (...args: unknown[]) => makeBrowserCallLLMMock(...args)
  }
})

const digest = buildDigest(buildSyntheticModel())

function renderSection(overrides: { history?: readonly ArisAssistantAiTurn[] } = {}) {
  const onAnswered = vi.fn()
  const onOpenChip = vi.fn((_chip: ArisAnswerChip) => true)
  const view = render(
    <ArisAssistantAiSection
      digests={[digest]}
      question="what happens in owner registration?"
      providerId="anthropic"
      modelId="claude-sonnet-5"
      history={overrides.history ?? []}
      onOpenChip={onOpenChip}
      onAnswered={onAnswered}
    />
  )
  return { ...view, onAnswered, onOpenChip }
}

function includeContextCheckbox(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(
    '[data-orbitpm-aris-assistant-ai-include-context]'
  )!
}
function consentCheckbox(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('[data-orbitpm-aris-assistant-ai-consent]')!
}
function submitButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('[data-orbitpm-aris-assistant-ai-submit]')!
}
function systemPreview(): HTMLTextAreaElement {
  return document.querySelector<HTMLTextAreaElement>(
    '[data-orbitpm-aris-assistant-ai-preview-system]'
  )!
}
function userPreview(): HTMLTextAreaElement {
  return document.querySelector<HTMLTextAreaElement>(
    '[data-orbitpm-aris-assistant-ai-preview-user]'
  )!
}

beforeEach(() => {
  resetSessionKeysForTests()
  setKey('anthropic', 'test-key')
  makeBrowserCallLLMMock.mockReset()
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('no real network request is allowed in this suite')
  })
})

afterEach(() => {
  cleanup()
  resetSessionKeysForTests()
  vi.restoreAllMocks()
})

describe('ArisAssistantAiSection — §17.5 exact outbound preview and defaults', () => {
  it('starts with workspace context OFF and name redaction ON, per §4.3', () => {
    renderSection()
    expect(includeContextCheckbox().checked).toBe(false)
    const redact = document.querySelector<HTMLInputElement>(
      '[data-orbitpm-aris-assistant-ai-redact-names]'
    )!
    expect(redact.checked).toBe(true)
    expect(redact.disabled).toBe(true) // disabled while context is not included
  })

  it('renders the exact outbound system/user text BEFORE anything is sent, live as toggles change', () => {
    renderSection()
    expect(systemPreview().value).toContain('ONLY the process information supplied')
    expect(userPreview().value).toContain('what happens in owner registration?')
    // Workspace context is off by default, so the model is told explicitly.
    expect(userPreview().value).toContain('No workspace process context was supplied')

    fireEvent.click(includeContextCheckbox())
    // Once included, the ranked/redacted process context appears verbatim in the preview.
    expect(userPreview().value).toContain('Owner Registration')
    expect(userPreview().value).not.toContain('fetch')
  })

  it('never calls fetch just from rendering or toggling the preview', () => {
    renderSection()
    fireEvent.click(includeContextCheckbox())
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(makeBrowserCallLLMMock).not.toHaveBeenCalled()
  })
})

describe('ArisAssistantAiSection — §17.5.6 consent bound to the exact payload', () => {
  it('disables Ask AI until consent is checked', () => {
    renderSection()
    expect(submitButton().disabled).toBe(true)
    fireEvent.click(consentCheckbox())
    expect(submitButton().disabled).toBe(false)
  })

  it('un-checks consent (and re-disables Ask AI) when the payload changes after granting it', () => {
    renderSection()
    fireEvent.click(consentCheckbox())
    expect(consentCheckbox().checked).toBe(true)
    expect(submitButton().disabled).toBe(false)

    // Toggling workspace-context inclusion changes the disclosure fingerprint.
    fireEvent.click(includeContextCheckbox())

    expect(consentCheckbox().checked).toBe(false)
    expect(submitButton().disabled).toBe(true)
  })
})

describe('ArisAssistantAiSection — success, fallback, and cancellation', () => {
  it('renders the answer text, names the provider and model, and offers the source chips', async () => {
    makeBrowserCallLLMMock.mockReturnValue(async () => 'The next step is certificate issuance.')
    const { onAnswered, onOpenChip } = renderSection()
    fireEvent.click(includeContextCheckbox())
    fireEvent.click(consentCheckbox())
    fireEvent.click(submitButton())

    const answerNode = await waitFor(() => {
      const node = document.querySelector('[data-orbitpm-aris-assistant-ai-answer]')
      if (!node) throw new Error('no AI answer rendered yet')
      return node
    })
    expect(answerNode.textContent).toContain('The next step is certificate issuance.')
    expect(answerNode.textContent).toContain('claude-sonnet-5')
    expect(onAnswered).toHaveBeenCalledWith({
      question: 'what happens in owner registration?',
      answer: 'The next step is certificate issuance.'
    })

    const chip = answerNode.querySelector<HTMLButtonElement>(
      '[data-orbitpm-aris-assistant-ai-chip="m1"]'
    )
    expect(chip).not.toBeNull()
    fireEvent.click(chip!)
    expect(onOpenChip).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'm1', relPath: 'processes/owner-registration.aml' })
    )
  })

  it('falls back to a local-answer notice (never a raw error) when the provider fails', async () => {
    makeBrowserCallLLMMock.mockReturnValue(async () => {
      throw new TransportError('network', 'offline')
    })
    renderSection()
    fireEvent.click(consentCheckbox())
    fireEvent.click(submitButton())

    await waitFor(() => {
      const node = document.querySelector('[data-orbitpm-aris-assistant-ai-fallback]')
      if (!node) throw new Error('no fallback notice yet')
      return node
    })
    expect(document.querySelector('[data-orbitpm-aris-assistant-ai-answer]')).toBeNull()
  })

  it('cancels cleanly: aborting leaves no partial answer and shows a distinct cancelled notice', async () => {
    let capturedSignal: AbortSignal | undefined
    makeBrowserCallLLMMock.mockImplementation((_cfg: unknown, extra: { signal?: AbortSignal }) => {
      capturedSignal = extra.signal
      return () =>
        new Promise<string>((_resolve, reject) => {
          extra.signal?.addEventListener('abort', () => {
            reject(new TransportError('cancelled', 'The request was cancelled.'))
          })
        })
    })
    renderSection()
    fireEvent.click(consentCheckbox())
    fireEvent.click(submitButton())

    await waitFor(() => {
      const cancel = document.querySelector('[data-orbitpm-aris-assistant-ai-cancel]')
      if (!cancel) throw new Error('cancel button not shown yet')
      return cancel
    })
    fireEvent.click(document.querySelector('[data-orbitpm-aris-assistant-ai-cancel]')!)

    await waitFor(() => {
      const node = document.querySelector('[data-orbitpm-aris-assistant-ai-cancelled]')
      if (!node) throw new Error('no cancelled notice yet')
      return node
    })
    expect(capturedSignal?.aborted).toBe(true)
    expect(document.querySelector('[data-orbitpm-aris-assistant-ai-answer]')).toBeNull()
    expect(document.querySelector('[data-orbitpm-aris-assistant-ai-fallback]')).toBeNull()
    expect(submitButton().disabled).toBe(false)
  })
})

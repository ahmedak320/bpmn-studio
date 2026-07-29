// @vitest-environment jsdom
//
// Ported from `ArisAssistantPanel.aiGate.test.tsx`: the §17.4 deterministic
// local path in the chat drawer's LIBRARY tab must be COMPLETELY UNAFFECTED by
// the §17.5 AI offer. A user with no provider/key sees exactly today's
// behavior — no `[data-orbitpm-aris-assistant-ai]` DOM, no network attempt, no
// consent prompt. The AI offer (the KEPT `ArisAssistantAiSection` consent card)
// appears ONLY when both (a) a provider+key are configured and (b)
// `routeQuestion` returned `kind: 'none'`.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setLang } from '../../i18n'
import { resetSessionKeysForTests, setKey } from '../../ai/keys'
import { resetProviderSelectionForTests, setProviderSelection } from '../../ai/providerSelection'
import { buildSyntheticModel } from '../assistant/__tests__/fixtures'
import { buildDigest } from '../assistant/digest'
import type { ArisProcessDigest } from '../assistant/types'
import { ArisChatDrawer, type ArisChatDrawerProps } from './ArisChatDrawer'

const digests: readonly ArisProcessDigest[] = [buildDigest(buildSyntheticModel())]

const noop = (): void => {}

function baseProps(overrides: Partial<ArisChatDrawerProps> = {}): ArisChatDrawerProps {
  return {
    open: true,
    onOpen: noop,
    onClose: noop,
    keysVersion: 0,
    digests,
    onOpenChip: () => true,
    onOpenSettings: noop,
    getActiveChatTarget: () => null,
    ...overrides
  }
}

beforeEach(() => {
  setLang('en')
  resetProviderSelectionForTests()
  resetSessionKeysForTests()
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('no real network request is allowed in this suite')
  })
})

afterEach(() => {
  cleanup()
  setLang('en')
  resetProviderSelectionForTests()
  resetSessionKeysForTests()
  vi.restoreAllMocks()
})

function askQuestion(text: string): void {
  fireEvent.change(document.querySelector('[data-orbitpm-aris-assistant-question]')!, {
    target: { value: text }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

describe('ArisChatDrawer library tab — no-key path is unchanged by the §17.5 AI wiring', () => {
  it('answers a matched question locally, with no AI section and zero network attempts', async () => {
    render(<ArisChatDrawer {...baseProps()} />)
    askQuestion('Which processes are available?')

    const answer = await waitFor(() => {
      const node = document.querySelector('[data-orbitpm-aris-assistant-answer]')
      if (!node) throw new Error('no local answer yet')
      return node
    })
    expect(answer.textContent).toContain('Available processes')
    expect(document.querySelector('[data-orbitpm-aris-assistant-ai]')).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('shows the same "no confident local answer" message with no AI section when no provider/key is configured', async () => {
    render(<ArisChatDrawer {...baseProps()} />)
    askQuestion('quantum orbital mechanics stardust')

    const answer = await waitFor(() => {
      const node = document.querySelector('[data-orbitpm-aris-assistant-answer]')
      if (!node) throw new Error('no local answer yet')
      return node
    })
    expect(answer.textContent).toContain('No confident local answer')
    expect(document.querySelector('[data-orbitpm-aris-assistant-ai]')).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe('ArisChatDrawer library tab — §17.5 AI offer gating', () => {
  it('mounts the AI section with unchecked consent and a disabled submit once a provider+key is configured AND the local path found nothing', async () => {
    setProviderSelection('anthropic', 'claude-sonnet-5')
    setKey('anthropic', 'test-key')
    render(<ArisChatDrawer {...baseProps()} />)
    askQuestion('quantum orbital mechanics stardust')

    const section = await waitFor(() => {
      const node = document.querySelector('[data-orbitpm-aris-assistant-ai]')
      if (!node) throw new Error('AI section not offered yet')
      return node
    })
    const consent = section.querySelector<HTMLInputElement>(
      '[data-orbitpm-aris-assistant-ai-consent]'
    )
    const submit = section.querySelector<HTMLButtonElement>(
      '[data-orbitpm-aris-assistant-ai-submit]'
    )
    expect(consent?.checked).toBe(false)
    expect(submit?.disabled).toBe(true)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('does NOT offer the AI path when the local path already answered confidently, even with a key configured', async () => {
    setProviderSelection('anthropic', 'claude-sonnet-5')
    setKey('anthropic', 'test-key')
    render(<ArisChatDrawer {...baseProps()} />)
    askQuestion('Which processes are available?')

    await waitFor(() => {
      const node = document.querySelector('[data-orbitpm-aris-assistant-answer]')
      if (!node) throw new Error('no local answer yet')
      return node
    })
    expect(document.querySelector('[data-orbitpm-aris-assistant-ai]')).toBeNull()
  })

  it('does NOT offer the AI path when a provider is selected but no key is stored for it', async () => {
    setProviderSelection('anthropic', 'claude-sonnet-5')
    render(<ArisChatDrawer {...baseProps()} />)
    askQuestion('quantum orbital mechanics stardust')

    await waitFor(() => {
      const node = document.querySelector('[data-orbitpm-aris-assistant-answer]')
      if (!node) throw new Error('no local answer yet')
      return node
    })
    expect(document.querySelector('[data-orbitpm-aris-assistant-ai]')).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

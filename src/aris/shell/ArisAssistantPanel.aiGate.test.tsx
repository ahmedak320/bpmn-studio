// @vitest-environment jsdom
//
// The property that matters most (per the §17.5 wiring brief): the §17.4
// deterministic local path must be COMPLETELY UNAFFECTED by adding the §17.5
// AI path. A user with no provider/key configured must see exactly today's
// behavior — no extra DOM, no extra network attempt, no consent prompt, no
// latency. This suite asserts that property directly, plus the flip side:
// the AI offer appears ONLY when both (a) a provider+key are configured and
// (b) `routeQuestion` returned `kind: 'none'`.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetSessionKeysForTests, setKey } from '../../ai/keys'
import { resetProviderSelectionForTests, setProviderSelection } from '../../ai/providerSelection'
import { buildSyntheticModel } from '../assistant/__tests__/fixtures'
import { buildDigest } from '../assistant/digest'
import type { ArisProcessDigest } from '../assistant/types'
import { ArisAssistantPanel } from './ArisAssistantPanel'

const digests: readonly ArisProcessDigest[] = [buildDigest(buildSyntheticModel())]

beforeEach(() => {
  resetProviderSelectionForTests()
  resetSessionKeysForTests()
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('no real network request is allowed in this suite')
  })
})

afterEach(() => {
  cleanup()
  resetProviderSelectionForTests()
  resetSessionKeysForTests()
  vi.restoreAllMocks()
})

function askQuestion(text: string): void {
  fireEvent.change(document.querySelector('[data-orbitpm-aris-assistant-question]')!, {
    target: { value: text }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
}

describe('ArisAssistantPanel — no-key path is unchanged by the §17.5 AI wiring', () => {
  it('answers a matched question locally, with no AI section and zero network attempts', async () => {
    render(<ArisAssistantPanel digests={digests} lang="en" onOpenChip={() => true} />)
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
    render(<ArisAssistantPanel digests={digests} lang="en" onOpenChip={() => true} />)
    askQuestion('quantum orbital mechanics stardust')

    const answer = await waitFor(() => {
      const node = document.querySelector('[data-orbitpm-aris-assistant-answer]')
      if (!node) throw new Error('no local answer yet')
      return node
    })
    expect(answer.textContent).toContain('No confident local answer was found')
    expect(document.querySelector('[data-orbitpm-aris-assistant-ai]')).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe('ArisAssistantPanel — §17.5 AI offer gating', () => {
  it('offers the AI path only once a provider+key is configured AND the local path found nothing', async () => {
    setProviderSelection('anthropic', 'claude-sonnet-5')
    setKey('anthropic', 'test-key')
    render(<ArisAssistantPanel digests={digests} lang="en" onOpenChip={() => true} />)
    askQuestion('quantum orbital mechanics stardust')

    await waitFor(() => {
      const node = document.querySelector('[data-orbitpm-aris-assistant-ai]')
      if (!node) throw new Error('AI section not offered yet')
      return node
    })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('does NOT offer the AI path when the local path already answered confidently, even with a key configured', async () => {
    setProviderSelection('anthropic', 'claude-sonnet-5')
    setKey('anthropic', 'test-key')
    render(<ArisAssistantPanel digests={digests} lang="en" onOpenChip={() => true} />)
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
    render(<ArisAssistantPanel digests={digests} lang="en" onOpenChip={() => true} />)
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

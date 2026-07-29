// @vitest-environment jsdom
//
// Standalone tests for the ARIS chat drawer chrome + both tabs. The drawer is
// NOT yet mounted into the app this wave (Lane L3d does that), so every case
// renders `ArisChatDrawer` directly with stub props.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setLang } from '../../i18n'
import { resetSessionKeysForTests } from '../../ai/keys'
import { resetProviderSelectionForTests } from '../../ai/providerSelection'
import { buildSyntheticModel } from '../assistant/__tests__/fixtures'
import { buildDigest } from '../assistant/digest'
import type { ArisProcessDigest } from '../assistant/types'
import { createDefinitionCommand, createOccurrenceCommand } from '../canvas/commandFactory'
import { createEmptyArisCanvasDocument } from '../canvas/emptyDocument'
import { applyCommand } from '../model/commands'
import type { ArisWorkingDocument } from '../model/types'
import { createArisChatApplyHost } from './arisChatHost'
import type { ArisChatDrawerTarget, ArisTabChatHost } from './arisChatDrawerTypes'
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

/** A minimal but real EEPC document whose start event has an Arabic-only name. */
function buildEepcWithMissingEnglishName(): ArisWorkingDocument {
  const { document: empty, modelId } = createEmptyArisCanvasDocument({
    modelId: 'Model.1',
    modelName: 'Process',
    modelType: 'MT_EEPC'
  })

  let document = empty
  document = applyCommand(
    document,
    createDefinitionCommand(
      { commandId: 'seed-start-def', baseRevision: document.revision, origin: 'user' },
      {
        definitionId: 'ObjDef.START',
        objectType: 'OT_EVT',
        symbolNum: 'ST_EVT',
        name: 'تم استلام الطلب',
        localeId: 'ar'
      }
    )
  )
  document = applyCommand(
    document,
    createOccurrenceCommand(
      { commandId: 'seed-start-occ', baseRevision: document.revision, origin: 'user' },
      {
        occurrenceId: 'ObjOcc.START',
        definitionId: 'ObjDef.START',
        modelId,
        symbolNum: 'ST_EVT',
        bounds: { x: 100, y: 100, width: 100, height: 80 }
      }
    )
  )
  document = applyCommand(
    document,
    createDefinitionCommand(
      { commandId: 'seed-func-def', baseRevision: document.revision, origin: 'user' },
      {
        definitionId: 'ObjDef.FUNC',
        objectType: 'OT_FUNC',
        symbolNum: 'ST_FUNC',
        name: 'Review request',
        localeId: 'en-US',
        attributes: [
          { type: 'AT_PROC_CODE', values: [{ localeId: 'en-US', text: 'P-001' }] },
          { type: 'AT_PERS_RESP', values: [{ localeId: 'en-US', text: 'Reviewer' }] }
        ]
      }
    )
  )
  document = applyCommand(
    document,
    createOccurrenceCommand(
      { commandId: 'seed-func-occ', baseRevision: document.revision, origin: 'user' },
      {
        occurrenceId: 'ObjOcc.FUNC',
        definitionId: 'ObjDef.FUNC',
        modelId,
        symbolNum: 'ST_FUNC',
        bounds: { x: 100, y: 300, width: 100, height: 80 }
      }
    )
  )
  return document
}

function createStubChatTarget(document: ArisWorkingDocument): {
  target: ArisChatDrawerTarget
  applyCalls: (readonly unknown[])[]
} {
  let current = document
  const applyCalls: (readonly unknown[])[] = []
  const applyHost = createArisChatApplyHost({ origin: 'ai-auto' })
  const host: ArisTabChatHost = {
    getDocument: () => current,
    applyCommands: (commands) => {
      applyCalls.push(commands)
      let next = current
      for (const command of commands) next = applyHost.applyCommand(next, command)
      current = next
      return current
    },
    undo: () => {},
    getCanUndo: () => false
  }
  return { target: { tabKey: 't1', title: 'Owner Registration', host }, applyCalls }
}

beforeEach(() => {
  setLang('en')
  resetProviderSelectionForTests()
  resetSessionKeysForTests()
})

afterEach(() => {
  cleanup()
  setLang('en')
  resetProviderSelectionForTests()
  resetSessionKeysForTests()
  vi.restoreAllMocks()
})

describe('ArisChatDrawer — chrome', () => {
  it('renders the FAB with its aria-label and hides it while the drawer is open', () => {
    const { rerender } = render(<ArisChatDrawer {...baseProps({ open: false })} />)
    const fab = screen.getByRole('button', { name: 'Ask the process assistant' })
    expect(fab.hidden).toBe(false)

    rerender(<ArisChatDrawer {...baseProps({ open: true })} />)
    const hiddenFab = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Ask the process assistant"]'
    )
    expect(hiddenFab?.hidden).toBe(true)
  })

  it('renders the panel as a dialog named "Process assistant"', () => {
    render(<ArisChatDrawer {...baseProps()} />)
    expect(screen.getByRole('dialog', { name: 'Process assistant' })).toBeTruthy()
  })

  it('propagates the RTL direction to the dialog', () => {
    setLang('ar')
    render(<ArisChatDrawer {...baseProps()} />)
    expect(screen.getByRole('dialog').getAttribute('dir')).toBe('rtl')
  })
})

describe('ArisChatDrawer — library tab', () => {
  it('sends on Enter but not on Shift+Enter', () => {
    render(<ArisChatDrawer {...baseProps()} />)
    const textarea = document.querySelector('[data-orbitpm-aris-assistant-question]')!

    fireEvent.change(textarea, { target: { value: 'Which processes are available?' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(document.querySelector('[data-orbitpm-aris-assistant-answer]')).toBeNull()

    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(document.querySelector('[data-orbitpm-aris-assistant-answer]')).not.toBeNull()
  })

  it('renders a local answer with an openable chip', () => {
    const onOpenChip = vi.fn(() => true)
    render(<ArisChatDrawer {...baseProps({ onOpenChip })} />)
    const textarea = document.querySelector('[data-orbitpm-aris-assistant-question]')!

    fireEvent.change(textarea, { target: { value: 'Which processes are available?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    const chip = document.querySelector<HTMLButtonElement>(
      '[data-orbitpm-aris-assistant-answer] [data-orbitpm-aris-assistant-chip]'
    )
    expect(chip).not.toBeNull()
    fireEvent.click(chip!)
    expect(onOpenChip).toHaveBeenCalledTimes(1)
  })
})

describe('ArisChatDrawer — interview tab', () => {
  it('scans gaps, asks at most three questions, applies one command, and records a receipt', () => {
    const doc = buildEepcWithMissingEnglishName()
    const { target, applyCalls } = createStubChatTarget(doc)
    render(<ArisChatDrawer {...baseProps({ getActiveChatTarget: () => target })} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Complete this process' }))

    // Intro card: gap list + Start button.
    expect(document.querySelector('[data-orbitpm-aris-chat-gaps]')).not.toBeNull()
    fireEvent.click(document.querySelector('[data-orbitpm-aris-chat-start]')!)

    const questions = document.querySelectorAll('[data-orbitpm-aris-chat-question]')
    expect(questions.length).toBeGreaterThan(0)
    expect(questions.length).toBeLessThanOrEqual(3)

    const englishNameLabel = document.querySelector(
      '[data-orbitpm-aris-chat-question="missingEnglishName"]'
    )!
    const answerInput = englishNameLabel.querySelector('input')!
    fireEvent.change(answerInput, { target: { value: 'Request received' } })

    fireEvent.click(document.querySelector('[data-orbitpm-aris-chat-submit]')!)

    expect(applyCalls).toHaveLength(1)
    expect(document.querySelector('[data-orbitpm-aris-chat-receipts]')).not.toBeNull()
  })

  it('shows the no-target status when no ARIS model is active', () => {
    render(<ArisChatDrawer {...baseProps({ getActiveChatTarget: () => null })} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Complete this process' }))
    expect(
      screen.getByText('Open an ARIS model first, then start the completion interview.')
    ).toBeTruthy()
  })
})

// @vitest-environment jsdom

/**
 * Lane L5c — ArisTranslateController.
 *
 * The reviewed-translation flow is driven on the product's REAL canvas command
 * bridge (the same harness the apply-stage suite uses), so "one undoable
 * gesture" is proved on the actual history. The free/AI transport is the only
 * seam mocked — no test touches the network.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { t, setLang } from '../../i18n'
import { getPref, resetSessionKeysForTests, setKey, setPref } from '../../ai/keys'
import { resetProviderSelectionForTests, setProviderSelection } from '../../ai/providerSelection'
import { getLiteProvider } from '../../ai/providersLite'
import { FreeTranslateError } from '../../ai/freeTranslate'
import { countArisMissingTranslations } from '../localization'
import { bootCanvas, type Harness } from '../canvas/testing/harness'
import { makeDocument, objectDefinition, occurrence } from '../localization/__tests__/support'
import type { ArisWorkingDocument } from '../model/types'
import {
  ArisTranslateController,
  type ArisTranslateControllerHandle,
  type ArisTranslateControllerProps
} from './ArisTranslateController'

// The free transport is the only mocked seam. `hoisted.freeImpl` is swapped per
// test; everything else in the module (FreeTranslateError included) is real.
const hoisted = vi.hoisted(() => ({
  freeImpl: null as
    | null
    | ((
        texts: string[],
        from: 'en' | 'ar',
        to: 'en' | 'ar',
        signal?: AbortSignal
      ) => Promise<Array<string | undefined>>)
}))

vi.mock('../../ai/freeTranslate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ai/freeTranslate')>()
  return {
    ...actual,
    makeFreeTranslateTexts:
      () =>
      async (
        texts: string[],
        from: 'en' | 'ar',
        to: 'en' | 'ar',
        signal?: AbortSignal
      ): Promise<Array<string | undefined>> => {
        if (!hoisted.freeImpl) return texts.map(() => undefined)
        return hoisted.freeImpl(texts, from, to, signal)
      }
  }
})

const AR_APPROVE = 'يعتمد'
const AR_WRITE_LOCALE = '1025'

/** A model that is already bilingual plus one English-only definition. */
function englishOnlyDefinitionDocument(): ArisWorkingDocument {
  return makeDocument({
    modelId: 'Model.1',
    modelName: { 'en-US': 'Process', '1025': 'عملية' },
    objectDefinitions: [objectDefinition('ObjDef.approve', 'OT_FUNC', { 'en-US': 'Approve' })],
    occurrences: [occurrence('ObjOcc.approve', 'ObjDef.approve', 'Model.1')]
  })
}

/** Bilingual model, one TM-resolvable def, one def the provider must handle. */
function mixedDocument(): ArisWorkingDocument {
  return makeDocument({
    modelId: 'Model.1',
    modelName: { 'en-US': 'Process', '1025': 'عملية' },
    objectDefinitions: [
      objectDefinition('ObjDef.approve', 'OT_FUNC', { 'en-US': 'Approve' }),
      objectDefinition('ObjDef.review', 'OT_FUNC', { 'en-US': 'Review' })
    ],
    occurrences: [
      occurrence('ObjOcc.approve', 'ObjDef.approve', 'Model.1'),
      occurrence('ObjOcc.review', 'ObjDef.review', 'Model.1')
    ]
  })
}

function arNameOf(document: ArisWorkingDocument, definitionId: string): string | undefined {
  return document.objectDefinitions.get(definitionId)?.names.values[AR_WRITE_LOCALE]
}

let harness: Harness | null = null

function renderController(overrides: Partial<ArisTranslateControllerProps> = {}): {
  ref: React.RefObject<ArisTranslateControllerHandle>
  onToast: ReturnType<typeof vi.fn>
  onAcceptedPair: ReturnType<typeof vi.fn>
} {
  const document = overrides.liveDocument ?? englishOnlyDefinitionDocument()
  harness = bootCanvas({ document, modelId: 'Model.1' })
  const canvas = harness.canvas
  const ref = createRef<ArisTranslateControllerHandle>()
  const onToast = vi.fn()
  const onAcceptedPair = vi.fn()
  render(
    <ArisTranslateController
      ref={ref}
      getCanvas={() => canvas}
      liveDocument={canvas.document}
      contentLang="en"
      documentName="Doc"
      autoTranslateEligible={false}
      resources={null}
      onToast={onToast}
      onAcceptedPair={onAcceptedPair}
      {...overrides}
    />
  )
  return { ref, onToast, onAcceptedPair }
}

beforeEach(() => {
  setLang('en')
  hoisted.freeImpl = null
  resetProviderSelectionForTests()
  resetSessionKeysForTests()
  setPref('arisAutoTranslate', '')
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no real network in this suite'))
})

afterEach(() => {
  cleanup()
  harness?.destroy()
  harness = null
  setLang('en')
  hoisted.freeImpl = null
  resetProviderSelectionForTests()
  resetSessionKeysForTests()
  setPref('arisAutoTranslate', '')
  vi.restoreAllMocks()
})

describe('ArisTranslateController — provider offers', () => {
  it('always offers the free provider and never the AI provider without a stored key', () => {
    const { ref } = renderController()
    act(() => ref.current!.openReview('ar'))
    expect(document.querySelector('option[value="free"]')).not.toBeNull()
    expect(document.querySelector('option[value="selected-ai"]')).toBeNull()
  })

  it('offers the configured AI provider only when a key is stored', () => {
    setProviderSelection('anthropic', 'claude-x')
    setKey('anthropic', 'sk-test-key')
    const { ref } = renderController()
    act(() => ref.current!.openReview('ar'))
    const aiOption = document.querySelector('option[value="selected-ai"]')
    expect(aiOption).not.toBeNull()
    expect(aiOption?.textContent).toContain(getLiteProvider('anthropic').label)
    expect(aiOption?.textContent).toContain('claude-x')
  })
})

describe('ArisTranslateController — apply', () => {
  it('applies a translation-memory pair with zero network fetches', async () => {
    const { ref, onToast } = renderController({
      liveDocument: mixedDocument(),
      resources: {
        glossary: [],
        translationMemory: [{ en: 'Approve', ar: AR_APPROVE, accepted: true }]
      }
    })
    act(() => ref.current!.openReview('ar'))

    // One def is TM-resolvable; the review is still incomplete because the other
    // def needs a provider, so the dialog opens with a "partial" apply.
    const applyButton = await screen.findByRole('button', {
      name: t('translationReview.partialPreview')
    })
    fireEvent.click(applyButton)

    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.any(String), 'success'))
    expect(arNameOf(harness!.canvas.document, 'ObjDef.approve')).toBe(AR_APPROVE)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('runs the transport, accepts a proposal, and applies exactly ONE gesture + toast', async () => {
    hoisted.freeImpl = vi.fn(async (texts: string[]) => texts.map(() => AR_APPROVE))
    const { ref, onToast, onAcceptedPair } = renderController()
    const canvas = harness!.canvas
    const commandsBefore = canvas.commandLog.length

    act(() => ref.current!.openReview('ar'))

    fireEvent.click(
      await screen.findByRole('button', { name: t('translationReview.translateNow') })
    )
    fireEvent.click(
      await screen.findByRole('button', { name: t('translationReview.field.acceptProposal') })
    )
    fireEvent.click(
      await screen.findByRole('button', { name: t('translationReview.applyCompleted') })
    )

    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.any(String), 'success'))
    expect(canvas.commandLog.length).toBe(commandsBefore + 1)
    expect(arNameOf(canvas.document, 'ObjDef.approve')).toBe(AR_APPROVE)
    expect(onAcceptedPair).toHaveBeenCalledWith({ en: 'Approve', ar: AR_APPROVE })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe('ArisTranslateController — manual run reliability', () => {
  it('reports all positional failures and marks the failed row for retry', async () => {
    hoisted.freeImpl = vi.fn(async (texts: string[]) => texts.map(() => undefined))
    const { ref } = renderController()
    act(() => ref.current!.openReview('ar'))

    fireEvent.click(
      await screen.findByRole('button', { name: t('translationReview.translateNow') })
    )

    expect(
      await screen.findByText(
        t('translationReview.runSummary', {
          proposals: 0,
          failed: 1
        })
      )
    ).not.toBeNull()
    const retryButton = screen.getByRole('button', {
      name: t('translationReview.field.retry')
    })
    expect(retryButton.closest('li')?.textContent).toContain(
      t('translationReview.issue.providerFailed')
    )
  })

  it('maps a free-chain rate failure to localized provider feedback', async () => {
    hoisted.freeImpl = vi.fn(async () => {
      throw new FreeTranslateError('rate', 'chain')
    })
    const { ref } = renderController()
    act(() => ref.current!.openReview('ar'))

    fireEvent.click(
      await screen.findByRole('button', { name: t('translationReview.translateNow') })
    )

    const alert = await screen.findByRole('alert')
    expect(alert.firstElementChild?.textContent).toBe(
      t('aris.translate.failed', { error: t('translate.free.rate') })
    )
  })

  it('summarizes a partial run and leaves Translate now enabled for the failed item', async () => {
    hoisted.freeImpl = vi.fn(async (texts: string[]) =>
      texts.map((_text, index) => (index === 0 ? AR_APPROVE : undefined))
    )
    const { ref } = renderController({
      liveDocument: mixedDocument(),
      resources: { glossary: [], translationMemory: [] }
    })
    act(() => ref.current!.openReview('ar'))

    fireEvent.click(
      await screen.findByRole('button', { name: t('translationReview.translateNow') })
    )

    expect(
      await screen.findByText(
        t('translationReview.runSummary', {
          proposals: 1,
          failed: 1
        })
      )
    ).not.toBeNull()
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: t('translationReview.translateNow')
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false)
    )
  })
})

describe('ArisTranslateController — silent auto-translate', () => {
  it('fires exactly once for a generated model and applies as one gesture', async () => {
    hoisted.freeImpl = vi.fn(async (texts: string[]) => texts.map(() => AR_APPROVE))
    const { onToast } = renderController({ autoTranslateEligible: true })
    const canvas = harness!.canvas

    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.any(String), 'success'))
    expect(hoisted.freeImpl).toHaveBeenCalledTimes(1)
    expect(arNameOf(canvas.document, 'ObjDef.approve')).toBe(AR_APPROVE)
    // No dialog is mounted for the auto path.
    expect(screen.queryByRole('button', { name: t('translationReview.translateNow') })).toBeNull()
  })

  it('never fires for a non-generated (aml) model', async () => {
    hoisted.freeImpl = vi.fn(async (texts: string[]) => texts.map(() => AR_APPROVE))
    renderController({ autoTranslateEligible: false })
    await act(async () => {
      await Promise.resolve()
    })
    expect(hoisted.freeImpl).not.toHaveBeenCalled()
  })

  it('never fires when the auto-translate preference is off', async () => {
    setPref('arisAutoTranslate', 'off')
    expect(getPref('arisAutoTranslate')).toBe('off')
    hoisted.freeImpl = vi.fn(async (texts: string[]) => texts.map(() => AR_APPROVE))
    renderController({ autoTranslateEligible: true })
    await act(async () => {
      await Promise.resolve()
    })
    expect(hoisted.freeImpl).not.toHaveBeenCalled()
  })

  it('degrades silently on a whole-chain FreeTranslateError (badge logic still shows)', async () => {
    hoisted.freeImpl = vi.fn(async () => {
      throw new FreeTranslateError('service', 'chain')
    })
    const { onToast } = renderController({ autoTranslateEligible: true })
    const canvas = harness!.canvas

    await waitFor(() => expect(hoisted.freeImpl).toHaveBeenCalled())
    // Nothing applied, no toast — and the missing-translation count still stands
    // so the toolbar badge remains the entry point.
    expect(onToast).not.toHaveBeenCalled()
    expect(arNameOf(canvas.document, 'ObjDef.approve')).toBeUndefined()
    expect(countArisMissingTranslations(canvas.document).ar).toBeGreaterThan(0)
  })
})

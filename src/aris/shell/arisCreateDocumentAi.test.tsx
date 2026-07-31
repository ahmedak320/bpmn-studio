// @vitest-environment jsdom

/**
 * §16.3/§16.6 — the PDF/Picture ("document") Create tab, focused on a PDF
 * attachment (as opposed to an image) driving a full generation.
 *
 * `arisCreatePanel.test.tsx` already exercises the document tab's picker and
 * capability gate, a PDF attached through the *Description* tab, and a
 * *picture* generated through this tab. What none of the existing suites
 * cover is a PDF attached through the PDF/Picture tab itself actually
 * producing a native ARIS model end to end — the Phase 13 evaluation flagged
 * this as "PDF/image wiring not shell-tested". This file closes that gap,
 * plus three adjacent ones worth locking down at the mounted level: the
 * Description tab's PDF-only picker correctly refusing a non-PDF file,
 * cancellation while a document-tab request is in flight, and that nothing
 * is ever sent before consent even with a file already attached.
 *
 * Every provider call is injected, so this suite makes no network request.
 */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ArisGenerationPanel } from '../../ArisGenerationPanel'
import { buildMinimalValidDraft } from '../ai/testFixtures'
import { resetSessionKeysForTests } from '../../ai/keys'
import { resetProviderSelectionForTests } from '../../ai/providerSelection'
import { firstLiteModelForAttachment, getLiteModelCapabilities } from '../../ai/providersLite'
import type { GenAttachment } from '../../ai/pdf'
import type { ArisAiGenerationRequest } from './arisAiGeneration'

const MIB = 1024 * 1024

interface Harness {
  readonly created: { name: string; xml: string }[]
  readonly requests: ArisAiGenerationRequest[]
  readonly encoded: File[]
}

function pdfFile(name = 'process-drawing.pdf', size = MIB): File {
  const file = new File([new Uint8Array([37, 80, 68, 70])], name, { type: 'application/pdf' })
  Object.defineProperty(file, 'size', { configurable: true, value: size })
  return file
}

function imageFile(name: string, type: string, size = MIB): File {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type })
  Object.defineProperty(file, 'size', { configurable: true, value: size })
  return file
}

function renderPanel(
  options: {
    replies?: readonly string[]
    hold?: () => Promise<void>
  } = {}
): Harness {
  const harness: Harness = { created: [], requests: [], encoded: [] }
  const replies = options.replies ?? [JSON.stringify(buildMinimalValidDraft())]
  let index = 0

  render(
    <ArisGenerationPanel
      onCreateModel={(input) => {
        harness.created.push(input)
      }}
      onDownloadFile={() => undefined}
      onOpenAssistant={() => undefined}
      onOpenSettings={() => undefined}
      encodeAttachment={async (file, accepted): Promise<GenAttachment> => {
        harness.encoded.push(file)
        return {
          kind: accepted.kind,
          base64: 'ZmFrZQ==',
          mediaType: accepted.mediaType,
          fileName: accepted.fileName,
          sizeBytes: accepted.sizeBytes
        }
      }}
      callProvider={async (request) => {
        harness.requests.push(request)
        if (options.hold) await options.hold()
        const reply = replies[Math.min(index, replies.length - 1)]!
        index += 1
        return reply
      }}
    />
  )
  return harness
}

function panel(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-orbitpm-aris-create]')!
}

function click(selector: string): void {
  fireEvent.click(panel().querySelector<HTMLElement>(selector)!)
}

function chooseFile(selector: string, file: File): void {
  const input = panel().querySelector<HTMLInputElement>(selector)!
  fireEvent.change(input, { target: { files: [file] } })
}

function submit(): void {
  fireEvent.click(panel().querySelector<HTMLButtonElement>('[data-orbitpm-aris-create-submit]')!)
}

function statusText(): string {
  return panel().querySelector<HTMLElement>('[role="status"]')?.textContent ?? ''
}

function selectProvider(id: string): void {
  fireEvent.change(
    panel().querySelector<HTMLSelectElement>('[data-orbitpm-aris-create-provider]')!,
    {
      target: { value: id }
    }
  )
}

function selectModel(id: string): void {
  fireEvent.change(panel().querySelector<HTMLInputElement>('[data-orbitpm-aris-create-model]')!, {
    target: { value: id }
  })
}

function noticeText(): string {
  return panel().querySelector('[data-orbitpm-aris-create-attachment-notice]')?.textContent ?? ''
}

function switchButton(): HTMLButtonElement | null {
  return panel().querySelector<HTMLButtonElement>('[data-orbitpm-aris-create-attachment-switch]')
}

function modelValue(): string {
  return panel().querySelector<HTMLInputElement>('[data-orbitpm-aris-create-model]')!.value
}

/**
 * The document tab's single file input accepts both kinds (its `accept`
 * lists both `application/pdf` and `image/png`); the description tab's PDF
 * picker accepts only `application/pdf,.pdf`, so matching on `image/png`
 * unambiguously targets the document-tab input once that tab is active.
 */
const DOCUMENT_FILE_INPUT = 'input[accept*="image/png"]'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  resetSessionKeysForTests()
  resetProviderSelectionForTests()
  localStorage.clear()
})

describe('§16.3/§16.6 — a PDF attached through the PDF/Picture tab drives a full generation', () => {
  it('sends the PDF on the first request only, uses the document instruction (not the image one), folds the hint in verbatim, and creates a native ARIS model with no BPMN', async () => {
    // The default provider/model (OpenRouter's curated first route) already
    // supports PDF out of the box — no provider switch needed, matching the
    // Description-tab PDF test in arisCreatePanel.test.tsx.
    const harness = renderPanel({
      replies: ['not json at all', JSON.stringify(buildMinimalValidDraft())]
    })
    click('[data-orbitpm-aris-create-document-tab]')
    chooseFile(DOCUMENT_FILE_INPUT, pdfFile('renewal-spec.pdf'))
    expect(
      panel().querySelector('[data-orbitpm-aris-create-attachment-notice]')?.textContent
    ).toContain('renewal-spec.pdf')

    fireEvent.change(
      panel().querySelector<HTMLTextAreaElement>('[data-orbitpm-aris-create-hint]')!,
      {
        target: { value: 'Model only the renewal sub-process, ignore the appendix on page 9.' }
      }
    )

    submit()
    await waitFor(() => expect(harness.created.length).toBe(1))

    // Two physical requests: the invalid first reply forced one repair turn,
    // and the PDF must not ride along on it (§16.6 step 5).
    expect(harness.requests).toHaveLength(2)
    const first = harness.requests[0]!
    expect(first.attachment?.kind).toBe('pdf')
    expect(first.attachment?.mediaType).toBe('application/pdf')
    expect(first.attachment?.fileName).toBe('renewal-spec.pdf')
    expect(harness.requests[1]!.attachment).toBeUndefined()
    expect(harness.encoded).toHaveLength(1)

    // The document (PDF) instruction was used, not the image one, and the
    // hint rode along verbatim — no translation, no paraphrase.
    expect(first.user).toContain('The attached PDF may describe one process')
    expect(first.user).toContain(
      'Model only the renewal sub-process, ignore the appendix on page 9.'
    )
    expect(first.user).not.toContain('is a drawing of a business process')

    // A native ARIS model, built locally from logical ids — never BPMN.
    const xml = harness.created[0]!.xml
    expect(xml).toContain('<AML>')
    expect(xml).toContain('Model.Type="MT_EEPC"')
    expect(xml).not.toContain('bpmn:')
    expect(xml).not.toContain('omg.org/spec/BPMN')
    expect(statusText()).toContain('Created 2 models')
  })
})

describe('§16.2 — the Description tab PDF picker refuses a non-PDF file', () => {
  it('rejects an image chosen through the description-tab "Attach PDF" button and attaches nothing', async () => {
    const harness = renderPanel()
    // A vision-capable route is required so the rejection below is the
    // description-tab-specific "PDF only" refusal, not a generic
    // image-unsupported refusal from an image-blind default route.
    selectProvider('anthropic')
    chooseFile('input[accept="application/pdf,.pdf"]', imageFile('drawing.png', 'image/png'))

    expect(
      panel().querySelector('[data-orbitpm-aris-create-attachment-notice]')?.textContent
    ).toContain('Use the PDF/Picture tab for a drawing')

    // Nothing was attached: typing a description and submitting sends no attachment.
    fireEvent.change(panel().querySelector<HTMLTextAreaElement>('textarea')!, {
      target: { value: 'A permit request is received and reviewed.' }
    })
    submit()
    await waitFor(() => expect(harness.created.length).toBe(1))
    expect(harness.requests[0]!.attachment).toBeUndefined()
    expect(harness.encoded).toEqual([])
  })
})

describe('§4.3/§16.7 — cancellation on the PDF/Picture tab', () => {
  it('aborts a PDF-driven request in flight and creates nothing', async () => {
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const harness = renderPanel({ hold: () => gate })
    click('[data-orbitpm-aris-create-document-tab]')
    chooseFile(DOCUMENT_FILE_INPUT, pdfFile())
    submit()

    const cancelButton = await waitFor(() => {
      const node = panel().querySelector<HTMLButtonElement>('[data-orbitpm-aris-create-cancel]')
      if (!node) throw new Error('cancel control not rendered')
      return node
    })
    fireEvent.click(cancelButton)
    // The held reply now resolves after cancellation; it must be discarded.
    release()

    await waitFor(() => expect(statusText()).toContain('cancelled'))
    expect(harness.created).toEqual([])
  })
})

describe('§16.6 M7 — PDFs are GATED on image-only models, with a one-click switch', () => {
  it('offers a switch to a pdf-capable model when a PDF is picked on the image-only qwen route', () => {
    renderPanel()
    // qwen3-vl is vision but PDF-gated (the ZDR-leak gate) — a PDF must never
    // reach it.
    selectModel('qwen/qwen3-vl-235b-a22b-instruct')
    expect(getLiteModelCapabilities('openrouter', 'qwen/qwen3-vl-235b-a22b-instruct').pdf).toBe(
      false
    )
    click('[data-orbitpm-aris-create-document-tab]')
    chooseFile(DOCUMENT_FILE_INPUT, pdfFile('spec.pdf'))

    // The capability rejection is surfaced, and a switch is offered.
    expect(noticeText()).toContain('cannot accept a PDF')
    const expected = firstLiteModelForAttachment('openrouter', 'pdf')!
    expect(getLiteModelCapabilities('openrouter', expected).pdf).toBe(true)
    const button = switchButton()
    expect(button).not.toBeNull()
    expect(button!.textContent).toContain(expected)

    // Clicking adopts the suggested model and the PDF becomes accepted.
    fireEvent.click(button!)
    expect(modelValue()).toBe(expected)
    expect(noticeText()).toContain('Attached spec.pdf')
    expect(switchButton()).toBeNull()
  })

  it('offers a switch to an image-capable model when a PNG is picked on the text-only glm route', () => {
    renderPanel()
    // z-ai/glm-5.2 is the default OpenRouter route — text-only (no images).
    expect(getLiteModelCapabilities('openrouter', 'z-ai/glm-5.2').images).toBe(false)
    click('[data-orbitpm-aris-create-document-tab]')
    chooseFile(DOCUMENT_FILE_INPUT, imageFile('flow.png', 'image/png'))

    expect(noticeText()).toContain('cannot accept a picture')
    const expected = firstLiteModelForAttachment('openrouter', 'image')!
    expect(getLiteModelCapabilities('openrouter', expected).images).toBe(true)
    const button = switchButton()
    expect(button).not.toBeNull()
    expect(button!.textContent).toContain(expected)

    fireEvent.click(button!)
    expect(modelValue()).toBe(expected)
    expect(noticeText()).toContain('Attached flow.png')
    expect(switchButton()).toBeNull()
  })
})

describe('privacy — attaching a document sends nothing until the user submits', () => {
  it('does not call the provider merely because a file is attached on the PDF/Picture tab', () => {
    const harness = renderPanel()
    click('[data-orbitpm-aris-create-document-tab]')
    chooseFile(DOCUMENT_FILE_INPUT, pdfFile())

    // No consent gate: with a file attached, submit is enabled — but no request
    // is made until the user actually presses it.
    const submitButton = panel().querySelector<HTMLButtonElement>(
      '[data-orbitpm-aris-create-submit]'
    )!
    expect(submitButton.disabled).toBe(false)
    expect(harness.requests).toEqual([])
    expect(harness.created).toEqual([])
  })
})

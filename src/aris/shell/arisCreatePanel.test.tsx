// @vitest-environment jsdom

/**
 * The mounted §16.1 Create surface: three tabs, both Description-tab
 * attachment kinds, the PDF/Picture tab, and the §16.7 placement rules.
 *
 * Every provider call is injected (`callProvider`), as are DOCX extraction and
 * attachment encoding, so this suite makes no network request and never needs
 * a Worker or a FileReader.
 */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ArisGenerationPanel } from '../../ArisGenerationPanel'
import { buildMinimalValidDraft } from '../ai/testFixtures'
import { resetSessionKeysForTests, setKey } from '../../ai/keys'
import { resetProviderSelectionForTests } from '../../ai/providerSelection'
import type { GenAttachment } from '../../ai/pdf'
import type { ArisAiGenerationRequest } from './arisAiGeneration'

const MIB = 1024 * 1024

interface Harness {
  readonly created: { name: string; xml: string }[]
  readonly downloads: { fileName: string; bytes: Uint8Array; mimeType: string }[]
  readonly requests: ArisAiGenerationRequest[]
  readonly encoded: File[]
}

function pdfFile(name = 'process.pdf', size = MIB): File {
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
    workspaceId?: string | null
    onSend?: (request: ArisAiGenerationRequest) => void
    onContinueInChat?: () => void
    /** Awaited inside the injected provider call, to hold a request in flight. */
    hold?: () => Promise<void>
  } = {}
): Harness & { rerenderWorkspace: (workspaceId: string | null) => void } {
  const harness: Harness = { created: [], downloads: [], requests: [], encoded: [] }
  const replies = options.replies ?? [JSON.stringify(buildMinimalValidDraft())]
  let index = 0

  const props = (workspaceId: string | null | undefined): JSX.Element => (
    <ArisGenerationPanel
      workspaceId={workspaceId}
      onCreateModel={(input) => {
        harness.created.push(input)
      }}
      onDownloadFile={(fileName, bytes, mimeType) => {
        harness.downloads.push({ fileName, bytes, mimeType })
      }}
      onOpenAssistant={() => undefined}
      onOpenSettings={() => undefined}
      {...(options.onContinueInChat ? { onContinueInChat: options.onContinueInChat } : {})}
      parseDocx={async () => 'Extracted DOCX body text.'}
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
        options.onSend?.(request)
        if (options.hold) await options.hold()
        const reply = replies[Math.min(index, replies.length - 1)]!
        index += 1
        return reply
      }}
    />
  )

  const view = render(props(options.workspaceId))
  return {
    ...harness,
    rerenderWorkspace: (workspaceId) => view.rerender(props(workspaceId))
  }
}

function panel(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-orbitpm-aris-create]')!
}

function click(selector: string): void {
  fireEvent.click(panel().querySelector<HTMLElement>(selector)!)
}

function submit(): void {
  fireEvent.click(panel().querySelector<HTMLButtonElement>('[data-orbitpm-aris-create-submit]')!)
}

function typeDescription(text: string): void {
  fireEvent.change(panel().querySelector<HTMLTextAreaElement>('textarea')!, {
    target: { value: text }
  })
}

function chooseFile(selector: string, file: File): void {
  const input = panel().querySelector<HTMLInputElement>(selector)!
  fireEvent.change(input, { target: { files: [file] } })
}

function statusText(): string {
  return panel().querySelector<HTMLElement>('[role="status"]')?.textContent ?? ''
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  resetSessionKeysForTests()
  resetProviderSelectionForTests()
  localStorage.clear()
})

describe('§16.1 — three Create tabs', () => {
  it('offers Description, PDF/Picture and Excel', () => {
    renderPanel()
    const tabs = Array.from(panel().querySelectorAll('[role="tab"]')).map(
      (node) => node.textContent
    )
    expect(tabs).toEqual(['Description', 'PDF / Picture', 'Excel'])
  })

  it('shows the document picker and the optional hint on the PDF/Picture tab', () => {
    renderPanel()
    click('[data-orbitpm-aris-create-document-tab]')
    expect(panel().querySelector('[data-orbitpm-aris-create-document-open]')).not.toBeNull()
    expect(panel().querySelector('[data-orbitpm-aris-create-hint]')).not.toBeNull()
    // Nothing can be sent before a document is attached.
    expect(
      panel().querySelector<HTMLButtonElement>('[data-orbitpm-aris-create-submit]')!.disabled
    ).toBe(true)
  })
})

describe('§16.2 — DOCX is extracted locally and never uploaded', () => {
  it('fences the extracted text into the prompt and sends no attachment', async () => {
    const harness = renderPanel()
    typeDescription('A permit request is received and reviewed.')
    chooseFile('input[accept*=".docx"]', new File([new Uint8Array([1])], 'process.docx'))

    await waitFor(() =>
      expect(
        panel().querySelector('[data-orbitpm-aris-create-attachment-notice]')?.textContent
      ).toContain('extracted on this device')
    )

    submit()
    await waitFor(() => expect(harness.created.length).toBe(1))

    expect(harness.encoded).toEqual([])
    const request = harness.requests[0]!
    expect(request.attachment).toBeUndefined()
    expect(request.user).toContain('Extracted DOCX body text.')
    expect(request.user).toContain('UNTRUSTED DATA')
  })
})

describe('§16.2/§16.3 — the PDF capability gate', () => {
  it('locks a PDF to Claude Opus 4.8 even when an unreviewed model is selected (P13 supersedes the unverified rejection)', () => {
    renderPanel()
    // The default OpenRouter route exposes a free-text model id (allowCustomModel),
    // so an unreviewed id is typed directly the way a drifted registry entry would.
    const modelInput = panel().querySelector<HTMLInputElement>('[data-orbitpm-aris-create-model]')!
    fireEvent.change(modelInput, { target: { value: 'someone/unreviewed-model' } })

    chooseFile('input[accept="application/pdf,.pdf"]', pdfFile())

    // WITHOUT the P13 lock this PDF would be rejected as "not a reviewed model".
    // The lock forces the create-from-PDF route to Claude Opus 4.8, so the PDF is
    // accepted and the picker is locked to that model — a PDF can never be sent
    // on the unreviewed (or any non-Opus) model.
    const notice = panel().querySelector(
      '[data-orbitpm-aris-create-attachment-notice]'
    )?.textContent
    expect(notice).toContain('process.pdf')
    expect(notice).not.toContain('not a reviewed model')
    const locked = panel().querySelector<HTMLInputElement>(
      'input[data-orbitpm-aris-create-model][data-orbitpm-aris-create-pdf-locked]'
    )
    expect(locked).not.toBeNull()
    expect(locked!.disabled).toBe(true)
    expect(locked!.value).toContain('Claude Opus 4.8')
    expect(panel().querySelector('[data-orbitpm-aris-create-pdf-lock]')?.textContent).toContain(
      'Claude Opus 4.8'
    )
  })

  it('refuses an oversized PDF at the 20 MiB boundary before reading a byte', () => {
    const harness = renderPanel()
    chooseFile('input[accept="application/pdf,.pdf"]', pdfFile('huge.pdf', 20 * MIB + 1))

    expect(
      panel().querySelector('[data-orbitpm-aris-create-attachment-notice]')?.textContent
    ).toContain('20.0 MB')
    expect(harness.encoded).toEqual([])
  })

  it('refuses a GIF on the Gemini route from the PDF/Picture tab', () => {
    renderPanel()
    click('[data-orbitpm-aris-create-document-tab]')
    fireEvent.change(
      panel().querySelector<HTMLSelectElement>('[data-orbitpm-aris-create-provider]')!,
      { target: { value: 'gemini' } }
    )
    chooseFile('input[accept*="image/gif"]', imageFile('drawing.gif', 'image/gif'))

    expect(
      panel().querySelector('[data-orbitpm-aris-create-attachment-notice]')?.textContent
    ).toContain('GIF is accepted only on verified provider and model routes')
    expect(
      panel().querySelector<HTMLButtonElement>('[data-orbitpm-aris-create-submit]')!.disabled
    ).toBe(true)
  })
})

describe('§16.6 — description + PDF produces a native ARIS model', () => {
  it('sends the attachment on the first request only and builds AML locally', async () => {
    const harness = renderPanel({
      replies: ['not json at all', JSON.stringify(buildMinimalValidDraft())]
    })
    typeDescription('The attached specification describes the permit process.')
    chooseFile('input[accept="application/pdf,.pdf"]', pdfFile())

    expect(
      panel().querySelector('[data-orbitpm-aris-create-attachment-notice]')?.textContent
    ).toContain('process.pdf')

    submit()
    await waitFor(() => expect(harness.created.length).toBe(1))

    // Two physical requests: the first carried the PDF, the repair turn did not.
    expect(harness.requests).toHaveLength(2)
    expect(harness.requests[0]!.attachment?.fileName).toBe('process.pdf')
    expect(harness.requests[0]!.attachment?.mediaType).toBe('application/pdf')
    expect(harness.requests[1]!.attachment).toBeUndefined()
    expect(harness.requests[1]!.user).toContain('This is a text-only repair turn')
    // The file was encoded exactly once.
    expect(harness.encoded).toHaveLength(1)

    // A native ARIS model, built locally from logical ids — never from the AI.
    const xml = harness.created[0]!.xml
    expect(xml).toContain('<AML>')
    expect(xml).toContain('Model.Type="MT_EEPC"')
    expect(xml).toContain('ObjDef.ID="ObjDef.evt-start"')
    expect(xml).toContain('ObjOcc.ID="ObjOcc.evt-start"')
    expect(xml).toContain('<Position Pos.X="240"')
    expect(statusText()).toContain('Created 2 models')
  })

  it('generates from a picture on the PDF/Picture tab, hint included verbatim', async () => {
    const harness = renderPanel()
    click('[data-orbitpm-aris-create-document-tab]')
    // The curated OpenRouter default is document-only; pick a vision route.
    fireEvent.change(
      panel().querySelector<HTMLSelectElement>('[data-orbitpm-aris-create-provider]')!,
      { target: { value: 'anthropic' } }
    )
    chooseFile('input[accept*="image/png"]', imageFile('whiteboard.png', 'image/png'))
    fireEvent.change(panel().querySelector<HTMLTextAreaElement>('textarea')!, {
      target: { value: 'الرسم يُقرأ من اليمين إلى اليسار' }
    })

    submit()
    await waitFor(() => expect(harness.created.length).toBe(1))

    const request = harness.requests[0]!
    expect(request.attachment?.kind).toBe('image')
    expect(request.attachment?.mediaType).toBe('image/png')
    expect(request.user).toContain('الرسم يُقرأ من اليمين إلى اليسار')
    expect(harness.created[0]!.xml).toContain('Model.Type="MT_EEPC"')
  })
})

describe('§4.3 — a transport failure is reported without burning a repair turn', () => {
  it('stops after one request and says so', async () => {
    const harness = renderPanel({
      onSend: () => {
        throw Object.assign(new Error('anthropic: HTTP 429'), { transport: true as const })
      }
    })
    typeDescription('A permit request is received and reviewed.')
    submit()

    await waitFor(() => expect(statusText()).toContain('no repair attempt was used'))
    expect(harness.requests).toHaveLength(1)
    expect(harness.created).toEqual([])
  })
})

describe('§16.7 — placement and recovery', () => {
  it('refuses to write into a workspace that changed mid-request and keeps the AML', async () => {
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const harness = renderPanel({
      workspaceId: 'directory:Docs',
      hold: () => gate
    })
    typeDescription('A permit request is received and reviewed.')
    submit()

    // The request is now in flight; the user switches workspace before it lands.
    harness.rerenderWorkspace('directory:Other')
    release()

    await waitFor(() => expect(statusText()).toContain('The workspace changed'))
    expect(harness.created).toEqual([])

    // The generated AML is still recoverable.
    click('[data-orbitpm-aris-create-recovery]')
    expect(harness.downloads).toHaveLength(1)
    expect(harness.downloads[0]!.fileName).toBe('aris-model-recovery.aml')
    expect(harness.downloads[0]!.mimeType).toBe('application/xml')
    expect(new TextDecoder().decode(harness.downloads[0]!.bytes)).toContain('<AML>')
  })

  it('cancelling aborts the request and creates nothing', async () => {
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const harness = renderPanel({ hold: () => gate })
    typeDescription('A permit request is received and reviewed.')
    submit()

    // Cancel while the provider call is in flight, then let it resolve: the
    // reply arrives, and is thrown away rather than placed.
    const cancelButton = await waitFor(() => {
      const node = panel().querySelector<HTMLButtonElement>('[data-orbitpm-aris-create-cancel]')
      if (!node) throw new Error('cancel control not rendered')
      return node
    })
    fireEvent.click(cancelButton)
    release()

    await waitFor(() => expect(statusText()).toContain('cancelled'))
    expect(harness.created).toEqual([])
  })
})

describe('authorized product change #1 — the create path has no consent gate', () => {
  it('enables submit with a description present and renders no consent control', () => {
    renderPanel()
    // The consent checkbox, exact-outbound preview, and include-context/redact
    // toggles are removed from this create path.
    expect(panel().querySelector('[data-orbitpm-aris-create-consent]')).toBeNull()
    expect(panel().querySelector('[data-orbitpm-aris-create-preview]')).toBeNull()
    expect(panel().querySelector('[data-orbitpm-aris-create-include-context]')).toBeNull()

    typeDescription('A permit request is received and reviewed.')
    expect(
      panel().querySelector<HTMLButtonElement>('[data-orbitpm-aris-create-submit]')!.disabled
    ).toBe(false)
  })
})

describe('authorized product change #2 — generation always uses auto-detect', () => {
  it('sends the auto-detect model type and no workspace context in the prompt', async () => {
    const harness = renderPanel()
    typeDescription('A permit request is received and reviewed.')
    submit()
    await waitFor(() => expect(harness.created.length).toBe(1))

    const request = harness.requests[0]!
    expect(request.user).toContain('auto-detect the most fitting supported model type')
    expect(request.user).not.toContain('Workspace context')
  })
})

describe('§16 — provider picker marks configured providers', () => {
  it("suffixes a provider option with ' ✓' when a key is stored", () => {
    resetSessionKeysForTests()
    setKey('openrouter', 'sk-test-key')
    renderPanel()
    const option = panel().querySelector<HTMLOptionElement>(
      '[data-orbitpm-aris-create-provider] option[value="openrouter"]'
    )!
    expect(option.textContent?.endsWith(' ✓')).toBe(true)
  })
})

describe('§16 — continue in chat after a successful generation', () => {
  it('invokes onContinueInChat from the success box CTA', async () => {
    let continued = 0
    const harness = renderPanel({ onContinueInChat: () => (continued += 1) })
    typeDescription('A permit request is received and reviewed.')
    submit()
    await waitFor(() => expect(harness.created.length).toBe(1))

    const cta = await waitFor(() => {
      const node = panel().querySelector<HTMLButtonElement>(
        '[data-orbitpm-aris-create-continue-chat]'
      )
      if (!node) throw new Error('continue-in-chat CTA not rendered')
      return node
    })
    fireEvent.click(cta)
    expect(continued).toBe(1)
  })
})

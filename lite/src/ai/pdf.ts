// PDF → BPMN helpers for Lite. Per the verified ingestion notes
// (scratchpad/prep/pdf-ingestion.md): send the PDF natively to whichever
// provider is selected (Anthropic `document` block / Gemini `inlineData` part /
// OpenRouter `file` part). We deliberately do NOT bundle pdfjs-dist (~500 KB
// gzip, text-only, blind to scanned/diagram PDFs) — the providers read PDFs
// with vision, which also makes scanned / Arabic / RTL / flowchart PDFs work.

import type { LiteProviderId } from './providersLite'
import { t } from '../i18n'

/** A PDF selected by the user, encoded for a provider request. */
export interface PdfAttachment {
  /** Base64 of the raw bytes, WITHOUT the `data:...;base64,` prefix. */
  base64: string
  /** Always `application/pdf` here. */
  mediaType: string
  /** Original file name (used for the OpenRouter `file` part + UI). */
  fileName: string
  /** Raw byte size (for the size-gate message). */
  sizeBytes: number
}

// Client-side size gates. Both Anthropic and Gemini limits apply to the WHOLE
// request payload; base64 inflates bytes ~33%, so we gate on the RAW file size
// conservatively below the encoded ceiling. (Anthropic 32 MB request ⇒ ~23 MB
// raw; Gemini's inline-PDF path capped at 32 MiB here — an aligned safety margin
// against tab memory pressure, since the base64 + data-URL + serialized-body
// copies stack up; OpenRouter unpublished ⇒ same gate as Anthropic since it
// forwards downstream.)
export const PDF_SIZE_LIMITS: Record<LiteProviderId, number> = {
  anthropic: 20 * 1024 * 1024,
  openrouter: 20 * 1024 * 1024,
  gemini: 32 * 1024 * 1024,
  // Custom endpoints have no verified PDF path — see providersLite.supportsPdf.
  custom: 0
}

// Above this RAW size a PDF is still accepted, but a soft heads-up is shown:
// base64 encoding inflates it ~33% and it may be slow or brush provider limits.
export const PDF_SOFT_WARN_BYTES = 15 * 1024 * 1024

export interface PdfSizeCheck {
  ok: boolean
  /** Set only when `ok` is false — a hard, provider-aware rejection reason. */
  message?: string
  /** Set when `ok` is true but the file is large enough to warrant a heads-up. */
  warning?: string
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Gate a selected PDF's raw size against the chosen provider's limit. Returns
 * `{ ok: true }` when acceptable (optionally with a soft `warning` for large but
 * allowed files), else `{ ok:false, message }` with a friendly, provider-aware
 * explanation (which other provider to try).
 */
export function checkPdfSize(providerId: LiteProviderId, sizeBytes: number): PdfSizeCheck {
  const limit = PDF_SIZE_LIMITS[providerId]
  if (limit <= 0) {
    return {
      ok: false,
      message: t('ai.pdf.sizeGate.customUnavailable')
    }
  }
  if (sizeBytes > limit) {
    const alt =
      providerId === 'gemini'
        ? t('ai.pdf.sizeGate.alt.splitOnly')
        : t('ai.pdf.sizeGate.alt.tryGeminiOrSplit')
    return {
      ok: false,
      message: t('ai.pdf.sizeGate.overLimit', { size: mb(sizeBytes), limit: mb(limit), alt })
    }
  }
  if (sizeBytes > PDF_SOFT_WARN_BYTES) {
    return { ok: true, warning: t('ai.pdf.sizeGate.softWarn', { size: mb(sizeBytes) }) }
  }
  return { ok: true }
}

/**
 * Read a File into a base64 string (no data: prefix) via FileReader — encoded
 * exactly ONCE here. The single returned string is what every provider builder
 * reuses verbatim (`attachment.base64`); none of them re-encode or re-slice it,
 * so a large PDF is held as base64 once rather than in several stacked copies
 * (Codex M4). Browser-only; kept thin so the payload builders (which take the
 * base64 string) stay pure and unit-testable in node.
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Unexpected FileReader result'))
        return
      }
      // result is `data:application/pdf;base64,XXXX` — return the payload after
      // the first comma (single slice; the data-URL string is released as soon
      // as this resolves).
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}

/**
 * Build the hint-aware instruction that is prepended to the create_bpmn prompt
 * for the PDF path. The PDF bytes ride along as a provider-native document part
 * (see browserAi payload builders); this text tells the model how to choose a
 * process from the document. `hint` is passed VERBATIM (Arabic-safe — no
 * translation, no language flag) so RTL / mixed-language hints work as-is.
 */
export function buildPdfInstruction(hint: string): string {
  const trimmed = hint.trim()
  const hintLine = trimmed
    ? `The user specifically wants this process modeled: "${trimmed}". If the document contains multiple processes, use this hint to pick the right one — even if it is only loosely worded.`
    : 'The user did not specify which process to model — use your best judgement as described below.'
  return (
    'The attached PDF may describe one process, multiple processes, or contain sections ' +
    'unrelated to any process (cover pages, appendices, glossaries).\n\n' +
    hintLine +
    '\n\nRead the document (including any diagrams, flowcharts, or tables it contains) and ' +
    'identify the single business process to model. If the document describes multiple candidate ' +
    'processes and no hint was given above, choose the most complete and clearly-described one.'
  )
}

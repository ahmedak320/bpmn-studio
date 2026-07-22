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
// raw; Gemini 50 MB inline PDF cap; OpenRouter unpublished ⇒ same gate as
// Anthropic since it forwards downstream.)
export const PDF_SIZE_LIMITS: Record<LiteProviderId, number> = {
  anthropic: 20 * 1024 * 1024,
  openrouter: 20 * 1024 * 1024,
  gemini: 40 * 1024 * 1024,
  // Custom endpoints have no verified PDF path — see providersLite.supportsPdf.
  custom: 0
}

export interface PdfSizeCheck {
  ok: boolean
  message?: string
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Gate a selected PDF's raw size against the chosen provider's limit. Returns
 * `{ ok: true }` when acceptable, else `{ ok:false, message }` with a friendly,
 * provider-aware explanation (which other provider to try).
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
  return { ok: true }
}

/**
 * Read a File into a base64 string (no data: prefix) via FileReader. Browser-
 * only; kept thin so the payload builders (which take the base64 string) stay
 * pure and unit-testable in node.
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
      // result is `data:application/pdf;base64,XXXX` — strip the prefix.
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

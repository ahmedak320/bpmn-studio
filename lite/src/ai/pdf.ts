// PDF/image → BPMN helpers for Lite. Per the verified ingestion notes
// (scratchpad/prep/pdf-ingestion.md): send the PDF natively to whichever
// provider is selected (Anthropic `document` block / Gemini `inlineData` part /
// OpenRouter `file` part). We deliberately do NOT bundle pdfjs-dist (~500 KB
// gzip, text-only, blind to scanned/diagram PDFs) — the providers read PDFs
// with vision, which also makes scanned / Arabic / RTL / flowchart PDFs work.
// The same native-vision path now also carries IMAGES of process drawings
// (photos/screenshots of flowcharts, whiteboards, scanned diagrams): Anthropic
// `image` block / Gemini `inlineData` part / OpenRouter `image_url` part.

import type { LiteProviderId } from './providersLite'
import { t } from '../i18n'

/** What the user attached: a PDF document or an image of a process drawing. */
export type AttachmentKind = 'pdf' | 'image'

/** A PDF or image selected by the user, encoded for a provider request. */
export interface GenAttachment {
  /** Discriminates the provider-native part to build (document vs image). */
  kind: AttachmentKind
  /** Base64 of the raw bytes, WITHOUT the `data:...;base64,` prefix. */
  base64: string
  /** `application/pdf`, or one of {@link ACCEPTED_IMAGE_TYPES} for images. */
  mediaType: string
  /** Original file name (used for the OpenRouter `file` part + UI). */
  fileName: string
  /** Raw byte size (for the size-gate message). */
  sizeBytes: number
}

/** Back-compat alias — the pre-image name for {@link GenAttachment}. */
export type PdfAttachment = GenAttachment

// Image mime types the "From PDF / image" tab accepts. All four are LIVE-VERIFIED
// (2026-07-23) as accepted image inputs by Anthropic
// (platform.claude.com/docs/en/build-with-claude/vision — JPEG/PNG/GIF/WebP) and
// OpenRouter (docs/guides/overview/multimodal/image-understanding — png/jpeg/
// webp/gif). Gemini's documented list (ai.google.dev/gemini-api/docs/
// image-understanding) is PNG/JPEG/WebP/HEIC/HEIF — GIF is UNdocumented there,
// so a GIF sent to Gemini may be rejected server-side; we still accept it
// client-side and let the provider error surface if so.
export const ACCEPTED_IMAGE_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif'
]

/**
 * Map a file name's extension to its image mime type — the fallback for
 * OS/browser combinations that hand us a File with an empty `type`. Pure and
 * node-testable. Returns null for anything that isn't an accepted image.
 */
export function imageMediaTypeFromName(name: string): string | null {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim())
  switch ((m?.[1] ?? '').toLowerCase()) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    default:
      return null
  }
}

// Client-side size gates. The provider limits apply to the WHOLE request
// payload, and encoding STACKS several copies of the file in tab memory: base64
// inflates the bytes ~33%, then that string is embedded in a data-URL / JSON
// part and the whole body is serialized — so a raw N-byte PDF transiently costs
// several×N. We therefore gate the RAW file size well below the encoded ceiling.
// Gemini's inline-PDF path is capped at 20 MiB here (lowered from 32 MiB —
// Codex ORIG-4) to align all three browser providers on one conservative,
// memory-safe cap; OpenRouter forwards downstream so it shares Anthropic's gate.
export const PDF_SIZE_LIMITS: Record<LiteProviderId, number> = {
  anthropic: 20 * 1024 * 1024,
  openrouter: 20 * 1024 * 1024,
  gemini: 20 * 1024 * 1024,
  // Custom endpoints have no verified PDF path — see providersLite.supportsPdf.
  custom: 0
}

// Client-side RAW-size gates for images, one per provider. LIVE-VERIFIED
// against provider docs on 2026-07-23:
//  - Anthropic: max 10 MB base64-ENCODED per image on the direct API (32 MB
//    whole request); 5 MB on Bedrock/Google Cloud
//    [platform.claude.com/docs/en/build-with-claude/vision → Request limits].
//    A 5 MiB RAW cap encodes to ~7 MB base64 — comfortably under the 10 MB
//    ceiling, and also inside the stricter partner-platform figure.
//  - Gemini: inline (`inlineData`) requests cap the WHOLE request — prompt text
//    plus base64 bytes — at 20 MB; anything larger needs the Files API, which
//    Lite deliberately doesn't use (extra upload round-trip + stored state)
//    [ai.google.dev/gemini-api/docs/image-understanding]. A 12 MiB RAW cap
//    encodes to ~16 MiB base64, leaving prompt/JSON headroom under 20 MB.
//  - OpenRouter: documents NO image cap of its own ("varies per provider and
//    per model") and forwards the request downstream, so — exactly like the
//    PDF caps above — it shares Anthropic's gate, the strictest common vision
//    downstream [openrouter.ai/docs/guides/overview/multimodal/
//    image-understanding].
//  - Custom: no image path (providersLite.supportsImages is false).
export const IMAGE_SIZE_LIMITS: Record<LiteProviderId, number> = {
  anthropic: 5 * 1024 * 1024,
  openrouter: 5 * 1024 * 1024,
  gemini: 12 * 1024 * 1024,
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

/** Kind-neutral alias — checkAttachmentSize returns the same shape. */
export type AttachmentSizeCheck = PdfSizeCheck

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
    // All browser providers now share the 20 MiB cap, so the only useful advice
    // is to split the document (no "try Gemini — larger limit" anymore).
    const alt = t('ai.pdf.sizeGate.alt.splitOnly')
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
 * Kind-aware size gate generalizing {@link checkPdfSize}. For `kind === 'pdf'`
 * it DELEGATES to checkPdfSize so the PDF behavior (limits, messages, the
 * 15 MiB soft warning) stays byte-identical. For `kind === 'image'` it applies
 * the per-provider {@link IMAGE_SIZE_LIMITS}: a provider without an image path
 * (custom) gets the generic unsupported-attachments message, an over-limit
 * image gets a compress/crop rejection, and there is no soft-warn tier (every
 * image cap already sits below the PDF soft-warn threshold).
 */
export function checkAttachmentSize(
  providerId: LiteProviderId,
  kind: AttachmentKind,
  sizeBytes: number
): AttachmentSizeCheck {
  if (kind === 'pdf') return checkPdfSize(providerId, sizeBytes)
  const limit = IMAGE_SIZE_LIMITS[providerId]
  if (limit <= 0) {
    return { ok: false, message: t('ai.attach.unsupportedProvider') }
  }
  if (sizeBytes > limit) {
    return {
      ok: false,
      message: t('ai.image.sizeGate.overLimit', { size: mb(sizeBytes), limit: mb(limit) })
    }
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
      // result is `data:<mime>;base64,XXXX` — return the payload after the
      // first comma (single slice; the data-URL string is released as soon
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

/**
 * Image counterpart of {@link buildPdfInstruction}: the hint-aware instruction
 * prepended to the create_bpmn prompt when the attachment is a process DRAWING
 * (flowchart, BPMN/swimlane diagram, whiteboard photo, scanned or hand-drawn
 * sketch). The image bytes ride along as a provider-native image part; this
 * text tells the model how to read the drawing. `hint` is passed VERBATIM
 * (Arabic-safe — no translation, no language flag) so RTL / mixed-language
 * hints work as-is.
 */
export function buildImageInstruction(hint: string): string {
  const trimmed = hint.trim()
  const hintLine = trimmed
    ? `The user specifically wants this process modeled: "${trimmed}". If the drawing contains multiple processes, use this hint to pick the right one — even if it is only loosely worded.`
    : 'The user did not specify which process to model — use your best judgement as described below.'
  return (
    'The attached image is a drawing of a business process — it may be a flowchart, a BPMN or ' +
    'swimlane diagram, a whiteboard photo, or a scanned/hand-drawn sketch. Labels may be in ' +
    'Arabic (right-to-left) or a mix of languages — read them as-is and keep them verbatim in ' +
    'the model.\n\n' +
    hintLine +
    '\n\nRead the drawing carefully: follow the arrows to determine the sequence of steps and ' +
    'where the flow branches or merges, and use swimlanes, columns, or color groupings (if ' +
    'present) to identify the roles or departments performing each step. If parts are illegible, ' +
    'infer the most plausible step from the surrounding context instead of inventing unrelated ' +
    'content. If the image shows multiple candidate processes and no hint was given above, ' +
    'choose the most complete and clearly-drawn one.'
  )
}

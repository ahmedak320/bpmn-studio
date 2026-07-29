/**
 * Attachment gating for "Create with AI" (plan §16.2 and §16.3).
 *
 * Three attachment shapes reach the Create surface, and they are NOT
 * interchangeable:
 *
 *  - **DOCX** (§16.2, Description tab) — extracted **locally**. The bytes
 *    never leave the tab: {@link extractArisAiDocxText} hands them to the
 *    retained inline worker parser and only the extracted text is ever put
 *    into a prompt, fenced as untrusted data by `buildArisAiPrompt`.
 *  - **PDF** (§16.2 Description tab, §16.3 PDF/Picture tab) — sent
 *    **natively**, and only when the exact provider *and model* are verified
 *    to accept a document.
 *  - **Image** (§16.3) — PNG/JPEG/WebP always; GIF only on a route verified
 *    for it.
 *
 * Nothing here re-implements the retained limits: {@link checkArisAiAttachment}
 * composes `isAttachmentMediaTypeSupported` (provider/model capability) and
 * `checkAttachmentSize` (`PDF_SIZE_LIMITS` 20 MiB, `PDF_SOFT_WARN_BYTES`
 * 15 MiB, `IMAGE_SIZE_LIMITS` 5/5/12 MiB) from `src/ai/pdf.ts`. It only fixes
 * the ORDER the plan requires — §16.6 step 1 (capability) strictly before
 * step 2 (type/size) — so an unsupported route is reported as such instead of
 * being masked by a size complaint, and so no byte is ever read off disk for a
 * file the selected model could not have accepted anyway.
 */

import {
  ACCEPTED_IMAGE_TYPES,
  checkAttachmentSize,
  fileToBase64,
  imageMediaTypeFromName,
  isAttachmentMediaTypeSupported,
  type AttachmentKind,
  type GenAttachment
} from '../../ai/pdf'
import {
  getLiteModelCapabilities,
  getLiteProvider,
  type LiteProviderId
} from '../../ai/providersLite'
import { tk } from './shellI18n'

export type ArisAiAttachmentKind = AttachmentKind

/** The subset of `File` this module needs — keeps the checks node-testable. */
export interface ArisAiAttachmentFileInfo {
  readonly name: string
  readonly type: string
  readonly size: number
}

export type ArisAiAttachmentRejectionCode =
  | 'unsupported-type'
  | 'model-unverified'
  | 'pdf-unsupported'
  | 'image-unsupported'
  | 'gif-route'
  | 'too-large'

export interface ArisAiAttachmentAccepted {
  readonly ok: true
  readonly kind: ArisAiAttachmentKind
  readonly mediaType: string
  readonly fileName: string
  readonly sizeBytes: number
  /** Soft heads-up (the §16.3 "warning above 15 MiB" tier). Never blocking. */
  readonly warning?: string
}

export interface ArisAiAttachmentRejected {
  readonly ok: false
  readonly code: ArisAiAttachmentRejectionCode
  readonly message: string
}

export type ArisAiAttachmentCheck = ArisAiAttachmentAccepted | ArisAiAttachmentRejected

export const ARIS_AI_PDF_MEDIA_TYPE = 'application/pdf'

/**
 * Decide what a picked file *is*, before asking whether it may be sent.
 * `File.type` is authoritative when present; an empty/unknown type falls back
 * to the extension (some OS/browser combinations hand over a typeless File).
 */
export function classifyArisAiAttachmentFile(
  file: ArisAiAttachmentFileInfo
): { readonly kind: ArisAiAttachmentKind; readonly mediaType: string } | null {
  const declared = file.type.trim().toLowerCase()
  if (declared === ARIS_AI_PDF_MEDIA_TYPE) return { kind: 'pdf', mediaType: ARIS_AI_PDF_MEDIA_TYPE }
  if (ACCEPTED_IMAGE_TYPES.includes(declared)) return { kind: 'image', mediaType: declared }
  if (/\.pdf$/iu.test(file.name.trim())) {
    return { kind: 'pdf', mediaType: ARIS_AI_PDF_MEDIA_TYPE }
  }
  const byName = imageMediaTypeFromName(file.name)
  if (byName) return { kind: 'image', mediaType: byName }
  return null
}

function providerLabelFor(providerId: LiteProviderId): string {
  try {
    return getLiteProvider(providerId).label
  } catch {
    return providerId
  }
}

/**
 * §16.6 steps 1 and 2, in that order, for one picked file.
 *
 * Capability is checked against the EXACT provider/model pair that would send
 * the request. A model the registry has not reviewed fails closed
 * (`model-unverified`) rather than being optimistically tried.
 */
export function checkArisAiAttachment(input: {
  readonly providerId: LiteProviderId
  readonly modelId: string
  readonly file: ArisAiAttachmentFileInfo
}): ArisAiAttachmentCheck {
  const classified = classifyArisAiAttachmentFile(input.file)
  if (!classified) {
    return {
      ok: false,
      code: 'unsupported-type',
      message: tk(
        'aris.create.attachment.unsupportedType',
        'Only PDF, PNG, JPEG, WebP, and GIF files can be attached.'
      )
    }
  }

  // --- §16.6 step 1: exact provider/model capability ------------------------
  const capabilities = getLiteModelCapabilities(input.providerId, input.modelId)
  const provider = providerLabelFor(input.providerId)
  if (!capabilities.verified) {
    return {
      ok: false,
      code: 'model-unverified',
      message: tk(
        'aris.create.attachment.modelUnverified',
        '{model} is not a reviewed model for attachments on {provider}. Choose a reviewed model before attaching a file.',
        { model: input.modelId, provider }
      )
    }
  }
  if (
    !isAttachmentMediaTypeSupported(
      input.providerId,
      input.modelId,
      classified.kind,
      classified.mediaType
    )
  ) {
    if (classified.kind === 'pdf') {
      return {
        ok: false,
        code: 'pdf-unsupported',
        message: tk(
          'aris.create.attachment.pdfUnsupported',
          '{model} on {provider} cannot accept a PDF. Choose a model that reads documents, or describe the process in text instead.',
          { model: input.modelId, provider }
        )
      }
    }
    if (classified.mediaType === 'image/gif' && capabilities.images) {
      return {
        ok: false,
        code: 'gif-route',
        message: tk(
          'aris.create.attachment.gifUnsupported',
          'GIF is accepted only on verified provider and model routes. {model} on {provider} is not one of them; convert the picture to PNG, JPEG, or WebP.',
          { model: input.modelId, provider }
        )
      }
    }
    return {
      ok: false,
      code: 'image-unsupported',
      message: tk(
        'aris.create.attachment.imageUnsupported',
        '{model} on {provider} cannot accept a picture. Choose a vision-capable model.',
        { model: input.modelId, provider }
      )
    }
  }

  // --- §16.6 step 2: input type/size ---------------------------------------
  const size = checkAttachmentSize(input.providerId, classified.kind, input.file.size)
  if (!size.ok) {
    return {
      ok: false,
      code: 'too-large',
      message:
        size.message ??
        tk('aris.create.attachment.tooLarge', '{name} is too large to attach for {provider}.', {
          name: input.file.name,
          provider
        })
    }
  }

  return {
    ok: true,
    kind: classified.kind,
    mediaType: classified.mediaType,
    fileName: input.file.name,
    sizeBytes: input.file.size,
    ...(size.warning === undefined ? {} : { warning: size.warning })
  }
}

/** Encode an accepted attachment for the provider-native part. Browser-only. */
export async function encodeArisAiAttachment(
  file: File,
  accepted: ArisAiAttachmentAccepted,
  signal?: AbortSignal
): Promise<GenAttachment> {
  const base64 = await fileToBase64(file, signal)
  return {
    kind: accepted.kind,
    base64,
    mediaType: accepted.mediaType,
    fileName: accepted.fileName,
    sizeBytes: accepted.sizeBytes
  }
}

// --- DOCX: local extraction only ------------------------------------------

export interface ArisAiDocxExtraction {
  readonly fileName: string
  readonly text: string
  readonly characterCount: number
}

export type ArisAiDocxParser = (
  file: File,
  options: { readonly signal?: AbortSignal }
) => Promise<string>

/** True for a file the DOCX path accepts (mime or extension). */
export function isArisAiDocxFile(file: ArisAiAttachmentFileInfo): boolean {
  const declared = file.type.trim().toLowerCase()
  return (
    declared === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    /\.docx$/iu.test(file.name.trim())
  )
}

/**
 * Extract a DOCX's text **on this device**.
 *
 * The default parser is the retained inline worker (`parseDocxFileInWorker`),
 * imported lazily so a plain-node caller never pulls the worker bundle in. The
 * bytes are never encoded for a provider and never leave this function — only
 * the returned text can reach a prompt, and only fenced as untrusted data.
 */
export async function extractArisAiDocxText(
  file: File,
  options: { readonly signal?: AbortSignal; readonly parse?: ArisAiDocxParser } = {}
): Promise<ArisAiDocxExtraction> {
  const parse =
    options.parse ??
    (async (target, parseOptions) => {
      const { parseDocxFileInWorker } = await import('../../ai/browserDocxParser')
      return parseDocxFileInWorker(target, parseOptions)
    })
  const text = await parse(file, options.signal === undefined ? {} : { signal: options.signal })
  return { fileName: file.name, text, characterCount: text.length }
}

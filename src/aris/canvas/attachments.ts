/**
 * Attachments on object definitions — Plan Section 11.4
 * ("Add/download/remove attachment").
 *
 * ## Where an attachment lives
 *
 * There is no attachment command kind and no attachment field on
 * `ArisObjectDefinition`. Rather than invent a parallel store the writer lane
 * would not see, attachments are stored as ordinary ARIS attribute values under
 * a single OrbitPM-namespaced attribute type, `AT_ORBITPM_ATTACHMENT`. Each
 * value is a canonical JSON record, one attachment per value entry. That means:
 *
 * - adding/removing an attachment is a plain `setAttribute` command, so it is
 *   undoable, redoable and exportable like every other edit;
 * - the AML writer round-trips attachments for free, because it already writes
 *   attribute values;
 * - nothing outside this module needs to know the encoding.
 *
 * Payload bytes are base64 so the value stays a string. Only ASCII-safe JSON is
 * produced (numbers are integers, keys are sorted) so the value survives the
 * canonical-JSON revision encoder unchanged.
 */

import type { ArisAttributeValue, ArisWorkingDocument } from '../model/types'
import { readAttributeValues, setAttributeCommand } from './commandFactory'
import type { ArisCommandContext } from './commandFactory'
import type { ArisEditCommand } from '../model/commands'
import { AT_ORBITPM_ATTACHMENT } from './vocabulary'

export interface ArisAttachment {
  readonly id: string
  readonly fileName: string
  readonly mimeType: string
  readonly size: number
  /** Base64-encoded payload. */
  readonly dataBase64: string
}

export class ArisAttachmentError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ArisAttachmentError'
    this.code = code
  }
}

function encode(attachment: ArisAttachment): string {
  // Fixed key order keeps the encoded value byte-stable.
  return JSON.stringify({
    dataBase64: attachment.dataBase64,
    fileName: attachment.fileName,
    id: attachment.id,
    mimeType: attachment.mimeType,
    size: attachment.size
  })
}

function decode(text: string): ArisAttachment | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    if (
      typeof record.id !== 'string' ||
      typeof record.fileName !== 'string' ||
      typeof record.mimeType !== 'string' ||
      typeof record.size !== 'number' ||
      typeof record.dataBase64 !== 'string'
    ) {
      return null
    }
    return Object.freeze({
      id: record.id,
      fileName: record.fileName,
      mimeType: record.mimeType,
      size: record.size,
      dataBase64: record.dataBase64
    })
  } catch {
    return null
  }
}

/** Every attachment currently stored on a definition. */
export function listAttachments(
  document: ArisWorkingDocument,
  definitionId: string
): readonly ArisAttachment[] {
  const values = readAttributeValues(
    document,
    'objectDefinition',
    definitionId,
    AT_ORBITPM_ATTACHMENT
  )
  const attachments: ArisAttachment[] = []
  for (const value of values) {
    const attachment = decode(value.text)
    if (attachment) attachments.push(attachment)
  }
  return Object.freeze(attachments)
}

function toValues(attachments: readonly ArisAttachment[]): readonly ArisAttributeValue[] {
  return Object.freeze(
    attachments.map((attachment) =>
      Object.freeze({ localeId: attachment.id, text: encode(attachment) })
    )
  )
}

/** Build the command that adds (or replaces) an attachment. */
export function addAttachmentCommand(
  context: ArisCommandContext,
  document: ArisWorkingDocument,
  definitionId: string,
  attachment: ArisAttachment
): ArisEditCommand {
  if (!Number.isSafeInteger(attachment.size) || attachment.size < 0) {
    throw new ArisAttachmentError('invalid-size', 'Attachment size must be a non-negative integer.')
  }
  const existing = listAttachments(document, definitionId).filter(
    (entry) => entry.id !== attachment.id
  )
  return setAttributeCommand(
    context,
    document,
    'objectDefinition',
    definitionId,
    AT_ORBITPM_ATTACHMENT,
    toValues([...existing, attachment])
  )
}

/** Build the command that removes an attachment. */
export function removeAttachmentCommand(
  context: ArisCommandContext,
  document: ArisWorkingDocument,
  definitionId: string,
  attachmentId: string
): ArisEditCommand {
  const existing = listAttachments(document, definitionId)
  if (!existing.some((entry) => entry.id === attachmentId)) {
    throw new ArisAttachmentError(
      'unknown-attachment',
      `No attachment ${attachmentId} on ${definitionId}.`
    )
  }
  return setAttributeCommand(
    context,
    document,
    'objectDefinition',
    definitionId,
    AT_ORBITPM_ATTACHMENT,
    toValues(existing.filter((entry) => entry.id !== attachmentId))
  )
}

export interface ArisAttachmentDownload {
  readonly fileName: string
  readonly mimeType: string
  readonly bytes: Uint8Array
}

/**
 * Materialize an attachment for download.
 *
 * Returns bytes rather than triggering a browser download so the operation is
 * testable and so the shell decides how to deliver the file (Lite is a
 * single-file `file://` app and must not assume a download API).
 */
export function downloadAttachment(
  document: ArisWorkingDocument,
  definitionId: string,
  attachmentId: string
): ArisAttachmentDownload {
  const attachment = listAttachments(document, definitionId).find(
    (entry) => entry.id === attachmentId
  )
  if (!attachment) {
    throw new ArisAttachmentError(
      'unknown-attachment',
      `No attachment ${attachmentId} on ${definitionId}.`
    )
  }
  return Object.freeze({
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    bytes: base64ToBytes(attachment.dataBase64)
  })
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

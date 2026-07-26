// Client-side .docx → plain-text extraction for the "Description document"
// attachment (AiPanelLite's description tab). A .docx is a zip (OPC package)
// whose main body lives in `word/document.xml`; the visible text sits inside
// `<w:t>` runs. We unzip with fflate (already a dependency — the library
// import/export code uses it too) and pull the text out of the XML with a
// small tokenizer instead of DOMParser, so this module is PURE and runs
// unchanged under vitest's node environment (no browser globals).
//
// Fidelity is deliberately "plain text, reading order": paragraph boundaries
// (`</w:p>`) become newlines, explicit `<w:tab/>` runs become tabs, and line
// breaks (`<w:br/>` / legacy `<w:cr/>`) become newlines. Everything else —
// styling, tables' cell structure, images, headers/footers (they live in
// separate zip entries we never read) — is dropped: the text is fed to an LLM
// as a process description, where layout carries no meaning.

import {
  ArchivePreflightError,
  extractPreflightedZip,
  extractPreflightedZipSync,
  preflightZip,
  preflightZipAsync,
  type ZipPreflightEntry,
  type ZipSafetyLimits
} from '../security/archivePreflight'

/** Why a byte blob could not be read as a .docx. */
export type DocxErrorCode =
  | 'not-zip'
  | 'no-document-xml'
  | 'archive-too-large'
  | 'unsafe-archive'
  | 'encrypted-archive'
  | 'unsupported-archive'
  | 'malformed-archive'
  | 'aborted'

/**
 * Typed/coded error for non-docx inputs, so the panel can show a friendly
 * message while tests assert on the machine-readable `code`. In addition to
 * distinguishing non-ZIP/non-DOCX inputs, security failures are grouped as
 * too-large, unsafe, encrypted, unsupported, malformed, or aborted archives.
 */
export class DocxParseError extends Error {
  readonly code: DocxErrorCode
  constructor(code: DocxErrorCode, message: string) {
    super(message)
    this.name = 'DocxParseError'
    this.code = code
  }
}

/** Output cap — a description longer than this is past any useful prompt size. */
export const MAX_DOCX_TEXT_CHARS = 100_000
export const DOCX_ARCHIVE_LIMITS: ZipSafetyLimits = {
  maxCompressedBytes: 20 * 1024 * 1024,
  maxEntries: 2_048,
  maxCentralDirectoryBytes: 4 * 1024 * 1024,
  maxEntryNameBytes: 1_024,
  maxEntryUncompressedBytes: 12 * 1024 * 1024,
  maxTotalUncompressedBytes: 64 * 1024 * 1024,
  maxCompressionRatio: 250
}

export interface ExtractDocxTextOptions {
  signal?: AbortSignal
}

// The five predefined XML entities plus numeric character references
// (`&#65;` decimal / `&#x1F600;` hex). Decoded in a SINGLE pass so an escaped
// escape (`&amp;lt;`) correctly yields the literal `&lt;` instead of `<`.
const ENTITY_RE = /&(?:(amp|lt|gt|quot|apos)|#(x[0-9a-fA-F]+|[0-9]+));/g
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
}

function decodeXmlEntities(s: string): string {
  return s.replace(ENTITY_RE, (match, named: string | undefined, num: string | undefined) => {
    if (named !== undefined) return NAMED_ENTITIES[named]
    const code =
      num !== undefined && num.startsWith('x')
        ? parseInt(num.slice(1), 16)
        : parseInt(num ?? '', 10)
    // Out-of-range / malformed references are left as-is rather than throwing —
    // a single bad reference must not sink the whole document.
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match
    try {
      return String.fromCodePoint(code)
    } catch {
      return match
    }
  })
}

// One pass over document.xml collecting only the tokens that produce text:
//   1. `<w:t …>…</w:t>`   — a text run; group 1 captures the run content.
//                           Attributes (notably xml:space="preserve") are
//                           tolerated; run content is NEVER trimmed, so
//                           preserved leading/trailing spaces survive.
//   2. `<w:t …/>`         — a self-closing (empty) run; contributes nothing.
//   3. `<w:tab/>`         — a literal tab RUN element. Attribute-less on
//                           purpose: `<w:tab w:val=… w:pos=…/>` inside
//                           `<w:tabs>` is a tab-STOP definition (paragraph
//                           formatting), not a character, and must not match.
//   4. `<w:br …/>`/`<w:cr/>` — an explicit line/page break → newline.
//   5. `</w:p>`           — a paragraph boundary → newline.
// Word emits document.xml without whitespace between tags, but attribute
// whitespace (space/tab/newline) is tolerated everywhere it may legally occur.
const TOKEN_RE =
  /<w:t(?:[ \t\r\n][^>]*)?>([\s\S]*?)<\/w:t>|<w:t(?:[ \t\r\n][^>]*)?\/>|<w:tab\s*\/>|<w:(?:br|cr)(?:[ \t\r\n][^>]*)?\/>|<\/w:p>/g

function mapArchiveError(error: unknown): DocxParseError {
  if (!(error instanceof ArchivePreflightError)) {
    return new DocxParseError(
      'malformed-archive',
      `Could not safely read the .docx archive: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
  switch (error.code) {
    case 'not-zip':
      return new DocxParseError('not-zip', 'Not a .docx file (the bytes are not a zip archive)')
    case 'aborted':
      return new DocxParseError('aborted', 'DOCX processing was cancelled')
    case 'encrypted-entry':
      return new DocxParseError(
        'encrypted-archive',
        'Encrypted or password-protected .docx files are not supported'
      )
    case 'compressed-size-limit':
    case 'too-many-entries':
    case 'central-directory-limit':
    case 'entry-name-limit':
    case 'entry-size-limit':
    case 'total-size-limit':
    case 'compression-ratio-limit':
      return new DocxParseError('archive-too-large', `Unsafe .docx archive: ${error.message}`)
    case 'unsafe-path':
    case 'duplicate-path':
      return new DocxParseError('unsafe-archive', `Unsafe .docx archive: ${error.message}`)
    case 'unsupported-compression':
    case 'unsupported-entry':
    case 'unsupported-filename-encoding':
    case 'zip64-unsupported':
    case 'multi-disk-unsupported':
      return new DocxParseError('unsupported-archive', `Unsupported .docx archive: ${error.message}`)
    case 'malformed':
    case 'crc-mismatch':
      return new DocxParseError('malformed-archive', `Malformed .docx archive: ${error.message}`)
  }
}

function isMainDocument(entry: ZipPreflightEntry): boolean {
  return entry.normalizedName === 'word/document.xml'
}

function decodeDocumentXml(docEntry: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(docEntry)
  } catch {
    throw new DocxParseError(
      'malformed-archive',
      'Malformed .docx archive: word/document.xml is not valid UTF-8'
    )
  }
}

function extractTextFromDocumentXml(docEntry: Uint8Array): string {
  const xml = decodeDocumentXml(docEntry)

  let out = ''
  // Fresh regex state per call (module-level literal keeps lastIndex).
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(xml)) !== null) {
    const [tok, runText] = m
    if (runText !== undefined) {
      out += decodeXmlEntities(runText)
    } else if (tok.startsWith('<w:tab')) {
      out += '\t'
    } else if (tok === '</w:p>') {
      out += '\n'
    } else if (tok.startsWith('<w:br') || tok.startsWith('<w:cr')) {
      out += '\n'
    }
    // Self-closing `<w:t/>` falls through: an empty run contributes nothing.
  }

  // Runs of empty paragraphs (page padding, spacing paragraphs) would otherwise
  // become walls of blank lines — collapse 3+ newlines to one blank line, trim
  // the edges, and cap the result.
  const text = out.replace(/\n{3,}/g, '\n\n').trim()
  return text.length > MAX_DOCX_TEXT_CHARS ? text.slice(0, MAX_DOCX_TEXT_CHARS) : text
}

function requireMainDocument(entries: Record<string, Uint8Array>): Uint8Array {
  const docEntry = entries['word/document.xml']
  if (!docEntry) {
    throw new DocxParseError(
      'no-document-xml',
      'Not a .docx file (the archive has no word/document.xml)'
    )
  }
  return docEntry
}

/**
 * Synchronous compatibility API. Central-directory limits and local headers
 * are validated before the single required XML entry is expanded.
 */
export function extractDocxText(
  bytes: Uint8Array,
  options: ExtractDocxTextOptions = {}
): string {
  try {
    const preflight = preflightZip(bytes, DOCX_ARCHIVE_LIMITS, options.signal)
    if (!preflight.entries.some(isMainDocument)) {
      throw new DocxParseError(
        'no-document-xml',
        'Not a .docx file (the archive has no word/document.xml)'
      )
    }
    const entries = extractPreflightedZipSync(bytes, preflight, {
      signal: options.signal,
      include: isMainDocument
    })
    return extractTextFromDocumentXml(requireMainDocument(entries))
  } catch (error) {
    if (error instanceof DocxParseError) throw error
    throw mapArchiveError(error)
  }
}

/**
 * Async/worker-friendly equivalent with AbortSignal propagation through
 * preflight and fflate's terminable worker-backed inflater.
 */
export async function extractDocxTextAsync(
  bytes: Uint8Array,
  options: ExtractDocxTextOptions = {}
): Promise<string> {
  try {
    const preflight = await preflightZipAsync(bytes, DOCX_ARCHIVE_LIMITS, options.signal)
    if (!preflight.entries.some(isMainDocument)) {
      throw new DocxParseError(
        'no-document-xml',
        'Not a .docx file (the archive has no word/document.xml)'
      )
    }
    const entries = await extractPreflightedZip(bytes, preflight, {
      signal: options.signal,
      include: isMainDocument
    })
    return extractTextFromDocumentXml(requireMainDocument(entries))
  } catch (error) {
    if (error instanceof DocxParseError) throw error
    throw mapArchiveError(error)
  }
}

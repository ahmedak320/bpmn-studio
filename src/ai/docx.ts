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

import { unzipSync, strFromU8 } from 'fflate'

/** Why a byte blob could not be read as a .docx. */
export type DocxErrorCode = 'not-zip' | 'no-document-xml'

/**
 * Typed/coded error for non-docx inputs, so the panel can show a friendly
 * message while tests assert on the machine-readable `code`:
 *  - 'not-zip'          — the bytes are not a zip archive at all
 *  - 'no-document-xml'  — a zip, but without `word/document.xml`: some other
 *                         zip (or a renamed .doc/.odt), not a Word document
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

/**
 * Extract the plain text of a .docx file. PURE — bytes in, string out — and
 * node-testable (no DOMParser, no browser globals).
 *
 * Throws {@link DocxParseError} (`code: 'not-zip' | 'no-document-xml'`) when
 * the bytes are not a Word document. Returns '' for a genuinely empty
 * document (the caller shows the "no readable text" hint for that case).
 */
export function extractDocxText(bytes: Uint8Array): string {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch {
    throw new DocxParseError('not-zip', 'Not a .docx file (the bytes are not a zip archive)')
  }
  const docEntry = entries['word/document.xml']
  if (!docEntry) {
    throw new DocxParseError(
      'no-document-xml',
      'Not a .docx file (the archive has no word/document.xml)'
    )
  }
  // strFromU8 = fflate's UTF-8 decoder (TextDecoder under the hood, with a
  // fallback) — keeps this module's runtime surface identical in node/browser.
  const xml = strFromU8(docEntry)

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

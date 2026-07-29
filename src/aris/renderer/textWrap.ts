/**
 * Deterministic text measurement and wrapping — Plan Section 12.1/12.3/12.5.
 *
 * ARIS wraps text using the Windows GDI text layout engine and the real metrics of the
 * (possibly proprietary) font face. This renderer has neither GDI nor the licensed font files,
 * so it measures glyphs with a fixed per-character-class width table (em-relative, scaled by
 * the resolved font's pixel size) instead. That is a deliberate, documented approximation: any
 * time it actually wraps a line (i.e. the measured text does not fit on one line), a
 * `text-wrap-difference` fidelity finding is emitted rather than presenting the wrap as
 * source-accurate. Single-line text has no wrap decision to get wrong, so it produces no
 * finding.
 */

import type { ArisRenderFidelityFinding, RenderTextLine } from './types'

const NARROW_CHARS = new Set(['i', 'l', 'I', 'j', '.', ',', "'", ':', ';', '!', '|', '`'])
const WIDE_CHARS = new Set(['m', 'w', 'M', 'W', '@', '%'])

/** Relative glyph width in em, for one character, by rough visual class. */
function charWidthEm(ch: string): number {
  if (ch === ' ') return 0.28
  if (NARROW_CHARS.has(ch)) return 0.28
  if (WIDE_CHARS.has(ch)) return 0.85
  if (/[0-9]/.test(ch)) return 0.55
  if (/\p{Script=Arabic}/u.test(ch)) return 0.55
  if (/[A-Z]/.test(ch)) return 0.68
  if (/[a-z]/.test(ch)) return 0.5
  return 0.45
}

/** Deterministic width estimate in px for `text` at `sizePx`. Never calls into DOM/canvas. */
export function measureTextWidth(text: string, sizePx: number): number {
  let widthEm = 0
  for (const ch of text) {
    widthEm += charWidthEm(ch)
  }
  return widthEm * sizePx
}

function splitHardLines(text: string): readonly string[] {
  return text.split(/\r\n|\r|\n/)
}

/** Greedily wraps a single hard line of text to `maxWidthPx`, breaking on whitespace. */
function wrapSingleLine(line: string, maxWidthPx: number, sizePx: number): string[] {
  if (line === '') return ['']
  const words = line.split(/(\s+)/).filter((token) => token !== '')
  const lines: string[] = []
  let current = ''
  let currentWidth = 0

  for (const word of words) {
    const wordWidth = measureTextWidth(word, sizePx)
    if (current !== '' && currentWidth + wordWidth > maxWidthPx) {
      lines.push(current.trimEnd())
      current = word.trimStart()
      currentWidth = measureTextWidth(current, sizePx)
      continue
    }
    if (wordWidth > maxWidthPx && word.trim() !== '') {
      // A single word is wider than the box: hard-break it by character.
      if (current !== '') {
        lines.push(current.trimEnd())
        current = ''
        currentWidth = 0
      }
      let chunk = ''
      let chunkWidth = 0
      for (const ch of word) {
        const chWidth = measureTextWidth(ch, sizePx)
        if (chunkWidth + chWidth > maxWidthPx && chunk !== '') {
          lines.push(chunk)
          chunk = ''
          chunkWidth = 0
        }
        chunk += ch
        chunkWidth += chWidth
      }
      current = chunk
      currentWidth = chunkWidth
      continue
    }
    current += word
    currentWidth += wordWidth
  }
  if (current !== '' || lines.length === 0) {
    lines.push(current.trimEnd())
  }
  return lines
}

export interface TextWrapResult {
  readonly lines: readonly RenderTextLine[]
  readonly wrapped: boolean
}

/**
 * Wraps `text` to `maxWidthPx` (or leaves it as one line per hard break when `maxWidthPx` is
 * `null`, meaning the source placed no width constraint on this text).
 */
export function wrapText(text: string, maxWidthPx: number | null, sizePx: number): TextWrapResult {
  const hardLines = splitHardLines(text)
  const wrappedLines: string[] = []
  let anyWrapped = hardLines.length > 1
  for (const hardLine of hardLines) {
    if (maxWidthPx === null) {
      wrappedLines.push(hardLine)
      continue
    }
    const pieces = wrapSingleLine(hardLine, maxWidthPx, sizePx)
    if (pieces.length > 1) anyWrapped = true
    wrappedLines.push(...pieces)
  }
  return {
    lines: wrappedLines.map((lineText) => ({
      text: lineText,
      width: measureTextWidth(lineText, sizePx)
    })),
    wrapped: anyWrapped
  }
}

/** Builds the `text-wrap-difference` finding for text whose layout required a wrap decision. */
export function buildTextWrapFinding(
  wrapped: boolean,
  identity: {
    readonly modelId: string | null
    readonly elementId: string | null
    readonly sourceId: string | null
  }
): ArisRenderFidelityFinding | null {
  if (!wrapped) return null
  return {
    kind: 'text-wrap-difference',
    messageKey: 'aris.fidelity.textWrapDifference',
    modelId: identity.modelId,
    elementId: identity.elementId,
    sourceId: identity.sourceId,
    params: {}
  }
}

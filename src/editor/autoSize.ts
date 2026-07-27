// Auto-size interior-label BPMN activities after every visible-name write.
//
// bpmn-js renders task labels at 12px Arial with a 1.2 line-height and 7px
// padding. Its text utility wraps but does not clip, so fixed 100x80 activities
// allow long, vertically-centred labels to escape the shape. The pure helpers
// below approximate that wrapping deterministically with conservative
// per-glyph widths, widening activities first (up to 160px), then growing their
// height. Collapsed sub-process-family shapes also reserve the bottom chip's
// 14px band plus an 8px cross-engine text clearance budget. Since bpmn-js
// vertically centres the label in the entire activity, each 2px of extra
// height creates 1px of painted separation from the bottom chip.
//
// This module intentionally uses structural modeler/element types. The only
// product dependency is the shared activity predicate that defines which BPMN
// shapes use the interior task-label treatment.

import { isActivityType } from '../org/decorExtents'

const MIN_W = 100
const MAX_W = 160
const MIN_H = 80
const LEGACY_CHAR_W = 6.5
const LINE_H = 14.4
const PAD_V = 14
const PAD_H = 14
const CHIP_CLEAR = 22

const UPDATE_LABEL_EVENT = 'commandStack.element.updateLabel.postExecuted'
const UPDATE_PROPERTIES_EVENT = 'commandStack.element.updateProperties.postExecuted'

interface AutoSizeBusinessObjectLike {
  $type?: unknown
  name?: unknown
}

export interface AutoSizeElementLike {
  type?: string
  businessObject?: AutoSizeBusinessObjectLike
  /** Present on external-label shapes; points at the labelled element. */
  labelTarget?: AutoSizeElementLike | null
  /** Set by bpmn-js ElementFactory for every SubProcess-family shape. */
  collapsed?: boolean
  x?: number
  y?: number
  width?: number
  height?: number
}

export interface AutoSizeModeler {
  get(name: string): unknown
}

interface AutoSizeEventBusLike {
  on(event: string, callback: (event: unknown) => void): void
  off(event: string, callback: (event: unknown) => void): void
}

interface AutoSizeModelingLike {
  resizeShape(
    element: AutoSizeElementLike,
    bounds: { x: number; y: number; width: number; height: number }
  ): void
}

interface AutoSizeRegistryLike {
  getAll(): AutoSizeElementLike[]
}

interface CommandEventLike {
  context?: {
    element?: AutoSizeElementLike
    properties?: Record<string, unknown>
  }
}

function countWrappedWords(value: string, limit: number): number {
  const words = value.trim().split(/\s+/).filter(Boolean)
  let lines = 0
  let lineLength = 0

  for (const word of words) {
    if (lineLength > 0 && lineLength + 1 + word.length <= limit) {
      lineLength += 1 + word.length
      continue
    }

    if (lineLength > 0) {
      lines += 1
      lineLength = 0
    }

    let remaining = word.length
    while (remaining > limit) {
      lines += 1
      remaining -= limit
    }
    lineLength = remaining
  }

  return lines + (lineLength > 0 ? 1 : 0)
}

/**
 * Conservative advances for the 12px Arial used by bpmn-js. Values are
 * rounded above Chromium's Arial metrics (for example C=8.67px, M=10px and
 * W=11.33px); summing advances also avoids relying on browser-only canvas
 * measurement or font availability in Node.
 */
function glyphWidth(char: string): number {
  if (/\p{M}/u.test(char)) return 0
  if (/\s/u.test(char)) return 3.5

  if (/[!'.,:;I/\\[\]`|fijt]/u.test(char)) return 3.5
  if (/[-(){}r"]/u.test(char)) return 4.1
  if (/[*^]/u.test(char)) return 5.7
  if (/[Jcksvxyz]/u.test(char)) return 6.1
  if (/[0-9L?_$#=abdeghnopqu]/u.test(char)) return 6.8
  if (/[+~<>]/u.test(char)) return 7.1
  if (/[FTZ]/u.test(char)) return 7.4
  if (/[ABEKPSVXY&]/u.test(char)) return 8.1
  if (/[CDHNRUw]/u.test(char)) return 8.8
  if (/[GOQ]/u.test(char)) return 9.4
  if (/[Mm]/u.test(char)) return 10.1
  if (char === '%') return 10.8
  if (char === 'W') return 11.4
  if (char === '@') return 12.3

  // Arabic joining normally reduces the isolated-glyph advance. Seven pixels
  // is deliberately at the high end of its observed 12px Arial average.
  if (/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u.test(char)) return 7
  if (/\p{Lu}/u.test(char)) return 8.8
  if (/[\p{Ll}\p{Nd}]/u.test(char)) return 6.8
  if (/\p{P}/u.test(char)) return 7

  // CJK, emoji and otherwise unknown glyphs receive a full 12px em.
  return 12
}

function estimatedWidth(value: string): number {
  let width = 0
  for (const char of value.replace(/\s+$/, '')) {
    width += glyphWidth(char)
  }
  return width
}

function semanticShorten(line: string, maxLength: number): string {
  const parts = line.split(/(\s|-|\u00ad)/g)
  const shortened: string[] = []
  let length = 0

  while (parts.length) {
    const part = parts.shift()
    if (!part) break
    if (part.length + length < maxLength) {
      shortened.push(part)
      length += part.length
    } else {
      if (part === '-' || part === '\u00ad') shortened.pop()
      break
    }
  }

  if (shortened[shortened.length - 1] === '\u00ad') {
    shortened[shortened.length - 1] = '-'
  }
  return shortened.join('')
}

/**
 * Mirror diagram-js's layoutNext/shortenLine loop, substituting the pure
 * glyph-width estimate for canvas measureText. Matching its proportional
 * back-off is important: a greedy splitter can fit one more glyph per line
 * than the renderer and still undercount boundary-length uppercase runs.
 */
function countWrappedLineByWidth(sourceLine: string, maxWidth: number): number {
  const pending = [sourceLine]
  const limit = Math.max(1, Math.round(maxWidth))
  let lines = 0

  while (pending.length) {
    const originalLine = pending.shift() ?? ''
    let fitLine = originalLine

    for (;;) {
      const width = estimatedWidth(fitLine)
      if (fitLine === ' ' || fitLine === '' || width < limit || fitLine.length < 2) {
        if (fitLine.length < originalLine.length) {
          pending.unshift(originalLine.slice(fitLine.length).trim())
        }
        lines += 1
        break
      }

      const proportionalLength = Math.max(fitLine.length * (maxWidth / width), 1)
      fitLine =
        semanticShorten(fitLine, proportionalLength) ||
        fitLine.slice(0, Math.max(Math.round(proportionalLength - 1), 1))
    }
  }

  return lines
}

function pixelWrapCount(name: string, maxWidth: number): number {
  if (!name.trim()) return 0
  const sourceLines = name.split(/\u00ad?\r?\n/)
  let total = 0

  for (const sourceLine of sourceLines) {
    total += sourceLine.trim() ? countWrappedLineByWidth(sourceLine, maxWidth) : 1
  }

  return total
}

/**
 * Approximate diagram-js's whitespace-aware wrapping using a fixed average
 * character width. Explicit newlines remain hard breaks and overlong words are
 * split into finite `maxChars` chunks. An entirely blank name has no lines.
 */
export function wrapCount(name: string, maxChars: number): number {
  if (!name.trim()) return 0
  const limit = Math.max(1, Number.isFinite(maxChars) ? Math.floor(maxChars) : 1)
  const sourceLines = name.split(/\u00ad?\r?\n/)
  let total = 0

  for (const sourceLine of sourceLines) {
    // diagram-js preserves explicit empty lines once the overall label is
    // non-blank.
    total += sourceLine.trim() ? countWrappedWords(sourceLine, limit) : 1
  }

  return total
}

function safeWrapCount(name: string, availableWidth: number): number {
  const maxChars = Math.max(1, Math.floor(availableWidth / LEGACY_CHAR_W))

  // Keep the original average-width estimate as a floor, so ordinary labels
  // never shrink as a side effect of this safety fix. The glyph-aware estimate
  // adds the missing lines for uppercase and W/M-heavy runs.
  return Math.max(wrapCount(name, maxChars), pixelWrapCount(name, availableWidth))
}

/**
 * Fit an interior task label. Three lines, including the sub-chip clearance,
 * still fit inside the 80px minimum:
 * `3 * 14.4 + 14 + 22 = 79.2`.
 *
 * The four extra clearance pixels over the chip's nominal 14px + 4px band
 * produce two painted pixels because the label remains vertically centred.
 * This absorbs Firefox's larger SVG text/client bounds without changing the
 * compact three-line case.
 */
export function fitInteriorBox(
  name: string,
  opts: { reserveSubChip: boolean }
): { w: number; h: number } {
  if (!name.trim()) return { w: MIN_W, h: MIN_H }

  const chipClear = opts.reserveSubChip ? CHIP_CLEAR : 0
  const budget = MIN_H - PAD_V - chipClear

  for (let w = MIN_W; w <= MAX_W; w += 10) {
    if (safeWrapCount(name, w - PAD_H) * LINE_H <= budget) {
      return { w, h: MIN_H }
    }
  }

  const lineCount = safeWrapCount(name, MAX_W - PAD_H)
  let h = Math.max(MIN_H, Math.ceil(lineCount * LINE_H + PAD_V + chipClear))
  if (h % 2 !== 0) h += 1
  return { w: MAX_W, h }
}

const SUB_PROCESS_FAMILY = new Set(['bpmn:SubProcess', 'bpmn:Transaction', 'bpmn:AdHocSubProcess'])

/**
 * Return the desired activity bounds, or null for shapes whose labels are not
 * rendered in the task-style centred interior. `element.collapsed` is the
 * reliable live-shape flag: bpmn-js ElementFactory derives it from DI via
 * `!isExpanded(...)` for every SubProcess-family shape.
 */
export function targetFor(element: AutoSizeElementLike): { w: number; h: number } | null {
  const bo = element.businessObject
  const type =
    typeof element.type === 'string' ? element.type : typeof bo?.$type === 'string' ? bo.$type : ''
  if (!isActivityType(type)) return null

  const subProcessFamily = SUB_PROCESS_FAMILY.has(type)
  const collapsedSubProcess = subProcessFamily && element.collapsed === true
  if (subProcessFamily && !collapsedSubProcess) return null

  const name = typeof bo?.name === 'string' ? bo.name : ''
  return fitInteriorBox(name, {
    reserveSubChip: type === 'bpmn:CallActivity' || collapsedSubProcess
  })
}

function resizeToTarget(modeler: AutoSizeModeler, element: AutoSizeElementLike): boolean {
  try {
    const target = targetFor(element)
    if (!target) return false
    const { x, y, width, height } = element
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof width !== 'number' ||
      typeof height !== 'number'
    ) {
      return false
    }
    if (Math.abs(width - target.w) <= 1 && Math.abs(height - target.h) <= 1) {
      return false
    }

    const modeling = modeler.get('modeling') as AutoSizeModelingLike
    modeling.resizeShape(element, {
      x: Math.round(x + width / 2 - target.w / 2),
      y,
      width: target.w,
      height: target.h
    })
    return true
  } catch {
    // A sizing or resize failure must never break the originating edit/import.
    return false
  }
}

/**
 * Install name-write listeners. Nested `shape.resize` commands join the same
 * undo action as the label/property edit. There is no recursion: `shape.resize`
 * is neither of the two commands observed here.
 */
export function installAutoSize(modeler: AutoSizeModeler): () => void {
  const eventBus = modeler.get('eventBus') as AutoSizeEventBusLike

  const updateLabelHandler = (event: unknown): void => {
    try {
      const raw = (event as CommandEventLike | undefined)?.context?.element
      if (!raw) return
      resizeToTarget(modeler, raw.labelTarget ?? raw)
    } catch {
      /* an auto-size failure must never break the label edit */
    }
  }

  const updatePropertiesHandler = (event: unknown): void => {
    try {
      const context = (event as CommandEventLike | undefined)?.context
      if (!context?.element || !context.properties || !('name' in context.properties)) return
      const raw = context.element
      resizeToTarget(modeler, raw.labelTarget ?? raw)
    } catch {
      /* an auto-size failure must never break the property edit */
    }
  }

  eventBus.on(UPDATE_LABEL_EVENT, updateLabelHandler)
  eventBus.on(UPDATE_PROPERTIES_EVENT, updatePropertiesHandler)

  return () => {
    try {
      eventBus.off(UPDATE_LABEL_EVENT, updateLabelHandler)
      eventBus.off(UPDATE_PROPERTIES_EVENT, updatePropertiesHandler)
    } catch {
      /* modeler already destroyed */
    }
  }
}

/** Resize every eligible registered activity; intended for post-import sweeps. */
export function autoSizeAll(modeler: AutoSizeModeler): number {
  try {
    const registry = modeler.get('elementRegistry') as AutoSizeRegistryLike
    let resized = 0
    for (const element of registry.getAll()) {
      if (resizeToTarget(modeler, element)) resized += 1
    }
    return resized
  } catch {
    return 0
  }
}

export interface BoundedHistoryPreview {
  /** Unicode-scalar-safe text rendered by the history dialog. */
  text: string
  shownCodePoints: number
  omittedCodePoints: number
  totalCodePoints: number
}

function boundedLimit(maxCodePoints: number): number {
  if (!Number.isFinite(maxCodePoints)) return 0
  return Math.max(0, Math.floor(maxCodePoints))
}

/**
 * Bound a history preview by Unicode code points rather than UTF-16 code
 * units. Supplementary characters therefore remain intact at the boundary.
 * A synthetic lone surrogate is rendered as U+FFFD; revision bytes remain
 * untouched and are still the sole input to restore operations.
 */
export function boundHistoryPreview(xml: string, maxCodePoints: number): BoundedHistoryPreview {
  const limit = boundedLimit(maxCodePoints)
  const visible: string[] = []
  let totalCodePoints = 0

  for (let index = 0; index < xml.length; totalCodePoints += 1) {
    const first = xml.charCodeAt(index)
    let scalar: string
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = xml.charCodeAt(index + 1)
      if (second >= 0xdc00 && second <= 0xdfff) {
        scalar = xml.slice(index, index + 2)
        index += 2
      } else {
        scalar = '\ufffd'
        index += 1
      }
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      scalar = '\ufffd'
      index += 1
    } else {
      scalar = xml[index]
      index += 1
    }
    if (totalCodePoints < limit) visible.push(scalar)
  }

  const shownCodePoints = Math.min(totalCodePoints, limit)
  return {
    text: visible.join(''),
    shownCodePoints,
    omittedCodePoints: totalCodePoints - shownCodePoints,
    totalCodePoints
  }
}

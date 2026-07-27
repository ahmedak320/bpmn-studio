/**
 * Technical diagnostics are support evidence rather than primary interface
 * copy. Keep their rendered payload small even when a third-party parser
 * throws an exceptionally large Error.
 */
export const VALIDATION_TECHNICAL_DETAIL_MAX_CODE_POINTS = 512

/**
 * Return a bounded diagnostic without splitting UTF-16 surrogate pairs.
 *
 * The returned string is at most
 * `VALIDATION_TECHNICAL_DETAIL_MAX_CODE_POINTS` Unicode code points including
 * the ellipsis. Iteration stops as soon as the bound is known, so a megabyte
 * Error does not become a megabyte DOM node.
 */
export function boundedValidationTechnicalDetail(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined

  let raw: string
  try {
    raw = String(value instanceof Error ? value.message : value)
  } catch {
    return undefined
  }
  if (!/\S/u.test(raw)) return undefined

  const codePoints: string[] = []
  const iterator = raw[Symbol.iterator]()
  for (let index = 0; index < VALIDATION_TECHNICAL_DETAIL_MAX_CODE_POINTS; index += 1) {
    const next = iterator.next()
    if (next.done) return codePoints.join('')
    codePoints.push(next.value)
  }
  if (iterator.next().done) return codePoints.join('')

  codePoints[VALIDATION_TECHNICAL_DETAIL_MAX_CODE_POINTS - 1] = '…'
  return codePoints.join('')
}

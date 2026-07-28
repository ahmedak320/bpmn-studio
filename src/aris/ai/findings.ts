/**
 * Structured validation findings shared by every check in this package
 * (forbidden-content scan, schema parse, type validation, logical-id
 * integrity). A "finding" is never a silent drop — every rejection reported
 * by this package comes back as one or more of these.
 */

export interface ArisAiValidationFinding {
  /** Stable machine-readable failure code, e.g. `forbidden-xml-markup`. */
  readonly code: string
  /** JSONPath-ish locator into the draft, e.g. `$.objects[2].names.en`. */
  readonly path: string
  /** Human-readable explanation. */
  readonly message: string
}

export function finding(code: string, path: string, message: string): ArisAiValidationFinding {
  return { code, path, message }
}

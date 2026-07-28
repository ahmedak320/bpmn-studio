/**
 * Enforcement of the Section 16.4 closing sentence: "The AI must not emit
 * raw AML, real ARIS IDs, XML, coordinates, or unreviewed executable
 * content."
 *
 * This is an explicit, independent rejection pass — not a side effect of
 * zod's `.strict()` unknown-key rejection. It walks the *raw* parsed JSON
 * value (before, or instead of, schema validation) recursively, so it also
 * catches forbidden content nested inside fields the schema does not
 * otherwise constrain in shape (e.g. attribute values, evidence text), and
 * it runs even when the overall shape is otherwise schema-valid.
 *
 * `validateArisAiDraft` (validateDraft.ts) runs this scan first and
 * short-circuits before attempting schema parsing, so a draft that both
 * violates the security property and has other schema errors is reported
 * for the security violation, not swallowed by an unrelated shape error.
 */

import { finding, type ArisAiValidationFinding } from './findings'

// ---------------------------------------------------------------------------
// Pattern 1: raw XML/AML markup (Section 16.4: "raw AML ... XML")
// ---------------------------------------------------------------------------

/**
 * Matches XML/AML element syntax (`<Tag ...>`, `</Tag>`, self-closing tags),
 * the XML prolog, DOCTYPE declarations, and CDATA sections. Deliberately
 * broad: any string shaped like an element is rejected, even if it is not
 * well-formed XML, because the AI has no legitimate reason to ever emit
 * angle-bracket markup in a name/attribute/evidence field.
 */
const XML_MARKUP_PATTERN =
  /<\?xml|<!doctype|<!\[cdata\[|<\/?[a-zA-Z][a-zA-Z0-9:._-]*(?:\s[^<>]*)?\/?>/i

// ---------------------------------------------------------------------------
// Pattern 2: real ARIS source ids (Section 16.4: "real ARIS IDs")
// ---------------------------------------------------------------------------

/**
 * Real ARIS AML source ids follow `<RecordPrefix>.<opaque-hash-body>`, where
 * the opaque body is a hyphen/underscore-segmented, case-sensitive
 * alphanumeric token, e.g. `ObjDef.-10mm1DorpTb-p-L`,
 * `CxnDef.10i8WPnmE-z-q-L`, `Model.-1rUudxIp-wP-u-L`. This shape was studied
 * from ../../../../reference/AnimalWF/ARISAMLExport.xml (record-id
 * *attributes* only — no business content from that file is reproduced
 * here or in tests).
 *
 * The AI is instructed to use logical ids only (Section 16.5), so any
 * string field that reproduces this exact real-id shape — a known ARIS
 * record-id prefix followed by a dot and a hyphenated opaque body — is
 * rejected outright, whether it appears as a whole field value or embedded
 * inside a longer sentence (e.g. an evidence quote).
 */
const ARIS_RECORD_ID_PREFIXES = [
  'ObjDef',
  'ObjOcc',
  'CxnDef',
  'CxnOcc',
  'Model',
  'Group',
  'Lane',
  'AttrDef',
  'AttrOcc',
  'FFTextDef',
  'FFTextOcc',
  'FontSS',
  'OLEDef',
  'OLEOcc',
  'SymbolNum',
  'Database'
] as const

const ARIS_REAL_ID_PATTERN = new RegExp(
  `\\b(?:${ARIS_RECORD_ID_PREFIXES.join('|')})\\.[A-Za-z0-9_]*-[A-Za-z0-9_-]+`
)

// ---------------------------------------------------------------------------
// Pattern 3: executable content (Section 16.4: "unreviewed executable content")
// ---------------------------------------------------------------------------

const EXECUTABLE_CONTENT_PATTERN = /javascript:|data:text\/html|<script\b|on[a-z]+\s*=\s*["']/i

// ---------------------------------------------------------------------------
// Pattern 4: coordinate/geometry fields (Section 16.4: "coordinates")
// ---------------------------------------------------------------------------

/**
 * Field-name denylist for geometry/layout data. The AI draft contract has
 * no legitimate geometry field anywhere (layout is generated deterministically
 * downstream — Section 16.6 step 13 — never supplied by the model), so any
 * object key matching this list, at any nesting depth, is rejected.
 */
const GEOMETRY_KEY_DENYLIST = new Set([
  'x',
  'y',
  'dx',
  'dy',
  'pos',
  'position',
  'bounds',
  'width',
  'height',
  'rotation',
  'points',
  'route',
  'offsetx',
  'offsety',
  'zorder',
  'scale',
  'gridsize',
  'arcradius',
  'curveradius',
  'startborder',
  'endborder',
  'coordinate',
  'coordinates',
  'geometry'
])

function isForbiddenGeometryKey(key: string): boolean {
  const normalized = key.toLowerCase()
  if (GEOMETRY_KEY_DENYLIST.has(normalized)) return true
  // Catches x1/y2/dx0-style variants without over-matching ordinary words.
  return /^(x|y|dx|dy)\d+$/.test(normalized)
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function scanString(value: string, path: string, findings: ArisAiValidationFinding[]): void {
  if (XML_MARKUP_PATTERN.test(value)) {
    findings.push(
      finding(
        'forbidden-xml-markup',
        path,
        'Value contains XML/AML element syntax, which the AI must never emit.'
      )
    )
  }
  if (ARIS_REAL_ID_PATTERN.test(value)) {
    findings.push(
      finding(
        'forbidden-real-id',
        path,
        'Value contains a real ARIS source id shape; only logical ids are allowed.'
      )
    )
  }
  if (EXECUTABLE_CONTENT_PATTERN.test(value)) {
    findings.push(
      finding(
        'forbidden-executable-content',
        path,
        'Value contains script/executable content, which is never allowed unreviewed.'
      )
    )
  }
}

function scanValue(value: unknown, path: string, findings: ArisAiValidationFinding[]): void {
  if (typeof value === 'string') {
    scanString(value, path, findings)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanValue(item, `${path}[${index}]`, findings))
    return
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`
      if (isForbiddenGeometryKey(key)) {
        findings.push(
          finding(
            'forbidden-geometry-field',
            childPath,
            `Field name "${key}" looks like layout geometry, which the AI must never emit.`
          )
        )
      }
      scanValue(child, childPath, findings)
    }
  }
}

/**
 * Recursively scan an arbitrary (untrusted, not-yet-schema-validated) JSON
 * value for the four forbidden-content classes from Section 16.4. Returns
 * an empty array when nothing forbidden is found.
 */
export function scanForForbiddenContent(value: unknown, path = '$'): ArisAiValidationFinding[] {
  const findings: ArisAiValidationFinding[] = []
  scanValue(value, path, findings)
  return findings
}

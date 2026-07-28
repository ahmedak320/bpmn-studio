import { ArisWriterError } from './errors'

/**
 * XML 1.0 escaping for values the writer emits into a derived AML document (plan section 9.2,
 * "Escape XML safely").
 *
 * Two rules make breakout impossible rather than merely unlikely:
 *
 * 1. Every one of `& < > " '` is escaped in both attribute values and text — including `>`,
 *    which XML does not strictly require. Escaping `>` unconditionally is what makes `]]>`
 *    inert (`]]&gt;`), so a value can never terminate a CDATA section it was placed in.
 * 2. Characters XML 1.0 cannot represent *at all* (C0 controls other than tab/LF/CR, the
 *    non-characters U+FFFE/U+FFFF, and lone surrogates) are rejected with a hard error rather
 *    than silently dropped or replaced. A numeric character reference cannot rescue them:
 *    `&#0;` is not well-formed XML, so emitting one would produce a document that fails to
 *    re-parse.
 */

/** Characters that XML 1.0 permits inside an escaped attribute value or text node. */
function isXmlChar(codePoint: number): boolean {
  if (codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd) return true
  if (codePoint >= 0x20 && codePoint <= 0xd7ff) return true
  if (codePoint >= 0xe000 && codePoint <= 0xfffd) return true
  if (codePoint >= 0x10000 && codePoint <= 0x10ffff) return true
  return false
}

function describeCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`
}

/**
 * Reject any character that cannot appear in a well-formed XML 1.0 document.
 *
 * Lone surrogates are caught because iterating a string with `for…of` yields the unpaired
 * surrogate code unit itself (0xD800-0xDFFF), which `isXmlChar` excludes.
 */
export function assertXmlSafeText(value: string, label: string): void {
  let index = 0
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (!isXmlChar(codePoint)) {
      throw new ArisWriterError(
        'invalid-character',
        `${label} contains ${describeCodePoint(codePoint)}, which XML 1.0 cannot represent.`,
        { offset: index, detail: { label, codePoint } }
      )
    }
    index += character.length
  }
}

const ATTRIBUTE_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
  '\t': '&#9;',
  '\n': '&#10;',
  '\r': '&#13;'
})

const TEXT_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '\r': '&#13;'
})

/**
 * Escape a value for use inside an attribute delimited by either quote style.
 *
 * Whitespace is escaped numerically because an XML parser normalizes literal tab/newline/CR
 * inside attribute values to spaces; escaping them keeps the value byte-stable across a
 * write/re-read cycle.
 */
export function escapeXmlAttributeValue(value: string, label = 'attribute value'): string {
  assertXmlSafeText(value, label)
  return value.replace(/[&<>"'\t\n\r]/g, (character) => ATTRIBUTE_ESCAPES[character] ?? character)
}

/** Escape a value for use as element text content. */
export function escapeXmlText(value: string, label = 'text content'): string {
  assertXmlSafeText(value, label)
  return value.replace(/[&<>\r]/g, (character) => TEXT_ESCAPES[character] ?? character)
}

/** Escape a value for use inside an XML comment (`--` is illegal in comment content). */
export function escapeXmlComment(value: string, label = 'comment'): string {
  assertXmlSafeText(value, label)
  return value.replace(/-(?=-)/g, '- ').replace(/-$/, '- ')
}

const XML_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.:-]*$/

/** Reject anything that is not a plain XML name, so element/attribute names cannot be injected. */
export function assertXmlName(name: string, label: string): string {
  if (!XML_NAME_RE.test(name)) {
    throw new ArisWriterError('invalid-character', `${label} "${name}" is not a valid XML name.`, {
      detail: { label, name }
    })
  }
  return name
}

const LOCALE_ID_RE = /^(?:[0-9]+|&[A-Za-z_][A-Za-z0-9_.:-]*;)$/

/**
 * Validate a locale id copied verbatim from the source.
 *
 * The AnimalWF export writes locale ids as internal entity references (`&LocaleId.AEar;`)
 * rather than literals, so a localized attribute the writer emits must reproduce the source
 * token byte-for-byte instead of expanding it. That means the token is *not* escaped, which
 * in turn means it must be validated: only a decimal literal or a single entity reference is
 * accepted, so a hostile "locale id" cannot smuggle markup into the emitted attribute.
 */
export function assertSourceLocaleId(localeId: string): string {
  if (!LOCALE_ID_RE.test(localeId)) {
    throw new ArisWriterError(
      'invalid-character',
      `Locale id "${localeId}" is neither a decimal literal nor an entity reference; ` +
        'locale ids must be copied verbatim from the source document.',
      { detail: { localeId } }
    )
  }
  return localeId
}

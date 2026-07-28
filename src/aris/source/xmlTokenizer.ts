export interface XmlPoint {
  readonly offset: number
  readonly byteOffset: number
  readonly line: number
  readonly column: number
}

export interface XmlSpan {
  readonly start: XmlPoint
  readonly end: XmlPoint
}

export interface XmlAttributeToken {
  readonly name: string
  readonly value: string
  readonly quote: '"' | "'"
  readonly nameSpan: XmlSpan
  readonly valueSpan: XmlSpan
}

export interface XmlEntityDeclaration {
  readonly name: string
  readonly value: string
  readonly quote: '"' | "'"
  readonly span: XmlSpan
}

export interface XmlDeclarationToken {
  readonly kind: 'xml-declaration'
  readonly raw: string
  readonly span: XmlSpan
  readonly version: string | null
  readonly encoding: string | null
  readonly standalone: string | null
}

export interface XmlDoctypeToken {
  readonly kind: 'doctype'
  readonly raw: string
  readonly span: XmlSpan
  readonly name: string
  readonly externalIdKind: 'system' | 'public' | null
  readonly externalIdLiteral: string | null
  readonly internalSubset: string | null
  readonly entityDeclarations: readonly XmlEntityDeclaration[]
}

export interface XmlStartTagToken {
  readonly kind: 'start-tag' | 'empty-tag'
  readonly raw: string
  readonly span: XmlSpan
  readonly name: string
  readonly attributes: readonly XmlAttributeToken[]
}

export interface XmlEndTagToken {
  readonly kind: 'end-tag'
  readonly raw: string
  readonly span: XmlSpan
  readonly name: string
}

export interface XmlTextToken {
  readonly kind: 'text' | 'comment' | 'cdata' | 'processing-instruction'
  readonly raw: string
  readonly span: XmlSpan
  readonly content: string
  readonly target?: string
}

export type XmlToken =
  | XmlDeclarationToken
  | XmlDoctypeToken
  | XmlStartTagToken
  | XmlEndTagToken
  | XmlTextToken

export interface TokenizedXmlDocument {
  readonly tokens: readonly XmlToken[]
  readonly declaration: XmlDeclarationToken | null
  readonly doctype: XmlDoctypeToken | null
  readonly rootElementName: string | null
  readonly maxDepth: number
}

export interface XmlTokenizerLimits {
  readonly maxTokens: number
  readonly maxEntityDeclarations: number
  readonly maxEntityValueLength: number
  readonly maxTotalEntityValueLength: number
}

export const DEFAULT_XML_TOKENIZER_LIMITS: XmlTokenizerLimits = Object.freeze({
  maxTokens: 200_000,
  maxEntityDeclarations: 128,
  maxEntityValueLength: 8_192,
  maxTotalEntityValueLength: 65_536
})

export type XmlTokenizerErrorCode =
  | 'token-limit'
  | 'malformed-xml'
  | 'malformed-nesting'
  | 'duplicate-attribute'
  | 'invalid-encoding'
  | 'external-entity'
  | 'entity-limit'

export class XmlTokenizerError extends Error {
  readonly code: XmlTokenizerErrorCode
  readonly offset: number

  constructor(code: XmlTokenizerErrorCode, message: string, offset: number) {
    super(message)
    this.name = 'XmlTokenizerError'
    this.code = code
    this.offset = offset
  }
}

interface Cursor {
  index: number
  byteOffset: number
  line: number
  column: number
}

function isNameStartChar(char: string): boolean {
  return /[:A-Z_a-z]/u.test(char)
}

function isNameChar(char: string): boolean {
  return /[:A-Z_a-z0-9.\-]/u.test(char)
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t'
}

function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1
  if (codePoint <= 0x7ff) return 2
  if (codePoint <= 0xffff) return 3
  return 4
}

function clonePoint(cursor: Cursor): XmlPoint {
  return {
    offset: cursor.index,
    byteOffset: cursor.byteOffset,
    line: cursor.line,
    column: cursor.column
  }
}

function span(start: XmlPoint, cursor: Cursor): XmlSpan {
  return {
    start,
    end: clonePoint(cursor)
  }
}

function throwTokenizerError(
  code: XmlTokenizerErrorCode,
  message: string,
  cursor: Cursor
): never {
  throw new XmlTokenizerError(code, message, cursor.index)
}

function advanceTo(text: string, cursor: Cursor, targetIndex: number): void {
  while (cursor.index < targetIndex) {
    const code = text.charCodeAt(cursor.index)
    if (code === 13) {
      if (text.charCodeAt(cursor.index + 1) === 10) {
        cursor.index += 2
        cursor.byteOffset += 2
      } else {
        cursor.index += 1
        cursor.byteOffset += 1
      }
      cursor.line += 1
      cursor.column = 1
      continue
    }
    if (code === 10) {
      cursor.index += 1
      cursor.byteOffset += 1
      cursor.line += 1
      cursor.column = 1
      continue
    }
    const codePoint = text.codePointAt(cursor.index) ?? code
    const width = codePoint > 0xffff ? 2 : 1
    cursor.index += width
    cursor.byteOffset += utf8ByteLength(codePoint)
    cursor.column += 1
  }
}

function readName(text: string, cursor: Cursor): { name: string; start: XmlPoint } {
  const start = clonePoint(cursor)
  const first = text[cursor.index]
  if (!first || !isNameStartChar(first)) {
    throwTokenizerError('malformed-xml', 'Expected an XML name.', cursor)
  }
  let index = cursor.index + 1
  while (index < text.length && isNameChar(text[index]!)) index += 1
  const name = text.slice(cursor.index, index)
  advanceTo(text, cursor, index)
  return { name, start }
}

function skipWhitespace(text: string, cursor: Cursor): void {
  while (cursor.index < text.length && isWhitespace(text[cursor.index]!)) {
    advanceTo(text, cursor, cursor.index + 1)
  }
}

function readQuotedValue(
  text: string,
  cursor: Cursor
): { value: string; quote: '"' | "'"; valueSpan: XmlSpan } {
  const quote = text[cursor.index]
  if (quote !== '"' && quote !== "'") {
    throwTokenizerError('malformed-xml', 'Expected a quoted XML attribute value.', cursor)
  }
  advanceTo(text, cursor, cursor.index + 1)
  const valueStart = clonePoint(cursor)
  const close = text.indexOf(quote, cursor.index)
  if (close === -1) {
    throwTokenizerError('malformed-xml', 'Unterminated XML attribute value.', cursor)
  }
  const value = text.slice(cursor.index, close)
  advanceTo(text, cursor, close)
  const valueSpan = span(valueStart, cursor)
  advanceTo(text, cursor, cursor.index + 1)
  return { value, quote, valueSpan }
}

function parseXmlDeclaration(
  text: string,
  cursor: Cursor
): XmlDeclarationToken {
  const start = clonePoint(cursor)
  advanceTo(text, cursor, cursor.index + 5)
  const attributes = new Map<string, string>()
  skipWhitespace(text, cursor)
  while (!text.startsWith('?>', cursor.index)) {
    const { name } = readName(text, cursor)
    skipWhitespace(text, cursor)
    if (text[cursor.index] !== '=') {
      throwTokenizerError('malformed-xml', 'Expected "=" in XML declaration.', cursor)
    }
    advanceTo(text, cursor, cursor.index + 1)
    skipWhitespace(text, cursor)
    const { value } = readQuotedValue(text, cursor)
    attributes.set(name, value)
    skipWhitespace(text, cursor)
    if (cursor.index >= text.length) {
      throwTokenizerError('malformed-xml', 'Unterminated XML declaration.', cursor)
    }
  }
  advanceTo(text, cursor, cursor.index + 2)
  const encoding = attributes.get('encoding') ?? null
  if (encoding !== null && !/^[A-Za-z][A-Za-z0-9._-]*$/u.test(encoding)) {
    throw new XmlTokenizerError(
      'invalid-encoding',
      `Declared XML encoding "${encoding}" is invalid.`,
      start.offset
    )
  }
  return {
    kind: 'xml-declaration',
    raw: text.slice(start.offset, cursor.index),
    span: { start, end: clonePoint(cursor) },
    version: attributes.get('version') ?? null,
    encoding,
    standalone: attributes.get('standalone') ?? null
  }
}

function parseProcessingInstruction(text: string, cursor: Cursor): XmlTextToken {
  const start = clonePoint(cursor)
  advanceTo(text, cursor, cursor.index + 2)
  const { name } = readName(text, cursor)
  const close = text.indexOf('?>', cursor.index)
  if (close === -1) {
    throwTokenizerError('malformed-xml', 'Unterminated processing instruction.', cursor)
  }
  const content = text.slice(cursor.index, close).trim()
  advanceTo(text, cursor, close + 2)
  return {
    kind: 'processing-instruction',
    raw: text.slice(start.offset, cursor.index),
    span: { start, end: clonePoint(cursor) },
    content,
    target: name
  }
}

function parseComment(text: string, cursor: Cursor): XmlTextToken {
  const start = clonePoint(cursor)
  const close = text.indexOf('-->', cursor.index + 4)
  if (close === -1) {
    throwTokenizerError('malformed-xml', 'Unterminated XML comment.', cursor)
  }
  const content = text.slice(cursor.index + 4, close)
  advanceTo(text, cursor, close + 3)
  return {
    kind: 'comment',
    raw: text.slice(start.offset, cursor.index),
    span: { start, end: clonePoint(cursor) },
    content
  }
}

function parseCdata(text: string, cursor: Cursor): XmlTextToken {
  const start = clonePoint(cursor)
  const close = text.indexOf(']]>', cursor.index + 9)
  if (close === -1) {
    throwTokenizerError('malformed-xml', 'Unterminated CDATA section.', cursor)
  }
  const content = text.slice(cursor.index + 9, close)
  advanceTo(text, cursor, close + 3)
  return {
    kind: 'cdata',
    raw: text.slice(start.offset, cursor.index),
    span: { start, end: clonePoint(cursor) },
    content
  }
}

function parseInternalEntities(
  internalSubset: string | null,
  limits: XmlTokenizerLimits,
  start: XmlPoint
): readonly XmlEntityDeclaration[] {
  if (!internalSubset) return Object.freeze([])
  const declarations: XmlEntityDeclaration[] = []
  const entityRe = /<!ENTITY\s+([A-Za-z_][A-Za-z0-9_.:-]*)\s+(SYSTEM|PUBLIC|(["'])([\s\S]*?)\3)\s*>/gu
  let totalValueLength = 0
  for (const match of internalSubset.matchAll(entityRe)) {
    if (declarations.length >= limits.maxEntityDeclarations) {
      throw new XmlTokenizerError(
        'entity-limit',
        `The document declares more than ${limits.maxEntityDeclarations} XML entities.`,
        start.offset
      )
    }
    if (match[2] === 'SYSTEM' || match[2] === 'PUBLIC') {
      throw new XmlTokenizerError(
        'external-entity',
        'External XML entities are not allowed.',
        start.offset
      )
    }
    const value = match[4] ?? ''
    if (value.length > limits.maxEntityValueLength) {
      throw new XmlTokenizerError(
        'entity-limit',
        `An XML entity value exceeds the ${limits.maxEntityValueLength}-character limit.`,
        start.offset
      )
    }
    if (/&[A-Za-z_][A-Za-z0-9_.:-]*;/u.test(value)) {
      throw new XmlTokenizerError(
        'entity-limit',
        'Nested XML entity expansion is not allowed.',
        start.offset
      )
    }
    totalValueLength += value.length
    if (totalValueLength > limits.maxTotalEntityValueLength) {
      throw new XmlTokenizerError(
        'entity-limit',
        `Total XML entity replacement text exceeds the ${limits.maxTotalEntityValueLength}-character limit.`,
        start.offset
      )
    }
    declarations.push({
      name: match[1]!,
      value,
      quote: match[3] as '"' | "'",
      span: {
        start,
        end: start
      }
    })
  }
  return Object.freeze(declarations)
}

function parseDoctype(
  text: string,
  cursor: Cursor,
  limits: XmlTokenizerLimits
): XmlDoctypeToken {
  const start = clonePoint(cursor)
  advanceTo(text, cursor, cursor.index + '<!DOCTYPE'.length)
  skipWhitespace(text, cursor)
  const { name } = readName(text, cursor)
  const bodyStart = cursor.index
  let quote: '"' | "'" | null = null
  let bracketDepth = 0
  while (cursor.index < text.length) {
    const char = text[cursor.index]!
    if (quote) {
      if (char === quote) quote = null
      advanceTo(text, cursor, cursor.index + 1)
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      advanceTo(text, cursor, cursor.index + 1)
      continue
    }
    if (char === '[') {
      bracketDepth += 1
      advanceTo(text, cursor, cursor.index + 1)
      continue
    }
    if (char === ']') {
      if (bracketDepth > 0) bracketDepth -= 1
      advanceTo(text, cursor, cursor.index + 1)
      continue
    }
    if (char === '>' && bracketDepth === 0) {
      break
    }
    advanceTo(text, cursor, cursor.index + 1)
  }
  if (cursor.index >= text.length || text[cursor.index] !== '>') {
    throwTokenizerError('malformed-xml', 'Unterminated DOCTYPE declaration.', cursor)
  }
  const declarationBody = text.slice(bodyStart, cursor.index)
  const prolog = declarationBody.replace(/\[[\s\S]*$/u, '').trim()
  const publicMatch = prolog.match(/\bPUBLIC\s+(["'])([\s\S]*?)\1\s+(["'])([\s\S]*?)\3/u)
  const systemMatch = prolog.match(/\bSYSTEM\s+(["'])([\s\S]*?)\1/u)
  const subsetMatch = declarationBody.match(/\[([\s\S]*)\]\s*$/u)
  const internalSubset = subsetMatch?.[1] ?? null
  advanceTo(text, cursor, cursor.index + 1)
  return {
    kind: 'doctype',
    raw: text.slice(start.offset, cursor.index),
    span: { start, end: clonePoint(cursor) },
    name,
    externalIdKind: publicMatch ? 'public' : systemMatch ? 'system' : null,
    externalIdLiteral: publicMatch ? publicMatch[4] ?? null : systemMatch ? systemMatch[2] ?? null : null,
    internalSubset,
    entityDeclarations: parseInternalEntities(internalSubset, limits, start)
  }
}

function parseText(text: string, cursor: Cursor): XmlTextToken {
  const start = clonePoint(cursor)
  const next = text.indexOf('<', cursor.index)
  const end = next === -1 ? text.length : next
  const content = text.slice(cursor.index, end)
  advanceTo(text, cursor, end)
  return {
    kind: 'text',
    raw: text.slice(start.offset, cursor.index),
    span: { start, end: clonePoint(cursor) },
    content
  }
}

function parseEndTag(text: string, cursor: Cursor): XmlEndTagToken {
  const start = clonePoint(cursor)
  advanceTo(text, cursor, cursor.index + 2)
  const { name } = readName(text, cursor)
  skipWhitespace(text, cursor)
  if (text[cursor.index] !== '>') {
    throwTokenizerError('malformed-xml', 'Unterminated XML end tag.', cursor)
  }
  advanceTo(text, cursor, cursor.index + 1)
  return {
    kind: 'end-tag',
    raw: text.slice(start.offset, cursor.index),
    span: { start, end: clonePoint(cursor) },
    name
  }
}

function parseStartTag(text: string, cursor: Cursor): XmlStartTagToken {
  const start = clonePoint(cursor)
  advanceTo(text, cursor, cursor.index + 1)
  const { name } = readName(text, cursor)
  const attributes: XmlAttributeToken[] = []
  const seen = new Set<string>()
  while (cursor.index < text.length) {
    skipWhitespace(text, cursor)
    if (text.startsWith('/>', cursor.index)) {
      advanceTo(text, cursor, cursor.index + 2)
      return {
        kind: 'empty-tag',
        raw: text.slice(start.offset, cursor.index),
        span: { start, end: clonePoint(cursor) },
        name,
        attributes: Object.freeze(attributes)
      }
    }
    if (text[cursor.index] === '>') {
      advanceTo(text, cursor, cursor.index + 1)
      return {
        kind: 'start-tag',
        raw: text.slice(start.offset, cursor.index),
        span: { start, end: clonePoint(cursor) },
        name,
        attributes: Object.freeze(attributes)
      }
    }
    const attributeStart = clonePoint(cursor)
    const { name: attributeName, start: nameStart } = readName(text, cursor)
    if (seen.has(attributeName)) {
      throw new XmlTokenizerError(
        'duplicate-attribute',
        `Duplicate XML attribute "${attributeName}" is not allowed.`,
        attributeStart.offset
      )
    }
    seen.add(attributeName)
    skipWhitespace(text, cursor)
    if (text[cursor.index] !== '=') {
      throwTokenizerError('malformed-xml', 'Expected "=" after an XML attribute name.', cursor)
    }
    advanceTo(text, cursor, cursor.index + 1)
    skipWhitespace(text, cursor)
    const { value, quote, valueSpan } = readQuotedValue(text, cursor)
    attributes.push({
      name: attributeName,
      value,
      quote,
      nameSpan: { start: nameStart, end: clonePoint(cursor) },
      valueSpan
    })
  }
  throwTokenizerError('malformed-xml', 'Unterminated XML start tag.', cursor)
}

function resolvedLimits(limits?: Partial<XmlTokenizerLimits>): XmlTokenizerLimits {
  return {
    maxTokens: limits?.maxTokens ?? DEFAULT_XML_TOKENIZER_LIMITS.maxTokens,
    maxEntityDeclarations:
      limits?.maxEntityDeclarations ?? DEFAULT_XML_TOKENIZER_LIMITS.maxEntityDeclarations,
    maxEntityValueLength:
      limits?.maxEntityValueLength ?? DEFAULT_XML_TOKENIZER_LIMITS.maxEntityValueLength,
    maxTotalEntityValueLength:
      limits?.maxTotalEntityValueLength ?? DEFAULT_XML_TOKENIZER_LIMITS.maxTotalEntityValueLength
  }
}

export function tokenizeXmlDocument(
  text: string,
  limits?: Partial<XmlTokenizerLimits>
): TokenizedXmlDocument {
  const resolved = resolvedLimits(limits)
  const cursor: Cursor = { index: 0, byteOffset: 0, line: 1, column: 1 }
  const tokens: XmlToken[] = []
  const openElements: string[] = []
  let declaration: XmlDeclarationToken | null = null
  let doctype: XmlDoctypeToken | null = null
  let rootElementName: string | null = null
  let maxDepth = 0

  if (text.startsWith('\uFEFF')) advanceTo(text, cursor, 1)

  const pushToken = (token: XmlToken): void => {
    if (tokens.length >= resolved.maxTokens) {
      throw new XmlTokenizerError(
        'token-limit',
        `The XML tokenizer exceeded the ${resolved.maxTokens}-token limit.`,
        token.span.start.offset
      )
    }
    tokens.push(token)
  }

  while (cursor.index < text.length) {
    const remaining = text.slice(cursor.index)
    if (remaining.startsWith('<?xml')) {
      if (declaration !== null || tokens.some((token) => token.kind !== 'text' || token.content.trim())) {
        throwTokenizerError(
          'malformed-xml',
          'XML declaration must appear only once at the start of the document.',
          cursor
        )
      }
      declaration = parseXmlDeclaration(text, cursor)
      pushToken(declaration)
      continue
    }
    if (remaining.startsWith('<!--')) {
      pushToken(parseComment(text, cursor))
      continue
    }
    if (remaining.startsWith('<![CDATA[')) {
      pushToken(parseCdata(text, cursor))
      continue
    }
    if (remaining.startsWith('<?')) {
      pushToken(parseProcessingInstruction(text, cursor))
      continue
    }
    if (remaining.startsWith('<!DOCTYPE')) {
      if (doctype !== null) {
        throwTokenizerError('malformed-xml', 'DOCTYPE may appear only once.', cursor)
      }
      doctype = parseDoctype(text, cursor, resolved)
      pushToken(doctype)
      continue
    }
    if (remaining.startsWith('</')) {
      const token = parseEndTag(text, cursor)
      const expected = openElements.pop()
      if (expected !== token.name) {
        throw new XmlTokenizerError(
          'malformed-nesting',
          `Closing tag </${token.name}> does not match the current open element.`,
          token.span.start.offset
        )
      }
      pushToken(token)
      continue
    }
    if (remaining.startsWith('<')) {
      const token = parseStartTag(text, cursor)
      if (openElements.length === 0) {
        if (rootElementName !== null) {
          throw new XmlTokenizerError(
            'malformed-xml',
            'XML documents may contain only one root element.',
            token.span.start.offset
          )
        }
        rootElementName = token.name
      }
      if (token.kind === 'start-tag') {
        openElements.push(token.name)
        maxDepth = Math.max(maxDepth, openElements.length)
      } else {
        maxDepth = Math.max(maxDepth, openElements.length + 1)
      }
      pushToken(token)
      continue
    }
    pushToken(parseText(text, cursor))
  }

  if (openElements.length > 0) {
    throw new XmlTokenizerError(
      'malformed-nesting',
      `Element <${openElements[openElements.length - 1]}> is not closed.`,
      cursor.index
    )
  }

  return Object.freeze({
    tokens: Object.freeze(tokens),
    declaration,
    doctype,
    rootElementName,
    maxDepth
  })
}

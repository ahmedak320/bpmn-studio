import {
  tokenizeXmlDocument,
  type TokenizedXmlDocument,
  type XmlAttributeToken,
  type XmlElementNode,
  type XmlNode,
  type XmlTokenizerLimits
} from '../source/xmlTokenizer'
import { ArisWriterError } from './errors'
import { makeSpan, toWriterSpan, type WriterSpan } from './spans'

/**
 * A span-addressable, read-only projection of an AML document, built from the lossless
 * concrete-syntax tree.
 *
 * The writer works exclusively against this projection. It carries exactly the information
 * needed to *address* bytes — element/attribute spans, ids, paths, sibling order, indentation
 * — and deliberately carries no parsed ARIS semantics, so the writer stays independent of the
 * semantic index's shape.
 */

export interface WriterAttribute {
  readonly name: string
  readonly value: string
  readonly quote: '"' | "'"
  /** Span of the whole `name="value"` token. */
  readonly span: WriterSpan
  /** Span of the value only, quotes excluded. Patching this preserves the quote style. */
  readonly valueSpan: WriterSpan
}

export interface WriterElement {
  readonly name: string
  /** `AML[1]/Group[1]/Model[2]` — the same convention the semantic index uses. */
  readonly path: string
  readonly parentPath: string | null
  readonly depth: number
  /** Span of the whole element, from `<` through the end of its end tag. */
  readonly span: WriterSpan
  readonly startTagSpan: WriterSpan
  readonly endTagSpan: WriterSpan | null
  /** Span between `>` and `</`. `null` for a self-closing element. */
  readonly contentSpan: WriterSpan | null
  readonly selfClosing: boolean
  readonly attributes: readonly WriterAttribute[]
  readonly attributeByName: ReadonlyMap<string, WriterAttribute>
  readonly childPaths: readonly string[]
  /** Value of this element's own `<Kind>.ID` attribute, if it declares one. */
  readonly sourceId: string | null
  readonly sourceIdAttribute: string | null
  /** Whitespace immediately preceding the start tag on its own line, for emitting siblings. */
  readonly indent: string
}

/** A single id token found inside a `*.IdRef` or `*.IdRefs` attribute. */
export interface WriterReference {
  readonly elementPath: string
  readonly attributeName: string
  readonly targetId: string
  /** Span of just this id token inside the attribute value. */
  readonly span: WriterSpan
  /** True when the attribute is a whitespace-separated `*.IdRefs` list. */
  readonly list: boolean
}

export interface WriterSourceView {
  readonly text: string
  readonly elements: readonly WriterElement[]
  readonly byPath: ReadonlyMap<string, WriterElement>
  readonly byId: ReadonlyMap<string, WriterElement>
  readonly references: readonly WriterReference[]
  readonly referencesByTarget: ReadonlyMap<string, readonly WriterReference[]>
  readonly rootPath: string | null
  /** Raw `LocaleId` attribute values declared by `<Language>` elements, in source order. */
  readonly localeIds: readonly string[]
  /** Internal entity declarations from the DOCTYPE, name to value. */
  readonly entities: ReadonlyMap<string, string>
  readonly doctypeExternalId: string | null
  /** Indentation unit inferred from the source (a tab or a run of spaces). */
  readonly indentUnit: string
  readonly newline: string
  readonly tokenized: TokenizedXmlDocument
}

/** Attribute names that declare an id, keyed by the element that may carry them. */
const ID_ATTRIBUTE_SUFFIX = '.ID'

/** `X.IdRef` holds one id; `X.IdRefs` holds a whitespace-separated list. */
const SINGLE_REF_SUFFIX = '.IdRef'
const LIST_REF_SUFFIX = '.IdRefs'

export function isIdDeclarationAttribute(name: string): boolean {
  return name.endsWith(ID_ATTRIBUTE_SUFFIX) && name.length > ID_ATTRIBUTE_SUFFIX.length
}

export function isSingleReferenceAttribute(name: string): boolean {
  return name.endsWith(SINGLE_REF_SUFFIX)
}

export function isListReferenceAttribute(name: string): boolean {
  return name.endsWith(LIST_REF_SUFFIX)
}

function adaptAttribute(token: XmlAttributeToken): WriterAttribute {
  return Object.freeze({
    name: token.name,
    value: token.value,
    quote: token.quote,
    span: toWriterSpan(token.nameSpan),
    valueSpan: toWriterSpan(token.valueSpan)
  })
}

function leadingIndent(text: string, start: number): string {
  let index = start
  while (index > 0) {
    const character = text[index - 1]
    if (character === ' ' || character === '\t') index -= 1
    else break
  }
  if (index > 0 && text[index - 1] !== '\n') return ''
  return text.slice(index, start)
}

function inferIndentUnit(text: string): string {
  const match = /\n([ \t]+)\S/.exec(text)
  const indent = match?.[1] ?? '\t'
  if (indent.startsWith('\t')) return '\t'
  return indent.length >= 2 ? indent.slice(0, 2) : indent
}

function inferNewline(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function collectReferenceTokens(
  element: WriterElement,
  attribute: WriterAttribute,
  list: boolean
): WriterReference[] {
  const collected: WriterReference[] = []
  const value = attribute.value
  const base = attribute.valueSpan.start
  const pattern = /\S+/g
  let match: RegExpExecArray | null = pattern.exec(value)
  while (match !== null) {
    collected.push(
      Object.freeze({
        elementPath: element.path,
        attributeName: attribute.name,
        targetId: match[0],
        span: makeSpan(base + match.index, base + match.index + match[0].length),
        list
      })
    )
    if (!list) break
    match = pattern.exec(value)
  }
  return collected
}

/**
 * Build the writer's projection of an already-tokenized document.
 *
 * `text` must be the exact string that was tokenized — every span in the view indexes into it.
 */
export function buildWriterSourceView(
  text: string,
  tokenized: TokenizedXmlDocument
): WriterSourceView {
  const elements: WriterElement[] = []
  const byPath = new Map<string, WriterElement>()
  const byId = new Map<string, WriterElement>()
  const localeIds: string[] = []

  const visit = (node: XmlElementNode, parentPath: string | null, depth: number, path: string): void => {
    const startTagSpan = toWriterSpan(node.startTag.span)
    const endTagSpan = node.endTag === null ? null : toWriterSpan(node.endTag.span)
    const selfClosing = node.startTag.kind === 'empty-tag'
    const span = makeSpan(startTagSpan.start, (endTagSpan ?? startTagSpan).end)
    const contentSpan =
      selfClosing || endTagSpan === null ? null : makeSpan(startTagSpan.end, endTagSpan.start)

    const attributes = node.startTag.attributes.map(adaptAttribute)
    const attributeByName = new Map(attributes.map((attribute) => [attribute.name, attribute]))
    const idAttribute = attributes.find((attribute) => isIdDeclarationAttribute(attribute.name))

    const childPaths: string[] = []
    const counts = new Map<string, number>()
    const childNodes: { node: XmlElementNode; path: string }[] = []
    node.children.forEach((child: XmlNode) => {
      if (child.kind !== 'element') return
      const index = (counts.get(child.name) ?? 0) + 1
      counts.set(child.name, index)
      const childPath = `${path}/${child.name}[${index}]`
      childPaths.push(childPath)
      childNodes.push({ node: child, path: childPath })
    })

    const element: WriterElement = Object.freeze({
      name: node.name,
      path,
      parentPath,
      depth,
      span,
      startTagSpan,
      endTagSpan,
      contentSpan,
      selfClosing,
      attributes: Object.freeze(attributes),
      attributeByName,
      childPaths: Object.freeze(childPaths),
      sourceId: idAttribute?.value ?? null,
      sourceIdAttribute: idAttribute?.name ?? null,
      indent: leadingIndent(text, startTagSpan.start)
    })

    elements.push(element)
    byPath.set(path, element)
    if (element.sourceId !== null && !byId.has(element.sourceId)) byId.set(element.sourceId, element)
    if (element.name === 'Language') {
      const localeId = element.attributeByName.get('LocaleId')?.value
      if (localeId !== undefined) localeIds.push(localeId)
    }

    childNodes.forEach((child) => visit(child.node, path, depth + 1, child.path))
  }

  const rootCounts = new Map<string, number>()
  tokenized.children.forEach((node) => {
    if (node.kind !== 'element') return
    const index = (rootCounts.get(node.name) ?? 0) + 1
    rootCounts.set(node.name, index)
    visit(node, null, 0, `${node.name}[${index}]`)
  })

  const references: WriterReference[] = []
  elements.forEach((element) => {
    element.attributes.forEach((attribute) => {
      if (isListReferenceAttribute(attribute.name)) {
        references.push(...collectReferenceTokens(element, attribute, true))
      } else if (isSingleReferenceAttribute(attribute.name)) {
        references.push(...collectReferenceTokens(element, attribute, false))
      }
    })
  })

  const referencesByTarget = new Map<string, WriterReference[]>()
  references.forEach((reference) => {
    const bucket = referencesByTarget.get(reference.targetId)
    if (bucket) bucket.push(reference)
    else referencesByTarget.set(reference.targetId, [reference])
  })

  const entities = new Map<string, string>()
  tokenized.doctype?.entityDeclarations.forEach((declaration) => {
    entities.set(declaration.name, declaration.value)
  })

  return Object.freeze({
    text,
    elements: Object.freeze(elements),
    byPath,
    byId,
    references: Object.freeze(references),
    referencesByTarget,
    rootPath: elements[0]?.path ?? null,
    localeIds: Object.freeze(localeIds),
    entities,
    doctypeExternalId: tokenized.doctype?.externalIdLiteral ?? null,
    indentUnit: inferIndentUnit(text),
    newline: inferNewline(text),
    tokenized
  })
}

/** Tokenize and project in one step. */
export function readWriterSourceView(
  text: string,
  limits?: Partial<XmlTokenizerLimits>
): WriterSourceView {
  return buildWriterSourceView(text, tokenizeXmlDocument(text, limits))
}

export function childrenOf(view: WriterSourceView, element: WriterElement): readonly WriterElement[] {
  return element.childPaths.map((path) => {
    const child = view.byPath.get(path)
    if (!child) {
      throw new ArisWriterError('unknown-record', `Child element "${path}" is missing from the view.`)
    }
    return child
  })
}

export function parentOf(view: WriterSourceView, element: WriterElement): WriterElement | null {
  return element.parentPath === null ? null : (view.byPath.get(element.parentPath) ?? null)
}

export function ancestorsOf(view: WriterSourceView, element: WriterElement): readonly WriterElement[] {
  const chain: WriterElement[] = []
  let current = parentOf(view, element)
  while (current !== null) {
    chain.push(current)
    current = parentOf(view, current)
  }
  return chain
}

export function childrenNamed(
  view: WriterSourceView,
  element: WriterElement,
  name: string
): readonly WriterElement[] {
  return childrenOf(view, element).filter((child) => child.name === name)
}

/** Look up an element by source id, failing loudly when it is absent. */
export function requireElementById(view: WriterSourceView, id: string): WriterElement {
  const element = view.byId.get(id)
  if (!element) {
    throw new ArisWriterError('unknown-record', `No source record declares the id "${id}".`, {
      detail: { id }
    })
  }
  return element
}

export function requireAttribute(element: WriterElement, name: string): WriterAttribute {
  const attribute = element.attributeByName.get(name)
  if (!attribute) {
    throw new ArisWriterError(
      'unknown-record',
      `Element "${element.path}" has no attribute "${name}".`,
      { detail: { path: element.path, attribute: name } }
    )
  }
  return attribute
}

/** All ids declared anywhere in the document, in source order (duplicates included). */
export function declaredIds(view: WriterSourceView): readonly string[] {
  const ids: string[] = []
  view.elements.forEach((element) => {
    element.attributes.forEach((attribute) => {
      if (isIdDeclarationAttribute(attribute.name)) ids.push(attribute.value)
    })
  })
  return ids
}

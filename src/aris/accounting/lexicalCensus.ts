import type { TokenizedXmlDocument, XmlElementNode, XmlNode } from '../source/xmlTokenizer'
import type { ArisLexicalCensus } from './types'

/**
 * Build a completely independent lexical census of the raw XML concrete-syntax
 * tree.
 *
 * This function deliberately does not consult the semantic index or reuse any
 * of its classification logic. It counts what the tokenizer actually produced:
 * element occurrences by tag name, attribute occurrences, text nodes, comments,
 * CDATA sections, processing instructions, the XML declaration, and the
 * DOCTYPE. The duplication is intentional: the census is the independent view
 * against which the semantic index and accounting entries are cross-checked.
 */
export function buildLexicalCensus(document: TokenizedXmlDocument): ArisLexicalCensus {
  const elementCounts: Record<string, number> = {}
  const attributeCountsByName: Record<string, number> = {}
  let attributeTotal = 0
  let textNodes = 0
  let comments = 0
  let cdataSections = 0
  let processingInstructions = 0

  const bumpElement = (name: string): void => {
    elementCounts[name] = (elementCounts[name] ?? 0) + 1
  }

  const countAttributes = (node: XmlElementNode): void => {
    for (const attribute of node.startTag.attributes) {
      attributeTotal += 1
      attributeCountsByName[attribute.name] = (attributeCountsByName[attribute.name] ?? 0) + 1
    }
  }

  const visitNode = (node: XmlNode): void => {
    if (node.kind === 'element') {
      bumpElement(node.name)
      countAttributes(node)
      for (const child of node.children) {
        visitNode(child)
      }
      return
    }

    switch (node.kind) {
      case 'text':
        textNodes += 1
        break
      case 'comment':
        comments += 1
        break
      case 'cdata':
        cdataSections += 1
        break
      case 'processing-instruction':
        processingInstructions += 1
        break
    }
  }

  for (const child of document.children) {
    visitNode(child)
  }

  let xmlDeclarationAttributes = 0
  if (document.declaration) {
    if (document.declaration.version) xmlDeclarationAttributes += 1
    if (document.declaration.encoding) xmlDeclarationAttributes += 1
    if (document.declaration.standalone) xmlDeclarationAttributes += 1
  }

  // Include XML declaration attributes in the attribute total so the census
  // reflects every attribute-shaped construct in the document.
  attributeTotal += xmlDeclarationAttributes
  if (document.declaration?.version) {
    attributeCountsByName.version = (attributeCountsByName.version ?? 0) + 1
  }
  if (document.declaration?.encoding) {
    attributeCountsByName.encoding = (attributeCountsByName.encoding ?? 0) + 1
  }
  if (document.declaration?.standalone) {
    attributeCountsByName.standalone = (attributeCountsByName.standalone ?? 0) + 1
  }

  const xmlDeclaration = document.declaration ? 1 : 0
  const doctype = document.doctype ? 1 : 0

  const totalSourceRecords =
    Object.values(elementCounts).reduce((sum, count) => sum + count, 0) +
    attributeTotal +
    textNodes +
    comments +
    cdataSections +
    processingInstructions +
    xmlDeclaration +
    doctype

  return Object.freeze({
    totalSourceRecords,
    elementCounts: Object.freeze({ ...elementCounts }),
    attributeTotal,
    attributeCountsByName: Object.freeze({ ...attributeCountsByName }),
    textNodes,
    comments,
    cdataSections,
    processingInstructions,
    xmlDeclaration,
    xmlDeclarationAttributes,
    doctype
  })
}

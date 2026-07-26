import {
  createValidationSummary,
  validationIssue,
  type SourceLocation,
  type ValidationIssue,
  type ValidationSummary
} from './contracts'

export interface XmlPreflightLimits {
  /** UTF-8 encoded input size. */
  maxBytes: number
  maxElements: number
  maxDepth: number
  maxAttributesPerElement: number
  maxAttributeValueLength: number
  maxTextNodeLength: number
}

export const DEFAULT_XML_PREFLIGHT_LIMITS: Readonly<XmlPreflightLimits> = Object.freeze({
  maxBytes: 20 * 1024 * 1024,
  maxElements: 100_000,
  maxDepth: 256,
  maxAttributesPerElement: 256,
  maxAttributeValueLength: 32_767,
  maxTextNodeLength: 1024 * 1024
})

export interface XmlPreflightMetrics {
  bytes: number
  elements: number
  maxDepth: number
}

export interface XmlPreflightResult {
  xml: string
  summary: ValidationSummary
  metrics: XmlPreflightMetrics
  safeToParse: boolean
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export function sourceLocationAt(xml: string, offset: number): SourceLocation {
  const safeOffset = Math.max(0, Math.min(offset, xml.length))
  let line = 1
  let lastBreak = -1
  for (let index = 0; index < safeOffset; index += 1) {
    if (xml.charCodeAt(index) === 10) {
      line += 1
      lastBreak = index
    }
  }
  return { line, column: safeOffset - lastBreak, offset: safeOffset }
}

function issueAt(
  xml: string,
  offset: number,
  code: string,
  message: string,
  suggestedRepair?: string
): ValidationIssue {
  return validationIssue({
    code,
    severity: 'error',
    source: 'xml',
    message,
    location: sourceLocationAt(xml, offset),
    suggestedRepair
  })
}

function findTagEnd(xml: string, start: number): number {
  let quote: '"' | "'" | null = null
  for (let index = start + 1; index < xml.length; index += 1) {
    const char = xml[index]
    if (quote) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '>') {
      return index
    }
  }
  return -1
}

interface TagMetrics {
  attributes: number
  longestAttribute: number
}

function inspectStartTag(tag: string): TagMetrics {
  // Skip the element name.  This scanner deliberately accepts namespace
  // prefixes and all XML whitespace but does not try to replace the real XML
  // parser; malformed attributes are reported by moddle after this security
  // and resource preflight.
  let index = 1
  while (index < tag.length && !/[\s/>]/.test(tag[index])) index += 1

  let attributes = 0
  let longestAttribute = 0
  while (index < tag.length) {
    while (index < tag.length && /\s/.test(tag[index])) index += 1
    if (index >= tag.length || tag[index] === '/' || tag[index] === '>') break

    while (index < tag.length && !/[\s=/>]/.test(tag[index])) index += 1
    while (index < tag.length && /\s/.test(tag[index])) index += 1
    if (tag[index] !== '=') {
      while (index < tag.length && !/\s|>/.test(tag[index])) index += 1
      continue
    }
    index += 1
    while (index < tag.length && /\s/.test(tag[index])) index += 1
    const quote = tag[index]
    if (quote !== '"' && quote !== "'") {
      while (index < tag.length && !/\s|>/.test(tag[index])) index += 1
      continue
    }
    index += 1
    const valueStart = index
    while (index < tag.length && tag[index] !== quote) index += 1
    attributes += 1
    longestAttribute = Math.max(longestAttribute, index - valueStart)
    if (index < tag.length) index += 1
  }

  return { attributes, longestAttribute }
}

function declarationEncoding(xml: string): { value: string; offset: number } | null {
  const declaration = /^\uFEFF?\s*<\?xml\b([\s\S]*?)\?>/i.exec(xml)
  if (!declaration) return null
  const encoding = /\bencoding\s*=\s*(['"])(.*?)\1/i.exec(declaration[1])
  if (!encoding) return null
  const valueOffset = (declaration.index ?? 0) + declaration[0].indexOf(encoding[2])
  return { value: encoding[2], offset: valueOffset }
}

/**
 * Security/resource preflight performed before bpmn-moddle sees the input.
 *
 * The application never expands entities or fetches external resources.
 * DTDs, entity declarations, XInclude and non-declaration processing
 * instructions are rejected rather than delegated to a browser-dependent XML
 * parser.
 */
export function preflightXml(
  rawXml: string,
  overrides: Partial<XmlPreflightLimits> = {}
): XmlPreflightResult {
  const limits: XmlPreflightLimits = { ...DEFAULT_XML_PREFLIGHT_LIMITS, ...overrides }
  const xml = rawXml.startsWith('\uFEFF') ? rawXml.slice(1) : rawXml
  const issues: ValidationIssue[] = []
  const bytes = utf8Length(rawXml)

  if (xml.trim().length === 0) {
    issues.push(issueAt(xml, 0, 'xml.empty', 'The XML document is empty.'))
  }
  if (bytes > limits.maxBytes) {
    issues.push(
      issueAt(
        xml,
        0,
        'xml.size-limit',
        `XML input is ${bytes} bytes; the limit is ${limits.maxBytes} bytes.`,
        'Reduce or split the BPMN document before importing it.'
      )
    )
  }

  const illegalControl = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.exec(xml)
  if (illegalControl) {
    issues.push(
      issueAt(
        xml,
        illegalControl.index,
        'xml.illegal-character',
        'The document contains a character forbidden by XML 1.0.',
        'Remove the illegal control character and try again.'
      )
    )
  }

  const encoding = declarationEncoding(rawXml)
  if (encoding && !/^(?:utf-?8|us-ascii)$/i.test(encoding.value.trim())) {
    issues.push(
      issueAt(
        rawXml,
        encoding.offset,
        'xml.unsupported-encoding',
        `Encoding "${encoding.value}" is not supported after text decoding.`,
        'Convert the source to UTF-8 before importing it.'
      )
    )
  }

  const forbiddenDeclarations: Array<[RegExp, string, string]> = [
    [
      /<!DOCTYPE\b/i,
      'xml.doctype',
      'DOCTYPE declarations are forbidden because they can enable external entity attacks.'
    ],
    [
      /<!ENTITY\b/i,
      'xml.entity-declaration',
      'Entity declarations are forbidden because entity expansion is not supported.'
    ]
  ]
  for (const [pattern, code, message] of forbiddenDeclarations) {
    const match = pattern.exec(xml)
    if (match) issues.push(issueAt(xml, match.index, code, message, 'Remove the declaration.'))
  }

  const xinclude = /<(?:[A-Za-z_][\w.-]*:)?include\b[^>]*(?:href|xpointer)\s*=/i.exec(xml)
  if (xinclude) {
    issues.push(
      issueAt(
        xml,
        xinclude.index,
        'xml.external-include',
        'External XML includes are forbidden.',
        'Inline the required BPMN content instead of referencing an external resource.'
      )
    )
  }

  const processingInstructions = /<\?([A-Za-z_][\w.-]*)\b/g
  let processingInstruction: RegExpExecArray | null
  while ((processingInstruction = processingInstructions.exec(xml)) !== null) {
    if (processingInstruction[1].toLowerCase() !== 'xml') {
      issues.push(
        issueAt(
          xml,
          processingInstruction.index,
          'xml.processing-instruction',
          `Processing instruction "${processingInstruction[1]}" is not allowed.`
        )
      )
    } else if (processingInstruction.index !== 0 && !/^\uFEFF?\s*$/.test(rawXml.slice(0, processingInstruction.index))) {
      issues.push(
        issueAt(
          xml,
          processingInstruction.index,
          'xml.declaration-position',
          'The XML declaration must be the first item in the document.'
        )
      )
    }
  }

  let depth = 0
  let maxDepth = 0
  let elements = 0
  let cursor = 0
  while (cursor < xml.length) {
    const open = xml.indexOf('<', cursor)
    const textEnd = open === -1 ? xml.length : open
    if (textEnd - cursor > limits.maxTextNodeLength) {
      issues.push(
        issueAt(
          xml,
          cursor,
          'xml.text-limit',
          `An XML text node exceeds ${limits.maxTextNodeLength} characters.`
        )
      )
      break
    }
    if (open === -1) break

    if (xml.startsWith('<!--', open)) {
      const end = xml.indexOf('-->', open + 4)
      if (end === -1) break
      cursor = end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', open)) {
      const end = xml.indexOf(']]>', open + 9)
      if (end === -1) break
      if (end - (open + 9) > limits.maxTextNodeLength) {
        issues.push(
          issueAt(
            xml,
            open,
            'xml.text-limit',
            `A CDATA section exceeds ${limits.maxTextNodeLength} characters.`
          )
        )
      }
      cursor = end + 3
      continue
    }
    if (xml.startsWith('<?', open)) {
      const end = xml.indexOf('?>', open + 2)
      if (end === -1) break
      cursor = end + 2
      continue
    }

    const end = findTagEnd(xml, open)
    if (end === -1) break
    const tag = xml.slice(open, end + 1)
    if (/^<\//.test(tag)) {
      depth = Math.max(0, depth - 1)
    } else if (!/^<!/.test(tag)) {
      elements += 1
      depth += 1
      maxDepth = Math.max(maxDepth, depth)
      const tagMetrics = inspectStartTag(tag)
      if (tagMetrics.attributes > limits.maxAttributesPerElement) {
        issues.push(
          issueAt(
            xml,
            open,
            'xml.attribute-count-limit',
            `An element has ${tagMetrics.attributes} attributes; the limit is ${limits.maxAttributesPerElement}.`
          )
        )
      }
      if (tagMetrics.longestAttribute > limits.maxAttributeValueLength) {
        issues.push(
          issueAt(
            xml,
            open,
            'xml.attribute-value-limit',
            `An attribute value exceeds ${limits.maxAttributeValueLength} characters.`
          )
        )
      }
      if (elements > limits.maxElements) {
        issues.push(
          issueAt(
            xml,
            open,
            'xml.element-count-limit',
            `XML contains more than ${limits.maxElements} elements.`
          )
        )
        break
      }
      if (depth > limits.maxDepth) {
        issues.push(
          issueAt(
            xml,
            open,
            'xml.depth-limit',
            `XML nesting exceeds ${limits.maxDepth} levels.`
          )
        )
        break
      }
      if (/\/\s*>$/.test(tag)) depth -= 1
    }
    cursor = end + 1
  }

  const summary = createValidationSummary(issues, {
    stages: { preflight: issues.length === 0 ? 'passed' : 'failed' },
    xmlWellFormed: issues.length === 0
  })
  return {
    xml,
    summary,
    metrics: { bytes, elements, maxDepth },
    safeToParse: issues.length === 0
  }
}

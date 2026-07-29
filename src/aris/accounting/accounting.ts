import type { TokenizedXmlDocument, XmlElementNode, XmlNode } from '../source/xmlTokenizer'
import type {
  ArisAccountingDisposition,
  ArisAccountingEntry,
  ArisAccountingRecord,
  ArisAccountingSource,
  ArisEntityKind
} from './types'

/**
 * Default disposition for every recognized entity kind. Anything not explicitly
 * listed here is treated as `raw-source-only`.
 */
const DEFAULT_DISPOSITION_BY_KIND: Readonly<Record<ArisEntityKind, ArisAccountingDisposition>> = {
  'xml-declaration': 'raw-source-only',
  'xml-declaration-attribute': 'raw-source-only',
  doctype: 'raw-source-only',
  'document-root': 'raw-source-only',
  database: 'raw-source-only',
  group: 'raw-source-only',
  language: 'raw-source-only',
  'language-name': 'raw-source-only',
  model: 'editable-native',
  'model-attribute': 'side-panel',
  'object-definition': 'editable-native',
  'object-occurrence': 'visual-only',
  'connection-definition': 'editable-native',
  'connection-occurrence': 'visual-only',
  'attribute-definition': 'side-panel',
  'attribute-value': 'side-panel',
  'attribute-occurrence': 'visual-only',
  'styled-run': 'raw-source-only',
  flag: 'raw-source-only',
  assignment: 'side-panel',
  lane: 'visual-only',
  'free-text': 'visual-only',
  'free-text-occurrence': 'visual-only',
  'ole-definition': 'attachment',
  'ole-occurrence': 'attachment',
  blob: 'attachment',
  'font-style-sheet': 'raw-source-only',
  font: 'raw-source-only',
  pen: 'raw-source-only',
  brush: 'raw-source-only',
  position: 'visual-only',
  size: 'visual-only',
  'route-point': 'visual-only',
  'guid-reference': 'raw-source-only',
  'template-reference': 'raw-source-only',
  unknown: 'raw-source-only',
  text: 'raw-source-only',
  comment: 'raw-source-only',
  cdata: 'raw-source-only',
  'processing-instruction': 'raw-source-only',
  'element-attribute': 'raw-source-only'
}

const RECORD_KIND_TO_ENTITY_KIND: Readonly<Record<string, ArisEntityKind>> = {
  'document-root': 'document-root',
  database: 'database',
  group: 'group',
  language: 'language',
  model: 'model',
  'object-definition': 'object-definition',
  'object-occurrence': 'object-occurrence',
  'connection-definition': 'connection-definition',
  'connection-occurrence': 'connection-occurrence',
  attribute: 'attribute-definition',
  'attribute-occurrence': 'attribute-occurrence',
  lane: 'lane',
  'free-text': 'free-text',
  'free-text-occurrence': 'free-text-occurrence',
  attachment: 'ole-definition',
  'attachment-occurrence': 'ole-occurrence',
  blob: 'blob',
  'font-style-sheet': 'font-style-sheet',
  font: 'font',
  pen: 'pen',
  brush: 'brush',
  position: 'position',
  size: 'size',
  'guid-reference': 'guid-reference',
  unknown: 'unknown'
}

/**
 * Non-record elements that are preserved raw inside their parent record. The
 * mapping here is intentionally simple: it only names the kind that appears in
 * the accounting entry; the disposition is always `raw-source-only`.
 */
const ABSORBED_ELEMENT_KIND: Readonly<Record<string, ArisEntityKind>> = {
  LanguageName: 'language-name',
  AttrValue: 'attribute-value',
  StyledElement: 'styled-run',
  Paragraph: 'styled-run',
  PlainText: 'styled-run',
  Bold: 'styled-run',
  LineBreak: 'styled-run',
  Flag: 'flag'
}

interface StackFrame {
  readonly path: string
  readonly sourceId?: string
  readonly isModel: boolean
}

function entityKindForRecord(record: ArisAccountingRecord): ArisEntityKind {
  if (record.recordKind === 'attribute') {
    return record.parsedOwnerElementName === 'Model' ? 'model-attribute' : 'attribute-definition'
  }

  if (record.recordKind === 'position') {
    return record.parentElementName === 'CxnOcc' ? 'route-point' : 'position'
  }

  if (record.recordKind === 'guid-reference') {
    return record.elementName === 'TemplateGUID' ? 'template-reference' : 'guid-reference'
  }

  if (record.recordKind === 'attachment') {
    return record.elementName === 'OLEDef' ? 'ole-definition' : 'ole-occurrence'
  }

  return RECORD_KIND_TO_ENTITY_KIND[record.recordKind] ?? 'unknown'
}

function dispositionForKind(kind: ArisEntityKind): ArisAccountingDisposition {
  return DEFAULT_DISPOSITION_BY_KIND[kind] ?? 'raw-source-only'
}

function makeEntry(
  sourcePath: string,
  kind: ArisEntityKind,
  targetIds: readonly string[],
  sourceId?: string,
  reason?: string
): ArisAccountingEntry {
  return Object.freeze({
    sourcePath,
    sourceId,
    kind,
    disposition: dispositionForKind(kind),
    targetIds: Object.freeze([...targetIds]),
    reason,
    // `assignment` is the only derived (non-literal) entity kind this walk
    // produces today — see the `derived` field doc in `./types.ts`.
    derived: kind === 'assignment' ? true : undefined
  })
}

function parseElementNameFromPath(path: string): string | null {
  const match = path.match(/([^/[\]]+)(?:\[\d+\])?$/u)
  return match?.[1] ?? null
}

function buildElementPath(parentPath: string | null, name: string, index: number): string {
  return parentPath === null ? `${name}[${index}]` : `${parentPath}/${name}[${index}]`
}

function buildLeafPath(parentPath: string, kind: string, index: number): string {
  return `${parentPath}/${kind}()[${index}]`
}

/**
 * Build a complete set of accounting entries for every source construct in the
 * tokenized document, using the semantic index only to identify which elements
 * are records and what kind they represent.
 *
 * The walk is independent of the semantic indexer's classification tables: it
 * looks up each concrete element path in the adapter-supplied record map, and
 * falls back to raw-source accounting for everything else.
 */
export function buildAccountingEntries(
  document: TokenizedXmlDocument,
  source: ArisAccountingSource
): readonly ArisAccountingEntry[] {
  const recordByPath = new Map<string, ArisAccountingRecord>()
  for (const record of source.records) {
    // Superseded duplicate records share the same source ID but have different
    // paths, so the map is keyed by path to keep every concrete element.
    recordByPath.set(record.path, record)
  }

  const entries: ArisAccountingEntry[] = []
  const modelStack: StackFrame[] = []

  const currentModelId = (): string | undefined => {
    for (let i = modelStack.length - 1; i >= 0; i -= 1) {
      if (modelStack[i].isModel) return modelStack[i].sourceId
    }
    return undefined
  }

  const nearestRecordSourceId = (): string | undefined => {
    for (let i = modelStack.length - 1; i >= 0; i -= 1) {
      if (modelStack[i].sourceId) return modelStack[i].sourceId
    }
    return undefined
  }

  const visitElement = (
    node: XmlElementNode,
    parentPath: string | null,
    siblingCounts: Map<string, number>
  ): void => {
    const index = (siblingCounts.get(node.name) ?? 0) + 1
    siblingCounts.set(node.name, index)
    const path = buildElementPath(parentPath, node.name, index)

    const record = recordByPath.get(path)
    const kind = record
      ? entityKindForRecord(record)
      : (ABSORBED_ELEMENT_KIND[node.name] ?? 'unknown')
    const sourceId = record?.sourceId ?? undefined
    const isModel = kind === 'model'

    const modelId = currentModelId()
    const parentSourceId = nearestRecordSourceId()
    const targetIds: string[] = []
    if (sourceId) {
      targetIds.push(sourceId)
    } else if (parentSourceId) {
      targetIds.push(parentSourceId)
    }
    if (modelId && !targetIds.includes(modelId)) targetIds.push(modelId)

    entries.push(
      makeEntry(
        path,
        kind,
        targetIds,
        sourceId,
        record ? undefined : `unrecognized element <${node.name}> preserved as raw source`
      )
    )

    const frame: StackFrame = Object.freeze({ path, sourceId, isModel })
    modelStack.push(frame)

    for (const attribute of node.startTag.attributes) {
      const attributePath = `${path}@${attribute.name}`
      const attributeTargets = sourceId ? [sourceId] : modelId ? [modelId] : []
      entries.push(makeEntry(attributePath, 'element-attribute', attributeTargets))
    }

    const childSiblingCounts = new Map<string, number>()
    for (const child of node.children) {
      if (child.kind === 'element') {
        visitElement(child, path, childSiblingCounts)
      } else {
        visitLeaf(child, path, childSiblingCounts)
      }
    }

    modelStack.pop()
  }

  const visitLeaf = (
    node: XmlNode & { kind: 'text' | 'comment' | 'cdata' | 'processing-instruction' },
    parentPath: string,
    siblingCounts: Map<string, number>
  ): void => {
    const index = (siblingCounts.get(node.kind) ?? 0) + 1
    siblingCounts.set(node.kind, index)
    const path = buildLeafPath(parentPath, node.kind, index)
    const parentSourceId = nearestRecordSourceId()
    const modelId = currentModelId()
    const targetIds: string[] = []
    if (parentSourceId) targetIds.push(parentSourceId)
    if (modelId && !targetIds.includes(modelId)) targetIds.push(modelId)
    entries.push(makeEntry(path, node.kind, targetIds))
  }

  // XML declaration
  if (document.declaration) {
    entries.push(makeEntry('/xml-declaration', 'xml-declaration', []))
    if (document.declaration.version) {
      entries.push(makeEntry('/@version', 'xml-declaration-attribute', []))
    }
    if (document.declaration.encoding) {
      entries.push(makeEntry('/@encoding', 'xml-declaration-attribute', []))
    }
    if (document.declaration.standalone) {
      entries.push(makeEntry('/@standalone', 'xml-declaration-attribute', []))
    }
  }

  // DOCTYPE
  if (document.doctype) {
    entries.push(makeEntry('/doctype', 'doctype', []))
  }

  const rootSiblingCounts = new Map<string, number>()
  for (const child of document.children) {
    if (child.kind === 'element') {
      visitElement(child, null, rootSiblingCounts)
    } else {
      // Top-level leaf nodes are anchored to a synthetic parent path.
      visitLeaf(child, '', rootSiblingCounts)
    }
  }

  // Derived semantic records: linked-model assignments are not separate XML
  // elements, so they are appended as synthetic entries anchored to the owning
  // object definition path.
  for (let i = 0; i < source.assignments.length; i += 1) {
    const assignment = source.assignments[i]
    const path = `${assignment.objectDefinitionPath}#assignment[${i + 1}]`
    const targetIds: string[] = []
    if (assignment.objectDefinitionId) targetIds.push(assignment.objectDefinitionId)
    targetIds.push(assignment.modelId)
    entries.push(
      makeEntry(path, 'assignment', targetIds, assignment.objectDefinitionId ?? undefined)
    )
  }

  return Object.freeze(entries)
}

/**
 * Extract the element tag name from an accounting entry's source path.
 *
 * Returns `null` for derived or non-element paths (attributes, leaf nodes,
 * synthetic assignment paths).
 */
export function elementNameFromEntryPath(sourcePath: string): string | null {
  if (
    sourcePath.startsWith('/@') ||
    sourcePath.includes('@') ||
    sourcePath.includes('#') ||
    sourcePath.includes('()')
  ) {
    return null
  }
  return parseElementNameFromPath(sourcePath)
}

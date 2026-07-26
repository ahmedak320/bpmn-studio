import BpmnModdle from 'bpmn-moddle'
import { orbitpmModdleDescriptor } from '../org/orbitpmModdle'
import {
  createValidationSummary,
  validationIssue,
  type ValidationIssue,
  type ValidationSummary
} from './contracts'
import { preflightXml } from './preflight'

interface GenericElement {
  $type?: string
  $parent?: GenericElement
  $attrs?: Record<string, unknown>
  $children?: GenericElement[]
  id?: string
  [key: string]: unknown
}

interface ImportResult {
  rootElement?: GenericElement
}

interface ModdleLike {
  fromXML(xml: string): Promise<ImportResult>
}

const KNOWN_NAMESPACE_URIS = new Set([
  'http://www.omg.org/spec/BPMN/20100524/MODEL',
  'http://www.omg.org/spec/BPMN/20100524/DI',
  'http://www.omg.org/spec/DD/20100524/DC',
  'http://www.omg.org/spec/DD/20100524/DI',
  'http://orbitpm.ae/schema/bpmn/1.0',
  'http://www.w3.org/2001/XMLSchema-instance',
  'http://www.w3.org/2001/XMLSchema',
  'http://www.w3.org/XML/1998/namespace'
])

export interface UnknownExtensionSnapshot {
  /** Canonical semantic signature, including placement and namespace URIs. */
  signature: string
  kind: 'element' | 'attribute'
  namespaceUri: string
  localName: string
  parentElementId?: string
}

function namespaceMap(xml: string): Map<string, string> {
  const namespaces = new Map<string, string>()
  const declaration = /\bxmlns(?::([A-Za-z_][\w.-]*))?\s*=\s*(['"])(.*?)\2/g
  let match: RegExpExecArray | null
  while ((match = declaration.exec(xml)) !== null) {
    namespaces.set(match[1] ?? '', match[3])
  }
  namespaces.set('xml', 'http://www.w3.org/XML/1998/namespace')
  return namespaces
}

function splitQName(qname: string): { prefix: string; localName: string } {
  const colon = qname.indexOf(':')
  return colon < 0
    ? { prefix: '', localName: qname }
    : { prefix: qname.slice(0, colon), localName: qname.slice(colon + 1) }
}

function semanticName(
  qname: string,
  namespaces: ReadonlyMap<string, string>,
  attribute: boolean
): { namespaceUri: string; localName: string; semantic: string } {
  const { prefix, localName } = splitQName(qname)
  const namespaceUri = prefix ? namespaces.get(prefix) ?? `unbound:${prefix}` : attribute ? '' : namespaces.get('') ?? ''
  return {
    namespaceUri,
    localName,
    semantic: `{${namespaceUri}}${localName}`
  }
}

function stableObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableObject)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, stableObject(entry)])
  )
}

function canonicalUnknownElement(
  element: GenericElement,
  namespaces: ReadonlyMap<string, string>
): unknown {
  const typeName = semanticName(element.$type ?? '', namespaces, false)
  const attributes: Record<string, string> = {}
  for (const [key, value] of Object.entries(element)) {
    if (key.startsWith('$') || typeof value === 'object' || value === undefined) continue
    const attrName = semanticName(key, namespaces, true)
    attributes[attrName.semantic] = String(value)
  }
  for (const [key, value] of Object.entries(element.$attrs ?? {})) {
    if (value === undefined) continue
    const attrName = semanticName(key, namespaces, true)
    attributes[attrName.semantic] = String(value)
  }
  return stableObject({
    type: typeName.semantic,
    attributes,
    body: typeof element.$body === 'string' ? element.$body : undefined,
    children: (element.$children ?? []).map((child) =>
      canonicalUnknownElement(child, namespaces)
    )
  })
}

function containmentChildren(element: GenericElement): GenericElement[] {
  const children: GenericElement[] = []
  for (const [key, value] of Object.entries(element)) {
    if (
      key === '$parent' ||
      key === '$attrs' ||
      key === '$model' ||
      key === '$descriptor' ||
      key === '$children'
    ) {
      continue
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry && typeof entry === 'object' && typeof (entry as GenericElement).$type === 'string') {
          children.push(entry as GenericElement)
        }
      }
    } else if (value && typeof value === 'object' && typeof (value as GenericElement).$type === 'string') {
      children.push(value as GenericElement)
    }
  }
  return children
}

function nearestKnownAnchor(element: GenericElement | undefined): {
  type?: string
  id?: string
} {
  let current = element
  let fallback: { type?: string; id?: string } = {}
  while (current) {
    if (current.$type) {
      const candidate = {
        type: current.$type,
        id: typeof current.id === 'string' ? current.id : undefined
      }
      if (!fallback.type) fallback = candidate
      if (candidate.id) return candidate
    }
    current = current.$parent
  }
  return fallback
}

function snapshotsFromRoot(
  root: GenericElement,
  namespaces: ReadonlyMap<string, string>
): UnknownExtensionSnapshot[] {
  const snapshots: UnknownExtensionSnapshot[] = []
  const visited = new Set<object>()

  const visit = (element: GenericElement): void => {
    if (visited.has(element)) return
    visited.add(element)
    const elementName = semanticName(element.$type ?? '', namespaces, false)
    const isUnknownElement =
      Boolean(element.$type) && !KNOWN_NAMESPACE_URIS.has(elementName.namespaceUri)

    if (isUnknownElement) {
      const anchor = nearestKnownAnchor(element.$parent)
      snapshots.push({
        signature: JSON.stringify(
          stableObject({
            kind: 'element',
            parentType: anchor.type,
            parentId: anchor.id,
            value: canonicalUnknownElement(element, namespaces)
          })
        ),
        kind: 'element',
        namespaceUri: elementName.namespaceUri,
        localName: elementName.localName,
        parentElementId: anchor.id
      })
      // The canonical element already contains the complete opaque subtree.
      return
    }

    for (const [qname, value] of Object.entries(element.$attrs ?? {})) {
      // moddle exposes namespace declarations in `$attrs`; they are namespace
      // plumbing, not opaque vendor payload.
      if (qname === 'xmlns' || qname.startsWith('xmlns:')) continue
      const attrName = semanticName(qname, namespaces, true)
      if (!attrName.namespaceUri || KNOWN_NAMESPACE_URIS.has(attrName.namespaceUri)) continue
      snapshots.push({
        signature: JSON.stringify(
          stableObject({
            kind: 'attribute',
            parentType: elementName.semantic,
            parentId: element.id,
            name: attrName.semantic,
            value: String(value)
          })
        ),
        kind: 'attribute',
        namespaceUri: attrName.namespaceUri,
        localName: attrName.localName,
        parentElementId: typeof element.id === 'string' ? element.id : undefined
      })
    }

    for (const child of containmentChildren(element)) visit(child)
    // Generic extension children live under the special `$children` key.
    for (const child of element.$children ?? []) visit(child)
  }

  visit(root)
  return snapshots.sort((a, b) => a.signature.localeCompare(b.signature))
}

async function parseForSnapshot(xml: string): Promise<GenericElement> {
  const moddle = new BpmnModdle({
    orbitpm: orbitpmModdleDescriptor as unknown as Record<string, unknown>
  }) as unknown as ModdleLike
  const parsed = await moddle.fromXML(xml)
  if (!parsed.rootElement) throw new Error('bpmn-moddle did not return a root element')
  return parsed.rootElement
}

/**
 * Capture all non-BPMN/non-OrbitPM extension elements and attributes without
 * serializing the source. Prefix changes are normalized to namespace URIs;
 * value, structure and placement changes remain observable.
 */
export async function snapshotUnknownExtensions(
  xml: string
): Promise<readonly UnknownExtensionSnapshot[]> {
  const preflight = preflightXml(xml)
  if (!preflight.safeToParse) {
    throw new Error('Cannot snapshot extensions from XML that failed secure preflight.')
  }
  const root = await parseForSnapshot(preflight.xml)
  return snapshotsFromRoot(root, namespaceMap(preflight.xml))
}

function shortFingerprint(signature: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < signature.length; index += 1) {
    hash ^= signature.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Release-blocking guard used before replacing original XML with a serialized
 * candidate. It detects dropped, mutated or rerouted opaque vendor content.
 */
export async function validateUnknownExtensionPreservation(
  originalXml: string,
  candidateXml: string
): Promise<ValidationSummary> {
  const issues: ValidationIssue[] = []
  let before: readonly UnknownExtensionSnapshot[]
  let after: readonly UnknownExtensionSnapshot[]
  try {
    ;[before, after] = await Promise.all([
      snapshotUnknownExtensions(originalXml),
      snapshotUnknownExtensions(candidateXml)
    ])
  } catch (error) {
    issues.push(
      validationIssue({
        code: 'preservation.snapshot-failed',
        severity: 'error',
        source: 'preservation',
        message: `Extension preservation could not be verified: ${
          error instanceof Error ? error.message : String(error)
        }`,
        suggestedRepair: 'Keep the original XML unchanged until preservation can be verified.'
      })
    )
    return createValidationSummary(issues, {
      stages: { preservation: 'failed' }
    })
  }

  const afterCounts = new Map<string, number>()
  for (const snapshot of after) {
    afterCounts.set(snapshot.signature, (afterCounts.get(snapshot.signature) ?? 0) + 1)
  }

  for (const snapshot of before) {
    const remaining = afterCounts.get(snapshot.signature) ?? 0
    if (remaining > 0) {
      afterCounts.set(snapshot.signature, remaining - 1)
      continue
    }
    issues.push(
      validationIssue({
        code:
          snapshot.kind === 'element'
            ? 'preservation.extension-element-changed'
            : 'preservation.extension-attribute-changed',
        severity: 'error',
        source: 'preservation',
        message: `Unknown extension ${snapshot.kind} {${snapshot.namespaceUri}}${snapshot.localName} was removed, changed or moved.`,
        elementId: snapshot.parentElementId,
        suggestedRepair: 'Restore the opaque vendor content byte-semantically or keep the original XML.',
        details: {
          namespace: snapshot.namespaceUri,
          localName: snapshot.localName,
          fingerprint: shortFingerprint(snapshot.signature)
        }
      })
    )
  }

  return createValidationSummary(issues, {
    stages: { preservation: issues.length === 0 ? 'passed' : 'failed' }
  })
}

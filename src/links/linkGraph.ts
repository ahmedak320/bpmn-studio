// Workspace-wide call-activity link graph. Resolution is based on BPMN
// process ids, while relPaths remain mutable locators used by the existing
// manifest/export integration.
//
// A process id must have exactly one declaration in the workspace before it
// can participate in a resolved link. This is intentionally stricter than
// ProcessIndex's last-wins behaviour: picking one of two duplicate ids would
// make a generated file name look like identity and could open the wrong
// process.

import type { ProcessIndex } from '@/core/processIndex'

/** Why a call activity could not safely become a process-pair link. */
export type LinkResolutionIssueReason =
  | 'missing-parent-process'
  | 'ambiguous-parent-process'
  | 'missing-child-process'
  | 'ambiguous-child-process'

/** Process-scoped attribution for an unresolved or ambiguous call activity. */
export interface UnresolvedLink {
  parentRelPath: string
  parentProcessId?: string
  callActivityId?: string
  calledElement: string
  reason: LinkResolutionIssueReason
  ambiguous: boolean
  /** Sorted candidate locators. Duplicates are retained when two declarations
   *  with the same id occur in one physical file. */
  candidateRelPaths: string[]
}

/**
 * One resolved process-pair reference. Repeated call activities aggregate
 * into the same edge, independently of either process's current file name.
 */
export interface LinkEdge {
  /** Stable identity derived only from (parentProcessId, childProcessId). */
  key: string
  parentRelPath: string
  parentProcessId: string
  childRelPath: string
  childProcessId: string
  /** Kept for compatibility with file/manifest consumers. */
  calledElement: string
  /** Existing, non-empty call-activity ids in lexical order. */
  callActivityIds: string[]
  /** Number of call-activity occurrences, including ones without an id. */
  count: number
  /** Distinct non-self parent process ids that reference this child. */
  distinctParentCount: number
}

/** Process-focused alias used by hierarchy consumers. */
export type ProcessLink = LinkEdge

export interface LinkGraph {
  /** Stable process-pair links sorted by parent id, then child id. */
  links: LinkEdge[]
  /** parent process id → its sorted process-pair links. */
  childrenByProcess: Map<string, LinkEdge[]>
  /** child process id → its sorted process-pair links. */
  parentsByProcess: Map<string, LinkEdge[]>
  /** child process id → number of distinct non-self parents. */
  distinctParentCountByProcess: Map<string, number>
  /** Every process id declared more than once, sorted by id iteration order. */
  ambiguousProcessIds: ReadonlySet<string>

  /** parent relPath → resolved process-pair links. Retained for manifest and
   *  current file-tree compatibility. */
  childrenByFile: Map<string, LinkEdge[]>
  /** child relPath → the links pointing at it (same LinkEdge objects). */
  parentsByFile: Map<string, LinkEdge[]>
  /** parent relPath → calledElement values that were not safely resolved,
   *  deduped and sorted. Empty/absent calledElement is not unresolved. */
  unresolvedByFile: Map<string, string[]>

  /** Detailed, process-scoped unresolved attribution in deterministic order. */
  unresolvedLinks: UnresolvedLink[]
  /** parent process id → detailed unresolved calls originating in it. */
  unresolvedByProcess: Map<string, UnresolvedLink[]>
  /** parent relPath → the ambiguous subset of unresolvedLinks. */
  ambiguousByFile: Map<string, UnresolvedLink[]>
}

interface ProcessDeclaration {
  processId?: string
  relPath: string
  bodyStart: number
  bodyEnd: number
}

interface ScannedCall {
  parentRelPath: string
  parentProcessId?: string
  callActivityId?: string
  calledElement: string
}

interface LinkAggregate {
  key: string
  parentRelPath: string
  parentProcessId: string
  childRelPath: string
  childProcessId: string
  callActivityIds: string[]
  count: number
}

// The process scanner records opening/closing offsets so each call activity
// is attributed to the process that actually contains it. BPMN processes are
// not nested, but the stack also behaves predictably for malformed input.
const PROCESS_TAG_RE = /<\s*(\/?)(?:[a-zA-Z_][\w.-]*:)?process\b([^>]*?)>/g
const CALL_ACTIVITY_TAG_RE = /<(?:[a-zA-Z_][\w.-]*:)?callActivity\b([^>]*?)\/?>/g
// `^|\s` is deliberate: XML namespace/data prefixes must not be mistaken for
// the standard unprefixed BPMN attributes (for example ext:id or data-id).
const ID_ATTR_RE = /(?:^|\s)id\s*=\s*(?:"([^"]*)"|'([^']*)')/
const CALLED_ELEMENT_ATTR_RE = /(?:^|\s)calledElement\s*=\s*(?:"([^"]*)"|'([^']*)')/
const XML_COMMENT_OR_CDATA_RE = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/g

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function compareOptional(a: string | undefined, b: string | undefined): number {
  return compare(a ?? '', b ?? '')
}

/**
 * Regex scanning must not interpret tag-shaped examples in comments or
 * CDATA. Replacing those regions with equal-length whitespace preserves the
 * source offsets used to associate calls with their containing process.
 */
function maskCommentsAndCdata(xml: string): string {
  return xml.replace(XML_COMMENT_OR_CDATA_RE, (region) => ' '.repeat(region.length))
}

/**
 * Collision-free, path-independent identity for a process-pair link.
 * JSON tuple encoding also keeps unusual-but-valid ids unambiguous.
 */
export function processLinkKey(parentProcessId: string, childProcessId: string): string {
  return JSON.stringify([parentProcessId, childProcessId])
}

function scanProcessDeclarations(xml: string, relPath: string): ProcessDeclaration[] {
  const declarations: ProcessDeclaration[] = []
  const open: ProcessDeclaration[] = []
  const scanXml = maskCommentsAndCdata(xml)

  PROCESS_TAG_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PROCESS_TAG_RE.exec(scanXml)) !== null) {
    const closing = match[1] === '/'
    if (closing) {
      const declaration = open.pop()
      if (declaration) declaration.bodyEnd = match.index
      continue
    }

    const attrs = match[2] ?? ''
    const idMatch = ID_ATTR_RE.exec(attrs)
    const rawId = idMatch ? (idMatch[1] ?? idMatch[2] ?? '') : ''
    const processId = rawId ? decodeXmlEntities(rawId) : undefined
    const declaration: ProcessDeclaration = {
      processId,
      relPath,
      bodyStart: PROCESS_TAG_RE.lastIndex,
      bodyEnd: scanXml.length
    }
    declarations.push(declaration)

    // A self-closing process has no body in which a call can originate.
    if (!/\/\s*$/.test(attrs)) open.push(declaration)
    else declaration.bodyEnd = declaration.bodyStart
  }

  return declarations
}

function containingProcess(
  declarations: ProcessDeclaration[],
  offset: number
): ProcessDeclaration | undefined {
  let containing: ProcessDeclaration | undefined
  for (const declaration of declarations) {
    if (offset < declaration.bodyStart || offset >= declaration.bodyEnd) continue
    if (!containing || declaration.bodyStart > containing.bodyStart) containing = declaration
  }
  return containing
}

function scanCalls(
  xml: string,
  relPath: string,
  declarations: ProcessDeclaration[]
): ScannedCall[] {
  const calls: ScannedCall[] = []
  const scanXml = maskCommentsAndCdata(xml)
  CALL_ACTIVITY_TAG_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CALL_ACTIVITY_TAG_RE.exec(scanXml)) !== null) {
    const attrs = match[1] ?? ''
    const calledMatch = CALLED_ELEMENT_ATTR_RE.exec(attrs)
    if (!calledMatch) continue
    const calledElement = decodeXmlEntities(calledMatch[1] ?? calledMatch[2] ?? '')
    if (!calledElement) continue

    const idMatch = ID_ATTR_RE.exec(attrs)
    const rawId = idMatch ? (idMatch[1] ?? idMatch[2] ?? '') : ''
    const callActivityId = rawId ? decodeXmlEntities(rawId) : undefined
    calls.push({
      parentRelPath: relPath,
      parentProcessId: containingProcess(declarations, match.index)?.processId,
      callActivityId,
      calledElement
    })
  }
  return calls
}

function issueFor(
  call: ScannedCall,
  reason: LinkResolutionIssueReason,
  candidates: ProcessDeclaration[]
): UnresolvedLink {
  return {
    ...call,
    reason,
    ambiguous: reason === 'ambiguous-parent-process' || reason === 'ambiguous-child-process',
    candidateRelPaths: candidates.map((candidate) => candidate.relPath).sort(compare)
  }
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const list = grouped.get(key)
    if (list) list.push(item)
    else grouped.set(key, [item])
  }
  return new Map(Array.from(grouped.entries()).sort(([a], [b]) => compare(a, b)))
}

function compareIssues(a: UnresolvedLink, b: UnresolvedLink): number {
  return (
    compare(a.parentRelPath, b.parentRelPath) ||
    compareOptional(a.parentProcessId, b.parentProcessId) ||
    compare(a.calledElement, b.calledElement) ||
    compareOptional(a.callActivityId, b.callActivityId) ||
    compare(a.reason, b.reason)
  )
}

/**
 * Build the graph for a workspace snapshot without mutating the files or
 * ProcessIndex. File input is normalized by relPath and sorted, so shuffled
 * workspace snapshots produce the same graph.
 */
export function buildLinkGraph(
  files: ReadonlyArray<{ relPath: string; xml: string }>,
  index: ProcessIndex
): LinkGraph {
  // The argument remains part of the public API for existing callers. Unique
  // declarations found in `files` are authoritative here because the shared
  // ProcessIndex intentionally uses last-wins duplicate handling and its
  // legacy attribute scanner is less strict than this graph's resolver.
  void index

  // Workspace snapshots should contain each relPath once. Deduplicating here
  // preserves the old duplicate-input guarantee. If an invalid snapshot
  // repeats a relPath with different XML, lexical selection keeps the result
  // independent of input order.
  const uniqueFilesByPath = new Map<string, { relPath: string; xml: string }>()
  for (const file of files) {
    const existing = uniqueFilesByPath.get(file.relPath)
    if (!existing || compare(file.xml, existing.xml) < 0) uniqueFilesByPath.set(file.relPath, file)
  }
  const uniqueFiles = Array.from(uniqueFilesByPath.values()).sort((a, b) =>
    compare(a.relPath, b.relPath)
  )

  const declarationsByFile = new Map<string, ProcessDeclaration[]>()
  const candidatesByProcessId = new Map<string, ProcessDeclaration[]>()
  for (const file of uniqueFiles) {
    const declarations = scanProcessDeclarations(file.xml, file.relPath)
    declarationsByFile.set(file.relPath, declarations)
    for (const declaration of declarations) {
      if (!declaration.processId) continue
      const candidates = candidatesByProcessId.get(declaration.processId)
      if (candidates) candidates.push(declaration)
      else candidatesByProcessId.set(declaration.processId, [declaration])
    }
  }

  const ambiguousIds = Array.from(candidatesByProcessId.entries())
    .filter(([, candidates]) => candidates.length > 1)
    .map(([processId]) => processId)
    .sort(compare)
  const ambiguousProcessIds: ReadonlySet<string> = new Set(ambiguousIds)

  const aggregates = new Map<string, LinkAggregate>()
  const unresolvedLinks: UnresolvedLink[] = []

  for (const file of uniqueFiles) {
    if (!file.xml) continue
    const declarations = declarationsByFile.get(file.relPath) ?? []
    for (const call of scanCalls(file.xml, file.relPath, declarations)) {
      if (!call.parentProcessId) {
        unresolvedLinks.push(issueFor(call, 'missing-parent-process', []))
        continue
      }

      const parentCandidates = candidatesByProcessId.get(call.parentProcessId) ?? []
      if (parentCandidates.length !== 1) {
        unresolvedLinks.push(issueFor(call, 'ambiguous-parent-process', parentCandidates))
        continue
      }

      const childCandidates = candidatesByProcessId.get(call.calledElement) ?? []
      if (childCandidates.length > 1) {
        unresolvedLinks.push(issueFor(call, 'ambiguous-child-process', childCandidates))
        continue
      }
      if (childCandidates.length === 0) {
        unresolvedLinks.push(issueFor(call, 'missing-child-process', []))
        continue
      }

      const child = childCandidates[0]
      const key = processLinkKey(call.parentProcessId, call.calledElement)
      const existing = aggregates.get(key)
      if (existing) {
        existing.count += 1
        if (call.callActivityId) existing.callActivityIds.push(call.callActivityId)
      } else {
        aggregates.set(key, {
          key,
          parentRelPath: file.relPath,
          parentProcessId: call.parentProcessId,
          childRelPath: child.relPath,
          childProcessId: call.calledElement,
          callActivityIds: call.callActivityId ? [call.callActivityId] : [],
          count: 1
        })
      }
    }
  }

  const sortedAggregates = Array.from(aggregates.values()).sort(
    (a, b) =>
      compare(a.parentProcessId, b.parentProcessId) || compare(a.childProcessId, b.childProcessId)
  )
  const parentIdsByChild = new Map<string, Set<string>>()
  for (const aggregate of sortedAggregates) {
    if (aggregate.parentProcessId === aggregate.childProcessId) continue
    const parents = parentIdsByChild.get(aggregate.childProcessId)
    if (parents) parents.add(aggregate.parentProcessId)
    else parentIdsByChild.set(aggregate.childProcessId, new Set([aggregate.parentProcessId]))
  }

  const distinctParentCountByProcess = new Map<string, number>()
  const linkedChildProcessIds = Array.from(
    new Set(sortedAggregates.map((aggregate) => aggregate.childProcessId))
  ).sort(compare)
  for (const childProcessId of linkedChildProcessIds) {
    distinctParentCountByProcess.set(
      childProcessId,
      parentIdsByChild.get(childProcessId)?.size ?? 0
    )
  }

  const links: LinkEdge[] = sortedAggregates.map((aggregate) => ({
    ...aggregate,
    calledElement: aggregate.childProcessId,
    callActivityIds: aggregate.callActivityIds.sort(compare),
    distinctParentCount: distinctParentCountByProcess.get(aggregate.childProcessId) ?? 0
  }))

  const childrenByProcess = groupBy(links, (link) => link.parentProcessId)
  const parentsByProcess = groupBy(links, (link) => link.childProcessId)
  const childrenByFile = groupBy(links, (link) => link.parentRelPath)
  const parentsByFile = groupBy(links, (link) => link.childRelPath)

  unresolvedLinks.sort(compareIssues)
  const unresolvedByProcess = groupBy(
    unresolvedLinks.filter(
      (issue): issue is UnresolvedLink & { parentProcessId: string } =>
        issue.parentProcessId !== undefined
    ),
    (issue) => issue.parentProcessId
  )
  const ambiguousByFile = groupBy(
    unresolvedLinks.filter((issue) => issue.ambiguous),
    (issue) => issue.parentRelPath
  )

  const unresolvedValuesByFile = new Map<string, Set<string>>()
  for (const issue of unresolvedLinks) {
    const values = unresolvedValuesByFile.get(issue.parentRelPath)
    if (values) values.add(issue.calledElement)
    else unresolvedValuesByFile.set(issue.parentRelPath, new Set([issue.calledElement]))
  }
  const unresolvedByFile = new Map<string, string[]>()
  for (const relPath of Array.from(unresolvedValuesByFile.keys()).sort(compare)) {
    unresolvedByFile.set(
      relPath,
      Array.from(unresolvedValuesByFile.get(relPath) ?? []).sort(compare)
    )
  }

  return {
    links,
    childrenByProcess,
    parentsByProcess,
    distinctParentCountByProcess,
    ambiguousProcessIds,
    childrenByFile,
    parentsByFile,
    unresolvedByFile,
    unresolvedLinks,
    unresolvedByProcess,
    ambiguousByFile
  }
}

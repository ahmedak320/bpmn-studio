/**
 * A deliberately minimal AML scan used only by the layout tests.
 *
 * It exists so the layout lane can validate itself against real ARIS data
 * without depending on the semantic index, which is being rewritten in
 * parallel. It reads nothing but what a layout needs: object occurrences with
 * their symbol, size and source position, and connection occurrences with
 * their type. No private content is retained — the helper returns topology and
 * geometry only.
 */

import type {
  ArisLayoutEdgeInput,
  ArisLayoutGraphInput,
  ArisLayoutLaneInput,
  ArisLayoutNodeInput,
  ArisLayoutNodeRole,
  ArisLayoutRuleOperator
} from '../types'

export interface AmlModelGraph {
  readonly graph: ArisLayoutGraphInput
  readonly modelType: string
  readonly laneCount: number
  readonly objectOccurrenceCount: number
  readonly connectionOccurrenceCount: number
  readonly routePointCount: number
}

function attributesOf(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([A-Za-z0-9_.]+)="([^"]*)"/g
  let match = pattern.exec(tag)
  while (match !== null) {
    attributes[match[1] as string] = match[2] as string
    match = pattern.exec(tag)
  }
  return attributes
}

function roleOf(objectType: string | undefined): ArisLayoutNodeRole {
  switch (objectType) {
    case 'OT_FUNC':
      return 'function'
    case 'OT_EVT':
      return 'event'
    case 'OT_RULE':
      return 'rule'
    default:
      return 'satellite'
  }
}

function operatorOf(symbol: string | undefined): ArisLayoutRuleOperator | undefined {
  if (!symbol) return undefined
  if (symbol.startsWith('ST_OPR_XOR')) return 'xor'
  if (symbol.startsWith('ST_OPR_AND')) return 'and'
  if (symbol.startsWith('ST_OPR_OR')) return 'or'
  return undefined
}

/** Split every `<Model …>…</Model>` element out of the export. */
function modelChunks(xml: string): string[] {
  const chunks: string[] = []
  const pattern = /<Model\s[^>]*>/g
  let match = pattern.exec(xml)
  while (match !== null) {
    const end = xml.indexOf('</Model>', match.index)
    chunks.push(end === -1 ? xml.slice(match.index) : xml.slice(match.index, end))
    match = pattern.exec(xml)
  }
  return chunks
}

/**
 * Extract one layout graph per model.
 *
 * An object occurrence becomes a node; a connection occurrence becomes an edge
 * from its enclosing occurrence to `ToObjOcc.IdRef`. A connection counts as
 * control flow when both of its endpoints are EPC core objects
 * (`OT_FUNC`/`OT_EVT`/`OT_RULE`) and as a satellite attachment otherwise.
 */
export function extractAmlLayoutGraphs(xml: string): AmlModelGraph[] {
  const objectTypeByDefinition = new Map<string, string>()
  const objectDefinitionPattern = /<ObjDef\s[^>]*>/g
  let objectDefinitionMatch = objectDefinitionPattern.exec(xml)
  while (objectDefinitionMatch !== null) {
    const attributes = attributesOf(objectDefinitionMatch[0])
    const id = attributes['ObjDef.ID']
    const type = attributes['TypeNum']
    if (id && type) objectTypeByDefinition.set(id, type)
    objectDefinitionMatch = objectDefinitionPattern.exec(xml)
  }

  const results: AmlModelGraph[] = []
  for (const chunk of modelChunks(xml)) {
    const modelAttributes = attributesOf(/<Model\s[^>]*>/.exec(chunk)?.[0] ?? '')
    const nodes: ArisLayoutNodeInput[] = []
    const nodeRole = new Map<string, ArisLayoutNodeRole>()
    const rawEdges: {
      id: string
      source: string
      target: string
      route: { x: number; y: number }[]
    }[] = []
    const lanes: ArisLayoutLaneInput[] = []

    let currentNode: {
      id: string
      role: ArisLayoutNodeRole
      operator?: ArisLayoutRuleOperator
      x?: number
      y?: number
      width?: number
      height?: number
    } | null = null
    let currentEdge: { id: string; route: { x: number; y: number }[] } | null = null
    let routePointCount = 0

    const flush = (): void => {
      if (!currentNode) return
      const node: ArisLayoutNodeInput = {
        id: currentNode.id,
        role: currentNode.role,
        ...(currentNode.operator ? { operator: currentNode.operator } : {}),
        size: {
          width: Math.max(1, currentNode.width ?? 1),
          height: Math.max(1, currentNode.height ?? 1)
        },
        sourcePosition: { x: currentNode.x ?? 0, y: currentNode.y ?? 0 }
      }
      nodes.push(node)
      nodeRole.set(node.id, node.role)
      currentNode = null
    }

    // Close tags matter: a `<Position>` that belongs to a free-text record or
    // to a lane must not be mistaken for an occurrence position or a route
    // point, so the scan tracks which element it is currently inside.
    const pattern = /<(\/?)(ObjOcc|CxnOcc|Position|Size|Lane)\b[^>]*>/g
    let match = pattern.exec(chunk)
    while (match !== null) {
      const closing = match[1] === '/'
      const tag = match[2] as string
      const attributes = attributesOf(match[0])
      if (closing) {
        if (tag === 'CxnOcc') currentEdge = null
        else if (tag === 'ObjOcc') {
          flush()
          currentEdge = null
        }
        match = pattern.exec(chunk)
        continue
      }
      if (tag === 'ObjOcc') {
        flush()
        currentEdge = null
        const symbol = attributes['SymbolNum']
        currentNode = {
          id: attributes['ObjOcc.ID'] as string,
          role: roleOf(objectTypeByDefinition.get(attributes['ObjDef.IdRef'] ?? '')),
          operator: operatorOf(symbol)
        }
      } else if (tag === 'Lane') {
        flush()
        currentEdge = null
        lanes.push({
          id: attributes['Lane.ID'] as string,
          orientation: attributes['Orientation'] === 'VERTICAL' ? 'vertical' : 'horizontal'
        })
      } else if (tag === 'CxnOcc') {
        const owner = currentNode?.id
        currentEdge = { id: attributes['CxnOcc.ID'] as string, route: [] }
        if (owner && attributes['ToObjOcc.IdRef']) {
          rawEdges.push({
            id: currentEdge.id,
            source: owner,
            target: attributes['ToObjOcc.IdRef'] as string,
            route: currentEdge.route
          })
        }
      } else if (tag === 'Position') {
        const x = Number(attributes['Pos.X'])
        const y = Number(attributes['Pos.Y'])
        if (currentEdge) {
          routePointCount += 1
          currentEdge.route.push({ x, y })
        } else if (currentNode && currentNode.x === undefined) {
          currentNode.x = x
          currentNode.y = y
        }
      } else if (tag === 'Size') {
        if (!currentEdge && currentNode && currentNode.width === undefined) {
          currentNode.width = Number(attributes['Size.dX'])
          currentNode.height = Number(attributes['Size.dY'])
        }
      }
      match = pattern.exec(chunk)
    }
    flush()

    const known = new Set(nodes.map((node) => node.id))
    const core = new Set<ArisLayoutNodeRole>(['function', 'event', 'rule'])
    const edges: ArisLayoutEdgeInput[] = []
    for (const raw of rawEdges) {
      if (!known.has(raw.target)) continue
      const sourceRole = nodeRole.get(raw.source)
      const targetRole = nodeRole.get(raw.target)
      const isControl = core.has(sourceRole as ArisLayoutNodeRole) && core.has(targetRole as ArisLayoutNodeRole)
      edges.push({
        id: raw.id,
        source: raw.source,
        target: raw.target,
        kind: isControl ? 'control-flow' : 'satellite',
        ...(raw.route.length >= 2 ? { sourceRoute: raw.route } : {})
      })
    }

    results.push({
      graph: { id: modelAttributes['Model.ID'] as string, nodes, edges, lanes },
      modelType: modelAttributes['Model.Type'] as string,
      laneCount: lanes.length,
      objectOccurrenceCount: nodes.length,
      connectionOccurrenceCount: rawEdges.length,
      routePointCount
    })
  }
  return results
}

/**
 * Faithful TypeScript port of `services/bpmn_process_transformer.py`
 * (BpmnProcessTransformer) from the vendored bpmn-assistant.
 *
 * Flattens the recursive IR `process` list into a flat `{ elements, flows }`
 * structure suitable for BPMN XML emission. Every ID convention, ordering and
 * branch-handling quirk of the Python original is preserved so the emitted XML
 * matches the Python golden byte-for-byte (see tests/fixtures/golden). The one
 * intentional divergence is documented on `addFlow` below (the dedup fix).
 *
 * ID conventions (identical to Python):
 *  - join gateway id            = `{gatewayId}-join`
 *  - default flow id            = `{sourceRef}-{targetRef}`
 *  - inclusive branch flow id   = `{gatewayId}-{targetRef}` (passed explicitly)
 *  - `default=` attribute        = the inclusive default branch's flow id
 *
 * 2026-07 extension: elements and flows additionally carry an optional
 * `orbitpm` bag — bilingual labels + DMT org-pack metadata mapped to
 * `orbitpm:*` attribute local names (see buildOrbitpmAttrs) — read LENIENTLY
 * from the raw IR via the shared coercers so junk org values degrade to
 * "absent" instead of failing. Plain IRs produce no bags, keeping the emitted
 * XML byte-identical to the golden fixtures.
 */
import { coerceOrgString, coerceOrgStringArray, TASK_TYPES } from './ir/schema'

/** A transformed element ready for XML emission. */
export interface TransformedElement {
  id: string
  type: string
  label: string | null
  eventDefinition?: string
  /** For callActivity: the referenced process id (rendered as `calledElement`). */
  called_element?: string
  default_flow?: string
  /**
   * Bilingual + DMT org-pack metadata, keyed by `orbitpm:*` attribute LOCAL
   * name (already coerced, '\n'-joined for lists, empties omitted). Insertion
   * order == emission order. Absent when the element carries none.
   */
  orbitpm?: Record<string, string>
  incoming: string[]
  outgoing: string[]
}

/** A transformed sequence flow. */
export interface TransformedFlow {
  id: string
  sourceRef: string
  targetRef: string
  condition: string | null
  /** `orbitpm:*` attrs (nameEn/nameAr from the branch's conditionEn/conditionAr). */
  orbitpm?: Record<string, string>
}

export interface TransformResult {
  elements: TransformedElement[]
  flows: TransformedFlow[]
}

// The IR is dynamically shaped (a discriminated union whose fields the
// transformer reads via optional access, exactly like Python's dict.get). We
// intentionally traverse it with `any` to mirror that dynamic access; the IR is
// validated (schema + validateBpmn) before it ever reaches here.
/* eslint-disable @typescript-eslint/no-explicit-any */
type IRElement = any

// Working element type: incoming/outgoing are attached at the end of each call.
type WorkingElement = Omit<TransformedElement, 'incoming' | 'outgoing'> & {
  incoming?: string[]
  outgoing?: string[]
}

// Which element types carry which org fields (mirrors the prompt contract).
const ACTIVITY_TYPES: ReadonlySet<string> = new Set([...TASK_TYPES, 'callActivity'])
const DECISION_BASIS_TYPES: ReadonlySet<string> = new Set([
  'exclusiveGateway',
  'inclusiveGateway',
  'businessRuleTask'
])

/**
 * Collect an element's bilingual/org metadata into an ordered attribute bag
 * (key = `orbitpm:*` local name). Values pass through the lenient coercers, so
 * junk drops silently; list fields are '\n'-joined. Returns undefined when the
 * element carries nothing — plain IRs then emit byte-identical XML.
 */
function buildOrbitpmAttrs(element: IRElement): Record<string, string> | undefined {
  const attrs: Record<string, string> = {}
  const put = (key: string, value: unknown): void => {
    const coerced = coerceOrgString(value)
    if (coerced !== undefined) attrs[key] = coerced
  }
  const putList = (key: string, value: unknown): void => {
    const coerced = coerceOrgStringArray(value)
    if (coerced !== undefined) attrs[key] = coerced.join('\n')
  }

  put('nameEn', element.labelEn)
  put('nameAr', element.labelAr)
  if (ACTIVITY_TYPES.has(element.type)) {
    put('owner', element.owner)
    put('ownerRole', element.ownerRole)
    put('channel', element.channel)
    put('channelDetail', element.channelDetail)
    put('kind', element.kind)
    putList('ccList', element.cc)
    putList('inputs', element.inputs)
    putList('outputs', element.outputs)
    putList('respList', element.respList)
  }
  if (DECISION_BASIS_TYPES.has(element.type)) {
    put('decisionBasis', element.decisionBasis)
  }
  if (element.type === 'startEvent') {
    put('trigger', element.trigger)
    put('triggerService', element.triggerService)
    put('triggerDetail', element.triggerDetail)
  }

  return Object.keys(attrs).length > 0 ? attrs : undefined
}

/**
 * Bilingual names for the sequence flow created from a gateway branch:
 * conditionEn/conditionAr -> orbitpm:nameEn/nameAr (the primary `condition`
 * keeps flowing into the plain `name` attribute as before).
 */
function branchFlowOrbitpmAttrs(branch: IRElement): Record<string, string> | undefined {
  const attrs: Record<string, string> = {}
  const en = coerceOrgString(branch?.conditionEn)
  const ar = coerceOrgString(branch?.conditionAr)
  if (en !== undefined) attrs.nameEn = en
  if (ar !== undefined) attrs.nameAr = ar
  return Object.keys(attrs).length > 0 ? attrs : undefined
}

/**
 * Restructure the IR `process` into `{ elements, flows }`.
 *
 * @param process               the IR element list for this level
 * @param parentNextElementId   the element the last element of this level should
 *                              flow into (used when recursing into branches)
 */
export function transform(
  process: readonly IRElement[],
  parentNextElementId: string | null = null
): TransformResult {
  const elements: WorkingElement[] = []
  const flows: TransformedFlow[] = []

  /**
   * Append a flow.
   *
   * Python's original silently DROPPED any second flow sharing a
   * (sourceRef, targetRef) pair — which loses a branch's condition label when
   * two branches converge on the same target. The sanctioned fix:
   *  - a re-add with the SAME condition (e.g. the redundant last-element -> join
   *    re-add inside a parallel gateway) is still collapsed — matching Python, so
   *    the 7 goldens are unaffected;
   *  - a re-add with a DISTINCT condition is KEPT, with a suffixed id
   *    (`{base}-2`, `{base}-3`, ...), so both branch labels survive.
   */
  function addFlow(
    sourceRef: string,
    targetRef: string,
    flowId?: string,
    condition?: string | null,
    orbitpm?: Record<string, string>
  ): void {
    const cond: string | null = condition ?? null
    const sameEdge = flows.filter(
      (f) => f.sourceRef === sourceRef && f.targetRef === targetRef
    )
    if (sameEdge.length > 0) {
      // True duplicate (same edge AND same condition) -> collapse, like Python.
      if (sameEdge.some((f) => f.condition === cond)) {
        return
      }
      // Distinct condition on an existing edge -> keep both (the dedup fix).
      const base = flowId || `${sourceRef}-${targetRef}`
      flows.push({
        id: `${base}-${sameEdge.length + 1}`,
        sourceRef,
        targetRef,
        condition: cond,
        ...(orbitpm ? { orbitpm } : {})
      })
      return
    }
    const id = flowId || `${sourceRef}-${targetRef}`
    flows.push({ id, sourceRef, targetRef, condition: cond, ...(orbitpm ? { orbitpm } : {}) })
  }

  function handleExclusiveGateway(
    element: IRElement,
    nextElementId: string | null
  ): string | null {
    let joinGatewayId: string | null = null
    if (element.has_join === true) {
      joinGatewayId = `${element.id}-join`
      elements.push({ id: joinGatewayId, type: 'exclusiveGateway', label: null })
    }

    for (const branch of element.branches) {
      if (!branch.path || branch.path.length === 0) {
        // Empty branch: connect to the branch's `next` or the following element.
        const targetRef: string | null = branch.next ?? nextElementId
        if (targetRef) {
          addFlow(
            element.id,
            targetRef,
            undefined,
            branch.condition ?? null,
            branchFlowOrbitpmAttrs(branch)
          )
        }
        continue
      }

      const branchNext: string | null | undefined = branch.next

      const branchStructure = branchNext
        ? transform(branch.path, branchNext)
        : transform(branch.path, joinGatewayId ?? nextElementId)

      elements.push(...branchStructure.elements)
      flows.push(...branchStructure.flows)

      const firstElement = branchStructure.elements[0] ?? null
      if (firstElement) {
        addFlow(
          element.id,
          firstElement.id,
          undefined,
          branch.condition,
          branchFlowOrbitpmAttrs(branch)
        )
      }
    }

    return joinGatewayId
  }

  function handleInclusiveGateway(
    element: IRElement,
    nextElementId: string | null
  ): string | null {
    let joinGatewayId: string | null = null
    let defaultFlowId: string | null = null
    if (element.has_join === true) {
      joinGatewayId = `${element.id}-join`
      elements.push({ id: joinGatewayId, type: 'inclusiveGateway', label: null })
    }

    for (const branch of element.branches) {
      const isDefault: boolean = branch.is_default === true

      if (!branch.path || branch.path.length === 0) {
        const targetRef: string | null = branch.next ?? nextElementId
        if (targetRef) {
          const flowId = `${element.id}-${targetRef}`
          addFlow(
            element.id,
            targetRef,
            flowId,
            branch.condition ?? null,
            branchFlowOrbitpmAttrs(branch)
          )
          if (isDefault) {
            defaultFlowId = flowId
          }
        }
        continue
      }

      const branchNext: string | null | undefined = branch.next

      const branchStructure = branchNext
        ? transform(branch.path, branchNext)
        : transform(branch.path, joinGatewayId ?? nextElementId)

      elements.push(...branchStructure.elements)
      flows.push(...branchStructure.flows)

      const firstElement = branchStructure.elements[0] ?? null
      if (firstElement) {
        const flowId = `${element.id}-${firstElement.id}`
        addFlow(
          element.id,
          firstElement.id,
          flowId,
          branch.condition ?? null,
          branchFlowOrbitpmAttrs(branch)
        )
        if (isDefault) {
          defaultFlowId = flowId
        }
      }
    }

    if (defaultFlowId) {
      for (const elem of elements) {
        if (elem.id === element.id) {
          elem.default_flow = defaultFlowId
          break
        }
      }
    }

    return joinGatewayId
  }

  function handleParallelGateway(element: IRElement): string {
    const joinGatewayId = `${element.id}-join`
    elements.push({ id: joinGatewayId, type: 'parallelGateway', label: null })

    for (const branch of element.branches) {
      const branchStructure = transform(branch, joinGatewayId)
      if (branchStructure.elements.length === 0) {
        throw new Error(
          `Parallel gateway '${element.id}' cannot have an empty branch. ` +
            'Do not delete the last element in a branch; update or remove the gateway instead.'
        )
      }
      elements.push(...branchStructure.elements)
      flows.push(...branchStructure.flows)

      const firstElement = branchStructure.elements[0]
      addFlow(element.id, firstElement.id)

      const lastElement = branchStructure.elements[branchStructure.elements.length - 1]
      addFlow(lastElement.id, joinGatewayId)
    }

    return joinGatewayId
  }

  for (let index = 0; index < process.length; index++) {
    const element = process[index]
    const nextElementId: string | null =
      index < process.length - 1 ? process[index + 1].id : parentNextElementId

    const transformedElement: WorkingElement = {
      id: element.id,
      type: element.type,
      label: element.label ?? null
    }
    if ('eventDefinition' in element && element.eventDefinition !== undefined) {
      transformedElement.eventDefinition = element.eventDefinition
    }
    // A callActivity carries its linked process id through as `called_element`
    // (mirroring the eventDefinition pass-through above); only when it is a
    // non-empty string — an unlinked call activity behaves like a plain task.
    if (typeof element.calledProcess === 'string' && element.calledProcess.length > 0) {
      transformedElement.called_element = element.calledProcess
    }
    // Bilingual labels + org-pack metadata (leniently coerced; often absent).
    const orbitpm = buildOrbitpmAttrs(element)
    if (orbitpm) {
      transformedElement.orbitpm = orbitpm
    }
    elements.push(transformedElement)

    if (element.type === 'exclusiveGateway') {
      const joinGatewayId = handleExclusiveGateway(element, nextElementId)
      if (joinGatewayId && nextElementId) {
        addFlow(joinGatewayId, nextElementId)
      }
    } else if (element.type === 'inclusiveGateway') {
      const joinGatewayId = handleInclusiveGateway(element, nextElementId)
      if (joinGatewayId && nextElementId) {
        addFlow(joinGatewayId, nextElementId)
      }
    } else if (element.type === 'parallelGateway') {
      const joinGatewayId = handleParallelGateway(element)
      if (nextElementId) {
        addFlow(joinGatewayId, nextElementId)
      }
    } else if (nextElementId && element.type !== 'endEvent') {
      addFlow(element.id, nextElementId)
    }
  }

  // Attach incoming/outgoing (recomputed over this call's full flow list; the
  // top-level call sees every flow since sub-flows are spread up on each return).
  for (const element of elements) {
    element.incoming = flows.filter((f) => f.targetRef === element.id).map((f) => f.id)
    element.outgoing = flows.filter((f) => f.sourceRef === element.id).map((f) => f.id)
  }

  return { elements: elements as TransformedElement[], flows }
}

/** Class shim mirroring the Python `BpmnProcessTransformer` for parity of use. */
export class BpmnProcessTransformer {
  transform(
    process: readonly IRElement[],
    parentNextElementId: string | null = null
  ): TransformResult {
    return transform(process, parentNextElementId)
  }
}

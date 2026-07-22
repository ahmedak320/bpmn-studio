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
 */

/** A transformed element ready for XML emission. */
export interface TransformedElement {
  id: string
  type: string
  label: string | null
  eventDefinition?: string
  default_flow?: string
  incoming: string[]
  outgoing: string[]
}

/** A transformed sequence flow. */
export interface TransformedFlow {
  id: string
  sourceRef: string
  targetRef: string
  condition: string | null
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
    condition?: string | null
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
        condition: cond
      })
      return
    }
    const id = flowId || `${sourceRef}-${targetRef}`
    flows.push({ id, sourceRef, targetRef, condition: cond })
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
          addFlow(element.id, targetRef, undefined, branch.condition ?? null)
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
        addFlow(element.id, firstElement.id, undefined, branch.condition)
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
          addFlow(element.id, targetRef, flowId, branch.condition ?? null)
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
        addFlow(element.id, firstElement.id, flowId, branch.condition ?? null)
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

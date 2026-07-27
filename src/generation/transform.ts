/**
 * Flatten the recursive generation IR into BPMN elements and sequence flows.
 *
 * A single transform context owns every nested branch. That is important:
 * BPMN `xsd:ID` values are document-global, while the original port allocated
 * IDs independently inside each recursive call. The allocator below reserves
 * all model-supplied IDs up front and then gives synthetic joins, flows and
 * event definitions collision-free deterministic IDs.
 */
import { coerceOrgString, coerceOrgStringArray, TASK_TYPES } from './ir/schema'

export interface TransformedElement {
  id: string
  type: string
  label: string | null
  eventDefinition?: string
  event_definition_id?: string
  called_element?: string
  default_flow?: string
  orbitpm?: Record<string, string>
  incoming: string[]
  outgoing: string[]
}

export interface TransformedFlow {
  id: string
  sourceRef: string
  targetRef: string
  /** Formal branch condition; null for ordinary/default flows. */
  condition: string | null
  is_default: boolean
  orbitpm?: Record<string, string>
}

export interface TransformResult {
  elements: TransformedElement[]
  flows: TransformedFlow[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrowed by the validated IR discriminators below
type IRElement = any

type WorkingElement = Omit<TransformedElement, 'incoming' | 'outgoing'> & {
  incoming?: string[]
  outgoing?: string[]
}

const ACTIVITY_TYPES: ReadonlySet<string> = new Set([...TASK_TYPES, 'callActivity'])
const DECISION_BASIS_TYPES: ReadonlySet<string> = new Set([
  'exclusiveGateway',
  'inclusiveGateway',
  'businessRuleTask'
])

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
    put('ownerEn', element.ownerEn)
    put('ownerAr', element.ownerAr)
    put('department', element.department)
    put('departmentEn', element.departmentEn)
    put('departmentAr', element.departmentAr)
    put('ownerRole', element.ownerRole)
    put('ownerRoleEn', element.ownerRoleEn)
    put('ownerRoleAr', element.ownerRoleAr)
    put('channel', element.channel)
    put('channelDetail', element.channelDetail)
    put('channelDetailEn', element.channelDetailEn)
    put('channelDetailAr', element.channelDetailAr)
    put('kind', element.kind)
    putList('ccList', element.cc)
    putList('ccListEn', element.ccEn)
    putList('ccListAr', element.ccAr)
    putList('inputs', element.inputs)
    putList('inputsEn', element.inputsEn)
    putList('inputsAr', element.inputsAr)
    putList('outputs', element.outputs)
    putList('outputsEn', element.outputsEn)
    putList('outputsAr', element.outputsAr)
    putList('respList', element.respList)
    putList('respListEn', element.respListEn)
    putList('respListAr', element.respListAr)
    put('system', element.system)
    put('systemEn', element.systemEn)
    put('systemAr', element.systemAr)
  }
  if (DECISION_BASIS_TYPES.has(element.type)) {
    put('decisionBasis', element.decisionBasis)
    put('decisionBasisEn', element.decisionBasisEn)
    put('decisionBasisAr', element.decisionBasisAr)
  }
  if (element.type === 'startEvent') {
    put('trigger', element.trigger)
    put('triggers', element.trigger)
    put('triggersEn', element.triggerEn)
    put('triggersAr', element.triggerAr)
    put('triggerService', element.triggerService)
    put('triggerServiceEn', element.triggerServiceEn)
    put('triggerServiceAr', element.triggerServiceAr)
    put('triggerDetail', element.triggerDetail)
    put('triggerDetailEn', element.triggerDetailEn)
    put('triggerDetailAr', element.triggerDetailAr)
  }
  return Object.keys(attrs).length > 0 ? attrs : undefined
}

function branchFlowOrbitpmAttrs(branch: IRElement): Record<string, string> | undefined {
  const attrs: Record<string, string> = {}
  const en = coerceOrgString(branch?.conditionEn)
  const ar = coerceOrgString(branch?.conditionAr)
  if (en !== undefined) attrs.nameEn = en
  if (ar !== undefined) attrs.nameAr = ar
  return Object.keys(attrs).length > 0 ? attrs : undefined
}

function collectIrIds(process: readonly IRElement[], ids: Set<string>): void {
  for (const element of process) {
    ids.add(element.id)
    if (element.type === 'exclusiveGateway' || element.type === 'inclusiveGateway') {
      for (const branch of element.branches) collectIrIds(branch.path, ids)
    } else if (element.type === 'parallelGateway') {
      for (const branch of element.branches) collectIrIds(branch, ids)
    }
  }
}

class GlobalIdAllocator {
  constructor(private readonly used: Set<string>) {}

  allocate(preferred: string): string {
    if (!this.used.has(preferred)) {
      this.used.add(preferred)
      return preferred
    }
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${preferred}_${suffix}`
      if (!this.used.has(candidate)) {
        this.used.add(candidate)
        return candidate
      }
    }
  }
}

interface TransformContext {
  elements: WorkingElement[]
  flows: TransformedFlow[]
  elementById: Map<string, WorkingElement>
  ids: GlobalIdAllocator
}

interface LevelResult {
  firstElementId: string | null
}

/**
 * Restructure a validated IR process into one flat document-global graph.
 *
 * `parentNextElementId` is retained for API compatibility and for callers that
 * intentionally transform a branch. Normal generation calls this at top level.
 */
export function transform(
  process: readonly IRElement[],
  parentNextElementId: string | null = null
): TransformResult {
  const reserved = new Set<string>()
  collectIrIds(process, reserved)
  const context: TransformContext = {
    elements: [],
    flows: [],
    elementById: new Map(),
    ids: new GlobalIdAllocator(reserved)
  }

  const addFlow = (
    sourceRef: string,
    targetRef: string,
    options: {
      preferredId?: string
      condition?: string | null
      isDefault?: boolean
      orbitpm?: Record<string, string>
    } = {}
  ): TransformedFlow => {
    const condition =
      typeof options.condition === 'string' && options.condition.trim().length > 0
        ? options.condition.trim()
        : null
    const same = context.flows.find(
      (flow) =>
        flow.sourceRef === sourceRef &&
        flow.targetRef === targetRef &&
        flow.condition === condition &&
        flow.is_default === (options.isDefault === true)
    )
    if (same) return same

    const id = context.ids.allocate(options.preferredId ?? `${sourceRef}-${targetRef}`)
    const flow: TransformedFlow = {
      id,
      sourceRef,
      targetRef,
      condition,
      is_default: options.isDefault === true,
      ...(options.orbitpm ? { orbitpm: options.orbitpm } : {})
    }
    context.flows.push(flow)
    return flow
  }

  const transformLevel = (
    level: readonly IRElement[],
    nextAfterLevel: string | null
  ): LevelResult => {
    const firstElementId = level.length > 0 ? level[0].id : null

    for (let index = 0; index < level.length; index += 1) {
      const element = level[index]
      const nextElementId = index < level.length - 1 ? level[index + 1].id : nextAfterLevel
      const transformed: WorkingElement = {
        id: element.id,
        type: element.type,
        label: element.label ?? null
      }
      if (element.eventDefinition !== undefined) {
        transformed.eventDefinition = element.eventDefinition
        transformed.event_definition_id = context.ids.allocate(
          `${element.eventDefinition}_${element.id}`
        )
      }
      if (typeof element.calledProcess === 'string' && element.calledProcess.trim()) {
        transformed.called_element = element.calledProcess.trim()
      }
      const orbitpm = buildOrbitpmAttrs(element)
      if (orbitpm) transformed.orbitpm = orbitpm
      context.elements.push(transformed)
      context.elementById.set(transformed.id, transformed)

      if (element.type === 'exclusiveGateway' || element.type === 'inclusiveGateway') {
        const joinId = element.has_join === true ? context.ids.allocate(`${element.id}-join`) : null
        if (joinId) {
          const join: WorkingElement = {
            id: joinId,
            type: element.type,
            label: null
          }
          context.elements.push(join)
          context.elementById.set(join.id, join)
        }

        for (const branch of element.branches) {
          const isDefault = branch.is_default === true
          const branchTarget = branch.next ?? joinId ?? nextElementId
          let target = branchTarget
          if (branch.path.length > 0) {
            const nested = transformLevel(branch.path, branchTarget)
            target = nested.firstElementId
          }
          if (target) {
            const flow = addFlow(element.id, target, {
              preferredId:
                element.type === 'inclusiveGateway' ? `${element.id}-${target}` : undefined,
              condition: isDefault ? null : branch.condition,
              isDefault,
              orbitpm: isDefault ? undefined : branchFlowOrbitpmAttrs(branch)
            })
            if (isDefault) transformed.default_flow = flow.id
          }
        }
        if (joinId && nextElementId) addFlow(joinId, nextElementId)
      } else if (element.type === 'parallelGateway') {
        const joinId = context.ids.allocate(`${element.id}-join`)
        const join: WorkingElement = {
          id: joinId,
          type: 'parallelGateway',
          label: null
        }
        context.elements.push(join)
        context.elementById.set(join.id, join)
        for (const branch of element.branches) {
          const nested = transformLevel(branch, joinId)
          if (!nested.firstElementId) {
            throw new Error(`Parallel gateway '${element.id}' cannot have an empty branch.`)
          }
          addFlow(element.id, nested.firstElementId)
        }
        if (nextElementId) addFlow(joinId, nextElementId)
      } else if (nextElementId && element.type !== 'endEvent') {
        addFlow(element.id, nextElementId)
      }
    }
    return { firstElementId }
  }

  transformLevel(process, parentNextElementId)

  for (const element of context.elements) {
    element.incoming = context.flows
      .filter((flow) => flow.targetRef === element.id)
      .map((flow) => flow.id)
    element.outgoing = context.flows
      .filter((flow) => flow.sourceRef === element.id)
      .map((flow) => flow.id)
  }

  return {
    elements: context.elements as TransformedElement[],
    flows: context.flows
  }
}

export class BpmnProcessTransformer {
  transform(
    process: readonly IRElement[],
    parentNextElementId: string | null = null
  ): TransformResult {
    return transform(process, parentNextElementId)
  }
}

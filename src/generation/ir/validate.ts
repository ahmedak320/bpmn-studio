/**
 * Port of `services/validate_bpmn.py` from the vendored bpmn-assistant.
 *
 * Validates an IR `process` list, raising an Error (mirroring Python's
 * ValueError) with the SAME message wording the Python raised — those messages
 * are fed back to the model verbatim by the conversational repair loop, so
 * fidelity matters. Per-type structural checks reuse the Zod sub-schemas from
 * `schema.ts` as the equivalent of pydantic's `model_validate`. The final
 * top-level step is the transformer smoke test (validation fails if the IR
 * cannot be flattened, e.g. an empty parallel branch).
 *
 * IDs are validated globally across the complete recursive IR. This deliberately
 * fixes the old per-level check, which allowed a top-level element and a nested
 * branch element to serialize with the same XML ID.
 *
 * Org-metadata leniency: the bilingual/org fields (labelEn/labelAr,
 * conditionEn/conditionAr, owner, cc, decisionBasis, trigger, …) are declared
 * in the Zod sub-schemas as lenient preprocess fields that coerce or silently
 * DROP invalid shapes, so the safeParse gates below can never reject a diagram
 * over org metadata — the conversational repair loop only ever fires on core
 * structural problems. The raw IR is passed through untouched; the emitter
 * re-applies the same lenient coercion when reading these fields.
 */
import { transform } from '../transform'
import {
  TASK_TYPES,
  EVENT_TYPES,
  BpmnTaskSchema,
  BpmnCallActivitySchema,
  BpmnEventSchema,
  ExclusiveGatewaySchema,
  InclusiveGatewaySchema,
  ParallelGatewaySchema
} from './schema'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- validated dynamically by the Zod IR schema
type IRElement = any

const CALL_ACTIVITY_TYPE = 'callActivity'
const GATEWAY_TYPES = ['exclusiveGateway', 'inclusiveGateway', 'parallelGateway'] as const
const SUPPORTED_ELEMENTS: string[] = [
  ...TASK_TYPES,
  CALL_ACTIVITY_TYPE,
  ...GATEWAY_TYPES,
  ...EVENT_TYPES
]
const TASK_TYPE_SET: ReadonlySet<string> = new Set(TASK_TYPES)
const NCNAME = /^[\p{L}_][\p{L}\p{N}_.\-\u00B7\u0300-\u036F\u203F-\u2040]*$/u

function j(element: unknown): string {
  return JSON.stringify(element)
}

/**
 * Validate a BPMN process (recursively). Throws on the first problem found.
 * @param process     the IR element list.
 * @param isTopLevel  whether this is the top-level process (not a branch).
 */
export function validateBpmn(process: readonly IRElement[], isTopLevel = true): void {
  if (!Array.isArray(process)) {
    throw new Error('BPMN process must be an array')
  }

  const seenIds = new Set<string>()
  const referencedNextIds: Array<{ gatewayId: string; next: string }> = []
  let startEventCount = 0

  const walk = (
    level: readonly IRElement[],
    topLevel: boolean,
    parentContinuation: boolean
  ): void => {
    for (let index = 0; index < level.length; index += 1) {
      const element = level[index]
      validateElement(element)

      if (typeof element.id !== 'string' || !NCNAME.test(element.id)) {
        throw new Error(`Invalid element ID '${String(element.id)}': expected an XML NCName`)
      }
      if (seenIds.has(element.id)) {
        throw new Error(`Duplicate element ID found: ${element.id}`)
      }
      seenIds.add(element.id)

      if (topLevel && element.type === 'startEvent') {
        startEventCount += 1
      }

      if (element.type === 'exclusiveGateway' || element.type === 'inclusiveGateway') {
        let defaultCount = 0
        const hasImplicitContinuation =
          element.has_join === true ||
          index < level.length - 1 ||
          parentContinuation
        for (const branch of element.branches) {
          const isDefault = branch.is_default === true
          const condition =
            typeof branch.condition === 'string' ? branch.condition.trim() : ''
          if (isDefault) {
            defaultCount += 1
            if (condition.length > 0) {
              throw new Error(
                `Default branch in gateway '${element.id}' must not have a condition`
              )
            }
            if (coercedBranchTranslation(branch.conditionEn) || coercedBranchTranslation(branch.conditionAr)) {
              throw new Error(
                `Default branch in gateway '${element.id}' must not have translated conditions`
              )
            }
          } else if (condition.length === 0) {
            throw new Error(
              `Non-default branch in gateway '${element.id}' must have a condition`
            )
          }
          if (typeof branch.next === 'string' && branch.next.length > 0) {
            referencedNextIds.push({ gatewayId: element.id, next: branch.next })
          }
          if (
            branch.path.length === 0 &&
            !(typeof branch.next === 'string' && branch.next.length > 0) &&
            !hasImplicitContinuation
          ) {
            throw new Error(
              `Empty branch in gateway '${element.id}' has no continuation target`
            )
          }
          walk(
            branch.path,
            false,
            Boolean(branch.next) || hasImplicitContinuation
          )
        }
        if (defaultCount > 1) {
          throw new Error(`Gateway '${element.id}' may have at most one default branch`)
        }
      } else if (element.type === 'parallelGateway') {
        for (const branch of element.branches) {
          walk(branch, false, true)
        }
      }
    }
  }
  walk(process, isTopLevel, false)

  if (isTopLevel && startEventCount !== 1) {
    throw new Error(`Process must contain exactly one start event, found ${startEventCount}`)
  }
  if (isTopLevel && !processHasEndEvent(process)) {
    throw new Error('Process must contain at least one end event')
  }
  for (const reference of referencedNextIds) {
    if (!seenIds.has(reference.next)) {
      throw new Error(
        `Gateway '${reference.gatewayId}' references unknown next element '${reference.next}'`
      )
    }
  }
  if (isTopLevel) {
    // Ensure the process can be transformed into BPMN XML (smoke test).
    transform(process)
  }
}

function coercedBranchTranslation(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Validate a single BPMN element. */
export function validateElement(element: IRElement): void {
  if (element == null || typeof element !== 'object') {
    throw new Error(`Element is missing an ID: ${j(element)}`)
  }
  if (!('id' in element)) {
    throw new Error(`Element is missing an ID: ${j(element)}`)
  } else if (!('type' in element)) {
    throw new Error(`Element is missing a type: ${j(element)}`)
  }

  if (!SUPPORTED_ELEMENTS.includes(element.type)) {
    throw new Error(
      `Unsupported element type: ${element.type}. Supported types: ${j(SUPPORTED_ELEMENTS)}`
    )
  }

  if (TASK_TYPE_SET.has(element.type)) {
    validateTask(element)
  } else if (element.type === CALL_ACTIVITY_TYPE) {
    validateCallActivity(element)
  } else if (element.type === 'exclusiveGateway') {
    validateExclusiveGateway(element)
  } else if (element.type === 'inclusiveGateway') {
    validateInclusiveGateway(element)
  } else if (element.type === 'parallelGateway') {
    validateParallelGateway(element)
  } else if (!BpmnEventSchema.safeParse(element).success) {
    throw new Error(`Invalid event element: ${j(element)}`)
  }
}

function validateTask(element: IRElement): void {
  if (!('label' in element)) {
    throw new Error(`Task element is missing a label: ${j(element)}`)
  }
  if (!BpmnTaskSchema.safeParse(element).success) {
    throw new Error(`Invalid task element: ${j(element)}`)
  }
}

/**
 * Validate a callActivity: label is required (mirroring the task rule);
 * calledProcess/confidence are only checked for type by the Zod sub-schema.
 */
function validateCallActivity(element: IRElement): void {
  if (!('label' in element)) {
    throw new Error(`CallActivity element is missing a label: ${j(element)}`)
  }
  if (!BpmnCallActivitySchema.safeParse(element).success) {
    throw new Error(`Invalid callActivity element: ${j(element)}`)
  }
}

function validateExclusiveGateway(element: IRElement): void {
  if (!('label' in element)) {
    throw new Error(`Exclusive gateway is missing a label: ${j(element)}`)
  }
  if (!('branches' in element) || !Array.isArray(element.branches)) {
    throw new Error(`Exclusive gateway is missing or has invalid 'branches': ${j(element)}`)
  }
  const branchPaths: unknown[][] = []
  for (const branch of element.branches) {
    if (!('path' in branch)) {
      throw new Error(`Invalid branch in exclusive gateway: ${j(branch)}`)
    }
    if (!Array.isArray(branch.path)) {
      throw new Error(`Exclusive gateway branch 'path' must be a list: ${j(branch)}`)
    }
    branchPaths.push(branch.path)
  }

  if (branchPaths.length < 2) {
    throw new Error('Exclusive gateway must have at least two branches.')
  }

  if (!ExclusiveGatewaySchema.safeParse(element).success) {
    throw new Error(`Invalid exclusive gateway element: ${j(element)}`)
  }
}

function validateInclusiveGateway(element: IRElement): void {
  if (!('label' in element)) {
    throw new Error(`Inclusive gateway is missing a label: ${j(element)}`)
  }
  if (!('branches' in element) || !Array.isArray(element.branches)) {
    throw new Error(`Inclusive gateway is missing or has invalid 'branches': ${j(element)}`)
  }
  for (const branch of element.branches) {
    if (!('path' in branch)) {
      throw new Error(`Invalid branch in inclusive gateway (missing 'path'): ${j(branch)}`)
    }
    if (branch.is_default !== true && !('condition' in branch)) {
      throw new Error(
        `Invalid branch in inclusive gateway (non-default branch missing 'condition'): ${j(branch)}`
      )
    }
  }
  if (element.branches.length < 2) {
    throw new Error('Inclusive gateway must have at least two branches.')
  }

  if (!InclusiveGatewaySchema.safeParse(element).success) {
    throw new Error(`Invalid inclusive gateway element: ${j(element)}`)
  }
}

function validateParallelGateway(element: IRElement): void {
  if (!('branches' in element) || !Array.isArray(element.branches)) {
    throw new Error(`Parallel gateway has missing or invalid 'branches': ${j(element)}`)
  }
  if (!ParallelGatewaySchema.safeParse(element).success) {
    throw new Error(`Invalid parallel gateway element: ${j(element)}`)
  }
  if (element.branches.length < 2) {
    throw new Error('Parallel gateway must have at least two branches.')
  }
  if (element.branches.some((branch: unknown[]) => branch.length === 0)) {
    throw new Error(`Parallel gateway '${element.id}' cannot have an empty branch.`)
  }
}

/** Recursively check for at least one end event (including inside branches). */
export function processHasEndEvent(process: readonly IRElement[]): boolean {
  for (const element of process) {
    if (element.type === 'endEvent') {
      return true
    }
    if (element.type === 'exclusiveGateway' || element.type === 'inclusiveGateway') {
      for (const branch of element.branches) {
        if (processHasEndEvent(branch.path)) {
          return true
        }
      }
    }
    if (element.type === 'parallelGateway') {
      for (const branch of element.branches) {
        if (processHasEndEvent(branch)) {
          return true
        }
      }
    }
  }
  return false
}

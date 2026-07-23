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
 * Note (faithful quirk): id uniqueness is checked PER LEVEL (a fresh `seenIds`
 * per recursive call), exactly like the Python original — not globally.
 */
import { transform } from '../transform'
import {
  TASK_TYPES,
  EVENT_TYPES,
  BpmnTaskSchema,
  BpmnCallActivitySchema,
  ExclusiveGatewaySchema,
  InclusiveGatewaySchema,
  ParallelGatewaySchema
} from './schema'

/* eslint-disable @typescript-eslint/no-explicit-any */
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

function j(element: unknown): string {
  return JSON.stringify(element)
}

/**
 * Validate a BPMN process (recursively). Throws on the first problem found.
 * @param process     the IR element list.
 * @param isTopLevel  whether this is the top-level process (not a branch).
 */
export function validateBpmn(process: readonly IRElement[], isTopLevel = true): void {
  const seenIds = new Set<string>()
  let startEventCount = 0

  for (const element of process) {
    validateElement(element)

    if (seenIds.has(element.id)) {
      throw new Error(`Duplicate element ID found: ${element.id}`)
    }
    seenIds.add(element.id)

    if (isTopLevel && element.type === 'startEvent') {
      startEventCount += 1
    }

    if (element.type === 'exclusiveGateway') {
      for (const branch of element.branches) {
        validateBpmn(branch.path, false)
      }
    }
    if (element.type === 'inclusiveGateway') {
      for (const branch of element.branches) {
        validateBpmn(branch.path, false)
      }
    }
    if (element.type === 'parallelGateway') {
      for (const branch of element.branches) {
        validateBpmn(branch, false)
      }
    }
  }

  if (isTopLevel && startEventCount !== 1) {
    throw new Error(`Process must contain exactly one start event, found ${startEventCount}`)
  }
  if (isTopLevel && !processHasEndEvent(process)) {
    throw new Error('Process must contain at least one end event')
  }
  if (isTopLevel) {
    // Ensure the process can be transformed into BPMN XML (smoke test).
    transform(process)
  }
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
  }
  // Events carry no further structural validation (matching Python).
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
    if (!('condition' in branch) || !('path' in branch)) {
      throw new Error(`Invalid branch in exclusive gateway: ${j(branch)}`)
    }
    if (!Array.isArray(branch.path)) {
      throw new Error(`Exclusive gateway branch 'path' must be a list: ${j(branch)}`)
    }
    branchPaths.push(branch.path)
  }

  if (branchPaths.length > 0 && branchPaths.every((path) => path.length === 0)) {
    throw new Error(
      'Exclusive gateway must have at least one branch with elements; all branch paths are empty.'
    )
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

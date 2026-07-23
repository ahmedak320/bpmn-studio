/**
 * Zod schema of the BPMN "IR" — the intermediate JSON the LLM emits and the
 * whole generation pipeline consumes. This is a faithful port of the vendored
 * pydantic models in `core/schemas.py` (bpmn-assistant), expressed as a
 * recursive union via `z.lazy` so gateway branches can nest arbitrary elements.
 *
 * It doubles as the structured-output schema for the AI SDK `generateObject`
 * call (wired by later waves) and as the source of the exported TS types the
 * rest of `src/gen` builds on.
 *
 * Semantics preserved from Python:
 *  - 8 task types; 4 event types; optional eventDefinition (timer|message).
 *  - Task label REQUIRED; event label OPTIONAL.
 *  - exclusiveGateway/inclusiveGateway: { label, has_join, branches }.
 *  - exclusive branch: { condition (required), path[], next? }.
 *  - inclusive branch: { condition? (required only for non-default), path[], next?, is_default }.
 *  - parallelGateway: branches = array of element-arrays (join always synthesized).
 */
import { z } from 'zod'

export const TASK_TYPES = [
  'task',
  'userTask',
  'serviceTask',
  'sendTask',
  'receiveTask',
  'businessRuleTask',
  'manualTask',
  'scriptTask'
] as const
export type TaskType = (typeof TASK_TYPES)[number]

export const EVENT_TYPES = [
  'startEvent',
  'endEvent',
  'intermediateThrowEvent',
  'intermediateCatchEvent'
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const EVENT_DEFINITION_TYPES = ['timerEventDefinition', 'messageEventDefinition'] as const
export type EventDefinitionType = (typeof EVENT_DEFINITION_TYPES)[number]

// ---------------------------------------------------------------------------
// TS types (declared up-front so the recursive schema can be annotated).
// ---------------------------------------------------------------------------

export interface BpmnTask {
  type: TaskType
  id: string
  label: string
}

/**
 * A call activity references another (already documented) process — the BPMN
 * "call activity" element. Emitted by the model when a described step is
 * performed according to / delegated to one of the workspace's existing
 * processes (see the catalog section injected by composeCreateBpmn).
 *  - `calledProcess`: id of the referenced process (rendered as the
 *    `calledElement` XML attribute). Optional/nullable: an unlinked call
 *    activity behaves like a plain task.
 *  - `confidence`: the model's self-reported match strength ("high" only when
 *    the description explicitly references that process, "low" otherwise).
 */
export interface BpmnCallActivity {
  type: 'callActivity'
  id: string
  label: string
  calledProcess?: string | null
  confidence?: 'high' | 'low'
}

export interface BpmnEvent {
  type: EventType
  id: string
  label?: string
  eventDefinition?: EventDefinitionType
}

export interface ExclusiveGatewayBranch {
  condition: string
  path: BpmnElement[]
  next?: string | null
}

export interface ExclusiveGateway {
  type: 'exclusiveGateway'
  id: string
  label: string
  has_join: boolean
  branches: ExclusiveGatewayBranch[]
}

export interface InclusiveGatewayBranch {
  condition?: string | null
  path: BpmnElement[]
  next?: string | null
  is_default?: boolean
}

export interface InclusiveGateway {
  type: 'inclusiveGateway'
  id: string
  label: string
  has_join: boolean
  branches: InclusiveGatewayBranch[]
}

export interface ParallelGateway {
  type: 'parallelGateway'
  id: string
  branches: BpmnElement[][]
}

export type BpmnElement =
  | BpmnTask
  | BpmnCallActivity
  | BpmnEvent
  | ExclusiveGateway
  | InclusiveGateway
  | ParallelGateway

export interface ProcessModel {
  process: BpmnElement[]
}

// ---------------------------------------------------------------------------
// Zod schemas.
// ---------------------------------------------------------------------------

export const BpmnTaskSchema = z.object({
  type: z.enum(TASK_TYPES),
  id: z.string(),
  label: z.string()
})

export const BpmnCallActivitySchema = z.object({
  type: z.literal('callActivity'),
  id: z.string(),
  label: z.string(),
  calledProcess: z.string().nullish(),
  confidence: z.enum(['high', 'low']).optional()
})

export const BpmnEventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  id: z.string(),
  label: z.string().optional(),
  eventDefinition: z.enum(EVENT_DEFINITION_TYPES).optional()
})

/**
 * Recursive element schema. `z.lazy` defers evaluation so the gateway schemas
 * (declared below) can reference this and vice-versa. The explicit
 * `z.ZodType<BpmnElement>` annotation is what makes the recursion type-check.
 */
export const BpmnElementSchema: z.ZodType<BpmnElement> = z.lazy(() =>
  z.union([
    BpmnTaskSchema,
    BpmnCallActivitySchema,
    BpmnEventSchema,
    ExclusiveGatewaySchema,
    InclusiveGatewaySchema,
    ParallelGatewaySchema
  ])
)

export const ExclusiveGatewayBranchSchema: z.ZodType<ExclusiveGatewayBranch> = z.object({
  condition: z.string(),
  path: z.array(BpmnElementSchema).default([]),
  next: z.string().nullish()
})

export const ExclusiveGatewaySchema: z.ZodType<ExclusiveGateway> = z.object({
  type: z.literal('exclusiveGateway'),
  id: z.string(),
  label: z.string(),
  has_join: z.boolean(),
  branches: z.array(ExclusiveGatewayBranchSchema)
})

export const InclusiveGatewayBranchSchema: z.ZodType<InclusiveGatewayBranch> = z.object({
  condition: z.string().nullish(),
  path: z.array(BpmnElementSchema).default([]),
  next: z.string().nullish(),
  is_default: z.boolean().default(false)
})

export const InclusiveGatewaySchema: z.ZodType<InclusiveGateway> = z.object({
  type: z.literal('inclusiveGateway'),
  id: z.string(),
  label: z.string(),
  has_join: z.boolean(),
  branches: z.array(InclusiveGatewayBranchSchema)
})

export const ParallelGatewaySchema: z.ZodType<ParallelGateway> = z.object({
  type: z.literal('parallelGateway'),
  id: z.string(),
  branches: z.array(z.array(BpmnElementSchema))
})

/** Top-level process wrapper: `{ "process": [ ...elements ] }`. */
export const ProcessModelSchema = z.object({
  process: z.array(BpmnElementSchema)
})

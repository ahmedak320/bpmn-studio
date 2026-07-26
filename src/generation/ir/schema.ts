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
 *
 * 2026-07 extension (bilingual labels + DMT org-pack metadata): every labeled
 * element optionally carries `labelEn`/`labelAr`, branches carry
 * `conditionEn`/`conditionAr`, and activities/gateways/start events carry the
 * optional org fields listed on {@link OrgActivityFields} & friends. ALL new
 * fields are OPTIONAL so pre-existing IRs stay valid, and they are validated
 * LENIENTLY (invalid shapes coerce or drop silently — see coerceOrgString /
 * coerceOrgStringArray) so the conversational repair loop can never fail a
 * diagram over org metadata. The fields ARE part of the Zod schemas: the
 * desktop adapter feeds ProcessModelSchema to a schema-first `generateObject`
 * call, and any field missing here would be silently stripped from structured
 * model output.
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
// Lenient coercion for the bilingual/org metadata fields.
// ---------------------------------------------------------------------------

/**
 * Coerce a model-supplied org/bilingual scalar to a trimmed non-empty string.
 * Strings are trimmed; numbers/booleans are stringified; anything else
 * (objects, arrays, null) and empty results drop to `undefined` SILENTLY —
 * org metadata must never fail a diagram. Shared by the Zod preprocessors
 * below (the structured-output path) and by the transformer (which reads the
 * RAW IR on the text/loose-parse path).
 */
export function coerceOrgString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return undefined
}

/**
 * Coerce a model-supplied value to an array of non-empty strings: arrays keep
 * their coercible entries (invalid entries drop silently), a bare scalar
 * becomes a one-element array, everything else drops to `undefined`.
 */
export function coerceOrgStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const entries = value
      .map((entry) => coerceOrgString(entry))
      .filter((entry): entry is string => entry !== undefined)
    return entries.length > 0 ? entries : undefined
  }
  const single = coerceOrgString(value)
  return single !== undefined ? [single] : undefined
}

/**
 * Lenient string field: any shape parses successfully (junk coerces to
 * `undefined`), while the JSON-Schema projection used by `generateObject`
 * stays a plain optional `{"type":"string"}` (verified against zod 4.4.3 +
 * ai 7's zodSchema conversion).
 */
const LooseOrgString = z.preprocess(coerceOrgString, z.string().optional())

/** Lenient string-array field (same contract as {@link LooseOrgString}). */
const LooseOrgStringArray = z.preprocess(
  coerceOrgStringArray,
  z.array(z.string()).optional()
)

// ---------------------------------------------------------------------------
// TS types (declared up-front so the recursive schema can be annotated).
// ---------------------------------------------------------------------------

/**
 * Bilingual label pair carried by every labeled element (tasks, callActivity,
 * events, exclusive/inclusive gateways). `label` stays the PRIMARY,
 * description-language label; these are the faithful translations.
 */
export interface BilingualLabelFields {
  labelEn?: string
  labelAr?: string
}

/**
 * DMT org-pack metadata on activities (tasks + callActivity). All optional and
 * leniently validated; emitted as `orbitpm:*` XML attributes by the emitter.
 *  - `ownerRole`: RACI letter — expected 'R' | 'A' | 'C' | 'I' (loose string).
 *  - `channel`:   expected 'dmthub' | 'email' | 'data' (loose string).
 *  - `cc`:        informed parties (emitted '\n'-joined as orbitpm:ccList).
 *  - `inputs`:    data/documents the step needs.
 *  - `outputs`:   data/documents the step produces.
 *  - `respList`:  "Name — Role" entries.
 *  - `kind`:      expected 'cc' — marks a purely informational copy step.
 */
export interface OrgActivityFields {
  owner?: string
  ownerRole?: string
  channel?: string
  channelDetail?: string
  cc?: string[]
  inputs?: string[]
  outputs?: string[]
  respList?: string[]
  kind?: string
}

export interface BpmnTask extends BilingualLabelFields, OrgActivityFields {
  type: TaskType
  id: string
  label: string
  /** Decision criteria — meaningful on businessRuleTask (and emitted only there). */
  decisionBasis?: string
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
export interface BpmnCallActivity extends BilingualLabelFields, OrgActivityFields {
  type: 'callActivity'
  id: string
  label: string
  calledProcess?: string | null
  confidence?: 'high' | 'low'
}

export interface BpmnEvent extends BilingualLabelFields {
  type: EventType
  id: string
  label?: string
  eventDefinition?: EventDefinitionType
  /** What starts the process — meaningful on startEvent (and emitted only there). */
  trigger?: string
  /** System/service delivering the trigger — startEvent only. */
  triggerService?: string
  /** Free-text trigger detail — startEvent only. */
  triggerDetail?: string
}

export interface ExclusiveGatewayBranch {
  condition: string
  path: BpmnElement[]
  next?: string | null
  /** Faithful English translation of `condition` (emitted on the branch flow). */
  conditionEn?: string
  /** Faithful Arabic translation of `condition` (emitted on the branch flow). */
  conditionAr?: string
}

export interface ExclusiveGateway extends BilingualLabelFields {
  type: 'exclusiveGateway'
  id: string
  label: string
  has_join: boolean
  branches: ExclusiveGatewayBranch[]
  /** The rule/policy/criteria the decision is based on. */
  decisionBasis?: string
}

export interface InclusiveGatewayBranch {
  condition?: string | null
  path: BpmnElement[]
  next?: string | null
  is_default?: boolean
  /** Faithful English translation of `condition` (emitted on the branch flow). */
  conditionEn?: string
  /** Faithful Arabic translation of `condition` (emitted on the branch flow). */
  conditionAr?: string
}

export interface InclusiveGateway extends BilingualLabelFields {
  type: 'inclusiveGateway'
  id: string
  label: string
  has_join: boolean
  branches: InclusiveGatewayBranch[]
  /** The rule/policy/criteria the decision is based on. */
  decisionBasis?: string
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

/** Zod shape fragment for {@link BilingualLabelFields} (lenient). */
const bilingualLabelShape = {
  labelEn: LooseOrgString,
  labelAr: LooseOrgString
}

/** Zod shape fragment for {@link OrgActivityFields} (lenient). */
const orgActivityShape = {
  owner: LooseOrgString,
  ownerRole: LooseOrgString,
  channel: LooseOrgString,
  channelDetail: LooseOrgString,
  cc: LooseOrgStringArray,
  inputs: LooseOrgStringArray,
  outputs: LooseOrgStringArray,
  respList: LooseOrgStringArray,
  kind: LooseOrgString
}

export const BpmnTaskSchema = z.object({
  type: z.enum(TASK_TYPES),
  id: z.string(),
  label: z.string(),
  ...bilingualLabelShape,
  ...orgActivityShape,
  decisionBasis: LooseOrgString
})

export const BpmnCallActivitySchema = z.object({
  type: z.literal('callActivity'),
  id: z.string(),
  label: z.string(),
  calledProcess: z.string().nullish(),
  confidence: z.enum(['high', 'low']).optional(),
  ...bilingualLabelShape,
  ...orgActivityShape
})

export const BpmnEventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  id: z.string(),
  label: z.string().optional(),
  eventDefinition: z.enum(EVENT_DEFINITION_TYPES).optional(),
  ...bilingualLabelShape,
  trigger: LooseOrgString,
  triggerService: LooseOrgString,
  triggerDetail: LooseOrgString
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
  next: z.string().nullish(),
  conditionEn: LooseOrgString,
  conditionAr: LooseOrgString
})

export const ExclusiveGatewaySchema: z.ZodType<ExclusiveGateway> = z.object({
  type: z.literal('exclusiveGateway'),
  id: z.string(),
  label: z.string(),
  has_join: z.boolean(),
  branches: z.array(ExclusiveGatewayBranchSchema),
  ...bilingualLabelShape,
  decisionBasis: LooseOrgString
})

export const InclusiveGatewayBranchSchema: z.ZodType<InclusiveGatewayBranch> = z.object({
  condition: z.string().nullish(),
  path: z.array(BpmnElementSchema).default([]),
  next: z.string().nullish(),
  is_default: z.boolean().default(false),
  conditionEn: LooseOrgString,
  conditionAr: LooseOrgString
})

export const InclusiveGatewaySchema: z.ZodType<InclusiveGateway> = z.object({
  type: z.literal('inclusiveGateway'),
  id: z.string(),
  label: z.string(),
  has_join: z.boolean(),
  branches: z.array(InclusiveGatewayBranchSchema),
  ...bilingualLabelShape,
  decisionBasis: LooseOrgString
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

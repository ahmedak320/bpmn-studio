/**
 * `ArisPatchProposalV1` and the allowed patch-command set — plan section 18.3.
 *
 * The allowed commands are EXACTLY the sixteen the plan lists. Every command is validated with
 * a strict `zod` object (unknown payload keys are rejected) inside a `z.discriminatedUnion` on
 * `kind` (an unrecognized `kind` literal fails to match any branch and the whole parse fails —
 * see `parseArisPatchProposal`). Payload shapes are this module's own — parallel to, but not
 * imported from, `src/aris/model/commands.ts` — see `modelCommandMapping.ts` for how each one
 * ultimately becomes a real `ArisEditCommand`.
 */

import { z } from 'zod'

// --- shared fragments ------------------------------------------------------------------------

const ownerKindSchema = z.enum(['model', 'objectDefinition', 'connectionDefinition'])

const attributeValueSchema = z
  .object({
    localeId: z.string().min(1).nullable(),
    text: z.string().min(1)
  })
  .strict()

const localizedValuesSchema = z
  .object({
    values: z
      .record(z.string().min(1), z.string())
      .refine((values) => Object.keys(values).length > 0, {
        message: 'names must carry at least one locale value'
      }),
    fallback: z.string().nullable()
  })
  .strict()

const pointSchema = z.object({ x: z.number(), y: z.number() }).strict()

/** Core EPC control-flow object types this proposal system is willing to author. */
export const CORE_CONTROL_FLOW_OBJECT_TYPES = ['OT_FUNC', 'OT_EVT', 'OT_RULE'] as const

// --- per-command payload schemas ---------------------------------------------------------

const setLocalizedNamePayloadSchema = z
  .object({
    ownerKind: ownerKindSchema,
    ownerId: z.string().min(1),
    localeId: z.string().min(1),
    value: z.string().min(1)
  })
  .strict()

const setAttributePayloadSchema = z
  .object({
    ownerKind: ownerKindSchema,
    ownerId: z.string().min(1),
    attributeType: z.string().min(1),
    values: z.array(attributeValueSchema)
  })
  .strict()

const addAttributeValuePayloadSchema = z
  .object({
    ownerKind: ownerKindSchema,
    ownerId: z.string().min(1),
    attributeType: z.string().min(1),
    value: attributeValueSchema
  })
  .strict()

const addMetadataDefinitionPayloadSchema = z
  .object({
    definitionId: z.string().min(1),
    objectType: z
      .string()
      .min(1)
      .refine((type) => !(CORE_CONTROL_FLOW_OBJECT_TYPES as readonly string[]).includes(type), {
        message:
          'addMetadataDefinition cannot target a core control-flow object type; use addCoreObject'
      }),
    names: localizedValuesSchema
  })
  .strict()

const addMetadataOccurrencePayloadSchema = z
  .object({
    occurrenceId: z.string().min(1),
    definitionId: z.string().min(1),
    modelId: z.string().min(1),
    symbol: z.string().min(1).nullable()
  })
  .strict()

const addMetadataConnectionPayloadSchema = z
  .object({
    connectionDefinitionId: z.string().min(1),
    connectionType: z.string().min(1),
    connectionOccurrenceId: z.string().min(1),
    modelId: z.string().min(1),
    fromObjectDefinitionId: z.string().min(1),
    toObjectDefinitionId: z.string().min(1),
    sourceOccurrenceId: z.string().min(1),
    targetOccurrenceId: z.string().min(1)
  })
  .strict()

const addCoreObjectPayloadSchema = z
  .object({
    definitionId: z.string().min(1),
    occurrenceId: z.string().min(1),
    modelId: z.string().min(1),
    objectType: z.enum(CORE_CONTROL_FLOW_OBJECT_TYPES),
    symbol: z.string().min(1),
    names: localizedValuesSchema
  })
  .strict()

const addCoreConnectionPayloadSchema = z
  .object({
    connectionDefinitionId: z.string().min(1),
    connectionType: z.string().min(1),
    connectionOccurrenceId: z.string().min(1),
    modelId: z.string().min(1),
    fromObjectDefinitionId: z.string().min(1),
    toObjectDefinitionId: z.string().min(1),
    sourceOccurrenceId: z.string().min(1),
    targetOccurrenceId: z.string().min(1),
    /** True when this connection re-enters an earlier point in the flow (plan 18.4). */
    isReturnBackEdge: z.boolean().optional()
  })
  .strict()

const setAssignmentPayloadSchema = z
  .object({
    objectDefinitionId: z.string().min(1),
    modelId: z.string().min(1),
    action: z.enum(['add', 'remove'])
  })
  .strict()

const setRoutePayloadSchema = z
  .object({
    connectionOccurrenceId: z.string().min(1),
    route: z.array(pointSchema)
  })
  .strict()

const reconnectPayloadSchema = z
  .object({
    connectionOccurrenceId: z.string().min(1),
    sourceOccurrenceId: z.string().min(1).optional(),
    targetOccurrenceId: z.string().min(1).optional()
  })
  .strict()
  .refine(
    (payload) =>
      payload.sourceOccurrenceId !== undefined || payload.targetOccurrenceId !== undefined,
    {
      message: 'reconnect must change at least one endpoint'
    }
  )

const deleteConnectionPayloadSchema = z
  .object({ connectionOccurrenceId: z.string().min(1) })
  .strict()
const deleteOccurrencePayloadSchema = z.object({ occurrenceId: z.string().min(1) }).strict()
const deleteDefinitionPayloadSchema = z.object({ definitionId: z.string().min(1) }).strict()
const deleteConnectionDefinitionPayloadSchema = z
  .object({ definitionId: z.string().min(1) })
  .strict()
const removeAttachmentPayloadSchema = z
  .object({ attachmentId: z.string().min(1), ownerId: z.string().min(1) })
  .strict()

// --- command envelope ----------------------------------------------------------------------

function commandSchema<TKind extends string, TPayload extends z.ZodTypeAny>(
  kind: TKind,
  payload: TPayload
) {
  return z
    .object({
      commandId: z.string().min(1),
      kind: z.literal(kind),
      /** Ids of everything this command touches, for confirmation-preview purposes (18.6). */
      targetIds: z.array(z.string().min(1)).min(1),
      payload
    })
    .strict()
}

export const arisPatchCommandSchema = z.discriminatedUnion('kind', [
  commandSchema('setLocalizedName', setLocalizedNamePayloadSchema),
  commandSchema('setAttribute', setAttributePayloadSchema),
  commandSchema('addAttributeValue', addAttributeValuePayloadSchema),
  commandSchema('addMetadataDefinition', addMetadataDefinitionPayloadSchema),
  commandSchema('addMetadataOccurrence', addMetadataOccurrencePayloadSchema),
  commandSchema('addMetadataConnection', addMetadataConnectionPayloadSchema),
  commandSchema('addCoreObject', addCoreObjectPayloadSchema),
  commandSchema('addCoreConnection', addCoreConnectionPayloadSchema),
  commandSchema('setAssignment', setAssignmentPayloadSchema),
  commandSchema('setRoute', setRoutePayloadSchema),
  commandSchema('reconnect', reconnectPayloadSchema),
  commandSchema('deleteConnection', deleteConnectionPayloadSchema),
  commandSchema('deleteOccurrence', deleteOccurrencePayloadSchema),
  commandSchema('deleteDefinition', deleteDefinitionPayloadSchema),
  commandSchema('deleteConnectionDefinition', deleteConnectionDefinitionPayloadSchema),
  commandSchema('removeAttachment', removeAttachmentPayloadSchema)
])

export type ArisChatCommand = z.infer<typeof arisPatchCommandSchema>
export type ArisChatCommandKind = ArisChatCommand['kind']

/** The exact sixteen allowed command kinds, in the order plan 18.3 lists them. */
export const ARIS_CHAT_COMMAND_KINDS: readonly ArisChatCommandKind[] = Object.freeze([
  'setLocalizedName',
  'setAttribute',
  'addAttributeValue',
  'addMetadataDefinition',
  'addMetadataOccurrence',
  'addMetadataConnection',
  'addCoreObject',
  'addCoreConnection',
  'setAssignment',
  'setRoute',
  'reconnect',
  'deleteConnection',
  'deleteOccurrence',
  'deleteDefinition',
  'deleteConnectionDefinition',
  'removeAttachment'
])

export const arisPatchProposalSchema = z
  .object({
    version: z.literal(1),
    baseRevision: z.number().int().nonnegative(),
    commands: z.array(arisPatchCommandSchema).min(1).max(50),
    /** Optional short human-readable rationale surfaced in the confirmation UI. */
    rationale: z.string().max(2000).optional()
  })
  .strict()

export type ArisPatchProposalV1 = z.infer<typeof arisPatchProposalSchema>

/** Zod-version-independent issue shape, so callers never depend on zod's internal issue type. */
export interface ArisPatchIssue {
  readonly path: readonly string[]
  readonly message: string
}

function toArisPatchIssues(
  issues: { readonly path: readonly PropertyKey[]; readonly message: string }[]
): readonly ArisPatchIssue[] {
  return issues.map((issue) =>
    Object.freeze({ path: issue.path.map((segment) => String(segment)), message: issue.message })
  )
}

export class ArisPatchSchemaError extends Error {
  readonly issues: readonly ArisPatchIssue[]

  constructor(message: string, issues: readonly ArisPatchIssue[]) {
    super(message)
    this.name = 'ArisPatchSchemaError'
    this.issues = issues
  }
}

/** Parses and validates a raw (untrusted, AI-produced) value as an `ArisPatchProposalV1`. */
export function parseArisPatchProposal(value: unknown): ArisPatchProposalV1 {
  const result = arisPatchProposalSchema.safeParse(value)
  if (!result.success) {
    throw new ArisPatchSchemaError(
      'Invalid ARIS patch proposal.',
      toArisPatchIssues(result.error.issues)
    )
  }
  return result.data
}

/** Parses a single command. Rejects any `kind` outside the allowed sixteen. */
export function parseArisChatCommand(value: unknown): ArisChatCommand {
  const result = arisPatchCommandSchema.safeParse(value)
  if (!result.success) {
    throw new ArisPatchSchemaError(
      'Invalid ARIS patch command.',
      toArisPatchIssues(result.error.issues)
    )
  }
  return result.data
}

import { describe, expect, it } from 'vitest'
import type { z } from 'zod'

import { canonicalJsonText } from '../packages/canonicalJson'
import {
  CANONICAL_CONFIDENCE_VALUES,
  CANONICAL_CONTROL_KINDS,
  CANONICAL_EDGE_KINDS,
  CANONICAL_NODE_KINDS,
  CANONICAL_UNKNOWN_KINDS,
  CanonicalApprovalSchema,
  CanonicalControlSchema,
  CanonicalDecisionOutcomeSchema,
  CanonicalDecisionSchema,
  CanonicalEdgeSchema,
  CanonicalFactSchema,
  CanonicalIdentitySchema,
  CanonicalInformationObjectSchema,
  CanonicalNodeSchema,
  CanonicalProcessV1Schema,
  CanonicalRoleSchema,
  CanonicalSystemSchema,
  CanonicalTextSchema,
  CanonicalUnknownSchema
} from './contract'
import { CANONICAL_SAFE_ID_PATTERN } from './ids'
import { buildCanonicalProcessJsonSchema } from './jsonSchema'

type Obj = Record<string, unknown>

function asObj(node: unknown): Obj {
  return node as Obj
}

/** `.properties` of an object-type schema fragment. */
function props(node: unknown): Obj {
  return (asObj(node).properties ?? {}) as Obj
}

/** `.items` of an array-type schema fragment (itself an object-type fragment). */
function items(node: unknown): Obj {
  return asObj(asObj(node).items)
}

/** `.required` of an object-type schema fragment — `[]` when the key is omitted entirely. */
function requiredOf(node: unknown): string[] {
  return ((asObj(node).required as string[] | undefined) ?? []).slice().sort()
}

function propertyKeysOf(node: unknown): string[] {
  return Object.keys(props(node)).sort()
}

function isOptionalZodField(fieldSchema: z.ZodType): boolean {
  return fieldSchema.safeParse(undefined).success
}

function shapeKeysOf(shape: Record<string, z.ZodType>): string[] {
  return Object.keys(shape).sort()
}

function requiredShapeKeysOf(shape: Record<string, z.ZodType>): string[] {
  return Object.keys(shape)
    .filter((key) => !isOptionalZodField(shape[key]))
    .sort()
}

function collectObjectNodes(node: unknown, acc: Obj[]): Obj[] {
  if (node === null || typeof node !== 'object') return acc
  const obj = node as Obj
  if (obj.type === 'object') acc.push(obj)
  if (obj.properties && typeof obj.properties === 'object') {
    for (const value of Object.values(obj.properties as Obj)) collectObjectNodes(value, acc)
  }
  if (obj.items && typeof obj.items === 'object') collectObjectNodes(obj.items, acc)
  if (Array.isArray(obj.anyOf)) {
    for (const branch of obj.anyOf) collectObjectNodes(branch, acc)
  }
  return acc
}

const schema = buildCanonicalProcessJsonSchema()
const topProps = props(schema)
const decisionSchemaNode = items(topProps.decisions)

describe('buildCanonicalProcessJsonSchema', () => {
  it('is stable across two calls (canonicalJsonText snapshot equality)', () => {
    const first = buildCanonicalProcessJsonSchema()
    const second = buildCanonicalProcessJsonSchema()
    expect(first).not.toBe(second)
    expect(canonicalJsonText(first)).toBe(canonicalJsonText(second))
  })

  it('pins version to the literal 1 and forbids extra keys at the top level', () => {
    expect((topProps.version as Obj).const).toBe(1)
    expect((schema as Obj).additionalProperties).toBe(false)
    expect((schema as Obj).type).toBe('object')
  })

  it('locks additionalProperties:false on every object node in the schema tree', () => {
    const objectNodes = collectObjectNodes(schema, [])
    // Sanity: the walk actually found every object type (top + 9 array item types + identity + CanonicalText + decision outcome).
    expect(objectNodes.length).toBeGreaterThanOrEqual(12)
    for (const node of objectNodes) {
      expect(node.additionalProperties).toBe(false)
    }
  })

  it('locks every kind/enum field to its exported vocabulary constant (drift guard)', () => {
    expect((props(items(topProps.nodes)).kind as Obj).enum).toEqual(CANONICAL_NODE_KINDS)
    expect((props(items(topProps.edges)).kind as Obj).enum).toEqual(CANONICAL_EDGE_KINDS)
    expect((props(items(topProps.controls)).kind as Obj).enum).toEqual(CANONICAL_CONTROL_KINDS)
    expect((props(items(topProps.unknowns)).kind as Obj).enum).toEqual(CANONICAL_UNKNOWN_KINDS)
  })

  it('pins confidence everywhere to high/medium/low', () => {
    const arrayKeysWithConfidence = [
      'nodes',
      'decisions',
      'edges',
      'roles',
      'systems',
      'informationObjects',
      'controls',
      'facts'
    ]
    for (const key of arrayKeysWithConfidence) {
      expect((props(items(topProps[key])).confidence as Obj).enum).toEqual(
        CANONICAL_CONFIDENCE_VALUES
      )
    }
    expect((props(topProps.identity).confidence as Obj).enum).toEqual(CANONICAL_CONFIDENCE_VALUES)
  })

  it('leaves optional fields out of required and does not make them nullable', () => {
    const nodeRequired = requiredOf(items(topProps.nodes))
    expect(nodeRequired).not.toContain('description')
    expect(nodeRequired).not.toContain('waitDetail')
    expect(nodeRequired).not.toContain('targetProcessRef')
    expect(nodeRequired).not.toContain('factIds')
    const identityRequired = requiredOf(topProps.identity)
    expect(identityRequired).not.toContain('purpose')
    expect(identityRequired).not.toContain('code')
    expect(identityRequired).not.toContain('processVersion')
  })

  it('expresses the CanonicalText "at least one of en/ar" invariant as anyOf', () => {
    const names = asObj(props(topProps.identity).names)
    expect(names.anyOf).toEqual([{ required: ['en'] }, { required: ['ar'] }])
  })

  it('constrains declared id fields to the safe-id pattern (mirrors the zod contract)', () => {
    const pattern = CANONICAL_SAFE_ID_PATTERN.source
    expect((props(topProps.identity).id as Obj).pattern).toBe(pattern)
    expect((props(items(topProps.nodes)).id as Obj).pattern).toBe(pattern)
    expect((props(items(topProps.edges)).id as Obj).pattern).toBe(pattern)
    expect((props(items(topProps.decisions)).id as Obj).pattern).toBe(pattern)
    expect((props(items(topProps.facts)).id as Obj).pattern).toBe(pattern)
    expect((props(items(topProps.nodes)).targetProcessRef as Obj).pattern).toBe(pattern)
    // Non-id strings are NOT pattern-constrained (e.g. identity.code, evidenceRefs).
    expect((props(topProps.identity).code as Obj).pattern).toBeUndefined()
  })
})

describe('contract <-> schema structural drift guard', () => {
  interface DriftCase {
    readonly name: string
    readonly shape: Record<string, z.ZodType>
    readonly jsonSchemaNode: Obj
  }

  const cases: readonly DriftCase[] = [
    {
      name: 'CanonicalProcessV1 (top level)',
      shape: CanonicalProcessV1Schema.shape,
      jsonSchemaNode: asObj(schema)
    },
    {
      name: 'identity',
      shape: CanonicalIdentitySchema.shape,
      jsonSchemaNode: asObj(topProps.identity)
    },
    { name: 'node', shape: CanonicalNodeSchema.shape, jsonSchemaNode: items(topProps.nodes) },
    { name: 'decision', shape: CanonicalDecisionSchema.shape, jsonSchemaNode: decisionSchemaNode },
    {
      name: 'decision outcome',
      shape: CanonicalDecisionOutcomeSchema.shape,
      jsonSchemaNode: items(props(decisionSchemaNode).outcomes)
    },
    {
      name: 'approval',
      shape: CanonicalApprovalSchema.shape,
      jsonSchemaNode: asObj(props(decisionSchemaNode).approval)
    },
    { name: 'edge', shape: CanonicalEdgeSchema.shape, jsonSchemaNode: items(topProps.edges) },
    { name: 'role', shape: CanonicalRoleSchema.shape, jsonSchemaNode: items(topProps.roles) },
    { name: 'system', shape: CanonicalSystemSchema.shape, jsonSchemaNode: items(topProps.systems) },
    {
      name: 'informationObject',
      shape: CanonicalInformationObjectSchema.shape,
      jsonSchemaNode: items(topProps.informationObjects)
    },
    {
      name: 'control',
      shape: CanonicalControlSchema.shape,
      jsonSchemaNode: items(topProps.controls)
    },
    { name: 'fact', shape: CanonicalFactSchema.shape, jsonSchemaNode: items(topProps.facts) },
    {
      name: 'unknown',
      shape: CanonicalUnknownSchema.shape,
      jsonSchemaNode: items(topProps.unknowns)
    },
    {
      name: 'CanonicalText (via identity.names)',
      shape: CanonicalTextSchema.shape,
      jsonSchemaNode: asObj(props(topProps.identity).names)
    }
  ]

  it.each(cases)(
    '$name: JSON Schema properties keys match the zod shape exactly',
    ({ shape, jsonSchemaNode }) => {
      expect(propertyKeysOf(jsonSchemaNode)).toEqual(shapeKeysOf(shape))
    }
  )

  it.each(cases)(
    '$name: JSON Schema required keys match zod optionality exactly',
    ({ shape, jsonSchemaNode }) => {
      expect(requiredOf(jsonSchemaNode)).toEqual(requiredShapeKeysOf(shape))
    }
  )
})

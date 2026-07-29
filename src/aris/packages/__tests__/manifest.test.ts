import { describe, expect, it } from 'vitest'
import { CanonicalJsonError, canonicalJsonBytes, canonicalJsonText } from '../canonicalJson'
import {
  ArisManifestError,
  createArisManifest,
  parseArisManifest,
  serializeArisManifest,
  validateArisManifest,
  type ArisFidelitySummary,
  type ArisSourcePackageManifestV1
} from '../manifest'

const DIGEST = 'b'.repeat(64)
const ACCOUNTING_DIGEST = 'c'.repeat(64)
const REVISION_ID = 'r000000-0123456789abcdef01234567'

const fidelity: ArisFidelitySummary = Object.freeze({
  totalRecords: 10,
  accountedRecords: 9,
  unaccountedRecords: 1,
  editableNative: 4,
  visualOnly: 2,
  sidePanel: 1,
  attachments: 1,
  rawSourceOnly: 1,
  proposedRepair: 0,
  unsupported: 0,
  issues: Object.freeze([
    Object.freeze({ code: 'missing-font' as const, count: 2 }),
    Object.freeze({ code: 'unknown-symbol' as const, count: 1, detail: 'ST_CUSTOM_42' })
  ])
})

function baseManifest(): ArisSourcePackageManifestV1 {
  return createArisManifest({
    source: {
      name: 'AnimalWF.xml',
      mediaType: 'application/xml',
      byteLength: 4096,
      sha256: DIGEST,
      arisVersion: '10.0.14.0'
    },
    origin: { kind: 'imported-aml' },
    currentRevisionId: REVISION_ID,
    models: [
      {
        modelId: 'Model.2',
        name: 'Discharge',
        modelType: 'MT_EEPC',
        objectCount: 3,
        connectionCount: 2,
        sourcePath: '/AML/Group[1]/Model[2]'
      },
      {
        modelId: 'Model.1',
        name: 'Intake',
        modelType: 'MT_EEPC',
        objectCount: 5,
        connectionCount: 4,
        sourcePath: '/AML/Group[1]/Model[1]'
      }
    ],
    attachments: [
      {
        attachmentId: 'Att.1',
        sourceId: 'ObjDef.7',
        name: 'plan.pdf',
        mediaType: 'application/pdf',
        byteLength: 12,
        sha256: 'd'.repeat(64),
        path: 'attachments/ObjDef.7/plan.pdf'
      }
    ],
    references: [],
    accountingSha256: ACCOUNTING_DIGEST,
    fidelity
  })
}

describe('canonical JSON', () => {
  it('sorts keys and is independent of insertion order', () => {
    const left = { b: 1, a: { d: 2, c: 3 }, list: [1, 2] }
    const right = { list: [1, 2], a: { c: 3, d: 2 }, b: 1 }
    expect(canonicalJsonText(left)).toBe(canonicalJsonText(right))
    expect(canonicalJsonText(left)).toBe('{"a":{"c":3,"d":2},"b":1,"list":[1,2]}')
  })

  it('escapes non-ASCII deterministically and drops undefined members', () => {
    expect(canonicalJsonText({ text: 'عربي', keep: null, skip: undefined })).toBe(
      '{"keep":null,"text":"\\u0639\\u0631\\u0628\\u064a"}'
    )
  })

  it('rejects values that could serialize ambiguously', () => {
    expect(() => canonicalJsonText({ n: 1.5 })).toThrow(CanonicalJsonError)
    expect(() => canonicalJsonText({ n: Number.NaN })).toThrow(CanonicalJsonError)
    expect(() => canonicalJsonText({ n: Number.MAX_SAFE_INTEGER + 2 })).toThrow(CanonicalJsonError)
    expect(() => canonicalJsonText({ when: new Date(0) })).toThrow(CanonicalJsonError)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => canonicalJsonText(cyclic)).toThrow(CanonicalJsonError)
  })

  it('normalizes negative zero', () => {
    expect(canonicalJsonText({ n: -0 })).toBe(canonicalJsonText({ n: 0 }))
  })

  it('appends exactly one trailing newline', () => {
    const bytes = canonicalJsonBytes({ a: 1 })
    expect(new TextDecoder().decode(bytes)).toBe('{"a":1}\n')
  })
})

describe('ARIS source-package manifest', () => {
  it('serializes byte-identically across repeats and key-insertion orders', () => {
    const manifest = baseManifest()
    const first = serializeArisManifest(manifest)
    const second = serializeArisManifest(manifest)
    expect(Array.from(second)).toEqual(Array.from(first))

    const reordered = {
      fidelity: manifest.fidelity,
      accountingSha256: manifest.accountingSha256,
      references: manifest.references,
      attachments: manifest.attachments,
      models: manifest.models,
      currentRevisionId: manifest.currentRevisionId,
      origin: manifest.origin,
      source: {
        arisVersion: manifest.source.arisVersion,
        sha256: manifest.source.sha256,
        byteLength: manifest.source.byteLength,
        mediaType: manifest.source.mediaType,
        name: manifest.source.name
      },
      version: manifest.version,
      format: manifest.format
    }
    expect(Array.from(serializeArisManifest(reordered as ArisSourcePackageManifestV1))).toEqual(
      Array.from(first)
    )
  })

  it('normalizes collection order so equal content yields equal bytes', () => {
    const manifest = baseManifest()
    expect(manifest.models.map((model) => model.modelId)).toEqual(['Model.1', 'Model.2'])
    expect(manifest.fidelity.issues.map((issue) => issue.code)).toEqual([
      'missing-font',
      'unknown-symbol'
    ])
  })

  it('round-trips through parse without changing bytes', () => {
    const bytes = serializeArisManifest(baseManifest())
    const parsed = parseArisManifest(bytes)
    expect(Array.from(serializeArisManifest(parsed))).toEqual(Array.from(bytes))
  })

  it('contains no timestamp-like or machine-specific content', () => {
    const text = new TextDecoder().decode(serializeArisManifest(baseManifest()))
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/u)
    expect(text).not.toMatch(/generatedAt|createdAt|hostname|userName/u)
  })

  it('rejects malformed manifests', () => {
    const manifest = baseManifest() as unknown as Record<string, unknown>
    const cases: Array<[string, unknown]> = [
      ['unknown key', { ...manifest, extra: true }],
      ['wrong format', { ...manifest, format: 'something-else' }],
      ['wrong version', { ...manifest, version: 2 }],
      ['bad digest', { ...manifest, accountingSha256: 'nope' }],
      ['upper-case digest', { ...manifest, accountingSha256: 'C'.repeat(64) }],
      ['bad revision id', { ...manifest, currentRevisionId: 'rev-1' }],
      ['unknown origin', { ...manifest, origin: { kind: 'telepathy' } }],
      ['origin extra key', { ...manifest, origin: { kind: 'imported-aml', model: 'x' } }],
      [
        'negative count',
        { ...manifest, source: { ...(manifest.source as object), byteLength: -1 } }
      ],
      [
        'fractional count',
        { ...manifest, source: { ...(manifest.source as object), byteLength: 1.5 } }
      ],
      [
        'traversal source name',
        { ...manifest, source: { ...(manifest.source as object), name: '../x' } }
      ],
      [
        'bad media type',
        { ...manifest, source: { ...(manifest.source as object), mediaType: 'xml' } }
      ],
      ['missing fidelity', { ...manifest, fidelity: undefined }],
      [
        'inconsistent fidelity totals',
        { ...manifest, fidelity: { ...fidelity, accountedRecords: 3 } }
      ],
      [
        'unknown fidelity issue',
        { ...manifest, fidelity: { ...fidelity, issues: [{ code: 'made-up', count: 1 }] } }
      ],
      [
        'unsorted models',
        {
          ...manifest,
          models: [...(manifest.models as unknown[])].reverse()
        }
      ],
      [
        'duplicate models',
        {
          ...manifest,
          models: [(manifest.models as unknown[])[0], (manifest.models as unknown[])[0]]
        }
      ],
      ['null', null],
      ['array', []],
      ['string', 'manifest']
    ]
    for (const [label, value] of cases) {
      expect(() => validateArisManifest(value), label).toThrow(ArisManifestError)
    }
  })

  it('rejects credential-shaped provenance', () => {
    expect(() =>
      createArisManifest({
        source: {
          name: 'brief.md',
          mediaType: 'text/markdown',
          byteLength: 10,
          sha256: DIGEST
        },
        origin: {
          kind: 'description',
          generation: {
            provider: 'anthropic',
            model: 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA',
            requestSha256: 'e'.repeat(64),
            retainedSourcePath: 'original/brief.md'
          }
        },
        currentRevisionId: REVISION_ID,
        accountingSha256: ACCOUNTING_DIGEST,
        fidelity
      })
    ).toThrow(ArisManifestError)
  })

  it('rejects invalid JSON text', () => {
    expect(() => parseArisManifest('{not json')).toThrow(ArisManifestError)
  })
})

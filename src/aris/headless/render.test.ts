/**
 * Runs under the DEFAULT vitest node environment (NO `@vitest-environment
 * jsdom` docblock) on purpose: it proves the headless CLI/library path, where
 * `renderCanonicalProcess` must construct its own jsdom DOM via
 * `ensureHeadlessDom` rather than lean on a test-provided one.
 */

import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import type { CanonicalProcessV1 } from '../canonical'
import { VALID_CANONICAL_FULL } from '../canonical/fixtures'
import { canonicalJsonBytes } from '../packages/canonicalJson'
import { renderCanonicalProcess } from './render'

const sha256Hex = (input: string | Uint8Array): string =>
  createHash('sha256').update(input).digest('hex')

/**
 * Committed snapshot of the `VALID_CANONICAL_FULL` render's `svg` string.
 * Updating this constant is an explicit, reviewed act — the "engine version /
 * projection / renderer output changed" signal. A byte change here without a
 * matching, intended cause is a regression, not a snapshot to blindly refresh.
 */
const VALID_CANONICAL_FULL_SVG_SHA256 =
  '84282bf7573f8a41731559e00233b808fff25bde8cc851e0b6481d61dfcbf8f2'

/** Schema-valid, but its projected EEPC has no start/end event — fails the gate. */
const STRUCTURALLY_INVALID: CanonicalProcessV1 = {
  version: 1,
  identity: { id: 'proc-broken', names: { en: 'Broken' }, confidence: 'high' },
  nodes: [{ id: 'n-only', kind: 'activity', names: { en: 'Lonely activity' }, confidence: 'high' }],
  decisions: [],
  edges: [],
  roles: [],
  systems: [],
  informationObjects: [],
  controls: [],
  facts: [],
  unknowns: []
}

/** Arabic-only names throughout — a valid start->activity->end flow. */
const AR_ONLY: CanonicalProcessV1 = {
  version: 1,
  identity: { id: 'proc-ar', names: { ar: 'عملية باللغة العربية' }, confidence: 'high' },
  nodes: [
    { id: 'n-start', kind: 'event', names: { ar: 'بداية العملية' }, confidence: 'high' },
    {
      id: 'n-task',
      kind: 'activity',
      names: { ar: 'تنفيذ خطوة المعالجة الرئيسية ضمن هذه العملية التجريبية' },
      confidence: 'high'
    },
    { id: 'n-end', kind: 'event', names: { ar: 'نهاية العملية' }, confidence: 'high' }
  ],
  decisions: [],
  edges: [
    {
      id: 'e-1',
      kind: 'sequence',
      sourceNodeId: 'n-start',
      targetNodeId: 'n-task',
      confidence: 'high'
    },
    {
      id: 'e-2',
      kind: 'sequence',
      sourceNodeId: 'n-task',
      targetNodeId: 'n-end',
      confidence: 'high'
    }
  ],
  roles: [],
  systems: [],
  informationObjects: [],
  controls: [],
  facts: [],
  unknowns: []
}

describe('renderCanonicalProcess — structural gate (before any canvas boot)', () => {
  // FIRST test in the file: it must observe `globalThis.document` still absent,
  // which only holds before any successful render has booted the headless DOM.
  it('returns {ok:false, reason:"validation"} and never boots the canvas', async () => {
    expect((globalThis as { document?: unknown }).document).toBeUndefined()

    const result = await renderCanonicalProcess(STRUCTURALLY_INVALID)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a validation failure')
    expect(result.reason).toBe('validation')
    if (result.reason !== 'validation') throw new Error('expected a validation failure')
    expect(result.findings.ok).toBe(false)
    expect(result.findings.findings.some((finding) => finding.severity === 'error')).toBe(true)

    // The pre-render gate short-circuited: no jsdom DOM was ever constructed.
    expect((globalThis as { document?: unknown }).document).toBeUndefined()
  })

  it('returns {ok:false, reason:"parse"} for a non-CanonicalProcessV1 input, without throwing', async () => {
    const result = await renderCanonicalProcess({ version: 2 } as unknown as CanonicalProcessV1)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a parse failure')
    expect(result.reason).toBe('parse')
    if (result.reason !== 'parse') throw new Error('expected a parse failure')
    expect(result.issues.length).toBeGreaterThan(0)
  })
})

describe('renderCanonicalProcess — VALID_CANONICAL_FULL', () => {
  it('renders ok:true with anchors for every canonical node and flow edge', async () => {
    const result = await renderCanonicalProcess(VALID_CANONICAL_FULL)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected a successful render')

    // Assert on the FINAL markup string — proves anchors survive the export
    // strip selector and clone.
    for (const node of VALID_CANONICAL_FULL.nodes) {
      expect(result.svg).toContain(`data-epc-node="${node.id}"`)
    }
    for (const edge of VALID_CANONICAL_FULL.edges) {
      expect(result.svg).toContain(`data-epc-edge="${edge.id}"`)
    }
  })

  it('stamps the four versioned metadata attributes with the expected values', async () => {
    const result = await renderCanonicalProcess(VALID_CANONICAL_FULL)
    if (!result.ok) throw new Error('expected a successful render')

    const expectedInputSha = sha256Hex(canonicalJsonBytes(VALID_CANONICAL_FULL))

    expect(result.svg).toContain('data-epc-engine-version="0.1.0"')
    expect(result.svg).toContain('data-epc-schema-version="1"')
    expect(result.svg).toContain('data-epc-projection-version="1"')
    expect(result.svg).toContain(`data-epc-input-sha256="${expectedInputSha}"`)
    // No source version was supplied.
    expect(result.svg).not.toContain('data-epc-source-version')

    expect(result.metadata).toEqual({
      engineVersion: '0.1.0',
      schemaVersion: 1,
      projectionVersion: 1,
      inputSha256: expectedInputSha,
      modelId: result.metadata.modelId
    })
    expect(result.metadata.modelId).toBe('Model.m:proc-full')
    expect(result.debugAml).toContain('<AML>')
  })

  it('passes sourceVersionId through to the SVG root and metadata verbatim', async () => {
    const result = await renderCanonicalProcess(VALID_CANONICAL_FULL, { sourceVersionId: 'v002' })
    if (!result.ok) throw new Error('expected a successful render')
    expect(result.svg).toContain('data-epc-source-version="v002"')
    expect(result.metadata.sourceVersionId).toBe('v002')
  })

  it('is deterministic: two runs produce byte-identical SVG matching the committed snapshot', async () => {
    const first = await renderCanonicalProcess(VALID_CANONICAL_FULL)
    const second = await renderCanonicalProcess(VALID_CANONICAL_FULL)
    if (!first.ok || !second.ok) throw new Error('expected successful renders')

    expect(second.svg).toBe(first.svg)
    expect(sha256Hex(first.svg)).toBe(VALID_CANONICAL_FULL_SVG_SHA256)
  })
})

describe('renderCanonicalProcess — Arabic (RTL) rendering', () => {
  it('renders rtl-attributed text with non-empty wrapped tspans for an AR-only process', async () => {
    const result = await renderCanonicalProcess(AR_ONLY)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected a successful render')

    expect(result.svg).toContain('direction="rtl"')
    // At least one non-empty <tspan> carrying Arabic script.
    expect(result.svg).toMatch(/<tspan[^>]*>[^<]*[؀-ۿ][^<]*<\/tspan>/u)
  })
})

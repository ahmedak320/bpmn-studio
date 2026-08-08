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
// Updated 2026-08-07: satellite symbolType fix (roles->ST_EMPL_TYPE,
// systems->ST_APPL_SYS, informationObjects->ST_INFO_CARR_EDOC, controls->
// ST_{BUSINESS_POLICY,BUSINESS_RULE,REQUIREMENT}) intentionally changes the
// AML SymbolNum values, which changes the SVG bytes. Re-updated same day
// after bumping EPC_ENGINE_VERSION 0.2.0 -> 0.3.0 (the stamped root
// attribute changes 3 bytes in the SVG string). Re-updated same day after
// switching `placeSatellites` from a single shared-column policy to a
// per-owner-column policy: each owner now gets its own satellite column and
// corridor immediately outside the control-flow bounding box, so satellite
// coordinates (and every satellite route's bends) move — the SVG bytes
// shift accordingly. Layout-only change; EPC_ENGINE_VERSION stays at 0.3.0.
// Re-updated same day after switching `projectToEpc` from one-satellite-per-
// canonical to one-satellite-per-(satellite, owner) pair: shared satellites
// (e.g., a role or system used by several functions) now project into N
// per-owner duplicates, each visually short-tethered to its own owning
// function. That removes the cross-page horizontal connectors of the shared-
// satellite layout, but grows the object count by (owners - 1) per shared
// satellite, so both the AML and the SVG bytes shift. Projection-behavior
// change; EPC_ENGINE_VERSION and PROJECTION_VERSION intentionally stay put
// (this is a rendering-shape improvement inside the same contract).
// Re-updated same day: rolled back the per-owner column layout (v27) — with
// per-owner satellite duplication in the projection, one column per owner
// blew the canvas to 7600px wide and OOM'd the container rasterizer. All
// satellites now share the single column at reservedCrossMax, and each
// owner's satellites stack downward from that owner's along-top. Canvas
// width stays bounded by core flow; each owner's satellites are still
// clustered locally by along position; and per-owner duplication (still in
// projectToEpc.ts) keeps every route short.
// Updated 2026-08-08 (layout polish, no version bump): satellite routing now
// draws ONE shared trunk per owner (item 1 trunk-and-branch) — every satellite
// route for a given owner shares an identical exit + gap-crossing prefix and
// only branches inside the corridor at each satellite's along-row, instead of
// N staggered per-satellite stubs. Only satellite connector geometry moves;
// the control-flow backbone is byte-identical, so this is a layout-only shift.
// Updated 2026-08-08 (overlay wire-through, no version bump): the ARIS canvas
// now registers `arisConnectionOverlay` (`../canvas/arisConnectionOverlay.ts`)
// in `ArisCanvasModule`. That service snapshots every connection's post-layout
// waypoints on `commandStack.changed` (which `applyCleanLayout` fires
// synchronously before the headless capture runs), delegates to the shared
// `../../org/edgeVisuals` geometry engine, and paints ONE non-interactive
// `<g class="orbitpm-connection-visuals">` into the active diagram layer —
// inside the `.viewport` the export clones, and carrying no class matched by
// `EXPORT_STRIP_SELECTOR`, so it survives `captureArisCanvasSvg` verbatim.
// Under that group it emits split/merge junction dots
// (`data-aris-edge-visual="junction"`) and line-hop bridge arcs + white masks
// (`data-aris-edge-visual="hop"`). VALID_CANONICAL_FULL gains 10 junction dots
// and 3 hops, growing the SVG by ~5KB — pure additive adornment; the
// control-flow backbone and every existing anchor byte are unchanged. Rendering
// addition only; EPC_ENGINE_VERSION and PROJECTION_VERSION intentionally stay put.
// Re-updated 2026-08-08 (default-legend + satellite suppression, no version
// bump): a top-right «Owner: IT Manager» / «System: ITSM Platform» legend is
// painted (`../canvas/defaultLegend.ts`, registered as `arisDefaultLegend`), and
// the per-step satellites matching those defaults are dropped from the SVG —
// r:r-manager@{n-triage,n-exception} and s:s-itsm@{n-log,n-triage} (4
// occurrences + their connectors). Both defaults come from VALID_CANONICAL_FULL:
// the owner via role.owner:true, the system s-itsm via the >=60% majority (2 of
// 3 system owner-nodes). The AML is unchanged — SVG-only rendering-shape change,
// no EPC_ENGINE_VERSION/PROJECTION_VERSION bump.
const VALID_CANONICAL_FULL_SVG_SHA256 =
  '39496dd90c9028796972d1532b75d2566cca2f58982b050c748528728f1943b3'

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

    expect(result.svg).toContain('data-epc-engine-version="0.3.0"')
    expect(result.svg).toContain('data-epc-schema-version="1"')
    expect(result.svg).toContain('data-epc-projection-version="1"')
    expect(result.svg).toContain(`data-epc-input-sha256="${expectedInputSha}"`)
    // No source version was supplied.
    expect(result.svg).not.toContain('data-epc-source-version')

    expect(result.metadata).toEqual({
      engineVersion: '0.3.0',
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

  it('paints diagram-wide connection adornments (junction dots + line hops)', async () => {
    // `arisConnectionOverlay` (registered in `ArisCanvasModule`) paints the
    // shared `edgeVisuals` geometry into the captured SVG. VALID_CANONICAL_FULL
    // has split/merge gateways (⇒ junctions) and crossing routes (⇒ hops), so
    // both adornment kinds must appear at least once.
    const result = await renderCanonicalProcess(VALID_CANONICAL_FULL)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected a successful render')

    const countOf = (needle: string): number => result.svg.split(needle).length - 1
    const junctions = countOf('data-aris-edge-visual="junction"')
    const hops = countOf('data-aris-edge-visual="hop"')

    expect(junctions).toBeGreaterThan(0)
    expect(hops).toBeGreaterThan(0)
    // Every hop is knocked out by exactly one white under-mask.
    expect(countOf('data-aris-edge-hop-mask="true"')).toBe(hops)
    // The overlay group is present exactly once.
    expect(countOf('class="orbitpm-connection-visuals"')).toBe(1)
  })

  it('paints a top-right default legend (owner + system) and drops the matching per-step satellites', async () => {
    const result = await renderCanonicalProcess(VALID_CANONICAL_FULL)
    if (!result.ok) throw new Error('expected a successful render')

    // Legend present exactly once, EN labels (default language).
    const countOf = (needle: string): number => result.svg.split(needle).length - 1
    expect(countOf('class="orbitpm-default-legend"')).toBe(1)
    expect(result.svg).toContain('Owner:')
    expect(result.svg).toContain('System:')
    // Owner declared via role.owner:true; system s-itsm via >=60% majority.
    expect(result.svg).toContain('IT Manager')
    expect(result.svg).toContain('ITSM Platform')
    expect(result.svg).toContain('data-legend-kind="owner"')
    expect(result.svg).toContain('data-legend-kind="system"')

    // The four suppressed satellite occurrences are gone from the SVG…
    const suppressed = [
      'ObjOcc.r:r-manager@n-triage',
      'ObjOcc.r:r-manager@n-exception',
      'ObjOcc.s:s-itsm@n-log',
      'ObjOcc.s:s-itsm@n-triage'
    ]
    for (const occ of suppressed) {
      expect(result.svg).not.toContain(occ)
      // …yet every one remains in the AML (lossless): its ObjectDefinition,
      // ObjectOccurrence and satellite Connection are all still emitted.
      expect(result.debugAml).toContain(occ)
      expect(result.debugAml).toContain(occ.replace('ObjOcc.', 'ObjDef.'))
    }
  })

  it('renders the AR default legend when language:"ar" is passed', async () => {
    const result = await renderCanonicalProcess(VALID_CANONICAL_FULL, { language: 'ar' })
    if (!result.ok) throw new Error('expected a successful render')
    const countOf = (needle: string): number => result.svg.split(needle).length - 1
    expect(countOf('class="orbitpm-default-legend"')).toBe(1)
    // AR owner label "المالك" and AR owner name; no EN "Owner:" leaks in.
    expect(result.svg).toContain('المالك')
    expect(result.svg).toContain('مدير تقنية المعلومات')
    expect(result.svg).not.toContain('Owner:')
  })

  it('keeps the AML lossless when default-owner suppression drops 20 satellites from the SVG', async () => {
    // A role that OWNS 20 activities becomes the process owner default; every one
    // of those 20 nodes has ONLY that role, so all 20 role duplicates are
    // suppressed from the SVG — while all 20 ObjectDefinitions survive in the AML.
    const nodeIds = Array.from({ length: 20 }, (_unused, index) => `n-a${index + 1}`)
    const canonical: CanonicalProcessV1 = {
      version: 1,
      identity: { id: 'proc-20', names: { en: 'Owner-heavy process' }, confidence: 'high' },
      nodes: [
        { id: 'n-start', kind: 'event', names: { en: 'Start' }, confidence: 'high' },
        ...nodeIds.map((id, index) => ({
          id,
          kind: 'activity' as const,
          names: { en: `Step ${index + 1}` },
          confidence: 'high' as const
        })),
        { id: 'n-end', kind: 'event', names: { en: 'End' }, confidence: 'high' }
      ],
      decisions: [],
      edges: [
        { id: 'e-start', kind: 'sequence', sourceNodeId: 'n-start', targetNodeId: 'n-a1', confidence: 'high' },
        ...nodeIds.slice(0, -1).map((id, index) => ({
          id: `e-${index + 1}`,
          kind: 'sequence' as const,
          sourceNodeId: id,
          targetNodeId: nodeIds[index + 1] as string,
          confidence: 'high' as const
        })),
        { id: 'e-end', kind: 'sequence', sourceNodeId: 'n-a20', targetNodeId: 'n-end', confidence: 'high' }
      ],
      roles: [
        {
          id: 'r-owner',
          names: { en: 'Survey Team' },
          nodeIds,
          owner: true,
          confidence: 'high'
        }
      ],
      systems: [],
      informationObjects: [],
      controls: [],
      facts: [],
      unknowns: []
    }

    const result = await renderCanonicalProcess(canonical)
    if (!result.ok) throw new Error('expected a successful render')

    // All 20 role-satellite ObjectDefinitions are present in the AML…
    for (const nodeId of nodeIds) {
      expect(result.debugAml).toContain(`ObjDef.r:r-owner@${nodeId}`)
      // …and every one is suppressed from the SVG.
      expect(result.svg).not.toContain(`ObjOcc.r:r-owner@${nodeId}`)
    }
    // 20 DISTINCT role-owner ObjectDefinitions in the AML, unchanged by
    // suppression (each id text also recurs as an ObjOcc reference, so dedupe).
    const distinctOwnerDefs = new Set(
      [...result.debugAml.matchAll(/ObjDef\.r:r-owner@n-a\d+/g)].map((match) => match[0])
    )
    expect(distinctOwnerDefs.size).toBe(20)
    // The legend declared the owner once.
    expect(result.svg).toContain('class="orbitpm-default-legend"')
    expect(result.svg).toContain('Survey Team')
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

/**
 * A valid start->activity->end flow whose END event name reads as a "reject"
 * outcome term but is NOT on a cycle — a return-path GAP the advisory
 * `detectReturnPathOutcomes` pass must surface.
 */
const RETURN_PATH_GAP: CanonicalProcessV1 = {
  version: 1,
  identity: { id: 'proc-return-gap', names: { en: 'Return gap process' }, confidence: 'high' },
  nodes: [
    { id: 'n-start', kind: 'event', names: { en: 'Request received' }, confidence: 'high' },
    { id: 'n-review', kind: 'activity', names: { en: 'Review request' }, confidence: 'high' },
    { id: 'n-end', kind: 'event', names: { en: 'Request rejected' }, confidence: 'high' }
  ],
  decisions: [],
  edges: [
    { id: 'e-1', kind: 'sequence', sourceNodeId: 'n-start', targetNodeId: 'n-review', confidence: 'high' },
    { id: 'e-2', kind: 'sequence', sourceNodeId: 'n-review', targetNodeId: 'n-end', confidence: 'high' }
  ],
  roles: [],
  systems: [],
  informationObjects: [],
  controls: [],
  facts: [],
  unknowns: []
}

describe('renderCanonicalProcess — narrative + verification companion artifacts', () => {
  it('returns a non-empty bilingual narrative for VALID_CANONICAL_FULL', async () => {
    const result = await renderCanonicalProcess(VALID_CANONICAL_FULL)
    if (!result.ok) throw new Error('expected a successful render')
    expect(result.narrative.schemaVersion).toBe(1)
    expect(result.narrative.en.length).toBeGreaterThan(0)
    expect(result.narrative.en).toContain('#')
    // VALID_CANONICAL_FULL carries AR names, so the AR narrative is populated too.
    expect(result.narrative.ar.length).toBeGreaterThan(0)
    // Narrative/verification are SEPARATE result fields — never stamped into svg.
    expect(result.svg).not.toContain(result.narrative.en.slice(0, 40))
  })

  it('emits narrative.en for an EN-only process (narrative.ar stays a string per the helper contract)', async () => {
    const result = await renderCanonicalProcess(RETURN_PATH_GAP)
    if (!result.ok) throw new Error('expected a successful render')
    expect(result.narrative.en.length).toBeGreaterThan(0)
    expect(result.narrative.en).toContain('Return gap process')
    // buildProcessNarrative always returns both locales (AR carries the
    // Arabic-structured document even for EN-only names); it is a string, never
    // undefined.
    expect(typeof result.narrative.ar).toBe('string')
  })

  it('returns a non-empty verification package for VALID_CANONICAL_FULL', async () => {
    const result = await renderCanonicalProcess(VALID_CANONICAL_FULL)
    if (!result.ok) throw new Error('expected a successful render')
    expect(result.verification.schemaVersion).toBe(2)
    expect(result.verification.processId).toBe('proc-full')
    expect(result.verification.mainFlow.length).toBeGreaterThan(0)
    expect(result.verification.trigger.length).toBeGreaterThan(0)
  })
})

describe('renderCanonicalProcess — print frame gating', () => {
  it('stamps the print-frame group into the SVG when printFrame:true', async () => {
    const result = await renderCanonicalProcess(VALID_CANONICAL_FULL, { printFrame: true })
    if (!result.ok) throw new Error('expected a successful render')
    expect(result.svg).toContain('data-aris-print-frame="true"')
  })

  it('omits the print-frame group when printFrame:false or unset', async () => {
    const explicitOff = await renderCanonicalProcess(VALID_CANONICAL_FULL, { printFrame: false })
    const unset = await renderCanonicalProcess(VALID_CANONICAL_FULL)
    if (!explicitOff.ok || !unset.ok) throw new Error('expected successful renders')
    expect(explicitOff.svg).not.toContain('data-aris-print-frame="true"')
    expect(unset.svg).not.toContain('data-aris-print-frame="true"')
  })
})

describe('renderCanonicalProcess — advisory return-path findings', () => {
  it('surfaces a missing return-path finding when an outcome node reads as a reject term', async () => {
    const result = await renderCanonicalProcess(RETURN_PATH_GAP)
    if (!result.ok) throw new Error('expected a successful render')
    expect(result.returnPathFindings.length).toBeGreaterThan(0)
    const gap = result.returnPathFindings.find(
      (finding) => finding.route.outcomeNodeId.includes('n.end') || finding.route.outcomeNodeId.includes('n-end')
    )
    expect(gap ?? result.returnPathFindings[0]).toBeDefined()
    const finding = result.returnPathFindings[0]
    expect(finding.source).toBe('return-path')
    expect(finding.route.status).toBe('missing')
    // The one editable upstream function ("Review request") is the recommendation.
    expect(finding.route.candidates.length).toBeGreaterThan(0)
    // Advisory only — the render still succeeds.
    expect(result.findings.ok).toBe(true)
  })

  it('returns no return-path findings when no node reads as a return/reject term', async () => {
    const result = await renderCanonicalProcess(AR_ONLY)
    if (!result.ok) throw new Error('expected a successful render')
    expect(result.returnPathFindings).toEqual([])
  })
})

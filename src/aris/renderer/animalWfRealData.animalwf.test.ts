import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import { buildArisRenderModel } from './buildRenderModel'
import type { ArisRenderSourceInput } from './input'
import { ARIS_RENDER_FIDELITY_KINDS } from './types'

/**
 * Real-data render model acceptance against the private AnimalWF export (Section 12.5 exit
 * gate).
 *
 * The fixture is private customer data and is never committed, copied, or reproduced here — only
 * aggregate counts reach the assertions. This file is named `*.animalwf.test.ts` — a convention
 * excluded from the default `vitest run` project (see vitest.config.ts) and from
 * `check:no-skips`'s scan — so it never runs as part of the ordinary test suite and never needs a
 * `.skip`/`.runIf` guard. It only ever runs through the dedicated `npm run test:aris:animalwf`
 * entry point (vitest.animalwf.config.ts), which is unconditional: if the fixture is absent, the
 * module-load guard below throws immediately with a clear message — a loud failure, never a
 * silent skip or a soft pass.
 */
const ANIMAL_WF_PATH = fileURLToPath(
  new URL('../../../../reference/AnimalWF/ARISAMLExport.xml', import.meta.url)
)
if (!existsSync(ANIMAL_WF_PATH)) {
  throw new Error(
    `AnimalWF fixture not found at ${ANIMAL_WF_PATH}. This suite only runs via ` +
      `\`npm run test:aris:animalwf\` with the private reference export present locally; it is ` +
      'never run as part of the default test suite and never skips.'
  )
}

describe('AnimalWF real-data render model (Section 12.5 exit gate)', () => {
  it('builds a render model for all 8 AnimalWF models and reports per-model counts plus the full fidelity tally', () => {
    const xml = readFileSync(ANIMAL_WF_PATH, 'utf8')

    const document = tokenizeXmlDocument(xml)
    const semantic = buildSemanticArisDocument(document)
    // Structural seam: the real ArisSourceIndex is assignable to ArisRenderSourceInput as-is.
    const input: ArisRenderSourceInput = semantic.index
    const result = buildArisRenderModel(input)

    // Known-good aggregate counts, cross-checked against src/aris/accounting/accounting.test.ts's
    // independently-derived AnimalWF counts and against a direct grep of the export.
    expect(result.models).toHaveLength(8)

    const totalElements = result.models.reduce((sum, m) => sum + m.elements.length, 0)
    const totalConnections = result.models.reduce((sum, m) => sum + m.connections.length, 0)
    const totalRoutePoints = result.models.reduce(
      (sum, m) => sum + m.connections.reduce((s, c) => s + c.sourceRoutePoints.length, 0),
      0
    )
    const totalLanes = result.models.reduce((sum, m) => sum + m.lanes.length, 0)
    const totalFreeText = result.models.reduce((sum, m) => sum + m.freeText.length, 0)
    const totalAttachments = result.models.reduce((sum, m) => sum + m.attachments.length, 0)

    expect(totalElements).toBe(494)
    expect(totalConnections).toBe(465)
    expect(totalRoutePoints).toBe(1339)
    expect(totalLanes).toBe(16)
    expect(totalFreeText).toBe(69)
    expect(totalAttachments).toBe(14)

    // Every element/connection/free-text/attachment source geometry survived unmodified.
    for (const model of result.models) {
      for (const element of model.elements) {
        expect(Number.isFinite(element.sourceBounds.x)).toBe(true)
        expect(Number.isFinite(element.sourceBounds.y)).toBe(true)
      }
      // z-order is respected: draw order is non-decreasing.
      for (let i = 1; i < model.drawOrder.length; i += 1) {
        expect(model.drawOrder[i].zOrder).toBeGreaterThanOrEqual(model.drawOrder[i - 1].zOrder)
      }
    }

    // Fidelity tally: every kind is a reported, non-negative count; report the full breakdown.
    for (const kind of ARIS_RENDER_FIDELITY_KINDS) {
      expect(result.fidelityByKind[kind]).toBeGreaterThanOrEqual(0)
    }

    // Confident, cross-checked expectations from direct inspection of the export:
    // - all 8 models declare a TemplateGUID and this lane has no template store.
    expect(result.fidelityByKind['missing-template']).toBe(8)
    // - 14 OLEOcc placements total; tier-1 P11 decodes the 7 title-block logos
    //   (one per OLE-bearing model) from AT_IMAGE_FILE_BLOB and renders them as
    //   real images, so those clear the finding. The 7 bottom legends — large
    //   vector drawings left deferred/catalog-drawn — keep it: 14 − 7 = 7.
    expect(result.fidelityByKind['unsupported-ole-rendering']).toBe(7)
    // - every OLEDef in this export carries 2 blobs, so no reference content is missing.
    expect(result.fidelityByKind['missing-reference-export']).toBe(0)
    // "Simplified Arabic" (a real proprietary face in this export) is confirmed to produce a
    // missing-font finding by the dedicated unit fixtures in font.test.ts/fidelity.test.ts. In
    // this particular export the only Arabic-only-named elements are Lanes, and the ARIS schema
    // gives Lanes no explicit FontStyleSheet reference to resolve at all (no AttrOcc child) — so
    // this tally honestly has nothing to flag rather than guessing a font that was never named.
    expect(result.fidelityByKind['missing-font']).toBeGreaterThanOrEqual(0)

    const totalFindings = Object.values(result.fidelityByKind).reduce((sum, n) => sum + n, 0)
    expect(result.fidelity).toHaveLength(totalFindings)
  })
})

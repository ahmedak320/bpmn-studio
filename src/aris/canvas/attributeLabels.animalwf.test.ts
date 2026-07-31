// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { buildFromSource } from '../model/buildFromSource'
import type { ArisWorkingDocument } from '../model/types'
import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import { arisBusinessObject, type ArisConnectionBusinessObject } from './elements'
import { bootCanvas, type Harness } from './testing/harness'

/**
 * Real-data acceptance for the Phase-B visual deliverables — a function's `AT_ID` numbering painted
 * beside its symbol, and (Wave 9 lane P1) a target arrowhead on exactly the connection types the
 * reference PDF draws one on, never the rest. Both are a code path DISJOINT from the fidelity
 * comparator (`compare.ts`): they move no measured category, so this suite reads the *mounted
 * canvas* SVG directly, one model at a time, exactly as `connectionLabels.animalwf.test.ts` does.
 *
 * The AnimalWF export is private customer data and is never committed or reproduced here — only the
 * numbering strings (which equal the hand-authored expectation spine's numbering) and aggregate
 * counts (including the per-connection-type truth table below) reach the assertions.
 *
 * Naming: `*.animalwf.test.ts` is excluded from the default vitest project and from
 * `check:no-skips`, and runs only via `npm run test:aris:animalwf`. The module-load guard below
 * throws if the private fixture is absent — a loud failure, never a skip and never an early return.
 */
const ANIMAL_WF_PATH = resolve(process.cwd(), '../reference/AnimalWF/ARISAMLExport.xml')
if (!existsSync(ANIMAL_WF_PATH)) {
  throw new Error(
    `AnimalWF fixture not found at ${ANIMAL_WF_PATH}. This suite only runs via ` +
      `\`npm run test:aris:animalwf\` with the private reference export present locally; it is ` +
      'never run as part of the default test suite and never skips.'
  )
}

/** The two iterate models and their function `AT_ID` numbering, cross-checked against the export. */
const RENEW_PROFILE = 'Model.-1rUudxIp-wP-u-L'
const REGISTER_OWNER = 'Model.3xqe8yXO9Z7-u-L'
const NUMBERING: Readonly<Record<string, readonly string[]>> = Object.freeze({
  [RENEW_PROFILE]: ['01', '02', '03', '04', '05', '06', '07', '08'],
  [REGISTER_OWNER]: [
    '01',
    '02',
    '03',
    '04',
    '05',
    '06',
    '07',
    '08',
    '09',
    '10',
    '11',
    '12',
    '13',
    '14'
  ]
})

let workingDocument: ArisWorkingDocument
let harness: Harness | null = null

beforeAll(() => {
  const xml = readFileSync(ANIMAL_WF_PATH, 'utf8')
  const index = buildSemanticArisDocument(tokenizeXmlDocument(xml)).index
  workingDocument = buildFromSource(index)
})

afterEach(() => {
  harness?.destroy()
  harness = null
})

function annotationTextsFor(modelId: string): string[] {
  harness = bootCanvas({ document: workingDocument, modelId })
  const registry = harness.canvas.elementRegistry
  const texts: string[] = []
  for (const element of registry.getAll()) {
    if (arisBusinessObject(element)?.kind !== 'occurrence') continue
    const gfx = registry.getGraphics(element.id)
    const group = gfx.querySelector('[data-aris-kind="occurrence"]')
    if (!group) continue
    for (const node of group.querySelectorAll('text[data-aris-attribute-label]')) {
      expect(node.getAttribute('data-aris-attribute-label')).toBe('AT_ID')
      texts.push(node.textContent ?? '')
    }
  }
  return texts
}

describe('AnimalWF Phase-B: function numbering painted beside the symbol', () => {
  for (const modelId of [RENEW_PROFILE, REGISTER_OWNER]) {
    it(`paints each function's AT_ID numbering for ${modelId}`, () => {
      const expected = NUMBERING[modelId]
      const texts = annotationTextsFor(modelId)
      // One AT_ID annotation per numbered function, and the set is the full run 01..N.
      expect(texts).toHaveLength(expected.length)
      expect([...new Set(texts)].sort()).toEqual([...expected])
    })

    it(`centres each numbering on the occurrence centre plus the source offset for ${modelId}`, () => {
      // Wave 6 GEOM: the AttrOcc offset is measured from the occurrence's centre and the label
      // box is centred on the offset point (raw canvas units — verified against the paired PDFs
      // with sub-unit residuals). This is what keeps "01" below its tall card instead of
      // overlapping the wrapped caption's third line.
      harness = bootCanvas({ document: workingDocument, modelId })
      const registry = harness.canvas.elementRegistry
      const model = workingDocument.models.get(modelId)
      if (!model) throw new Error(`Model ${modelId} missing from the working document.`)
      let numbered = 0
      for (const element of registry.getAll()) {
        if (arisBusinessObject(element)?.kind !== 'occurrence') continue
        const occurrence = model.occurrences.find((entry) => entry.id === element.id)
        if (!occurrence) continue
        const gfx = registry.getGraphics(element.id)
        const group = gfx.querySelector('[data-aris-kind="occurrence"]')
        if (!group) continue
        for (const node of group.querySelectorAll('text[data-aris-attribute-label]')) {
          const attributeType = node.getAttribute('data-aris-attribute-label')
          const placement = occurrence.attributeOccurrences.find(
            (entry) =>
              entry.attributeType === attributeType &&
              ((entry.offsetX ?? 0) !== 0 || (entry.offsetY ?? 0) !== 0)
          )
          if (!placement) throw new Error(`No offset placement for ${element.id} ${attributeType}.`)
          numbered += 1
          // Single-line text: the node's x/y is the laid-out line anchor, i.e. the box centre.
          expect(Number(node.getAttribute('x'))).toBeCloseTo(
            occurrence.bounds.width / 2 + (placement.offsetX ?? 0),
            6
          )
          expect(Number(node.getAttribute('y'))).toBeCloseTo(
            occurrence.bounds.height / 2 + (placement.offsetY ?? 0),
            6
          )
        }
      }
      expect(numbered).toBeGreaterThan(0)
    })
  }
})

/**
 * Wave 9 lane P1: per-`CxnDef.Type` truth table for whether the ORIGINAL reference PDF
 * (`reference/AnimalWF/pdf/Register_Animal_Owner_Profile_Draft03.pdf`) paints a target arrowhead
 * on that connection type — the literal, independent counterpart of `renderer.ts`'s
 * `DIRECTED_CONNECTION_TYPES`. This table is hand-verified against the reference PDF's rendered
 * ink and hardcoded here deliberately rather than imported from the renderer: if a future edit
 * silently changes `DIRECTED_CONNECTION_TYPES` (e.g. re-adds an arrow to `CT_SUPP_3`), this suite
 * must fail instead of trivially re-agreeing with whatever the renderer now does.
 *
 * Evidence (300 DPI crops of the original, cross-checked against each type's AML route data —
 * see Wave 9 lane P1's ledger for the full reasoning):
 * - `CT_ACTIV_1`/`CT_CRT_1`/`CT_LEADS_TO_1`/`CT_LEADS_TO_2`/`CT_IS_EVAL_BY_1`/`CT_IS_PREDEC_OF_1`:
 *   control flow, arrow at every hop (e.g. event -> function -> event chains throughout).
 * - `CT_CRT_OUT_TO`/`CT_HAS_OUT`: function -> output satellite/entity, arrow into the output
 *   (e.g. "Auto approve..." fn 05 -> SMS/E-mail/Owner Registration Number).
 * - `CT_READ_1`: function reading/writing an existing entity record, arrow at the record — both
 *   AnimalWF instances ("Economy License Details", "Owner Registration Number") show the arrow.
 * - `CT_MUST_BE_INFO_ABT_1`: the RACI "I" (informed), arrow into the function (fn 05/14, labeled
 *   "I" in the original).
 * - `CT_AFFECTS`: a business rule/policy driving a function — its one AnimalWF instance shares fn
 *   05's entry trunk with two `CT_SUPP_3` inputs already confirmed arrow-less elsewhere, and the
 *   original still paints one arrow into that function, so by elimination this type owns it.
 * - `CT_EXEC_1`/`CT_EXEC_2`: the RACI "R" (carries out), plain line, no arrowhead.
 * - `CT_SUPP_3`: an external application system feeding a function (DED System/TAMM/Smart
 *   Hub/UAE Pass), plain line — confirmed arrow-less at 4+ independent instances.
 * - `CT_IS_INP_FOR`: an entity type feeding a function, plain line.
 * - `CT_REFS_TO_2`: a requirement referencing a function, plain line — confirmed arrow-less at
 *   both its AnimalWF instances (fn 02 and fn 10), sharing an already-confirmed arrow-less
 *   `CT_SUPP_3` trunk with no extra ink.
 *
 * `CT_DECID_ON`/`CT_MUST_BE_CONSLT_ABT_1` (RACI "D"/"C", aligned with the "I" row) and the
 * org-chart types have zero occurrences in AnimalWF, so they are intentionally absent from this
 * data-driven table — there is no rendered connection to assert against — and stay documented
 * only at `DIRECTED_CONNECTION_TYPES`'s definition.
 */
const ARROW_TRUTH_TABLE: Readonly<Record<string, boolean>> = Object.freeze({
  CT_ACTIV_1: true,
  CT_AFFECTS: true,
  CT_CRT_1: true,
  CT_CRT_OUT_TO: true,
  CT_EXEC_1: false,
  CT_EXEC_2: false,
  CT_HAS_OUT: true,
  CT_IS_EVAL_BY_1: true,
  CT_IS_INP_FOR: false,
  CT_IS_PREDEC_OF_1: true,
  CT_LEADS_TO_1: true,
  CT_LEADS_TO_2: true,
  CT_MUST_BE_INFO_ABT_1: true,
  CT_READ_1: true,
  CT_REFS_TO_2: false,
  CT_SUPP_3: false
})

/**
 * Exact per-type connection counts for each iterate model — re-derived from the private AnimalWF
 * export the same way `NUMBERING` above is, and pinned so this suite catches BOTH a mis-tabulated
 * arrow decision and any drift in which types/how many of them the export actually contains.
 */
const CONNECTION_TYPE_COUNTS: Readonly<Record<string, Readonly<Record<string, number>>>> =
  Object.freeze({
    [RENEW_PROFILE]: Object.freeze({
      CT_ACTIV_1: 3,
      CT_CRT_1: 2,
      CT_CRT_OUT_TO: 1,
      CT_EXEC_1: 7,
      CT_HAS_OUT: 3,
      CT_IS_EVAL_BY_1: 2,
      CT_IS_INP_FOR: 3,
      CT_IS_PREDEC_OF_1: 5,
      CT_LEADS_TO_1: 1,
      CT_LEADS_TO_2: 2,
      CT_MUST_BE_INFO_ABT_1: 1,
      CT_REFS_TO_2: 1,
      CT_SUPP_3: 12
    }),
    [REGISTER_OWNER]: Object.freeze({
      CT_ACTIV_1: 14,
      CT_AFFECTS: 1,
      CT_CRT_1: 8,
      CT_CRT_OUT_TO: 8,
      CT_EXEC_1: 4,
      CT_EXEC_2: 1,
      CT_HAS_OUT: 1,
      CT_IS_EVAL_BY_1: 6,
      CT_LEADS_TO_1: 6,
      CT_LEADS_TO_2: 13,
      CT_MUST_BE_INFO_ABT_1: 5,
      CT_READ_1: 2,
      CT_REFS_TO_2: 2,
      CT_SUPP_3: 22
    })
  })

describe('AnimalWF Phase-B: arrowhead truth table matches the reference PDF per connection type', () => {
  for (const modelId of [RENEW_PROFILE, REGISTER_OWNER]) {
    it(`draws marker-end exactly where the reference PDF does, per connection type, for ${modelId}`, () => {
      harness = bootCanvas({ document: workingDocument, modelId })
      const registry = harness.canvas.elementRegistry
      const countsByType = new Map<string, number>()
      let connections = 0
      for (const element of registry.getAll()) {
        const businessObject = arisBusinessObject(element)
        if (businessObject?.kind !== 'connection') continue
        connections += 1
        const { connectionType } = businessObject as ArisConnectionBusinessObject
        const expectsArrow = ARROW_TRUTH_TABLE[connectionType]
        if (expectsArrow === undefined) {
          throw new Error(
            `Connection ${element.id} has untabulated type ${connectionType}. Verify it against ` +
              'the reference PDF and add it to ARROW_TRUTH_TABLE — never default it either way.'
          )
        }
        countsByType.set(connectionType, (countsByType.get(connectionType) ?? 0) + 1)
        const gfx = registry.getGraphics(element.id)
        const marked = gfx.querySelector('[marker-end]')
        if (expectsArrow) {
          expect(
            marked,
            `${connectionType} connection ${element.id} expected an arrowhead`
          ).not.toBeNull()
          expect(marked?.getAttribute('marker-end')).toMatch(/^url\(#aris-arrow-/)
        } else {
          expect(
            marked,
            `${connectionType} connection ${element.id} expected NO arrowhead`
          ).toBeNull()
        }
      }
      expect(connections).toBe(
        Object.values(CONNECTION_TYPE_COUNTS[modelId]!).reduce((sum, count) => sum + count, 0)
      )
      expect(Object.fromEntries(countsByType)).toEqual(CONNECTION_TYPE_COUNTS[modelId])
      // The prune actually took effect: at least one arrow-less type occurred in this model.
      const arrowlessTypesSeen = [...countsByType.keys()].filter(
        (type) => ARROW_TRUTH_TABLE[type] === false
      )
      expect(arrowlessTypesSeen.length).toBeGreaterThan(0)
      // The arrowheads reference a single shared marker authored in the diagram's <defs>.
      const svg = harness.container.querySelector('svg')
      expect(svg?.querySelectorAll('marker').length ?? 0).toBeGreaterThanOrEqual(1)
    })
  }
})

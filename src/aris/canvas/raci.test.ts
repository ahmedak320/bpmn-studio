import { describe, expect, it } from 'vitest'

import {
  ARIS_RACI_ATTRIBUTE_TYPE,
  derivedRaciLabelText,
  resolveRaciLetter,
  type ArisRaciTuple
} from './raci'
import {
  CONNECTION_LABEL_NW_INSET_X,
  CONNECTION_LABEL_NW_INSET_Y,
  connectionLabelRect
} from './canvasSync'
import { measureTextWidth } from '../renderer/textWrap'

/**
 * The tuple-safe RACI resolver (plan Wave 6, V5+): the letter is a function of
 * the connection type AND the endpoint tuple — eligible executor → Function —
 * never of the connection type alone.
 */

function tuple(
  connectionType: string,
  sourceObjectType: string,
  targetObjectType: string
): ArisRaciTuple {
  return Object.freeze({ connectionType, sourceObjectType, targetObjectType })
}

describe('resolveRaciLetter — tuple-scoped connection-type mapping', () => {
  it('maps each RACI connection type to its letter for an executor→Function tuple', () => {
    expect(resolveRaciLetter(tuple('CT_EXEC_1', 'OT_PERS', 'OT_FUNC'))).toBe('R')
    expect(resolveRaciLetter(tuple('CT_EXEC_2', 'OT_PERS_TYPE', 'OT_FUNC'))).toBe('R')
    expect(resolveRaciLetter(tuple('CT_DECID_ON', 'OT_ORG_UNIT', 'OT_FUNC'))).toBe('A')
    expect(resolveRaciLetter(tuple('CT_MUST_BE_CONSLT_ABT_1', 'OT_POS', 'OT_FUNC'))).toBe('C')
    expect(resolveRaciLetter(tuple('CT_MUST_BE_INFO_ABT_1', 'OT_GRP', 'OT_FUNC'))).toBe('I')
  })

  it('accepts every eligible executor type', () => {
    for (const executor of ['OT_ORG_UNIT', 'OT_POS', 'OT_GRP', 'OT_PERS_TYPE', 'OT_PERS']) {
      expect(resolveRaciLetter(tuple('CT_EXEC_1', executor, 'OT_FUNC'))).toBe('R')
    }
  })

  it('stays silent for a non-RACI connection type', () => {
    expect(resolveRaciLetter(tuple('CT_SUPP_3', 'OT_APPL_SYS', 'OT_FUNC'))).toBeNull()
    expect(resolveRaciLetter(tuple('CT_ACTIV_1', 'OT_EVT', 'OT_FUNC'))).toBeNull()
    expect(resolveRaciLetter(tuple('CT_REFS_TO_2', 'OT_REQUIREMENT', 'OT_FUNC'))).toBeNull()
  })

  it('stays silent when the source is not an eligible executor', () => {
    // A policy "must be informed about" a function is a regulation
    // relationship, not an Informed badge.
    expect(resolveRaciLetter(tuple('CT_MUST_BE_INFO_ABT_1', 'OT_POLICY', 'OT_FUNC'))).toBeNull()
    expect(resolveRaciLetter(tuple('CT_EXEC_1', 'OT_APPL_SYS', 'OT_FUNC'))).toBeNull()
  })

  it('stays silent when the target is not a Function', () => {
    expect(resolveRaciLetter(tuple('CT_EXEC_1', 'OT_PERS', 'OT_EVT'))).toBeNull()
    expect(resolveRaciLetter(tuple('CT_MUST_BE_INFO_ABT_1', 'OT_PERS', 'OT_POS'))).toBeNull()
  })

  it('stays silent for the reversed Function→executor tuple', () => {
    expect(resolveRaciLetter(tuple('CT_EXEC_1', 'OT_FUNC', 'OT_PERS'))).toBeNull()
  })
})

describe('derivedRaciLabelText — placement gating', () => {
  const raciTuple = tuple('CT_EXEC_1', 'OT_PERS', 'OT_FUNC')

  it('derives the letter for an empty TEXT relationship-badge placement', () => {
    expect(
      derivedRaciLabelText(
        { attributeType: ARIS_RACI_ATTRIBUTE_TYPE, symbolFlag: 'TEXT', text: '' },
        raciTuple
      )
    ).toBe('R')
  })

  it('never overrides or duplicates a source-authored value', () => {
    expect(
      derivedRaciLabelText(
        { attributeType: ARIS_RACI_ATTRIBUTE_TYPE, symbolFlag: 'TEXT', text: 'carries out' },
        raciTuple
      )
    ).toBeNull()
  })

  it('ignores non-RACI attribute placements even when empty', () => {
    expect(
      derivedRaciLabelText({ attributeType: 'AT_NAME', symbolFlag: 'TEXT', text: '' }, raciTuple)
    ).toBeNull()
    expect(
      derivedRaciLabelText(
        { attributeType: 'AT_SAP_XI_SYNCHRONOUS_CALL', symbolFlag: 'TEXT', text: '' },
        raciTuple
      )
    ).toBeNull()
  })

  it('ignores SYMBOL placements — they draw a glyph, never text', () => {
    expect(
      derivedRaciLabelText(
        { attributeType: ARIS_RACI_ATTRIBUTE_TYPE, symbolFlag: 'SYMBOL', text: '' },
        raciTuple
      )
    ).toBeNull()
  })

  it('ignores ineligible tuples', () => {
    expect(
      derivedRaciLabelText(
        { attributeType: ARIS_RACI_ATTRIBUTE_TYPE, symbolFlag: 'TEXT', text: '' },
        tuple('CT_SUPP_3', 'OT_APPL_SYS', 'OT_FUNC')
      )
    ).toBeNull()
    expect(
      derivedRaciLabelText(
        { attributeType: ARIS_RACI_ATTRIBUTE_TYPE, symbolFlag: 'TEXT', text: '' },
        null
      )
    ).toBeNull()
  })
})

/**
 * The measured ground truth the `Port="NW"` placement rule is calibrated to
 * (fixplan §0). The register model's R badge on `CT_EXEC_1` (role → function)
 * paints its glyph with the bottom-right ~11 units left of the role-box edge and
 * ~14 units above the connection line, so the letter floats *above* the line,
 * tucked just left of the role box — never struck through by it.
 *
 * The register role box's left edge is x=1535 and the connection line runs at
 * y=870 (model units); the route leaves that box at (1535, 870). The letter is
 * drawn at its real style-sheet size, Arial 35.278u (the FontSS `−10` sheet).
 * Converting §0's PDF-point bbox `[192.6,111.8,195.6,116.4]` through the print
 * mapping `unit = (pt − 14.17) / 0.11906` gives a glyph centre at ≈(1511.3, 838.4)
 * — which this rule reproduces to sub-unit.
 */
describe('Port="NW" RACI placement reproduces the measured R badge (fixplan §0)', () => {
  const ROLE_BOX_LEFT = 1535
  const LINE_Y = 870
  const FONT_SIZE = 35.278 // FontSS.-jO1xmt9c (Arial −10), the real drawn size
  const anchor = { point: { x: ROLE_BOX_LEFT, y: LINE_Y }, fontSize: FONT_SIZE }
  const nwPlacement = Object.freeze({
    offsetX: 0,
    offsetY: 0,
    width: null,
    height: null,
    port: 'NW'
  })

  it('pins the R glyph box north-west of the source-box contact point', () => {
    const rect = connectionLabelRect(
      nwPlacement,
      { x: 9999, y: 9999 }, // midpoint is deliberately absurd: NW must ignore it
      { symbolFlag: 'TEXT', text: 'R' },
      anchor
    )
    const glyphWidth = measureTextWidth('R', FONT_SIZE)
    expect(rect.width).toBeCloseTo(glyphWidth, 6)
    expect(rect.height).toBeCloseTo(FONT_SIZE, 6)
    // Bottom-right corner: inset up-and-left of the (1535, 870) contact.
    expect(rect.x + rect.width).toBeCloseTo(ROLE_BOX_LEFT - CONNECTION_LABEL_NW_INSET_X, 6)
    expect(rect.y + rect.height).toBeCloseTo(LINE_Y - CONNECTION_LABEL_NW_INSET_Y, 6)
    // Measured centre (§0): ≈(1511.3, 838.4).
    expect(rect.x + rect.width / 2).toBeCloseTo(1511.26, 1)
    expect(rect.y + rect.height / 2).toBeCloseTo(838.36, 1)
  })

  it('keeps the whole letter above the line and left of the role box (no strike-through)', () => {
    const rect = connectionLabelRect(
      nwPlacement,
      { x: 0, y: 0 },
      { symbolFlag: 'TEXT', text: 'R' },
      anchor
    )
    // Entirely above the line …
    expect(rect.y + rect.height).toBeLessThan(LINE_Y)
    // … and entirely left of the role box.
    expect(rect.x + rect.width).toBeLessThan(ROLE_BOX_LEFT)
    // A narrower letter (I) hugs the same right edge, so it sits closer to the box.
    const iRect = connectionLabelRect(
      nwPlacement,
      { x: 0, y: 0 },
      { symbolFlag: 'TEXT', text: 'I' },
      anchor
    )
    expect(iRect.x + iRect.width).toBeCloseTo(rect.x + rect.width, 6)
    expect(iRect.width).toBeLessThan(rect.width)
  })

  it('ignores the NW branch without an anchor, and for CENTER/portless placements', () => {
    // No anchor → the midpoint-centred path, byte-identical to every other label.
    const centred = connectionLabelRect(
      nwPlacement,
      { x: 100, y: 200 },
      {
        symbolFlag: 'TEXT',
        text: 'R'
      }
    )
    expect(centred.x + centred.width / 2).toBeCloseTo(100, 6)
    expect(centred.y + centred.height / 2).toBeCloseTo(200, 6)
    // A non-NW port never takes the branch even when an anchor is supplied.
    const portFree = connectionLabelRect(
      { ...nwPlacement, port: 'PORT_FREE' },
      { x: 100, y: 200 },
      { symbolFlag: 'TEXT', text: 'R' },
      anchor
    )
    expect(portFree.x + portFree.width / 2).toBeCloseTo(100, 6)
    expect(portFree.y + portFree.height / 2).toBeCloseTo(200, 6)
  })
})

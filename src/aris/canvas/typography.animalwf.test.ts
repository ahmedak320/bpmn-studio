// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { buildFromSource, resolveFreeTextModelAttributeBinding } from '../model/buildFromSource'
import type { ArisModel, ArisWorkingDocument } from '../model/types'
import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import { arisBusinessObject } from './elements'
import { ARIS_PRINT_FRAME_LAYER } from './renderer'
import { measureTextWidth } from '../renderer/textWrap'
import { bootCanvas, type Harness } from './testing/harness'

/**
 * Real-data acceptance for Wave 6 lane V8 (typography, text layout, bidi):
 * the register-owner and renew-profile models rendered off the private
 * AnimalWF export must paint every label at its `FontStyleSheet`-resolved
 * family/size/weight/colour (no blanket 12-unit fallback), wrap long captions
 * inside their content box, render no empty bordered box over a bound
 * free-text note, and mark Arabic text RTL with per-paragraph bidi
 * resolution.
 *
 * The export is private customer data: only font metrics, counts and
 * direction attributes reach the assertions — never label text. See
 * `printFrame.animalwf.test.ts` for the suite's guard contract.
 */
const ANIMAL_WF_PATH = resolve(process.cwd(), '../reference/AnimalWF/ARISAMLExport.xml')
if (!existsSync(ANIMAL_WF_PATH)) {
  throw new Error(
    `AnimalWF fixture not found at ${ANIMAL_WF_PATH}. This suite only runs via ` +
      '`npm run test:aris:animalwf` with the private reference export present locally; it is ' +
      'never run as part of the default test suite and never skips.'
  )
}

const RENEW_PROFILE = 'Model.-1rUudxIp-wP-u-L'
const REGISTER_OWNER = 'Model.3xqe8yXO9Z7-u-L'

/** The standard sheet every name placement in the export references. */
const STANDARD_SHEET = 'FontSS.-jO1xmt9c--c-L'
/** English Arial Height="-10" → 10pt → canvas units. */
const EN_FONT_SIZE = '35.278'

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

function model(modelId: string): ArisModel {
  return workingDocument.models.get(modelId) as ArisModel
}

function occurrenceGroups(): Element[] {
  const registry = harness!.canvas.elementRegistry
  const groups: Element[] = []
  for (const element of registry.getAll()) {
    if (arisBusinessObject(element)?.kind !== 'occurrence') continue
    const group = registry.getGraphics(element.id).querySelector('[data-aris-kind="occurrence"]')
    if (group) groups.push(group)
  }
  return groups
}

function freeTextGroups(): { readonly id: string; readonly group: Element }[] {
  const registry = harness!.canvas.elementRegistry
  const result: { readonly id: string; readonly group: Element }[] = []
  for (const element of registry.getAll()) {
    const businessObject = arisBusinessObject(element)
    if (businessObject?.kind !== 'freeText') continue
    const group = registry.getGraphics(element.id).querySelector('[data-aris-kind="freeText"]')
    if (group) result.push({ id: businessObject.freeTextId, group })
  }
  return result
}

describe('AnimalWF V8: FontStyleSheet resolution', () => {
  it('resolves the standard sheet per locale: Arial, point size, weight, colour', () => {
    const sheet = workingDocument.styleCatalog.styles.get(STANDARD_SHEET)
    expect(sheet).toMatchObject({
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: 35.278,
      fontWeight: '400',
      textColor: '#000000'
    })
    const arabic = sheet?.fontNodes?.find((node) => node.localeId === '&LocaleId.AEar;')
    const english = sheet?.fontNodes?.find((node) => node.localeId === '&LocaleId.USen;')
    expect(arabic?.fontSize).toBe(45.861)
    expect(english?.fontSize).toBe(35.278)
  })
})

describe('AnimalWF V8: canvas typography', () => {
  for (const modelId of [REGISTER_OWNER, RENEW_PROFILE]) {
    it(`paints every occurrence caption at the resolved font for ${modelId}`, () => {
      harness = bootCanvas({ document: workingDocument, modelId })
      let captions = 0
      for (const group of occurrenceGroups()) {
        for (const caption of group.querySelectorAll('text[data-aris-caption]')) {
          if ((caption.textContent ?? '') === '') continue
          captions += 1
          // No blanket 12-unit fallback survives.
          expect(caption.getAttribute('font-size')).not.toBe('12')
          expect(caption.getAttribute('font-family')).toBe('Arial, Helvetica, sans-serif')
          expect(Number(caption.getAttribute('font-size'))).toBeGreaterThan(20)
        }
      }
      expect(captions).toBeGreaterThan(10)
    })

    it(`wraps long captions inside their content box for ${modelId}`, () => {
      harness = bootCanvas({ document: workingDocument, modelId })
      let multiline = 0
      for (const group of occurrenceGroups()) {
        const caption = group.querySelector('text[data-aris-caption]')
        const tspans = [...(caption?.querySelectorAll('tspan') ?? [])]
        if (tspans.length < 2) continue
        multiline += 1
        const fontSize = Number(caption!.getAttribute('font-size'))
        const boxWidth = Math.max(
          ...tspans.map((node) => measureTextWidth(node.textContent ?? '', fontSize))
        )
        // The widest wrapped line still fits the 670-unit card it lives on.
        expect(boxWidth).toBeLessThanOrEqual(670)
        // Vertically centred: the line block is symmetric about the box centre.
        const ys = tspans.map((node) => Number(node.getAttribute('y')))
        expect(ys[1]! - ys[0]!).toBeCloseTo(fontSize * 1.15, 1)
      }
      // The register/renew sheets wrap function and event names over 2–3 lines.
      expect(multiline).toBeGreaterThanOrEqual(3)
    })

    it(`paints the function numbering in the resolved bold placement font for ${modelId}`, () => {
      harness = bootCanvas({ document: workingDocument, modelId })
      let numbered = 0
      for (const group of occurrenceGroups()) {
        for (const label of group.querySelectorAll('text[data-aris-attribute-label]')) {
          numbered += 1
          expect(label.getAttribute('font-size')).toBe(EN_FONT_SIZE)
          expect(label.getAttribute('font-weight')).toBe('700')
        }
      }
      expect(numbered).toBeGreaterThan(0)
    })

    it(`draws no empty bordered box over bound free text for ${modelId}`, () => {
      harness = bootCanvas({ document: workingDocument, modelId })
      const notes = model(modelId).freeText
      const groups = freeTextGroups()
      expect(groups.length).toBe(notes.length)
      let bound = 0
      let staticText = 0
      for (const { id, group } of groups) {
        const note = notes.find((entry) => entry.id === id)!
        const isBound = resolveFreeTextModelAttributeBinding(note) !== null
        if (isBound) {
          bound += 1
          // The print-frame overlay paints the resolved value at the anchor.
          expect(group.querySelector('text')).toBeNull()
        } else if ((note.text.fallback ?? '') !== '') {
          staticText += 1
          const text = group.querySelector('text[data-aris-caption]')
          expect(text).not.toBeNull()
          expect(text!.getAttribute('font-weight')).toBe('700')
        }
        // No invented note border anywhere — the source carries no pen.
        expect(group.querySelector('rect')).toBeNull()
      }
      expect(bound).toBeGreaterThan(0)
      expect(staticText).toBeGreaterThan(0)
    })

    it(`renders Arabic header labels RTL at the source-resolved size for ${modelId}`, () => {
      harness = bootCanvas({ document: workingDocument, modelId })
      let arabic = 0
      for (const { group } of freeTextGroups()) {
        const text = group.querySelector('text[direction="rtl"]')
        if (!text) continue
        arabic += 1
        expect(text.getAttribute('unicode-bidi')).toBe('plaintext')
        // The export keys these labels USen with an explicit SizeElement="10"
        // run override: 10pt bold Arial, exactly as the reference PDF paints
        // the Arabic header column — never the 12-unit fallback.
        expect(text.getAttribute('font-size')).toBe(EN_FONT_SIZE)
        expect(text.getAttribute('font-weight')).toBe('700')
      }
      // The header's Arabic label column (Process Code / Name / Owner).
      expect(arabic).toBeGreaterThanOrEqual(3)
    })

    it(`paints RACI letters at the resolved placement size for ${modelId}`, () => {
      harness = bootCanvas({ document: workingDocument, modelId })
      const registry = harness.canvas.elementRegistry
      let letters = 0
      for (const element of registry.getAll()) {
        if (arisBusinessObject(element)?.kind !== 'connectionLabel') continue
        const group = registry
          .getGraphics(element.id)
          .querySelector('[data-aris-kind="connectionLabel"]')
        if (!group?.getAttribute('data-aris-raci')) continue
        letters += 1
        const letter = [...group.querySelectorAll('text')].find(
          (node) => node.textContent === group.getAttribute('data-aris-raci')
        )
        expect(letter?.getAttribute('font-size')).toBe(EN_FONT_SIZE)
      }
      expect(letters).toBeGreaterThan(0)
    })

    it(`paints the anchored header values at the bound note's own size for ${modelId}`, () => {
      harness = bootCanvas({ document: workingDocument, modelId })
      const layer = harness.canvas.canvas.getLayer(ARIS_PRINT_FRAME_LAYER) as SVGGElement
      const values = [...layer.querySelectorAll('[data-aris-print-frame-text="anchored-value"]')]
      expect(values.length).toBe(3)
      for (const value of values) {
        // 35.278 rounds to 35 — the bound note's sheet size, not a band ratio.
        expect(value.getAttribute('font-size')).toBe('35')
      }
    })
  }
})

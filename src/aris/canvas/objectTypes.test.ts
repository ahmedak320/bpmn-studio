// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import { findOccurrence } from './commandFactory'
import { arisBusinessObject } from './elements'
import { bootCanvas, shape, type Harness } from './testing/harness'
import {
  ARIS_CANVAS_OBJECT_TYPES,
  ARIS_RULE_SYMBOLS,
  resolveConnectionType,
  ruleOperatorOfSymbol,
  type ArisRuleOperator
} from './vocabulary'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

describe('supported object types (Section 11.3)', () => {
  it.each(ARIS_CANVAS_OBJECT_TYPES)(
    '%s can be created, selected, moved, edited and connected',
    (objectType) => {
      harness = bootCanvas()
      const { canvas } = harness

      // create
      const created = canvas.authoring.createObject({
        objectType,
        name: `${objectType} caption`,
        position: { x: 100, y: 100 }
      })
      const element = shape(canvas, created.occurrenceId)
      expect(arisBusinessObject(element)).toMatchObject({ kind: 'occurrence', objectType })

      // select
      canvas.select(created.occurrenceId)
      expect(canvas.selection.get().map((entry) => entry.id)).toEqual([created.occurrenceId])

      // move
      canvas.authoring.moveOccurrence(created.occurrenceId, { x: 260, y: 180 })
      expect(findOccurrence(canvas.document, created.occurrenceId)?.bounds).toMatchObject({
        x: 260,
        y: 180
      })
      expect(shape(canvas, created.occurrenceId).x).toBe(260)

      // edit (rename + attribute + resize + restyle)
      canvas.authoring.renameDefinition(created.definitionId, 'Renamed')
      expect(
        canvas.document.objectDefinitions.get(created.definitionId)?.names.values['en-US']
      ).toBe('Renamed')
      canvas.authoring.setDefinitionAttribute(created.definitionId, 'AT_DESC', [
        { localeId: 'en-US', text: 'description' }
      ])
      expect(
        canvas.document.objectDefinitions
          .get(created.definitionId)
          ?.attributes.find((attribute) => attribute.type === 'AT_DESC')?.values[0].text
      ).toBe('description')
      canvas.authoring.resizeOccurrence(created.occurrenceId, { width: 140, height: 90 })
      expect(shape(canvas, created.occurrenceId).width).toBe(140)
      canvas.authoring.restyleOccurrence(created.occurrenceId, { fillColor: '#ff0000' })
      expect(findOccurrence(canvas.document, created.occurrenceId)?.style.fillColor).toBe('#ff0000')

      // connect (to a function, which every type has a defined relation with)
      const partner = canvas.authoring.createObject({
        objectType: 'OT_FUNC',
        position: { x: 600, y: 180 }
      })
      const connectionId = canvas.authoring.connect(created.occurrenceId, partner.occurrenceId)
      const connection = canvas.elementRegistry.get(connectionId)
      expect(connection).toBeTruthy()
      expect(arisBusinessObject(connection)).toMatchObject({
        kind: 'connection',
        sourceOccurrenceId: created.occurrenceId,
        targetOccurrenceId: partner.occurrenceId
      })

      // delete the occurrence again
      canvas.authoring.deleteOccurrence(created.occurrenceId)
      expect(findOccurrence(canvas.document, created.occurrenceId)).toBeUndefined()
      expect(canvas.elementRegistry.get(created.occurrenceId)).toBeUndefined()
      // The connection went with it.
      expect(canvas.elementRegistry.get(connectionId)).toBeUndefined()
      // The definition survived — deleting it needs a separate confirmation.
      expect(canvas.document.objectDefinitions.has(created.definitionId)).toBe(true)
    }
  )

  it.each(Object.keys(ARIS_RULE_SYMBOLS) as ArisRuleOperator[])(
    'creates a native %s rule symbol',
    (operator) => {
      harness = bootCanvas()
      const { canvas } = harness
      const created = canvas.authoring.createRule(operator, { x: 0, y: 0 })
      const occurrence = findOccurrence(canvas.document, created.occurrenceId)
      expect(occurrence?.symbol).toBe(ARIS_RULE_SYMBOLS[operator])
      expect(ruleOperatorOfSymbol(occurrence?.symbol ?? null)).toBe(operator)
      // The renderer resolved a real registry symbol, not the unknown fallback.
      const gfx = canvas.elementRegistry.getGraphics(created.occurrenceId)
      const group = gfx.querySelector('[data-aris-symbol]')
      expect(group?.getAttribute('data-aris-symbol')).toBe(
        `MT_EEPC:OT_RULE:${ARIS_RULE_SYMBOLS[operator]}`
      )
      expect(group?.getAttribute('data-aris-fidelity')).toBeNull()
    }
  )

  it('offers a palette entry for every object type and rule operator', () => {
    harness = bootCanvas()
    const entries = harness.canvas.palette.getPaletteEntries()
    const offered = new Set(
      Object.values(entries)
        .map((entry) => entry.arisObjectType)
        .filter((value): value is string => value !== undefined)
    )
    for (const objectType of ARIS_CANVAS_OBJECT_TYPES) {
      expect(offered.has(objectType), `palette is missing ${objectType}`).toBe(true)
    }
    const ruleSymbols = Object.values(entries)
      .filter((entry) => entry.arisObjectType === 'OT_RULE')
      .map((entry) => entry.arisSymbolNum)
    expect(new Set(ruleSymbols)).toEqual(new Set(Object.values(ARIS_RULE_SYMBOLS)))
  })

  it('keeps every palette entry id/className stable and labels each entry', () => {
    harness = bootCanvas()
    const entries = harness.canvas.palette.getPaletteEntries()

    // The three non-catalog tool entries never change shape.
    const fixedTools: Record<string, string> = {
      'hand-tool': 'aris-palette-hand-tool',
      'lasso-tool': 'aris-palette-lasso-tool',
      'create.free-text': 'aris-palette-free-text'
    }
    for (const [id, className] of Object.entries(fixedTools)) {
      expect(entries[id]?.className, `className for ${id}`).toBe(className)
      expect(entries[id]?.html, `html for ${id}`).toContain('aris-palette-entry__label')
      expect(entries[id]?.title, `title for ${id}`).toBeTruthy()
    }

    // Every object type keeps a stable `create.<ot>` default entry with a
    // `data-action`-safe, derivable className — `data-action` selectors and
    // CSS hooks are derived from these, so any drift here breaks e2e + styling.
    for (const objectType of ARIS_CANVAS_OBJECT_TYPES) {
      const id = `create.${objectType.toLowerCase()}`
      const expectedClassName = `aris-palette-${objectType.toLowerCase()}`
      expect(entries[id], `default create entry for ${objectType}`).toBeDefined()
      expect(entries[id]?.className, `className for ${id}`).toBe(expectedClassName)
      expect(entries[id]?.html, `html for ${id}`).toContain('aris-palette-entry__label')
      expect(entries[id]?.title, `title for ${id}`).toBeTruthy()
    }

    // The palette is now one entry per `getPaletteSymbols(modelType)` row
    // (plan R1, palette-catalog lane) rather than one per object type, so the
    // exact id set grows with the catalog. What must stay true regardless of
    // catalog size: every entry is a `create.*` action (or one of the three
    // fixed tools above), with a stable, correctly-derived className and a
    // labeled, single-root affordance.
    for (const [id, entry] of Object.entries(entries)) {
      if (id in fixedTools) continue
      expect(id.startsWith('create.'), `entry id ${id} should be a create.* action`).toBe(true)
      if (entry.arisObjectType) {
        expect(entry.className, `className for ${id}`).toBe(
          `aris-palette-${entry.arisObjectType.toLowerCase()}`
        )
      }
      expect(entry.html, `html for ${id}`).toContain('aris-palette-entry__label')
      expect(entry.title, `title for ${id}`).toBeTruthy()
    }
  })

  it('types EPC control-flow connections from the AnimalWF triples', () => {
    expect(resolveConnectionType('MT_EEPC', 'OT_EVT', 'OT_FUNC')).toEqual({
      connectionType: 'CT_ACTIV_1',
      fallback: false
    })
    expect(resolveConnectionType('MT_EEPC', 'OT_FUNC', 'OT_EVT')).toEqual({
      connectionType: 'CT_CRT_1',
      fallback: false
    })
    expect(resolveConnectionType('MT_EEPC', 'OT_FUNC', 'OT_RULE')).toEqual({
      connectionType: 'CT_LEADS_TO_1',
      fallback: false
    })
    expect(resolveConnectionType('MT_EEPC', 'OT_RULE', 'OT_EVT')).toEqual({
      connectionType: 'CT_LEADS_TO_2',
      fallback: false
    })
    expect(resolveConnectionType('MT_VAL_ADD_CHN_DGM', 'OT_FUNC', 'OT_FUNC')).toEqual({
      connectionType: 'CT_IS_PREDEC_OF_1',
      fallback: false
    })
    // Unknown pairs fall back explicitly rather than silently.
    expect(resolveConnectionType('MT_EEPC', 'OT_PERF', 'OT_POLICY')).toEqual({
      connectionType: 'CT_REFS_TO_2',
      fallback: true
    })
  })

  it('resolves the new plan R2 executor triples to their RACI connection types', () => {
    // resolveConnectionType now delegates to conventions/connectionRules,
    // which adds R form (CT_EXEC_1) coverage for the org/people executor
    // types beyond OT_PERS/OT_PERS_TYPE (which already had CT_EXEC_1/2).
    expect(resolveConnectionType('MT_EEPC', 'OT_ORG_UNIT', 'OT_FUNC')).toEqual({
      connectionType: 'CT_EXEC_1',
      fallback: false
    })
    expect(resolveConnectionType('MT_EEPC', 'OT_POS', 'OT_FUNC')).toEqual({
      connectionType: 'CT_EXEC_1',
      fallback: false
    })
    expect(resolveConnectionType('MT_EEPC', 'OT_GRP', 'OT_FUNC')).toEqual({
      connectionType: 'CT_EXEC_1',
      fallback: false
    })
    // The executor rules are model-type-independent, same as the pre-existing
    // OT_PERS/OT_PERS_TYPE rows.
    expect(resolveConnectionType('MT_VAL_ADD_CHN_DGM', 'OT_POS', 'OT_FUNC')).toEqual({
      connectionType: 'CT_EXEC_1',
      fallback: false
    })
  })

  it('authors in a value-added chain diagram too (Section 11.2)', () => {
    harness = bootCanvas({ modelType: 'MT_VAL_ADD_CHN_DGM', modelName: 'VACD' })
    const { canvas } = harness
    const a = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      name: 'Step 1',
      position: { x: 0, y: 0 }
    })
    const b = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      name: 'Step 2',
      position: { x: 300, y: 0 }
    })
    const connectionId = canvas.authoring.connect(a.occurrenceId, b.occurrenceId)
    const definitionId = canvas.document.models.get(canvas.activeModelId)?.connectionOccurrences[0]
      .definitionId
    expect(canvas.document.connectionDefinitions.get(definitionId ?? '')?.type).toBe(
      'CT_IS_PREDEC_OF_1'
    )
    expect(canvas.elementRegistry.get(connectionId)).toBeTruthy()
  })
})

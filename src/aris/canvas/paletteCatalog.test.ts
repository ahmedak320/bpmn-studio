// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import { ARIS_CONVENTION_SYMBOLS } from '../conventions/catalog'
import { dmtLibraryItems } from './dmtLibrary'
import { bootCanvas, twoModelDocument, type Harness } from './testing/harness'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

describe('authoritative DMT drawing library (Wave 6, V10)', () => {
  it('offers exactly one target per catalog presentation for the active model type', () => {
    harness = bootCanvas()
    const targets = harness.canvas.palette.targets()
    const symbols = dmtLibraryItems('MT_EEPC')

    expect(targets).toHaveLength(symbols.length)
    expect(targets.map((target) => target.catalogId).sort()).toEqual(
      symbols.map((symbol) => symbol.catalogId).sort()
    )
    // Ids are unique even when catalog rows share an object type + SymbolNum.
    expect(new Set(targets.map((target) => target.id)).size).toBe(targets.length)
  })

  it('keeps the default symbol on the stable create.<ot> id and carries the SymbolNum', () => {
    harness = bootCanvas()
    const targets = harness.canvas.palette.targets()

    const funcDefault = targets.find(
      (target) => target.objectType === 'OT_FUNC' && target.symbolNum === 'ST_FUNC'
    )
    expect(funcDefault?.id).toBe('create.ot_func')

    const ruleDefault = targets.find(
      (target) => target.objectType === 'OT_RULE' && target.symbolNum === 'ST_OPR_AND_1'
    )
    expect(ruleDefault?.id).toBe('create.ot_rule')

    // A non-default symbol is a variant keyed create.<ot>.<st>.
    const systemFunction = targets.find(
      (target) => target.objectType === 'OT_FUNC' && target.symbolNum === 'ST_SYS_FUNC_ACT'
    )
    expect(systemFunction?.id).toBe('create.ot_func.st_sys_func_act')
  })

  it('exposes the catalog object type / SymbolNum and group on every create entry', () => {
    harness = bootCanvas()
    const entries = harness.canvas.palette.getPaletteEntries()

    const systemFunction = Object.values(entries).find(
      (entry) => entry.arisObjectType === 'OT_FUNC' && entry.arisSymbolNum === 'ST_SYS_FUNC_ACT'
    )
    expect(systemFunction).toBeTruthy()
    expect(systemFunction?.group).toBe('flow-decisions')
    expect(systemFunction?.html).toContain('aris-palette-entry__label')
    expect(systemFunction?.html).toContain('data-aris-descriptor-fingerprint')
    expect(systemFunction?.title).toBeTruthy()

    // Organizational groups land under their catalog palette group.
    const role = Object.values(entries).find((entry) => entry.arisObjectType === 'OT_PERS_TYPE')
    expect(role?.group).toBe('roles-organization')
  })

  it('offers the value-added-chain symbols in a VACD model', () => {
    harness = bootCanvas({ modelType: 'MT_VAL_ADD_CHN_DGM', modelName: 'VACD' })
    const targets = harness.canvas.palette.targets()
    const symbols = dmtLibraryItems('MT_VAL_ADD_CHN_DGM')

    expect(targets).toHaveLength(symbols.length)
    expect(
      targets.some(
        (target) => target.objectType === 'OT_FUNC' && target.symbolNum === 'ST_VAL_ADD_CHN_SML_1'
      )
    ).toBe(true)
  })

  it('overrides catalog placement flags in the provider without changing the catalog', () => {
    harness = bootCanvas()
    const catalogDisabled = ARIS_CONVENTION_SYMBOLS.filter(
      (symbol) => symbol.modelTypes.includes('MT_EEPC') && !symbol.placementEnabled
    )
    expect(catalogDisabled.length).toBeGreaterThan(0)
    for (const symbol of catalogDisabled) {
      const target = harness.canvas.palette
        .targets()
        .find((candidate) => candidate.catalogId === symbol.catalogId)
      expect(target).toMatchObject({
        catalogId: symbol.catalogId,
        catalogPlacementEnabled: false,
        placementEnabled: true
      })
    }
  })

  it('builds a searchable, collapsible and named palette surface', () => {
    harness = bootCanvas()
    const { container } = harness
    expect(
      container
        .querySelector<HTMLInputElement>('.aris-library-search__input')
        ?.getAttribute('aria-label')
    ).toBeTruthy()
    expect(container.querySelectorAll('.aris-library-group__toggle').length).toBeGreaterThanOrEqual(
      6
    )
    expect(container.querySelector('.djs-palette')?.getAttribute('aria-label')).toBeTruthy()
  })

  it('places a catalog-disabled variant with its exact descriptor identity', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const target = canvas.palette
      .targets()
      .find((candidate) => candidate.catalogId === 'governance.sla')
    if (!target) throw new Error('The SLA target is missing.')
    const draft = canvas.palette.startPlacement(new MouseEvent('click'), target)
    const root = canvas.canvas.getRootElement()

    canvas.eventBus.fire('create.end', {
      context: {
        shape: draft,
        elements: [draft],
        canExecute: true,
        target: root,
        hints: {}
      },
      shape: draft,
      elements: [draft],
      snapped: { x: true, y: true },
      x: 200,
      y: 160
    })

    const occurrence = canvas.document.models.get(canvas.activeModelId)?.occurrences[0]
    expect(occurrence?.symbol).toBe('ST_BUSINESS_POLICY')
    const graphics = canvas.elementRegistry.getGraphics(occurrence?.id ?? '')
    expect(
      graphics.querySelector('[data-aris-kind="occurrence"]')?.getAttribute('data-aris-catalog-id')
    ).toBe('governance.sla')
    expect(
      graphics.querySelector('[data-aris-kind="occurrence"]')?.getAttribute('data-aris-icon')
    ).toBe('service-level-shield')
  })

  it('rebuilds the visible library when the active model type changes', () => {
    const fixture = twoModelDocument()
    harness = bootCanvas({ document: fixture.document, modelId: fixture.first })
    expect(harness.container.querySelector('[data-aris-catalog-id="epc.event"]')).toBeTruthy()

    harness.canvas.setActiveModel(fixture.second)

    expect(harness.container.querySelector('[data-aris-catalog-id="epc.event"]')).toBeNull()
    expect(
      harness.container.querySelector('[data-aris-catalog-id="vacd.start-chain"]')
    ).toBeTruthy()
  })
})

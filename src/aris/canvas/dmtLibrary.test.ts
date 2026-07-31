// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import { ARIS_CONNECTION_RULES, isLegalConnection } from '../conventions/connectionRules'
import { ARIS_CONVENTION_SYMBOLS } from '../conventions/catalog'
import { getArisSymbolDescriptors } from '../symbols'
import { createDescriptorPreview } from './descriptorPreview'
import {
  DMT_LIBRARY_GROUPS,
  dmtConnectionHelpers,
  dmtLibraryItems,
  searchDmtLibrary
} from './dmtLibrary'

describe('DMT object library manifest', () => {
  it('is the exact 36-row descriptor/catalog intersection', () => {
    const items = dmtLibraryItems()
    expect(items).toHaveLength(36)
    expect(items.map((item) => item.catalogId).sort()).toEqual(
      ARIS_CONVENTION_SYMBOLS.map((item) => item.catalogId).sort()
    )
    expect(items.map((item) => item.catalogId).sort()).toEqual(
      getArisSymbolDescriptors()
        .map((descriptor) => descriptor.catalogId)
        .sort()
    )
    expect(new Set(items.map((item) => item.descriptorFingerprint))).toHaveLength(36)
  })

  it('keeps catalog order within the six intuitive groups', () => {
    const items = dmtLibraryItems()
    expect(new Set(items.map((item) => item.group))).toEqual(
      new Set(DMT_LIBRARY_GROUPS.map((group) => group.id))
    )
    for (const group of DMT_LIBRARY_GROUPS) {
      const orders = items
        .filter((item) => item.group === group.id)
        .map((item) => item.paletteOrder)
      expect(orders).toEqual([...orders].sort((left, right) => left - right))
    }
  })

  it('makes every manual presentation provider-placeable, including disabled catalog rows', () => {
    const items = dmtLibraryItems()
    expect(items.every((item) => item.placementEnabled)).toBe(true)
    expect(
      items
        .filter((item) => !item.catalogPlacementEnabled)
        .map((item) => item.catalogId)
        .sort()
    ).toEqual(
      ARIS_CONVENTION_SYMBOLS.filter((item) => !item.placementEnabled)
        .map((item) => item.catalogId)
        .sort()
    )
  })

  it('uses the exact shared renderer descriptor for previews', () => {
    for (const item of dmtLibraryItems()) {
      const preview = createDescriptorPreview(item.catalogId)
      expect(preview.dataset.arisCatalogId).toBe(item.catalogId)
      expect(preview.dataset.arisDescriptorFingerprint).toBe(item.descriptorFingerprint)
      const presentation = preview.querySelector('[data-aris-kind="occurrence"]')
      expect(presentation?.getAttribute('data-aris-catalog-id')).toBe(item.catalogId)
      expect(presentation?.getAttribute('data-aris-icon')).toBe(item.descriptor.icon)
      expect(presentation?.getAttribute('data-aris-silhouette')).toBe(item.descriptor.silhouette)
    }
  })
})

describe('DMT library fuzzy search', () => {
  it.each([
    ['Function', 'epc.function'],
    ['اتفاقية مستوى الخدمة', 'governance.sla'],
    ['kpi', 'performance.measure'],
    ['mobile', 'information.sms'],
    ['OT_POLICY', 'governance.business-policy'],
    ['ST_INFO_CARR_HANDY', 'information.sms'],
    ['governance.law-regulation', 'governance.law-regulation'],
    ['regulaton', 'governance.law-regulation']
  ])('finds %s', (query, catalogId) => {
    expect(searchDmtLibrary(query).map((item) => item.catalogId)).toContain(catalogId)
  })

  it('returns no rows for an unrelated query', () => {
    expect(searchDmtLibrary('zzzz-no-such-dmt-object')).toEqual([])
  })

  it('preserves model filtering', () => {
    expect(searchDmtLibrary('value added', 'MT_EEPC')).toEqual([])
    expect(
      searchDmtLibrary('value added', 'MT_VAL_ADD_CHN_DGM').map((item) => item.catalogId)
    ).toEqual(['vacd.start-chain', 'vacd.successor-chain'])
  })
})

describe('DMT connection helper manifest', () => {
  it('contains only exact legal rule tuples and never an unbacked fallback', () => {
    const helpers = dmtConnectionHelpers('MT_EEPC', 'OT_FUNC')
    expect(helpers.length).toBeGreaterThan(0)
    for (const helper of helpers) {
      const from = helper.direction === 'outgoing' ? 'OT_FUNC' : helper.peerObjectType
      const to = helper.direction === 'outgoing' ? helper.peerObjectType : 'OT_FUNC'
      expect(isLegalConnection('MT_EEPC', from, to, helper.connectionType), helper.id).toBe(true)
      expect(ARIS_CONNECTION_RULES).toContain(helper.rule)
      // CT_REFS_TO_2 is also an explicit Requirement→Function convention
      // rule; the important distinction is that no helper lacks a rule.
      expect(helper.rule).not.toBeNull()
    }
  })

  it('surfaces all R/A/C/I executor choices', () => {
    const helpers = dmtConnectionHelpers('MT_EEPC', 'OT_PERS_TYPE').filter(
      (helper) => helper.direction === 'outgoing' && helper.peerObjectType === 'OT_FUNC'
    )
    expect(new Set(helpers.map((helper) => helper.raci))).toEqual(new Set(['R', 'A', 'C', 'I']))
  })
})

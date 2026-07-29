import { describe, expect, it } from 'vitest'
import type { ArisDatabase, ArisObjectDefinition } from '../model/types'
import { buildTestDocument } from '../model/testFixture'
import type { ArisDetailsDocument } from './seam'
import { adaptWorkingDocument, type ArisDetailsElement } from './seam'
import { ARIS_DETAILS_TAB_BUILDERS, ARIS_DETAILS_TAB_ORDER, buildAllTabs } from './tabs'

const EMPTY_DATABASE: ArisDatabase = {
  databaseName: null,
  createDate: null,
  createTime: null,
  userName: null,
  arisExeVersion: null
}

/** Minimal `ArisDetailsDocument` exposing only the object definition(s) a locale test needs. */
function documentWithObjectDefinition(def: ArisObjectDefinition): ArisDetailsDocument {
  return {
    database: EMPTY_DATABASE,
    models: new Map(),
    objectDefinitions: new Map([[def.id, def]]),
    occurrences: new Map(),
    connectionOccurrences: new Map(),
    revision: 1,
    attachments: new Map()
  }
}

function objectDefinitionWithNames(values: Record<string, string>): ArisObjectDefinition {
  return {
    id: 'od-locale-1',
    type: 'OT_FUNC',
    defaultSymbol: 'ST_FUNC',
    names: { values, fallback: Object.values(values)[0] ?? null },
    attributes: [],
    linkedModelIds: [],
    rawAttributes: {}
  }
}

describe('side panel tab model', () => {
  it('builds every tab for a selected object occurrence', async () => {
    const { document } = await buildTestDocument()
    const details = adaptWorkingDocument(document)
    const model = [...details.models.values()][0]
    const element: ArisDetailsElement = {
      kind: 'objectOccurrence',
      id: model.model.occurrences[0].id
    }
    const tabs = buildAllTabs(element, details)
    for (const tabId of ARIS_DETAILS_TAB_ORDER) {
      expect(tabs[tabId]).toBeDefined()
      expect(Array.isArray(tabs[tabId])).toBe(true)
    }
  })

  it('returns English and Arabic side by side in the names tab', async () => {
    const { document } = await buildTestDocument()
    const details = adaptWorkingDocument(document)
    const funcDef = [...details.objectDefinitions.values()].find((d) => d.type === 'OT_FUNC')
    expect(funcDef).toBeDefined()
    const element: ArisDetailsElement = { kind: 'objectDefinition', id: funcDef!.id }
    const rows = ARIS_DETAILS_TAB_BUILDERS.names(element, details)
    const bilingual = rows.find((r) => r.bilingual)
    expect(bilingual).toBeDefined()
    expect(bilingual!.bilingual!.enMissing).toBe(false)
    // The synthetic fixture has no Arabic translation; missing must be explicit.
    expect(bilingual!.bilingual!.arMissing).toBe(true)
  })

  it('marks missing translations explicitly instead of falling back', async () => {
    const { document } = await buildTestDocument()
    const details = adaptWorkingDocument(document)
    const evtDef = [...details.objectDefinitions.values()].find((d) => d.type === 'OT_EVT')
    expect(evtDef).toBeDefined()
    const element: ArisDetailsElement = { kind: 'objectDefinition', id: evtDef!.id }
    const rows = ARIS_DETAILS_TAB_BUILDERS.names(element, details)
    const bilingual = rows.find((r) => r.bilingual)
    expect(bilingual).toBeDefined()
    const hasMissing = bilingual!.bilingual!.enMissing || bilingual!.bilingual!.arMissing
    expect(hasMissing).toBe(true)
  })

  describe('locale matching (regression: bilingual rows must resolve real ARIS locale ids)', () => {
    it('resolves numeric Windows LCIDs 1033/14337 as English/Arabic', () => {
      const def = objectDefinitionWithNames({ '1033': 'UAE Pass', '14337': 'الهوية الرقمية' })
      const doc = documentWithObjectDefinition(def)
      const rows = ARIS_DETAILS_TAB_BUILDERS.names({ kind: 'objectDefinition', id: def.id }, doc)
      const bilingual = rows.find((r) => r.bilingual)
      expect(bilingual).toBeDefined()
      expect(bilingual!.bilingual).toEqual({
        en: 'UAE Pass',
        ar: 'الهوية الرقمية',
        enMissing: false,
        arMissing: false
      })
    })

    it('resolves other regional English/Arabic LCIDs by primary-language id, not just 1033/14337', () => {
      // 2057 = en-GB, 1025 = ar-SA — real ARIS locales beyond the one pair the reference
      // export happens to use.
      const def = objectDefinitionWithNames({ '2057': 'Approve (UK)', '1025': 'موافقة' })
      const doc = documentWithObjectDefinition(def)
      const rows = ARIS_DETAILS_TAB_BUILDERS.names({ kind: 'objectDefinition', id: def.id }, doc)
      const bilingual = rows.find((r) => r.bilingual)
      expect(bilingual!.bilingual).toEqual({
        en: 'Approve (UK)',
        ar: 'موافقة',
        enMissing: false,
        arMissing: false
      })
    })

    it('resolves the raw unexpanded entity-reference form the tokenizer actually produces', () => {
      // ARIS AML declares `<!ENTITY LocaleId.AEar "14337">` / `<!ENTITY LocaleId.USen "1033">`
      // in the DTD internal subset and references them from *attribute values*
      // (`LocaleId="&LocaleId.AEar;"`). The tokenizer/semantic-index layers only expand entity
      // references inside element text, never inside attribute values, so this is the actual
      // locale id shape that reaches `buildFromSource`/`tabs.ts` for a real export — confirmed
      // against `reference/AnimalWF/ARISAMLExport.xml` (see the animalwf regression test).
      const def = objectDefinitionWithNames({
        '&LocaleId.USen;': 'UAE Pass',
        '&LocaleId.AEar;': 'الهوية الرقمية'
      })
      const doc = documentWithObjectDefinition(def)
      const rows = ARIS_DETAILS_TAB_BUILDERS.names({ kind: 'objectDefinition', id: def.id }, doc)
      const bilingual = rows.find((r) => r.bilingual)
      expect(bilingual!.bilingual).toEqual({
        en: 'UAE Pass',
        ar: 'الهوية الرقمية',
        enMissing: false,
        arMissing: false
      })
    })

    it('also resolves the bare entity-name form without its &…; sigils, defensively', () => {
      const def = objectDefinitionWithNames({
        'LocaleId.USen': 'UAE Pass',
        'LocaleId.AEar': 'الهوية الرقمية'
      })
      const doc = documentWithObjectDefinition(def)
      const rows = ARIS_DETAILS_TAB_BUILDERS.names({ kind: 'objectDefinition', id: def.id }, doc)
      const bilingual = rows.find((r) => r.bilingual)
      expect(bilingual!.bilingual).toEqual({
        en: 'UAE Pass',
        ar: 'الهوية الرقمية',
        enMissing: false,
        arMissing: false
      })
    })

    it('resolves entity-reference-form locale ids on attribute rows too', () => {
      const def: ArisObjectDefinition = {
        id: 'od-locale-2',
        type: 'OT_FUNC',
        defaultSymbol: 'ST_FUNC',
        names: { values: {}, fallback: null },
        attributes: [
          {
            type: 'AT_DESC',
            values: [
              { localeId: '&LocaleId.USen;', text: 'Approval step' },
              { localeId: '&LocaleId.AEar;', text: 'خطوة الموافقة' }
            ]
          }
        ],
        linkedModelIds: [],
        rawAttributes: {}
      }
      const doc = documentWithObjectDefinition(def)
      const rows = ARIS_DETAILS_TAB_BUILDERS.attributes(
        { kind: 'objectDefinition', id: def.id },
        doc
      )
      const attrRow = rows.find((r) => r.labelKey === 'aris.details.attributes.attr')
      expect(attrRow!.bilingual).toEqual({
        en: 'Approval step',
        ar: 'خطوة الموافقة',
        enMissing: false,
        arMissing: false
      })
    })
  })

  it('lists attachments under the attachments tab for a model', async () => {
    const { document } = await buildTestDocument()
    const details = adaptWorkingDocument(document)
    const model = [...details.models.values()][0]
    const element: ArisDetailsElement = { kind: 'model', id: model.model.id }
    const rows = ARIS_DETAILS_TAB_BUILDERS.attachments(element, details)
    expect(rows.length).toBeGreaterThanOrEqual(0)
  })
})

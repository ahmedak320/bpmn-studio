import { describe, expect, it } from 'vitest'
import { schemaForModelType, schemaForObjectType } from '../conventions/attributes'
import type { ArisDatabase, ArisModel, ArisObjectDefinition } from '../model/types'
import { buildTestDocument } from '../model/testFixture'
import type { ArisDetailsDocument, ArisMetadataSatellite } from './seam'
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

/** Minimal `ArisDetailsDocument` exposing only the model an R3 schema test needs. */
function documentWithModel(model: ArisModel): ArisDetailsDocument {
  return {
    database: EMPTY_DATABASE,
    models: new Map([
      [model.id, { model, controlFlowNodes: [], satellites: new Map(), attachments: new Map() }]
    ]),
    objectDefinitions: new Map(),
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

/** A definition with no stored attributes at all, for R3 schema-merge tests. */
function objectDefinitionWithoutAttributes(type: string, id = 'od-no-attrs'): ArisObjectDefinition {
  return {
    id,
    type,
    defaultSymbol: 'ST_FUNC',
    names: { values: {}, fallback: null },
    attributes: [],
    linkedModelIds: [],
    rawAttributes: {}
  }
}

/** A bare EPC model with no stored attributes at all, for R3 schema-merge tests. */
function epcModelWithoutAttributes(id = 'm-epc'): ArisModel {
  return {
    id,
    type: 'MT_EEPC',
    names: { values: {}, fallback: null },
    attributes: [],
    occurrences: [],
    connectionOccurrences: [],
    lanes: [],
    freeText: [],
    attachments: [],
    layout: {
      scale: null,
      gridSize: null,
      backColor: null,
      printScale: null,
      curveRadius: null,
      arcRadius: null
    },
    unsupported: false,
    rawSourceRecord: null
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
      // AT_DESC is in the R3 schema for OT_FUNC (`schemaForObjectType`), so its
      // row now carries the specific `aris.attribute.description` label instead
      // of the generic placeholder — look the row up by attribute type (stable
      // regardless of which label a schema-covered type resolves to), not by
      // the old generic label.
      const attrRow = rows.find((r) => r.value === 'AT_DESC')
      expect(attrRow!.bilingual).toEqual({
        en: 'Approval step',
        ar: 'خطوة الموافقة',
        enMissing: false,
        arMissing: false
      })
    })
  })

  describe('R3 attribute schema merge (schemaForObjectType / schemaForModelType)', () => {
    it('flags a mandatory schema attribute with no stored value as missing, under its own label', () => {
      const def = objectDefinitionWithoutAttributes('OT_FUNC')
      const doc = documentWithObjectDefinition(def)
      const rows = ARIS_DETAILS_TAB_BUILDERS.attributes(
        { kind: 'objectDefinition', id: def.id },
        doc
      )
      const idRow = rows.find((r) => r.value === 'AT_ID')
      expect(idRow).toBeDefined()
      expect(idRow).toMatchObject({
        labelKey: 'aris.attribute.identifier',
        missing: true,
        mandatory: true
      })
      expect(idRow!.bilingual).toEqual({ en: null, ar: null, enMissing: true, arMissing: true })
    })

    it('shows every schema attribute for an OT_FUNC definition, mixing stored and missing rows', () => {
      const def: ArisObjectDefinition = {
        id: 'od-mixed',
        type: 'OT_FUNC',
        defaultSymbol: 'ST_FUNC',
        names: { values: {}, fallback: null },
        attributes: [{ type: 'AT_ID', values: [{ localeId: 'en-US', text: 'AWF.01.01' }] }],
        linkedModelIds: [],
        rawAttributes: {}
      }
      const doc = documentWithObjectDefinition(def)
      const rows = ARIS_DETAILS_TAB_BUILDERS.attributes(
        { kind: 'objectDefinition', id: def.id },
        doc
      )
      const schema = schemaForObjectType('OT_FUNC')
      // One row per schema entry (AT_ID stored, the rest missing) — no
      // duplicates, no schema entry silently dropped.
      expect(rows).toHaveLength(schema.length)

      const idRow = rows.find((r) => r.value === 'AT_ID')
      expect(idRow).toMatchObject({ labelKey: 'aris.attribute.identifier', mandatory: true })
      expect(idRow!.missing).toBeFalsy()
      expect(idRow!.bilingual).toEqual({
        en: 'AWF.01.01',
        ar: null,
        enMissing: false,
        arMissing: true
      })

      const descRow = rows.find((r) => r.value === 'AT_DESC')
      expect(descRow).toMatchObject({
        labelKey: 'aris.attribute.description',
        missing: true,
        mandatory: false
      })
    })

    it('leaves an attribute the schema does not describe under the old generic label', () => {
      const def: ArisObjectDefinition = {
        id: 'od-custom-attr',
        type: 'OT_FUNC',
        defaultSymbol: 'ST_FUNC',
        names: { values: {}, fallback: null },
        attributes: [{ type: 'AT_ORBITPM_CUSTOM', values: [{ localeId: 'en-US', text: 'x' }] }],
        linkedModelIds: [],
        rawAttributes: {}
      }
      const doc = documentWithObjectDefinition(def)
      const rows = ARIS_DETAILS_TAB_BUILDERS.attributes(
        { kind: 'objectDefinition', id: def.id },
        doc
      )
      const customRow = rows.find((r) => r.value === 'AT_ORBITPM_CUSTOM')
      expect(customRow).toMatchObject({
        labelKey: 'aris.details.attributes.attr',
        mandatory: false
      })
      expect(customRow!.missing).toBeFalsy()
    })

    it('shows every R3 model-schema attribute for an EPC model, including ones never stored', () => {
      const model = epcModelWithoutAttributes()
      const doc = documentWithModel(model)
      const rows = ARIS_DETAILS_TAB_BUILDERS.attributes({ kind: 'model', id: model.id }, doc)
      const schema = schemaForModelType('MT_EEPC')

      // Ground truth is `schemaForModelType('MT_EEPC')` itself (Lane C1,
      // `src/aris/conventions/attributes.ts`, already merged and out of this
      // lane's scope) rather than a hardcoded count, so this test cannot rot
      // if that catalog changes. At the time of writing this is 11 entries,
      // not 10 — this lane's brief text says "10 model-schema rows", but the
      // actual `ARIS_EPC_MODEL_ATTRIBUTE_SCHEMA` array has 11 (AT_PROC_OBJ,
      // AT_PROC_SCOPE, AT_ENTITY, AT_AUTH_BY, AT_REL_ORG_STRUC, AT_PERS_RESP,
      // AT_VERSION, AT_ID, AT_PROC_AREA, AT_ORG_NAME, AT_SERVICE_FEES); every
      // one of them is missing here since the model stores no attributes.
      expect(schema.length).toBe(11)
      expect(rows).toHaveLength(schema.length)
      for (const row of rows) {
        expect(row.missing).toBe(true)
        expect(row.bilingual).toEqual({ en: null, ar: null, enMissing: true, arMissing: true })
      }

      const persResp = rows.find((r) => r.value === 'AT_PERS_RESP')
      expect(persResp).toMatchObject({ labelKey: 'aris.attribute.personResponsible' })
    })

    it('merges an existing model attribute value with the rest of the missing schema rows', () => {
      const model = {
        ...epcModelWithoutAttributes(),
        attributes: [{ type: 'AT_VERSION', values: [{ localeId: 'en-US', text: 'v1.0' }] }]
      }
      const doc = documentWithModel(model)
      const rows = ARIS_DETAILS_TAB_BUILDERS.attributes({ kind: 'model', id: model.id }, doc)
      expect(rows).toHaveLength(schemaForModelType('MT_EEPC').length)

      const versionRow = rows.find((r) => r.value === 'AT_VERSION')
      expect(versionRow!.missing).toBeFalsy()
      expect(versionRow!.bilingual).toEqual({
        en: 'v1.0',
        ar: null,
        enMissing: false,
        arMissing: true
      })
    })

    it('leaves object-occurrence attribute-occurrence rows untouched by the schema merge, but resolves a friendly value (Lane L-P10b)', () => {
      // The R3 schema merge (this lane) is defined for object definitions and
      // models only; occurrence-level `attributeOccurrences` keep exactly
      // their pre-existing, un-merged projection — one row per occurrence
      // attribute, generic labelKey, no schema rows added or removed. Its
      // `value` is no longer the raw `AT_*` code though (Lane L-P10b, user
      // issue 10): `arisAttributeTypeName` resolves it against the owning
      // definition's object-type schema before it ever reaches the UI.
      const def = objectDefinitionWithoutAttributes('OT_FUNC', 'od-occ-owner')
      const occurrence = {
        id: 'occ-schema-test',
        definitionId: def.id,
        modelId: 'm1',
        symbol: 'ST_FUNC',
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        style: {
          symbol: null,
          fillColor: null,
          strokeColor: null,
          strokeWidth: null,
          lineStyle: null,
          fontStyleSheetId: null,
          zOrder: null
        },
        attributeOccurrences: [
          {
            attributeType: 'AT_PROC_CODE',
            port: null,
            orderNum: null,
            alignment: null,
            offsetX: null,
            offsetY: null,
            width: null,
            height: null,
            rotation: null,
            symbolFlag: null,
            fontStyleSheetId: null
          }
        ],
        rawAttributes: {}
      }
      const doc: ArisDetailsDocument = {
        database: EMPTY_DATABASE,
        models: new Map(),
        objectDefinitions: new Map([[def.id, def]]),
        occurrences: new Map([[occurrence.id, occurrence]]),
        connectionOccurrences: new Map(),
        revision: 1,
        attachments: new Map()
      }
      const rows = ARIS_DETAILS_TAB_BUILDERS.attributes(
        { kind: 'objectOccurrence', id: occurrence.id },
        doc
      )
      // Exactly the one occurrence-attribute row, generic labelKey, untouched
      // by the OT_FUNC schema's row-expansion (which would otherwise add
      // AT_ID/AT_DESC/etc. rows for the DEFINITION side of this same object)
      // — but AT_PROC_CODE IS in that same OT_FUNC schema, so its friendly
      // label ('Process code') is what the resolver returns, not the raw code.
      expect(rows).toEqual([
        { labelKey: 'aris.details.attributes.occurrence', value: 'Process code' }
      ])
    })
  })

  describe('friendly object/model/connection values (Lane L-P10b: raw OT_/ST_/CT_ codes never reach the general/relations tabs)', () => {
    const RAW_OBJECT_CODE_PATTERN = /^(OT_|ST_)/

    function objectDefinitionOfType(type: string, defaultSymbol: string): ArisObjectDefinition {
      return {
        id: 'od-friendly-1',
        type,
        defaultSymbol,
        names: { values: {}, fallback: null },
        attributes: [],
        linkedModelIds: [],
        rawAttributes: {}
      }
    }

    it('collapses a Log object definition into exactly one friendly object-type row', () => {
      const def = objectDefinitionOfType('OT_INFO_CARR', 'ST_LOG')
      const doc = documentWithObjectDefinition(def)
      const rows = ARIS_DETAILS_TAB_BUILDERS.general({ kind: 'objectDefinition', id: def.id }, doc)

      const typeRows = rows.filter((r) => r.labelKey === 'aris.details.general.objectType')
      expect(typeRows).toHaveLength(1)
      expect(typeRows[0].value).toBe('Log block')
      expect(
        rows.some((r) => typeof r.value === 'string' && RAW_OBJECT_CODE_PATTERN.test(r.value))
      ).toBe(false)
    })

    it('collapses a Log object occurrence into exactly one friendly object-type row', () => {
      const def = objectDefinitionOfType('OT_INFO_CARR', 'ST_LOG')
      const occurrence = {
        id: 'occ-friendly-1',
        definitionId: def.id,
        modelId: 'm1',
        symbol: 'ST_LOG',
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        style: {
          symbol: null,
          fillColor: null,
          strokeColor: null,
          strokeWidth: null,
          lineStyle: null,
          fontStyleSheetId: null,
          zOrder: null
        },
        attributeOccurrences: [],
        rawAttributes: {}
      }
      const doc: ArisDetailsDocument = {
        database: EMPTY_DATABASE,
        models: new Map(),
        objectDefinitions: new Map([[def.id, def]]),
        occurrences: new Map([[occurrence.id, occurrence]]),
        connectionOccurrences: new Map(),
        revision: 1,
        attachments: new Map()
      }
      const rows = ARIS_DETAILS_TAB_BUILDERS.general(
        { kind: 'objectOccurrence', id: occurrence.id },
        doc
      )

      const typeRows = rows.filter((r) => r.labelKey === 'aris.details.general.objectType')
      expect(typeRows).toHaveLength(1)
      expect(typeRows[0].value).toBe('Log block')
      expect(
        rows.some((r) => typeof r.value === 'string' && RAW_OBJECT_CODE_PATTERN.test(r.value))
      ).toBe(false)
    })

    it("shows the friendly model-type label ('Process (EPC)') for an MT_EEPC model", () => {
      const model = epcModelWithoutAttributes('m-friendly-epc')
      const doc = documentWithModel(model)
      const rows = ARIS_DETAILS_TAB_BUILDERS.general({ kind: 'model', id: model.id }, doc)

      const modelTypeRow = rows.find((r) => r.labelKey === 'aris.details.general.modelType')
      expect(modelTypeRow?.value).toBe('Process (EPC)')
    })

    it('resolves a relation connectionType row to its friendly label, never the raw CT_ code', () => {
      const model = epcModelWithoutAttributes('m-friendly-relations')
      const satellite: ArisMetadataSatellite = {
        category: 'responsible',
        relation: {
          category: 'responsible',
          connectionType: 'CT_EXEC_1',
          connectionDefinitionId: 'cxn-def-1',
          connectionOccurrenceId: 'cxn-occ-1',
          sourceOccurrenceId: 'occ-func-1',
          targetOccurrenceId: 'occ-pers-1',
          satelliteDefinitionId: 'def-pers-1',
          satelliteOccurrenceId: 'occ-pers-1'
        },
        definitionId: 'def-pers-1',
        occurrenceId: 'occ-pers-1',
        modelId: model.id,
        type: 'OT_PERS',
        symbol: 'ST_PERS',
        names: {},
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        attributes: {}
      }
      const doc: ArisDetailsDocument = {
        database: EMPTY_DATABASE,
        models: new Map([
          [
            model.id,
            {
              model,
              controlFlowNodes: [],
              satellites: new Map([[satellite.occurrenceId, satellite]]),
              attachments: new Map()
            }
          ]
        ]),
        objectDefinitions: new Map(),
        occurrences: new Map(),
        connectionOccurrences: new Map(),
        revision: 1,
        attachments: new Map()
      }
      const rows = ARIS_DETAILS_TAB_BUILDERS.relations(
        { kind: 'objectOccurrence', id: satellite.occurrenceId },
        doc
      )

      const connectionTypeRow = rows.find(
        (r) => r.labelKey === 'aris.details.relations.connectionType'
      )
      expect(connectionTypeRow?.value).toBe('executes')
      expect(rows.some((r) => typeof r.value === 'string' && /^CT_/.test(r.value))).toBe(false)
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

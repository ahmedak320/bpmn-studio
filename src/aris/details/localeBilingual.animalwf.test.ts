import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildFromSource } from '../model/buildFromSource'
import { createArisXmlSourcePackage } from '../source/sourcePackage'
import { adaptWorkingDocument } from './seam'
import { ARIS_DETAILS_TAB_BUILDERS } from './tabs'

/**
 * Regression guard for the "every bilingual row renders 'Not set'" bug (plan §13.3 / §6.2):
 * `tabs.ts` used to allow-list the literal DTD *entity-name* strings `'LocaleId.USen'` /
 * `'LocaleId.AEar'`, but the AML declares those as internal entities
 * (`<!ENTITY LocaleId.AEar "14337">`) referenced from attribute values
 * (`LocaleId="&LocaleId.AEar;"`). The tokenizer/semantic-index layers never expand entity
 * references inside attribute values, so the runtime locale id is the raw, unexpanded
 * `"&LocaleId.AEar;"` string — which the old allow-list could never match. This test proves the
 * fix against the real reference export instead of a synthetic fixture that could accidentally
 * use an already-matching locale id shape.
 *
 * Named `*.animalwf.test.ts` per convention: excluded from the default `vitest run` project
 * (see vitest.config.ts) and from `check:no-skips`'s scan, run only through the dedicated
 * `npm run test:aris:animalwf` entry point (vitest.animalwf.config.ts). The fixture is private
 * customer data — never committed, copied, or reproduced here — and this module-load guard
 * throws immediately if it is absent rather than silently skipping.
 */
const ANIMAL_WF_PATH = resolve('/home/ahmed/Desktop/bpmn_tool/reference/AnimalWF/ARISAMLExport.xml')
if (!existsSync(ANIMAL_WF_PATH)) {
  throw new Error(
    `AnimalWF fixture not found at ${ANIMAL_WF_PATH}. This suite only runs via ` +
      `\`npm run test:aris:animalwf\` with the private reference export present locally; it is ` +
      'never run as part of the default test suite and never skips.'
  )
}

// The one genuinely bilingual object definition in the reference export: an OT_APPL_SYS named
// "UAE Pass" in English and "الهوية الرقمية" in Arabic (the Arabic name is written as XML
// numeric character references inside a `PlainText TextValue` attribute). 249 of the export's
// 279 object definitions have no Arabic name at all, so this is deliberately the only bilingual
// case asserted here rather than a broad claim about Arabic coverage.
const BILINGUAL_OBJECT_DEFINITION_ID = 'ObjDef.-6n37IkhqS5m-p-L'

describe('AnimalWF real-data acceptance: bilingual Names tab', () => {
  it('surfaces both the English and Arabic name of the one bilingual object', async () => {
    const bytes = readFileSync(ANIMAL_WF_PATH)
    const pkg = await createArisXmlSourcePackage({
      name: 'ARISAMLExport.xml',
      relPath: null,
      bytes: new Uint8Array(bytes)
    })
    const workingDocument = buildFromSource(pkg.index)
    const details = adaptWorkingDocument(workingDocument)

    const def = details.objectDefinitions.get(BILINGUAL_OBJECT_DEFINITION_ID)
    expect(def).toBeDefined()

    const rows = ARIS_DETAILS_TAB_BUILDERS.names(
      { kind: 'objectDefinition', id: BILINGUAL_OBJECT_DEFINITION_ID },
      details
    )
    const bilingual = rows.find((r) => r.bilingual)
    expect(bilingual).toBeDefined()
    expect(bilingual!.bilingual).toEqual({
      en: 'UAE Pass',
      ar: 'الهوية الرقمية',
      enMissing: false,
      arMissing: false
    })
  }, 30_000)
})

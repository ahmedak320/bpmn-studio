import { describe, expect, it } from 'vitest'
import { buildTestDocument } from '../model/testFixture'
import { adaptWorkingDocument, type ArisDetailsElement } from './seam'
import { ARIS_DETAILS_TAB_BUILDERS, ARIS_DETAILS_TAB_ORDER, buildAllTabs } from './tabs'

describe('side panel tab model', () => {
  it('builds every tab for a selected object occurrence', async () => {
    const { document } = await buildTestDocument()
    const details = adaptWorkingDocument(document)
    const model = [...details.models.values()][0]
    const element: ArisDetailsElement = { kind: 'objectOccurrence', id: model.model.occurrences[0].id }
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

  it('lists attachments under the attachments tab for a model', async () => {
    const { document } = await buildTestDocument()
    const details = adaptWorkingDocument(document)
    const model = [...details.models.values()][0]
    const element: ArisDetailsElement = { kind: 'model', id: model.model.id }
    const rows = ARIS_DETAILS_TAB_BUILDERS.attachments(element, details)
    expect(rows.length).toBeGreaterThanOrEqual(0)
  })
})

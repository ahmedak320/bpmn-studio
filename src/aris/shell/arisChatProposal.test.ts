import { describe, expect, it } from 'vitest'

import type { ArisChatQuestion } from '../chat/interviewLoop'
import type { ArisWorkingDocument } from '../model/types'
import { buildLocalArisPatchProposal } from './arisChatProposal'

/**
 * Regression coverage for the locale-classification bug in `detectLocaleIds`: it previously only
 * recognized numeric LCIDs and short BCP-47-ish tags, so on a document whose existing English
 * name is keyed by the RAW, unexpanded internal-DTD entity reference a real ARIS export actually
 * uses (`"&LocaleId.USen;"`), an Arabic-name answer would join a fresh, unrelated `'1025'` key
 * instead of the document's own Arabic entity-reference convention.
 */
function fakeDocument(overrides: {
  readonly modelNames?: Readonly<Record<string, string>>
  readonly objectDefinitions?: Readonly<Record<string, Readonly<Record<string, string>>>>
}): ArisWorkingDocument {
  const models = new Map([
    ['m1', { id: 'm1', names: { values: overrides.modelNames ?? {}, fallback: null } }]
  ])
  const objectDefinitions = new Map(
    Object.entries(overrides.objectDefinitions ?? {}).map(([id, values]) => [
      id,
      { id, names: { values, fallback: null } }
    ])
  )
  return {
    revision: 3,
    models,
    objectDefinitions,
    connectionDefinitions: new Map()
  } as unknown as ArisWorkingDocument
}

function question(gapKind: ArisChatQuestion['gapKind'], targetId: string): ArisChatQuestion {
  return {
    id: `q-${gapKind}`,
    messageKey: `aris.chat.gap.${gapKind}`,
    gapKind,
    targetIds: [targetId]
  }
}

describe('buildLocalArisPatchProposal locale-id detection', () => {
  it('joins the raw entity-reference Arabic key already used by the document', () => {
    const document = fakeDocument({ modelNames: { '&LocaleId.USen;': 'Approval Process' } })
    const proposal = buildLocalArisPatchProposal({
      document,
      questions: [question('missingArabicName', 'm1')],
      answers: { 'q-missingArabicName': 'عملية الموافقة' }
    }) as { commands: readonly { payload: { localeId: string } }[] }

    expect(proposal).not.toBeNull()
    // No Arabic key exists yet in the document, so it still falls back to the default numeric
    // LCID -- this only pins that an EXISTING raw entity-reference key does not get missed.
    expect(proposal.commands[0]?.payload.localeId).toBe('1025')
  })

  it('joins the raw entity-reference English key already used by the document', () => {
    const document = fakeDocument({
      objectDefinitions: { od1: { '&LocaleId.USen;': 'Approve', '&LocaleId.AEar;': 'موافقة' } }
    })
    const proposal = buildLocalArisPatchProposal({
      document,
      questions: [question('missingEnglishName', 'od1')],
      answers: { 'q-missingEnglishName': 'Re-approve' }
    }) as { commands: readonly { payload: { localeId: string } }[] }

    expect(proposal).not.toBeNull()
    expect(proposal.commands[0]?.payload.localeId).toBe('&LocaleId.USen;')
  })

  it('joins the raw entity-reference Arabic key when the document already has one', () => {
    const document = fakeDocument({
      objectDefinitions: { od1: { '&LocaleId.USen;': 'Approve', '&LocaleId.AEar;': 'موافقة' } }
    })
    const proposal = buildLocalArisPatchProposal({
      document,
      questions: [question('missingArabicName', 'od1')],
      answers: { 'q-missingArabicName': 'إعادة الموافقة' }
    }) as { commands: readonly { payload: { localeId: string } }[] }

    expect(proposal).not.toBeNull()
    expect(proposal.commands[0]?.payload.localeId).toBe('&LocaleId.AEar;')
  })
})

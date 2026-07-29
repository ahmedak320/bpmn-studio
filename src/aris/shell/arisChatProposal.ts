/**
 * A deterministic, provider-free `ArisPatchProposalV1` builder (plan §18.2 step 6).
 *
 * The interview loop in `src/aris/chat` is a pure reducer: it never makes an AI
 * request, it only consumes a raw proposal fed in from outside. That makes the
 * whole §18 pipeline — schema validation, base-revision checks, automatic/confirm
 * classification, atomic apply, rollback, rescan — reachable with NO key at all,
 * as long as something turns the user's typed answers into patch commands. That is
 * this module.
 *
 * It is deliberately conservative:
 *
 *  - Field answers become safe, automatic-classified commands (names, process code,
 *    owner, decision basis) — exactly the §18.4 "apply automatically" list.
 *  - An unused definition the user opted to remove becomes a `deleteDefinition`,
 *    which classification.ts classifies `confirm`, so it takes the §18.6
 *    before/after confirmation path instead of being applied.
 *  - Anything else produces no command. A gap the shell cannot fix deterministically
 *    is left in the gap list rather than guessed at.
 *
 * The result is returned as a plain (untyped) value on purpose: it is handed to the
 * reducer as `proposalReceived`, which re-validates it through
 * `parseArisPatchProposal`. A builder bug is therefore caught by the same schema
 * that catches a malicious model, and the document is untouched either way.
 */

import { localeLang } from '../../library/amlParse'
import type { ArisChatQuestion } from '../chat/interviewLoop'
import type { ArisWorkingDocument } from '../model/types'

/** The answer value that opts an `unusedDefinition` question into a removal proposal. */
export const ARIS_CHAT_REMOVE_ANSWER = 'remove'

const DEFAULT_ENGLISH_LOCALE_ID = '1033'
const DEFAULT_ARABIC_LOCALE_ID = '1025'
const ENGLISH_LOCALE_IDS = new Set(['1033', 'en', 'en-US', 'en-GB'])
const ARABIC_LOCALE_IDS = new Set(['1025', 'ar', 'ar-AE', 'ar-SA'])

const PROCESS_CODE_ATTRIBUTE = 'AT_PROC_CODE'
const OWNER_ATTRIBUTE = 'AT_PERS_RESP'
const DECISION_BASIS_ATTRIBUTE = 'AT_DESC'

type OwnerKind = 'model' | 'objectDefinition' | 'connectionDefinition'

/**
 * Locale ids the document already uses, so a new value joins the existing set.
 *
 * `ENGLISH_LOCALE_IDS`/`ARABIC_LOCALE_IDS` only match numeric LCIDs and short
 * BCP-47-ish tags. A real ARIS export keys `names.values` by the RAW,
 * unexpanded internal-DTD entity reference instead (`"&LocaleId.USen;"` /
 * `"&LocaleId.AEar;"` — see `tabs.ts`'s `classifyLocale` for why), so without
 * also classifying that form, every locally-answered gap on a real import
 * joins a numeric `'1033'`/`'1025'` key that does not match the document's
 * own convention. `localeLang` recognizes all three shapes.
 */
function detectLocaleIds(document: ArisWorkingDocument): {
  readonly en: string
  readonly ar: string
} {
  let en: string | null = null
  let ar: string | null = null
  const consider = (values: Readonly<Record<string, string>>): void => {
    for (const localeId of Object.keys(values)) {
      if (en === null && (ENGLISH_LOCALE_IDS.has(localeId) || localeLang(localeId) === 'en'))
        en = localeId
      if (ar === null && (ARABIC_LOCALE_IDS.has(localeId) || localeLang(localeId) === 'ar'))
        ar = localeId
    }
  }
  for (const model of document.models.values()) consider(model.names.values)
  for (const definition of document.objectDefinitions.values()) consider(definition.names.values)
  return { en: en ?? DEFAULT_ENGLISH_LOCALE_ID, ar: ar ?? DEFAULT_ARABIC_LOCALE_ID }
}

/** Which kind of record an id names, or `null` when it names neither. */
export function resolveOwnerKind(
  document: ArisWorkingDocument,
  id: string
): { readonly ownerKind: OwnerKind; readonly ownerId: string } | null {
  if (document.models.has(id)) return { ownerKind: 'model', ownerId: id }
  if (document.objectDefinitions.has(id)) return { ownerKind: 'objectDefinition', ownerId: id }
  if (document.connectionDefinitions.has(id)) {
    return { ownerKind: 'connectionDefinition', ownerId: id }
  }
  // An occurrence-scoped gap is fixed on the definition the occurrence shows.
  for (const model of document.models.values()) {
    const occurrence = model.occurrences.find((candidate) => candidate.id === id)
    if (occurrence && document.objectDefinitions.has(occurrence.definitionId)) {
      return { ownerKind: 'objectDefinition', ownerId: occurrence.definitionId }
    }
    const connection = model.connectionOccurrences.find((candidate) => candidate.id === id)
    if (connection && document.connectionDefinitions.has(connection.definitionId)) {
      return { ownerKind: 'connectionDefinition', ownerId: connection.definitionId }
    }
  }
  return null
}

export interface ArisLocalProposalInput {
  readonly document: ArisWorkingDocument
  readonly questions: readonly ArisChatQuestion[]
  readonly answers: Readonly<Record<string, string>>
}

/**
 * Build a raw proposal from the answered questions, or `null` when no answer maps
 * to a command this shell can express.
 */
export function buildLocalArisPatchProposal(input: ArisLocalProposalInput): unknown | null {
  const { document, questions, answers } = input
  const locales = detectLocaleIds(document)
  const commands: unknown[] = []

  questions.forEach((question, index) => {
    const answer = (answers[question.id] ?? '').trim()
    if (answer === '') return
    const targetId = question.targetIds[0]
    if (targetId === undefined) return
    const commandId = `local-${index}-${question.gapKind}`

    if (question.gapKind === 'unusedDefinition') {
      if (answer !== ARIS_CHAT_REMOVE_ANSWER) return
      if (!document.objectDefinitions.has(targetId)) return
      commands.push({
        commandId,
        kind: 'deleteDefinition',
        targetIds: [targetId],
        payload: { definitionId: targetId }
      })
      return
    }

    const owner = resolveOwnerKind(document, targetId)
    if (!owner) return

    switch (question.gapKind) {
      case 'missingEnglishName':
        commands.push({
          commandId,
          kind: 'setLocalizedName',
          targetIds: [owner.ownerId],
          payload: { ...owner, localeId: locales.en, value: answer }
        })
        return
      case 'missingArabicName':
        commands.push({
          commandId,
          kind: 'setLocalizedName',
          targetIds: [owner.ownerId],
          payload: { ...owner, localeId: locales.ar, value: answer }
        })
        return
      case 'missingProcessCode':
        commands.push({
          commandId,
          kind: 'setAttribute',
          targetIds: [owner.ownerId],
          payload: {
            ...owner,
            attributeType: PROCESS_CODE_ATTRIBUTE,
            values: [{ localeId: locales.en, text: answer }]
          }
        })
        return
      case 'missingOwner':
        commands.push({
          commandId,
          kind: 'addAttributeValue',
          targetIds: [owner.ownerId],
          payload: {
            ...owner,
            attributeType: OWNER_ATTRIBUTE,
            value: { localeId: locales.en, text: answer }
          }
        })
        return
      case 'missingDecisionBasis':
        commands.push({
          commandId,
          kind: 'addAttributeValue',
          targetIds: [owner.ownerId],
          payload: {
            ...owner,
            attributeType: DECISION_BASIS_ATTRIBUTE,
            value: { localeId: locales.en, text: answer }
          }
        })
        return
      default:
        // Everything else (topology repair, attachments, linked models) needs an
        // allocator or a human decision the shell will not invent.
        return
    }
  })

  if (commands.length === 0) return null
  return { version: 1, baseRevision: document.revision, commands }
}

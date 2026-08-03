/**
 * Bilingual (EN + AR) message tables for every `aris.epc.finding.*` messageKey
 * `validateEpcGraph` can produce (implementation plan Lane L-PROJECT, Wave 19).
 *
 * The canonical->EPC findings artifact (`./findings`) is a machine-readable,
 * self-contained JSON document consumed OUTSIDE the studio UI (the enterprise
 * portal, the CLI), so it carries its own resolved EN/AR strings rather than
 * routing through `src/i18n` at read time. These strings are transcribed
 * VERBATIM from `src/i18n/dictionaries.ts` (the live rail's own copy) and are
 * drift-tested against it in `findings.test.ts` — if the dictionaries change,
 * that test fails until this table is re-synced.
 *
 * `{param}` interpolation follows the dictionaries' convention exactly (the
 * same regex `t()` uses in `src/i18n/index.ts`): `{name}` is replaced with
 * `params[name]`, and an unmatched token is left as `{name}`.
 */

/** English messages, keyed by `aris.epc.finding.*` messageKey. */
export const EPC_FINDING_MESSAGES_EN: Readonly<Record<string, string>> = Object.freeze({
  'aris.epc.finding.alternationViolation':
    'Two directly connected occurrences share the type {objectType}; events and functions must alternate, with a rule between them.',
  'aris.epc.finding.missingStartEvent': 'This model has no start event.',
  'aris.epc.finding.missingEndEvent': 'This model has no end event.',
  'aris.epc.finding.ruleSplitMergeConflict':
    'This rule both merges multiple incoming branches and splits into multiple outgoing branches; split and merge must be modeled as separate rules.',
  'aris.epc.finding.eventPrecedesDecisionSplit':
    'An event is directly followed by a splitting {ruleKind} rule; only a rule may make a decision, never an event.',
  'aris.epc.finding.orphanNode': "This object is disconnected from the model's main control flow.",
  'aris.epc.finding.unrecognizedRuleSymbol':
    'This rule uses the unrecognized connector symbol “{symbolType}”; only AND, OR, and XOR are supported.',
  'aris.epc.finding.missingConnectionType': 'This connection has no connection type.',
  'aris.epc.finding.danglingLinkedModel':
    'This object links to model “{modelId}”, which does not exist in this document.',
  'aris.epc.finding.unlabeledDecisionBranch':
    'This decision branch has no label — name the connection or the outcome event.',
  'aris.epc.finding.unreachableEnd': 'No end event can be reached from this start event.'
})

/** Arabic messages, keyed by `aris.epc.finding.*` messageKey. */
export const EPC_FINDING_MESSAGES_AR: Readonly<Record<string, string>> = Object.freeze({
  'aris.epc.finding.alternationViolation':
    'يشترك ظهوران متصلان مباشرة في النوع {objectType}؛ يجب أن تتناوب الأحداث والوظائف، مع وجود قاعدة بينهما.',
  'aris.epc.finding.missingStartEvent': 'لا يحتوي هذا النموذج على حدث بداية.',
  'aris.epc.finding.missingEndEvent': 'لا يحتوي هذا النموذج على حدث نهاية.',
  'aris.epc.finding.ruleSplitMergeConflict':
    'تجمع هذه القاعدة بين عدة فروع واردة وتتفرّع في الوقت نفسه إلى عدة فروع صادرة؛ يجب تمثيل التجميع والتفريع بقاعدتين منفصلتين.',
  'aris.epc.finding.eventPrecedesDecisionSplit':
    'يعقب الحدث مباشرة قاعدة {ruleKind} متفرّعة؛ اتخاذ القرار من اختصاص القاعدة وليس الحدث.',
  'aris.epc.finding.orphanNode': 'هذا الكائن منفصل عن مسار التحكم الرئيسي للنموذج.',
  'aris.epc.finding.unrecognizedRuleSymbol':
    'تستخدم هذه القاعدة رمز موصل غير معروف هو «{symbolType}»؛ المدعوم فقط AND وOR وXOR.',
  'aris.epc.finding.missingConnectionType': 'لا تحمل هذه العلاقة نوعًا محددًا.',
  'aris.epc.finding.danglingLinkedModel':
    'يرتبط هذا الكائن بالنموذج «{modelId}»، وهو غير موجود في هذا المستند.',
  'aris.epc.finding.unlabeledDecisionBranch':
    'هذا الفرع من القرار بلا تسمية — سمِّ الوصلة أو حدث النتيجة.',
  'aris.epc.finding.unreachableEnd': 'لا يمكن الوصول إلى أي حدث نهاية انطلاقًا من حدث البداية هذا.'
})

/** Every messageKey these tables define — the full `validateEpcGraph` set. */
export const EPC_FINDING_MESSAGE_KEYS: readonly string[] = Object.freeze(
  Object.keys(EPC_FINDING_MESSAGES_EN)
)

/**
 * Replace `{name}` tokens with `params[name]`, matching `t()`'s regex exactly.
 * An unmatched token is left verbatim as `{name}`.
 */
export function interpolateFindingMessage(
  template: string,
  params?: Readonly<Record<string, string>>
): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
    params[name] !== undefined ? params[name] : `{${name}}`
  )
}

/**
 * Resolve a messageKey to its interpolated EN + AR strings. An unknown key
 * degrades to the key itself in both locales (never throws, never empty).
 */
export function epcFindingMessages(
  messageKey: string,
  params?: Readonly<Record<string, string>>
): { readonly en: string; readonly ar: string } {
  const en = EPC_FINDING_MESSAGES_EN[messageKey]
  const ar = EPC_FINDING_MESSAGES_AR[messageKey]
  return {
    en: en !== undefined ? interpolateFindingMessage(en, params) : messageKey,
    ar: ar !== undefined ? interpolateFindingMessage(ar, params) : messageKey
  }
}

// A local, self-contained EN/AR message dictionary for the ARIS process
// assistant, following the exact pattern of `src/i18n/index.ts` +
// `src/i18n/dictionaries.ts` (lookup key -> string, `{name}` interpolation).
// This is intentionally its OWN dictionary rather than an addition to the
// shared `src/i18n/dictionaries.ts` file: the assistant lane must not modify
// any existing file, and answers are DATA (message key + vars), not prose —
// see `answer.ts`. A future wiring pass can fold these keys into the shared
// dictionary; until then this module is the assistant's single source of
// truth for its own display strings.

export type ArisAssistantLang = 'en' | 'ar'

export const arisAssistantEn = {
  'assistant.next.forStep': 'After {step}, the process continues with:',
  'assistant.next.complete': '{step} ends the process — there is no next step.',
  'assistant.before.forStep': 'Before {step}, the process comes from:',
  'assistant.before.none': '{step} has no recorded predecessor — it is a process entry point.',
  'assistant.responsible.forStep': '{step} is the responsibility of:',
  'assistant.responsible.forProcess': '{process} is owned by:',
  'assistant.responsible.none': 'No responsible party is recorded for {step}.',
  'assistant.io.forStep': 'Inputs and outputs for {step}:',
  'assistant.io.inputs': 'Inputs: {list}',
  'assistant.io.outputs': 'Outputs: {list}',
  'assistant.io.none': 'No inputs or outputs are recorded for {step}.',
  'assistant.system.forStep': 'System(s) used by {step}:',
  'assistant.system.none': 'No system is recorded for {step}.',
  'assistant.xor.forGateway': '{gateway} outcomes:',
  'assistant.xor.none': 'No decision gateway matches that question.',
  'assistant.return.found': 'The return branch from {step} goes back to {target}.',
  'assistant.return.none': 'No return branch (loop-back edge) was found for {step}.',
  'assistant.assignment.forStep': '{step} is assigned to model:',
  'assistant.assignment.none': 'No linked model is assigned to {step}.',
  'assistant.missing.forProcess': '{process} is missing:',
  'assistant.missing.none': 'No missing information was found for {process}.',
  'assistant.processList.title': 'Available processes:',
  'assistant.processList.empty': 'No processes are indexed yet.',
  'assistant.topic.title': 'Processes matching "{query}":',
  'assistant.topic.none': 'No process confidently matches "{query}".',
  'assistant.none': 'No confident local answer was found for that question.',
  'assistant.gap.missingNameEn': 'English name missing for {step}',
  'assistant.gap.missingNameAr': 'Arabic name missing for {step}',
  'assistant.gap.missingProcessCode': 'Process code is missing',
  'assistant.gap.missingOwner': 'Process owner/responsible party is missing',
  'assistant.gap.missingInputs': 'Inputs are missing for {step}',
  'assistant.gap.missingOutputs': 'Outputs are missing for {step}',
  'assistant.gap.missingSystem': 'Supporting system is missing for {step}',
  'assistant.gap.missingDecisionBasis': 'Decision basis is missing for {step}',
  'assistant.gap.missingOutcome': 'Outcome labels are missing for {step}',
  'assistant.gap.danglingConnection': 'Connection {detail} references a missing object'
}

export type ArisAssistantKey = keyof typeof arisAssistantEn

export const arisAssistantAr: Record<ArisAssistantKey, string> = {
  'assistant.next.forStep': 'بعد {step}، تستمر العملية بالخطوات التالية:',
  'assistant.next.complete': '{step} تنهي العملية — لا توجد خطوة تالية.',
  'assistant.before.forStep': 'قبل {step}، تأتي العملية من:',
  'assistant.before.none': 'لا توجد خطوة سابقة مسجلة لـ {step} — إنها نقطة بداية للعملية.',
  'assistant.responsible.forStep': '{step} هي مسؤولية:',
  'assistant.responsible.forProcess': '{process} مملوكة من قبل:',
  'assistant.responsible.none': 'لا توجد جهة مسؤولة مسجلة لـ {step}.',
  'assistant.io.forStep': 'المدخلات والمخرجات لـ {step}:',
  'assistant.io.inputs': 'المدخلات: {list}',
  'assistant.io.outputs': 'المخرجات: {list}',
  'assistant.io.none': 'لا توجد مدخلات أو مخرجات مسجلة لـ {step}.',
  'assistant.system.forStep': 'الأنظمة المستخدمة في {step}:',
  'assistant.system.none': 'لا يوجد نظام مسجل لـ {step}.',
  'assistant.xor.forGateway': 'بدائل {gateway}:',
  'assistant.xor.none': 'لا توجد بوابة قرار مطابقة لهذا السؤال.',
  'assistant.return.found': 'فرع العودة من {step} يعود إلى {target}.',
  'assistant.return.none': 'لم يتم العثور على فرع عودة لـ {step}.',
  'assistant.assignment.forStep': '{step} مرتبطة بالنموذج:',
  'assistant.assignment.none': 'لا يوجد نموذج مرتبط بـ {step}.',
  'assistant.missing.forProcess': 'المعلومات الناقصة في {process}:',
  'assistant.missing.none': 'لم يتم العثور على معلومات ناقصة في {process}.',
  'assistant.processList.title': 'العمليات المتاحة:',
  'assistant.processList.empty': 'لا توجد عمليات مفهرسة بعد.',
  'assistant.topic.title': 'العمليات المطابقة لـ "{query}":',
  'assistant.topic.none': 'لا توجد عملية مطابقة بثقة لـ "{query}".',
  'assistant.none': 'لم يتم العثور على إجابة محلية موثوقة لهذا السؤال.',
  'assistant.gap.missingNameEn': 'الاسم الإنجليزي مفقود لـ {step}',
  'assistant.gap.missingNameAr': 'الاسم العربي مفقود لـ {step}',
  'assistant.gap.missingProcessCode': 'رمز العملية مفقود',
  'assistant.gap.missingOwner': 'مالك العملية أو الجهة المسؤولة مفقودة',
  'assistant.gap.missingInputs': 'المدخلات مفقودة لـ {step}',
  'assistant.gap.missingOutputs': 'المخرجات مفقودة لـ {step}',
  'assistant.gap.missingSystem': 'النظام الداعم مفقود لـ {step}',
  'assistant.gap.missingDecisionBasis': 'أساس القرار مفقود لـ {step}',
  'assistant.gap.missingOutcome': 'تسميات النتائج مفقودة لـ {step}',
  'assistant.gap.danglingConnection': 'الاتصال {detail} يشير إلى عنصر مفقود'
}

const ARIS_ASSISTANT_DICTS: Record<ArisAssistantLang, Record<ArisAssistantKey, string>> = {
  en: arisAssistantEn,
  ar: arisAssistantAr
}

/** Interpolates `{name}` tokens in the looked-up string with `vars[name]`. */
export function tAssistant(
  lang: ArisAssistantLang,
  key: ArisAssistantKey,
  vars?: Record<string, string | number>
): string {
  const raw = ARIS_ASSISTANT_DICTS[lang][key] ?? ARIS_ASSISTANT_DICTS.en[key] ?? key
  if (!vars) return raw
  return raw.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`))
}

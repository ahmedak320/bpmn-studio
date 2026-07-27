import type { CanonicalSheet } from './contracts'

export const CANONICAL_FIELDS_BY_SHEET = Object.freeze({
  processes: Object.freeze([
    'process_id',
    'name_en',
    'name_ar',
    'description_en',
    'description_ar',
    'owner_en',
    'owner_ar',
    'folder',
    'active_language'
  ]),
  participants: Object.freeze([
    'process_id',
    'participant_id',
    'type',
    'parent_id',
    'order',
    'name_en',
    'name_ar'
  ]),
  steps: Object.freeze([
    'process_id',
    'step_id',
    'order',
    'type',
    'name_en',
    'name_ar',
    'pool_id',
    'lane_id',
    'participant_id',
    'owner_en',
    'owner_ar',
    'raci',
    'responsible_parties_en',
    'responsible_parties_ar',
    'channel_en',
    'channel_ar',
    'channel_detail_en',
    'channel_detail_ar',
    'inputs_en',
    'inputs_ar',
    'outputs_en',
    'outputs_ar',
    'cc_en',
    'cc_ar',
    'decision_basis_en',
    'decision_basis_ar',
    'triggers_en',
    'triggers_ar',
    'called_process_id',
    'event_definition',
    'notes_en',
    'notes_ar',
    'next_step_id',
    'next_step_ids'
  ]),
  flows: Object.freeze([
    'process_id',
    'flow_id',
    'source_step_id',
    'target_step_id',
    'condition_en',
    'condition_ar',
    'is_default'
  ]),
  glossary: Object.freeze(['english', 'arabic', 'do_not_translate', 'case_sensitive'])
} satisfies Readonly<Record<CanonicalSheet, readonly string[]>>)

export type CanonicalField = (typeof CANONICAL_FIELDS_BY_SHEET)[CanonicalSheet][number]

/**
 * A required group is satisfied when at least one of its fields is mapped.
 * Singleton groups remain unconditionally required. Process, participant, and
 * step names deliberately use an English/Arabic alternative group so an
 * ordinary single-language workbook can reach the bilingual review workflow.
 */
export const REQUIRED_FIELD_GROUPS_BY_SHEET = Object.freeze({
  processes: Object.freeze([Object.freeze(['process_id']), Object.freeze(['name_en', 'name_ar'])]),
  participants: Object.freeze([
    Object.freeze(['process_id']),
    Object.freeze(['participant_id']),
    Object.freeze(['type']),
    Object.freeze(['name_en', 'name_ar'])
  ]),
  steps: Object.freeze([
    Object.freeze(['process_id']),
    Object.freeze(['type']),
    Object.freeze(['name_en', 'name_ar'])
  ]),
  flows: Object.freeze([
    Object.freeze(['process_id']),
    Object.freeze(['source_step_id']),
    Object.freeze(['target_step_id'])
  ]),
  glossary: Object.freeze([Object.freeze(['english']), Object.freeze(['arabic'])])
} satisfies Readonly<Record<CanonicalSheet, readonly (readonly string[])[]>>)

/**
 * Flattened compatibility view used by official-template checks and mapping
 * field decoration. Required-field enforcement should use the grouped view.
 */
export const REQUIRED_FIELDS_BY_SHEET: Readonly<Record<CanonicalSheet, readonly string[]>> =
  Object.freeze({
    processes: Object.freeze(REQUIRED_FIELD_GROUPS_BY_SHEET.processes.flat()),
    participants: Object.freeze(REQUIRED_FIELD_GROUPS_BY_SHEET.participants.flat()),
    steps: Object.freeze(REQUIRED_FIELD_GROUPS_BY_SHEET.steps.flat()),
    flows: Object.freeze(REQUIRED_FIELD_GROUPS_BY_SHEET.flows.flat()),
    glossary: Object.freeze(REQUIRED_FIELD_GROUPS_BY_SHEET.glossary.flat())
  })

export function requiredFieldGroupForSheet(
  sheet: CanonicalSheet,
  field: string
): readonly string[] | undefined {
  return REQUIRED_FIELD_GROUPS_BY_SHEET[sheet].find((group) => group.includes(field))
}

type AliasCatalog = Readonly<Record<string, readonly string[]>>

const COMMON_ALIASES: AliasCatalog = {
  process_id: [
    'process id',
    'process identifier',
    'workflow id',
    'process code',
    'معرف العملية',
    'معرّف العملية',
    'رمز العملية',
    'رقم العملية'
  ],
  name_en: [
    'name en',
    'english name',
    'name english',
    'step name en',
    'process name en',
    'الاسم بالانجليزية',
    'الاسم الإنجليزي',
    'اسم الخطوة بالانجليزية',
    'اسم العملية بالانجليزية'
  ],
  name_ar: [
    'name ar',
    'arabic name',
    'name arabic',
    'step name ar',
    'process name ar',
    'الاسم بالعربية',
    'الاسم العربي',
    'اسم الخطوة بالعربية',
    'اسم العملية بالعربية'
  ],
  description_en: ['description en', 'english description', 'الوصف بالانجليزية', 'الوصف الإنجليزي'],
  description_ar: ['description ar', 'arabic description', 'الوصف بالعربية', 'الوصف العربي'],
  owner_en: ['owner en', 'english owner', 'process owner en', 'المالك بالانجليزية'],
  owner_ar: ['owner ar', 'arabic owner', 'process owner ar', 'المالك بالعربية'],
  folder: ['folder', 'destination folder', 'path', 'المجلد', 'مجلد الوجهة', 'المسار'],
  active_language: ['active language', 'language', 'locale', 'اللغة النشطة', 'اللغة'],
  participant_id: ['participant id', 'pool lane id', 'معرف المشارك', 'معرف المسار', 'رمز المشارك'],
  type: [
    'type',
    'step type',
    'activity type',
    'participant type',
    'النوع',
    'نوع الخطوة',
    'نوع النشاط'
  ],
  parent_id: ['parent id', 'parent lane', 'معرف الاصل', 'معرف الأصل', 'المسار الاب', 'المسار الأب'],
  order: [
    'order',
    'sequence',
    'sequence number',
    'step number',
    'الترتيب',
    'التسلسل',
    'رقم الخطوة'
  ],
  step_id: ['step id', 'activity id', 'node id', 'معرف الخطوة', 'معرف النشاط', 'رمز الخطوة'],
  pool_id: ['pool id', 'pool', 'معرف الحوض', 'الحوض'],
  lane_id: ['lane id', 'lane', 'swimlane', 'معرف المسار', 'المسار'],
  participant_id_step: ['participant id', 'participant', 'معرف المشارك', 'المشارك'],
  raci: ['raci', 'responsibility code', 'مصفوفة raci', 'رمز المسؤولية'],
  responsible_parties_en: [
    'responsible parties en',
    'responsible en',
    'الأطراف المسؤولة بالانجليزية'
  ],
  responsible_parties_ar: ['responsible parties ar', 'responsible ar', 'الأطراف المسؤولة بالعربية'],
  channel_en: ['channel en', 'english channel', 'القناة بالانجليزية'],
  channel_ar: ['channel ar', 'arabic channel', 'القناة بالعربية'],
  channel_detail_en: ['channel detail en', 'english channel detail', 'تفاصيل القناة بالانجليزية'],
  channel_detail_ar: ['channel detail ar', 'arabic channel detail', 'تفاصيل القناة بالعربية'],
  inputs_en: ['inputs en', 'english inputs', 'المدخلات بالانجليزية'],
  inputs_ar: ['inputs ar', 'arabic inputs', 'المدخلات بالعربية'],
  outputs_en: ['outputs en', 'english outputs', 'المخرجات بالانجليزية'],
  outputs_ar: ['outputs ar', 'arabic outputs', 'المخرجات بالعربية'],
  cc_en: ['cc en', 'copy recipients en', 'نسخة الى بالانجليزية', 'نسخة إلى بالانجليزية'],
  cc_ar: ['cc ar', 'copy recipients ar', 'نسخة الى بالعربية', 'نسخة إلى بالعربية'],
  decision_basis_en: ['decision basis en', 'decision criteria en', 'اساس القرار بالانجليزية'],
  decision_basis_ar: ['decision basis ar', 'decision criteria ar', 'اساس القرار بالعربية'],
  triggers_en: ['triggers en', 'trigger en', 'المحفزات بالانجليزية'],
  triggers_ar: ['triggers ar', 'trigger ar', 'المحفزات بالعربية'],
  called_process_id: [
    'called process id',
    'linked process id',
    'معرف العملية المستدعاة',
    'معرف العملية المرتبطة'
  ],
  event_definition: ['event definition', 'event type', 'تعريف الحدث', 'نوع الحدث'],
  notes_en: ['notes en', 'english notes', 'الملاحظات بالانجليزية'],
  notes_ar: ['notes ar', 'arabic notes', 'الملاحظات بالعربية'],
  next_step_id: ['next step id', 'next id', 'معرف الخطوة التالية'],
  next_step_ids: ['next step ids', 'next ids', 'معرفات الخطوات التالية'],
  flow_id: ['flow id', 'sequence flow id', 'معرف التدفق', 'رمز التدفق'],
  source_step_id: [
    'source step id',
    'source id',
    'from step id',
    'معرف الخطوة المصدر',
    'من الخطوة'
  ],
  target_step_id: [
    'target step id',
    'target id',
    'to step id',
    'معرف الخطوة الهدف',
    'الى الخطوة',
    'إلى الخطوة'
  ],
  condition_en: ['condition en', 'english condition', 'الشرط بالانجليزية'],
  condition_ar: ['condition ar', 'arabic condition', 'الشرط بالعربية'],
  is_default: ['is default', 'default flow', 'default', 'افتراضي', 'هو الافتراضي'],
  english: ['english', 'english term', 'term en', 'الانجليزية', 'المصطلح الانجليزي'],
  arabic: ['arabic', 'arabic term', 'term ar', 'العربية', 'المصطلح العربي'],
  do_not_translate: ['do not translate', 'keep unchanged', 'لا تترجم', 'عدم الترجمة'],
  case_sensitive: ['case sensitive', 'match case', 'حساس لحالة الاحرف']
}

/** Arabic normalization is for header matching only; displayed data is untouched. */
export function normalizeHeader(header: string): string {
  return header
    .replace(/^\ufeff/, '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function aliasesForField(field: string): readonly string[] {
  const aliases = COMMON_ALIASES[field === 'participant_id' ? 'participant_id' : field] ?? []
  return Object.freeze([field, field.replaceAll('_', ' '), ...aliases])
}

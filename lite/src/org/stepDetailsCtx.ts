// lite/src/org/stepDetailsCtx.ts — derives the Step-details context (mode +
// initial values) LIVE from a tab modeler's current selection. Extracted from
// App.tsx's inline `stepDetailsCtx` memo so the right-pane DetailsCard can
// reuse the exact same derivation; App swaps its memo body for
// `deriveStepDetailsCtx` in the integration wave.
//
// One addition over the original memo body — NAME SEEDING: the ACTIVE diagram
// language's EMPTY name field is pre-filled from the visible `name` (element
// mode: the selected shape's label; process mode: the process root's name).
// Only the active side is seeded: the visible name IS that language's text
// (the langToggle self-healing rule), while seeding the OTHER side would
// store wrong-language text and hide the element from
// `collectMissingTranslations` forever. A STORED attribute is never
// overwritten — seeding only fills a blank field, so a hand-edited canvas
// label finally shows up when the dialog opens instead of waiting for a
// language toggle to self-heal it into the attrs.

import {
  getDiagramLang,
  pickRootBusinessObject,
  type LangToggleModeler
} from '../editor/langToggle'
import {
  getLinkedNote,
  getOrgProps,
  getProcessDocumentation,
  getProcessOrgProps,
  type OrgElementLike,
  type OrgModeler,
  type OrgProps
} from './orgModel'
import type { StepDetailsValues } from './StepDetailsDialog'

/** A single selectable flow node (not a label, connection, or the process/
 *  collaboration root) — decides between element mode (exactly one flow node
 *  selected) and process mode. */
export function isFlowNodeElement(el: OrgElementLike | undefined | null): el is OrgElementLike {
  if (!el) return false
  const type = el.type
  if (typeof type !== 'string' || !type.startsWith('bpmn:')) return false
  if (el.waypoints != null || el.labelTarget != null) return false
  return type !== 'bpmn:Process' && type !== 'bpmn:Collaboration'
}

/** The modeler surface the Step-details derivation needs: the org read/write
 *  helpers (OrgModeler) plus the selection service, with a generic fallback
 *  for any other service (eventBus etc. — used by DetailsCard's live
 *  subscription). Callers hand in their real bpmn-js Modeler as-is. */
export type StepDetailsModeler = OrgModeler & {
  get(service: 'selection'): { get(): OrgElementLike[]; select?(el: unknown): void }
  get(service: string): unknown
}

export interface StepDetailsCtx {
  mode: 'element' | 'process'
  /** bpmn:* type of the selected element (element mode only). */
  elementType?: string
  initial: StepDetailsValues
  /** The selected flow node (element mode only). */
  element?: OrgElementLike
  modeler: StepDetailsModeler
}

/** The visible `name` off a business object, or '' when unset / not a string.
 *  Typed against the loose index-signature shape both orgModel's and
 *  langToggle's business objects satisfy. */
function readVisibleName(bo: Record<string, unknown> | undefined): string {
  const value = bo?.name
  return typeof value === 'string' ? value : ''
}

/** Seed the ACTIVE language's EMPTY name field from the visible name (see the
 *  module doc for why only the active side, and why stored values win). */
function seedActiveName(
  initial: StepDetailsValues,
  diagLang: 'en' | 'ar',
  visible: string
): void {
  if (!visible.trim()) return
  if (diagLang === 'en' && initial.nameEn === '') initial.nameEn = visible
  if (diagLang === 'ar' && initial.nameAr === '') initial.nameAr = visible
}

/**
 * Derive the dialog's mode + initial values from the modeler's CURRENT
 * selection. Exactly one selected flow node → element mode (its org props +
 * linked note + type); anything else → process mode (process org props +
 * documentation + the first start event's trigger). Purely a read — never
 * writes to the diagram.
 */
export function deriveStepDetailsCtx(modeler: StepDetailsModeler): StepDetailsCtx {
  let selection: OrgElementLike[] = []
  try {
    selection = modeler.get('selection').get()
  } catch {
    selection = []
  }
  const diagLang = getDiagramLang(modeler as unknown as LangToggleModeler)
  const single = selection.length === 1 ? selection[0] : undefined
  if (isFlowNodeElement(single)) {
    const org = getOrgProps(single)
    const note = getLinkedNote(modeler, single)?.text ?? ''
    const initial: StepDetailsValues = {
      owner: org.owner ?? '',
      ownerType: org.ownerType ?? '',
      ownerRole: org.ownerRole ?? '',
      note,
      channel: org.channel ?? '',
      channelDetail: org.channelDetail ?? '',
      cc: org.kind === 'cc',
      ccTo: org.ccTo ?? '',
      trigger: org.trigger ?? '',
      triggerService: org.triggerService ?? '',
      triggerDetail: org.triggerDetail ?? '',
      nameEn: org.nameEn ?? '',
      nameAr: org.nameAr ?? '',
      inputs: org.inputs ?? '',
      outputs: org.outputs ?? '',
      system: org.system ?? '',
      respList: org.respList ?? '',
      ccList: org.ccList ?? '',
      decisionBasis: org.decisionBasis ?? ''
    }
    seedActiveName(initial, diagLang, readVisibleName(single.businessObject))
    return { mode: 'element', elementType: single.type, initial, element: single, modeler }
  }
  const proc = getProcessOrgProps(modeler)
  const startEvent = modeler
    .get('elementRegistry')
    .getAll()
    .find((el) => el.type === 'bpmn:StartEvent')
  const startProps: OrgProps = startEvent ? getOrgProps(startEvent) : {}
  const initial: StepDetailsValues = {
    owner: proc.owner ?? '',
    ownerType: proc.ownerType ?? '',
    ownerRole: proc.ownerRole ?? '',
    note: getProcessDocumentation(modeler),
    channel: '',
    channelDetail: '',
    cc: false,
    ccTo: '',
    trigger: startProps.trigger ?? '',
    triggerService: startProps.triggerService ?? '',
    triggerDetail: startProps.triggerDetail ?? '',
    // Process mode edits only the bilingual names; the per-step data fields
    // stay blank (the dialog hides them in this mode).
    nameEn: proc.nameEn ?? '',
    nameAr: proc.nameAr ?? '',
    inputs: '',
    outputs: '',
    system: '',
    respList: '',
    ccList: '',
    decisionBasis: ''
  }
  seedActiveName(
    initial,
    diagLang,
    readVisibleName(pickRootBusinessObject(modeler as unknown as LangToggleModeler))
  )
  return { mode: 'process', elementType: undefined, initial, element: undefined, modeler }
}

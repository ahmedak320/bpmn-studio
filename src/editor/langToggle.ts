// Diagram-language toggle: flips every element's VISIBLE label between the
// diagram's stored English and Arabic translations, which a parallel lane
// writes onto each element's businessObject as `orbitpm:nameEn` /
// `orbitpm:nameAr` (moddle-registered attrs — same `extends: ['bpmn:BaseElement']`
// mechanism as the `orbitpm:owner` family in org/orbitpmModdle.ts, so every
// flow node, connection, text annotation, and the process itself can carry
// them). TextAnnotation uses BPMN's `text` property; all other named elements
// use `name`. This module
// only READS/WRITES those attrs through the modeler's own services; it never
// touches the moddle descriptor itself.
//
// Design: "self-healing write-back". There is no separate source-of-truth
// field the user edits — they just type into a shape's label like normal, and
// whatever is on screen IS the current language's text. So before this module
// ever overwrites a visible `name` with the OTHER language's stored
// translation, it first captures whatever is CURRENTLY visible into the
// CURRENT language's stored attribute (if it looks hand-edited, i.e. it
// differs from what's already stored). That single rule is what makes a
// manual edit made while a language is active survive a round trip through
// the other language and back — see resolveElementNames below — and what
// makes the very first toggle on a diagram that has plain (non-bilingual)
// names "just work": it silently adopts the current names as that language's
// translation instead of requiring a separate migration step. A translation
// that was never stored is never invented — the visible name is left exactly
// as it is and counted as `missing`, so the caller can prompt the user
// (AI translate / ARIS import / manual entry via Details) instead of
// blanking a label.
//
// Kept dependency-free (no bpmn-js import) and typed against a minimal
// STRUCTURAL modeler shape so the whole thing is unit-testable with plain
// object fakes in the node vitest environment — see
// src/__tests__/langToggle.test.ts.

import { executeModelingBatch, type ModelingBatchUpdate } from './modelingBatch'
import {
  applyDiagramLocalizationReview,
  inspectDiagramLocalization,
  type DiagramLocalizationReview
} from '../localization/modelerAdapter'
import {
  LocalizationSource,
  type LocalizationSource as LocalizationSourceType
} from '../localization/types'

export type DiagramLang = 'en' | 'ar'

export interface ToggleResult {
  /** Elements for which a target-language label could be displayed. */
  switched: number
  /** Elements displayed with an opposite-language fallback. */
  missing: number
  /** The language requested by the caller. */
  to: DiagramLang
  /** The language actually recorded as active after projection/repair. */
  active: DiagramLang
}

/** The modeler surface this module needs. Deliberately a single generic
 *  overload (not one `get()` signature per service name, contrast
 *  org/orgModel.ts's `OrgModeler`) — callers hand in their real bpmn-js
 *  Modeler as-is; tests hand in a tiny fake with the same shape. */
export interface LangToggleModeler {
  get(name: string): unknown
  getDefinitions?: () => unknown
}

// --- structural service/element shapes --------------------------------------

/** Structural business-object surface this module reads/writes. Exported so
 *  editor/labelSync.ts (and tests) can type against the same shape. */
export interface LangBusinessObjectLike {
  $type?: string
  $attrs?: Record<string, unknown>
  name?: string
  text?: string
  get?: (name: string) => unknown
  [key: string]: unknown
}

/** A registry element (shape, connection, or the canvas root) as seen through
 *  `elementRegistry.getAll()` / `canvas.getRootElement()`. */
interface LangElementLike {
  businessObject?: LangBusinessObjectLike
  /** Present (truthy) on label shapes — bpmn-js gives an external label its
   *  own registry entry that SHARES its target's business object, so
   *  processing labels too would double-count and double-write every name;
   *  skipped unconditionally wherever this is checked below. */
  labelTarget?: unknown
}

interface CanvasLike {
  getRootElement(): LangElementLike | undefined
}

interface ElementRegistryLike {
  getAll(): LangElementLike[]
}

// --- attribute names ---------------------------------------------------------

const ATTR_NAME_EN = 'orbitpm:nameEn'
const ATTR_NAME_AR = 'orbitpm:nameAr'
const ATTR_ACTIVE_LANG = 'orbitpm:activeLang'

/** Stored-translation attribute that holds a given language's text. */
const LANG_ATTR: Record<DiagramLang, string> = {
  en: ATTR_NAME_EN,
  ar: ATTR_NAME_AR
}

function otherLang(lang: DiagramLang): DiagramLang {
  return lang === 'en' ? 'ar' : 'en'
}

// --- dual-world attribute reading -------------------------------------------
// Same two worlds org/orgModel.ts's private readers support: a registered
// moddle extension exposes values via `bo.get('orbitpm:nameEn')`; without the
// extension (or for plain BPMN properties like `name`) the value sits directly
// on the object / in `$attrs`. Duplicated here rather than imported —
// orgModel.ts doesn't export these, and the repo's convention for small pure
// readers like this is a local copy per module (see e.g. `decodeXmlEntities`,
// repeated verbatim in org/orgModel.ts and links/linkOps.ts).

/** Read a plain (non-prefixed) moddle property such as `name` or `participants`. */
function readModdleProp(bo: LangBusinessObjectLike | undefined, name: string): unknown {
  if (!bo) return undefined
  if (typeof bo.get === 'function') {
    try {
      const value = bo.get(name)
      if (value !== undefined) return value
    } catch {
      /* fall through to a direct property read */
    }
  }
  return bo[name]
}

function readNonBlank(value: unknown): string | undefined {
  if (value == null) return undefined
  const text = String(value).trim()
  return text === '' ? undefined : text
}

/** Read one `orbitpm:*` attribute. Blank strings count as absent. */
function readAttr(bo: LangBusinessObjectLike | undefined, name: string): string | undefined {
  if (!bo) return undefined
  if (typeof bo.get === 'function') {
    try {
      const value = readNonBlank(bo.get(name))
      if (value !== undefined) return value
    } catch {
      /* fall through to $attrs */
    }
  }
  return readNonBlank(bo.$attrs?.[name]) ?? readNonBlank(bo[name])
}

/** BPMN TextAnnotation stores its visible label in `text`; ordinary named
 * elements use `name`. Localization attributes stay uniform on BaseElement. */
export function visibleLabelProperty(bo: LangBusinessObjectLike | undefined): 'name' | 'text' {
  return bo?.$type === 'bpmn:TextAnnotation' ? 'text' : 'name'
}

/** The element's current visible label, or '' if unset/not a string. */
export function readVisibleLabel(bo: LangBusinessObjectLike | undefined): string {
  const value = readModdleProp(bo, visibleLabelProperty(bo))
  return typeof value === 'string' ? value : ''
}

/** Arabic blocks plus presentation forms seen in imported BPMN. Mixed
 * Arabic/Latin/numeric labels count as Arabic. */
function hasArabicScript(value: string): boolean {
  return /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/.test(value)
}

/**
 * Whether a visible label is safe to adopt as `lang`.
 *
 * The opposite stored value is stronger evidence than stale active-language
 * metadata. Script compatibility then prevents an English fallback from ever
 * being seeded as Arabic (and vice versa).
 */
function canCaptureVisible(
  bo: LangBusinessObjectLike,
  lang: DiagramLang,
  visibleLabel: string
): boolean {
  const visible = visibleLabel.trim()
  if (visible === '') return false

  const opposite = readAttr(bo, LANG_ATTR[otherLang(lang)])
  if (opposite !== undefined && visible === opposite) return false

  return lang === 'ar' ? hasArabicScript(visible) : !hasArabicScript(visible)
}

// --- root resolution ---------------------------------------------------------

/**
 * Resolve the business object that carries the diagram-level
 * `orbitpm:activeLang` flag: the canvas root's own business object when it is
 * a `bpmn:Process`, or — for a collaboration (pool) diagram, where the canvas
 * root is the Collaboration and the Process itself has no shape on the
 * canvas — the first participant's referenced process. Mirrors
 * org/orgModel.ts's `getProcessElement` fallback so a pool-based diagram and a
 * bare-process diagram resolve to the same kind of target. Returns undefined
 * only when the canvas has no root at all (nothing imported yet).
 */
export function pickRootBusinessObject(
  modeler: LangToggleModeler
): LangBusinessObjectLike | undefined {
  const canvas = modeler.get('canvas') as CanvasLike
  const root = canvas.getRootElement()
  const bo = root?.businessObject
  if (!bo) return undefined
  if (bo.$type === 'bpmn:Process') return bo
  const participants = readModdleProp(bo, 'participants')
  if (Array.isArray(participants) && participants.length > 0) {
    const processRef = (participants[0] as { processRef?: unknown } | undefined)?.processRef
    if (processRef) return processRef as LangBusinessObjectLike
  }
  return bo
}

/**
 * Read the diagram's current language off the process root, defaulting to
 * 'en' when the attribute is absent (a brand-new diagram, or one saved before
 * this feature existed) or holds anything other than 'ar'.
 */
export function getDiagramLang(modeler: LangToggleModeler): DiagramLang {
  const bo = pickRootBusinessObject(modeler)
  return readAttr(bo, ATTR_ACTIVE_LANG) === 'ar' ? 'ar' : 'en'
}

// --- per-element write resolution (pure) -------------------------------------

/**
 * Pure per-element resolution of the toggle's two-step write. Given an
 * element's business object and the `from` -> `to` language switch, returns
 * ONLY the properties that actually need to change (a key is omitted rather
 * than set to its unchanged value), so a caller can skip the
 * `modeling.updateProperties` call entirely when the result comes back empty.
 *
 *  1. WRITE-BACK — if the current visible `name` is non-empty and differs
 *     from whatever is already stored for `from`, it was hand-edited (or
 *     never captured) while `from` was active: stash it into the `from`
 *     attribute before anything below can overwrite it. This is what makes a
 *     manual edit survive a round trip through the other language and back —
 *     see the module doc comment.
 *  2. SWITCH — if a `to`-language translation is stored, write it to `name`.
 *     Otherwise `name` is left out of the result entirely: never blank a
 *     label just because a translation hasn't been created yet.
 */
export function resolveElementNames(
  bo: LangBusinessObjectLike,
  from: DiagramLang,
  to: DiagramLang
): Record<string, string> {
  const properties: Record<string, string> = {}
  const labelProperty = visibleLabelProperty(bo)
  const name = readVisibleLabel(bo).trim()
  const toAttr = readAttr(bo, LANG_ATTR[to])

  if (toAttr !== undefined) {
    // During a real language change, preserve a compatible edit made in the
    // previously active language. During idempotent projection, the stored
    // target is authoritative: this is what repairs stale visible English
    // without replacing generated Arabic.
    if (from !== to) {
      const fromAttr = readAttr(bo, LANG_ATTR[from])
      if (name !== fromAttr && canCaptureVisible(bo, from, name)) {
        properties[LANG_ATTR[from]] = name
      }
    }
    if (name !== toAttr) properties[labelProperty] = toAttr
    return properties
  }

  // A missing target may be safely adopted from the visible label only with
  // positive language evidence. In particular, Latin-only text is never
  // invented as Arabic.
  if (canCaptureVisible(bo, to, name)) {
    properties[LANG_ATTR[to]] = name
    return properties
  }

  // Keep/repair an opposite-language fallback. This also self-heals a plain
  // English diagram on its first failed request for Arabic.
  const fallback = otherLang(to)
  const fallbackAttr = readAttr(bo, LANG_ATTR[fallback])
  if (canCaptureVisible(bo, fallback, name)) {
    if (name !== fallbackAttr) properties[LANG_ATTR[fallback]] = name
  } else if (fallbackAttr !== undefined && name !== fallbackAttr) {
    properties[labelProperty] = fallbackAttr
  }

  return properties
}

/**
 * Mirror the CURRENT visible name into the ACTIVE language's stored attr —
 * same "visible name wins, empty never clears" rule as resolveElementNames
 * step 1 (the write-back), applied continuously after a direct label edit
 * instead of only at toggle time. Returns {} when nothing needs writing:
 * the name already matches the stored attr, or the name is empty (a stored
 * translation is deliberately preserved — clearing a label must never erase
 * the translation behind it).
 */
export function resolveLabelMirror(
  bo: LangBusinessObjectLike,
  active: DiagramLang
): Record<string, string> {
  const properties: Record<string, string> = {}
  const name = readVisibleLabel(bo).trim()
  const stored = readAttr(bo, LANG_ATTR[active])
  if (name !== stored && canCaptureVisible(bo, active, name)) {
    properties[LANG_ATTR[active]] = name
  }
  return properties
}

// --- projection and toggle ---------------------------------------------------

/**
 * Project `to` onto the whole diagram, even when it is already recorded as
 * active. Re-projecting repairs stale visible labels from their stored target
 * attributes.
 *
 * The root flag advances to `to` only when at least one target label can be
 * displayed. With zero target coverage it stays on, or is repaired to, the
 * language of the visible fallbacks.
 *
 * Every write goes through `modeling.updateProperties`, so the whole
 * operation lands on the command stack (undoable, marks the diagram dirty)
 * exactly like any hand-made edit.
 */
export function setDiagramLang(modeler: LangToggleModeler, to: DiagramLang): ToggleResult {
  const from = getDiagramLang(modeler)

  // Real bpmn-js modelers expose the complete definitions graph. Route those
  // through the structural core so names, conditions, annotations, notes, and
  // paired detail metadata are audited together. An incomplete/wrong-script
  // target performs no writes and must be resolved by the explicit review UI.
  if (typeof modeler.getDefinitions === 'function') {
    const review = prepareDiagramLanguageReview(modeler, to)
    const visible = review.fields.filter(
      (field) => field.kind === 'name' || field.kind === 'condition' || field.kind === 'annotation'
    )
    const blockedKeys = new Set(
      review.blockers.map(
        (issue) => `${issue.processId}\u0000${issue.elementId}\u0000${issue.field}`
      )
    )
    const switched = visible.filter(
      (field) => !blockedKeys.has(`${field.processId}\u0000${field.elementId}\u0000${field.field}`)
    ).length
    const missing = visible.length - switched
    if (!review.complete) return { switched, missing, to, active: from }

    const applied = applyDiagramLocalizationReview(modeler, review)
    if (!applied.complete) {
      // The adapter post-audits and rolls its single command-stack batch back
      // when a real modeler fails to persist/project the validated patches.
      return { switched: 0, missing: visible.length, to, active: getDiagramLang(modeler) }
    }
    return { switched, missing: 0, to, active: getDiagramLang(modeler) }
  }

  const elementRegistry = modeler.get('elementRegistry') as ElementRegistryLike
  let switched = 0
  let missing = 0
  let fallbackDisplayable = 0
  const updates: ModelingBatchUpdate[] = []

  for (const element of elementRegistry.getAll()) {
    if (element.labelTarget != null) continue

    const bo = element.businessObject
    if (!bo) continue

    // Only elements localization actually touches: something visible right
    // now, or a translation stored for either language. An element with none
    // of the three (e.g. an untitled gateway) is left alone and not counted.
    const visibleName = readVisibleLabel(bo).trim()
    const hasName = visibleName !== ''
    const hasEnTranslation = Boolean(readAttr(bo, LANG_ATTR.en))
    const hasArTranslation = Boolean(readAttr(bo, LANG_ATTR.ar))
    const hasToTranslation = Boolean(readAttr(bo, LANG_ATTR[to]))
    if (!hasName && !hasEnTranslation && !hasArTranslation) continue

    const canAdoptTarget = !hasToTranslation && canCaptureVisible(bo, to, visibleName)
    if (hasToTranslation || canAdoptTarget) {
      switched++
    } else {
      missing++
      const fallback = otherLang(to)
      if (
        readAttr(bo, LANG_ATTR[fallback]) !== undefined ||
        canCaptureVisible(bo, fallback, visibleName)
      ) {
        fallbackDisplayable++
      }
    }

    const properties = resolveElementNames(bo, from, to)
    if (Object.keys(properties).length > 0) {
      updates.push({ kind: 'properties', element, properties })
    }
  }

  // A successful target projection wins. With zero target coverage, repair a
  // stale flag to the language actually represented by visible fallbacks.
  const desiredActive = switched > 0 ? to : fallbackDisplayable > 0 ? otherLang(to) : from
  const canvas = modeler.get('canvas') as CanvasLike
  const root = canvas.getRootElement()
  const rootBo = pickRootBusinessObject(modeler)
  let active = from
  if (rootBo && desiredActive !== from) {
    // The common case: the canvas root itself IS the process — a real,
    // registered diagram element — so pass it through untouched. In a
    // collaboration (pool) diagram `rootBo` is the first participant's
    // `processRef`, which has no shape of its own on the canvas; bpmn-js's
    // UpdatePropertiesHandler reads `element.businessObject` directly with no
    // fallback (see node_modules/bpmn-js/lib/features/modeling/cmd/
    // UpdatePropertiesHandler.js — both `setProperties` and `getProperties`
    // do `element.businessObject`, not the `getBusinessObject()` util that
    // treats a bare business object as its own element), so a bare process
    // object is wrapped rather than handed over unwrapped.
    const target: unknown =
      root && root.businessObject === rootBo ? root : { businessObject: rootBo }
    updates.push({
      kind: 'properties',
      element: target,
      properties: { [ATTR_ACTIVE_LANG]: desiredActive }
    })
    active = desiredActive
  }

  executeModelingBatch(modeler, updates)
  return { switched, missing, to, active }
}

/** Toggle wrapper retained for the toolbar. */
export function toggleDiagramLang(modeler: LangToggleModeler): ToggleResult {
  return setDiagramLang(modeler, otherLang(getDiagramLang(modeler)))
}

/**
 * Read-only review used by toolbar toggle and Translate. Creating it performs
 * glossary/TM planning locally, but never mutates the diagram or contacts a
 * provider.
 */
export function prepareDiagramLanguageReview(
  modeler: LangToggleModeler,
  to: DiagramLang,
  source: LocalizationSourceType = LocalizationSource.Editor
): DiagramLocalizationReview {
  return inspectDiagramLocalization(modeler, to, { source })
}

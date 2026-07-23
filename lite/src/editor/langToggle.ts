// Diagram-language toggle: flips every element's VISIBLE `name` between the
// diagram's stored English and Arabic translations, which a parallel lane
// writes onto each element's businessObject as `orbitpm:nameEn` /
// `orbitpm:nameAr` (moddle-registered attrs — same `extends: ['bpmn:BaseElement']`
// mechanism as the `orbitpm:owner` family in org/orbitpmModdle.ts, so every
// flow node, connection, and the process itself can carry them). This module
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

export type DiagramLang = 'en' | 'ar'

export interface ToggleResult {
  /** Elements whose visible name was switched to a stored `to`-language translation. */
  switched: number
  /** Elements left untouched because no `to`-language translation was stored (name kept as-is). */
  missing: number
  /** The language the diagram shows now (the one just toggled TO). */
  to: DiagramLang
}

/** The modeler surface this module needs. Deliberately a single generic
 *  overload (not one `get()` signature per service name, contrast
 *  org/orgModel.ts's `OrgModeler`) — callers hand in their real bpmn-js
 *  Modeler as-is; tests hand in a tiny fake with the same shape. */
export interface LangToggleModeler {
  get(name: string): unknown
}

// --- structural service/element shapes (internal wiring only) --------------

interface BusinessObjectLike {
  $type?: string
  $attrs?: Record<string, unknown>
  name?: string
  get?: (name: string) => unknown
  [key: string]: unknown
}

/** A registry element (shape, connection, or the canvas root) as seen through
 *  `elementRegistry.getAll()` / `canvas.getRootElement()`. */
interface LangElementLike {
  businessObject?: BusinessObjectLike
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

interface ModelingLike {
  updateProperties(element: unknown, properties: Record<string, unknown>): void
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
function readModdleProp(bo: BusinessObjectLike | undefined, name: string): unknown {
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

/** Read one `orbitpm:*` attribute. Empty string counts as absent, same as
 *  org/orgModel.ts's `readAttr`. */
function readAttr(bo: BusinessObjectLike | undefined, name: string): string | undefined {
  if (!bo) return undefined
  if (typeof bo.get === 'function') {
    try {
      const value = bo.get(name)
      if (value != null && value !== '') return String(value)
    } catch {
      /* fall through to $attrs */
    }
  }
  const raw = bo.$attrs?.[name]
  if (raw != null && raw !== '') return String(raw)
  return undefined
}

/** The element's current visible name, or '' if unset/not a string. */
function readName(bo: BusinessObjectLike | undefined): string {
  const value = readModdleProp(bo, 'name')
  return typeof value === 'string' ? value : ''
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
export function pickRootBusinessObject(modeler: LangToggleModeler): BusinessObjectLike | undefined {
  const canvas = modeler.get('canvas') as CanvasLike
  const root = canvas.getRootElement()
  const bo = root?.businessObject
  if (!bo) return undefined
  if (bo.$type === 'bpmn:Process') return bo
  const participants = readModdleProp(bo, 'participants')
  if (Array.isArray(participants) && participants.length > 0) {
    const processRef = (participants[0] as { processRef?: unknown } | undefined)?.processRef
    if (processRef) return processRef as BusinessObjectLike
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
  bo: BusinessObjectLike,
  from: DiagramLang,
  to: DiagramLang
): Record<string, string> {
  const properties: Record<string, string> = {}
  const name = readName(bo)

  const fromAttr = readAttr(bo, LANG_ATTR[from])
  if (name && name !== fromAttr) {
    properties[LANG_ATTR[from]] = name
  }

  const toAttr = readAttr(bo, LANG_ATTR[to])
  if (toAttr) {
    properties.name = toAttr
  }

  return properties
}

// --- the toggle --------------------------------------------------------------

/**
 * Switch the whole diagram to the other language.
 *
 * Every shape and connection that has a visible name or a stored translation
 * in either language gets resolveElementNames' write-back + switch applied;
 * labels are skipped (they ride along with the shape/connection they
 * annotate — see LangElementLike). `orbitpm:activeLang` is then flipped on
 * the process root UNCONDITIONALLY, even when nothing above had a
 * translation to apply, so the toolbar always reflects the language the user
 * just asked for — `missing` is how the caller learns whether that request
 * actually had anything to show.
 *
 * Every write goes through `modeling.updateProperties`, so the whole
 * operation lands on the command stack (undoable, marks the diagram dirty)
 * exactly like any hand-made edit.
 */
export function toggleDiagramLang(modeler: LangToggleModeler): ToggleResult {
  const from = getDiagramLang(modeler)
  const to = otherLang(from)

  const elementRegistry = modeler.get('elementRegistry') as ElementRegistryLike
  const modeling = modeler.get('modeling') as ModelingLike

  let switched = 0
  let missing = 0

  for (const element of elementRegistry.getAll()) {
    if (element.labelTarget != null) continue

    const bo = element.businessObject
    if (!bo) continue

    // Only elements localization actually touches: something visible right
    // now, or a translation stored for either language. An element with none
    // of the three (e.g. an untitled gateway) is left alone and not counted.
    const hasName = Boolean(readName(bo))
    const hasFromTranslation = Boolean(readAttr(bo, LANG_ATTR[from]))
    const hasToTranslation = Boolean(readAttr(bo, LANG_ATTR[to]))
    if (!hasName && !hasFromTranslation && !hasToTranslation) continue

    if (hasToTranslation) switched++
    else missing++

    const properties = resolveElementNames(bo, from, to)
    if (Object.keys(properties).length > 0) {
      modeling.updateProperties(element, properties)
    }
  }

  // Flip the diagram-level flag regardless of what the loop above found.
  const canvas = modeler.get('canvas') as CanvasLike
  const root = canvas.getRootElement()
  const rootBo = pickRootBusinessObject(modeler)
  if (rootBo) {
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
    const target: unknown = root && root.businessObject === rootBo ? root : { businessObject: rootBo }
    modeling.updateProperties(target, { [ATTR_ACTIVE_LANG]: to })
  }

  return { switched, missing, to }
}

// The "show org-pack styling" and "highlight missing step information"
// preferences (browser-local flags) plus the live re-render helper. Storage is
// wrapped in try/catch exactly like lite/src/ai/keys.ts — a browser page has no
// vault and localStorage can throw in private-mode / disabled-storage, in which
// case both flags default to ON.

const KEY = 'orbitpm.lite.orgStyling'
const COMPLETENESS_KEY = 'orbitpm.lite.completenessOn'

export interface RefreshElement {
  type?: string
  waypoints?: unknown
}

export interface ElementRegistryLike {
  getAll(): RefreshElement[]
  getGraphics(element: RefreshElement): unknown
}

export interface GraphicsFactoryLike {
  update(type: 'shape' | 'connection', element: RefreshElement, gfx: unknown): void
}

interface RefreshModeler {
  get(service: 'elementRegistry'): ElementRegistryLike
  get(service: 'graphicsFactory'): GraphicsFactoryLike
}

/** Org styling is ON by default: unset, or any storage failure, reads as true. */
export function isOrgStylingOn(): boolean {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw == null) return true
    return raw !== 'false' && raw !== '0'
  } catch {
    return true
  }
}

export function setOrgStyling(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'true' : 'false')
  } catch {
    /* ignore — private mode / disabled storage */
  }
}

/** Completeness highlighting is ON by default: unset, or any storage failure,
 *  reads as true. Consulted live on every draw (like isOrgStylingOn) so a
 *  toggle + refreshOrgStyling sweep repaints without a reload. */
export function isCompletenessOn(): boolean {
  try {
    const raw = localStorage.getItem(COMPLETENESS_KEY)
    if (raw == null) return true
    return raw !== 'false' && raw !== '0'
  } catch {
    return true
  }
}

export function setCompletenessOn(on: boolean): void {
  try {
    localStorage.setItem(COMPLETENESS_KEY, on ? 'true' : 'false')
  } catch {
    /* ignore — private mode / disabled storage */
  }
}

/**
 * Force every shape's graphics to be re-drawn so the org renderer re-evaluates
 * against the current flags / orientation. `graphicsFactory.update('shape',
 * …)` re-runs the render pipeline for one element. The root process/collab and
 * connections are skipped; every step is defensively wrapped so a single
 * mis-shaped element can't abort the sweep. Shared by refreshOrgStyling (flag
 * toggles) and OrgDecorSync (orientation flips).
 */
export function refreshAllShapes(
  registry: ElementRegistryLike,
  graphicsFactory: GraphicsFactoryLike
): void {
  let elements: RefreshElement[]
  try {
    elements = registry.getAll()
  } catch {
    return
  }
  for (const el of elements) {
    const type = el.type
    if (el.waypoints) continue
    if (typeof type !== 'string' || !type.startsWith('bpmn:')) continue
    if (type === 'bpmn:Process') continue
    try {
      graphicsFactory.update('shape', el, registry.getGraphics(el))
    } catch {
      /* tolerate the root / label / any element without live graphics */
    }
  }
}

/** Modeler-level wrapper around refreshAllShapes (same behavior as always). */
export function refreshOrgStyling(modeler: RefreshModeler): void {
  let registry: ElementRegistryLike
  let graphicsFactory: GraphicsFactoryLike
  try {
    registry = modeler.get('elementRegistry')
    graphicsFactory = modeler.get('graphicsFactory')
  } catch {
    return
  }
  refreshAllShapes(registry, graphicsFactory)
}

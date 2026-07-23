import { describe, it, expect } from 'vitest'
import {
  getDiagramLang,
  toggleDiagramLang,
  pickRootBusinessObject,
  resolveElementNames,
  type LangToggleModeler
} from '../editor/langToggle'

// langToggle.ts is deliberately bpmn-js-free — this suite runs with
// environment: 'node' (no jsdom, per vitest.config.ts) and drives the module
// entirely through tiny hand-rolled fakes for elementRegistry/modeling/canvas,
// same recorder-fake style as org/__tests__/orgModel.test.ts's `makeModeler`.

// --- fakes -------------------------------------------------------------

interface FakeBusinessObject {
  $type?: string
  name?: string
  $attrs?: Record<string, unknown>
  participants?: Array<{ processRef?: FakeBusinessObject }>
  get?: (name: string) => unknown
  [key: string]: unknown
}

interface FakeElement {
  id: string
  businessObject?: FakeBusinessObject
  labelTarget?: unknown
  waypoints?: unknown
}

interface RecordedUpdate {
  element: unknown
  properties: Record<string, unknown>
}

/**
 * Applies a properties bag onto a fake element's business object the same way
 * real bpmn-js would: `orbitpm:*` keys land in `$attrs` (these fakes model the
 * "extension not registered" world — see langToggle.ts's dual-world readers),
 * everything else (just `name` here) is a direct property. This is a REAL
 * mutation, not just a recorder, so a second `toggleDiagramLang` call in the
 * same test (the round-trip case) observes the first call's effect exactly
 * like a real command stack would.
 */
function applyProperties(element: unknown, properties: Record<string, unknown>): void {
  const bo = (element as { businessObject?: FakeBusinessObject } | undefined)?.businessObject
  if (!bo) return
  for (const [key, value] of Object.entries(properties)) {
    if (key.startsWith('orbitpm:')) {
      bo.$attrs = { ...(bo.$attrs ?? {}), [key]: value as string }
    } else {
      bo[key] = value
    }
  }
}

function makeModeler(opts: { root?: FakeElement; elements?: FakeElement[] }): {
  modeler: LangToggleModeler
  rec: RecordedUpdate[]
} {
  const rec: RecordedUpdate[] = []
  const canvas = { getRootElement: () => opts.root }
  const elementRegistry = { getAll: () => opts.elements ?? [] }
  const modeling = {
    updateProperties(element: unknown, properties: Record<string, unknown>): void {
      rec.push({ element, properties })
      applyProperties(element, properties)
    }
  }
  const modeler: LangToggleModeler = {
    get(name: string): unknown {
      switch (name) {
        case 'canvas':
          return canvas
        case 'elementRegistry':
          return elementRegistry
        case 'modeling':
          return modeling
        default:
          throw new Error('unexpected service ' + name)
      }
    }
  }
  return { modeler, rec }
}

/** A bare (non-collaboration) process root — the common case. */
function processRoot(attrs: Record<string, unknown> = {}): FakeElement {
  return {
    id: 'Process_1',
    businessObject: { $type: 'bpmn:Process', $attrs: { ...attrs } }
  }
}

// --- getDiagramLang / pickRootBusinessObject ----------------------------

describe('getDiagramLang', () => {
  it('defaults to en when orbitpm:activeLang is absent', () => {
    const { modeler } = makeModeler({ root: processRoot() })
    expect(getDiagramLang(modeler)).toBe('en')
  })

  it('defaults to en when there is no canvas root at all', () => {
    const { modeler } = makeModeler({})
    expect(getDiagramLang(modeler)).toBe('en')
  })

  it('defaults to en for an unrecognized stored value', () => {
    const { modeler } = makeModeler({ root: processRoot({ 'orbitpm:activeLang': 'fr' }) })
    expect(getDiagramLang(modeler)).toBe('en')
  })

  it('reads ar when stored', () => {
    const { modeler } = makeModeler({ root: processRoot({ 'orbitpm:activeLang': 'ar' }) })
    expect(getDiagramLang(modeler)).toBe('ar')
  })

  it('follows the first participant processRef in a collaboration (participants-aware fallback)', () => {
    const processRef: FakeBusinessObject = {
      $type: 'bpmn:Process',
      $attrs: { 'orbitpm:activeLang': 'ar' }
    }
    const root: FakeElement = {
      id: 'Collab_1',
      businessObject: { $type: 'bpmn:Collaboration', participants: [{ processRef }] }
    }
    const { modeler } = makeModeler({ root })
    expect(pickRootBusinessObject(modeler)).toBe(processRef)
    expect(getDiagramLang(modeler)).toBe('ar')
  })
})

describe('pickRootBusinessObject', () => {
  it('returns the process business object directly for a plain process root', () => {
    const root = processRoot()
    const { modeler } = makeModeler({ root })
    expect(pickRootBusinessObject(modeler)).toBe(root.businessObject)
  })

  it('returns undefined when the canvas has no root', () => {
    const { modeler } = makeModeler({})
    expect(pickRootBusinessObject(modeler)).toBeUndefined()
  })
})

// --- resolveElementNames (pure) -----------------------------------------

describe('resolveElementNames', () => {
  it('switches only (name already matches the from-attr, to-attr present)', () => {
    const bo = { name: 'Order', $attrs: { 'orbitpm:nameEn': 'Order', 'orbitpm:nameAr': 'طلب' } }
    expect(resolveElementNames(bo, 'en', 'ar')).toEqual({ name: 'طلب' })
  })

  it('writes back only (name differs from the from-attr, no to-attr stored)', () => {
    const bo = { name: 'Reject v2', $attrs: { 'orbitpm:nameEn': 'Reject' } }
    expect(resolveElementNames(bo, 'en', 'ar')).toEqual({ 'orbitpm:nameEn': 'Reject v2' })
  })

  it('combines write-back and switch in one bag when both apply', () => {
    const bo = {
      name: 'Order (edited)',
      $attrs: { 'orbitpm:nameEn': 'Order', 'orbitpm:nameAr': 'طلب' }
    }
    expect(resolveElementNames(bo, 'en', 'ar')).toEqual({
      'orbitpm:nameEn': 'Order (edited)',
      name: 'طلب'
    })
  })

  it('returns an empty bag when there is nothing to change', () => {
    const bo = { name: 'Order', $attrs: { 'orbitpm:nameEn': 'Order' } }
    expect(resolveElementNames(bo, 'en', 'ar')).toEqual({})
  })

  it('self-heals a plain (never-translated) name into the from-attr on first use', () => {
    const bo = { name: 'Plain Name' }
    expect(resolveElementNames(bo, 'en', 'ar')).toEqual({ 'orbitpm:nameEn': 'Plain Name' })
  })

  it('never fires write-back for an empty visible name, even with no from-attr stored', () => {
    const bo = { $attrs: { 'orbitpm:nameAr': 'طلب' } }
    expect(resolveElementNames(bo, 'en', 'ar')).toEqual({ name: 'طلب' })
  })

  it('reads stored translations via businessObject.get() when the moddle extension is registered', () => {
    const values: Record<string, unknown> = {
      name: 'Order',
      'orbitpm:nameEn': 'Order',
      'orbitpm:nameAr': 'طلب'
    }
    const bo = { $type: 'bpmn:Task', get: (key: string) => values[key] }
    expect(resolveElementNames(bo, 'en', 'ar')).toEqual({ name: 'طلب' })
  })
})

// --- toggleDiagramLang ----------------------------------------------------

describe('toggleDiagramLang', () => {
  it('switches every element en -> ar with full translations, and asserts exact call shapes', () => {
    const root = processRoot()
    const elA: FakeElement = {
      id: 'Task_A',
      businessObject: {
        $type: 'bpmn:Task',
        name: 'Order',
        $attrs: { 'orbitpm:nameEn': 'Order', 'orbitpm:nameAr': 'طلب' }
      }
    }
    const elB: FakeElement = {
      id: 'Task_B',
      businessObject: {
        $type: 'bpmn:Task',
        name: 'Approve',
        $attrs: { 'orbitpm:nameEn': 'Approve', 'orbitpm:nameAr': 'موافقة' }
      }
    }
    const { modeler, rec } = makeModeler({ root, elements: [elA, elB] })

    const result = toggleDiagramLang(modeler)

    expect(result).toEqual({ switched: 2, missing: 0, to: 'ar' })
    // Exact call list, in registry-scan order, root write last.
    expect(rec).toEqual([
      { element: elA, properties: { name: 'طلب' } },
      { element: elB, properties: { name: 'موافقة' } },
      { element: root, properties: { 'orbitpm:activeLang': 'ar' } }
    ])
    expect(elA.businessObject?.name).toBe('طلب')
    expect(elB.businessObject?.name).toBe('موافقة')
  })

  it('keeps the visible name and counts as missing when no to-language translation is stored', () => {
    const root = processRoot()
    const el: FakeElement = {
      id: 'Task_C',
      businessObject: { $type: 'bpmn:Task', name: 'Reject', $attrs: { 'orbitpm:nameEn': 'Reject' } }
    }
    const { modeler, rec } = makeModeler({ root, elements: [el] })

    const result = toggleDiagramLang(modeler)

    expect(result).toEqual({ switched: 0, missing: 1, to: 'ar' })
    expect(el.businessObject?.name).toBe('Reject') // untouched — never blanked
    // Nothing needed writing for `el` (name already equals the stored en attr,
    // and there's no ar attr to apply) — only the root's activeLang call fires.
    expect(rec).toEqual([{ element: root, properties: { 'orbitpm:activeLang': 'ar' } }])
  })

  it('write-back-only element (differs from from-attr) still counts as missing when to-attr is absent', () => {
    const root = processRoot()
    const el: FakeElement = {
      id: 'Task_C2',
      businessObject: { $type: 'bpmn:Task', name: 'Reject v2', $attrs: { 'orbitpm:nameEn': 'Reject' } }
    }
    const { modeler, rec } = makeModeler({ root, elements: [el] })

    const result = toggleDiagramLang(modeler)

    expect(result).toEqual({ switched: 0, missing: 1, to: 'ar' })
    expect(el.businessObject?.name).toBe('Reject v2') // kept as-is, never blanked
    expect(rec[0]).toEqual({ element: el, properties: { 'orbitpm:nameEn': 'Reject v2' } })
  })

  it('write-back: a manual edit made while en was active is captured into orbitpm:nameEn before ar is applied', () => {
    const root = processRoot()
    const el: FakeElement = {
      id: 'Task_D',
      businessObject: {
        $type: 'bpmn:Task',
        name: 'Order (edited)', // diverges from the stored en attr below
        $attrs: { 'orbitpm:nameEn': 'Order', 'orbitpm:nameAr': 'طلب' }
      }
    }
    const { modeler, rec } = makeModeler({ root, elements: [el] })

    const result = toggleDiagramLang(modeler)

    expect(result).toEqual({ switched: 1, missing: 0, to: 'ar' })
    expect(rec[0]).toEqual({
      element: el,
      properties: { 'orbitpm:nameEn': 'Order (edited)', name: 'طلب' }
    })
    expect(el.businessObject?.$attrs?.['orbitpm:nameEn']).toBe('Order (edited)')
    expect(el.businessObject?.name).toBe('طلب')
  })

  it('switches a connection (sequence-flow condition label) — connections are not skipped', () => {
    const root = processRoot()
    const flow: FakeElement = {
      id: 'Flow_1',
      businessObject: {
        $type: 'bpmn:SequenceFlow',
        name: 'Approved',
        $attrs: { 'orbitpm:nameEn': 'Approved', 'orbitpm:nameAr': 'موافق عليه' }
      },
      // Connections carry waypoints — nothing in langToggle filters on this.
      waypoints: [{ x: 0, y: 0 }, { x: 100, y: 40 }]
    }
    const { modeler, rec } = makeModeler({ root, elements: [flow] })

    const result = toggleDiagramLang(modeler)

    expect(result).toEqual({ switched: 1, missing: 0, to: 'ar' })
    expect(rec).toEqual([
      { element: flow, properties: { name: 'موافق عليه' } },
      { element: root, properties: { 'orbitpm:activeLang': 'ar' } }
    ])
  })

  it('skips label elements entirely (not counted, not written) even though they carry full translations', () => {
    const root = processRoot()
    const task: FakeElement = {
      id: 'Task_E',
      businessObject: {
        $type: 'bpmn:Task',
        name: 'Ship',
        $attrs: { 'orbitpm:nameEn': 'Ship', 'orbitpm:nameAr': 'شحن' }
      }
    }
    const label: FakeElement = {
      id: 'Task_E_label',
      businessObject: {
        $type: 'bpmn:Task',
        name: 'Ship',
        $attrs: { 'orbitpm:nameEn': 'Ship', 'orbitpm:nameAr': 'شحن' }
      },
      labelTarget: task
    }
    const { modeler, rec } = makeModeler({ root, elements: [task, label] })

    const result = toggleDiagramLang(modeler)

    // Only `task` counts — `label` shares its business object but must not be
    // double-processed.
    expect(result).toEqual({ switched: 1, missing: 0, to: 'ar' })
    expect(rec).toEqual([
      { element: task, properties: { name: 'شحن' } },
      { element: root, properties: { 'orbitpm:activeLang': 'ar' } }
    ])
  })

  it('flips activeLang unconditionally and self-heals plain names when nothing is translated yet', () => {
    const root = processRoot() // no orbitpm:activeLang -> from defaults to 'en'
    const elG: FakeElement = { id: 'Task_G', businessObject: { $type: 'bpmn:Task', name: 'Plain Name' } }
    const elH: FakeElement = { id: 'Task_H', businessObject: { $type: 'bpmn:Task', name: 'Another' } }
    const { modeler, rec } = makeModeler({ root, elements: [elG, elH] })

    const result = toggleDiagramLang(modeler)

    expect(result).toEqual({ switched: 0, missing: 2, to: 'ar' })
    expect(rec).toEqual([
      { element: elG, properties: { 'orbitpm:nameEn': 'Plain Name' } },
      { element: elH, properties: { 'orbitpm:nameEn': 'Another' } },
      { element: root, properties: { 'orbitpm:activeLang': 'ar' } }
    ])
    // Names themselves are untouched (no ar translation exists yet to apply).
    expect(elG.businessObject?.name).toBe('Plain Name')
    expect(elH.businessObject?.name).toBe('Another')
  })

  it('flips activeLang even with an empty registry', () => {
    const root = processRoot()
    const { modeler, rec } = makeModeler({ root, elements: [] })

    const result = toggleDiagramLang(modeler)

    expect(result).toEqual({ switched: 0, missing: 0, to: 'ar' })
    expect(rec).toEqual([{ element: root, properties: { 'orbitpm:activeLang': 'ar' } }])
  })

  it('does not throw and skips the root write when there is no canvas root at all', () => {
    const el: FakeElement = {
      id: 'Task_I',
      businessObject: { $type: 'bpmn:Task', name: 'Solo', $attrs: { 'orbitpm:nameEn': 'Solo', 'orbitpm:nameAr': 'وحيد' } }
    }
    const { modeler, rec } = makeModeler({ elements: [el] }) // no root

    const result = toggleDiagramLang(modeler)

    expect(result).toEqual({ switched: 1, missing: 0, to: 'ar' })
    // Only the element write — no root/activeLang call since there is no root.
    expect(rec).toEqual([{ element: el, properties: { name: 'وحيد' } }])
  })

  it('passes the real root element through untouched for a plain process diagram', () => {
    const root = processRoot()
    const { modeler, rec } = makeModeler({ root, elements: [] })
    toggleDiagramLang(modeler)
    expect(rec[0].element).toBe(root) // same reference — not a copy/wrapper
  })

  it('wraps the bare processRef business object for a collaboration diagram (no shape of its own)', () => {
    const processRef: FakeBusinessObject = { $type: 'bpmn:Process', $attrs: {} }
    const root: FakeElement = {
      id: 'Collab_1',
      businessObject: { $type: 'bpmn:Collaboration', participants: [{ processRef }] }
    }
    const { modeler, rec } = makeModeler({ root, elements: [] })

    const result = toggleDiagramLang(modeler)

    expect(result).toEqual({ switched: 0, missing: 0, to: 'ar' })
    expect(rec).toHaveLength(1)
    // Never hand the bare business object to updateProperties as "element"
    // (bpmn-js's UpdatePropertiesHandler reads element.businessObject
    // directly with no fallback) — it must be wrapped.
    expect(rec[0].element).not.toBe(processRef)
    expect((rec[0].element as { businessObject?: unknown }).businessObject).toBe(processRef)
    expect(rec[0].properties).toEqual({ 'orbitpm:activeLang': 'ar' })
    expect(processRef.$attrs).toEqual({ 'orbitpm:activeLang': 'ar' })
  })

  it('round-trips en -> ar -> en, restoring the ar translation untouched and preserving a manual en edit', () => {
    const root = processRoot()
    const el: FakeElement = {
      id: 'Task_J',
      businessObject: {
        $type: 'bpmn:Task',
        // Hand-edited while en was active: diverges from the stored en attr.
        name: 'Edited While EN',
        $attrs: { 'orbitpm:nameEn': 'Original EN', 'orbitpm:nameAr': 'Original AR' }
      }
    }
    const { modeler, rec } = makeModeler({ root, elements: [el] })

    const first = toggleDiagramLang(modeler) // en -> ar
    expect(first).toEqual({ switched: 1, missing: 0, to: 'ar' })
    expect(rec[0]).toEqual({
      element: el,
      properties: { 'orbitpm:nameEn': 'Edited While EN', name: 'Original AR' }
    })
    expect(el.businessObject?.name).toBe('Original AR')

    const second = toggleDiagramLang(modeler) // ar -> en
    expect(second).toEqual({ switched: 1, missing: 0, to: 'en' })
    // Visible name while ar was active never diverged from the stored ar
    // attr, so there is nothing to write back onto orbitpm:nameAr — only the
    // switch back to the (now self-healed) en attr.
    expect(rec[2]).toEqual({ element: el, properties: { name: 'Edited While EN' } })

    // Final state: the manual edit is restored, and the ar translation was
    // never touched by any of this.
    expect(el.businessObject?.name).toBe('Edited While EN')
    expect(el.businessObject?.$attrs?.['orbitpm:nameEn']).toBe('Edited While EN')
    expect(el.businessObject?.$attrs?.['orbitpm:nameAr']).toBe('Original AR')
    expect(rec).toHaveLength(4) // 2 toggles x (1 element write + 1 root write)
  })
})

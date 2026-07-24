import { describe, it, expect } from 'vitest'
import {
  deriveStepDetailsCtx,
  isFlowNodeElement,
  type StepDetailsModeler
} from '../stepDetailsCtx'
import type { OrgElementLike } from '../orgModel'

// stepDetailsCtx.ts replicates App.tsx's inline derivation (plus the
// name-seeding rule), typed against the same structural modeler shape as the
// rest of the org pack — so a tiny fake with selection / elementRegistry /
// canvas services drives the whole thing in the node vitest environment.

// --- fakes -------------------------------------------------------------------

function makeModeler(opts: {
  selection?: OrgElementLike[]
  elements?: OrgElementLike[]
  root?: OrgElementLike
}): StepDetailsModeler {
  const services: Record<string, unknown> = {
    selection: { get: () => opts.selection ?? [] },
    elementRegistry: { getAll: () => opts.elements ?? [] },
    canvas: { getRootElement: () => opts.root },
    modeling: { updateProperties: () => undefined },
    bpmnFactory: { create: () => ({}) }
  }
  const modeler = {
    get(name: string): unknown {
      const service = services[name]
      if (!service) throw new Error('unexpected service ' + name)
      return service
    }
  }
  return modeler as unknown as StepDetailsModeler
}

function task(
  id: string,
  opts: { name?: string; attrs?: Record<string, unknown>; type?: string } = {}
): OrgElementLike {
  return {
    id,
    type: opts.type ?? 'bpmn:Task',
    businessObject: {
      $type: opts.type ?? 'bpmn:Task',
      name: opts.name,
      $attrs: { ...(opts.attrs ?? {}) }
    }
  }
}

function processRoot(attrs: Record<string, unknown> = {}, name?: string): OrgElementLike {
  return {
    id: 'Process_1',
    type: 'bpmn:Process',
    businessObject: { $type: 'bpmn:Process', name, $attrs: { ...attrs } }
  }
}

// === isFlowNodeElement =======================================================

describe('isFlowNodeElement', () => {
  it('accepts flow nodes (tasks, gateways, events)', () => {
    expect(isFlowNodeElement(task('T1'))).toBe(true)
    expect(isFlowNodeElement(task('G1', { type: 'bpmn:ExclusiveGateway' }))).toBe(true)
    expect(isFlowNodeElement(task('S1', { type: 'bpmn:StartEvent' }))).toBe(true)
  })

  it('rejects null/undefined and non-bpmn types', () => {
    expect(isFlowNodeElement(null)).toBe(false)
    expect(isFlowNodeElement(undefined)).toBe(false)
    expect(isFlowNodeElement({ id: 'x', type: 'label' })).toBe(false)
    expect(isFlowNodeElement({ id: 'x' })).toBe(false)
  })

  it('rejects the process/collaboration roots, connections and labels', () => {
    expect(isFlowNodeElement(processRoot())).toBe(false)
    expect(isFlowNodeElement({ id: 'C1', type: 'bpmn:Collaboration' })).toBe(false)
    expect(
      isFlowNodeElement({ id: 'F1', type: 'bpmn:SequenceFlow', waypoints: [{ x: 0, y: 0 }] })
    ).toBe(false)
    expect(isFlowNodeElement({ id: 'L1', type: 'bpmn:Task', labelTarget: {} })).toBe(false)
  })
})

// === deriveStepDetailsCtx — modes ===========================================

describe('deriveStepDetailsCtx modes', () => {
  it('element mode: exactly one selected flow node, org props mapped into initial', () => {
    const el = task('T1', {
      name: 'Review',
      attrs: {
        'orbitpm:owner': 'Operations',
        'orbitpm:ownerType': 'department',
        'orbitpm:kind': 'cc',
        'orbitpm:inputs': 'Form A\nFile',
        'orbitpm:decisionBasis': 'Policy 4'
      }
    })
    const modeler = makeModeler({
      selection: [el],
      elements: [el],
      root: processRoot({ 'orbitpm:activeLang': 'en' })
    })

    const ctx = deriveStepDetailsCtx(modeler)

    expect(ctx.mode).toBe('element')
    expect(ctx.elementType).toBe('bpmn:Task')
    expect(ctx.element).toBe(el)
    expect(ctx.modeler).toBe(modeler)
    expect(ctx.initial.owner).toBe('Operations')
    expect(ctx.initial.ownerType).toBe('department')
    expect(ctx.initial.cc).toBe(true)
    expect(ctx.initial.inputs).toBe('Form A\nFile')
    expect(ctx.initial.decisionBasis).toBe('Policy 4')
  })

  it('element mode: reads the linked TextAnnotation note', () => {
    const el = task('T1', { name: 'Review' })
    const note: OrgElementLike = {
      id: 'N1',
      type: 'bpmn:TextAnnotation',
      businessObject: { $type: 'bpmn:TextAnnotation', text: 'watch out' }
    }
    const assoc: OrgElementLike = {
      id: 'A1',
      type: 'bpmn:Association',
      source: el,
      target: note
    }
    const modeler = makeModeler({
      selection: [el],
      elements: [el, note, assoc],
      root: processRoot({ 'orbitpm:activeLang': 'en' })
    })

    expect(deriveStepDetailsCtx(modeler).initial.note).toBe('watch out')
  })

  it('process mode for an empty selection: proc props + documentation + first start-event trigger', () => {
    const start = task('S1', {
      type: 'bpmn:StartEvent',
      attrs: { 'orbitpm:trigger': 'email', 'orbitpm:triggerDetail': 'intake inbox' }
    })
    const root: OrgElementLike = {
      id: 'Process_1',
      type: 'bpmn:Process',
      businessObject: {
        $type: 'bpmn:Process',
        name: 'Main Flow',
        documentation: [{ text: 'About this process' }],
        $attrs: {
          'orbitpm:owner': 'PMO',
          'orbitpm:nameEn': 'Main Flow',
          'orbitpm:activeLang': 'en'
        }
      }
    }
    const modeler = makeModeler({ selection: [], elements: [start], root })

    const ctx = deriveStepDetailsCtx(modeler)

    expect(ctx.mode).toBe('process')
    expect(ctx.elementType).toBeUndefined()
    expect(ctx.element).toBeUndefined()
    expect(ctx.initial.owner).toBe('PMO')
    expect(ctx.initial.note).toBe('About this process')
    expect(ctx.initial.trigger).toBe('email')
    expect(ctx.initial.triggerDetail).toBe('intake inbox')
    // Step-data fields stay blank in process mode.
    expect(ctx.initial.inputs).toBe('')
    expect(ctx.initial.respList).toBe('')
  })

  it('process mode for multi-selections and for a selected connection', () => {
    const a = task('T1', { name: 'A' })
    const b = task('T2', { name: 'B' })
    const flow: OrgElementLike = {
      id: 'F1',
      type: 'bpmn:SequenceFlow',
      waypoints: [{ x: 0, y: 0 }],
      businessObject: { $type: 'bpmn:SequenceFlow' }
    }
    const root = processRoot({ 'orbitpm:activeLang': 'en' })
    expect(
      deriveStepDetailsCtx(makeModeler({ selection: [a, b], elements: [a, b], root })).mode
    ).toBe('process')
    expect(
      deriveStepDetailsCtx(makeModeler({ selection: [flow], elements: [a, b, flow], root })).mode
    ).toBe('process')
  })

  it('survives a throwing selection service (falls back to process mode)', () => {
    const root = processRoot({ 'orbitpm:activeLang': 'en' }, 'Main')
    const modeler = makeModeler({ elements: [], root })
    const throwing = {
      get(name: string): unknown {
        if (name === 'selection') throw new Error('not ready')
        return modeler.get(name)
      }
    } as unknown as StepDetailsModeler

    expect(deriveStepDetailsCtx(throwing).mode).toBe('process')
  })
})

// === deriveStepDetailsCtx — name seeding ====================================

describe('deriveStepDetailsCtx name seeding', () => {
  const seededCtx = (
    activeLang: string | undefined,
    elOpts: { name?: string; attrs?: Record<string, unknown> }
  ) => {
    const el = task('T1', elOpts)
    const rootAttrs: Record<string, unknown> =
      activeLang === undefined ? {} : { 'orbitpm:activeLang': activeLang }
    const modeler = makeModeler({
      selection: [el],
      elements: [el],
      root: processRoot(rootAttrs)
    })
    return deriveStepDetailsCtx(modeler)
  }

  it('en active + empty nameEn: visible name seeds nameEn only', () => {
    const ctx = seededCtx('en', { name: 'Typed Label' })
    expect(ctx.initial.nameEn).toBe('Typed Label')
    expect(ctx.initial.nameAr).toBe('')
  })

  it('ar active + empty nameAr: visible name seeds nameAr only', () => {
    const ctx = seededCtx('ar', { name: 'مهمة' })
    expect(ctx.initial.nameAr).toBe('مهمة')
    expect(ctx.initial.nameEn).toBe('')
  })

  it('NEVER overwrites a stored active-side name', () => {
    const en = seededCtx('en', { name: 'Edited Label', attrs: { 'orbitpm:nameEn': 'Stored EN' } })
    expect(en.initial.nameEn).toBe('Stored EN')
    const ar = seededCtx('ar', { name: 'معدل', attrs: { 'orbitpm:nameAr': 'مخزن' } })
    expect(ar.initial.nameAr).toBe('مخزن')
  })

  it('leaves the INACTIVE side alone even when it is empty', () => {
    const ctx = seededCtx('en', { name: 'Typed', attrs: { 'orbitpm:nameEn': 'Stored EN' } })
    // nameEn stored, active en — nothing seeds nameAr from the visible text.
    expect(ctx.initial.nameAr).toBe('')
  })

  it('defaults to en when the activeLang flag is absent', () => {
    const ctx = seededCtx(undefined, { name: 'Plain' })
    expect(ctx.initial.nameEn).toBe('Plain')
    expect(ctx.initial.nameAr).toBe('')
  })

  it('does not seed from a whitespace-only visible name', () => {
    const ctx = seededCtx('en', { name: '   ' })
    expect(ctx.initial.nameEn).toBe('')
    expect(ctx.initial.nameAr).toBe('')
  })

  it('process mode: seeds the active empty side from the root name', () => {
    const root = processRoot({ 'orbitpm:activeLang': 'en' }, 'My Process')
    const ctx = deriveStepDetailsCtx(makeModeler({ selection: [], elements: [], root }))
    expect(ctx.mode).toBe('process')
    expect(ctx.initial.nameEn).toBe('My Process')
    expect(ctx.initial.nameAr).toBe('')
  })

  it('process mode: stored proc name wins over the visible root name', () => {
    const root = processRoot(
      { 'orbitpm:activeLang': 'en', 'orbitpm:nameEn': 'Stored Process EN' },
      'Visible Root Name'
    )
    const ctx = deriveStepDetailsCtx(makeModeler({ selection: [], elements: [], root }))
    expect(ctx.initial.nameEn).toBe('Stored Process EN')
    expect(ctx.initial.nameAr).toBe('')
  })

  it('process mode ar: seeds nameAr from the root name', () => {
    const root = processRoot({ 'orbitpm:activeLang': 'ar' }, 'عملية رئيسية')
    const ctx = deriveStepDetailsCtx(makeModeler({ selection: [], elements: [], root }))
    expect(ctx.initial.nameAr).toBe('عملية رئيسية')
    expect(ctx.initial.nameEn).toBe('')
  })

  it('never writes anything to the diagram — the seed lives only in initial', () => {
    const el = task('T1', { name: 'Typed Label' })
    const modeler = makeModeler({
      selection: [el],
      elements: [el],
      root: processRoot({ 'orbitpm:activeLang': 'en' })
    })
    deriveStepDetailsCtx(modeler)
    expect(el.businessObject?.$attrs).toEqual({}) // no orbitpm:nameEn written back
  })
})

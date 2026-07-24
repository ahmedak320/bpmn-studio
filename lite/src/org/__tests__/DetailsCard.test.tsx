import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DetailsCard } from '../DetailsCard'
import type { StepDetailsModeler } from '../stepDetailsCtx'
import type { OrgElementLike } from '../orgModel'
import { t } from '../../i18n'

// DetailsCard derives everything during render (the eventBus subscription is
// an effect, which react-dom/server never runs), so a static markup render
// against the same structural modeler fakes as stepDetailsCtx.test.ts covers
// the element / process / null states in the node environment.

const noop = (): void => {}

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
    bpmnFactory: { create: () => ({}) },
    eventBus: { on: () => undefined, off: () => undefined }
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

function render(modeler: StepDetailsModeler | null): string {
  return renderToStaticMarkup(<DetailsCard modeler={modeler} onOpenDetails={noop} />)
}

describe('DetailsCard (static render)', () => {
  it('element selected: name, scope label, missing chips and the open button', () => {
    const el = task('T1', { name: 'Review request' }) // owner/inputs/outputs all missing
    const modeler = makeModeler({
      selection: [el],
      elements: [el],
      root: processRoot({ 'orbitpm:activeLang': 'en' })
    })

    const html = render(modeler)

    expect(html).toContain('orbitpm-lite-details-card')
    expect(html).toContain(t('details.card.title'))
    expect(html).toContain(t('details.card.elementScope'))
    expect(html).toContain('Review request')
    expect(html).toContain(t('details.card.missingTitle'))
    expect(html).toContain(t('missing.owner'))
    expect(html).toContain(t('missing.inputs'))
    expect(html).toContain(t('missing.outputs'))
    expect(html).toContain(t('details.card.open'))
    expect(html).toContain(t('details.card.open.title'))
  })

  it('element with everything filled: green complete line, no missing title', () => {
    const el = task('T1', {
      name: 'Review request',
      attrs: {
        'orbitpm:owner': 'Operations',
        'orbitpm:ownerType': 'department',
        'orbitpm:inputs': 'Form A\nCustomer file\nID copy',
        'orbitpm:outputs': 'Decision'
      }
    })
    const modeler = makeModeler({
      selection: [el],
      elements: [el],
      root: processRoot({ 'orbitpm:activeLang': 'en' })
    })

    const html = render(modeler)

    expect(html).toContain(t('details.card.complete'))
    expect(html).not.toContain(t('details.card.missingTitle'))
    // Glance rows: owner + its localized type; first list entry + "+N more".
    expect(html).toContain('Operations')
    expect(html).toContain(t('owner.type.department'))
    expect(html).toContain('Form A')
    expect(html).toContain(t('details.card.more', { count: 2 }))
    expect(html).toContain('Decision')
  })

  it('omits the completeness block for non-eligible types (CallActivity)', () => {
    const el = task('C1', { name: 'Sub', type: 'bpmn:CallActivity' })
    const modeler = makeModeler({
      selection: [el],
      elements: [el],
      root: processRoot({ 'orbitpm:activeLang': 'en' })
    })

    const html = render(modeler)

    expect(html).not.toContain(t('details.card.missingTitle'))
    expect(html).not.toContain(t('details.card.complete'))
    expect(html).toContain(t('details.card.open')) // the button is always there
  })

  it('gateway shows the decision-basis chip when missing', () => {
    const el = task('G1', { name: 'OK?', type: 'bpmn:ExclusiveGateway' })
    const modeler = makeModeler({
      selection: [el],
      elements: [el],
      root: processRoot({ 'orbitpm:activeLang': 'en' })
    })

    expect(render(modeler)).toContain(t('missing.basis'))
  })

  it('empty selection: process scope with the no-selection hint and process owner', () => {
    const root = processRoot(
      { 'orbitpm:activeLang': 'en', 'orbitpm:owner': 'PMO', 'orbitpm:ownerType': 'division' },
      'Main Flow'
    )
    const modeler = makeModeler({ selection: [], elements: [], root })

    const html = render(modeler)

    expect(html).toContain(t('details.card.processScope'))
    expect(html).toContain(t('details.card.noSelection'))
    expect(html).toContain('Main Flow')
    expect(html).toContain('PMO')
    expect(html).toContain(t('owner.type.division'))
    // Element-only glance rows are hidden in process scope.
    expect(html).not.toContain(t('details.card.inputs'))
  })

  it('null modeler renders the placeholder without throwing', () => {
    const html = render(null)
    expect(html).toContain('orbitpm-lite-details-card')
    expect(html).toContain(t('details.card.title'))
    expect(html).not.toContain(t('details.card.open'))
  })

  it('a modeler that throws during derivation falls back to the placeholder', () => {
    const broken = {
      get(): unknown {
        throw new Error('torn down')
      }
    } as unknown as StepDetailsModeler
    const html = render(broken)
    expect(html).toContain(t('details.card.title'))
  })
})

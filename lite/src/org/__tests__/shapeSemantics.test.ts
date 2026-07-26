import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ar, en } from '../../i18n/dictionaries'
import { PALETTE } from '../palette'
import { SEMANTIC_NAMING } from '../semanticNaming'
import {
  SHAPE_LEGEND_KINDS,
  SHAPE_SEMANTICS,
  SHAPE_SEMANTIC_KINDS,
  resolveShapeSemantic,
  shapeSemanticColors,
  shapeSemanticForDecoration,
  shapeSemanticForElement,
  shapeSemanticKindForElement,
  type ShapeSemanticKind
} from '../shapeSemantics'

const EXPECTED_KINDS: ShapeSemanticKind[] = [
  'event-start',
  'event-intermediate',
  'event-end',
  'step',
  'subprocess',
  'gateway-exclusive',
  'gateway-inclusive',
  'gateway-parallel',
  'gateway-event-based',
  'gateway-complex',
  'participant',
  'lane',
  'annotation',
  'data-object',
  'data-store',
  'owner',
  'input',
  'output',
  'cc',
  'basis',
  'subprocess-chip'
]

describe('SHAPE_SEMANTICS', () => {
  it('covers every supported node and decoration kind exactly once', () => {
    expect([...SHAPE_SEMANTIC_KINDS]).toEqual(EXPECTED_KINDS)
    expect([...SHAPE_LEGEND_KINDS]).toEqual(EXPECTED_KINDS)
    expect(Object.keys(SHAPE_SEMANTICS)).toEqual(EXPECTED_KINDS)
    expect(Object.isFrozen(SHAPE_SEMANTICS)).toBe(true)
    expect(new Set(SHAPE_LEGEND_KINDS).size).toBe(EXPECTED_KINDS.length)
  })

  it('has valid icon and palette references with a one-line explanation in both languages', () => {
    const icons = new Set([
      'start-circle',
      'intermediate-circle',
      'end-circle',
      'exclusive-diamond',
      'inclusive-diamond',
      'parallel-diamond',
      'event-based-diamond',
      'complex-diamond',
      'rounded-rect',
      'double-rounded-rect',
      'participant',
      'lane',
      'annotation',
      'data-object',
      'data-store',
      'chip'
    ])

    for (const kind of EXPECTED_KINDS) {
      const descriptor = SHAPE_SEMANTICS[kind]
      expect(descriptor.kind).toBe(kind)
      expect(icons.has(descriptor.icon)).toBe(true)
      expect(descriptor.swatch.fill in PALETTE).toBe(true)
      expect(descriptor.swatch.stroke in PALETTE).toBe(true)
      expect(Object.isFrozen(descriptor)).toBe(true)
      expect(Object.isFrozen(descriptor.swatch)).toBe(true)

      for (const lang of ['en', 'ar'] as const) {
        const resolved = resolveShapeSemantic(kind, lang)
        expect(resolved.label.trim()).not.toBe('')
        expect(resolved.explanation.trim()).not.toBe('')
        expect(resolved.explanation).not.toContain('\n')
        expect(shapeSemanticColors(resolved)).toEqual({
          fill: PALETTE[descriptor.swatch.fill],
          stroke: PALETTE[descriptor.swatch.stroke]
        })
      }
    }
  })

  it('keeps every dynamic non-gateway i18n key present in both dictionaries', () => {
    for (const descriptor of Object.values(SHAPE_SEMANTICS)) {
      if (descriptor.text.source !== 'i18n') continue
      expect(descriptor.text.labelKey in en).toBe(true)
      expect(descriptor.text.labelKey in ar).toBe(true)
      expect(descriptor.text.explanationKey in en).toBe(true)
      expect(descriptor.text.explanationKey in ar).toBe(true)
      expect(resolveShapeSemantic(descriptor.kind, 'en')).toMatchObject({
        label: en[descriptor.text.labelKey],
        explanation: en[descriptor.text.explanationKey]
      })
      expect(resolveShapeSemantic(descriptor.kind, 'ar')).toMatchObject({
        label: ar[descriptor.text.labelKey],
        explanation: ar[descriptor.text.explanationKey]
      })
    }
  })

  it('consumes each frozen SEMANTIC_NAMING entry by identity for display, tooltip, and alias', () => {
    const cases = [
      ['gateway-exclusive', 'bpmn:ExclusiveGateway'],
      ['gateway-inclusive', 'bpmn:InclusiveGateway'],
      ['gateway-parallel', 'bpmn:ParallelGateway']
    ] as const

    for (const [kind, gatewayType] of cases) {
      const text = SHAPE_SEMANTICS[kind].text
      expect(text.source).toBe('semanticNaming')
      if (text.source !== 'semanticNaming') throw new Error('wrong text source')
      expect(text.gatewayType).toBe(gatewayType)
      expect(text.naming).toBe(SEMANTIC_NAMING[gatewayType])

      for (const lang of ['en', 'ar'] as const) {
        expect(resolveShapeSemantic(kind, lang)).toMatchObject({
          label: SEMANTIC_NAMING[gatewayType][lang].display,
          explanation: SEMANTIC_NAMING[gatewayType][lang].tooltip,
          aliases: [SEMANTIC_NAMING[gatewayType].arisAlias]
        })
      }
    }
  })

  it('does not duplicate gateway display or tooltip literals in this module', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../shapeSemantics.ts', import.meta.url)),
      'utf8'
    )
    for (const naming of Object.values(SEMANTIC_NAMING)) {
      expect(source).not.toContain(naming.en.display)
      expect(source).not.toContain(naming.en.tooltip)
      expect(source).not.toContain(naming.ar.display)
      expect(source).not.toContain(naming.ar.tooltip)
      expect(source).not.toContain(naming.arisAlias)
    }
  })
})

describe('shapeSemanticForElement', () => {
  it.each([
    ['bpmn:StartEvent', 'event-start'],
    ['bpmn:IntermediateCatchEvent', 'event-intermediate'],
    ['bpmn:IntermediateThrowEvent', 'event-intermediate'],
    ['bpmn:BoundaryEvent', 'event-intermediate'],
    ['bpmn:EndEvent', 'event-end'],
    ['bpmn:Task', 'step'],
    ['bpmn:UserTask', 'step'],
    ['bpmn:ServiceTask', 'step'],
    ['bpmn:SendTask', 'step'],
    ['bpmn:ReceiveTask', 'step'],
    ['bpmn:ManualTask', 'step'],
    ['bpmn:BusinessRuleTask', 'step'],
    ['bpmn:ScriptTask', 'step'],
    ['bpmn:CallActivity', 'subprocess'],
    ['bpmn:SubProcess', 'subprocess'],
    ['bpmn:Transaction', 'subprocess'],
    ['bpmn:AdHocSubProcess', 'subprocess'],
    ['bpmn:ExclusiveGateway', 'gateway-exclusive'],
    ['bpmn:InclusiveGateway', 'gateway-inclusive'],
    ['bpmn:ParallelGateway', 'gateway-parallel'],
    ['bpmn:EventBasedGateway', 'gateway-event-based'],
    ['bpmn:ComplexGateway', 'gateway-complex'],
    ['bpmn:Participant', 'participant'],
    ['bpmn:Lane', 'lane'],
    ['bpmn:TextAnnotation', 'annotation'],
    ['bpmn:DataObjectReference', 'data-object'],
    ['bpmn:DataStoreReference', 'data-store']
  ] as const)('maps %s to %s', (type, kind) => {
    expect(shapeSemanticKindForElement({ type })).toBe(kind)
    expect(shapeSemanticForElement({ type }, 'en')?.kind).toBe(kind)
  })

  it('falls back to businessObject.$type when a diagram type is absent', () => {
    expect(
      shapeSemanticForElement(
        { businessObject: { $type: 'bpmn:Task' } },
        'ar'
      )
    ).toMatchObject({
      kind: 'step',
      label: ar['legend.step'],
      explanation: ar['semantic.step.tooltip']
    })
  })

  it.each([
    [{ type: 'bpmn:Process' }],
    [{ type: 'bpmn:Collaboration' }],
    [{ type: 'bpmn:SequenceFlow', waypoints: [] }],
    [{ type: 'bpmn:Association', waypoints: [{ x: 0, y: 0 }] }],
    [{ type: 'bpmn:Task', labelTarget: {} }],
    [{ type: 'label', businessObject: { $type: 'bpmn:Task' } }],
    [null],
    [undefined]
  ])('rejects roots, labels, connections, and unsupported kinds: %o', (element) => {
    expect(shapeSemanticKindForElement(element)).toBeNull()
    expect(shapeSemanticForElement(element, 'en')).toBeNull()
  })
})

describe('shapeSemanticForDecoration', () => {
  it.each([
    ['owner', 'owner'],
    ['responsible', 'owner'],
    ['responsible-owner', 'owner'],
    ['input', 'input'],
    ['inputs', 'input'],
    ['output', 'output'],
    ['outputs', 'output'],
    ['cc', 'cc'],
    ['informed', 'cc'],
    ['basis', 'basis'],
    ['decision-basis', 'basis'],
    ['subprocess-chip', 'subprocess-chip'],
    ['subprocessChip', 'subprocess-chip'],
    ['subChip', 'subprocess-chip']
  ] as const)('maps decoration token %s to %s', (token, kind) => {
    expect(shapeSemanticForDecoration(token, 'en')?.kind).toBe(kind)
  })

  it('binds the layout lane outputs wrapper to the output descriptor', () => {
    expect(shapeSemanticForDecoration('outputs', 'en')).toEqual(
      resolveShapeSemantic('output', 'en')
    )
  })

  it.each([[''], ['unknown'], [null], [undefined]])(
    'rejects unsupported decoration token %s',
    (token) => {
      expect(shapeSemanticForDecoration(token, 'en')).toBeNull()
    }
  )
})

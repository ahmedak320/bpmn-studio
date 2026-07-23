import { describe, it, expect } from 'vitest'
import {
  LINKABLE_TYPES,
  isLinkableActivity,
  stripCalledElement,
  ensureCallActivityAndLink,
  type LinkMorphModeler,
  type ElementForLinkingLike,
  type ReplacedElementLike
} from '../linkOps'

describe('isLinkableActivity', () => {
  it('is false for null/undefined', () => {
    expect(isLinkableActivity(null)).toBe(false)
    expect(isLinkableActivity(undefined)).toBe(false)
  })

  it('is false for labels (labelTarget set)', () => {
    expect(isLinkableActivity({ type: 'bpmn:Task', labelTarget: { id: 'x' } })).toBe(false)
  })

  it('is false for connections (waypoints set)', () => {
    expect(
      isLinkableActivity({ type: 'bpmn:SequenceFlow', waypoints: [{ x: 0, y: 0 }] })
    ).toBe(false)
  })

  it('is false when type is missing', () => {
    expect(isLinkableActivity({})).toBe(false)
  })

  it('is false for a non-linkable type', () => {
    expect(isLinkableActivity({ type: 'bpmn:StartEvent' })).toBe(false)
    expect(isLinkableActivity({ type: 'bpmn:ExclusiveGateway' })).toBe(false)
  })

  it('is true for every LINKABLE_TYPES entry', () => {
    for (const type of LINKABLE_TYPES) {
      expect(isLinkableActivity({ type })).toBe(true)
    }
  })
})

describe('stripCalledElement', () => {
  const wrap = (inner: string): string =>
    `<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="ns"><bpmn:process id="P">${inner}</bpmn:process></bpmn:definitions>`

  it('removes calledElement with double quotes', () => {
    const xml = wrap('<bpmn:callActivity id="CA_1" name="Sub" calledElement="Process_2" />')
    const out = stripCalledElement(xml, 'CA_1')
    expect(out).toContain('<bpmn:callActivity id="CA_1" name="Sub" />')
    expect(out).not.toContain('calledElement')
  })

  it('removes calledElement with single quotes', () => {
    const xml = wrap("<bpmn:callActivity id='CA_1' calledElement='Process_2' />")
    const out = stripCalledElement(xml, 'CA_1')
    expect(out).not.toContain('calledElement')
    expect(out).toContain("<bpmn:callActivity id='CA_1' />")
  })

  it('preserves other attributes and whitespace elsewhere in the document', () => {
    const before = '<bpmn:startEvent id="Start_1" name="Begin" />'
    const activity = '<bpmn:callActivity id="CA_1" calledElement="Process_2" name="Sub" />'
    const after = '<bpmn:endEvent id="End_1" />'
    const xml = wrap(before + activity + after)
    const out = stripCalledElement(xml, 'CA_1')
    expect(out).toContain(before)
    expect(out).toContain(after)
    expect(out).toContain('<bpmn:callActivity id="CA_1" name="Sub" />')
  })

  it('only touches the matching id when multiple callActivities exist', () => {
    const xml = wrap(
      '<bpmn:callActivity id="CA_1" calledElement="Process_A" />' +
        '<bpmn:callActivity id="CA_2" calledElement="Process_B" />'
    )
    const out = stripCalledElement(xml, 'CA_1')
    expect(out).toContain('<bpmn:callActivity id="CA_1" />')
    expect(out).toContain('<bpmn:callActivity id="CA_2" calledElement="Process_B" />')
  })

  it('matches entity-encoded ids', () => {
    const xml = wrap('<bpmn:callActivity id="a&amp;b" calledElement="Process_2" />')
    const out = stripCalledElement(xml, 'a&b')
    expect(out).toContain('<bpmn:callActivity id="a&amp;b" />')
    expect(out).not.toContain('calledElement')
  })

  it('returns input unchanged when the attribute is absent', () => {
    const xml = wrap('<bpmn:callActivity id="CA_1" name="Sub" />')
    const out = stripCalledElement(xml, 'CA_1')
    expect(out).toBe(xml)
  })

  it('returns input unchanged when no matching id is found', () => {
    const xml = wrap('<bpmn:callActivity id="CA_1" calledElement="Process_2" />')
    const out = stripCalledElement(xml, 'CA_999')
    expect(out).toBe(xml)
  })
})

describe('ensureCallActivityAndLink', () => {
  function makeFakeModeler(elements: Record<string, ElementForLinkingLike>): {
    modeler: LinkMorphModeler
    updateCalls: Array<{ elementId: string; properties: Record<string, unknown> }>
    replaceCalls: Array<{ elementId: string; target: { type: string } }>
    selectCalls: unknown[]
    registry: Record<string, ElementForLinkingLike>
  } {
    const updateCalls: Array<{ elementId: string; properties: Record<string, unknown> }> = []
    const replaceCalls: Array<{ elementId: string; target: { type: string } }> = []
    const selectCalls: unknown[] = []
    const registry = { ...elements }

    const elementRegistry = {
      get: (id: string) => registry[id]
    }

    const modeling = {
      updateProperties: (
        element: { id: string },
        properties: Record<string, unknown>
      ): void => {
        updateCalls.push({ elementId: element.id, properties })
      }
    }

    const bpmnReplace = {
      replaceElement: (
        element: unknown,
        target: { type: string }
      ): ReplacedElementLike => {
        const id = (element as { id: string }).id
        replaceCalls.push({ elementId: id, target })
        const newEl: ReplacedElementLike & ElementForLinkingLike = {
          id: 'new_1',
          type: 'bpmn:CallActivity',
          businessObject: {}
        }
        registry['new_1'] = newEl
        return newEl
      }
    }

    const selection = {
      select: (el: unknown): void => {
        selectCalls.push(el)
      }
    }

    const modeler: LinkMorphModeler = {
      get: ((name: string) => {
        switch (name) {
          case 'elementRegistry':
            return elementRegistry
          case 'modeling':
            return modeling
          case 'bpmnReplace':
            return bpmnReplace
          case 'selection':
            return selection
          default:
            throw new Error(`unexpected get(${name})`)
        }
      }) as LinkMorphModeler['get']
    }

    return { modeler, updateCalls, replaceCalls, selectCalls, registry }
  }

  it('morphs a plain task into a CallActivity, then links the new element', () => {
    const { modeler, updateCalls, replaceCalls, selectCalls } = makeFakeModeler({
      task_1: { id: 'task_1', type: 'bpmn:Task' }
    })

    const resultId = ensureCallActivityAndLink(modeler, 'task_1', 'Process_target')

    expect(replaceCalls).toEqual([{ elementId: 'task_1', target: { type: 'bpmn:CallActivity' } }])
    expect(resultId).toBe('new_1')
    expect(updateCalls).toEqual([
      { elementId: 'new_1', properties: { calledElement: 'Process_target' } }
    ])
    expect(selectCalls.length).toBe(1)
  })

  it('skips replaceElement when the element is already a CallActivity', () => {
    const { modeler, updateCalls, replaceCalls, selectCalls } = makeFakeModeler({
      ca_1: { id: 'ca_1', type: 'bpmn:CallActivity' }
    })

    const resultId = ensureCallActivityAndLink(modeler, 'ca_1', 'Process_target')

    expect(replaceCalls).toEqual([])
    expect(resultId).toBe('ca_1')
    expect(updateCalls).toEqual([
      { elementId: 'ca_1', properties: { calledElement: 'Process_target' } }
    ])
    expect(selectCalls).toEqual([])
  })

  it('throws when the element cannot be found', () => {
    const { modeler } = makeFakeModeler({})
    expect(() => ensureCallActivityAndLink(modeler, 'missing', 'Process_x')).toThrow()
  })

  it('does not blow up when selection is unavailable', () => {
    const { modeler, registry } = makeFakeModeler({
      task_1: { id: 'task_1', type: 'bpmn:Task' }
    })
    void registry
    const originalGet = modeler.get
    const modelerWithoutSelection: LinkMorphModeler = {
      get: ((name: string) => {
        if (name === 'selection') throw new Error('no selection service')
        return (originalGet as (n: string) => unknown)(name)
      }) as LinkMorphModeler['get']
    }

    expect(() =>
      ensureCallActivityAndLink(modelerWithoutSelection, 'task_1', 'Process_target')
    ).not.toThrow()
  })
})

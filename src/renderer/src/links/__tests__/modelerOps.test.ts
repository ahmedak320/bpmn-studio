import { describe, expect, it, vi } from 'vitest'
import { setCalledElement, type ElementLike, type ModelerForLinkingLike } from '../modelerOps'

function makeMockModeler(elements: ElementLike[]): {
  modeler: ModelerForLinkingLike
  updateProperties: ReturnType<typeof vi.fn>
} {
  const byId = new Map(elements.map((el) => [el.id, el]))
  const updateProperties = vi.fn()

  const modeler: ModelerForLinkingLike = {
    get(name: 'modeling' | 'elementRegistry') {
      if (name === 'modeling') {
        return { updateProperties } as never
      }
      return { get: (id: string) => byId.get(id) } as never
    }
  }

  return { modeler, updateProperties }
}

describe('setCalledElement', () => {
  it('calls modeling.updateProperties with the resolved element and calledElement', () => {
    const element: ElementLike = { id: 'CallActivity_1', type: 'bpmn:CallActivity' }
    const { modeler, updateProperties } = makeMockModeler([element])

    const result = setCalledElement(modeler, 'CallActivity_1', 'Process_Onboarding')

    expect(result).toBe(true)
    expect(updateProperties).toHaveBeenCalledTimes(1)
    expect(updateProperties).toHaveBeenCalledWith(element, { calledElement: 'Process_Onboarding' })
  })

  it('returns false and does not call updateProperties when the element is missing', () => {
    const { modeler, updateProperties } = makeMockModeler([])

    const result = setCalledElement(modeler, 'Nonexistent', 'Process_X')

    expect(result).toBe(false)
    expect(updateProperties).not.toHaveBeenCalled()
  })

  it('can clear a link by passing an empty processId', () => {
    const element: ElementLike = {
      id: 'CallActivity_2',
      type: 'bpmn:CallActivity',
      businessObject: { calledElement: 'Process_Old' }
    }
    const { modeler, updateProperties } = makeMockModeler([element])

    setCalledElement(modeler, 'CallActivity_2', '')

    expect(updateProperties).toHaveBeenCalledWith(element, { calledElement: '' })
  })
})

import { describe, expect, it } from 'vitest'
import { inspectCallActivityElement, shouldSuppressDefaultDblClick } from '../callActivity'

describe('inspectCallActivityElement', () => {
  it('reports non-call-activities as not a call activity', () => {
    const result = inspectCallActivityElement({ type: 'bpmn:Task' })
    expect(result.isCallActivity).toBe(false)
    expect(result.calledElementId).toBeUndefined()
  })

  it('handles null/undefined elements', () => {
    expect(inspectCallActivityElement(null).isCallActivity).toBe(false)
    expect(inspectCallActivityElement(undefined).isCallActivity).toBe(false)
  })

  it('reports a call activity without calledElement as unlinked', () => {
    const result = inspectCallActivityElement({ type: 'bpmn:CallActivity', businessObject: {} })
    expect(result.isCallActivity).toBe(true)
    expect(result.calledElementId).toBeUndefined()
  })

  it('treats a blank calledElement as unlinked', () => {
    const result = inspectCallActivityElement({
      type: 'bpmn:CallActivity',
      businessObject: { calledElement: '   ' }
    })
    expect(result.calledElementId).toBeUndefined()
  })

  it('resolves the calledElement id when present', () => {
    const result = inspectCallActivityElement({
      type: 'bpmn:CallActivity',
      businessObject: { calledElement: 'Process_Onboarding' }
    })
    expect(result.isCallActivity).toBe(true)
    expect(result.calledElementId).toBe('Process_Onboarding')
  })
})

describe('shouldSuppressDefaultDblClick', () => {
  it('is false for a non-call-activity', () => {
    expect(shouldSuppressDefaultDblClick({ isCallActivity: false })).toBe(false)
  })

  it('is false for an unlinked call activity (let default behavior run)', () => {
    expect(shouldSuppressDefaultDblClick({ isCallActivity: true })).toBe(false)
  })

  it('is true only when a calledElementId is resolved', () => {
    expect(
      shouldSuppressDefaultDblClick({ isCallActivity: true, calledElementId: 'Process_X' })
    ).toBe(true)
  })
})

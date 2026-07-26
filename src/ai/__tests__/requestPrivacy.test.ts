import { describe, expect, it } from 'vitest'
import {
  estimateGenerationRequestCount,
  inspectContextSensitivity,
  redactProcessNames,
  selectRelevantProcesses
} from '../requestPrivacy'

const CATALOG = [
  { id: 'Process_Order_Intake', name: 'Order intake' },
  { id: 'Process_Invoice_Approval', name: 'Invoice approval' },
  { id: 'Process_Employee_Onboarding', name: 'Employee onboarding' },
  { id: 'Process_Incident', name: 'Incident response' }
]

describe('privacy-preserving process retrieval', () => {
  it('counts worst-case transport attempts without repeating a large attachment', () => {
    expect(estimateGenerationRequestCount(false)).toBe(9)
    expect(estimateGenerationRequestCount(true)).toBe(7)
    expect(estimateGenerationRequestCount(true, 1, 3)).toBe(1)
  })

  it('returns only positively matching processes', () => {
    expect(selectRelevantProcesses('Create an invoice approval flow', CATALOG)).toEqual([
      CATALOG[1]
    ])
  })

  it('never sends first unrelated entries at zero confidence', () => {
    expect(selectRelevantProcesses('Create a generic workflow', CATALOG)).toEqual([])
    expect(selectRelevantProcesses('', CATALOG)).toEqual([])
  })

  it('supports Arabic lexical overlap', () => {
    const catalog = [
      { id: 'Process_1', name: 'اعتماد الفاتورة' },
      { id: 'Process_2', name: 'استقبال الموظف' }
    ]
    expect(selectRelevantProcesses('أريد اعتماد الفاتورة', catalog)).toEqual([catalog[0]])
  })

  it('redacts names without mutating stable linking ids', () => {
    expect(redactProcessNames(CATALOG.slice(0, 2))).toEqual([
      { id: 'Process_Order_Intake', name: 'Process 1' },
      { id: 'Process_Invoice_Approval', name: 'Process 2' }
    ])
  })

  it('reports names and obvious sensitive metadata', () => {
    expect(inspectContextSensitivity('Contact jane@example.com', CATALOG.slice(0, 1))).toEqual({
      containsNames: true,
      containsSensitiveMetadata: true
    })
    expect(inspectContextSensitivity('No context', [])).toEqual({
      containsNames: false,
      containsSensitiveMetadata: false
    })
  })
})

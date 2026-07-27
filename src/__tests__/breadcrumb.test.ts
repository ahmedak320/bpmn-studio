import { describe, it, expect } from 'vitest'
import { folderCrumbs } from '../workspace/breadcrumb'

describe('folderCrumbs', () => {
  it('builds the folder trail from root down to (not including) the file', () => {
    expect(folderCrumbs('Sales/Onboarding/hire.bpmn', 'Workspace')).toEqual([
      { label: 'Workspace', relPath: '' },
      { label: 'Sales', relPath: 'Sales' },
      { label: 'Onboarding', relPath: 'Sales/Onboarding' }
    ])
  })

  it('yields just the root crumb for a file at the workspace root', () => {
    expect(folderCrumbs('order.bpmn', 'WS')).toEqual([{ label: 'WS', relPath: '' }])
  })
})

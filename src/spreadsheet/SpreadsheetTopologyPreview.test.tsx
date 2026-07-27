// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PROCESS_WORKBOOK_MODEL_VERSION, type ProcessWorkbookModel } from './contracts'
import {
  SpreadsheetTopologyPreview,
  type SpreadsheetTopologyPreviewLabels
} from './SpreadsheetTopologyPreview'
import { bilingual, provenance } from './testFixtures'

const labels: SpreadsheetTopologyPreviewLabels = {
  process: 'Process',
  node: 'Node',
  type: 'Type',
  participant: 'Participant',
  flow: 'Flow',
  condition: 'Condition',
  defaultFlow: 'Default',
  generated: 'Generated',
  explicit: 'Explicit',
  mapped: 'Mapped',
  inferred: 'Inferred',
  synthetic: 'Synthetic',
  unassigned: 'Unassigned'
}

function model(): ProcessWorkbookModel {
  return {
    version: PROCESS_WORKBOOK_MODEL_VERSION,
    source: {
      fileName: 'topology.xlsx',
      format: 'xlsx',
      officialTemplate: false,
      worksheets: []
    },
    processes: [
      {
        id: 'Process_A',
        idOrigin: 'explicit',
        name: bilingual('Leave approval', 'اعتماد الإجازة'),
        activeLanguage: 'en',
        provenance: provenance('Processes', 2)
      }
    ],
    participants: [
      {
        processId: 'Process_A',
        id: 'Pool_A',
        idOrigin: 'explicit',
        type: 'pool',
        order: 1,
        name: bilingual('People operations', 'عمليات الموارد البشرية'),
        provenance: provenance('Participants', 2)
      },
      {
        processId: 'Process_A',
        id: 'Lane_A',
        idOrigin: 'explicit',
        type: 'lane',
        parentId: 'Pool_A',
        order: 1,
        name: bilingual('Reviewer', 'المراجع'),
        provenance: provenance('Participants', 3)
      },
      {
        processId: 'Process_A',
        id: 'Pool_External',
        idOrigin: 'explicit',
        type: 'pool',
        order: 2,
        name: bilingual('External service', 'الخدمة الخارجية'),
        provenance: provenance('Participants', 4)
      }
    ],
    nodes: [
      {
        processId: 'Process_A',
        id: 'Start_generated',
        idOrigin: 'generated',
        order: 1,
        type: 'startEvent',
        name: bilingual('Start', 'البداية'),
        poolId: 'Pool_A',
        laneId: 'Lane_A',
        metadata: {},
        provenance: provenance('Steps', 2)
      },
      {
        processId: 'Process_A',
        id: 'Task_Review',
        idOrigin: 'explicit',
        order: 2,
        type: 'userTask',
        name: bilingual('Review request', 'مراجعة الطلب'),
        poolId: 'Pool_A',
        laneId: 'Lane_A',
        metadata: {},
        provenance: provenance('Steps', 3)
      },
      {
        processId: 'Process_A',
        id: 'End_A',
        idOrigin: 'explicit',
        order: 3,
        type: 'endEvent',
        name: bilingual('Finished', 'النهاية'),
        poolId: 'Pool_A',
        laneId: 'Lane_A',
        metadata: {},
        provenance: provenance('Steps', 4)
      }
    ],
    flows: [
      {
        processId: 'Process_A',
        id: 'Flow_generated',
        idOrigin: 'generated',
        sourceStepId: 'Start_generated',
        targetStepId: 'Task_Review',
        isDefault: false,
        origin: 'synthetic-boundary',
        provenance: provenance('Steps', 2)
      },
      {
        processId: 'Process_A',
        id: 'Flow_decision',
        idOrigin: 'explicit',
        sourceStepId: 'Task_Review',
        targetStepId: 'End_A',
        condition: bilingual('Approved', 'معتمد'),
        isDefault: true,
        origin: 'mapped',
        provenance: provenance('Flows', 2)
      }
    ],
    glossary: []
  }
}

describe('SpreadsheetTopologyPreview', () => {
  it('renders nodes, directed edges, participant membership, and review markers', () => {
    render(<SpreadsheetTopologyPreview model={model()} labels={labels} />)

    expect(
      screen.getByRole('img', {
        name: /Process Leave approval: 3 Node, 2 Flow/
      })
    ).toBeTruthy()
    expect(screen.getAllByText('External service').length).toBeGreaterThan(0)

    const start = screen.getByTestId('topology-node-Start_generated')
    expect(start.getAttribute('data-generated')).toBe('true')
    expect(start.getAttribute('data-synthetic')).toBe('true')

    const synthetic = screen.getByTestId('topology-edge-Flow_generated')
    expect(synthetic.getAttribute('data-origin')).toBe('synthetic-boundary')
    expect(synthetic.querySelector('path')?.getAttribute('stroke-dasharray')).toBe('7 5')

    const decision = screen.getByTestId('topology-edge-Flow_decision')
    expect(decision.getAttribute('data-origin')).toBe('mapped')
    expect(decision.getAttribute('data-default')).toBe('true')
    expect(screen.getAllByText(/Approved/).length).toBeGreaterThan(0)
    expect(screen.getByText('Default')).toBeTruthy()

    const taskRow = screen
      .getAllByText('Task_Review')
      .map((entry) => entry.closest('tr'))
      .find((entry) => entry !== null)
    expect(taskRow).not.toBeNull()
    expect(within(taskRow!).getByText('Reviewer')).toBeTruthy()
  })
})

import { describe, expect, it } from 'vitest'
import type {
  ProcessWorkbookModel,
  WorkbookFlow,
  WorkbookNode,
  WorkbookParticipant
} from './contracts'
import { SPREADSHEET_LIMITS } from './limits'
import {
  bilingual,
  provenance,
  validFlows,
  validModel,
  validNodes,
  validParticipants,
  validProcess
} from './testFixtures'
import { validateProcessWorkbookModel } from './validation'

function codes(model: ProcessWorkbookModel): string[] {
  return validateProcessWorkbookModel(model).issues.map(({ code }) => code)
}

describe('ProcessWorkbookModel validation', () => {
  it('accepts a structurally complete graph', () => {
    expect(validateProcessWorkbookModel(validModel())).toEqual({
      issues: [],
      blocking: false,
      errorCount: 0,
      reviewCount: 0,
      warningCount: 0
    })
  })

  it('reports duplicate/missing IDs and broken process/node references with cell provenance', () => {
    const duplicateNode = {
      ...validNodes()[1]!,
      provenance: provenance('Steps', 9, ['step_id'])
    }
    const model = validModel({
      processes: [validProcess(), validProcess({ provenance: provenance('Processes', 3) })],
      nodes: [...validNodes(), duplicateNode],
      flows: [
        ...validFlows(),
        {
          ...validFlows()[0]!,
          id: 'Flow_Broken',
          sourceStepId: 'Missing_Source',
          targetStepId: 'Missing_Target',
          provenance: provenance('Flows', 8, [
            'flow_id',
            'source_step_id',
            'target_step_id'
          ])
        }
      ]
    })
    const report = validateProcessWorkbookModel(model)
    expect(report.blocking).toBe(true)
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'process-id-duplicate',
        worksheet: 'Processes'
      })
    )
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'node-id-duplicate',
        worksheet: 'Steps',
        cellAddress: 'A9'
      })
    )
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'flow-source-missing',
        rawValue: 'Missing_Source'
      })
    )
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'flow-target-missing',
        rawValue: 'Missing_Target'
      })
    )
  })

  it('makes unknown step and invalid RACI values blocking reviews', () => {
    const node: WorkbookNode = {
      ...validNodes()[1]!,
      type: 'unknown',
      rawType: 'Email somebody somehow',
      metadata: { raci: 'R;OWNER' }
    }
    const report = validateProcessWorkbookModel(
      validModel({ nodes: [validNodes()[0]!, node, validNodes()[2]!] })
    )
    expect(report.reviewCount).toBe(2)
    expect(report.blocking).toBe(true)
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'unknown-step-type', severity: 'review' })
    )
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'raci-invalid', severity: 'review' })
    )
  })

  it('validates pool/lane references, parent existence, type, and cycles', () => {
    const participants: WorkbookParticipant[] = [
      {
        ...validParticipants()[0]!,
        parentId: 'Lane_A'
      },
      {
        ...validParticipants()[1]!,
        id: 'Lane_A',
        parentId: 'Lane_B'
      },
      {
        ...validParticipants()[1]!,
        id: 'Lane_B',
        parentId: 'Lane_A',
        provenance: provenance('Participants', 4, ['participant_id', 'parent_id'])
      }
    ]
    const nodes = validNodes().map((node, index) =>
      index === 1
        ? {
            ...node,
            poolId: 'Lane_A',
            laneId: 'Missing_Lane',
            participantId: 'Lane_B'
          }
        : node
    )
    const result = codes(validModel({ participants, nodes }))
    expect(result).toContain('pool-parent-not-allowed')
    expect(result).toContain('participant-parent-cycle')
    expect(result).toContain('node-participant-kind-mismatch')
    expect(result).toContain('node-participant-missing')
    expect(result).toContain('multiple-lane-assignments')
  })

  it('enforces BPMN default-flow and conditional-gateway rules', () => {
    const gateway: WorkbookNode = {
      ...validNodes()[1]!,
      id: 'Gateway_1',
      type: 'exclusiveGateway',
      name: bilingual('Approved?', 'هل تمت الموافقة؟')
    }
    const approved: WorkbookNode = {
      ...validNodes()[2]!,
      id: 'Approved_End'
    }
    const rejected: WorkbookNode = {
      ...validNodes()[2]!,
      id: 'Rejected_End',
      provenance: provenance('Steps', 5)
    }
    const flows: WorkbookFlow[] = [
      { ...validFlows()[0]!, targetStepId: 'Gateway_1' },
      {
        processId: 'leave_approval',
        id: 'Flow_Approved',
        idOrigin: 'explicit',
        sourceStepId: 'Gateway_1',
        targetStepId: 'Approved_End',
        condition: bilingual('Approved', 'تمت الموافقة'),
        isDefault: true,
        origin: 'explicit',
        provenance: provenance('Flows', 3)
      },
      {
        processId: 'leave_approval',
        id: 'Flow_Rejected',
        idOrigin: 'explicit',
        sourceStepId: 'Gateway_1',
        targetStepId: 'Rejected_End',
        isDefault: true,
        origin: 'explicit',
        provenance: provenance('Flows', 4)
      }
    ]
    const result = codes(
      validModel({
        nodes: [validNodes()[0]!, gateway, approved, rejected],
        flows
      })
    )
    expect(result).toContain('multiple-default-flows')
    expect(result).toContain('default-flow-has-condition')

    const parallel = { ...gateway, type: 'parallelGateway' as const }
    const parallelResult = codes(
      validModel({
        nodes: [validNodes()[0]!, parallel, approved, rejected],
        flows: flows.map((flow) => ({
          ...flow,
          isDefault: flow.id === 'Flow_Approved',
          condition:
            flow.id === 'Flow_Rejected'
              ? bilingual('Condition', 'شرط')
              : undefined
        }))
      })
    )
    expect(parallelResult).toContain('gateway-default-not-allowed')
    expect(parallelResult).toContain('gateway-condition-not-allowed')
  })

  it('requires explicit conditional branches but permits a conditionless default', () => {
    const gateway: WorkbookNode = {
      ...validNodes()[1]!,
      id: 'Gateway_1',
      type: 'inclusiveGateway'
    }
    const endA = { ...validNodes()[2]!, id: 'End_A' }
    const endB = { ...validNodes()[2]!, id: 'End_B', provenance: provenance('Steps', 5) }
    const flows: WorkbookFlow[] = [
      { ...validFlows()[0]!, targetStepId: gateway.id },
      {
        ...validFlows()[1]!,
        id: 'Branch_A',
        sourceStepId: gateway.id,
        targetStepId: endA.id,
        isDefault: false
      },
      {
        ...validFlows()[1]!,
        id: 'Branch_B',
        sourceStepId: gateway.id,
        targetStepId: endB.id,
        isDefault: true,
        provenance: provenance('Flows', 4)
      }
    ]
    expect(
      codes(validModel({ nodes: [validNodes()[0]!, gateway, endA, endB], flows }))
    ).toContain('gateway-condition-required')

    flows[1] = { ...flows[1]!, condition: bilingual('A', 'أ') }
    const fixed = codes(
      validModel({ nodes: [validNodes()[0]!, gateway, endA, endB], flows })
    )
    expect(fixed).not.toContain('gateway-condition-required')
    expect(fixed).not.toContain('default-flow-has-condition')
  })

  it('validates called-process links against workbook and destination IDs', () => {
    const call: WorkbookNode = {
      ...validNodes()[1]!,
      type: 'callActivity',
      metadata: { calledProcessId: 'other_process' }
    }
    const unresolved = validateProcessWorkbookModel(
      validModel({ nodes: [validNodes()[0]!, call, validNodes()[2]!] })
    )
    expect(unresolved.issues).toContainEqual(
      expect.objectContaining({ code: 'called-process-unresolved', severity: 'error' })
    )

    const destinationResolved = validateProcessWorkbookModel(
      validModel({ nodes: [validNodes()[0]!, call, validNodes()[2]!] }),
      { destinationProcessIds: new Set(['other_process']) }
    )
    expect(destinationResolved.issues.map(({ code }) => code)).not.toContain(
      'called-process-unresolved'
    )

    const reviewed: WorkbookNode = {
      ...call,
      metadata: { calledProcessId: 'other_process', reviewedUnlinkedCall: true }
    }
    const reviewedReport = validateProcessWorkbookModel(
      validModel({ nodes: [validNodes()[0]!, reviewed, validNodes()[2]!] })
    )
    expect(reviewedReport.issues).toContainEqual(
      expect.objectContaining({
        code: 'called-process-reviewed-unlinked',
        severity: 'warning'
      })
    )
    expect(reviewedReport.blocking).toBe(false)
  })

  it('detects workspace process-ID collisions and unsafe mapped folders', () => {
    const model = validModel({
      processes: [validProcess({ folder: '../outside' })]
    })
    const report = validateProcessWorkbookModel(model, {
      destinationProcessIds: new Set(['leave_approval'])
    })
    expect(report.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'destination-process-id-collision',
        'destination-folder-unsafe'
      ])
    )
  })

  it('enforces exact node caps and emits the readability warning above 250', () => {
    const manyNodes = Array.from(
      { length: SPREADSHEET_LIMITS.nodesPerProcess + 1 },
      (_, index): WorkbookNode => ({
        processId: 'leave_approval',
        id: `Task_${index}`,
        idOrigin: 'explicit',
        order: index,
        type: index === 0 ? 'startEvent' : index === SPREADSHEET_LIMITS.nodesPerProcess ? 'endEvent' : 'task',
        name: bilingual(`Task ${index}`, `مهمة ${index}`),
        metadata: {},
        provenance: provenance('Steps', index + 2)
      })
    )
    const overProcess = validateProcessWorkbookModel(
      validModel({ nodes: manyNodes, flows: [] })
    )
    expect(overProcess.issues).toContainEqual(
      expect.objectContaining({
        code: 'node-process-limit',
        details: {
          actual: SPREADSHEET_LIMITS.nodesPerProcess + 1,
          limit: SPREADSHEET_LIMITS.nodesPerProcess
        }
      })
    )

    const readableNodes = manyNodes.slice(
      0,
      SPREADSHEET_LIMITS.diagramReadabilityWarningNodes + 1
    )
    readableNodes[readableNodes.length - 1] = {
      ...readableNodes[readableNodes.length - 1]!,
      type: 'endEvent'
    }
    expect(
      validateProcessWorkbookModel(validModel({ nodes: readableNodes, flows: [] })).issues
    ).toContainEqual(expect.objectContaining({ code: 'diagram-readability' }))

    const transactionNodes = Array.from(
      { length: SPREADSHEET_LIMITS.nodesPerTransaction + 1 },
      (_, index): WorkbookNode => ({
        processId: 'leave_approval',
        id: `Transaction_Task_${index}`,
        idOrigin: 'explicit',
        order: index,
        type:
          index === 0
            ? 'startEvent'
            : index === SPREADSHEET_LIMITS.nodesPerTransaction
              ? 'endEvent'
              : 'task',
        name: bilingual(`Task ${index}`, `مهمة ${index}`),
        metadata: {},
        provenance: provenance('Steps', index + 2)
      })
    )
    expect(
      validateProcessWorkbookModel(
        validModel({ nodes: transactionNodes, flows: [] })
      ).issues
    ).toContainEqual(
      expect.objectContaining({
        code: 'node-transaction-limit',
        details: {
          actual: SPREADSHEET_LIMITS.nodesPerTransaction + 1,
          limit: SPREADSHEET_LIMITS.nodesPerTransaction
        }
      })
    )
  })
})

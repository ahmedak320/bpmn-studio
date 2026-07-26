import { describe, expect, it, vi } from 'vitest'
import type {
  BpmnModelGenerationAdapter,
  ImportDestinationInspector,
  ImportDestinationTransaction,
  ImportTransactionFactory,
  MappingPreset,
  ProcessWorkbookModel,
  SpreadsheetBilingualAuditAdapter,
  WorkbookFlow,
  WorkbookNode
} from './contracts'
import { MAPPING_PRESET_VERSION } from './contracts'
import { SpreadsheetError } from './errors'
import { sha256Hex } from './hash'
import {
  executeTransactionalImportPlan,
  prepareTransactionalImportPlan,
  serializeSpreadsheetImportReport
} from './transaction'
import { bilingual, provenance, validModel, validProcess } from './testFixtures'

const encoder = new TextEncoder()

function generator(
  diagnostics: Awaited<ReturnType<BpmnModelGenerationAdapter['generate']>>['diagnostics'] = []
): BpmnModelGenerationAdapter {
  return {
    generate: vi.fn(async (graph) => {
      const xml = `<definitions><process id="${graph.process.id}"/></definitions>`
      return {
        processId: graph.process.id,
        semanticXml: xml,
        layoutedXml: xml,
        bytes: encoder.encode(xml),
        diagnostics
      }
    })
  }
}

function audit(complete = true): SpreadsheetBilingualAuditAdapter {
  return {
    audit: vi.fn(() => ({
      complete,
      missing: complete ? 0 : 2,
      invalid: complete ? 0 : 1,
      translationRequired: !complete
    }))
  }
}

function inspector(
  existing: Readonly<Record<string, string | true>> = {}
): ImportDestinationInspector {
  return {
    inspect: vi.fn(async (paths: readonly string[]) =>
      paths.map((path) => ({
        path,
        exists: existing[path] !== undefined,
        ...(typeof existing[path] === 'string' ? { hash: existing[path] } : {})
      }))
    )
  }
}

function fixedNow(value = '2026-07-26T12:00:00.000Z'): () => Date {
  return () => new Date(value)
}

function mappingPreset(): MappingPreset {
  return {
    version: MAPPING_PRESET_VERSION,
    name: 'Reviewed mapping',
    headerSignatures: {},
    selectedSheets: {},
    fieldMappings: {},
    valueMappings: { stepTypes: {}, participantTypes: {} },
    delimiters: { list: [';', '\n'] },
    inference: {
      flowMode: 'auto',
      syntheticBoundaries: 'review',
      requireGatewayConditions: true
    },
    locale: 'en'
  }
}

function secondProcessModel(): ProcessWorkbookModel {
  const secondNodes: WorkbookNode[] = [
    {
      processId: 'onboarding',
      id: 'Start_2',
      idOrigin: 'explicit',
      order: 1,
      type: 'startEvent',
      name: bilingual('Start', 'البداية'),
      metadata: {},
      provenance: provenance('Steps', 10)
    },
    {
      processId: 'onboarding',
      id: 'Task_2',
      idOrigin: 'explicit',
      order: 2,
      type: 'task',
      name: bilingual('Prepare', 'إعداد'),
      metadata: {},
      provenance: provenance('Steps', 11)
    },
    {
      processId: 'onboarding',
      id: 'End_2',
      idOrigin: 'explicit',
      order: 3,
      type: 'endEvent',
      name: bilingual('End', 'النهاية'),
      metadata: {},
      provenance: provenance('Steps', 12)
    }
  ]
  const secondFlows: WorkbookFlow[] = [
    {
      processId: 'onboarding',
      id: 'Flow_21',
      idOrigin: 'explicit',
      sourceStepId: 'Start_2',
      targetStepId: 'Task_2',
      isDefault: false,
      origin: 'explicit',
      provenance: provenance('Flows', 10)
    },
    {
      processId: 'onboarding',
      id: 'Flow_22',
      idOrigin: 'explicit',
      sourceStepId: 'Task_2',
      targetStepId: 'End_2',
      isDefault: false,
      origin: 'explicit',
      provenance: provenance('Flows', 11)
    }
  ]
  const first = validModel()
  return {
    ...first,
    processes: [
      ...first.processes,
      validProcess({
        id: 'onboarding',
        name: bilingual('Onboarding', 'تهيئة الموظف'),
        provenance: provenance('Processes', 3)
      })
    ],
    nodes: [...first.nodes, ...secondNodes],
    flows: [...first.flows, ...secondFlows]
  }
}

describe('transactional import preparation', () => {
  it('generates all preview artifacts offline before exposing a ready plan', async () => {
    const model = validModel()
    const bpmn = generator()
    const plan = await prepareTransactionalImportPlan(model, {
      mode: 'directory',
      collisionBehavior: 'error',
      inspector: inspector(),
      generator: bpmn,
      bilingualAudit: audit(),
      generatedIds: [
        {
          entity: 'node',
          processId: 'leave_approval',
          generatedId: 'Step_generated',
          worksheet: 'Steps',
          row: 2
        }
      ],
      inferredFlows: [
        {
          processId: 'leave_approval',
          flowId: 'Flow_generated',
          sourceStepId: 'Start_1',
          targetStepId: 'Task_1',
          reason: 'numeric-order'
        }
      ],
      now: fixedNow()
    })

    expect(plan.status).toBe('ready')
    expect(plan.delivery).toBe('workspace')
    expect(plan.sourceFile).toBe('processes.xlsx')
    expect(plan.artifacts).toHaveLength(1)
    expect(plan.artifacts[0]!.destination).toEqual({
      processId: 'leave_approval',
      path: 'leave-approval.bpmn',
      behavior: 'create'
    })
    expect(plan.artifacts[0]!.checksumSha256).toBe(sha256Hex(plan.artifacts[0]!.generated.bytes))
    expect(bpmn.generate).toHaveBeenCalledOnce()
    expect(plan.generatedIds).toHaveLength(1)
    expect(plan.inferredFlows).toHaveLength(1)
  })

  it('does no parsing/generation work after blocking validation', async () => {
    const bpmn = generator()
    const destination = inspector()
    const plan = await prepareTransactionalImportPlan(validModel({ nodes: [], flows: [] }), {
      mode: 'directory',
      collisionBehavior: 'error',
      inspector: destination,
      generator: bpmn,
      bilingualAudit: audit(),
      mappingPreset: mappingPreset(),
      now: fixedNow()
    })
    expect(plan.status).toBe('blocked')
    expect(plan.blockingReason).toBe('blocking-validation')
    expect(plan.mappingPreset).toEqual(mappingPreset())
    expect(bpmn.generate).not.toHaveBeenCalled()
    expect(destination.inspect).not.toHaveBeenCalled()
  })

  it('blocks incomplete bilingual audits before BPMN generation', async () => {
    const bpmn = generator()
    const plan = await prepareTransactionalImportPlan(validModel(), {
      mode: 'opfs',
      collisionBehavior: 'error',
      inspector: inspector(),
      generator: bpmn,
      bilingualAudit: audit(false),
      now: fixedNow()
    })
    expect(plan.status).toBe('blocked')
    expect(plan.blockingReason).toBe('translation-review')
    expect(plan.validation.issues).toContainEqual(
      expect.objectContaining({
        code: 'translation-review-required',
        severity: 'review'
      })
    )
    expect(bpmn.generate).not.toHaveBeenCalled()
  })

  it('handles path collisions according to error, rename, and overwrite policies', async () => {
    const existing = { 'leave-approval.bpmn': 'old-hash' }
    const blocked = await prepareTransactionalImportPlan(validModel(), {
      mode: 'directory',
      collisionBehavior: 'error',
      inspector: inspector(existing),
      generator: generator(),
      bilingualAudit: audit(),
      now: fixedNow()
    })
    expect(blocked.status).toBe('blocked')
    expect(blocked.validation.issues).toContainEqual(
      expect.objectContaining({ code: 'destination-path-collision' })
    )

    const renamed = await prepareTransactionalImportPlan(validModel(), {
      mode: 'directory',
      collisionBehavior: 'rename',
      inspector: inspector(existing),
      generator: generator(),
      bilingualAudit: audit(),
      now: fixedNow()
    })
    expect(renamed.artifacts[0]!.destination).toMatchObject({
      path: 'leave-approval-2.bpmn',
      behavior: 'create'
    })

    const overwritten = await prepareTransactionalImportPlan(validModel(), {
      mode: 'directory',
      collisionBehavior: 'overwrite',
      inspector: inspector(existing),
      generator: generator(),
      bilingualAudit: audit(),
      now: fixedNow()
    })
    expect(overwritten.artifacts[0]!.destination).toEqual({
      processId: 'leave_approval',
      path: 'leave-approval.bpmn',
      behavior: 'overwrite',
      expectedHash: 'old-hash'
    })

    const unsafeOverwrite = await prepareTransactionalImportPlan(validModel(), {
      mode: 'directory',
      collisionBehavior: 'overwrite',
      inspector: inspector({ 'leave-approval.bpmn': true }),
      generator: generator(),
      bilingualAudit: audit(),
      now: fixedNow()
    })
    expect(unsafeOverwrite.status).toBe('blocked')
    expect(unsafeOverwrite.validation.issues).toContainEqual(
      expect.objectContaining({ code: 'destination-hash-missing' })
    )
  })

  it('turns destination-inspection and bilingual-audit failures into truthful blocked plans', async () => {
    const inspectFailure = await prepareTransactionalImportPlan(validModel(), {
      mode: 'directory',
      collisionBehavior: 'error',
      inspector: { inspect: async () => Promise.reject(new Error('permission lost')) },
      generator: generator(),
      bilingualAudit: audit(),
      now: fixedNow()
    })
    expect(inspectFailure.status).toBe('blocked')
    expect(inspectFailure.validation.issues).toContainEqual(
      expect.objectContaining({ code: 'destination-inspection-failed' })
    )

    const auditFailure = await prepareTransactionalImportPlan(validModel(), {
      mode: 'directory',
      collisionBehavior: 'error',
      inspector: inspector(),
      generator: generator(),
      bilingualAudit: {
        audit: () => {
          throw new Error('audit unavailable')
        }
      },
      now: fixedNow()
    })
    expect(auditFailure.status).toBe('blocked')
    expect(auditFailure.blockingReason).toBe('translation-review')
    expect(auditFailure.validation.issues).toContainEqual(
      expect.objectContaining({ code: 'bilingual-audit-failed' })
    )

    const missingState = await prepareTransactionalImportPlan(validModel(), {
      mode: 'directory',
      collisionBehavior: 'error',
      inspector: { inspect: async () => [] },
      generator: generator(),
      bilingualAudit: audit(),
      now: fixedNow()
    })
    expect(missingState.validation.issues).toContainEqual(
      expect.objectContaining({ code: 'destination-inspection-failed' })
    )
  })

  it('blocks any structural/XSD/lint/link/DI pipeline error and keeps previews read-only', async () => {
    const plan = await prepareTransactionalImportPlan(validModel(), {
      mode: 'directory',
      collisionBehavior: 'error',
      inspector: inspector(),
      generator: generator([
        {
          stage: 'xsd',
          severity: 'error',
          code: 'invalid-sequence-flow',
          details: { elementId: 'Flow_1' }
        },
        { stage: 'lint', severity: 'warning', code: 'label-style' }
      ]),
      bilingualAudit: audit(),
      now: fixedNow()
    })
    expect(plan.status).toBe('blocked')
    expect(plan.blockingReason).toBe('pipeline-validation')
    expect(plan.artifacts).toHaveLength(1)
    expect(plan.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'pipeline-xsd-invalid-sequence-flow' }),
        expect.objectContaining({ code: 'pipeline-lint-label-style' })
      ])
    )
  })

  it('derives safe localized destination names, folders, and reserved-name escapes', async () => {
    const cases = [
      {
        process: validProcess({
          name: bilingual('CON', 'كون'),
          folder: 'Operations'
        }),
        path: 'Operations/con-file.bpmn'
      },
      {
        process: validProcess({
          name: bilingual('', 'عملية', 'ar'),
          activeLanguage: 'ar'
        }),
        path: /^process-[a-f0-9]{8}\.bpmn$/
      },
      {
        process: validProcess({
          name: bilingual('PRN', '', 'ar'),
          activeLanguage: 'ar'
        }),
        path: 'prn-file.bpmn'
      },
      {
        process: validProcess({
          name: bilingual('', 'AUX'),
          activeLanguage: 'en'
        }),
        path: 'aux-file.bpmn'
      }
    ] as const

    for (const entry of cases) {
      const plan = await prepareTransactionalImportPlan(
        validModel({ processes: [entry.process] }),
        {
          mode: 'directory',
          collisionBehavior: 'error',
          inspector: inspector(),
          generator: generator(),
          bilingualAudit: audit(),
          now: fixedNow()
        }
      )
      expect(plan.status).toBe('ready')
      if (entry.path instanceof RegExp) {
        expect(plan.artifacts[0]!.destination.path).toMatch(entry.path)
      } else {
        expect(plan.artifacts[0]!.destination.path).toBe(entry.path)
      }
    }
  })

  it('rejects invalid generator contracts and preserves explicit cancellation', async () => {
    const invalid = await prepareTransactionalImportPlan(validModel(), {
      mode: 'directory',
      collisionBehavior: 'error',
      inspector: inspector(),
      generator: {
        generate: async () => ({
          processId: 'wrong-process',
          semanticXml: '<definitions/>',
          layoutedXml: '<definitions/>',
          bytes: new Uint8Array(),
          diagnostics: []
        })
      },
      bilingualAudit: audit(),
      now: fixedNow()
    })
    expect(invalid.status).toBe('blocked')
    expect(invalid.validation.issues).toContainEqual(
      expect.objectContaining({ code: 'pipeline-generation-failed' })
    )

    await expect(
      prepareTransactionalImportPlan(validModel(), {
        mode: 'directory',
        collisionBehavior: 'error',
        inspector: inspector(),
        generator: {
          generate: async () => {
            throw new SpreadsheetError('parse-cancelled')
          }
        },
        bilingualAudit: audit(),
        now: fixedNow()
      })
    ).rejects.toMatchObject({ code: 'parse-cancelled' })
  })

  it('selects open-single or ZIP delivery without changing graph generation semantics', async () => {
    const single = await prepareTransactionalImportPlan(validModel(), {
      mode: 'single-file',
      collisionBehavior: 'error',
      inspector: inspector(),
      generator: generator(),
      bilingualAudit: audit(),
      now: fixedNow()
    })
    expect(single.delivery).toBe('open-single')

    const multiple = await prepareTransactionalImportPlan(secondProcessModel(), {
      mode: 'single-file',
      collisionBehavior: 'error',
      inspector: inspector(),
      generator: generator(),
      bilingualAudit: audit(),
      now: fixedNow()
    })
    expect(multiple.delivery).toBe('zip')
    expect(multiple.artifacts).toHaveLength(2)
  })
})

describe('transaction execution and import reports', () => {
  async function readyPlan(overwrite = false) {
    return prepareTransactionalImportPlan(validModel(), {
      mode: 'directory',
      collisionBehavior: overwrite ? 'overwrite' : 'error',
      inspector: inspector(overwrite ? { 'leave-approval.bpmn': 'base-hash' } : {}),
      generator: generator(),
      bilingualAudit: audit(),
      now: fixedNow()
    })
  }

  it('stages every artifact and reports committed only after commit resolves', async () => {
    const plan = await readyPlan(true)
    const transaction: ImportDestinationTransaction = {
      stage: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined)
    }
    const factory: ImportTransactionFactory = {
      begin: vi.fn(async () => transaction)
    }
    const report = await executeTransactionalImportPlan(plan, {
      transactionFactory: factory,
      now: fixedNow()
    })

    expect(report.status).toBe('committed')
    expect(transaction.stage).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'leave-approval.bpmn',
        expectedHash: 'base-hash',
        createRecoveryRevision: true
      })
    )
    expect(transaction.commit).toHaveBeenCalledOnce()
    expect(transaction.rollback).not.toHaveBeenCalled()
    expect(report.artifacts[0]).toMatchObject({
      processId: 'leave_approval',
      destinationPath: 'leave-approval.bpmn',
      checksumSha256: plan.artifacts[0]!.checksumSha256
    })
    const serialized = serializeSpreadsheetImportReport(report)
    expect(serialized.endsWith('\n')).toBe(true)
    expect(serializeSpreadsheetImportReport(report)).toBe(serialized)
  })

  it('rolls back stage and commit failures without a false-success report', async () => {
    for (const failure of ['stage', 'commit'] as const) {
      const plan = await readyPlan()
      const transaction: ImportDestinationTransaction = {
        stage: vi.fn(async () => {
          if (failure === 'stage') throw new Error('stage failed')
        }),
        commit: vi.fn(async () => {
          if (failure === 'commit') throw new Error('commit failed')
        }),
        rollback: vi.fn(async () => undefined)
      }
      const report = await executeTransactionalImportPlan(plan, {
        transactionFactory: { begin: async () => transaction },
        now: fixedNow()
      })
      expect(report.status).toBe('rolled-back')
      expect(report.failure).toEqual({ code: 'transaction-failed', stage: failure })
      expect(transaction.rollback).toHaveBeenCalledOnce()
    }
  })

  it('truthfully reports a failed rollback as indeterminate instead of committed', async () => {
    const plan = await readyPlan()
    const report = await executeTransactionalImportPlan(plan, {
      transactionFactory: {
        begin: async () => ({
          stage: async () => {
            throw new Error('storage failure')
          },
          commit: async () => undefined,
          rollback: async () => {
            throw new Error('rollback failure')
          }
        })
      },
      now: fixedNow()
    })
    expect(report.status).toBe('rollback-failed')
    expect(report.failure).toEqual({ code: 'transaction-failed', stage: 'rollback' })
  })

  it('returns a failure report when a transaction cannot be opened', async () => {
    const plan = await readyPlan()
    const report = await executeTransactionalImportPlan(plan, {
      transactionFactory: {
        begin: async () => {
          throw new Error('permission lost')
        }
      },
      now: fixedNow()
    })
    expect(report.status).toBe('rolled-back')
    expect(report.failure).toEqual({ code: 'transaction-failed', stage: 'stage' })
  })

  it('never opens a transaction for a blocked plan', async () => {
    const blocked = await prepareTransactionalImportPlan(validModel({ nodes: [], flows: [] }), {
      mode: 'directory',
      collisionBehavior: 'error',
      inspector: inspector(),
      generator: generator(),
      bilingualAudit: audit(),
      now: fixedNow()
    })
    const factory = { begin: vi.fn() }
    const report = await executeTransactionalImportPlan(blocked, {
      transactionFactory: factory,
      now: fixedNow()
    })
    expect(report.status).toBe('blocked')
    expect(report.mapping).toBeUndefined()
    expect(factory.begin).not.toHaveBeenCalled()
  })

  it('uses real timestamps by default and carries a sanitized mapping into reports', async () => {
    const plan = await prepareTransactionalImportPlan(validModel(), {
      mode: 'directory',
      collisionBehavior: 'error',
      inspector: inspector(),
      generator: generator(),
      bilingualAudit: audit(),
      mappingPreset: mappingPreset()
    })
    const report = await executeTransactionalImportPlan(plan, {
      transactionFactory: {
        begin: async () => ({
          stage: async () => undefined,
          commit: async () => undefined,
          rollback: async () => undefined
        })
      }
    })

    expect(Number.isNaN(Date.parse(plan.createdAt))).toBe(false)
    expect(Number.isNaN(Date.parse(report.completedAt))).toBe(false)
    expect(report.mapping).toEqual(mappingPreset())
  })
})

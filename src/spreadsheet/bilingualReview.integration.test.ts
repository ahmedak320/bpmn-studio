import { describe, expect, it, vi } from 'vitest'

import {
  mergeReviewedBpmnIntoWorkbook,
  processGraphsFromWorkbook,
  reviewProcessWorkbookBilingual,
  type SpreadsheetBilingualReviewRequest
} from './bilingualReview'
import { SpreadsheetBilingualAudit, SpreadsheetBpmnGenerator } from './bpmnGeneration'
import {
  PROCESS_WORKBOOK_MODEL_VERSION,
  type ProcessWorkbookModel,
  type WorkbookFlow,
  type WorkbookNode,
  type WorkbookParticipant,
  type WorkbookProcess
} from './contracts'
import { SpreadsheetError } from './errors'
import { bilingual, provenance } from './testFixtures'

function process(id: string, english: string, arabic: string, row: number): WorkbookProcess {
  return {
    id,
    idOrigin: 'explicit',
    name: bilingual(english, arabic),
    ...(id === 'Process_A'
      ? {
          description: bilingual('Customer request lifecycle', 'دورة حياة طلب المتعامل'),
          owner: bilingual('Process owner', 'مالك العملية')
        }
      : {}),
    activeLanguage: 'en',
    provenance: provenance('Processes', row, ['process_id', 'name_en', 'name_ar'])
  }
}

function participants(processId: string, suffix: string, row: number): WorkbookParticipant[] {
  const arabicSuffix = suffix === 'A' ? 'ألف' : 'باء'
  return [
    {
      processId,
      id: `Pool_${suffix}`,
      idOrigin: 'explicit',
      type: 'pool',
      order: 1,
      name: bilingual(`Pool ${suffix}`, `مجموعة ${arabicSuffix}`),
      provenance: provenance('Participants', row, ['process_id', 'participant_id'])
    },
    {
      processId,
      id: `Lane_${suffix}`,
      idOrigin: 'explicit',
      type: 'lane',
      parentId: `Pool_${suffix}`,
      order: 1,
      name: bilingual(`Team ${suffix}`, `فريق ${arabicSuffix}`),
      provenance: provenance('Participants', row + 1, ['process_id', 'participant_id'])
    }
  ]
}

function nodes(processId: string, suffix: string, row: number): WorkbookNode[] {
  const arabicSuffix = suffix === 'A' ? 'ألف' : 'باء'
  return [
    {
      processId,
      id: `Start_${suffix}`,
      idOrigin: 'explicit',
      order: 1,
      type: 'startEvent',
      name: bilingual(`Start ${suffix}`, `بداية ${arabicSuffix}`),
      laneId: `Lane_${suffix}`,
      metadata: {},
      provenance: provenance('Steps', row, ['process_id', 'step_id', 'name_en', 'name_ar'])
    },
    {
      processId,
      id: `Task_${suffix}`,
      idOrigin: 'explicit',
      order: 2,
      type: 'userTask',
      name: { en: `Review ${suffix}`, active: 'en' },
      laneId: `Lane_${suffix}`,
      metadata:
        suffix === 'A'
          ? {
              owner: bilingual('Case owner', 'مالك الحالة'),
              raci: 'R',
              responsibleParties: [
                bilingual('Case officer', 'موظف الحالة'),
                bilingual('Supervisor', 'المشرف')
              ],
              channel: bilingual('Email', 'البريد الإلكتروني'),
              channelDetail: bilingual('Shared inbox', 'صندوق البريد المشترك'),
              inputs: [bilingual('Application', 'الطلب')],
              outputs: [bilingual('Decision', 'القرار')],
              cc: [bilingual('Quality team', 'فريق الجودة')],
              decisionBasis: bilingual('Service policy', 'سياسة الخدمة'),
              triggers: bilingual('Request received', 'استلام الطلب'),
              notes: bilingual('Check attachments', 'التحقق من المرفقات')
            }
          : {},
      provenance: provenance('Steps', row + 1, [
        'process_id',
        'step_id',
        'name_en',
        'name_ar',
        'owner_en',
        'owner_ar'
      ])
    },
    {
      processId,
      id: `End_${suffix}`,
      idOrigin: 'explicit',
      order: 3,
      type: 'endEvent',
      name: bilingual(`End ${suffix}`, `نهاية ${arabicSuffix}`),
      laneId: `Lane_${suffix}`,
      metadata: {},
      provenance: provenance('Steps', row + 2, ['process_id', 'step_id'])
    }
  ]
}

function flows(processId: string, suffix: string, row: number): WorkbookFlow[] {
  return [
    {
      processId,
      id: `Flow_${suffix}_1`,
      idOrigin: 'explicit',
      sourceStepId: `Start_${suffix}`,
      targetStepId: `Task_${suffix}`,
      isDefault: false,
      origin: 'explicit',
      provenance: provenance('Flows', row, ['process_id', 'flow_id'])
    },
    {
      processId,
      id: `Flow_${suffix}_2`,
      idOrigin: 'explicit',
      sourceStepId: `Task_${suffix}`,
      targetStepId: `End_${suffix}`,
      condition: bilingual('Completed', 'مكتمل'),
      isDefault: false,
      origin: 'explicit',
      provenance: provenance('Flows', row + 1, ['process_id', 'flow_id'])
    }
  ]
}

function twoProcessModel(): ProcessWorkbookModel {
  return {
    version: PROCESS_WORKBOOK_MODEL_VERSION,
    source: {
      fileName: 'two-processes.xlsx',
      format: 'xlsx',
      officialTemplate: true,
      worksheets: []
    },
    processes: [
      process('Process_A', 'Process alpha', 'العملية ألف', 2),
      process('Process_B', 'Process beta', 'العملية باء', 3)
    ],
    participants: [...participants('Process_A', 'A', 2), ...participants('Process_B', 'B', 4)],
    nodes: [...nodes('Process_A', 'A', 2), ...nodes('Process_B', 'B', 6)],
    flows: [...flows('Process_A', 'A', 2), ...flows('Process_B', 'B', 4)],
    glossary: []
  }
}

function completeTaskName(request: SpreadsheetBilingualReviewRequest): string {
  const suffix = request.processId === 'Process_A' ? 'A' : 'B'
  const arabic = suffix === 'A' ? 'مراجعة ألف' : 'مراجعة باء'
  const marker = `name="Review ${suffix}"`
  expect(request.xml).toContain(marker)
  return request.xml.replace(
    marker,
    `${marker} orbitpm:nameEn="Review ${suffix}" orbitpm:nameAr="${arabic}"`
  )
}

function reasonOf(error: unknown): string | undefined {
  return error instanceof SpreadsheetError ? String(error.details.reason) : undefined
}

async function generatedXml(model: ProcessWorkbookModel, processId: string): Promise<string> {
  const graph = processGraphsFromWorkbook(model).find(
    (candidate) => candidate.process.id === processId
  )!
  return (
    await new SpreadsheetBpmnGenerator({
      requireBilingual: false,
      validationAdapters: []
    }).generate(graph)
  ).layoutedXml
}

describe('spreadsheet bilingual review continuation', () => {
  it('merges every reviewed process by stable IDs and preserves immutable provenance', async () => {
    const original = twoProcessModel()
    const taskA = original.nodes.find(({ id }) => id === 'Task_A')!
    const callbacks: SpreadsheetBilingualReviewRequest[] = []
    const review = vi.fn(async (request: SpreadsheetBilingualReviewRequest) => {
      callbacks.push(request)
      let reviewedXml = completeTaskName(request)
      if (request.processId === 'Process_A') {
        expect(reviewedXml).toContain('orbitpm:descriptionEn="Customer request lifecycle"')
        expect(reviewedXml).toContain('orbitpm:channelEn="Email"')
        expect(reviewedXml).toContain('orbitpm:raci="R"')
        reviewedXml = reviewedXml.replace(
          'orbitpm:ownerAr="مالك الحالة"',
          'orbitpm:ownerAr="مالك الطلب"'
        )
      }
      return { status: 'completed' as const, reviewedXml }
    })

    const outcome = await reviewProcessWorkbookBilingual(original, {
      generator: new SpreadsheetBpmnGenerator({
        requireBilingual: false
      }),
      review
    })

    expect(outcome.status).toBe('completed')
    if (outcome.status !== 'completed') throw new Error('review cancelled')
    expect(callbacks.map(({ processId, ordinal, total }) => [processId, ordinal, total])).toEqual([
      ['Process_A', 1, 2],
      ['Process_B', 2, 2]
    ])
    expect(outcome.model.nodes.find(({ id }) => id === 'Task_A')?.name).toEqual(
      bilingual('Review A', 'مراجعة ألف')
    )
    expect(outcome.model.nodes.find(({ id }) => id === 'Task_B')?.name).toEqual(
      bilingual('Review B', 'مراجعة باء')
    )
    expect(outcome.model.nodes.find(({ id }) => id === 'Task_A')?.metadata.owner).toEqual(
      bilingual('Case owner', 'مالك الطلب')
    )
    expect(
      outcome.model.nodes.find(({ id }) => id === 'Task_A')?.metadata.responsibleParties
    ).toEqual([bilingual('Case officer', 'موظف الحالة'), bilingual('Supervisor', 'المشرف')])
    expect(outcome.model.nodes.find(({ id }) => id === 'Task_A')?.provenance).toBe(taskA.provenance)
    expect(outcome.model.source).toBe(original.source)
    expect(outcome.model.glossary).toBe(original.glossary)
    expect(original.nodes.find(({ id }) => id === 'Task_A')?.name.ar).toBeUndefined()
    expect(Object.isFrozen(outcome.model)).toBe(true)
    expect(Object.isFrozen(outcome.model.nodes)).toBe(true)
    expect(Object.isFrozen(outcome.model.nodes.find(({ id }) => id === 'Task_A'))).toBe(true)

    const audit = new SpreadsheetBilingualAudit()
    expect(
      processGraphsFromWorkbook(outcome.model).every((graph) => audit.audit(graph).complete)
    ).toBe(true)
  })

  it('returns explicit cancellation without exposing a partially merged model', async () => {
    const original = twoProcessModel()
    const review = vi.fn(async (request: SpreadsheetBilingualReviewRequest) =>
      request.processId === 'Process_A'
        ? { status: 'completed' as const, reviewedXml: completeTaskName(request) }
        : { status: 'cancelled' as const }
    )

    const outcome = await reviewProcessWorkbookBilingual(original, {
      generator: new SpreadsheetBpmnGenerator({
        requireBilingual: false,
        validationAdapters: []
      }),
      review,
      validationAdapters: []
    })

    expect(outcome).toEqual({ status: 'cancelled', processId: 'Process_B' })
    expect(review).toHaveBeenCalledTimes(2)
    expect(original.nodes.find(({ id }) => id === 'Task_A')?.name.ar).toBeUndefined()
    expect(outcome).not.toHaveProperty('model')
  })

  it('round-trips ordered empty secondary pools as black-box participants', async () => {
    const base = twoProcessModel()
    const secondaryPool: WorkbookParticipant = {
      processId: 'Process_A',
      id: 'Pool_A_External',
      idOrigin: 'explicit',
      type: 'pool',
      order: 2,
      name: bilingual('External service', 'الخدمة الخارجية'),
      provenance: provenance('Participants', 20, ['process_id', 'participant_id'])
    }
    const model: ProcessWorkbookModel = {
      ...base,
      participants: [...base.participants, secondaryPool]
    }
    const initial = await generatedXml(model, 'Process_A')
    expect(initial).toMatch(/<bpmn:participant[^>]*id="Pool_A"[^>]*processRef="Process_A"[^>]*\/>/)
    expect(initial).toMatch(/<bpmn:participant[^>]*id="Pool_A_External"(?![^>]*processRef)[^>]*\/>/)

    const reviewed = completeTaskName({
      version: 1,
      processId: 'Process_A',
      suggestedName: 'Process_A.bpmn',
      xml: initial,
      ordinal: 1,
      total: 2,
      signal: new AbortController().signal
    })
    const merged = await mergeReviewedBpmnIntoWorkbook(model, 'Process_A', reviewed, {
      validationAdapters: []
    })

    expect(
      merged.participants
        .filter(({ processId, type }) => processId === 'Process_A' && type === 'pool')
        .map(({ id, order, provenance: source }) => [id, order, source])
    ).toEqual([
      ['Pool_A', 1, model.participants.find(({ id }) => id === 'Pool_A')!.provenance],
      ['Pool_A_External', 2, secondaryPool.provenance]
    ])
    const regenerated = await generatedXml(merged, 'Process_A')
    expect(regenerated).toMatch(
      /<bpmn:participant[^>]*id="Pool_A"[^>]*processRef="Process_A"[^>]*\/>/
    )
    expect(regenerated).toMatch(
      /<bpmn:participant[^>]*id="Pool_A_External"(?![^>]*processRef)[^>]*\/>/
    )
  })

  it('fails closed on secondary-pool process refs, lanes, and node assignments', async () => {
    const base = twoProcessModel()
    const secondaryPool: WorkbookParticipant = {
      processId: 'Process_A',
      id: 'Pool_A_External',
      idOrigin: 'explicit',
      type: 'pool',
      order: 2,
      name: bilingual('External service', 'الخدمة الخارجية'),
      provenance: provenance('Participants', 20, ['process_id', 'participant_id'])
    }
    const validModel: ProcessWorkbookModel = {
      ...base,
      participants: [...base.participants, secondaryPool]
    }
    const initial = completeTaskName({
      version: 1,
      processId: 'Process_A',
      suggestedName: 'Process_A.bpmn',
      xml: await generatedXml(validModel, 'Process_A'),
      ordinal: 1,
      total: 2,
      signal: new AbortController().signal
    })
    const reboundSecondary = initial.replace(
      'id="Pool_A_External"',
      'id="Pool_A_External" processRef="Process_A"'
    )
    await expect(
      mergeReviewedBpmnIntoWorkbook(validModel, 'Process_A', reboundSecondary, {
        validationAdapters: []
      })
    ).rejects.toSatisfy(
      (error: unknown) =>
        reasonOf(error) === 'participant-schema-changed' &&
        error instanceof SpreadsheetError &&
        error.details.field === 'processRef'
    )

    const lane = validModel.participants.find(({ id }) => id === 'Lane_A')!
    const secondaryLaneModel: ProcessWorkbookModel = {
      ...validModel,
      participants: validModel.participants.map((participant) =>
        participant.id === lane.id
          ? {
              ...participant,
              parentId: secondaryPool.id
            }
          : participant
      )
    }
    await expect(
      mergeReviewedBpmnIntoWorkbook(secondaryLaneModel, 'Process_A', initial, {
        validationAdapters: []
      })
    ).rejects.toSatisfy(
      (error: unknown) =>
        reasonOf(error) === 'participant-schema-changed' &&
        error instanceof SpreadsheetError &&
        error.details.field === 'secondaryPoolAssignment' &&
        error.details.elementId === 'Lane_A'
    )

    const secondaryNodeModel: ProcessWorkbookModel = {
      ...validModel,
      nodes: validModel.nodes.map((node) =>
        node.id === 'Start_A'
          ? {
              ...node,
              laneId: undefined,
              poolId: secondaryPool.id
            }
          : node
      )
    }
    await expect(
      mergeReviewedBpmnIntoWorkbook(secondaryNodeModel, 'Process_A', initial, {
        validationAdapters: []
      })
    ).rejects.toSatisfy(
      (error: unknown) =>
        reasonOf(error) === 'participant-schema-changed' &&
        error instanceof SpreadsheetError &&
        error.details.field === 'secondaryPoolAssignment' &&
        error.details.elementId === 'Start_A'
    )
  })

  it('rejects wrong-process and stale graph results by exact stable identity', async () => {
    const model = twoProcessModel()
    const processB = completeTaskName({
      version: 1,
      processId: 'Process_B',
      suggestedName: 'Process_B.bpmn',
      xml: await generatedXml(model, 'Process_B'),
      ordinal: 2,
      total: 2,
      signal: new AbortController().signal
    })
    await expect(
      mergeReviewedBpmnIntoWorkbook(model, 'Process_A', processB, {
        validationAdapters: []
      })
    ).rejects.toSatisfy((error: unknown) => reasonOf(error) === 'wrong-process')

    const processA = completeTaskName({
      version: 1,
      processId: 'Process_A',
      suggestedName: 'Process_A.bpmn',
      xml: await generatedXml(model, 'Process_A'),
      ordinal: 1,
      total: 2,
      signal: new AbortController().signal
    }).replaceAll('Task_A', 'Task_Stale')
    await expect(
      mergeReviewedBpmnIntoWorkbook(model, 'Process_A', processA, {
        validationAdapters: []
      })
    ).rejects.toSatisfy((error: unknown) => reasonOf(error) === 'graph-identity-changed')
  })

  it('rejects incomplete, wrong-script, structurally changed, and unsafe review XML', async () => {
    const model = twoProcessModel()
    const initial = await generatedXml(model, 'Process_A')
    await expect(
      mergeReviewedBpmnIntoWorkbook(model, 'Process_A', initial, {
        validationAdapters: []
      })
    ).rejects.toSatisfy((error: unknown) => reasonOf(error) === 'incomplete-bilingual-field')

    const wrongScript = initial.replace(
      'name="Review A"',
      'name="Review A" orbitpm:nameEn="Review A" orbitpm:nameAr="Review A"'
    )
    await expect(
      mergeReviewedBpmnIntoWorkbook(model, 'Process_A', wrongScript, {
        validationAdapters: []
      })
    ).rejects.toSatisfy((error: unknown) => reasonOf(error) === 'wrong-script')

    const changedTopology = completeTaskName({
      version: 1,
      processId: 'Process_A',
      suggestedName: 'Process_A.bpmn',
      xml: initial,
      ordinal: 1,
      total: 2,
      signal: new AbortController().signal
    }).replace('targetRef="Task_A"', 'targetRef="End_A"')
    await expect(
      mergeReviewedBpmnIntoWorkbook(model, 'Process_A', changedTopology, {
        validationAdapters: []
      })
    ).rejects.toSatisfy((error: unknown) =>
      ['flow-topology-changed', 'graph-schema-changed'].includes(reasonOf(error) ?? '')
    )

    await expect(
      mergeReviewedBpmnIntoWorkbook(
        model,
        'Process_A',
        `<!DOCTYPE definitions [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${initial}`,
        { validationAdapters: [] }
      )
    ).rejects.toSatisfy((error: unknown) => {
      return (
        reasonOf(error) === 'reviewed-xml-invalid' &&
        error instanceof SpreadsheetError &&
        error.details.validationCode === 'xml.doctype'
      )
    })
  })
})

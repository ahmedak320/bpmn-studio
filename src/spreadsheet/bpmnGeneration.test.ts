import { describe, expect, it } from 'vitest'

import type { ProcessGraphModel } from './contracts'
import { SpreadsheetBilingualAudit, SpreadsheetBpmnGenerator } from './bpmnGeneration'
import { buildProcessWorkbookModel, officialTemplatePreset } from './modelBuilder'
import { detectOfficialTemplate } from './officialTemplate'
import { handleSpreadsheetWorkerRequest } from './spreadsheet.worker'
import { validFlows, validNodes, validParticipants, validProcess } from './testFixtures'
import { createOfficialWorkbookTemplate, OFFICIAL_TEMPLATE_ASSET_NAMES } from './template'
import type { SpreadsheetWorkerResponse } from './workerProtocol'

function graph(): ProcessGraphModel {
  const nodes = validNodes().map((node) => ({
    ...node,
    laneId: 'Lane_1'
  }))
  return {
    process: validProcess(),
    participants: validParticipants(),
    nodes,
    flows: validFlows(),
    glossary: []
  }
}

describe('spreadsheet BPMN product adapters', () => {
  it('audits graph bilingual values through the shared localization rules', () => {
    const audit = new SpreadsheetBilingualAudit()
    expect(audit.audit(graph())).toEqual({
      complete: true,
      missing: 0,
      invalid: 0,
      translationRequired: false
    })
    expect(
      audit.audit({
        ...graph(),
        process: {
          ...graph().process,
          owner: { active: 'en' },
          description: { active: 'en' }
        },
        nodes: graph().nodes.map((node) => ({
          ...node,
          metadata: {
            ...node.metadata,
            owner: { active: 'en' },
            notes: { active: 'en' }
          }
        }))
      })
    ).toEqual({
      complete: true,
      missing: 0,
      invalid: 0,
      translationRequired: false
    })
    expect(
      audit.audit({
        ...graph(),
        nodes: graph().nodes.map((node, index) =>
          index === 1 ? { ...node, name: { en: 'Review', active: 'en' } } : node
        )
      })
    ).toMatchObject({ complete: false, missing: 1, translationRequired: true })
  })

  it('creates bilingual moddle XML and sends it through validated layout', async () => {
    const generator = new SpreadsheetBpmnGenerator({ validationAdapters: [] })
    const artifact = await generator.generate(graph())
    expect(artifact.processId).toBe('leave_approval')
    expect(artifact.semanticXml).toContain('orbitpm:nameEn="Review"')
    expect(artifact.semanticXml).toContain('orbitpm:nameAr="مراجعة"')
    expect(artifact.semanticXml).toContain('bpmn:lane')
    expect(artifact.semanticXml).toContain('bpmn:participant')
    expect(artifact.layoutedXml).toContain('bpmndi:BPMNDiagram')
    expect(new TextDecoder().decode(artifact.bytes)).toBe(artifact.layoutedXml)
    expect(artifact.diagnostics.every(({ severity }) => severity !== 'error')).toBe(true)
  })

  it('passes the production runtime validators', async () => {
    const artifact = await new SpreadsheetBpmnGenerator().generate(graph())
    expect(artifact.layoutedXml).toContain('bpmndi:BPMNDiagram')
    expect(artifact.diagnostics.every(({ severity }) => severity !== 'error')).toBe(true)
  })

  it('passes production validators for the official example workbook', async () => {
    const responses: SpreadsheetWorkerResponse[] = []
    const bytes = createOfficialWorkbookTemplate('example')
    const input = new Uint8Array(bytes)
    await handleSpreadsheetWorkerRequest(
      {
        type: 'parse',
        requestId: 'official-generation',
        format: 'xlsx',
        bytes: input.buffer
      },
      (response) => responses.push(response)
    )
    const result = responses.find(
      (
        response
      ): response is Extract<SpreadsheetWorkerResponse, { type: 'result'; format: 'xlsx' }> =>
        response.type === 'result' && response.format === 'xlsx'
    )
    expect(result).toBeDefined()
    const detection = detectOfficialTemplate(result!.workbook)
    const built = buildProcessWorkbookModel(result!.workbook, {
      fileName: OFFICIAL_TEMPLATE_ASSET_NAMES.example,
      format: 'xlsx',
      officialTemplate: true,
      templateVersion: detection.templateVersion,
      preset: officialTemplatePreset(result!.workbook, detection)
    })
    const process = built.model.processes[0]!
    const artifact = await new SpreadsheetBpmnGenerator().generate({
      process,
      participants: built.model.participants.filter(({ processId }) => processId === process.id),
      nodes: built.model.nodes.filter(({ processId }) => processId === process.id),
      flows: built.model.flows.filter(({ processId }) => processId === process.id),
      glossary: built.model.glossary
    })
    expect(artifact.layoutedXml).toContain('bpmndi:BPMNDiagram')
  })
})

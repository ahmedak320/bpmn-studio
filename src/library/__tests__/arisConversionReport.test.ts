import { describe, expect, it } from 'vitest'
import { AML_REPORT_SAMPLE } from '../__fixtures__/aml-report-sample'
import {
  ARIS_CONVERSION_REPORT_FORMAT,
  ARIS_CONVERSION_REPORT_MIME_TYPE,
  ARIS_CONVERSION_REPORT_VERSION,
  convertAmlToBpmnFiles,
  convertApcToBpmn,
  createArisConversionReportDownload,
  serializeArisConversionReport
} from '../apcImport'

describe('ARIS conversion report', () => {
  it('accounts for converted, downgraded, ignored, ambiguous, and unmapped objects', async () => {
    const result = await convertAmlToBpmnFiles(AML_REPORT_SAMPLE)
    if (!('files' in result)) throw new Error(`conversion failed: ${result.error}`)

    expect(result.files).toHaveLength(4)
    expect(result.report).toMatchObject({
      format: ARIS_CONVERSION_REPORT_FORMAT,
      version: ARIS_CONVERSION_REPORT_VERSION,
      source: {
        databaseName: 'Report fixture database',
        objectDefinitions: 13,
        models: 5
      },
      outputFiles: 4,
      summary: {
        converted: 7,
        downgraded: 2,
        ignored: 3,
        ambiguous: 2,
        unmapped: 3
      }
    })

    expect(
      result.report.downgraded.map(({ sourceObjectId, reason }) => [sourceObjectId, reason])
    ).toEqual([
      ['ObjDef.Custom', 'unknown-object-type-mapped-as-task'],
      ['ObjDef.Rule', 'unknown-rule-symbol-mapped-as-exclusive-gateway']
    ])
    expect(
      result.report.ignored.map(({ sourceObjectId, sourceModelId, reason }) => [
        sourceObjectId,
        sourceModelId,
        reason
      ])
    ).toEqual([
      ['ObjDef.UnusedSatellite', 'Model.Main', 'satellite-not-mapped'],
      ['ObjDef.Container', 'Model.Overview', 'overview-container-not-emitted'],
      ['ObjDef.UnsupportedModelOnly', 'Model.Unsupported', 'unsupported-model-type']
    ])
    expect(
      result.report.ambiguous.map(
        ({ sourceObjectId, reason, selectedSourceId, relatedSourceIds }) => ({
          sourceObjectId,
          reason,
          selectedSourceId,
          relatedSourceIds
        })
      )
    ).toEqual([
      {
        sourceObjectId: 'ObjDef.Main',
        reason: 'duplicate-object-occurrence-first-used',
        selectedSourceId: 'Occ.Main.1',
        relatedSourceIds: ['Occ.Main.1', 'Occ.Main.2']
      },
      {
        sourceObjectId: 'ObjDef.Main',
        reason: 'multiple-hierarchy-targets-first-used',
        selectedSourceId: 'Model.Child.A',
        relatedSourceIds: ['Model.Child.A', 'Model.Child.B']
      }
    ])
    expect(
      result.report.unmapped.map(({ sourceObjectId, reason, relatedSourceIds }) => ({
        sourceObjectId,
        reason,
        relatedSourceIds
      }))
    ).toEqual([
      {
        sourceObjectId: 'ObjDef.Orphan',
        reason: 'not-present-in-any-model',
        relatedSourceIds: undefined
      },
      {
        sourceObjectId: 'ObjDef.Main',
        reason: 'linked-model-not-converted',
        relatedSourceIds: ['Model.Missing']
      },
      {
        sourceObjectId: 'ObjDef.Missing',
        reason: 'missing-object-definition',
        relatedSourceIds: ['Occ.Missing']
      }
    ])

    expect(result.report.converted).toContainEqual(
      expect.objectContaining({
        sourceObjectId: 'ObjDef.Performer',
        sourceModelId: 'Model.Main',
        targetElementId: 'ObjDef_Main',
        targetProperty: 'orbitpm:respList',
        reason: 'mapped-metadata-attribute'
      })
    )
    expect(result.report.converted).toContainEqual(
      expect.objectContaining({
        sourceObjectId: 'ObjDef.Main',
        reason: 'mapped-call-activity',
        calledProcessId: 'Model_Child_A',
        relatedSourceIds: ['Model.Child.A']
      })
    )
  })

  it('serializes byte-identically and exposes a browser-neutral download payload', async () => {
    const first = await convertAmlToBpmnFiles(AML_REPORT_SAMPLE)
    const second = await convertAmlToBpmnFiles(AML_REPORT_SAMPLE)
    if (!('files' in first) || !('files' in second)) throw new Error('conversion failed')

    const firstJson = serializeArisConversionReport(first.report)
    expect(firstJson).toBe(serializeArisConversionReport(second.report))
    expect(firstJson.endsWith('\n')).toBe(true)
    expect(JSON.parse(firstJson)).toEqual(first.report)

    expect(createArisConversionReportDownload(first.report, 'exports/DMT Report.apc')).toEqual({
      fileName: 'DMT-Report-conversion-report.json',
      mimeType: ARIS_CONVERSION_REPORT_MIME_TYPE,
      text: firstJson
    })
  })

  it('preserves the report through the legacy first-file wrapper', async () => {
    const result = await convertApcToBpmn(AML_REPORT_SAMPLE)
    if (!('xml' in result)) throw new Error(`conversion failed: ${result.error}`)

    expect(result.xml).toContain('<process id="Model_Main"')
    expect(result.report.format).toBe(ARIS_CONVERSION_REPORT_FORMAT)
    expect(result.report.summary.ambiguous).toBe(2)
  })
})

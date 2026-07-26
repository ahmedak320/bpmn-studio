import { describe, expect, it } from 'vitest'
import BpmnModdle from 'bpmn-moddle'
import {
  LocalizationSource,
  auditBpmnLocalization,
  extractBpmnLocalization,
  type ModdleElementLike
} from '..'
import {
  ORG_ATTR_NAMES,
  orbitpmModdleDescriptor
} from '../../org/orbitpmModdle'

function bpmn(
  type: string,
  id: string,
  properties: Record<string, unknown> = {},
  attrs: Record<string, unknown> = {}
): ModdleElementLike {
  return {
    $type: `bpmn:${type}`,
    id,
    ...properties,
    $attrs: attrs
  }
}

function fieldKey(field: {
  processId: string
  elementId: string
  field: string
}): string {
  return `${field.processId}/${field.elementId}/${field.field}`
}

describe('moddle-friendly structural extraction', () => {
  it('extracts conditions, annotations, documentation, and all paired details from every process/plane', () => {
    const documentation = bpmn('Documentation', 'Doc_1', {
      text: 'Process note'
    }, {
      'orbitpm:nameEn': 'Process note',
      'orbitpm:nameAr': 'ملاحظة العملية'
    })
    const task = bpmn(
      'UserTask',
      'Task_approve',
      { name: 'Approve request' },
      {
        'orbitpm:nameEn': 'Approve request',
        'orbitpm:nameAr': 'اعتماد الطلب',
        'orbitpm:owner': 'Permits Department',
        'orbitpm:ownerEn': 'Permits Department',
        'orbitpm:ownerAr': 'إدارة التصاريح',
        'orbitpm:inputs': 'Application form',
        'orbitpm:inputsEn': 'Application form',
        'orbitpm:inputsAr': 'نموذج الطلب',
        'orbitpm:outputs': 'Decision notice',
        'orbitpm:outputsEn': 'Decision notice',
        'orbitpm:outputsAr': 'إشعار القرار',
        'orbitpm:respList': 'Case officer — Reviewer',
        'orbitpm:respListEn': 'Case officer — Reviewer',
        'orbitpm:respListAr': 'مسؤول الحالة — مراجع',
        'orbitpm:ccList': 'Legal — review',
        'orbitpm:ccListEn': 'Legal — review',
        'orbitpm:ccListAr': 'الشؤون القانونية — مراجعة',
        'orbitpm:channelDetail': 'Permits inbox',
        'orbitpm:channelDetailEn': 'Permits inbox',
        'orbitpm:channelDetailAr': 'صندوق وارد التصاريح'
      }
    )
    const gateway = bpmn(
      'ExclusiveGateway',
      'Gateway_complete',
      { name: 'Complete?' },
      {
        'orbitpm:nameEn': 'Complete?',
        'orbitpm:nameAr': 'هل الطلب مكتمل؟',
        'orbitpm:decisionBasis': 'Completeness policy',
        'orbitpm:decisionBasisEn': 'Completeness policy',
        'orbitpm:decisionBasisAr': 'سياسة الاكتمال'
      }
    )
    const flow = bpmn(
      'SequenceFlow',
      'Flow_yes',
      { name: 'Yes', sourceRef: gateway, targetRef: task },
      {
        'orbitpm:nameEn': 'Yes',
        'orbitpm:nameAr': 'نعم'
      }
    )
    const annotation = bpmn(
      'TextAnnotation',
      'Annotation_review',
      { text: 'Review supporting documents' },
      {
        'orbitpm:nameEn': 'Review supporting documents',
        'orbitpm:nameAr': 'مراجعة المستندات الداعمة'
      }
    )
    const nestedTask = bpmn(
      'ServiceTask',
      'Task_nested',
      { name: 'Call API' },
      {
        'orbitpm:nameEn': 'Call API',
        'orbitpm:nameAr': 'استدعاء API',
        'orbitpm:triggerDetail': 'On approval',
        'orbitpm:triggerDetailEn': 'On approval',
        'orbitpm:triggerDetailAr': 'عند الموافقة'
      }
    )
    const subProcess = bpmn('SubProcess', 'Sub_1', {
      name: 'Notification',
      flowElements: [nestedTask]
    }, {
      'orbitpm:nameEn': 'Notification',
      'orbitpm:nameAr': 'الإشعار'
    })
    const processEn = bpmn(
      'Process',
      'Process_EN',
      {
        name: 'Permit approval',
        flowElements: [task, gateway, flow, subProcess],
        artifacts: [annotation],
        documentation: [documentation]
      },
      {
        'orbitpm:activeLang': 'en',
        'orbitpm:nameEn': 'Permit approval',
        'orbitpm:nameAr': 'اعتماد التصريح'
      }
    )
    for (const child of [
      task,
      gateway,
      flow,
      subProcess,
      nestedTask,
      annotation,
      documentation
    ]) {
      child.$parent = processEn
    }

    const arabicTask = bpmn('Task', 'Task_archive', {
      name: 'أرشفة الطلب'
    })
    const processAr = bpmn(
      'Process',
      'Process_AR',
      {
        name: 'إدارة الأرشيف',
        flowElements: [arabicTask]
      }
    )
    arabicTask.$parent = processAr

    // This valid plane-referenced object is deliberately absent from
    // Process_AR.flowElements. Importers with unusual/legacy ownership still
    // must not lose its visible label.
    const planeOnly = bpmn(
      'Task',
      'Task_plane_only',
      { name: 'Legacy plane task' },
      { 'orbitpm:nameEn': 'Legacy plane task' }
    )
    const planeEn1 = {
      $type: 'bpmndi:BPMNPlane',
      id: 'Plane_EN_1',
      bpmnElement: processEn,
      planeElement: [
        { $type: 'bpmndi:BPMNShape', id: 'Shape_task_1', bpmnElement: task },
        { $type: 'bpmndi:BPMNEdge', id: 'Edge_flow_1', bpmnElement: flow }
      ]
    }
    const planeEn2 = {
      $type: 'bpmndi:BPMNPlane',
      id: 'Plane_EN_2',
      bpmnElement: processEn,
      planeElement: [
        { $type: 'bpmndi:BPMNShape', id: 'Shape_task_2', bpmnElement: task }
      ]
    }
    const planeAr = {
      $type: 'bpmndi:BPMNPlane',
      id: 'Plane_AR',
      bpmnElement: processAr,
      planeElement: [
        {
          $type: 'bpmndi:BPMNShape',
          id: 'Shape_ar',
          bpmnElement: arabicTask
        },
        {
          $type: 'bpmndi:BPMNShape',
          id: 'Shape_plane_only',
          bpmnElement: planeOnly
        }
      ]
    }
    const definitions = {
      $type: 'bpmn:Definitions',
      id: 'Definitions_1',
      rootElements: [processEn, processAr],
      diagrams: [
        { $type: 'bpmndi:BPMNDiagram', id: 'Diagram_EN_1', plane: planeEn1 },
        { $type: 'bpmndi:BPMNDiagram', id: 'Diagram_EN_2', plane: planeEn2 },
        { $type: 'bpmndi:BPMNDiagram', id: 'Diagram_AR', plane: planeAr }
      ]
    }

    const fields = extractBpmnLocalization(definitions, {
      source: LocalizationSource.Backup
    })
    const byKey = new Map(fields.map((field) => [fieldKey(field), field]))

    expect(byKey.get('Process_EN/Flow_yes/condition')?.value).toEqual({
      en: 'Yes',
      ar: 'نعم',
      active: 'en'
    })
    expect(
      byKey.get('Process_EN/Annotation_review/annotation')?.value.ar
    ).toBe('مراجعة المستندات الداعمة')
    expect(byKey.get('Process_EN/Doc_1/notes')?.value.ar).toBe(
      'ملاحظة العملية'
    )
    expect(byKey.get('Process_EN/Task_approve/owner')?.value.ar).toBe(
      'إدارة التصاريح'
    )
    expect(byKey.get('Process_EN/Task_approve/inputs')?.value.ar).toBe(
      'نموذج الطلب'
    )
    expect(byKey.get('Process_EN/Task_approve/outputs')?.value.ar).toBe(
      'إشعار القرار'
    )
    expect(byKey.get('Process_EN/Task_approve/respList')?.value.ar).toContain(
      'مسؤول الحالة'
    )
    expect(byKey.get('Process_EN/Task_approve/ccList')?.value.ar).toContain(
      'الشؤون القانونية'
    )
    expect(
      byKey.get('Process_EN/Gateway_complete/decisionBasis')?.value.ar
    ).toBe('سياسة الاكتمال')
    expect(
      byKey.get('Process_EN/Task_nested/triggerDetail')?.value.ar
    ).toBe('عند الموافقة')

    const taskName = byKey.get('Process_EN/Task_approve/name')
    expect(taskName?.source).toBe('backup')
    expect(taskName?.planeIds).toEqual(['Plane_EN_1', 'Plane_EN_2'])
    // Repeated DI references do not duplicate the semantic field.
    expect(
      fields.filter(
        (field) =>
          field.processId === 'Process_EN' &&
          field.elementId === 'Task_approve' &&
          field.field === 'name'
      )
    ).toHaveLength(1)

    const arabicFirst = byKey.get('Process_AR/Task_archive/name')
    expect(arabicFirst?.sourceLanguage).toBe('ar')
    expect(arabicFirst?.value).toEqual({
      ar: 'أرشفة الطلب',
      active: 'ar'
    })
    expect(arabicFirst?.origins.ar).toBe('projection')
    expect(arabicFirst?.planeIds).toEqual(['Plane_AR'])

    const orphan = byKey.get('Process_AR/Task_plane_only/name')
    expect(orphan?.value.en).toBe('Legacy plane task')
    expect(orphan?.planeIds).toEqual(['Plane_AR'])
  })

  it('reads registered get(), local properties, and raw $attrs without mutating any of them', () => {
    const attrs = {
      'orbitpm:nameEn': 'Approve',
      'orbitpm:nameAr': 'اعتماد'
    }
    const task: ModdleElementLike = {
      $type: 'bpmn:Task',
      id: 'Task_get',
      name: 'Approve',
      $attrs: attrs,
      get(name: string): unknown {
        if (name === 'orbitpm:nameEn') return 'Approve'
        if (name === 'orbitpm:nameAr') return 'اعتماد'
        return this[name]
      }
    }
    const process = bpmn(
      'Process',
      'Process_get',
      { flowElements: [task] },
      { 'orbitpm:activeLang': 'en' }
    )
    task.$parent = process
    const before = { ...attrs }
    const fields = extractBpmnLocalization({
      $type: 'bpmn:Definitions',
      rootElements: [process]
    })
    expect(fields.find((current) => current.elementId === 'Task_get')?.value).toEqual({
      en: 'Approve',
      ar: 'اعتماد',
      active: 'en'
    })
    expect(attrs).toEqual(before)
  })

  it('uses stored-script evidence when the legacy visible projection is absent', () => {
    const wrongArabic = bpmn('Task', 'Task_wrong_ar', {}, {
      'orbitpm:nameAr': 'Approve request'
    })
    const arabicOnly = bpmn('Task', 'Task_ar_only', {}, {
      'orbitpm:nameAr': 'أرشفة الطلب'
    })
    const process = bpmn('Process', 'Process_script', {
      flowElements: [wrongArabic, arabicOnly]
    })
    wrongArabic.$parent = process
    arabicOnly.$parent = process

    const report = auditBpmnLocalization({
      $type: 'bpmn:Definitions',
      rootElements: [process]
    })
    const wrong = report.fields.find(
      (field) => field.elementId === 'Task_wrong_ar'
    )
    expect(wrong?.value).toEqual({
      en: 'Approve request',
      ar: 'Approve request',
      active: 'en'
    })
    expect(wrong?.origins).toEqual({
      ar: 'paired',
      en: 'script-inferred'
    })
    expect(
      report.issues
        .filter((issue) => issue.elementId === 'Task_wrong_ar')
        .map((issue) => issue.code)
    ).toEqual(['wrong-script', 'duplicate-counterpart'])

    const validArabic = report.fields.find(
      (field) => field.elementId === 'Task_ar_only'
    )
    expect(validArabic?.value.active).toBe('ar')
    expect(validArabic?.sourceLanguage).toBe('ar')
  })
})

describe('real bpmn-moddle acceptance across multiple processes and planes', () => {
  it('audits parsed registered extension attributes from every root and DI plane', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
 xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
 xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
 xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
 xmlns:orbitpm="http://orbitpm.ae/schema/bpmn/1.0"
 id="Definitions_localization" targetNamespace="https://orbitpm.ae/bpmn">
  <process id="Process_English" name="Approval" orbitpm:activeLang="en"
    orbitpm:nameEn="Approval" orbitpm:nameAr="الموافقة">
    <task id="Task_English" name="Approve request"
      orbitpm:nameEn="Approve request" orbitpm:nameAr="Approve request"
      orbitpm:owner="Permits" orbitpm:ownerEn="Permits" orbitpm:ownerAr="التصاريح" />
    <task id="Task_End" name="Archive" orbitpm:nameEn="Archive" orbitpm:nameAr="أرشفة" />
    <sequenceFlow id="Flow_English" sourceRef="Task_English" targetRef="Task_End"
      name="Yes" orbitpm:nameEn="Yes" orbitpm:nameAr="نعم" />
    <textAnnotation id="Annotation_English" orbitpm:nameEn="Review note"
      orbitpm:nameAr="ملاحظة المراجعة"><text>Review note</text></textAnnotation>
  </process>
  <process id="Process_Arabic" name="الأرشفة" orbitpm:activeLang="ar">
    <task id="Task_Arabic" name="أرشفة الطلب" />
  </process>
  <bpmndi:BPMNDiagram id="Diagram_English">
    <bpmndi:BPMNPlane id="Plane_English" bpmnElement="Process_English">
      <bpmndi:BPMNShape id="Shape_English" bpmnElement="Task_English">
        <dc:Bounds x="100" y="100" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Edge_English" bpmnElement="Flow_English">
        <di:waypoint x="200" y="140" /><di:waypoint x="300" y="140" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="Diagram_Arabic">
    <bpmndi:BPMNPlane id="Plane_Arabic" bpmnElement="Process_Arabic">
      <bpmndi:BPMNShape id="Shape_Arabic" bpmnElement="Task_Arabic">
        <dc:Bounds x="100" y="100" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>`
    const moddle = new BpmnModdle({
      orbitpm: orbitpmModdleDescriptor
    })
    const { rootElement, warnings } = await moddle.fromXML(xml)
    expect(warnings).toEqual([])

    const report = auditBpmnLocalization(rootElement, {
      source: LocalizationSource.Xml
    })
    const keys = report.fields.map(fieldKey)
    expect(keys).toContain('Process_English/Flow_English/condition')
    expect(keys).toContain('Process_English/Annotation_English/annotation')
    expect(keys).toContain('Process_English/Task_English/owner')
    expect(keys).toContain('Process_Arabic/Task_Arabic/name')
    expect(
      report.fields.find(
        (field) => field.elementId === 'Task_Arabic' && field.field === 'name'
      )?.planeIds
    ).toEqual(['Plane_Arabic'])

    expect(
      report.issues.filter(
        (issue) =>
          issue.elementId === 'Task_English' && issue.target === 'ar'
      ).map((issue) => issue.code)
    ).toEqual(['wrong-script', 'duplicate-counterpart'])
    expect(
      report.issues.find(
        (issue) =>
          issue.elementId === 'Task_Arabic' &&
          issue.target === 'en' &&
          issue.code === 'missing'
      )
    ).toBeTruthy()
  })

  it('registers every 0.4.5 paired organizational metadata attribute', () => {
    for (const attribute of [
      'ownerEn',
      'ownerAr',
      'departmentEn',
      'departmentAr',
      'ownerRoleEn',
      'ownerRoleAr',
      'channelDetailEn',
      'channelDetailAr',
      'ccToEn',
      'ccToAr',
      'triggerServiceEn',
      'triggerServiceAr',
      'triggerDetailEn',
      'triggerDetailAr',
      'triggersEn',
      'triggersAr',
      'inputsEn',
      'inputsAr',
      'outputsEn',
      'outputsAr',
      'systemEn',
      'systemAr',
      'respListEn',
      'respListAr',
      'ccListEn',
      'ccListAr',
      'decisionBasisEn',
      'decisionBasisAr'
    ]) {
      expect(ORG_ATTR_NAMES).toContain(attribute)
    }
  })
})

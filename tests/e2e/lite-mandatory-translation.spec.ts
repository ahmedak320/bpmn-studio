import { expect, test, type Locator, type Page } from '@playwright/test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { installMandatoryTranslationWorkspace } from './fixtures/mandatory-translation-fsa'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()
const TINY_PDF = resolve(HERE, 'fixtures/tiny.pdf')

const NS =
  'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" ' +
  'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" ' +
  'xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" ' +
  'xmlns:di="http://www.omg.org/spec/DD/20100524/DI" ' +
  'xmlns:orbitpm="http://orbitpm.ae/schema/bpmn/1.0"'

const TRANSLATION_MATRIX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="Definitions_Translation_Matrix"
  targetNamespace="https://orbitpm.ae/tests/mandatory-translation">
  <bpmn:process id="Process_Translation_Matrix" name="Translation matrix"
    orbitpm:nameEn="Translation matrix" orbitpm:nameAr="مصفوفة الترجمة"
    orbitpm:activeLang="en" isExecutable="false">
    <bpmn:startEvent id="Start_Matrix" name="Request received"
      orbitpm:nameEn="Request received" orbitpm:nameAr="استلام الطلب">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_Mixed" name="Review request"
      orbitpm:nameEn="Review request" orbitpm:nameAr="مراجعة الطلب">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:task id="Task_API" name="API">
      <bpmn:incoming>Flow_2</bpmn:incoming>
      <bpmn:outgoing>Flow_3</bpmn:outgoing>
    </bpmn:task>
    <bpmn:exclusiveGateway id="Gateway_Approved" name="Approved?"
      orbitpm:nameEn="Approved?" orbitpm:nameAr="هل تمت الموافقة؟">
      <bpmn:incoming>Flow_3</bpmn:incoming>
      <bpmn:outgoing>Flow_Approved</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:task id="Task_Details" name="Record decision"
      orbitpm:nameEn="Record decision" orbitpm:nameAr="تسجيل القرار"
      orbitpm:owner="Case team" orbitpm:ownerEn="Case team" orbitpm:ownerAr="فريق الحالات"
      orbitpm:department="Operations" orbitpm:departmentEn="Operations"
      orbitpm:departmentAr="العمليات"
      orbitpm:inputs="Reviewed request" orbitpm:inputsEn="Reviewed request"
      orbitpm:inputsAr="الطلب المراجع"
      orbitpm:outputs="Recorded decision" orbitpm:outputsEn="Recorded decision"
      orbitpm:outputsAr="القرار المسجل"
      orbitpm:system="Case system" orbitpm:systemEn="Case system"
      orbitpm:systemAr="نظام الحالات"
      orbitpm:decisionBasis="Approval policy" orbitpm:decisionBasisEn="Approval policy"
      orbitpm:decisionBasisAr="سياسة الموافقة"
      orbitpm:description="Record the reviewed outcome"
      orbitpm:descriptionEn="Record the reviewed outcome"
      orbitpm:descriptionAr="سجل النتيجة المراجعة">
      <bpmn:incoming>Flow_Approved</bpmn:incoming>
      <bpmn:outgoing>Flow_5</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="End_Matrix" name="Process complete"
      orbitpm:nameEn="Process complete" orbitpm:nameAr="اكتملت العملية">
      <bpmn:incoming>Flow_5</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_Matrix" targetRef="Task_Mixed" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Mixed" targetRef="Task_API" />
    <bpmn:sequenceFlow id="Flow_3" sourceRef="Task_API" targetRef="Gateway_Approved" />
    <bpmn:sequenceFlow id="Flow_Approved" name="Request is approved"
      orbitpm:nameEn="Request is approved" orbitpm:nameAr="تمت الموافقة على الطلب"
      sourceRef="Gateway_Approved" targetRef="Task_Details">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><![CDATA[approved = true]]></bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_5" sourceRef="Task_Details" targetRef="End_Matrix" />
    <bpmn:textAnnotation id="Annotation_Matrix"
      orbitpm:nameEn="Check supporting evidence"
      orbitpm:nameAr="تحقق من الأدلة الداعمة">
      <bpmn:text>Check supporting evidence</bpmn:text>
    </bpmn:textAnnotation>
    <bpmn:association id="Association_Matrix" sourceRef="Task_Details"
      targetRef="Annotation_Matrix" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_Translation_Matrix">
    <bpmndi:BPMNPlane id="Plane_Translation_Matrix"
      bpmnElement="Process_Translation_Matrix">
      <bpmndi:BPMNShape id="Start_Matrix_di" bpmnElement="Start_Matrix">
        <dc:Bounds x="120" y="180" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Mixed_di" bpmnElement="Task_Mixed">
        <dc:Bounds x="210" y="158" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_API_di" bpmnElement="Task_API">
        <dc:Bounds x="370" y="158" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_Approved_di" bpmnElement="Gateway_Approved"
        isMarkerVisible="true">
        <dc:Bounds x="520" y="173" width="50" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Details_di" bpmnElement="Task_Details">
        <dc:Bounds x="630" y="158" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_Matrix_di" bpmnElement="End_Matrix">
        <dc:Bounds x="800" y="180" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Annotation_Matrix_di" bpmnElement="Annotation_Matrix">
        <dc:Bounds x="620" y="285" width="190" height="60" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="156" y="198" /><di:waypoint x="210" y="198" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="320" y="198" /><di:waypoint x="370" y="198" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_3_di" bpmnElement="Flow_3">
        <di:waypoint x="470" y="198" /><di:waypoint x="520" y="198" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Approved_di" bpmnElement="Flow_Approved">
        <di:waypoint x="570" y="198" /><di:waypoint x="630" y="198" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_5_di" bpmnElement="Flow_5">
        <di:waypoint x="740" y="198" /><di:waypoint x="800" y="198" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Association_Matrix_di" bpmnElement="Association_Matrix">
        <di:waypoint x="685" y="238" /><di:waypoint x="685" y="285" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`

const XML_INGESTION_MATRIX = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="Definitions_Xml_Ingestion"
  targetNamespace="https://orbitpm.ae/tests/mandatory-translation/xml-ingestion">
  <bpmn:process id="Process_Xml_Main" name="XML boundary"
    orbitpm:nameEn="XML boundary" orbitpm:nameAr="حدود الاستيراد"
    orbitpm:activeLang="en" isExecutable="false">
    <bpmn:startEvent id="Start_Xml_Main" name="Request received"
      orbitpm:nameEn="Request received" orbitpm:nameAr="استلام الطلب">
      <bpmn:outgoing>Flow_Xml_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_Wrong_Ar" name="Review request"
      orbitpm:nameEn="Review request" orbitpm:nameAr="Review request">
      <bpmn:incoming>Flow_Xml_1</bpmn:incoming>
      <bpmn:outgoing>Flow_Xml_2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:task id="Task_En_Only" name="Record decision"
      orbitpm:nameEn="Record decision">
      <bpmn:incoming>Flow_Xml_2</bpmn:incoming>
      <bpmn:outgoing>Flow_Xml_3</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="End_Xml_Main" name="Process complete"
      orbitpm:nameEn="Process complete" orbitpm:nameAr="اكتملت العملية">
      <bpmn:incoming>Flow_Xml_3</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_Xml_1" sourceRef="Start_Xml_Main"
      targetRef="Task_Wrong_Ar" />
    <bpmn:sequenceFlow id="Flow_Xml_2" sourceRef="Task_Wrong_Ar"
      targetRef="Task_En_Only" />
    <bpmn:sequenceFlow id="Flow_Xml_3" sourceRef="Task_En_Only"
      targetRef="End_Xml_Main" />
  </bpmn:process>
  <bpmn:process id="Process_Xml_Secondary" name="الأرشفة الثانوية"
    orbitpm:nameEn="Secondary archive" orbitpm:nameAr="الأرشفة الثانوية"
    orbitpm:activeLang="ar" isExecutable="false">
    <bpmn:startEvent id="Start_Xml_Secondary" name="بدء الأرشفة"
      orbitpm:nameEn="Archive started" orbitpm:nameAr="بدء الأرشفة">
      <bpmn:outgoing>Flow_Xml_Secondary_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_Ar_Only" name="أرشفة الحالة"
      orbitpm:nameAr="أرشفة الحالة">
      <bpmn:incoming>Flow_Xml_Secondary_1</bpmn:incoming>
      <bpmn:outgoing>Flow_Xml_Secondary_2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="End_Xml_Secondary" name="اكتملت الأرشفة"
      orbitpm:nameEn="Archive complete" orbitpm:nameAr="اكتملت الأرشفة">
      <bpmn:incoming>Flow_Xml_Secondary_2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_Xml_Secondary_1" sourceRef="Start_Xml_Secondary"
      targetRef="Task_Ar_Only" />
    <bpmn:sequenceFlow id="Flow_Xml_Secondary_2" sourceRef="Task_Ar_Only"
      targetRef="End_Xml_Secondary" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_Xml_Main">
    <bpmndi:BPMNPlane id="Plane_Xml_Main" bpmnElement="Process_Xml_Main">
      <bpmndi:BPMNShape id="Start_Xml_Main_di" bpmnElement="Start_Xml_Main">
        <dc:Bounds x="120" y="160" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Wrong_Ar_di" bpmnElement="Task_Wrong_Ar">
        <dc:Bounds x="210" y="138" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_En_Only_di" bpmnElement="Task_En_Only">
        <dc:Bounds x="380" y="138" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_Xml_Main_di" bpmnElement="End_Xml_Main">
        <dc:Bounds x="550" y="160" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_Xml_1_di" bpmnElement="Flow_Xml_1">
        <di:waypoint x="156" y="178" /><di:waypoint x="210" y="178" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Xml_2_di" bpmnElement="Flow_Xml_2">
        <di:waypoint x="320" y="178" /><di:waypoint x="380" y="178" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Xml_3_di" bpmnElement="Flow_Xml_3">
        <di:waypoint x="490" y="178" /><di:waypoint x="550" y="178" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="Diagram_Xml_Secondary">
    <bpmndi:BPMNPlane id="Plane_Xml_Secondary"
      bpmnElement="Process_Xml_Secondary">
      <bpmndi:BPMNShape id="Start_Xml_Secondary_di"
        bpmnElement="Start_Xml_Secondary">
        <dc:Bounds x="120" y="340" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Ar_Only_di" bpmnElement="Task_Ar_Only">
        <dc:Bounds x="240" y="318" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_Xml_Secondary_di"
        bpmnElement="End_Xml_Secondary">
        <dc:Bounds x="430" y="340" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_Xml_Secondary_1_di"
        bpmnElement="Flow_Xml_Secondary_1">
        <di:waypoint x="156" y="358" /><di:waypoint x="240" y="358" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Xml_Secondary_2_di"
        bpmnElement="Flow_Xml_Secondary_2">
        <di:waypoint x="350" y="358" /><di:waypoint x="430" y="358" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`

const TM_RECOVERY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="Definitions_Tm_Recovery"
  targetNamespace="https://orbitpm.ae/tests/mandatory-translation/tm-recovery">
  <bpmn:process id="Process_Tm_Recovery" name="Translation memory recovery"
    orbitpm:nameEn="Translation memory recovery" orbitpm:nameAr="استعادة ذاكرة الترجمة"
    orbitpm:activeLang="en" isExecutable="false">
    <bpmn:startEvent id="Start_Tm_Recovery" name="Recovery started"
      orbitpm:nameEn="Recovery started" orbitpm:nameAr="بدء الاستعادة">
      <bpmn:outgoing>Flow_Tm_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_Tm_Retry" name="Retry memory save"
      orbitpm:nameEn="Retry memory save" orbitpm:nameAr="إعادة محاولة حفظ الذاكرة الأولية">
      <bpmn:incoming>Flow_Tm_1</bpmn:incoming>
      <bpmn:outgoing>Flow_Tm_2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:task id="Task_Tm_Continue" name="Continue memory save"
      orbitpm:nameEn="Continue memory save" orbitpm:nameAr="متابعة حفظ الذاكرة الأولية">
      <bpmn:incoming>Flow_Tm_2</bpmn:incoming>
      <bpmn:outgoing>Flow_Tm_3</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="End_Tm_Recovery" name="Recovery complete"
      orbitpm:nameEn="Recovery complete" orbitpm:nameAr="اكتملت الاستعادة">
      <bpmn:incoming>Flow_Tm_3</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_Tm_1" sourceRef="Start_Tm_Recovery"
      targetRef="Task_Tm_Retry" />
    <bpmn:sequenceFlow id="Flow_Tm_2" sourceRef="Task_Tm_Retry"
      targetRef="Task_Tm_Continue" />
    <bpmn:sequenceFlow id="Flow_Tm_3" sourceRef="Task_Tm_Continue"
      targetRef="End_Tm_Recovery" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_Tm_Recovery">
    <bpmndi:BPMNPlane id="Plane_Tm_Recovery" bpmnElement="Process_Tm_Recovery">
      <bpmndi:BPMNShape id="Start_Tm_Recovery_di" bpmnElement="Start_Tm_Recovery">
        <dc:Bounds x="120" y="180" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Tm_Retry_di" bpmnElement="Task_Tm_Retry">
        <dc:Bounds x="220" y="158" width="120" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Tm_Continue_di" bpmnElement="Task_Tm_Continue">
        <dc:Bounds x="410" y="158" width="120" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_Tm_Recovery_di" bpmnElement="End_Tm_Recovery">
        <dc:Bounds x="600" y="180" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_Tm_1_di" bpmnElement="Flow_Tm_1">
        <di:waypoint x="156" y="198" /><di:waypoint x="220" y="198" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Tm_2_di" bpmnElement="Flow_Tm_2">
        <di:waypoint x="340" y="198" /><di:waypoint x="410" y="198" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Tm_3_di" bpmnElement="Flow_Tm_3">
        <di:waypoint x="530" y="198" /><di:waypoint x="600" y="198" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`

const TM_LATE_FINALIZATION_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="Definitions_Tm_Late"
  targetNamespace="https://orbitpm.ae/tests/mandatory-translation/tm-late">
  <bpmn:process id="Process_Tm_Late" name="Late finalization"
    orbitpm:nameEn="Late finalization" orbitpm:nameAr="الإنهاء المتأخر"
    orbitpm:activeLang="en" isExecutable="false">
    <bpmn:startEvent id="Start_Tm_Late" name="Finalization started"
      orbitpm:nameEn="Finalization started" orbitpm:nameAr="بدء الإنهاء">
      <bpmn:outgoing>Flow_Tm_Late_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_Tm_Late" name="Finalize workspace translation"
      orbitpm:nameEn="Finalize workspace translation"
      orbitpm:nameAr="إنهاء ترجمة مساحة العمل الأولية">
      <bpmn:incoming>Flow_Tm_Late_1</bpmn:incoming>
      <bpmn:outgoing>Flow_Tm_Late_2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="End_Tm_Late" name="Finalization complete"
      orbitpm:nameEn="Finalization complete" orbitpm:nameAr="اكتمل الإنهاء">
      <bpmn:incoming>Flow_Tm_Late_2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_Tm_Late_1" sourceRef="Start_Tm_Late"
      targetRef="Task_Tm_Late" />
    <bpmn:sequenceFlow id="Flow_Tm_Late_2" sourceRef="Task_Tm_Late"
      targetRef="End_Tm_Late" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_Tm_Late">
    <bpmndi:BPMNPlane id="Plane_Tm_Late" bpmnElement="Process_Tm_Late">
      <bpmndi:BPMNShape id="Start_Tm_Late_di" bpmnElement="Start_Tm_Late">
        <dc:Bounds x="120" y="180" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Tm_Late_di" bpmnElement="Task_Tm_Late">
        <dc:Bounds x="240" y="158" width="150" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_Tm_Late_di" bpmnElement="End_Tm_Late">
        <dc:Bounds x="480" y="180" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_Tm_Late_1_di" bpmnElement="Flow_Tm_Late_1">
        <di:waypoint x="156" y="198" /><di:waypoint x="240" y="198" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Tm_Late_2_di" bpmnElement="Flow_Tm_Late_2">
        <di:waypoint x="390" y="198" /><di:waypoint x="480" y="198" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`

const WORKSPACE_GLOSSARY_PATH = '.orbitpm/i18n/glossary.json'
const WORKSPACE_TRANSLATION_MEMORY_PATH = '.orbitpm/i18n/translation-memory.json'
const EMPTY_WORKSPACE_GLOSSARY = `${JSON.stringify(
  {
    format: 'orbitpm-localization-glossary',
    version: 1,
    entries: []
  },
  null,
  2
)}\n`
const EMPTY_WORKSPACE_TRANSLATION_MEMORY = `${JSON.stringify(
  {
    format: 'orbitpm-localization-translation-memory',
    version: 1,
    entries: []
  },
  null,
  2
)}\n`

const ARIS_BILINGUAL = `<?xml version="1.0" encoding="UTF-8"?>
<AML>
  <Header-Info DatabaseName="Mandatory translation" />
  <ObjDef ObjDef.ID="ObjDef.Start" TypeNum="OT_EVT" SymbolNum="ST_EV">
    <AttrDef AttrDef.Type="AT_NAME">
      <AttrValue LocaleId="1033"><PlainText TextValue="Request received" /></AttrValue>
      <AttrValue LocaleId="14337"><PlainText TextValue="تم استلام الطلب" /></AttrValue>
    </AttrDef>
    <CxnDef CxnDef.ID="CxnDef.1" CxnDef.Type="CT_LEADS_TO_1"
      ToObjDef.IdRef="ObjDef.Review" />
  </ObjDef>
  <ObjDef ObjDef.ID="ObjDef.Review" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
    <AttrDef AttrDef.Type="AT_NAME">
      <AttrValue LocaleId="1033"><PlainText TextValue="Review application" /></AttrValue>
      <AttrValue LocaleId="14337"><PlainText TextValue="مراجعة الطلب" /></AttrValue>
    </AttrDef>
    <CxnDef CxnDef.ID="CxnDef.2" CxnDef.Type="CT_LEADS_TO_1"
      ToObjDef.IdRef="ObjDef.End" />
  </ObjDef>
  <ObjDef ObjDef.ID="ObjDef.End" TypeNum="OT_EVT" SymbolNum="ST_EV">
    <AttrDef AttrDef.Type="AT_NAME">
      <AttrValue LocaleId="1033"><PlainText TextValue="Decision recorded" /></AttrValue>
      <AttrValue LocaleId="14337"><PlainText TextValue="تم تسجيل القرار" /></AttrValue>
    </AttrDef>
  </ObjDef>
  <Model Model.ID="Model.MandatoryTranslation" Model.Type="MT_EEPC">
    <AttrDef AttrDef.Type="AT_NAME">
      <AttrValue LocaleId="1033"><PlainText TextValue="ARIS translation" /></AttrValue>
      <AttrValue LocaleId="14337"><PlainText TextValue="ترجمة أريس" /></AttrValue>
    </AttrDef>
    <AttrDef AttrDef.Type="AT_PROC_CODE">
      <AttrValue LocaleId="1033"><PlainText TextValue="Process_Aris_Translation" /></AttrValue>
    </AttrDef>
    <ObjOcc ObjOcc.ID="Occ.Start" ObjDef.IdRef="ObjDef.Start" SymbolNum="ST_EV" />
    <ObjOcc ObjOcc.ID="Occ.Review" ObjDef.IdRef="ObjDef.Review" SymbolNum="ST_FUNC" />
    <ObjOcc ObjOcc.ID="Occ.End" ObjDef.IdRef="ObjDef.End" SymbolNum="ST_EV" />
  </Model>
</AML>`

interface HookWindow {
  __ORBITPM_LITE__: {
    modeler: {
      get(name: string): unknown
      saveXML(options: { format: boolean }): Promise<{ xml?: string }>
    }
  }
}

interface ElementLocalizationState {
  id: string
  name: string | null
  text: string | null
  nameEn: string | null
  nameAr: string | null
  owner: string | null
  ownerEn: string | null
  ownerAr: string | null
  inputs: string | null
  inputsEn: string | null
  inputsAr: string | null
  description: string | null
  descriptionEn: string | null
  descriptionAr: string | null
}

test.beforeAll(() => {
  const html = readFileSync(DIST, 'utf8')
  expect(html.length, 'dist/index.html should be the built production single file').toBeGreaterThan(
    500_000
  )
})

async function waitForModeler(page: Page): Promise<void> {
  await expect(page.locator('.djs-container:visible svg').first()).toBeVisible({
    timeout: 30_000
  })
  await page.waitForFunction(() => {
    const modeler = (
      window as unknown as {
        __ORBITPM_LITE__?: {
          modeler?: { get(name: string): unknown } | null
        }
      }
    ).__ORBITPM_LITE__?.modeler
    if (!modeler) return false
    const container = (
      modeler.get('canvas') as {
        getContainer?(): HTMLElement
      }
    ).getContainer?.()
    return Boolean(container?.isConnected && container.getClientRects().length > 0)
  })
}

async function elementState(page: Page, id: string): Promise<ElementLocalizationState> {
  return page.evaluate((elementId) => {
    const modeler = (
      window as unknown as {
        __ORBITPM_LITE__?: HookWindow['__ORBITPM_LITE__']
      }
    ).__ORBITPM_LITE__?.modeler
    if (!modeler) {
      return {
        id: elementId,
        name: null,
        text: null,
        nameEn: null,
        nameAr: null,
        owner: null,
        ownerEn: null,
        ownerAr: null,
        inputs: null,
        inputsEn: null,
        inputsAr: null,
        description: null,
        descriptionEn: null,
        descriptionAr: null
      }
    }
    type BusinessObject = {
      name?: unknown
      text?: unknown
      get?(key: string): unknown
      $attrs?: Record<string, unknown>
    }
    const element = (
      modeler.get('elementRegistry') as {
        get(id: string): { businessObject?: BusinessObject } | undefined
      }
    ).get(elementId)
    const businessObject = element?.businessObject
    const read = (key: string): string | null => {
      const viaGet = businessObject?.get?.(key)
      const value =
        viaGet ?? businessObject?.[key as keyof BusinessObject] ?? businessObject?.$attrs?.[key]
      return typeof value === 'string' ? value : null
    }
    return {
      id: elementId,
      name: read('name'),
      text: read('text'),
      nameEn: read('orbitpm:nameEn'),
      nameAr: read('orbitpm:nameAr'),
      owner: read('orbitpm:owner'),
      ownerEn: read('orbitpm:ownerEn'),
      ownerAr: read('orbitpm:ownerAr'),
      inputs: read('orbitpm:inputs'),
      inputsEn: read('orbitpm:inputsEn'),
      inputsAr: read('orbitpm:inputsAr'),
      description: read('orbitpm:description'),
      descriptionEn: read('orbitpm:descriptionEn'),
      descriptionAr: read('orbitpm:descriptionAr')
    }
  }, id)
}

async function activeDiagramLanguage(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const modeler = (
      window as unknown as {
        __ORBITPM_LITE__?: HookWindow['__ORBITPM_LITE__']
      }
    ).__ORBITPM_LITE__?.modeler
    if (!modeler) return null
    const root = (
      modeler.get('canvas') as {
        getRootElement(): {
          businessObject?: { get?(key: string): unknown; $attrs?: Record<string, unknown> }
        }
      }
    ).getRootElement()
    const value =
      root.businessObject?.get?.('orbitpm:activeLang') ??
      root.businessObject?.$attrs?.['orbitpm:activeLang']
    return typeof value === 'string' ? value : null
  })
}

async function renderedText(page: Page, id: string): Promise<string> {
  return page.evaluate((elementId) => {
    const selectors = [
      `.djs-element[data-element-id="${CSS.escape(elementId)}"]`,
      `.djs-element[data-element-id="${CSS.escape(elementId)}_label"]`
    ]
    return Array.from(document.querySelectorAll(selectors.join(',')))
      .map((element) => element.textContent ?? '')
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim()
  }, id)
}

async function selectElement(page: Page, id: string): Promise<void> {
  await page.evaluate((elementId) => {
    const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
    const registry = modeler.get('elementRegistry') as { get(id: string): unknown }
    ;(modeler.get('selection') as { select(element: unknown): void }).select(
      registry.get(elementId)
    )
  }, id)
}

async function confirmWorkspaceImport(
  page: Page,
  expectedSource: string,
  reviewMode: 'automatic-complete' | 'explicit' = 'automatic-complete'
): Promise<void> {
  const review = page.getByRole('dialog', { name: 'Review workspace import' })
  await expect(review).toBeVisible({ timeout: 30_000 })
  await expect(review).toContainText(expectedSource)
  await expect(review).toContainText(
    reviewMode === 'automatic-complete'
      ? 'Automatically complete (automatic-complete)'
      : 'Explicitly reviewed (explicit)'
  )
  const confirm = review.getByRole('button', { name: 'Confirm import' })
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await expect(review).toBeHidden({ timeout: 30_000 })
}

async function openTreeFile(page: Page, path: string): Promise<void> {
  const row = page.locator(
    `.orbitpm-tree-row[data-rel-path="${path}"]:not(.orbitpm-tree-reference-row)`
  )
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.click()
  const fileName = path.split('/').at(-1)
  if (!fileName) throw new Error(`Cannot open an empty workspace path: "${path}".`)
  await expect(
    page
      .locator('button[id^="orbitpm-process-tab-"][role="tab"][aria-selected="true"]')
      .filter({ hasText: fileName })
  ).toHaveCount(1, { timeout: 30_000 })
  await waitForModeler(page)
}

async function clearArabicNames(page: Page, elementIds: readonly string[]): Promise<void> {
  await page.evaluate((ids) => {
    const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
    const registry = modeler.get('elementRegistry') as {
      get(id: string): unknown
    }
    const modeling = modeler.get('modeling') as {
      updateProperties(element: unknown, properties: Record<string, unknown>): void
    }
    for (const id of ids) {
      const element = registry.get(id)
      if (!element) throw new Error(`Cannot make missing Arabic fixture field for "${id}".`)
      modeling.updateProperties(element, { 'orbitpm:nameAr': undefined })
    }
  }, elementIds)
}

async function clickDiagramLanguageToggle(page: Page): Promise<void> {
  await page.getByRole('button', { name: /EN⇄AR/ }).click()
}

async function saveActiveDiagram(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved', { exact: true }).last()).toBeVisible({
    timeout: 30_000
  })
}

async function closeActiveTab(page: Page): Promise<void> {
  const active = page.locator(
    'button[id^="orbitpm-process-tab-"][role="tab"][aria-selected="true"]'
  )
  await active.focus()
  await active.press('Delete')
  await expect(active).toHaveCount(0)
}

async function expandAiPanel(page: Page): Promise<void> {
  const header = page.getByRole('button', { name: /Generate with AI/i })
  if (!(await header.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Toggle side panel' }).click()
    await expect(header).toBeVisible()
  }
  if ((await header.getAttribute('aria-expanded')) === 'false') await header.click()
  await expect(page.getByRole('tab', { name: 'From description' })).toBeVisible()
}

async function forceFallbackMode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete window.showDirectoryPicker
    delete window.showOpenFilePicker
  })
}

async function configureOpenRouter(page: Page, modelId: string, apiKey: string): Promise<void> {
  await page
    .getByRole('button', { name: /Settings/i })
    .first()
    .click()
  const settings = page.getByRole('dialog', { name: /Settings/i })
  const selection = settings.getByRole('region', { name: 'AI provider and model' })
  await selection
    .getByRole('combobox', { name: 'Provider', exact: true })
    .selectOption('openrouter')
  await selection.getByRole('combobox', { name: 'Model', exact: true }).fill(modelId)
  await settings.getByLabel('OpenRouter API key').fill(apiKey)
  await settings.getByRole('button', { name: 'Save keys' }).click()
  await expect(settings.getByText('Saved.', { exact: true })).toBeVisible()
  await settings.getByRole('button', { name: 'Close', exact: true }).last().click()
}

async function assertActiveGeneratedBilingual(page: Page): Promise<void> {
  await waitForModeler(page)
  await expect
    .poll(() => elementState(page, 'Review_Boundary'))
    .toMatchObject({
      name: 'Review boundary',
      nameEn: 'Review boundary',
      nameAr: 'مراجعة المسار'
    })
  await clickDiagramLanguageToggle(page)
  await expect.poll(() => activeDiagramLanguage(page)).toBe('ar')
  await expect.poll(() => renderedText(page, 'Review_Boundary')).toContain('مراجعة المسار')
  await expect(
    page.locator('.djs-container:visible .djs-element[data-element-id="Review_Boundary"]', {
      hasText: 'مراجعة المسار'
    })
  ).toBeVisible()
}

function createDocxFixture(): Buffer {
  const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Review the attached permit request</w:t></w:r></w:p></w:body>
</w:document>`
  return Buffer.from(
    zipSync(
      {
        '[Content_Types].xml': strToU8(
          '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'
        ),
        'word/document.xml': strToU8(documentXml)
      },
      { level: 0 }
    )
  )
}

interface ReviewedXmlEdit {
  processId: string
  elementId: string
  field: string
  target: 'English' | 'Arabic'
  value: string
  originalIssue: RegExp
  invalidProbe?: string
}

async function completeReviewedXmlIngestion(
  page: Page,
  edits: readonly ReviewedXmlEdit[]
): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Complete bilingual XML review' })
  await expect(dialog).toBeVisible({ timeout: 30_000 })
  await expect(dialog).toContainText(`${edits.length} unique bilingual field target(s)`)
  await expect(dialog.getByRole('status')).toContainText(
    `${edits.length} row(s) still require a valid reviewed value.`
  )
  const complete = dialog.getByRole('button', { name: 'Complete review' })

  for (const edit of edits) {
    const row = dialog.locator('[data-testid="reviewed-xml-row"]').filter({
      hasText: `${edit.processId} / ${edit.elementId} / ${edit.field} / ${edit.target}`
    })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(edit.originalIssue)
    const input = row.getByLabel(`Reviewed target value (${edit.target})`)
    if (edit.invalidProbe) {
      await input.fill(edit.invalidProbe)
      await expect(input).toHaveAttribute('aria-invalid', 'true')
      await expect(row).toContainText('The value uses the wrong script.')
      await expect(complete).toBeDisabled()
    }
    await input.fill(edit.value)
    await expect(row).toContainText('Valid for this target.')
  }

  await expect(dialog.getByRole('status')).toHaveText(
    'Every row is valid. You can explicitly complete the review.'
  )
  await expect(complete).toBeEnabled()
  await complete.click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
}

function workbookWithArabicCell(original: Buffer, value: string): Buffer {
  const files = unzipSync(new Uint8Array(original))
  const sheetPath = 'xl/worksheets/sheet3.xml'
  const sheet = files[sheetPath]
  if (!sheet) throw new Error(`Official workbook is missing ${sheetPath}`)
  const xml = strFromU8(sheet)
  const updated = xml.replace('<t>مراجعة الطلب</t>', `<t>${value}</t>`)
  if (updated === xml) {
    throw new Error('Official workbook no longer contains the expected Review_Request Arabic cell')
  }
  files[sheetPath] = strToU8(updated)
  return Buffer.from(zipSync(files, { level: 0 }))
}

test('TR5: XML import explicitly repairs wrong-language, EN-only and AR-only fields across two planes', async ({
  page
}) => {
  test.setTimeout(180_000)
  await installMandatoryTranslationWorkspace(page, { name: 'XmlAuditWorkspace' })
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page.getByRole('button', { name: 'Choose folder workspace', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Process catalog' })).toBeVisible({
    timeout: 30_000
  })

  // The fixture follows native File System Access child-name semantics instead
  // of silently normalizing traversal or embedded separators.
  const invalidHandleNamesRejected = await page.evaluate(async () => {
    const picker = window.showDirectoryPicker
    if (typeof picker !== 'function') throw new Error('Folder picker fixture is unavailable')
    const root = await picker()
    return await Promise.all(
      ['..', 'nested/file.bpmn', 'nested\\file.bpmn'].map(async (name) => {
        try {
          await root.getFileHandle(name, { create: true })
          return false
        } catch (error) {
          return error instanceof TypeError
        }
      })
    )
  })
  expect(invalidHandleNamesRejected).toEqual([true, true, true])

  const importInput = page.locator('input[type="file"][accept*=".apc"][multiple]')
  await importInput.setInputFiles({
    name: 'xml-ingestion-matrix.bpmn',
    mimeType: 'application/xml',
    buffer: Buffer.from(XML_INGESTION_MATRIX, 'utf8')
  })
  await completeReviewedXmlIngestion(page, [
    {
      processId: 'Process_Xml_Main',
      elementId: 'Task_Wrong_Ar',
      field: 'name',
      target: 'Arabic',
      value: 'مراجعة الطلب',
      originalIssue: /wrong script/i
    },
    {
      processId: 'Process_Xml_Main',
      elementId: 'Task_En_Only',
      field: 'name',
      target: 'Arabic',
      value: 'تسجيل القرار',
      originalIssue: /target value is missing/i
    },
    {
      processId: 'Process_Xml_Secondary',
      elementId: 'Task_Ar_Only',
      field: 'name',
      target: 'English',
      value: 'Archive case',
      originalIssue: /target value is missing/i
    }
  ])

  const workspaceReview = page.getByRole('dialog', { name: 'Review workspace import' })
  await expect(workspaceReview).toContainText('Process_Xml_Main')
  await expect(workspaceReview).toContainText('Process_Xml_Secondary')
  await confirmWorkspaceImport(page, 'xml-ingestion-matrix.bpmn', 'explicit')

  const persisted = await page.evaluate(() =>
    window.__ORBITPM_MANDATORY_TRANSLATION_FS__.read('xml-ingestion-matrix.bpmn')
  )
  expect(persisted).toContain('orbitpm:nameAr="مراجعة الطلب"')
  expect(persisted).toContain('orbitpm:nameAr="تسجيل القرار"')
  expect(persisted).toContain('orbitpm:nameEn="Archive case"')
  expect(persisted).toContain('id="Plane_Xml_Main"')
  expect(persisted).toContain('id="Plane_Xml_Secondary"')

  await openTreeFile(page, 'xml-ingestion-matrix.bpmn')
  await expect
    .poll(() => elementState(page, 'Task_Wrong_Ar'))
    .toMatchObject({
      name: 'Review request',
      nameEn: 'Review request',
      nameAr: 'مراجعة الطلب'
    })
  await expect(
    page.locator('.djs-container:visible .djs-element[data-element-id="Task_Wrong_Ar"]', {
      hasText: 'Review request'
    })
  ).toBeVisible()
})

test('TR4/TR10: mixed and neutral labels, branch conditions, annotations and details survive undo, save and reopen', async ({
  page
}) => {
  test.setTimeout(180_000)
  await installMandatoryTranslationWorkspace(page, { name: 'TranslationMatrixWorkspace' })
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page.getByRole('button', { name: 'Choose folder workspace', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Process catalog' })).toBeVisible({
    timeout: 30_000
  })

  const importInput = page.locator('input[type="file"][accept*=".apc"][multiple]')
  await importInput.setInputFiles({
    name: 'translation-matrix.bpmn',
    mimeType: 'application/xml',
    buffer: Buffer.from(TRANSLATION_MATRIX_XML, 'utf8')
  })
  await confirmWorkspaceImport(page, 'translation-matrix.bpmn')
  await openTreeFile(page, 'translation-matrix.bpmn')

  await expect
    .poll(() => elementState(page, 'Task_Mixed'))
    .toMatchObject({
      name: 'Review request',
      nameEn: 'Review request',
      nameAr: 'مراجعة الطلب'
    })
  await expect
    .poll(() => elementState(page, 'Task_API'))
    .toMatchObject({ name: 'API', nameEn: 'API', nameAr: 'API' })
  await expect
    .poll(() => elementState(page, 'Flow_Approved'))
    .toMatchObject({
      name: 'Request is approved',
      nameEn: 'Request is approved',
      nameAr: 'تمت الموافقة على الطلب'
    })
  await expect
    .poll(() => elementState(page, 'Annotation_Matrix'))
    .toMatchObject({
      text: 'Check supporting evidence',
      nameEn: 'Check supporting evidence',
      nameAr: 'تحقق من الأدلة الداعمة'
    })
  await expect
    .poll(() => elementState(page, 'Task_Details'))
    .toMatchObject({
      owner: 'Case team',
      ownerEn: 'Case team',
      ownerAr: 'فريق الحالات',
      inputs: 'Reviewed request',
      inputsEn: 'Reviewed request',
      inputsAr: 'الطلب المراجع',
      description: 'Record the reviewed outcome',
      descriptionEn: 'Record the reviewed outcome',
      descriptionAr: 'سجل النتيجة المراجعة'
    })

  // Put a mixed-script Arabic target through the production Details editor.
  // The real translation audit must list it for manual review and must not
  // silently send or project it.
  await selectElement(page, 'Task_Mixed')
  await page.getByRole('button', { name: 'Details…', exact: true }).click()
  let details = page.getByRole('dialog', { name: 'Step details' })
  await details.getByLabel('Name (Arabic)').fill('Review طلب')
  await details.getByRole('button', { name: 'Apply', exact: true }).click()
  await page.getByRole('button', { name: /Translate/ }).click()
  const mixedReview = page.getByRole('dialog', { name: 'Review translation' })
  await expect(mixedReview).toBeVisible()
  await expect(mixedReview).toContainText('mixed')
  await expect(mixedReview).toContainText('Task_Mixed · name · en→ar · Mixed writing systems')
  await mixedReview.getByRole('button', { name: 'Postpone' }).click()
  await selectElement(page, 'Task_Mixed')
  await page.getByRole('button', { name: 'Details…', exact: true }).click()
  details = page.getByRole('dialog', { name: 'Step details' })
  await details.getByLabel('Name (Arabic)').fill('مراجعة الطلب')
  await details.getByRole('button', { name: 'Apply', exact: true }).click()

  // Source Apply is itself a mandatory ingestion boundary. Submit an actual
  // mixed-script Arabic value and repair it only in the shared, digest-bound
  // XML review before the source transaction is allowed to replace the model.
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  const source = page.getByRole('dialog', { name: 'BPMN XML source' })
  const sourceEditor = source.getByRole('textbox')
  const sourceXml = await sourceEditor.inputValue()
  const updatedSource = sourceXml.replace(
    /(<bpmn:task\b[^>]*\bid="Task_Mixed"[^>]*\borbitpm:nameAr=")[^"]*(")/u,
    '$1Review طلب modified$2'
  )
  expect(updatedSource).not.toBe(sourceXml)
  await sourceEditor.fill(updatedSource)
  await source.getByRole('button', { name: 'Preview changes' }).click()
  const applySource = source.getByRole('button', { name: 'Apply source' })
  await expect(applySource).toBeEnabled({ timeout: 30_000 })
  await applySource.click()
  await expect
    .poll(() => elementState(page, 'Task_Mixed'))
    .toMatchObject({
      nameAr: 'مراجعة الطلب'
    })
  await completeReviewedXmlIngestion(page, [
    {
      processId: 'Process_Translation_Matrix',
      elementId: 'Task_Mixed',
      field: 'name',
      target: 'Arabic',
      value: 'مراجعة الطلب المعدلة',
      originalIssue: /mixed-script/i
    }
  ])
  await expect(source).toBeHidden({ timeout: 30_000 })
  await expect
    .poll(() => elementState(page, 'Task_Mixed'))
    .toMatchObject({ name: 'Review request', nameAr: 'مراجعة الطلب المعدلة' })

  const stackBeforeToggle = await page.evaluate(() => {
    const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
    return (modeler.get('commandStack') as { _stackIdx: number })._stackIdx
  })
  await clickDiagramLanguageToggle(page)
  await expect.poll(() => activeDiagramLanguage(page)).toBe('ar')
  await expect.poll(() => renderedText(page, 'Task_Mixed')).toContain('مراجعة الطلب المعدلة')
  await expect.poll(() => renderedText(page, 'Task_API')).toContain('API')
  await expect.poll(() => renderedText(page, 'Flow_Approved')).toContain('تمت الموافقة على الطلب')
  await expect
    .poll(() => renderedText(page, 'Annotation_Matrix'))
    .toContain('تحقق من الأدلة الداعمة')
  await expect(
    page.locator('.djs-element[data-element-id="Task_Mixed"]', {
      hasText: 'مراجعة الطلب المعدلة'
    })
  ).toBeVisible()

  // The active Arabic projection reaches the production Details UI too.
  await selectElement(page, 'Task_Details')
  await page.getByRole('button', { name: 'Details…', exact: true }).click()
  details = page.getByRole('dialog', { name: 'Step details' })
  await expect(details.getByLabel('Name (Arabic)')).toHaveValue('تسجيل القرار')
  await expect(details.getByRole('combobox', { name: /Owner/ }).first()).toHaveValue('فريق الحالات')
  await expect(details.getByLabel('Inputs / base information')).toHaveValue('الطلب المراجع')
  await expect(details.getByLabel('Outputs')).toHaveValue('القرار المسجل')
  await expect(details.getByLabel('Supporting system')).toHaveValue('نظام الحالات')
  await details.getByRole('button', { name: 'Cancel', exact: true }).click()

  // One undo restores every visible projection and active-language marker.
  await page.locator('.djs-container:visible > svg').first().focus()
  await page.keyboard.press('Control+z')
  await expect.poll(() => activeDiagramLanguage(page)).toBe('en')
  await expect.poll(() => renderedText(page, 'Task_Mixed')).toContain('Review request')
  await expect.poll(() => renderedText(page, 'Flow_Approved')).toContain('Request is approved')
  await expect
    .poll(() => renderedText(page, 'Annotation_Matrix'))
    .toContain('Check supporting evidence')
  await expect
    .poll(() =>
      page.evaluate(() => {
        const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
        return (modeler.get('commandStack') as { _stackIdx: number })._stackIdx
      })
    )
    .toBe(stackBeforeToggle)

  // Reapply Arabic, save to the real directory adapter, close and reopen the
  // exact persisted file. The Arabic projection and paired metadata survive.
  await clickDiagramLanguageToggle(page)
  await expect.poll(() => activeDiagramLanguage(page)).toBe('ar')
  await saveActiveDiagram(page)
  await closeActiveTab(page)
  await openTreeFile(page, 'translation-matrix.bpmn')
  await expect.poll(() => activeDiagramLanguage(page)).toBe('ar')
  await expect.poll(() => renderedText(page, 'Task_Mixed')).toContain('مراجعة الطلب المعدلة')
  await expect(
    page.locator('.djs-element[data-element-id="Task_Mixed"]', {
      hasText: 'مراجعة الطلب المعدلة'
    })
  ).toBeVisible()

  // UI locale parity is independent of diagram language and keeps the Arabic
  // projection visible while the surrounding shell changes direction.
  await page.getByRole('button', { name: /العربية/ }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('.djs-container:visible')).toContainText('مراجعة الطلب المعدلة')
  await page.getByRole('button', { name: 'الواجهة: EN', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})

test('TR5: ARIS imports through production review and backup preserves Arabic output', async ({
  page
}) => {
  test.setTimeout(180_000)
  await installMandatoryTranslationWorkspace(page, {
    name: 'BoundaryWorkspace',
    seed: { 'translation-matrix.bpmn': TRANSLATION_MATRIX_XML }
  })
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page.getByRole('button', { name: 'Choose folder workspace', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Process catalog' })).toBeVisible({
    timeout: 30_000
  })

  const importInput = page.locator('input[type="file"][accept*=".apc"][multiple]')
  await importInput.setInputFiles({
    name: 'aris-translation.apc',
    mimeType: 'application/xml',
    buffer: Buffer.from(ARIS_BILINGUAL, 'utf8')
  })
  const arisReview = page.getByRole('dialog', { name: 'Review workspace import' })
  await expect(arisReview).toBeVisible({ timeout: 30_000 })
  await expect(arisReview).toContainText('ARIS conversion reports')
  await expect(arisReview).toContainText('Converted3')
  await expect(arisReview).not.toContainText('structure.target-namespace')
  await confirmWorkspaceImport(page, 'aris-translation.apc')
  await openTreeFile(page, 'aris-translation.bpmn')
  const arisTask = await page.evaluate(() => {
    const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
    type Element = {
      id: string
      labelTarget?: unknown
      businessObject?: { get?(key: string): unknown; $attrs?: Record<string, unknown> }
    }
    return (
      (modeler.get('elementRegistry') as { getAll(): Element[] }).getAll().find((element) => {
        if (element.labelTarget) return false
        return (
          (element.businessObject?.get?.('orbitpm:nameEn') ??
            element.businessObject?.$attrs?.['orbitpm:nameEn']) === 'Review application'
        )
      })?.id ?? null
    )
  })
  expect(arisTask).not.toBeNull()
  await clickDiagramLanguageToggle(page)
  await expect.poll(() => activeDiagramLanguage(page)).toBe('ar')
  await expect(
    page.locator(`.djs-container:visible .djs-element[data-element-id="${arisTask as string}"]`, {
      hasText: 'مراجعة الطلب'
    })
  ).toBeVisible()
  await saveActiveDiagram(page)
  await closeActiveTab(page)

  await openTreeFile(page, 'translation-matrix.bpmn')
  await clickDiagramLanguageToggle(page)
  await expect.poll(() => activeDiagramLanguage(page)).toBe('ar')
  await expect.poll(() => renderedText(page, 'Task_Mixed')).toContain('مراجعة الطلب')
  await expect(
    page.locator('.djs-element[data-element-id="Task_Mixed"]', {
      hasText: 'مراجعة الطلب'
    })
  ).toBeVisible()
  await saveActiveDiagram(page)

  // Export through the visible backup control, remove one source from the
  // backing directory, then restore the exact downloaded bytes through the
  // visible production backup-import file picker.
  const backupDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export workspace backup' }).click()
  const backup = await backupDownload
  const backupPath = await backup.path()
  if (!backupPath) throw new Error('Playwright did not retain the workspace backup')
  const backupBytes = readFileSync(backupPath)
  expect(backupBytes.byteLength).toBeGreaterThan(1_000)

  await closeActiveTab(page)
  await page.evaluate(() =>
    window.__ORBITPM_MANDATORY_TRANSLATION_FS__.deleteExternal('translation-matrix.bpmn')
  )
  await expect
    .poll(() => page.evaluate(() => window.__ORBITPM_MANDATORY_TRANSLATION_FS__.paths()))
    .not.toContain('translation-matrix.bpmn')
  await page.getByRole('button', { name: 'Refresh workspace' }).click()
  await expect(
    page.locator(
      '.orbitpm-tree-row[data-rel-path="translation-matrix.bpmn"]:not(.orbitpm-tree-reference-row)'
    )
  ).toHaveCount(0)

  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import workspace backup' }).click()
  const chooser = await chooserPromise
  await chooser.setFiles({
    name: backup.suggestedFilename(),
    mimeType: 'application/zip',
    buffer: backupBytes
  })
  const backupReview = page.getByRole('dialog', { name: 'Review backup file collisions' })
  await expect(backupReview).toBeVisible({ timeout: 30_000 })
  await expect(backupReview).toContainText('translation-matrix.bpmn')
  await expect(backupReview).toContainText('Automatically complete')
  await expect(backupReview).toContainText('0 issues before review · 0 after review')
  await backupReview.getByRole('button', { name: 'Apply backup import' }).click()
  await expect(backupReview).toBeHidden({ timeout: 30_000 })
  await expect
    .poll(() => page.evaluate(() => window.__ORBITPM_MANDATORY_TRANSLATION_FS__.paths()))
    .toContain('translation-matrix.bpmn')

  await openTreeFile(page, 'translation-matrix.bpmn')
  // Backup review projects to the current English UI target; the paired
  // Arabic values remain durable and become visible through the real toggle.
  await expect.poll(() => activeDiagramLanguage(page)).toBe('en')
  await clickDiagramLanguageToggle(page)
  await expect.poll(() => activeDiagramLanguage(page)).toBe('ar')
  await expect.poll(() => renderedText(page, 'Task_Mixed')).toContain('مراجعة الطلب')
  await expect(
    page.locator('.djs-element[data-element-id="Task_Mixed"]', {
      hasText: 'مراجعة الطلب'
    })
  ).toBeVisible()
})

test('TR5: AI text, DOCX, PDF, PNG/image and Excel use their real generation/import surfaces with EN/AR output', async ({
  page
}) => {
  test.setTimeout(240_000)
  const modelId = 'google/gemini-3.6-flash'
  const apiKey = 'mandatory-translation-openrouter-key'
  const requests: Array<Record<string, unknown>> = []
  await page.route('https://openrouter.ai/**', async (route) => {
    const request = route.request()
    const headers = request.headers()
    const corsHeaders = {
      'access-control-allow-origin': headers.origin ?? '*',
      'access-control-allow-headers':
        headers['access-control-request-headers'] ??
        'authorization, content-type, http-referer, x-title',
      'access-control-allow-methods': 'GET, POST, OPTIONS'
    }
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders, body: '' })
      return
    }
    if (new URL(request.url()).pathname === '/api/v1/credits') {
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ data: { total_credits: 100, total_usage: 1 } })
      })
      return
    }
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/v1/chat/completions'
    ) {
      const invalidFirstPass = requests.length % 2 === 0
      requests.push(request.postDataJSON() as Record<string, unknown>)
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  process: [
                    {
                      type: 'startEvent',
                      id: 'Start_Boundary',
                      label: 'Request received',
                      labelEn: 'Request received',
                      labelAr: 'استلام الطلب'
                    },
                    {
                      type: 'userTask',
                      id: 'Review_Boundary',
                      label: 'Review boundary',
                      labelEn: 'Review boundary',
                      labelAr: invalidFirstPass ? 'Review boundary' : 'مراجعة المسار'
                    },
                    {
                      type: 'endEvent',
                      id: 'End_Boundary',
                      label: 'Decision recorded',
                      labelEn: 'Decision recorded',
                      labelAr: 'تسجيل القرار'
                    }
                  ]
                })
              }
            }
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
        })
      })
      return
    }
    await route.abort()
  })

  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page.getByRole('button', { name: /New blank diagram/i }).click()
  await waitForModeler(page)
  await expandAiPanel(page)
  await configureOpenRouter(page, modelId, apiKey)
  await expandAiPanel(page)
  const generateTextBoundary = async (
    name: string,
    description: string
  ): Promise<Record<string, unknown>> => {
    await expandAiPanel(page)
    await page.getByRole('tab', { name: 'From description' }).click()
    await page.getByRole('textbox', { name: 'Description', exact: true }).fill(description)
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
    const before = requests.length
    await page.getByLabel('I reviewed this request and consent to sending the listed data.').check()
    await page.getByRole('button', { name: 'Generate', exact: true }).click()
    await expect.poll(() => requests.length, { timeout: 30_000 }).toBe(before + 2)
    expect(JSON.stringify(requests[before + 1])).toContain('orbitpm.bilingual-wrong-script-ar')
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: new RegExp(`Opened ${name.toLowerCase().replace(/\s+/gu, '-')}`) })
    ).toBeVisible({ timeout: 30_000 })
    await assertActiveGeneratedBilingual(page)
    return requests[before] as Record<string, unknown>
  }

  const aiRequest = await generateTextBoundary('AI boundary', 'Review a permit request')
  expect(JSON.stringify(aiRequest)).toContain('Review a permit request')
  expect(JSON.stringify(aiRequest)).not.toContain('data:application/')

  await expandAiPanel(page)
  await page.getByRole('tab', { name: 'From description' }).click()
  await page
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('Use the attached brief')
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('DOCX boundary')
  const docx = createDocxFixture()
  await page.locator('input[type="file"][accept*=".docx"]').setInputFiles({
    name: 'mandatory-translation.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docx
  })
  await expect(page.getByText(/characters of text extracted/i)).toBeVisible({
    timeout: 30_000
  })
  const beforeDocx = requests.length
  await page.getByLabel('I reviewed this request and consent to sending the listed data.').check()
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  await expect.poll(() => requests.length, { timeout: 30_000 }).toBe(beforeDocx + 2)
  expect(JSON.stringify(requests[beforeDocx + 1])).toContain('orbitpm.bilingual-wrong-script-ar')
  await expect(page.getByRole('status').filter({ hasText: /Opened docx-boundary/ })).toBeVisible({
    timeout: 30_000
  })
  await assertActiveGeneratedBilingual(page)
  const docxRequest = requests[beforeDocx] as Record<string, unknown>
  expect(JSON.stringify(docxRequest)).toContain('Review the attached permit request')
  expect(JSON.stringify(docxRequest)).toContain('mandatory-translation.docx')
  await page.getByRole('button', { name: 'Remove attachment', exact: true }).click()

  const generateDocumentBoundary = async (
    name: string,
    file: { name: string; mimeType: string; buffer: Buffer },
    hint: string
  ): Promise<Record<string, unknown>> => {
    await expandAiPanel(page)
    await page.getByRole('tab', { name: 'From PDF / image' }).click()
    await page.locator('input[type="file"][accept*="image/png"]').setInputFiles(file)
    await page.getByRole('textbox', { name: /Which process?/ }).fill(hint)
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
    const before = requests.length
    await page.getByLabel('I reviewed this request and consent to sending the listed data.').check()
    await page.getByRole('button', { name: 'Generate from document' }).click()
    await expect.poll(() => requests.length, { timeout: 30_000 }).toBe(before + 2)
    expect(JSON.stringify(requests[before + 1])).toContain('orbitpm.bilingual-wrong-script-ar')
    await assertActiveGeneratedBilingual(page)
    return requests[before] as Record<string, unknown>
  }

  const pdfRequest = await generateDocumentBoundary(
    'PDF boundary',
    {
      name: 'mandatory-translation.pdf',
      mimeType: 'application/pdf',
      buffer: readFileSync(TINY_PDF)
    },
    'Model the permit process'
  )
  expect(JSON.stringify(pdfRequest)).toContain('data:application/pdf;base64,')
  expect(JSON.stringify(pdfRequest)).toContain('mandatory-translation.pdf')

  const pngRequest = await generateDocumentBoundary(
    'PNG boundary',
    {
      name: 'mandatory-translation.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nC8AAAAASUVORK5CYII=',
        'base64'
      )
    },
    'Model the photographed process'
  )
  expect(JSON.stringify(pngRequest)).toContain('data:image/png;base64,')
  expect(JSON.stringify(pngRequest)).toContain('Model the photographed process')
  expect(requests).toHaveLength(8)

  // Excel starts with the exact shipped download. First prove that Latin text
  // in an Arabic cell is rejected by the production workbook audit. Then use
  // the same cell as an explicit missing target so the production handoff can
  // reach the shared XML review, where a Latin repair is rejected before the
  // valid Arabic value is committed into the real SVG.
  await expandAiPanel(page)
  await page.getByRole('tab', { name: 'Excel / CSV' }).click()
  const spreadsheet = page.getByRole('region', { name: 'Import Excel or CSV' })
  const templateDownload = page.waitForEvent('download')
  await spreadsheet.getByRole('button', { name: 'Download example template' }).click()
  const template = await templateDownload
  const templatePath = await template.path()
  if (!templatePath) throw new Error('Playwright did not retain the official Excel example')
  const templateBytes = readFileSync(templatePath)
  const invalidWorkbook = workbookWithArabicCell(templateBytes, 'Review request')
  await spreadsheet.locator('input[type="file"][accept*=".xlsx"]').setInputFiles({
    name: template.suggestedFilename(),
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: invalidWorkbook
  })
  await expect(spreadsheet.getByText(/Official OrbitPM template detected/i)).toBeVisible({
    timeout: 30_000
  })
  await spreadsheet.getByRole('button', { name: 'Validate and preview' }).click()
  await expect(spreadsheet.getByText('No workbook issues found.')).toBeVisible({
    timeout: 30_000
  })
  await spreadsheet.getByRole('button', { name: 'Prepare BPMN files' }).click()
  await expect(
    spreadsheet.getByText('Import is blocked until the listed issues are resolved.')
  ).toBeVisible({ timeout: 30_000 })
  await expect(
    spreadsheet.getByText(/Bilingual review required: 0 missing and \d+ invalid/)
  ).toBeVisible()
  await expect(spreadsheet.getByRole('button', { name: 'Commit import' })).toHaveCount(0)
  await spreadsheet.getByRole('button', { name: 'Start over' }).click()

  const missingWorkbook = workbookWithArabicCell(templateBytes, '')
  await spreadsheet.locator('input[type="file"][accept*=".xlsx"]').setInputFiles({
    name: template.suggestedFilename(),
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: missingWorkbook
  })
  await expect(spreadsheet.getByText(/Official OrbitPM template detected/i)).toBeVisible({
    timeout: 30_000
  })
  await spreadsheet.getByRole('button', { name: 'Validate and preview' }).click()
  await expect(spreadsheet.getByText('No workbook issues found.')).toBeVisible({
    timeout: 30_000
  })
  await spreadsheet.getByRole('button', { name: 'Prepare BPMN files' }).click()
  await expect(
    spreadsheet.getByText('Bilingual review required: 1 missing and 0 invalid values.')
  ).toBeVisible({ timeout: 30_000 })
  await spreadsheet.getByRole('button', { name: 'Open bilingual review' }).click()
  await completeReviewedXmlIngestion(page, [
    {
      processId: 'leave_approval',
      elementId: 'Review_Request',
      field: 'name',
      target: 'Arabic',
      value: 'مراجعة الطلب',
      originalIssue: /target value is missing/i,
      invalidProbe: 'Review request'
    }
  ])
  await expect(spreadsheet.getByText(/BPMN files are ready/i)).toBeVisible({
    timeout: 30_000
  })
  await spreadsheet.getByRole('button', { name: 'Commit import' }).click()
  await expect(spreadsheet.getByText('Import committed successfully.')).toBeVisible({
    timeout: 30_000
  })
  await waitForModeler(page)
  await expect
    .poll(() => elementState(page, 'Review_Request'))
    .toMatchObject({
      name: 'Review request',
      nameEn: 'Review request',
      nameAr: 'مراجعة الطلب'
    })
  await clickDiagramLanguageToggle(page)
  await expect
    .poll(async () => (await elementState(page, 'Review_Request')).name)
    .toBe('مراجعة الطلب')
  await expect(
    page.locator('.djs-container:visible .djs-element[data-element-id="Review_Request"]', {
      hasText: 'مراجعة الطلب'
    })
  ).toBeVisible()
})

test('TR6: cancellation, HTTP 429 per-field retry, partial failure and per-field manual recovery remain truthful', async ({
  page
}) => {
  test.setTimeout(180_000)
  let phase: 'cancel' | 'recover' = 'cancel'
  let releaseCancelledRequests!: () => void
  const cancelledGate = new Promise<void>((resolveGate) => {
    releaseCancelledRequests = resolveGate
  })
  let startedCancelledRequest!: () => void
  const cancelledRequestStarted = new Promise<void>((resolveStarted) => {
    startedCancelledRequest = resolveStarted
  })
  const cancelledTransportFailures: string[] = []
  let hostileLateFulfillmentAttempted = false
  let hostileLateFulfillmentSettled = false
  let releaseRetrySuccess!: () => void
  const retrySuccessGate = new Promise<void>((resolveGate) => {
    releaseRetrySuccess = resolveGate
  })
  let retrySecondAttemptStarted!: () => void
  const retrySecondAttempt = new Promise<void>((resolveStarted) => {
    retrySecondAttemptStarted = resolveStarted
  })
  const retrySource = 'Retry owner'
  const retryArabic = 'مسؤول إعادة المحاولة'
  const googleAttempts = new Map<string, number>()
  const memoryAttempts = new Map<string, number>()

  page.on('requestfailed', (request) => {
    if (phase === 'cancel' && new URL(request.url()).hostname === 'translate.googleapis.com') {
      cancelledTransportFailures.push(request.failure()?.errorText ?? 'unknown transport failure')
    }
  })
  await page.route('https://translate.googleapis.com/**', async (route) => {
    const text = new URL(route.request().url()).searchParams.get('q') ?? ''
    googleAttempts.set(text, (googleAttempts.get(text) ?? 0) + 1)
    if (phase === 'cancel') {
      startedCancelledRequest()
      await cancelledGate
      hostileLateFulfillmentAttempted = true
      try {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
          body: JSON.stringify([[['ترجمة ملغاة', text, null, null]], null, 'en'])
        })
      } catch {
        // Playwright may reject a synthetic fulfillment after fetch abort.
      } finally {
        hostileLateFulfillmentSettled = true
      }
      return
    }
    if (text === retrySource && (googleAttempts.get(text) ?? 0) === 2) {
      retrySecondAttemptStarted()
      await retrySuccessGate
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        body: JSON.stringify([[[retryArabic, text, null, null]], null, 'en'])
      })
      return
    }
    await route.fulfill({
      status: text === retrySource ? 429 : 400,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'retry-after': '0'
      },
      body: JSON.stringify({ error: 'injected translation failure' })
    })
  })
  await page.route('https://api.mymemory.translated.net/**', async (route) => {
    const text = new URL(route.request().url()).searchParams.get('q') ?? ''
    memoryAttempts.set(text, (memoryAttempts.get(text) ?? 0) + 1)
    await route.fulfill({
      status: 429,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'retry-after': '0'
      },
      body: JSON.stringify({ responseStatus: 429 })
    })
  })

  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page
    .getByRole('button', { name: /New process/i })
    .first()
    .click()
  const newProcess = page.getByRole('dialog')
  await newProcess.getByRole('textbox').fill('Provider recovery')
  await newProcess.getByRole('button', { name: 'Create', exact: true }).click()
  await waitForModeler(page)
  await page.evaluate(() => {
    const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
    type Element = {
      id: string
      labelTarget?: unknown
      businessObject?: { name?: unknown; get?(key: string): unknown }
    }
    const registry = modeler.get('elementRegistry') as { getAll(): Element[] }
    const modeling = modeler.get('modeling') as {
      createShape(shape: unknown, position: { x: number; y: number }, parent: unknown): Element
      updateProperties(element: unknown, properties: Record<string, unknown>): void
    }
    const factory = modeler.get('elementFactory') as {
      createShape(attributes: { type: string }): unknown
    }
    const canvas = modeler.get('canvas') as { getRootElement(): unknown; zoom(mode: string): void }
    const seen = new Set<unknown>()
    for (const element of registry.getAll()) {
      const businessObject = element.businessObject
      if (!businessObject || element.labelTarget || seen.has(businessObject)) continue
      seen.add(businessObject)
      const value = businessObject.get?.('name') ?? businessObject.name
      if (typeof value !== 'string' || !value.trim()) continue
      modeling.updateProperties(element, {
        'orbitpm:nameEn': value,
        'orbitpm:nameAr': 'تسمية قالب'
      })
    }
    const root = canvas.getRootElement()
    modeling.updateProperties(root, {
      'orbitpm:nameEn': 'Provider recovery',
      'orbitpm:nameAr': 'استعادة المزوّد',
      'orbitpm:activeLang': 'en'
    })
    const add = (id: string, name: string, nameAr: string | null, x: number): Element => {
      const task = modeling.createShape(
        factory.createShape({ type: 'bpmn:Task' }),
        { x, y: 310 },
        root
      )
      modeling.updateProperties(task, {
        id,
        name,
        'orbitpm:nameEn': name,
        ...(nameAr === null ? {} : { 'orbitpm:nameAr': nameAr })
      })
      return task
    }
    const retryTask = add('Task_Retry', 'Retry one', 'إعادة المحاولة الأولى', 400)
    modeling.updateProperties(retryTask, {
      'orbitpm:owner': 'Retry owner',
      'orbitpm:ownerEn': 'Retry owner'
    })
    add('Task_Manual', 'Manual two', null, 590)
    canvas.zoom('fit-viewport')
  })

  await page.getByRole('button', { name: /Translate/ }).click()
  const review = page.getByRole('dialog', { name: 'Review translation' })
  await expect(review).toBeVisible()
  const retryRow = review.getByRole('listitem', {
    name: 'Task_Retry · owner · en→ar',
    exact: true
  })
  const manualRow = review.getByRole('listitem', {
    name: 'Task_Manual · name · en→ar',
    exact: true
  })
  await expect(retryRow).toBeVisible()
  await expect(manualRow).toBeVisible()
  await expect(review.getByText('Translation is running…')).toHaveCount(0)
  await expect(review.getByText('Translation was cancelled.', { exact: false })).toHaveCount(0)
  await expect(review.getByText('The diagram changed after review.', { exact: false })).toHaveCount(
    0
  )
  await expect(
    review.getByText('All target fields now pass the bilingual audit.', { exact: false })
  ).toHaveCount(0)
  await expect(review).not.toContainText('Translation provider failed')

  await review.getByLabel('Translation provider').selectOption('free')
  await review.getByRole('button', { name: 'Translate now' }).click()
  await cancelledRequestStarted
  await expect(
    review.getByRole('status').filter({ hasText: /Google Translate: item \d+ of 2/ })
  ).toBeVisible()
  await expect(review.getByRole('button', { name: 'Cancel translation' })).toBeVisible()
  await expect(review.getByText('Retrying this field…')).toHaveCount(0)
  await review.getByRole('button', { name: 'Cancel translation' }).click()
  await expect(review).toContainText('Translation was cancelled.')
  await expect(review.getByText('Translation is running…')).toHaveCount(0)
  await expect(review.getByText('Retrying this field…')).toHaveCount(0)
  await expect(review.getByText('The diagram changed after review.', { exact: false })).toHaveCount(
    0
  )
  await expect(
    review.getByText('All target fields now pass the bilingual audit.', { exact: false })
  ).toHaveCount(0)
  await expect(review).not.toContainText('Translation provider failed')
  await expect
    .poll(() => elementState(page, 'Task_Retry'))
    .toMatchObject({
      name: 'Retry one',
      nameAr: 'إعادة المحاولة الأولى',
      ownerEn: retrySource,
      ownerAr: null
    })
  await expect
    .poll(() => elementState(page, 'Task_Manual'))
    .toMatchObject({ name: 'Manual two', nameAr: null })
  releaseCancelledRequests()
  await expect.poll(() => cancelledTransportFailures.length, { timeout: 30_000 }).toBeGreaterThan(0)
  expect(cancelledTransportFailures).toEqual(
    expect.arrayContaining([expect.stringMatching(/aborted|failed/iu)])
  )
  await expect.poll(() => hostileLateFulfillmentAttempted).toBe(true)
  await expect.poll(() => hostileLateFulfillmentSettled).toBe(true)
  await expect
    .poll(() => elementState(page, 'Task_Retry'))
    .toMatchObject({
      name: 'Retry one',
      nameAr: 'إعادة المحاولة الأولى',
      ownerEn: retrySource,
      ownerAr: null
    })
  await expect
    .poll(() => elementState(page, 'Task_Manual'))
    .toMatchObject({ name: 'Manual two', nameAr: null })

  phase = 'recover'
  googleAttempts.clear()
  memoryAttempts.clear()
  await retryRow.getByRole('button', { name: 'Retry this field' }).click()
  const retryDisclosure = retryRow.getByRole('region', {
    name: 'Confirm this one-field request'
  })
  await expect(retryDisclosure).toBeVisible()
  await expect(retryDisclosure).toContainText(
    'Only the exact field below will be sent in an estimated 1–6 external requests.'
  )
  await expect(retryDisclosure).toContainText('google-translate+mymemory')
  await expect(retryDisclosure).toContainText(
    'Process_provider_recovery / Task_Retry / owner / en→ar'
  )
  await expect(retryDisclosure).toContainText(retrySource)
  await expect(retryDisclosure).toContainText(
    'This owner/responsibility field may contain a person’s name.'
  )
  await expect(retryDisclosure.getByText(/^review-[0-9a-f]{8}$/u)).toBeVisible()
  await expect(review.getByText('Translation is running…')).toHaveCount(0)
  expect(googleAttempts.size).toBe(0)
  expect(memoryAttempts.size).toBe(0)
  await retryDisclosure.getByRole('button', { name: 'Cancel one-field retry' }).click()
  await expect(retryDisclosure).toBeHidden()
  expect(googleAttempts.size).toBe(0)
  expect(memoryAttempts.size).toBe(0)

  await retryRow.getByRole('button', { name: 'Retry this field' }).click()
  await expect(retryDisclosure).toBeVisible()
  await retryDisclosure.getByRole('button', { name: 'Confirm and retry this field' }).click()
  await retrySecondAttempt
  await expect(retryRow.getByRole('button', { name: 'Retrying this field…' })).toBeVisible()
  await expect(
    review.getByRole('status').filter({ hasText: /Google Translate: item 1 of 1/ })
  ).toBeVisible()
  await expect(review.getByText('Translation was cancelled.', { exact: false })).toHaveCount(0)
  await expect(review.getByText('The diagram changed after review.', { exact: false })).toHaveCount(
    0
  )
  releaseRetrySuccess()
  await expect(retryRow).toHaveCount(0, { timeout: 30_000 })
  await expect(review.getByText('Translation is running…')).toHaveCount(0)
  await expect(review.getByText('Retrying this field…')).toHaveCount(0)
  await expect(review).toContainText(
    'Some fields are still unresolved. They remain listed and the diagram language was not reported as complete.',
    { timeout: 30_000 }
  )
  await expect(review).not.toContainText('Translation provider failed')
  await expect
    .poll(() => elementState(page, 'Task_Retry'))
    .toMatchObject({
      name: 'Retry one',
      nameAr: 'إعادة المحاولة الأولى',
      owner: retrySource,
      ownerEn: retrySource,
      ownerAr: retryArabic
    })
  expect(googleAttempts.get(retrySource)).toBe(2)

  await manualRow.getByRole('button', { name: 'Retry this field' }).click()
  const manualDisclosure = manualRow.getByRole('region', {
    name: 'Confirm this one-field request'
  })
  await expect(manualDisclosure).toBeVisible()
  await expect(manualDisclosure).toContainText(
    'Process_provider_recovery / Task_Manual / name / en→ar'
  )
  await expect(manualDisclosure).toContainText('Manual two')
  await expect(manualDisclosure).toContainText(
    'This field is not marked as an owner/responsibility field.'
  )
  await expect(review.getByText('Translation is running…')).toHaveCount(0)
  expect(googleAttempts.get('Manual two') ?? 0).toBe(0)
  expect(memoryAttempts.get('Manual two') ?? 0).toBe(0)
  await manualDisclosure.getByRole('button', { name: 'Confirm and retry this field' }).click()
  await expect(manualRow).toContainText('Translation provider failed', { timeout: 30_000 })
  await expect
    .poll(() => elementState(page, 'Task_Manual'))
    .toMatchObject({ name: 'Manual two', nameAr: null })
  expect(googleAttempts.get('Manual two')).toBe(1)
  expect(memoryAttempts.get('Manual two')).toBe(3)
  await expect(review.getByText('Translation is running…')).toHaveCount(0)
  await expect(review.getByText('Retrying this field…')).toHaveCount(0)
  await expect(review.getByText('Translation was cancelled.', { exact: false })).toHaveCount(0)
  await expect(review.getByText('The diagram changed after review.', { exact: false })).toHaveCount(
    0
  )
  await expect(
    review.getByText('All target fields now pass the bilingual audit.', { exact: false })
  ).toHaveCount(0)

  await manualRow.getByRole('button', { name: 'Edit this field manually' }).click()
  const manualInput = manualRow.getByRole('textbox', { name: 'Edit this field manually' })
  await expect(manualInput).toHaveAttribute('lang', 'ar')
  await expect(manualInput).toHaveAttribute('dir', 'rtl')
  await manualInput.fill('Manual two')
  await expect(manualRow.getByRole('alert')).toContainText('Wrong writing system')
  await expect(manualRow.getByRole('button', { name: 'Save reviewed value' })).toBeDisabled()
  await manualInput.fill('المراجعة اليدوية الثانية')
  const saveReviewed = manualRow.getByRole('button', { name: 'Save reviewed value' })
  await expect(saveReviewed).toBeEnabled()
  await saveReviewed.click()
  await expect(manualRow).toHaveCount(0)
  await expect(
    review.getByText(
      'All target fields now pass the bilingual audit. Apply the completed language view to finish.'
    )
  ).toBeVisible()
  await expect(review).not.toContainText('Translation provider failed')
  await expect(
    review.getByText(
      'Some fields are still unresolved. They remain listed and the diagram language was not reported as complete.'
    )
  ).toHaveCount(0)
  await expect(review.getByText('Translation is running…')).toHaveCount(0)
  await expect(review.getByText('Retrying this field…')).toHaveCount(0)
  await expect(review.getByText('Translation was cancelled.', { exact: false })).toHaveCount(0)
  await expect(review.getByText('The diagram changed after review.', { exact: false })).toHaveCount(
    0
  )

  await review.getByRole('button', { name: 'Apply completed language view' }).click()
  await expect(review).toBeHidden()
  await expect.poll(() => activeDiagramLanguage(page)).toBe('ar')
  await expect.poll(() => renderedText(page, 'Task_Retry')).toContain('إعادة المحاولة الأولى')
  await expect.poll(() => renderedText(page, 'Task_Manual')).toContain('المراجعة اليدوية الثانية')
  await expect(
    page.locator('.djs-element[data-element-id="Task_Manual"]', {
      hasText: 'المراجعة اليدوية الثانية'
    })
  ).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Review translation' })).toHaveCount(0)

  await page.getByRole('button', { name: /العربية/ }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('.djs-container:visible')).toContainText('المراجعة اليدوية الثانية')
})

test('TR6/TR10: workspace translation-memory recovery and late finalization stay atomic across activation', async ({
  page
}) => {
  test.setTimeout(240_000)
  const localizationSeed = {
    [WORKSPACE_GLOSSARY_PATH]: EMPTY_WORKSPACE_GLOSSARY,
    [WORKSPACE_TRANSLATION_MEMORY_PATH]: EMPTY_WORKSPACE_TRANSLATION_MEMORY
  }
  await installMandatoryTranslationWorkspace(page, {
    name: 'TmPrimaryWorkspace',
    seed: {
      ...localizationSeed,
      'tm-recovery.bpmn': TM_RECOVERY_XML,
      'tm-late.bpmn': TM_LATE_FINALIZATION_XML
    },
    secondary: {
      name: 'TmSecondaryWorkspace',
      seed: {
        ...localizationSeed,
        'tm-late.bpmn': TM_LATE_FINALIZATION_XML
      }
    }
  })

  let secondaryTransportStarted!: () => void
  const secondaryTransport = new Promise<void>((resolve) => {
    secondaryTransportStarted = resolve
  })
  let releaseSecondaryTransport!: () => void
  const secondaryTransportGate = new Promise<void>((resolve) => {
    releaseSecondaryTransport = resolve
  })
  let secondaryGoogleAttempts = 0
  const secondaryTransportFailures: string[] = []
  let secondaryLateFulfillmentAttempted = false
  let secondaryLateFulfillmentSettled = false
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).hostname === 'translate.googleapis.com') {
      secondaryTransportFailures.push(request.failure()?.errorText ?? 'unknown transport failure')
    }
  })
  await page.route('https://translate.googleapis.com/**', async (route) => {
    secondaryGoogleAttempts += 1
    secondaryTransportStarted()
    await secondaryTransportGate
    const text = new URL(route.request().url()).searchParams.get('q') ?? ''
    secondaryLateFulfillmentAttempted = true
    try {
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*'
        },
        body: JSON.stringify([[['ترجمة يجب إلغاؤها', text, null, null]], null, 'en'])
      })
    } catch {
      // Playwright may reject a synthetic fulfillment after fetch abort.
    } finally {
      secondaryLateFulfillmentSettled = true
    }
  })
  await page.route('https://api.mymemory.translated.net/**', async (route) => {
    await route.abort()
  })

  const readMemory = async (
    workspace: 'primary' | 'secondary' = 'primary'
  ): Promise<{ entries: Array<Record<string, unknown>> }> => {
    const json = await page.evaluate(
      ({ path, workspaceKey }) =>
        window.__ORBITPM_MANDATORY_TRANSLATION_FS__.read(path, workspaceKey),
      { path: WORKSPACE_TRANSLATION_MEMORY_PATH, workspaceKey: workspace }
    )
    if (!json) throw new Error(`${workspace} translation memory is missing`)
    return JSON.parse(json) as { entries: Array<Record<string, unknown>> }
  }
  const stackIndex = async (): Promise<number> =>
    await page.evaluate(() => {
      const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
      return (modeler.get('commandStack') as { _stackIdx: number })._stackIdx
    })
  const editManually = async (row: Locator, value: string): Promise<void> => {
    await row.getByRole('button', { name: 'Edit this field manually' }).click()
    const input = row.getByRole('textbox', { name: 'Edit this field manually' })
    await input.fill(value)
    await row.getByRole('button', { name: 'Save reviewed value' }).click()
  }

  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page.getByRole('button', { name: 'Choose folder workspace', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Process catalog' })).toBeVisible({
    timeout: 30_000
  })
  await expect(
    page.getByText('Every process in TmPrimaryWorkspace.', { exact: false })
  ).toBeVisible()
  await openTreeFile(page, 'tm-recovery.bpmn')
  await clearArabicNames(page, ['Task_Tm_Retry', 'Task_Tm_Continue'])
  await page.getByRole('button', { name: /Translate/ }).click()
  const review = page.getByRole('dialog', { name: 'Review translation' })
  await expect(review).toBeVisible()
  const retryRow = review.getByRole('listitem', {
    name: 'Task_Tm_Retry · name · en→ar',
    exact: true
  })
  const continueRow = review.getByRole('listitem', {
    name: 'Task_Tm_Continue · name · en→ar',
    exact: true
  })
  await expect(retryRow).toBeVisible()
  await expect(continueRow).toBeVisible()

  // The diagram mutation commits first. A storage failure then locks every
  // unrelated action until the exact accepted pair batch is retried or
  // explicitly skipped.
  const retryAttemptsBefore = await page.evaluate(
    (path) => window.__ORBITPM_MANDATORY_TRANSLATION_FS__.writeAttempts(path),
    WORKSPACE_TRANSLATION_MEMORY_PATH
  )
  await page.evaluate(
    (path) => window.__ORBITPM_MANDATORY_TRANSLATION_FS__.failNextWrites(path),
    WORKSPACE_TRANSLATION_MEMORY_PATH
  )
  await editManually(retryRow, 'إعادة محاولة حفظ الذاكرة')
  await expect(review).toContainText(
    'The translation was applied, but accepted translation pairs could not be saved to workspace translation memory:',
    { timeout: 30_000 }
  )
  await expect
    .poll(() => elementState(page, 'Task_Tm_Retry'))
    .toMatchObject({
      name: 'Retry memory save',
      nameAr: 'إعادة محاولة حفظ الذاكرة'
    })
  const stackAfterRetryMutation = await stackIndex()
  await expect(review.getByLabel('Translation provider')).toBeDisabled()
  await expect(review.getByRole('button', { name: 'Postpone' })).toBeDisabled()
  await expect(
    review.getByRole('button', { name: 'Preview translated fields only' })
  ).toBeDisabled()
  const memoryRetry = review.getByRole('button', {
    name: 'Retry saving accepted translations'
  })
  const memoryContinue = review.getByRole('button', {
    name: 'Continue without saving these pairs'
  })
  await expect(memoryRetry).toBeEnabled()
  await expect(memoryContinue).toBeEnabled()
  await review.getByRole('button', { name: 'Close' }).click()
  await expect(review).toBeVisible()
  expect((await readMemory()).entries).toEqual([])

  await memoryRetry.click()
  await expect(memoryRetry).toHaveCount(0, { timeout: 30_000 })
  await expect(review).toContainText(
    'Some fields are still unresolved. They remain listed and the diagram language was not reported as complete.'
  )
  expect(await stackIndex()).toBe(stackAfterRetryMutation)
  expect(
    await page.evaluate(
      (path) => window.__ORBITPM_MANDATORY_TRANSLATION_FS__.writeAttempts(path),
      WORKSPACE_TRANSLATION_MEMORY_PATH
    )
  ).toBe(retryAttemptsBefore + 2)
  expect((await readMemory()).entries).toEqual([
    expect.objectContaining({
      en: 'Retry memory save',
      ar: 'إعادة محاولة حفظ الذاكرة',
      accepted: true
    })
  ])

  // A repeated failure offers an explicit truthful continuation. It preserves
  // the already-applied diagram mutation and does not add the skipped pair.
  await page.evaluate(
    (path) => window.__ORBITPM_MANDATORY_TRANSLATION_FS__.failNextWrites(path, 2),
    WORKSPACE_TRANSLATION_MEMORY_PATH
  )
  await editManually(continueRow, 'متابعة حفظ الذاكرة')
  await expect(review).toContainText(
    'The translation was applied, but accepted translation pairs could not be saved to workspace translation memory:',
    { timeout: 30_000 }
  )
  const stackAfterContinueMutation = await stackIndex()
  await review.getByRole('button', { name: 'Retry saving accepted translations' }).click()
  await expect(review).toContainText(
    'The translation was applied, but accepted translation pairs could not be saved to workspace translation memory:',
    { timeout: 30_000 }
  )
  await expect(
    review.getByRole('button', { name: 'Retry saving accepted translations' })
  ).toBeEnabled()
  expect(await stackIndex()).toBe(stackAfterContinueMutation)
  await review.getByRole('button', { name: 'Continue without saving these pairs' }).click()
  await expect(review).toContainText(
    'The translation remains applied, but these accepted pairs were not saved to workspace translation memory.'
  )
  await expect(
    review.getByRole('button', { name: 'Retry saving accepted translations' })
  ).toHaveCount(0)
  await expect(review.getByRole('button', { name: 'Postpone' })).toBeEnabled()
  await expect(review.getByRole('button', { name: 'Apply completed language view' })).toBeEnabled()
  expect((await readMemory()).entries).toHaveLength(1)
  await review.getByRole('button', { name: 'Apply completed language view' }).click()
  await expect(review).toBeHidden()
  await expect.poll(() => activeDiagramLanguage(page)).toBe('ar')
  await expect.poll(() => renderedText(page, 'Task_Tm_Retry')).toContain('إعادة محاولة حفظ الذاكرة')
  await expect.poll(() => renderedText(page, 'Task_Tm_Continue')).toContain('متابعة حفظ الذاكرة')
  await saveActiveDiagram(page)

  // Hold the next accepted-pair save after the modeler mutation. While this
  // post-mutation finalization is pending it is deliberately non-cancellable.
  await openTreeFile(page, 'tm-late.bpmn')
  await clearArabicNames(page, ['Task_Tm_Late'])
  await page.getByRole('button', { name: /Translate/ }).click()
  await expect(review).toBeVisible()
  const lateRow = review.getByRole('listitem', {
    name: 'Task_Tm_Late · name · en→ar',
    exact: true
  })
  await page.evaluate(
    (path) => window.__ORBITPM_MANDATORY_TRANSLATION_FS__.holdNextWrite(path),
    WORKSPACE_TRANSLATION_MEMORY_PATH
  )
  await editManually(lateRow, 'إنهاء ترجمة مساحة العمل')
  await page.evaluate(
    (path) => window.__ORBITPM_MANDATORY_TRANSLATION_FS__.waitForHeldWrite(path),
    WORKSPACE_TRANSLATION_MEMORY_PATH
  )
  await expect(review).toContainText(
    'The translation was applied. Saving accepted pairs to workspace translation memory…'
  )
  await expect(review.getByRole('button', { name: 'Cancel translation' })).toHaveCount(0)
  await expect(review.getByLabel('Translation provider')).toBeDisabled()
  await expect(review.getByRole('button', { name: 'Postpone' })).toBeDisabled()
  await expect(review.getByRole('button', { name: 'Apply completed language view' })).toBeDisabled()
  await review.getByRole('button', { name: 'Close' }).click()
  await expect(review).toBeVisible()
  await expect
    .poll(() => elementState(page, 'Task_Tm_Late'))
    .toMatchObject({
      name: 'Finalize workspace translation',
      nameAr: 'إنهاء ترجمة مساحة العمل'
    })
  expect((await readMemory()).entries).toHaveLength(1)

  // The pending post-mutation finalization is an actual modal. Its native
  // inert boundary makes the change-folder control unreachable until the
  // accepted-pair write settles; a user cannot bypass this with background
  // interaction.
  const changeFolder = page.locator('button[title="Open a different workspace folder"]')
  await expect(changeFolder).toBeVisible()
  await expect
    .poll(() => changeFolder.evaluate((button) => Boolean(button.closest('[inert]'))))
    .toBe(true)
  await expect(
    page.getByText('Every process in TmSecondaryWorkspace.', { exact: false })
  ).toHaveCount(0)

  await page.evaluate(
    (path) => window.__ORBITPM_MANDATORY_TRANSLATION_FS__.releaseHeldWrite(path),
    WORKSPACE_TRANSLATION_MEMORY_PATH
  )
  await page.evaluate(
    (path) => window.__ORBITPM_MANDATORY_TRANSLATION_FS__.waitForHeldWriteSettled(path),
    WORKSPACE_TRANSLATION_MEMORY_PATH
  )
  await expect(review.getByRole('button', { name: 'Apply completed language view' })).toBeEnabled()
  expect((await readMemory()).entries).toEqual([
    expect.objectContaining({
      en: 'Retry memory save',
      ar: 'إعادة محاولة حفظ الذاكرة',
      accepted: true
    }),
    expect.objectContaining({
      en: 'Finalize workspace translation',
      ar: 'إنهاء ترجمة مساحة العمل',
      accepted: true
    })
  ])
  await review.getByRole('button', { name: 'Apply completed language view' }).click()
  await expect(review).toBeHidden()
  await expect
    .poll(() => changeFolder.evaluate((button) => Boolean(button.closest('[inert]'))))
    .toBe(false)

  // Once finalization completes, switch through the visible change-folder
  // control and its real dirty-work guard into a genuinely different FSA root.
  await changeFolder.click()
  const switchGuard = page.getByRole('dialog', { name: 'Unsaved changes' })
  await expect(switchGuard).toBeVisible()
  await switchGuard.getByRole('button', { name: 'Discard & switch' }).click()
  await expect(review).toBeHidden({ timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'Process catalog' })).toBeVisible({
    timeout: 30_000
  })
  await expect(
    page.getByText('Every process in TmSecondaryWorkspace.', { exact: false })
  ).toBeVisible()
  expect((await readMemory('primary')).entries).toHaveLength(2)
  expect((await readMemory('secondary')).entries).toEqual([])

  // The new workspace starts with a fresh, cancellable pre-mutation provider
  // operation. Cancelling aborts transport and leaves both modeler and TM
  // bytes untouched, proving finalization state did not leak across roots.
  await openTreeFile(page, 'tm-late.bpmn')
  await clearArabicNames(page, ['Task_Tm_Late'])
  const secondaryStackBefore = await stackIndex()
  const secondaryMemoryWritesBefore = await page.evaluate(
    (path) => window.__ORBITPM_MANDATORY_TRANSLATION_FS__.writeAttempts(path, 'secondary'),
    WORKSPACE_TRANSLATION_MEMORY_PATH
  )
  await page.getByRole('button', { name: /Translate/ }).click()
  await expect(review).toBeVisible()
  await review.getByLabel('Translation provider').selectOption('free')
  await review.getByRole('button', { name: 'Translate now' }).click()
  await secondaryTransport
  await expect(review.getByRole('button', { name: 'Cancel translation' })).toBeVisible()
  await expect
    .poll(() => elementState(page, 'Task_Tm_Late'))
    .toMatchObject({ name: 'Finalize workspace translation', nameAr: null })
  await review.getByRole('button', { name: 'Cancel translation' }).click()
  await expect(review).toContainText(
    'Translation was cancelled. All unresolved fields remain listed.'
  )
  await expect(review).not.toContainText('Translation provider failed')
  expect(secondaryGoogleAttempts).toBeGreaterThan(0)
  expect(await stackIndex()).toBe(secondaryStackBefore)
  await expect
    .poll(() => elementState(page, 'Task_Tm_Late'))
    .toMatchObject({ name: 'Finalize workspace translation', nameAr: null })
  expect((await readMemory('secondary')).entries).toEqual([])
  expect(
    await page.evaluate(
      (path) => window.__ORBITPM_MANDATORY_TRANSLATION_FS__.writeAttempts(path, 'secondary'),
      WORKSPACE_TRANSLATION_MEMORY_PATH
    )
  ).toBe(secondaryMemoryWritesBefore)
  releaseSecondaryTransport()
  await expect.poll(() => secondaryTransportFailures.length, { timeout: 30_000 }).toBeGreaterThan(0)
  expect(secondaryTransportFailures).toEqual(
    expect.arrayContaining([expect.stringMatching(/aborted|failed/iu)])
  )
  await expect.poll(() => secondaryLateFulfillmentAttempted).toBe(true)
  await expect.poll(() => secondaryLateFulfillmentSettled).toBe(true)
  expect(await stackIndex()).toBe(secondaryStackBefore)
  await expect
    .poll(() => elementState(page, 'Task_Tm_Late'))
    .toMatchObject({ name: 'Finalize workspace translation', nameAr: null })
  expect((await readMemory('secondary')).entries).toEqual([])
})

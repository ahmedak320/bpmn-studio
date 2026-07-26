// @vitest-environment jsdom

import BpmnModeler from 'bpmn-js/lib/Modeler'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { orbitpmModdleDescriptor } from '../../org/orbitpmModdle'
import { createProcessOutlineController, type ProcessOutlineModeler } from '../processOutline'

const RICH_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:orbitpm="http://orbitpm.ae/schema/bpmn/1.0"
  xmlns:vendor="https://vendor.example/schema"
  id="Definitions_1"
  targetNamespace="https://orbitpm.example/process">
  <bpmn:process id="Process_1" isExecutable="false" orbitpm:activeLang="en">
    <bpmn:startEvent id="Start_1">
      <bpmn:outgoing>Flow_start</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:businessRuleTask
      id="Task_1"
      name="Original task"
      orbitpm:nameEn="Original task"
      orbitpm:nameAr="المهمة الأصلية"
      orbitpm:owner="Original owner"
      orbitpm:ownerEn="Future owner translation"
      vendor:flag="keep">
      <bpmn:extensionElements>
        <vendor:payload token="opaque">
          <vendor:nested value="preserve-me" />
        </vendor:payload>
      </bpmn:extensionElements>
      <bpmn:documentation id="Documentation_1" textFormat="text/markdown" vendor:doc="keep">Original documentation</bpmn:documentation>
      <bpmn:documentation id="Documentation_2" vendor:secondary="keep">Secondary documentation</bpmn:documentation>
      <bpmn:incoming>Flow_start</bpmn:incoming>
      <bpmn:outgoing>Flow_task</bpmn:outgoing>
    </bpmn:businessRuleTask>
    <bpmn:exclusiveGateway id="Gateway_1" name="Decision">
      <bpmn:incoming>Flow_task</bpmn:incoming>
      <bpmn:outgoing>Flow_condition</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:endEvent id="End_1">
      <bpmn:incoming>Flow_condition</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_start" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_task" sourceRef="Task_1" targetRef="Gateway_1" />
    <bpmn:sequenceFlow id="Flow_condition" name="Original branch" sourceRef="Gateway_1" targetRef="End_1">
      <bpmn:conditionExpression
        xsi:type="bpmn:tFormalExpression"
        id="Expression_1"
        language="FEEL"
        vendor:expression="keep"><![CDATA[approved = false]]></bpmn:conditionExpression>
    </bpmn:sequenceFlow>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="120" y="122" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="220" y="100" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_1_di" bpmnElement="Gateway_1">
        <dc:Bounds x="380" y="115" width="50" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="500" y="122" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_start_di" bpmnElement="Flow_start">
        <di:waypoint x="156" y="140" />
        <di:waypoint x="220" y="140" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_task_di" bpmnElement="Flow_task">
        <di:waypoint x="320" y="140" />
        <di:waypoint x="380" y="140" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_condition_di" bpmnElement="Flow_condition">
        <di:waypoint x="430" y="140" />
        <di:waypoint x="500" y="140" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`

interface RegistryElement {
  id: string
  businessObject: Record<string, unknown> & {
    $attrs?: Record<string, unknown>
    documentation?: Array<Record<string, unknown>>
    conditionExpression?: Record<string, unknown>
  }
}

interface RealModeler {
  importXML(xml: string): Promise<unknown>
  saveXML(options?: { format?: boolean }): Promise<{ xml?: string }>
  get(name: string): unknown
  destroy(): void
}

let container: HTMLDivElement
let modeler: RealModeler | null = null
const transformLists = new WeakMap<SVGElement, SVGTransform[]>()

beforeEach(() => {
  if (!globalThis.CSS) {
    Object.defineProperty(globalThis, 'CSS', {
      configurable: true,
      value: {}
    })
  }
  if (!globalThis.CSS.escape) {
    globalThis.CSS.escape = (value: string): string =>
      value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`)
  }
  const svgElementPrototype = SVGElement.prototype as typeof SVGElement.prototype & {
    getBBox?: () => DOMRect
  }
  if (!svgElementPrototype.getBBox) {
    Object.defineProperty(svgElementPrototype, 'getBBox', {
      configurable: true,
      value: () =>
        ({
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 900,
          bottom: 600,
          width: 900,
          height: 600,
          toJSON: () => ({})
        }) as DOMRect
    })
  }
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () =>
      ({
        font: '',
        measureText: (value: string) =>
          ({
            width: value.length * 8
          }) as TextMetrics
      }) as CanvasRenderingContext2D
  })
  class TestSvgMatrix {
    a = 1
    b = 0
    c = 0
    d = 1
    e = 0
    f = 0

    inverse(): TestSvgMatrix {
      return this
    }

    multiply(): TestSvgMatrix {
      return this
    }

    translate(x: number, y: number): TestSvgMatrix {
      this.e += x
      this.f += y
      return this
    }

    scale(value: number): TestSvgMatrix {
      this.a *= value
      this.d *= value
      return this
    }
  }
  if (!globalThis.SVGMatrix) {
    Object.defineProperty(globalThis, 'SVGMatrix', {
      configurable: true,
      value: TestSvgMatrix
    })
  }
  if (!SVGSVGElement.prototype.createSVGMatrix) {
    SVGSVGElement.prototype.createSVGMatrix = () => new TestSvgMatrix() as unknown as DOMMatrix
  }
  if (!SVGSVGElement.prototype.createSVGPoint) {
    SVGSVGElement.prototype.createSVGPoint = () =>
      ({
        x: 0,
        y: 0,
        matrixTransform(): DOMPoint {
          return this as unknown as DOMPoint
        }
      }) as DOMPoint
  }
  if (!SVGSVGElement.prototype.createSVGTransform) {
    SVGSVGElement.prototype.createSVGTransform = () => {
      interface TransformFixture {
        matrix: TestSvgMatrix
        setMatrix(matrix: DOMMatrix): void
        setTranslate(x: number, y: number): void
        setScale(x: number, y: number): void
      }
      const transform: TransformFixture = {
        matrix: new TestSvgMatrix(),
        setMatrix(matrix: DOMMatrix): void {
          transform.matrix = matrix as unknown as TestSvgMatrix
        },
        setTranslate(x: number, y: number): void {
          transform.matrix.e = x
          transform.matrix.f = y
        },
        setScale(x: number, y: number): void {
          transform.matrix.a = x
          transform.matrix.d = y
        }
      }
      return transform as unknown as SVGTransform
    }
  }
  if (!SVGSVGElement.prototype.createSVGTransformFromMatrix) {
    SVGSVGElement.prototype.createSVGTransformFromMatrix = (matrix: DOMMatrix) =>
      ({ matrix }) as unknown as SVGTransform
  }
  if (!('transform' in SVGElement.prototype)) {
    Object.defineProperty(SVGElement.prototype, 'transform', {
      configurable: true,
      get() {
        const transforms = transformLists.get(this) ?? []
        transformLists.set(this, transforms)
        return {
          baseVal: {
            appendItem(transform: SVGTransform): SVGTransform {
              transforms.push(transform)
              return transform
            },
            clear(): void {
              transforms.length = 0
            },
            consolidate(): SVGTransform {
              return (
                transforms.at(-1) ??
                ({
                  matrix: new TestSvgMatrix()
                } as unknown as SVGTransform)
              )
            },
            createSVGTransformFromMatrix(matrix: DOMMatrix): SVGTransform {
              return { matrix } as unknown as SVGTransform
            }
          }
        }
      }
    })
  }
  container = document.createElement('div')
  container.style.width = '900px'
  container.style.height = '600px'
  Object.defineProperties(container, {
    clientWidth: { configurable: true, value: 900 },
    clientHeight: { configurable: true, value: 600 }
  })
  container.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 900,
      bottom: 600,
      width: 900,
      height: 600,
      toJSON: () => ({})
    }) as DOMRect
  document.body.append(container)
})

afterEach(() => {
  modeler?.destroy()
  modeler = null
  container.remove()
})

function registryElement(id: string): RegistryElement {
  const registry = modeler?.get('elementRegistry') as
    { get(elementId: string): RegistryElement | undefined } | undefined
  const element = registry?.get(id)
  if (!element) throw new Error(`missing ${id}`)
  return element
}

describe('ProcessOutlineController with a real bpmn-js command stack', () => {
  it('round-trips rich BPMN/vendor data and atomically undoes metadata and condition edits', async () => {
    modeler = new BpmnModeler({
      container,
      moddleExtensions: {
        orbitpm: orbitpmModdleDescriptor
      }
    }) as unknown as RealModeler
    await modeler.importXML(RICH_BPMN)

    const controller = createProcessOutlineController(modeler as unknown as ProcessOutlineModeler)
    const taskBefore = registryElement('Task_1')
    const documentationBefore = taskBefore.businessObject.documentation ?? []
    const firstDocumentation = documentationBefore[0]
    const secondDocumentation = documentationBefore[1]
    const extensionElements = taskBefore.businessObject.extensionElements
    const metadata = {
      ...controller.snapshot.nodes.find((node) => node.id === 'Task_1')!.metadata,
      owner: 'Operations',
      ownerType: 'department',
      ownerRole: 'A',
      note: 'Linked note',
      channel: 'dmthub',
      channelDetail: 'case-api',
      cc: true,
      ccTo: 'audit@example.test',
      triggers: [],
      nameEn: 'Approve request',
      nameAr: 'اعتماد الطلب',
      inputs: 'Application',
      outputs: 'Decision',
      system: 'Case Hub',
      respList: 'Reviewer — R',
      ccList: 'Audit',
      decisionBasis: 'Policy 7'
    }

    controller.updateNode('Task_1', {
      documentation: 'Updated documentation',
      metadata
    })

    const taskAfter = registryElement('Task_1')
    expect(taskAfter.businessObject.name).toBe('Approve request')
    expect(taskAfter.businessObject.documentation?.[0]).toBe(firstDocumentation)
    expect(taskAfter.businessObject.documentation?.[1]).toBe(secondDocumentation)
    expect(firstDocumentation).toMatchObject({
      text: 'Updated documentation',
      textFormat: 'text/markdown'
    })
    expect(taskAfter.businessObject.extensionElements).toBe(extensionElements)
    expect(taskAfter.businessObject.$attrs?.['vendor:flag']).toBe('keep')
    expect(taskAfter.businessObject.ownerEn).toBe('Future owner translation')
    expect(controller.snapshot.nodes.find((node) => node.id === 'Task_1')?.metadata.note).toBe(
      'Linked note'
    )

    const commandStack = modeler.get('commandStack') as {
      undo(): void
      redo(): void
    }
    commandStack.undo()
    expect(registryElement('Task_1').businessObject.name).toBe('Original task')
    expect(firstDocumentation.text).toBe('Original documentation')
    expect(controller.snapshot.nodes.find((node) => node.id === 'Task_1')?.metadata.note).toBe('')

    commandStack.redo()
    expect(registryElement('Task_1').businessObject.name).toBe('Approve request')
    expect(firstDocumentation.text).toBe('Updated documentation')

    const flowBefore = registryElement('Flow_condition')
    const expression = flowBefore.businessObject.conditionExpression
    controller.updateFlow('Flow_condition', {
      sourceId: 'Gateway_1',
      targetId: 'End_1',
      name: 'Approved',
      condition: 'approved = true',
      isDefault: false
    })
    expect(registryElement('Flow_condition').businessObject.conditionExpression).toBe(expression)
    expect(expression).toMatchObject({
      body: 'approved = true',
      language: 'FEEL'
    })
    expect(expression?.$attrs).toMatchObject({ 'vendor:expression': 'keep' })

    commandStack.undo()
    expect(expression?.body).toBe('approved = false')
    commandStack.redo()
    expect(expression?.body).toBe('approved = true')

    const { xml = '' } = await modeler.saveXML({ format: true })
    expect(xml).toContain('vendor:flag="keep"')
    expect(xml).toContain('vendor:expression="keep"')
    expect(xml).toContain('vendor:payload')
    expect(xml).toContain('vendor:nested')
    expect(xml).toContain('orbitpm:ownerEn="Future owner translation"')
    expect(xml).toContain('id="Documentation_2"')

    await modeler.importXML(xml)
    const reparsedTask = registryElement('Task_1').businessObject
    const reparsedExpression = registryElement('Flow_condition').businessObject.conditionExpression
    expect(reparsedTask.documentation).toHaveLength(2)
    expect(reparsedTask.documentation?.[0]).toMatchObject({
      text: 'Updated documentation',
      textFormat: 'text/markdown'
    })
    expect(reparsedTask.$attrs?.['vendor:flag']).toBe('keep')
    expect(reparsedTask.ownerEn).toBe('Future owner translation')
    expect(reparsedExpression).toMatchObject({
      body: 'approved = true',
      language: 'FEEL'
    })
    expect(reparsedExpression?.$attrs).toMatchObject({
      'vendor:expression': 'keep'
    })

    controller.destroy()
  })
})

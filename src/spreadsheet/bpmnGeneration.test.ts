// @vitest-environment jsdom

import BpmnModdle from 'bpmn-moddle'
import BpmnModeler from 'bpmn-js/lib/Modeler'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { orbitpmModdleDescriptor } from '../org/orbitpmModdle'
import { validateBpmnXml } from '../validation'
import type { GeneratedBpmnArtifact, ProcessGraphModel } from './contracts'
import { SpreadsheetBilingualAudit, SpreadsheetBpmnGenerator } from './bpmnGeneration'
import { buildProcessWorkbookModel, officialTemplatePreset } from './modelBuilder'
import { detectOfficialTemplate } from './officialTemplate'
import { handleSpreadsheetWorkerRequest } from './spreadsheet.worker'
import {
  bilingual,
  provenance,
  validFlows,
  validNodes,
  validParticipants,
  validProcess
} from './testFixtures'
import { createOfficialWorkbookTemplate, OFFICIAL_TEMPLATE_ASSET_NAMES } from './template'
import type { SpreadsheetWorkerResponse } from './workerProtocol'

interface ImportedElement {
  readonly $type: string
  readonly id?: string
  readonly rootElements?: readonly ImportedElement[]
  readonly diagrams?: readonly ImportedElement[]
  readonly plane?: ImportedElement
  readonly planeElement?: readonly ImportedElement[]
  readonly bpmnElement?: ImportedElement
  readonly bounds?: Bounds
  readonly waypoint?: readonly Point[]
  readonly participants?: readonly ImportedElement[]
  readonly processRef?: ImportedElement
  readonly laneSets?: readonly ImportedElement[]
  readonly lanes?: readonly ImportedElement[]
  readonly flowElements?: readonly ImportedElement[]
  readonly sourceRef?: ImportedElement
  readonly targetRef?: ImportedElement
  readonly name?: string
  readonly nameAr?: string
}

interface Bounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

interface Point {
  readonly x: number
  readonly y: number
}

interface ImportedGeometry {
  readonly definitions: ImportedElement
  readonly process: ImportedElement
  readonly collaboration?: ImportedElement
  readonly plane: ImportedElement
  readonly shapes: ReadonlyMap<string, Bounds>
  readonly edges: ReadonlyMap<string, readonly Point[]>
}

interface RealModeler {
  importXML(xml: string): Promise<{ readonly warnings?: readonly unknown[] }>
  get(name: string): unknown
  destroy(): void
}

interface RegistryElement {
  readonly id: string
  readonly parent?: RegistryElement
}

let modelerContainer: HTMLDivElement
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
          right: 1_200,
          bottom: 1_000,
          width: 1_200,
          height: 1_000,
          toJSON: () => ({})
        }) as DOMRect
    })
  }
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () =>
      ({
        font: '',
        measureText: (value: string) => ({ width: value.length * 8 }) as TextMetrics
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
      const transform = {
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
        },
        setRotate(): void {
          // Rendering orientation is irrelevant to the import assertions.
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
  modelerContainer = document.createElement('div')
  Object.defineProperties(modelerContainer, {
    clientWidth: { configurable: true, value: 1_200 },
    clientHeight: { configurable: true, value: 1_000 }
  })
  modelerContainer.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1_200,
      bottom: 1_000,
      width: 1_200,
      height: 1_000,
      toJSON: () => ({})
    }) as DOMRect
  document.body.append(modelerContainer)
})

afterEach(() => {
  modeler?.destroy()
  modeler = null
  modelerContainer.remove()
})

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

function multiPoolGraph(): ProcessGraphModel {
  const [poolBase, laneBase] = validParticipants()
  const participants: ProcessGraphModel['participants'] = [
    {
      ...poolBase!,
      id: 'Pool_B',
      order: 2,
      name: bilingual('Pool B', 'الحوض ب'),
      provenance: provenance('Participants', 2)
    },
    {
      ...poolBase!,
      id: 'Pool_A',
      order: 1,
      name: bilingual('Pool A', 'الحوض أ'),
      provenance: provenance('Participants', 3)
    },
    {
      ...laneBase!,
      id: 'Lane_A2',
      parentId: 'Pool_A',
      order: 2,
      name: bilingual('Pool A second', 'المسار الثاني أ'),
      provenance: provenance('Participants', 4)
    },
    {
      ...laneBase!,
      id: 'Lane_A1',
      parentId: 'Pool_A',
      order: 1,
      name: bilingual('Pool A first', 'المسار الأول أ'),
      provenance: provenance('Participants', 5)
    }
  ]
  const assignments = [
    { poolId: 'Pool_A', laneId: 'Lane_A1' },
    { poolId: 'Pool_A', laneId: 'Lane_A2' },
    { poolId: 'Pool_A', laneId: 'Lane_A2' }
  ] as const
  return {
    process: validProcess(),
    participants,
    nodes: validNodes().map((node, index) => ({
      ...node,
      ...assignments[index]
    })),
    flows: validFlows(),
    glossary: []
  }
}

async function officialExampleGraph(): Promise<ProcessGraphModel> {
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
  return {
    process,
    participants: built.model.participants.filter(({ processId }) => processId === process.id),
    nodes: built.model.nodes.filter(({ processId }) => processId === process.id),
    flows: built.model.flows.filter(({ processId }) => processId === process.id),
    glossary: built.model.glossary
  }
}

async function importGeometry(xml: string): Promise<ImportedGeometry> {
  const moddle = new BpmnModdle({
    orbitpm: orbitpmModdleDescriptor as unknown as Record<string, unknown>
  })
  const imported = await moddle.fromXML(xml)
  expect(
    imported.warnings.filter(({ message }) => !message.startsWith('unknown attribute <orbitpm:'))
  ).toEqual([])
  const definitions = imported.rootElement as unknown as ImportedElement
  const process = definitions.rootElements?.find(({ $type }) => $type === 'bpmn:Process')
  const collaboration = definitions.rootElements?.find(
    ({ $type }) => $type === 'bpmn:Collaboration'
  )
  const plane = definitions.diagrams?.[0]?.plane
  expect(process).toBeDefined()
  expect(plane).toBeDefined()
  const shapes = new Map<string, Bounds>()
  const edges = new Map<string, readonly Point[]>()
  for (const element of plane?.planeElement ?? []) {
    const elementId = element.bpmnElement?.id
    if (!elementId) continue
    if (element.$type === 'bpmndi:BPMNEdge') {
      expect(edges.has(elementId)).toBe(false)
      edges.set(
        elementId,
        (element.waypoint ?? []).map(({ x, y }) => ({ x, y }))
      )
      continue
    }
    if (element.$type !== 'bpmndi:BPMNShape' || !element.bounds) {
      continue
    }
    expect(shapes.has(elementId)).toBe(false)
    shapes.set(elementId, {
      x: element.bounds.x,
      y: element.bounds.y,
      width: element.bounds.width,
      height: element.bounds.height
    })
  }
  return {
    definitions,
    process: process!,
    ...(collaboration ? { collaboration } : {}),
    plane: plane!,
    shapes,
    edges
  }
}

function expectContained(outer: Bounds | undefined, inner: Bounds | undefined): void {
  expect(outer).toBeDefined()
  expect(inner).toBeDefined()
  expect(inner!.x).toBeGreaterThanOrEqual(outer!.x)
  expect(inner!.y).toBeGreaterThanOrEqual(outer!.y)
  expect(inner!.x + inner!.width).toBeLessThanOrEqual(outer!.x + outer!.width)
  expect(inner!.y + inner!.height).toBeLessThanOrEqual(outer!.y + outer!.height)
}

function expectDisjoint(left: Bounds | undefined, right: Bounds | undefined): void {
  expect(left).toBeDefined()
  expect(right).toBeDefined()
  expect(
    left!.x + left!.width <= right!.x ||
      right!.x + right!.width <= left!.x ||
      left!.y + left!.height <= right!.y ||
      right!.y + right!.height <= left!.y
  ).toBe(true)
}

function expectEndpointOnBoundary(point: Point | undefined, shape: Bounds | undefined): void {
  expect(point).toBeDefined()
  expect(shape).toBeDefined()
  const epsilon = 0.001
  const horizontal =
    point!.x >= shape!.x - epsilon &&
    point!.x <= shape!.x + shape!.width + epsilon &&
    (Math.abs(point!.y - shape!.y) <= epsilon ||
      Math.abs(point!.y - (shape!.y + shape!.height)) <= epsilon)
  const vertical =
    point!.y >= shape!.y - epsilon &&
    point!.y <= shape!.y + shape!.height + epsilon &&
    (Math.abs(point!.x - shape!.x) <= epsilon ||
      Math.abs(point!.x - (shape!.x + shape!.width)) <= epsilon)
  expect(horizontal || vertical).toBe(true)
}

function expectFlowGeometry(imported: ImportedGeometry, source: ProcessGraphModel): void {
  expect(imported.edges.size).toBe(source.flows.length)
  for (const flow of source.flows) {
    const waypoints = imported.edges.get(flow.id)
    expect(waypoints?.length).toBeGreaterThanOrEqual(2)
    expect(waypoints?.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true)
    expectEndpointOnBoundary(waypoints?.[0], imported.shapes.get(flow.sourceStepId))
    expectEndpointOnBoundary(waypoints?.at(-1), imported.shapes.get(flow.targetStepId))
  }
}

async function expectValidBeforeAndAfter(artifact: GeneratedBpmnArtifact): Promise<void> {
  const before = await validateBpmnXml(artifact.semanticXml, {
    requireBilingual: true,
    requireDi: false
  })
  const after = await validateBpmnXml(artifact.layoutedXml, {
    requireBilingual: true,
    requireDi: true
  })
  expect(before.summary.issues.filter(({ blocking }) => blocking)).toEqual([])
  expect(after.summary.issues.filter(({ blocking }) => blocking)).toEqual([])
  expect(before.summary.stats).toMatchObject({ diagrams: 0, planes: 0 })
  expect(after.summary.stats).toMatchObject({ diagrams: 1, planes: 1 })
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

  it('lays out the official two-lane example with disjoint lanes and contained nodes', async () => {
    const official = await officialExampleGraph()
    const generator = new SpreadsheetBpmnGenerator()
    const artifact = await generator.generate(official)
    const imported = await importGeometry(artifact.layoutedXml)
    const employee = imported.shapes.get('Lane_Employee')
    const manager = imported.shapes.get('Lane_Manager')
    const pool = imported.shapes.get('Pool_Leave')

    expect(imported.shapes.size).toBe(official.nodes.length + official.participants.length)
    expectDisjoint(employee, manager)
    expect(employee!.y + employee!.height).toBe(manager!.y)
    expectContained(pool, employee)
    expectContained(pool, manager)
    for (const node of official.nodes) {
      expectContained(imported.shapes.get(node.laneId!), imported.shapes.get(node.id))
      expectContained(pool, imported.shapes.get(node.id))
    }
    expect(imported.process.laneSets?.[0]?.lanes?.map(({ id }) => id)).toEqual([
      'Lane_Employee',
      'Lane_Manager'
    ])
    expect(imported.plane.bpmnElement?.$type).toBe('bpmn:Collaboration')
    expect(imported.process.flowElements?.find(({ id }) => id === 'Review_Request')?.nameAr).toBe(
      'مراجعة الطلب'
    )
    expectFlowGeometry(imported, official)
    await expectValidBeforeAndAfter(artifact)

    const repeated = await generator.generate(official)
    expect(repeated.semanticXml).toBe(artifact.semanticXml)
    expect(repeated.layoutedXml).toBe(artifact.layoutedXml)
  })

  it('separates an ordered white-box pool from an empty black-box pool and imports in bpmn-js', async () => {
    const source = multiPoolGraph()
    const artifact = await new SpreadsheetBpmnGenerator().generate(source)
    const imported = await importGeometry(artifact.layoutedXml)

    expect(imported.shapes.size).toBe(source.nodes.length + source.participants.length)
    expect(imported.collaboration?.participants?.map(({ id }) => id)).toEqual(['Pool_A', 'Pool_B'])
    expect(
      imported.collaboration?.participants?.map(({ id, processRef }) => ({
        id,
        processRef: processRef?.id
      }))
    ).toEqual([
      { id: 'Pool_A', processRef: 'leave_approval' },
      { id: 'Pool_B', processRef: undefined }
    ])
    expect(imported.process.laneSets?.[0]?.lanes?.map(({ id }) => id)).toEqual([
      'Lane_A1',
      'Lane_A2'
    ])
    expectDisjoint(imported.shapes.get('Pool_A'), imported.shapes.get('Pool_B'))
    expectDisjoint(imported.shapes.get('Lane_A1'), imported.shapes.get('Lane_A2'))
    expect(imported.shapes.get('Pool_A')!.y).toBeLessThan(imported.shapes.get('Pool_B')!.y)
    expect(imported.shapes.get('Lane_A1')!.y + imported.shapes.get('Lane_A1')!.height).toBe(
      imported.shapes.get('Lane_A2')!.y
    )
    for (const laneId of ['Lane_A1', 'Lane_A2']) {
      expectContained(imported.shapes.get('Pool_A'), imported.shapes.get(laneId))
    }
    for (const node of source.nodes) {
      expectContained(imported.shapes.get(node.laneId!), imported.shapes.get(node.id))
      expectContained(imported.shapes.get(node.poolId!), imported.shapes.get(node.id))
    }

    const flows = imported.process.flowElements
      ?.filter(({ $type }) => $type === 'bpmn:SequenceFlow')
      .map(({ id, sourceRef, targetRef }) => ({
        id,
        source: sourceRef?.id,
        target: targetRef?.id
      }))
    expect(flows).toEqual([
      { id: 'Flow_1', source: 'Start_1', target: 'Task_1' },
      { id: 'Flow_2', source: 'Task_1', target: 'End_1' }
    ])
    expectFlowGeometry(imported, source)
    expect(imported.plane.bpmnElement?.id).toMatch(/^Collaboration_/)
    await expectValidBeforeAndAfter(artifact)

    modeler = new BpmnModeler({
      container: modelerContainer,
      moddleExtensions: { orbitpm: orbitpmModdleDescriptor }
    }) as unknown as RealModeler
    const importedCanvas = await modeler.importXML(artifact.layoutedXml)
    expect(importedCanvas.warnings ?? []).toEqual([])
    const registry = modeler.get('elementRegistry') as {
      get(id: string): RegistryElement | undefined
    }
    for (const id of [
      'Pool_A',
      'Pool_B',
      'Lane_A1',
      'Lane_A2',
      'Start_1',
      'Task_1',
      'End_1',
      'Flow_1',
      'Flow_2'
    ]) {
      expect(registry.get(id)?.id).toBe(id)
    }
    expect(registry.get('Lane_A1')?.parent?.id).toBe('Pool_A')
    expect(registry.get('Lane_A2')?.parent?.id).toBe('Pool_A')
    expect(registry.get('Start_1')?.parent?.id).toBe('Pool_A')
    expect(registry.get('Task_1')?.parent?.id).toBe('Pool_A')
    expect(registry.get('End_1')?.parent?.id).toBe('Pool_A')
  })

  it('fails closed when a lane or node is assigned to a secondary black-box pool', async () => {
    const base = multiPoolGraph()
    const laneBase = validParticipants()[1]!
    const secondaryLane: ProcessGraphModel = {
      ...base,
      participants: [
        ...base.participants,
        {
          ...laneBase,
          id: 'Lane_B',
          parentId: 'Pool_B',
          name: bilingual('Invalid lane', 'مسار غير صالح'),
          provenance: provenance('Participants', 6)
        }
      ]
    }
    await expect(new SpreadsheetBpmnGenerator().generate(secondaryLane)).rejects.toMatchObject({
      code: 'blocking-validation',
      details: {
        reason: 'secondary-pool-assignment',
        primaryPoolId: 'Pool_A',
        poolId: 'Pool_B',
        elementId: 'Lane_B'
      }
    })

    const secondaryNode: ProcessGraphModel = {
      ...base,
      nodes: base.nodes.map((node, index) =>
        index === 0
          ? {
              ...node,
              poolId: 'Pool_B',
              laneId: undefined
            }
          : node
      )
    }
    await expect(new SpreadsheetBpmnGenerator().generate(secondaryNode)).rejects.toMatchObject({
      code: 'blocking-validation',
      details: {
        reason: 'secondary-pool-assignment',
        primaryPoolId: 'Pool_A',
        poolId: 'Pool_B',
        elementId: 'Start_1'
      }
    })
  })
})

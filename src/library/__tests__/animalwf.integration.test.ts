// Integration test against the REAL "Animal Welfare" ARIS 10 export
// (7 EPC diagrams + 1 value-chain overview, ~4.3 MB). Skipped when the file
// is not present on this machine. Every expectation about process ids is
// DERIVED from the generated files themselves — the export carries no
// AT_PROC_CODEs, so ids come from sanitized Model.IDs and hardcoding them
// here would just duplicate the sanitizer.

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import BpmnModdle from 'bpmn-moddle'
import { convertAmlToBpmnFiles, type ConvertedModel } from '../apcImport'
import { reservedExtents, type LayoutNode } from '../epcLayout'
import { analyzeEdgeVisuals, type PolylineEdge } from '../../org/edgeVisuals'

const REAL_EXPORT_PATH = '/home/ahmed/Desktop/bpmn_tool/desktop/AnimalWF/ARISAMLExport.xml'

function tryRead(): string | undefined {
  try {
    return readFileSync(REAL_EXPORT_PATH, 'utf8')
  } catch {
    return undefined
  }
}

const text = tryRead()

describe.skipIf(!text)('AnimalWF real export — full conversion', () => {
  let cached: Promise<{ files: ConvertedModel[]; folderName?: string }> | undefined

  function convert(): Promise<{ files: ConvertedModel[]; folderName?: string }> {
    cached ??= convertAmlToBpmnFiles(text as string).then((r) => {
      if (!('files' in r)) throw new Error(`conversion failed: ${r.error}`)
      return r
    })
    return cached
  }

  it('produces 8 files: 7 EPCs first, the overview named after the VACD last', async () => {
    const { files, folderName } = await convert()
    expect(files).toHaveLength(8)
    expect(files.map((f) => f.kind)).toEqual(['epc', 'epc', 'epc', 'epc', 'epc', 'epc', 'epc', 'overview'])
    const overview = files[7]
    expect(overview.name).toBe('Animal Welfare Division')
    expect(overview.nameAr).toBe('إدارة الرفق بالحيوان')
    expect(folderName).toBe('Animal Welfare Division')
    // Process ids are pairwise distinct (they're calledElement targets).
    expect(new Set(files.map((f) => f.processId)).size).toBe(8)
  })

  it('overview: 7 callActivities + 4 tasks chained by 10 flows into one path', async () => {
    const { files } = await convert()
    const overview = files[7]
    expect((overview.xml.match(/<callActivity\b/g) ?? []).length).toBe(7)
    expect((overview.xml.match(/<task\b/g) ?? []).length).toBe(4)
    expect((overview.xml.match(/<sequenceFlow\b/g) ?? []).length).toBe(10)
    // No degree-inferred events on an overview.
    expect(overview.xml).not.toMatch(/<(?:start|end|intermediateThrow|intermediateCatch)Event\b/)

    // The 10 flows form ONE simple path over the 11 nodes.
    const nodeIds = new Set<string>()
    const nodeRe = /<(?:task|callActivity)\b[^>]*\bid="([^"]*)"/g
    let m: RegExpExecArray | null
    while ((m = nodeRe.exec(overview.xml))) nodeIds.add(m[1])
    expect(nodeIds.size).toBe(11)
    const next = new Map<string, string>()
    const indeg = new Map<string, number>()
    const flowRe = /<sequenceFlow\b[^>]*sourceRef="([^"]*)"[^>]*targetRef="([^"]*)"/g
    while ((m = flowRe.exec(overview.xml))) {
      expect(next.has(m[1]), 'out-degree <= 1').toBe(false)
      next.set(m[1], m[2])
      indeg.set(m[2], (indeg.get(m[2]) ?? 0) + 1)
    }
    const heads = [...nodeIds].filter((id) => !indeg.has(id))
    expect(heads).toHaveLength(1)
    let cursor: string | undefined = heads[0]
    const visited: string[] = []
    while (cursor) {
      visited.push(cursor)
      expect(indeg.get(cursor) ?? 0).toBeLessThanOrEqual(1)
      cursor = next.get(cursor)
    }
    expect(visited).toHaveLength(11)
    expect(new Set(visited).size).toBe(11)
  })

  it('overview calledElements are a bijection onto the 7 EPC process ids', async () => {
    const { files } = await convert()
    const overview = files[7]
    const called: string[] = []
    const re = /<callActivity\b[^>]*\bcalledElement="([^"]*)"/g
    let m: RegExpExecArray | null
    while ((m = re.exec(overview.xml))) called.push(m[1])
    expect(called).toHaveLength(7)
    expect(new Set(called).size).toBe(7) // injective
    const epcIds = new Set(files.filter((f) => f.kind === 'epc').map((f) => f.processId))
    expect(new Set(called)).toEqual(epcIds) // surjective onto the EPC ids
    // Self-loop guard: nothing calls the overview's own process.
    expect(called).not.toContain(overview.processId)
  })

  it('cross-EPC drill-down: Register an Animal\'s profile calls the owner-profile EPC', async () => {
    const { files } = await convert()
    const parent = files.find((f) => f.nameEn === "Register an Animal's profile")
    const child = files.find((f) => f.nameEn === 'Request to Register Animal Owner Profile')
    expect(parent).toBeTruthy()
    expect(child).toBeTruthy()
    const tagRe = /<callActivity\b[^>]*>/g
    let m: RegExpExecArray | null
    let found: string | undefined
    while ((m = tagRe.exec((parent as ConvertedModel).xml))) {
      if (m[0].includes(`calledElement="${(child as ConvertedModel).processId}"`)) {
        found = m[0]
        break
      }
    }
    expect(found, 'callActivity onto the owner-profile process').toBeTruthy()
    // The linked step keeps its own bilingual identity.
    expect(found).toContain('orbitpm:nameEn="')
  })

  it('every file moddle-parses warning-free and honours the DI invariants', async () => {
    const { files } = await convert()
    const moddle = new BpmnModdle()
    const stats: string[] = []
    for (const file of files) {
      const { rootElement, warnings } = await moddle.fromXML(file.xml)
      expect(warnings, `${file.name} warnings`).toEqual([])
      expect(rootElement.$type).toBe('bpmn:Definitions')
      const plane = rootElement.diagrams[0].plane

      interface DiShape {
        id: string
        node: LayoutNode
        x: number
        y: number
        w: number
        h: number
        label?: { x: number; y: number; w: number; h: number }
        external: boolean
        named: boolean
      }
      const shapes: DiShape[] = []
      const edges: Array<{ id: string; source: string; target: string; wps: Array<{ x: number; y: number }> }> = []
      for (const el of plane.planeElement) {
        if (el.$type === 'bpmndi:BPMNShape') {
          const bo = el.bpmnElement
          const type = bo.$type as string
          const tag = type.slice('bpmn:'.length)
          const emitTag = tag.charAt(0).toLowerCase() + tag.slice(1)
          const attrs: Record<string, string> = {}
          for (const [k, v] of Object.entries((bo.$attrs ?? {}) as Record<string, string>)) {
            if (k.startsWith('orbitpm:')) attrs[k.slice('orbitpm:'.length)] = v
          }
          const node: LayoutNode = { id: bo.id, tag: emitTag, attrs }
          if (bo.name) node.label = bo.name
          shapes.push({
            id: bo.id,
            node,
            x: el.bounds.x,
            y: el.bounds.y,
            w: el.bounds.width,
            h: el.bounds.height,
            label: el.label?.bounds
              ? { x: el.label.bounds.x, y: el.label.bounds.y, w: el.label.bounds.width, h: el.label.bounds.height }
              : undefined,
            external: emitTag.endsWith('Event') || emitTag.endsWith('Gateway'),
            named: Boolean(bo.name)
          })
        } else if (el.$type === 'bpmndi:BPMNEdge') {
          edges.push({
            id: el.bpmnElement.id,
            source: el.bpmnElement.sourceRef.id,
            target: el.bpmnElement.targetRef.id,
            wps: el.waypoint.map((wp: { x: number; y: number }) => ({ x: wp.x, y: wp.y }))
          })
        }
      }
      expect(shapes.length).toBeGreaterThan(0)

      // Coordinates >= 0, labels included.
      let maxX = 0
      let maxY = 0
      for (const s of shapes) {
        expect(s.x, `${file.name} ${s.id} x`).toBeGreaterThanOrEqual(0)
        expect(s.y, `${file.name} ${s.id} y`).toBeGreaterThanOrEqual(0)
        maxX = Math.max(maxX, s.x + s.w)
        maxY = Math.max(maxY, s.y + s.h)
        if (s.label) {
          expect(s.label.x).toBeGreaterThanOrEqual(0)
          expect(s.label.y).toBeGreaterThanOrEqual(0)
          maxX = Math.max(maxX, s.label.x + s.label.w)
          maxY = Math.max(maxY, s.label.y + s.label.h)
        }
        // BPMNLabel exactly for labeled events/gateways.
        if (s.external && s.named) expect(s.label, `${file.name} ${s.id} has BPMNLabel`).toBeTruthy()
        else expect(s.label, `${file.name} ${s.id} has no BPMNLabel`).toBeUndefined()
      }

      // Orthogonal-only edges; coordinates >= 0.
      for (const e of edges) {
        expect(e.wps.length).toBeGreaterThanOrEqual(2)
        for (const wp of e.wps) {
          expect(wp.x, `${file.name} ${e.id}`).toBeGreaterThanOrEqual(0)
          expect(wp.y, `${file.name} ${e.id}`).toBeGreaterThanOrEqual(0)
          maxX = Math.max(maxX, wp.x)
          maxY = Math.max(maxY, wp.y)
        }
        for (let i = 1; i < e.wps.length; i++) {
          const a = e.wps[i - 1]
          const b = e.wps[i]
          expect(a.x === b.x || a.y === b.y, `${file.name} ${e.id} segment ${i} orthogonal`).toBe(true)
        }
      }

      // Margins-inflated boxes: pairwise disjoint (decorations can't collide).
      const inflated = shapes.map((s) => {
        const ext = reservedExtents(s.node, 'vertical')
        return { id: s.id, x0: s.x - ext.left, y0: s.y - ext.top, x1: s.x + s.w + ext.right, y1: s.y + s.h + ext.bottom }
      })
      for (let i = 0; i < inflated.length; i++) {
        for (let j = i + 1; j < inflated.length; j++) {
          const a = inflated[i]
          const b = inflated[j]
          const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
          expect(overlap, `${file.name}: ${a.id} overlaps ${b.id}`).toBe(false)
        }
      }

      // No edge segment through any NON-endpoint node's inflated box.
      const boxById = new Map(inflated.map((r) => [r.id, r]))
      for (const e of edges) {
        for (const [id, r] of boxById) {
          if (id === e.source || id === e.target) continue
          for (let i = 1; i < e.wps.length; i++) {
            const a = e.wps[i - 1]
            const b = e.wps[i]
            let through = false
            if (a.x === b.x) {
              const y0 = Math.min(a.y, b.y)
              const y1 = Math.max(a.y, b.y)
              through = a.x > r.x0 && a.x < r.x1 && y0 < r.y1 && y1 > r.y0
            } else if (a.y === b.y) {
              const x0 = Math.min(a.x, b.x)
              const x1 = Math.max(a.x, b.x)
              through = a.y > r.y0 && a.y < r.y1 && x0 < r.x1 && x1 > r.x0
            }
            expect(through, `${file.name}: ${e.id} segment ${i} through ${id}`).toBe(false)
          }
        }
      }

      stats.push(`${file.name} [${file.kind}]: nodes=${shapes.length} flows=${edges.length} bbox=${maxX}x${maxY}`)
    }
    console.log('[animalwf-layout]\n  ' + stats.join('\n  '))
  })

  it('routes Lease contract uploaded into the owner-profile XOR merge without a far-right lane', async () => {
    const { files } = await convert()
    const ownerProfile = files.find((f) => f.nameEn === 'Request to Register Animal Owner Profile')
    expect(ownerProfile, 'owner-profile EPC').toBeTruthy()

    const moddle = new BpmnModdle()
    const { rootElement, warnings } = await moddle.fromXML((ownerProfile as ConvertedModel).xml)
    expect(warnings).toEqual([])
    const process = rootElement.rootElements.find((el: { $type: string }) => el.$type === 'bpmn:Process')
    const leaseEvent = process.flowElements.find(
      (el: { name?: string }) => el.name === 'Lease contract uploaded'
    )
    expect(leaseEvent, 'Lease contract uploaded event').toBeTruthy()

    // Importer flow ids are generated, so identify the regression edge solely
    // from semantic source/target topology: the target is the XOR merge also
    // fed by "Application data inserted".
    const mergeFlow = leaseEvent.outgoing.find((flow: {
      targetRef: {
        $type: string
        incoming: Array<{ sourceRef: { name?: string } }>
      }
    }) =>
      flow.targetRef.$type === 'bpmn:ExclusiveGateway' &&
      flow.targetRef.incoming.some((incoming) => incoming.sourceRef.name === 'Application data inserted')
    )
    expect(mergeFlow, 'Lease event → shared XOR merge flow').toBeTruthy()

    const plane = rootElement.diagrams[0].plane
    const diEdge = plane.planeElement.find(
      (el: { $type: string; bpmnElement?: { id: string } }) =>
        el.$type === 'bpmndi:BPMNEdge' && el.bpmnElement?.id === mergeFlow.id
    )
    expect(diEdge, 'DI edge for semantic merge flow').toBeTruthy()

    type Point = { x: number; y: number }
    const points = diEdge.waypoint.map((wp: Point) => ({ x: wp.x, y: wp.y }))
    const normalized: Point[] = []
    for (const point of points) {
      const previous = normalized[normalized.length - 1]
      if (previous && previous.x === point.x && previous.y === point.y) continue
      normalized.push(point)
      while (normalized.length >= 3) {
        const a = normalized[normalized.length - 3]
        const b = normalized[normalized.length - 2]
        const c = normalized[normalized.length - 1]
        if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) {
          normalized.splice(normalized.length - 2, 1)
        } else {
          break
        }
      }
    }

    // Both legal ports need a vertical stub and their x coordinates differ,
    // so two bends are the collision-free minimum in the open gap between
    // this event and its merge. The old blanket skip-edge lane had four.
    expect(normalized.length - 2, `normalized route ${JSON.stringify(normalized)}`).toBe(2)

    const sourceId = leaseEvent.id as string
    const targetId = mergeFlow.targetRef.id as string
    interface RouteShape {
      bpmnElement: { id: string }
      bounds: { x: number; y: number; width: number; height: number }
      label?: { bounds?: { x: number; y: number; width: number; height: number } }
    }
    const shapes = plane.planeElement.filter(
      (el: { $type: string }) => el.$type === 'bpmndi:BPMNShape'
    ) as RouteShape[]
    const shapeById = new Map<string, RouteShape>(
      shapes.map((shape) => [shape.bpmnElement.id, shape])
    )
    const sourceShape = shapeById.get(sourceId)
    const targetShape = shapeById.get(targetId)
    expect(sourceShape).toBeTruthy()
    expect(targetShape).toBeTruthy()
    if (!sourceShape || !targetShape) throw new Error('missing endpoint DI shape')
    const sourceCenterX = sourceShape.bounds.x + sourceShape.bounds.width / 2
    const targetCenterX = targetShape.bounds.x + targetShape.bounds.width / 2
    expect(Math.max(...normalized.map((point) => point.x)), 'route stays out of a far-right lane')
      .toBeLessThanOrEqual(Math.max(sourceCenterX, targetCenterX))

    const crossesInterior = (
      a: Point,
      b: Point,
      box: { x: number; y: number; width: number; height: number }
    ): boolean => {
      if (a.x === b.x) {
        const y0 = Math.min(a.y, b.y)
        const y1 = Math.max(a.y, b.y)
        return a.x > box.x && a.x < box.x + box.width && y0 < box.y + box.height && y1 > box.y
      }
      if (a.y === b.y) {
        const x0 = Math.min(a.x, b.x)
        const x1 = Math.max(a.x, b.x)
        return a.y > box.y && a.y < box.y + box.height && x0 < box.x + box.width && x1 > box.x
      }
      return true
    }
    for (const shape of shapes) {
      const id = shape.bpmnElement.id as string
      if (id === sourceId || id === targetId) continue
      for (let i = 1; i < normalized.length; i++) {
        expect(
          crossesInterior(normalized[i - 1], normalized[i], shape.bounds),
          `${mergeFlow.id} segment ${i} crosses shape ${id}`
        ).toBe(false)
      }
    }
    // External BPMN labels are routing obstacles too, including labels owned
    // by the endpoints (only the endpoint base boxes receive port exemptions).
    for (const shape of shapes) {
      if (!shape.label?.bounds) continue
      for (let i = 1; i < normalized.length; i++) {
        expect(
          crossesInterior(normalized[i - 1], normalized[i], shape.label.bounds),
          `${mergeFlow.id} segment ${i} crosses label ${shape.bpmnElement.id}`
        ).toBe(false)
      }
    }
  })

  it('keeps full-export crossing and junction analysis within a coarse budget', async () => {
    const { files } = await convert()
    const moddle = new BpmnModdle()
    const diagrams: PolylineEdge[][] = []

    for (const file of files) {
      const { rootElement, warnings } = await moddle.fromXML(file.xml)
      expect(warnings).toEqual([])
      diagrams.push(
        rootElement.diagrams[0].plane.planeElement
          .filter(
            (element: { $type: string; bpmnElement?: { $type?: string } }) =>
              element.$type === 'bpmndi:BPMNEdge' &&
              element.bpmnElement?.$type === 'bpmn:SequenceFlow'
          )
          .map(
            (element: {
              bpmnElement: { id: string }
              waypoint: Array<{ x: number; y: number }>
            }) => ({
              id: element.bpmnElement.id,
              waypoints: element.waypoint.map((point) => ({ x: point.x, y: point.y }))
            })
          )
      )
    }

    const started = performance.now()
    let crossings = 0
    let junctions = 0
    for (const edges of diagrams) {
      const analysis = analyzeEdgeVisuals(edges)
      crossings += analysis.crossings.length
      junctions += analysis.junctions.length
    }
    const elapsedMs = performance.now() - started
    const edgeCount = diagrams.reduce((sum, edges) => sum + edges.length, 0)

    expect(edgeCount).toBe(194)
    expect(elapsedMs).toBeLessThan(1_000)
    console.log(
      `[animalwf-edge-visuals] edges=${edgeCount} crossings=${crossings} ` +
        `junctions=${junctions} analysis=${elapsedMs.toFixed(1)}ms`
    )
  })

  it('conversion of the real export is deterministic', async () => {
    const first = await convert()
    const again = await convertAmlToBpmnFiles(text as string)
    if (!('files' in again)) throw new Error('conversion failed')
    expect(again.files.map((f) => f.xml)).toEqual(first.files.map((f) => f.xml))
  })
})

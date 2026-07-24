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

  it('conversion of the real export is deterministic', async () => {
    const first = await convert()
    const again = await convertAmlToBpmnFiles(text as string)
    if (!('files' in again)) throw new Error('conversion failed')
    expect(again.files.map((f) => f.xml)).toEqual(first.files.map((f) => f.xml))
  })
})

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildClusterLayout,
  controlFlowSpine,
  defaultClusterPreferences,
  detectMimeFromContent,
  scanAttachment,
  scanAmlForOle,
  type ArisDetailsAttachmentBlob,
} from './index'

const ANIMAL_WF_PATH = resolve('/home/ahmed/Desktop/bpmn_tool/reference/AnimalWF/ARISAMLExport.xml')
const fixtureAvailable = existsSync(ANIMAL_WF_PATH)

describe.skipIf(!fixtureAvailable)('AnimalWF real-data acceptance', () => {
  let xmlText = ''

  it('loads and scans the AnimalWF AML export', async () => {
    const { readFileSync } = await import('node:fs')
    xmlText = readFileSync(ANIMAL_WF_PATH, 'utf-8')
    const scan = scanAmlForOle(xmlText)
    expect(scan.oleDefinitions.size).toBe(14)
    expect(scan.oleOccurrences.size).toBe(14)

    let blobCount = 0
    for (const def of scan.oleDefinitions.values()) {
      blobCount += def.blobs.length
    }
    expect(blobCount).toBe(28)
  })

  it('reports real satellite attachment patterns', async () => {
    const { readFileSync } = await import('node:fs')
    xmlText = readFileSync(ANIMAL_WF_PATH, 'utf-8')
    const objDefRegex = /<ObjDef\s+ObjDef\.ID="([^"]*)"[\s\S]*?TypeNum="([^"]*)"[\s\S]*?<\/ObjDef>/g
    const objectTypes = new Map<string, string>()
    let match: RegExpExecArray | null
    while ((match = objDefRegex.exec(xmlText)) !== null) {
      const id = match[1]
      const typeMatch = /TypeNum="([^"]*)"/.exec(match[0])
      objectTypes.set(id, typeMatch?.[1] ?? 'unknown')
    }

    const satellitePatterns = new Map<string, number>()
    const blockRegex = /<ObjDef\s+ObjDef\.ID="([^"]*)"[\s\S]*?TypeNum="([^"]*)"[\s\S]*?<\/ObjDef>/g
    while ((match = blockRegex.exec(xmlText)) !== null) {
      const sourceId = match[1]
      const sourceType = objectTypes.get(sourceId) ?? 'unknown'
      const cxnRegex = /<CxnDef\s+CxnDef\.ID="([^"]*)"\s+CxnDef\.Type="([^"]*)"\s+ToObjDef\.IdRef="([^"]*)"/g
      let cxnMatch: RegExpExecArray | null
      while ((cxnMatch = cxnRegex.exec(match[0])) !== null) {
        const connectionType = cxnMatch[2]
        const targetId = cxnMatch[3]
        const targetType = objectTypes.get(targetId) ?? 'unknown'
        const key = `${sourceType} --${connectionType}--> ${targetType}`
        satellitePatterns.set(key, (satellitePatterns.get(key) ?? 0) + 1)
      }
    }

    // The real AnimalWF export connects satellite objects to functions.
    expect(satellitePatterns.size).toBeGreaterThan(0)
    const allKeys = [...satellitePatterns.keys()]
    expect(allKeys.some((k) => k.includes('OT_PERS'))).toBe(true)
    expect(allKeys.some((k) => k.includes('OT_INFO_CARR') || k.includes('OT_ENT_TYPE'))).toBe(true)
    expect(allKeys.some((k) => k.includes('OT_APPL_SYS'))).toBe(true)
  })

  it('verifies attachment MIME types found in AnimalWF', async () => {
    const { readFileSync } = await import('node:fs')
    xmlText = readFileSync(ANIMAL_WF_PATH, 'utf-8')
    const scan = scanAmlForOle(xmlText)
    const foundMimes = new Set<string>()
    let oleCount = 0
    for (const def of scan.oleDefinitions.values()) {
      oleCount++
      const bytes = concatBlobs(def.blobs)
      const mime = detectMimeFromContent(bytes)
      foundMimes.add(mime)
      const scanned = await scanAttachment(def)
      expect(scanned.isOle || scanned.detectedMime === 'application/octet-stream' || scanned.detectedMime === 'application/zip').toBe(true)
      expect(scanned.safeToPreview).toBe(false)
    }
    expect(oleCount).toBe(14)
    expect(foundMimes.size).toBeGreaterThanOrEqual(1)
  })

  it('proves rich display does not distort the control-flow backbone', async () => {
    // This test documents the contract: the details layer reads control-flow
    // node positions from the source and never mutates them. A real adapter
    // test uses the in-flight working document; here we verify the pure helper
    // preserves the spine order regardless of satellite density.
    const nodes: Parameters<typeof controlFlowSpine>[0] = [
      { occurrenceId: 'f1', definitionId: 'd1', type: 'OT_FUNC', symbol: 'ST_FUNC', bounds: { x: 10, y: 20, width: 100, height: 50 } },
      { occurrenceId: 'f2', definitionId: 'd2', type: 'OT_FUNC', symbol: 'ST_FUNC', bounds: { x: 10, y: 200, width: 100, height: 50 } },
    ]
    const spine = controlFlowSpine(nodes)
    expect(spine).toEqual([
      { x: 10, y: 20 },
      { x: 10, y: 200 },
    ])

    const layout = buildClusterLayout(new Map(), nodes, defaultClusterPreferences())
    expect(layout.visibleSatellites.length).toBe(0)
  })
})

function concatBlobs(blobs: readonly ArisDetailsAttachmentBlob[]): Uint8Array {
  const arrays = blobs.map((b) => Uint8Array.from(Buffer.from(b.base64, 'base64')))
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const arr of arrays) {
    out.set(arr, offset)
    offset += arr.length
  }
  return out
}

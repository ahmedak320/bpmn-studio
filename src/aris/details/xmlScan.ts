/**
 * Minimal XML scan for Phase 10 acceptance tests.
 *
 * This is intentionally small and dependency-free. It reads AnimalWF-sized AML
 * exports and extracts just enough to build attachment records and count
 * OLE/attachment facts. It does NOT replace the lossless parser in
 * `src/aris/source`; it is only for test helpers that must not couple to the
 * in-flight semantic index.
 */

import type { ArisDetailsAttachment, ArisDetailsAttachmentBlob } from './seam'

export interface ArisXmlScanResult {
  readonly oleDefinitions: ReadonlyMap<string, ArisDetailsAttachment>
  readonly oleOccurrences: ReadonlyMap<
    string,
    {
      readonly oleOccurrenceId: string
      readonly oleDefinitionId: string
      readonly modelId: string
      readonly x: number
      readonly y: number
      readonly dx: number
      readonly dy: number
    }
  >
  readonly attachmentCount: number
}

function extractAttribute(tag: string, name: string): string | null {
  const pattern = new RegExp(`${name}="([^"]*)"`)
  const match = pattern.exec(tag)
  return match?.[1] ?? null
}

function extractNumberAttribute(tag: string, name: string): number | null {
  const value = extractAttribute(tag, name)
  if (value === null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function decodeXmlEntities(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

export function scanAmlForOle(xmlText: string): ArisXmlScanResult {
  const oleDefinitions = new Map<string, ArisDetailsAttachment>()
  const oleOccurrences = new Map<string, { oleOccurrenceId: string; oleDefinitionId: string; modelId: string; x: number; y: number; dx: number; dy: number }>()

  const oleDefRegex = /<OLEDef\s+OLEDef\.ID="([^"]*)"[\s\S]*?<\/OLEDef>/g
  let match: RegExpExecArray | null

  while ((match = oleDefRegex.exec(xmlText)) !== null) {
    const block = match[0]
    const oleDefId = match[1]
    const blobs: ArisDetailsAttachmentBlob[] = []
    const blobRegex = /<Blob>([\s\S]*?)<\/Blob>/g
    let blobMatch: RegExpExecArray | null
    let index = 0
    while ((blobMatch = blobRegex.exec(block)) !== null) {
      blobs.push({ index: index++, base64: blobMatch[1].replace(/\s+/g, '') })
    }
    if (blobs.length > 0) {
      oleDefinitions.set(oleDefId, {
        id: oleDefId,
        oleDefinitionId: oleDefId,
        oleOccurrenceId: null,
        modelId: null,
        position: null,
        size: null,
        displayName: `OLE-${oleDefId}`,
        blobs,
      })
    }
  }

  const modelRegex = /<Model\s+Model\.ID="([^"]*)"[\s\S]*?<\/Model>/g
  while ((match = modelRegex.exec(xmlText)) !== null) {
    const modelBlock = match[0]
    const modelId = match[1]
    const oleOccRegex = /<OLEOcc\s+OLEOcc\.ID="([^"]*)"\s+OLEDef\.IdRef="([^"]*)"[\s\S]*?<\/OLEOcc>/g
    let oleOccMatch: RegExpExecArray | null
    while ((oleOccMatch = oleOccRegex.exec(modelBlock)) !== null) {
      const occBlock = oleOccMatch[0]
      const occId = oleOccMatch[1]
      const defId = oleOccMatch[2]
      const x = extractNumberAttribute(occBlock, 'Pos\\.X') ?? 0
      const y = extractNumberAttribute(occBlock, 'Pos\\.Y') ?? 0
      const dx = extractNumberAttribute(occBlock, 'Size\\.dX') ?? 0
      const dy = extractNumberAttribute(occBlock, 'Size\\.dY') ?? 0
      oleOccurrences.set(occId, { oleOccurrenceId: occId, oleDefinitionId: defId, modelId, x, y, dx, dy })

      const def = oleDefinitions.get(defId)
      if (def) {
        oleDefinitions.set(defId, {
          ...def,
          oleOccurrenceId: occId,
          modelId,
          position: { x, y },
          size: { dx, dy },
          displayName: sanitizeOleDisplayName(modelId, defId),
        })
      }
    }
  }

  return {
    oleDefinitions,
    oleOccurrences,
    attachmentCount: oleDefinitions.size,
  }
}

function sanitizeOleDisplayName(modelId: string, oleDefId: string): string {
  const safeModel = modelId.replace(/[\\/:*?"<>|]/g, '_')
  const safeOle = oleDefId.replace(/[\\/:*?"<>|]/g, '_')
  return `${safeModel}_${safeOle}.ole`
}

export function loadXmlScan(filePath: string): Promise<ArisXmlScanResult> {
  if (typeof process !== 'undefined') {
    return import('node:fs').then((fs) => {
      const text = fs.readFileSync(filePath, 'utf-8')
      return scanAmlForOle(decodeXmlEntities(text))
    })
  }
  throw new Error('loadXmlScan is only available in Node.js')
}

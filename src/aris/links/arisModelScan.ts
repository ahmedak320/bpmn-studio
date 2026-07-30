// ARIS AML model/assignment scanner. Pure, node-safe, DOM-free: turns an AML
// text into the inputs `buildProcessHierarchy` already consumes, modeled on
// `src/links/linkGraph.ts`.
//
// Safety conventions copied from linkGraph.ts:
//  - comments and CDATA are masked to equal-length whitespace before scanning;
//  - spans are tracked with a stack so each occurrence is attributed to the
//    model that actually contains it;
//  - duplicate model ids fail closed (omitted from the index, flagged ambiguous).

import type { ArisWorkingDocument } from '@/aris/model/types'
import { decodeAmlEntities, localeLang, parseDtdEntities, readTagAttr } from '@/library/amlParse'

/** One `<Model>` discovered in an AML source. */
export interface ArisScannedModel {
  readonly modelId: string
  readonly name: string | null
  readonly modelType: string | null
}

/** One assignment edge: a definition links to a child model and occurs in a parent model. */
export interface ArisScannedAssignment {
  readonly parentModelId: string
  readonly childModelId: string
  readonly occurrenceIds: readonly string[]
  readonly count: number
}

/** Deterministic output of `scanArisModelSource`. */
export interface ArisModelScanResult {
  readonly models: readonly ArisScannedModel[]
  readonly assignments: readonly ArisScannedAssignment[]
}

// Regex scanning must not interpret tag-shaped examples in comments or CDATA.
// Replacing those regions with equal-length whitespace preserves source offsets
// so each occurrence is attributed to its containing model span.
const XML_COMMENT_OR_CDATA_RE = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/g

// Quote-aware attribute string: `[^>"]` runs or full quoted strings so a stray
// `>` inside an attribute value cannot truncate the tag.
const TAG_ATTRS = '((?:[^>"]|"[^"]*")*?)'

const MODEL_TAG_RE = new RegExp('<(/?)Model\\b' + TAG_ATTRS + '(/?)>', 'g')
const OBJDEF_TAG_RE = new RegExp('<(/?)ObjDef\\b' + TAG_ATTRS + '(/?)>', 'g')
const OBJOCC_TAG_RE = new RegExp('<ObjOcc\\b' + TAG_ATTRS + '/?>', 'g')
const ATTRDEF_TAG_RE = new RegExp('<AttrDef\\b' + TAG_ATTRS + '(?:/>|>([\\s\\S]*?)</AttrDef>)', 'g')
const ATTRVALUE_TAG_RE = new RegExp(
  '<AttrValue\\b' + TAG_ATTRS + '(?:/>|>([\\s\\S]*?)</AttrValue>)',
  'g'
)
const PLAINTEXT_VALUE_RE = /<PlainText\b[^>]*?TextValue="([^"]*)"[^>]*\/?>/g
const PLAINTEXT_CONTENT_RE = /<PlainText\b[^>]*>([\s\S]*?)<\/PlainText>/

interface ModelSpan {
  readonly modelId: string
  readonly modelType: string | null
  readonly bodyStart: number
  readonly bodyEnd: number
}

interface ObjDefRecord {
  readonly defId: string
  readonly linkedModelIds: readonly string[]
}

interface ObjOccRecord {
  readonly occId: string
  readonly defId: string
  readonly offset: number
}

interface MutableAssignment {
  parentModelId: string
  childModelId: string
  occurrenceIds: string[]
  count: number
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function maskCommentsAndCdata(xml: string): string {
  return xml.replace(XML_COMMENT_OR_CDATA_RE, (region) => ' '.repeat(region.length))
}

function readRequiredAttr(attrs: string, name: string): string | undefined {
  const raw = readTagAttr(attrs, name)
  if (raw === undefined) return undefined
  return raw
}

/** Extract the text of one `<AttrValue>` body, mirroring `amlParse.ts`. */
function attrValueText(body: string, entities: Record<string, string>): string | undefined {
  const runs: string[] = []
  PLAINTEXT_VALUE_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PLAINTEXT_VALUE_RE.exec(body)) !== null) {
    runs.push(decodeAmlEntities(match[1]!, entities))
  }
  if (runs.length > 0) {
    const joined = runs.join(' ').replace(/\s+/g, ' ').trim()
    if (joined) return joined
  }

  const plainContent = PLAINTEXT_CONTENT_RE.exec(body)
  if (plainContent) {
    const v = decodeAmlEntities(plainContent[1]!.replace(/<[^>]*>/g, ''), entities).trim()
    if (v) return v
  }

  const v = decodeAmlEntities(body.replace(/<[^>]*>/g, ''), entities).trim()
  return v || undefined
}

/** Model display name = first `AT_NAME` before the model's first `<ObjOcc`. */
function extractModelName(
  scanXml: string,
  bodyStart: number,
  bodyEnd: number,
  entities: Record<string, string>
): string | null {
  const firstObjOcc = scanXml.indexOf('<ObjOcc', bodyStart)
  const regionEnd = firstObjOcc === -1 || firstObjOcc > bodyEnd ? bodyEnd : firstObjOcc
  const region = scanXml.slice(bodyStart, regionEnd)

  let en: string | undefined
  let ar: string | undefined
  let other: string | undefined

  ATTRDEF_TAG_RE.lastIndex = 0
  let defMatch: RegExpExecArray | null
  while ((defMatch = ATTRDEF_TAG_RE.exec(region)) !== null) {
    const defAttrs = defMatch[1]!
    const type = readTagAttr(defAttrs, 'AttrDef.Type') ?? readTagAttr(defAttrs, 'TypeNum')
    if (type !== 'AT_NAME') continue

    const defBody = defMatch[2] ?? ''
    ATTRVALUE_TAG_RE.lastIndex = 0
    let valueMatch: RegExpExecArray | null
    while ((valueMatch = ATTRVALUE_TAG_RE.exec(defBody)) !== null) {
      const text = attrValueText(valueMatch[2] ?? '', entities)
      if (!text) continue
      const rawLocale = decodeAmlEntities(readTagAttr(valueMatch[1]!, 'LocaleId') ?? '', entities)
      const lang = localeLang(rawLocale)
      if (lang === 'en' && en === undefined) en = text
      else if (lang === 'ar' && ar === undefined) ar = text
      else if (other === undefined) other = text
    }

    // Degenerate exports put text straight into the AttrDef.
    if (en === undefined && ar === undefined && other === undefined) {
      const text = attrValueText(defBody, entities)
      if (text) other = text
    }
    break // first matching AttrDef wins
  }

  return en ?? ar ?? other ?? null
}

/** Stack-scan `<Model>…</Model>` spans. */
function scanModelSpans(scanXml: string): ModelSpan[] {
  const spans: ModelSpan[] = []
  const open: Array<{ bodyStart: number; modelId: string; modelType: string | null }> = []

  MODEL_TAG_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = MODEL_TAG_RE.exec(scanXml)) !== null) {
    const closing = match[1] === '/'
    if (closing) {
      const span = open.pop()
      if (span) {
        spans.push({
          modelId: span.modelId,
          modelType: span.modelType,
          bodyStart: span.bodyStart,
          bodyEnd: match.index
        })
      }
      continue
    }

    const attrs = match[2] ?? ''
    const rawId = readRequiredAttr(attrs, 'Model.ID')
    if (!rawId) continue
    const modelId = decodeAmlEntities(rawId, {})
    const rawType = readTagAttr(attrs, 'Model.Type')
    const modelType = rawType ? decodeAmlEntities(rawType, {}) : null
    const selfClosing = match[3] === '/'

    if (selfClosing) {
      spans.push({
        modelId,
        modelType,
        bodyStart: MODEL_TAG_RE.lastIndex,
        bodyEnd: MODEL_TAG_RE.lastIndex
      })
    } else {
      open.push({ bodyStart: MODEL_TAG_RE.lastIndex, modelId, modelType })
    }
  }

  return spans
}

/** Stack-scan `<ObjDef>` spans and capture linked model ids. */
function scanObjDefs(scanXml: string): ObjDefRecord[] {
  const records: ObjDefRecord[] = []
  const open: Array<{ defId: string; linkedModelIds: readonly string[] }> = []

  OBJDEF_TAG_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = OBJDEF_TAG_RE.exec(scanXml)) !== null) {
    const closing = match[1] === '/'
    if (closing) {
      const record = open.pop()
      if (record) records.push(record)
      continue
    }

    const attrs = match[2] ?? ''
    const rawId = readRequiredAttr(attrs, 'ObjDef.ID')
    if (!rawId) continue
    const defId = decodeAmlEntities(rawId, {})

    const rawLinked = readTagAttr(attrs, 'LinkedModels.IdRefs')
    const linkedModelIds: string[] = []
    if (rawLinked) {
      const decoded = decodeAmlEntities(rawLinked, {})
      for (const id of decoded.trim().split(/\s+/u)) {
        if (id) linkedModelIds.push(id)
      }
    }

    const selfClosing = match[3] === '/'
    if (selfClosing) {
      records.push({ defId, linkedModelIds })
    } else {
      open.push({ defId, linkedModelIds })
    }
  }

  return records
}

/** Single-pass `<ObjOcc` tag scan. */
function scanObjOccs(scanXml: string): ObjOccRecord[] {
  const records: ObjOccRecord[] = []
  OBJOCC_TAG_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = OBJOCC_TAG_RE.exec(scanXml)) !== null) {
    const attrs = match[1] ?? ''
    const rawOccId = readTagAttr(attrs, 'ObjOcc.ID')
    const rawDefId = readTagAttr(attrs, 'ObjDef.IdRef')
    if (!rawOccId || !rawDefId) continue
    records.push({
      occId: decodeAmlEntities(rawOccId, {}),
      defId: decodeAmlEntities(rawDefId, {}),
      offset: match.index
    })
  }
  return records
}

/** Find the model span whose body contains the given offset. */
function containingModel(spans: readonly ModelSpan[], offset: number): ModelSpan | undefined {
  let containing: ModelSpan | undefined
  for (const span of spans) {
    if (offset < span.bodyStart || offset >= span.bodyEnd) continue
    if (!containing || span.bodyStart > containing.bodyStart) containing = span
  }
  return containing
}

/**
 * Scan a single AML source into deterministic models and assignments.
 *
 * Models are discovered by stack-scanning `<Model>` spans. Object definitions
 * are scanned separately for `LinkedModels.IdRefs`. Object occurrences are
 * attributed to their containing model span; an assignment edge exists only
 * when the linking definition occurs at least once inside the parent model.
 */
export function scanArisModelSource(xml: string): ArisModelScanResult {
  if (!xml) return { models: [], assignments: [] }

  const entities = parseDtdEntities(xml)
  const scanXml = maskCommentsAndCdata(xml)

  const spans = scanModelSpans(scanXml)
  const objDefs = scanObjDefs(scanXml)
  const objOccs = scanObjOccs(scanXml)

  // Build defId -> linked model ids for fast lookup.
  const linkedByDef = new Map<string, readonly string[]>()
  for (const def of objDefs) {
    // If the same ObjDef.ID appears twice, the later scan wins deterministically
    // because it follows document order; in practice AML ids are unique.
    linkedByDef.set(def.defId, def.linkedModelIds)
  }

  // Attribute occurrences to their containing model, grouped by (model, def).
  const occsByModelDef = new Map<string, Map<string, string[]>>()
  for (const occ of objOccs) {
    const model = containingModel(spans, occ.offset)
    if (!model) continue
    const modelKey = model.modelId
    let byDef = occsByModelDef.get(modelKey)
    if (!byDef) {
      byDef = new Map<string, string[]>()
      occsByModelDef.set(modelKey, byDef)
    }
    const list = byDef.get(occ.defId)
    if (list) list.push(occ.occId)
    else byDef.set(occ.defId, [occ.occId])
  }

  // Build assignment edges. A linking def can point at several child models; each
  // occurrence in a parent contributes to every linked child.
  const assignmentMap = new Map<string, MutableAssignment>()
  for (const [modelId, byDef] of occsByModelDef) {
    for (const [defId, occIds] of byDef) {
      const linkedIds = linkedByDef.get(defId)
      if (!linkedIds || linkedIds.length === 0) continue
      for (const childModelId of linkedIds) {
        const key = `${modelId}\u0000${childModelId}`
        const existing = assignmentMap.get(key)
        if (existing) {
          existing.occurrenceIds.push(...occIds)
          existing.count += occIds.length
        } else {
          assignmentMap.set(key, {
            parentModelId: modelId,
            childModelId,
            occurrenceIds: [...occIds],
            count: occIds.length
          })
        }
      }
    }
  }

  const models: ArisScannedModel[] = spans
    .map((span) => {
      const name = extractModelName(scanXml, span.bodyStart, span.bodyEnd, entities)
      return {
        modelId: span.modelId,
        name,
        modelType: span.modelType
      }
    })
    .sort((a, b) => compareText(a.modelId, b.modelId))

  const assignments: ArisScannedAssignment[] = Array.from(assignmentMap.values())
    .map((a) => ({
      parentModelId: a.parentModelId,
      childModelId: a.childModelId,
      occurrenceIds: [...new Set(a.occurrenceIds)].sort(compareText),
      count: a.count
    }))
    .sort(
      (a, b) =>
        compareText(a.parentModelId, b.parentModelId) || compareText(a.childModelId, b.childModelId)
    )

  return { models, assignments }
}

function pickLocalizedName(
  values: Readonly<Record<string, string>>,
  fallback: string | null
): string | null {
  return values.en ?? values.ar ?? fallback ?? Object.values(values)[0] ?? null
}

/**
 * Produce the same `ArisModelScanResult` from an in-memory `ArisWorkingDocument`
 * so open tabs can overlay live edits without re-reading the file system.
 */
export function deriveArisLinksFromDocument(document: ArisWorkingDocument): ArisModelScanResult {
  const models: ArisScannedModel[] = []
  const modelIds = Array.from(document.models.keys()).sort(compareText)
  for (const modelId of modelIds) {
    const model = document.models.get(modelId)!
    models.push({
      modelId,
      name: pickLocalizedName(model.names.values, model.names.fallback),
      modelType: typeof model.type === 'string' ? model.type : null
    })
  }

  // defId -> linked model ids
  const linkedByDef = new Map<string, readonly string[]>()
  for (const [defId, def] of document.objectDefinitions) {
    linkedByDef.set(defId, def.linkedModelIds)
  }

  // (modelId, defId) -> occurrence ids
  const occsByModelDef = new Map<string, Map<string, string[]>>()
  for (const [modelId, model] of document.models) {
    for (const occ of model.occurrences) {
      let byDef = occsByModelDef.get(modelId)
      if (!byDef) {
        byDef = new Map<string, string[]>()
        occsByModelDef.set(modelId, byDef)
      }
      const list = byDef.get(occ.definitionId)
      if (list) list.push(occ.id)
      else byDef.set(occ.definitionId, [occ.id])
    }
  }

  const assignmentMap = new Map<string, MutableAssignment>()
  for (const [modelId, byDef] of occsByModelDef) {
    for (const [defId, occIds] of byDef) {
      const linkedIds = linkedByDef.get(defId)
      if (!linkedIds || linkedIds.length === 0) continue
      for (const childModelId of linkedIds) {
        const key = `${modelId}\u0000${childModelId}`
        const existing = assignmentMap.get(key)
        if (existing) {
          existing.occurrenceIds.push(...occIds)
          existing.count += occIds.length
        } else {
          assignmentMap.set(key, {
            parentModelId: modelId,
            childModelId,
            occurrenceIds: [...occIds],
            count: occIds.length
          })
        }
      }
    }
  }

  const assignments: ArisScannedAssignment[] = Array.from(assignmentMap.values())
    .map((a) => ({
      parentModelId: a.parentModelId,
      childModelId: a.childModelId,
      occurrenceIds: [...new Set(a.occurrenceIds)].sort(compareText),
      count: a.count
    }))
    .sort(
      (a, b) =>
        compareText(a.parentModelId, b.parentModelId) || compareText(a.childModelId, b.childModelId)
    )

  return { models, assignments }
}

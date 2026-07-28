// A MINIMAL, TEST-ONLY regex scan of the real (private, un-committed)
// `../../reference/AnimalWF/ARISAMLExport.xml` fixture, producing this
// lane's own `ArisAssistantModelInput[]`. This is deliberately NOT a real
// AML parser — `src/aris/source`'s semantic index (the real parser) is being
// rewritten by another agent right now, so per the brief this test helper
// must not depend on it. It only extracts enough structure (object
// definitions, model occurrences, occurrence-level connections, AT_NAME /
// AT_PERS_RESP text) to build realistic digests for the guarded real-data
// test — nothing here is exported to, or reachable from, production code.

import { readFileSync } from 'node:fs'

import type { ArisAssistantAttribute, ArisAssistantLocalizedText, ArisAssistantModelInput } from '../types'

interface ScannedObjectDefinition {
  readonly typeNum: string
  readonly names: ArisAssistantLocalizedText
}

interface ScannedConnectionDefinition {
  readonly type: string
}

/** The two locale entities this specific export's DOCTYPE declares: AEar (Arabic) / USen (English). */
function entityLocaleToLang(raw: string): 'en' | 'ar' | undefined {
  const lower = raw.toLowerCase()
  if (lower.includes('ar')) return 'ar'
  if (lower.includes('en')) return 'en'
  return undefined
}

function attrValue(tagAttrs: string, name: string): string | undefined {
  const m = new RegExp(`${name}="([^"]*)"`).exec(tagAttrs)
  return m ? m[1] : undefined
}

/** Reconstruct one AttrValue's text by concatenating every nested TextValue="…" run. */
function textFromAttrValueBody(body: string): string {
  const parts: string[] = []
  const re = /TextValue="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) if (m[1]) parts.push(m[1])
  return parts.join(' ').trim()
}

/** Resolve the first `<AttrDef AttrDef.Type="…">…</AttrDef>` of `attrType` inside `body` to bilingual text. */
function resolveAttrDefText(body: string, attrType: string): ArisAssistantLocalizedText {
  const blockMatch = new RegExp(`<AttrDef AttrDef\\.Type="${attrType}">([\\s\\S]*?)<\\/AttrDef>`).exec(body)
  const out: { en: string | null; ar: string | null } = { en: null, ar: null }
  if (blockMatch) {
    const valueRe = /<AttrValue LocaleId="([^"]*)">([\s\S]*?)<\/AttrValue>/g
    let m: RegExpExecArray | null
    while ((m = valueRe.exec(blockMatch[1]))) {
      const lang = entityLocaleToLang(m[1])
      const text = textFromAttrValueBody(m[2])
      if (!text) continue
      if (lang === 'en' && out.en === null) out.en = text
      else if (lang === 'ar' && out.ar === null) out.ar = text
    }
  }
  return { en: out.en, ar: out.ar, fallback: out.en ?? out.ar }
}

function scanObjectDefinitions(xml: string): Map<string, ScannedObjectDefinition> {
  const out = new Map<string, ScannedObjectDefinition>()
  const re = /<ObjDef\b([\s\S]*?)>([\s\S]*?)<\/ObjDef>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const [, tagAttrs, body] = m
    const id = attrValue(tagAttrs, 'ObjDef\\.ID')
    const typeNum = attrValue(tagAttrs, 'TypeNum')
    if (!id || !typeNum) continue
    out.set(id, { typeNum, names: resolveAttrDefText(body, 'AT_NAME') })
  }
  return out
}

function scanConnectionDefinitions(xml: string): Map<string, ScannedConnectionDefinition> {
  const out = new Map<string, ScannedConnectionDefinition>()
  const re = /<CxnDef CxnDef\.ID="([^"]+)"\s+CxnDef\.Type="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) out.set(m[1], { type: m[2] })
  return out
}

interface ScannedModelBlock {
  readonly modelId: string
  readonly modelType: string
  readonly body: string
}

function scanModelBlocks(xml: string): ScannedModelBlock[] {
  const out: ScannedModelBlock[] = []
  const re = /<Model\b([\s\S]*?)>([\s\S]*?)<\/Model>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const [, tagAttrs, body] = m
    const modelId = attrValue(tagAttrs, 'Model\\.ID')
    const modelType = attrValue(tagAttrs, 'Model\\.Type')
    if (!modelId || !modelType) continue
    out.push({ modelId, modelType, body })
  }
  return out
}

/** Read + scan the real AnimalWF export into this lane's `ArisAssistantModelInput[]`, one per `<Model>`. */
export function scanAnimalWfModels(filePath: string): ArisAssistantModelInput[] {
  const xml = readFileSync(filePath, 'utf8')
  const objectDefinitions = scanObjectDefinitions(xml)
  const connectionDefinitions = scanConnectionDefinitions(xml)
  const modelBlocks = scanModelBlocks(xml)

  return modelBlocks.map((block, index) => {
    const withoutLanes = block.body.replace(/<Lane\b[\s\S]*?<\/Lane>/g, '')
    const modelNames = resolveAttrDefText(withoutLanes, 'AT_NAME')
    const ownerText = resolveAttrDefText(withoutLanes, 'AT_PERS_RESP')
    const attributes: ArisAssistantAttribute[] = []
    if (ownerText.en || ownerText.ar) attributes.push({ type: 'AT_PERS_RESP', text: ownerText })

    const occurrences: ArisAssistantModelInput['occurrences'][number][] = []
    const connectionOccurrences: ArisAssistantModelInput['connectionOccurrences'][number][] = []

    const objOccRe = /<ObjOcc\b([\s\S]*?)>([\s\S]*?)<\/ObjOcc>/g
    let occMatch: RegExpExecArray | null
    while ((occMatch = objOccRe.exec(block.body))) {
      const [, occTagAttrs, occBody] = occMatch
      const occId = attrValue(occTagAttrs, 'ObjOcc\\.ID')
      const defId = attrValue(occTagAttrs, 'ObjDef\\.IdRef')
      const symbol = attrValue(occTagAttrs, 'SymbolNum') ?? null
      if (!occId || !defId) continue
      const def = objectDefinitions.get(defId)
      occurrences.push({
        occurrenceId: occId,
        definitionId: defId,
        objectType: def?.typeNum ?? 'UNKNOWN',
        symbol,
        names: def?.names ?? { en: null, ar: null, fallback: null },
        attributes: [],
        linkedModelIds: []
      })

      const cxnOccRe = /<CxnOcc CxnOcc\.ID="([^"]+)"\s+CxnDef\.IdRef="([^"]+)"\s+ToObjOcc\.IdRef="([^"]+)"/g
      let cxnMatch: RegExpExecArray | null
      while ((cxnMatch = cxnOccRe.exec(occBody))) {
        const [, cxnOccId, cxnDefId, targetOccId] = cxnMatch
        connectionOccurrences.push({
          occurrenceId: cxnOccId,
          definitionId: cxnDefId,
          connectionType: connectionDefinitions.get(cxnDefId)?.type ?? 'UNKNOWN',
          sourceOccurrenceId: occId,
          targetOccurrenceId: targetOccId,
          names: { en: null, ar: null, fallback: null }
        })
      }
    }

    return {
      relPath: `AnimalWF/model-${index + 1}.aml`,
      modelId: block.modelId,
      modelType: block.modelType,
      names: modelNames,
      attributes,
      occurrences,
      connectionOccurrences,
      revision: 1,
      sourceDigest: block.modelId
    }
  })
}

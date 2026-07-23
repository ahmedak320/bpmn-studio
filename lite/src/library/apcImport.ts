// EXPERIMENTAL ARIS (.apc) → BPMN import.
//
// ARIS exports its models as AML (ARIS Markup Language) XML. A minimal EPC in
// AML is a flat list of `<ObjDef>` object definitions (functions = TypeNum
// "OT_FUNC", events = "OT_EVT", …), each carrying its name in a nested
// `<AttrDef AttrDef.Type="AT_NAME">` and its outgoing relationships as nested
// `<CxnDef …>` connection definitions that reference a target object via
// `ToObjDef.IdRef` (older exports: `CxnDef.ToObjDef`).
//
// AML is large, deeply-versioned and full of layout/occurrence noise we don't
// need, so this converter is deliberately TOLERANT: it scans the text with
// regexes (no DOM, so it runs in node unit tests too), keeps only the object
// definitions and their flow connections, maps them onto a semantic BPMN graph
// (functions → tasks, events → start/intermediate/end by their in/out degree,
// anything else → a task), and hands the result to `layoutBpmn` for DI. It is
// best-effort by design — a real ARIS file will convert to an approximate,
// hand-tidyable diagram, never a byte-perfect round-trip.

import { layoutBpmn } from '@app/gen'

export type ApcConversion = { xml: string } | { error: string }

const NS_MODEL = 'http://www.omg.org/spec/BPMN/20100524/MODEL'
const NS_BPMNDI = 'http://www.omg.org/spec/BPMN/20100524/DI'
const NS_DC = 'http://www.omg.org/spec/DD/20100524/DC'
const NS_DI = 'http://www.omg.org/spec/DD/20100524/DI'

// XML 1.0 forbids these C0 control chars; strip so a stray one in an AML name
// can't produce invalid BPMN that layoutBpmn/importXML would reject.
const XML_ILLEGAL_CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g

function stripIllegalXmlChars(text: string): string {
  return text.replace(XML_ILLEGAL_CONTROL_CHARS, '')
}

function escapeAttr(text: string): string {
  return stripIllegalXmlChars(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeText(text: string): string {
  return stripIllegalXmlChars(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Decode the handful of XML entities AML actually uses in name text. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Read a (possibly dotted) attribute value off a start-tag's attribute string. */
function readTagAttr(attrs: string, name: string): string | undefined {
  const escaped = name.replace(/[.]/g, '\\.')
  const m = new RegExp(escaped + '\\s*=\\s*"([^"]*)"').exec(attrs)
  return m ? m[1] : undefined
}

/** Extract an object's display name from its AT_NAME AttrDef, if present. */
function extractName(inner: string): string | undefined {
  const attrDef = /<AttrDef\b[^>]*AttrDef\.Type\s*=\s*"AT_NAME"[^>]*>([\s\S]*?)<\/AttrDef>/.exec(inner)
  if (!attrDef) return undefined
  const body = attrDef[1]
  // Newer exports: <PlainText TextValue="…" />
  const byAttr = /<PlainText\b[^>]*\bTextValue\s*=\s*"([^"]*)"/.exec(body)
  if (byAttr) {
    const v = decodeEntities(byAttr[1]).trim()
    if (v) return v
  }
  // Some exports carry the text as PlainText element content.
  const byPlainText = /<PlainText\b[^>]*>([\s\S]*?)<\/PlainText>/.exec(body)
  if (byPlainText) {
    const v = decodeEntities(byPlainText[1].replace(/<[^>]*>/g, '')).trim()
    if (v) return v
  }
  // Oldest exports: text directly inside AttrValue.
  const byAttrValue = /<AttrValue\b[^>]*>([\s\S]*?)<\/AttrValue>/.exec(body)
  if (byAttrValue) {
    const v = decodeEntities(byAttrValue[1].replace(/<[^>]*>/g, '')).trim()
    if (v) return v
  }
  return undefined
}

interface AmlObject {
  objId: string
  typeNum: string
  name?: string
}
interface AmlEdge {
  source: string
  target: string
}

/** Scan the AML text for its object definitions and their flow connections. */
function parseAml(text: string): { objects: AmlObject[]; edges: AmlEdge[] } {
  const objects: AmlObject[] = []
  const edges: AmlEdge[] = []

  const objOpen = /<ObjDef\b([^>]*?)(\/?)>/g
  let m: RegExpExecArray | null
  while ((m = objOpen.exec(text))) {
    const attrs = m[1]
    const selfClose = m[2] === '/'
    const objId = readTagAttr(attrs, 'ObjDef.ID')
    if (!objId) continue

    let inner = ''
    if (!selfClose) {
      const closeIdx = text.indexOf('</ObjDef>', objOpen.lastIndex)
      if (closeIdx === -1) continue
      inner = text.slice(objOpen.lastIndex, closeIdx)
      // ObjDefs don't nest, so jump the scanner past this object's body.
      objOpen.lastIndex = closeIdx + '</ObjDef>'.length
    }

    objects.push({
      objId,
      typeNum: readTagAttr(attrs, 'TypeNum') ?? '',
      name: extractName(inner)
    })

    // Connections are nested in the SOURCE object and name the TARGET by id.
    const cxnOpen = /<CxnDef\b([^>]*?)\/?>/g
    let c: RegExpExecArray | null
    while ((c = cxnOpen.exec(inner))) {
      const cxnAttrs = c[1]
      const cxnType = readTagAttr(cxnAttrs, 'TypeNum')
      // Only flow-style connections (CT_*); skip anything else (or accept when
      // the export omitted the type entirely).
      if (cxnType && !/^CT_/i.test(cxnType)) continue
      const target =
        readTagAttr(cxnAttrs, 'ToObjDef.IdRef') ??
        readTagAttr(cxnAttrs, 'CxnDef.ToObjDef') ??
        readTagAttr(cxnAttrs, 'ToObjDef')
      if (target) edges.push({ source: objId, target })
    }
  }

  return { objects, edges }
}

/** Sanitize an AML id into a valid BPMN NCName, deduped against `taken`. */
function sanitizeId(raw: string, taken: Set<string>): string {
  let base = raw.replace(/[^A-Za-z0-9_-]/g, '_')
  if (!/^[A-Za-z_]/.test(base)) base = `n_${base}`
  let id = base
  let n = 1
  while (taken.has(id)) {
    n += 1
    id = `${base}_${n}`
  }
  taken.add(id)
  return id
}

/** Pick a BPMN element tag for an AML object given its flow degree. */
function elementType(typeNum: string, inDeg: number, outDeg: number): string {
  if (typeNum === 'OT_EVT') {
    if (inDeg === 0) return 'startEvent'
    if (outDeg === 0) return 'endEvent'
    return 'intermediateThrowEvent'
  }
  // OT_FUNC and every other (unknown) object type render as a task.
  return 'task'
}

/**
 * Convert an ARIS AML (.apc) export to laid-out BPMN 2.0 XML. Returns
 * `{ error }` when the text isn't AML or carries no usable objects, or when
 * layout fails; otherwise `{ xml }` ready for the editor. Never throws.
 */
export async function convertApcToBpmn(text: string): Promise<ApcConversion> {
  if (!/<AML[\s/>]/.test(text)) return { error: 'not-aml' }

  const { objects, edges } = parseAml(text)
  if (objects.length === 0) return { error: 'no-objects' }

  // Map every object id → a sanitized, unique BPMN node id.
  const idMap = new Map<string, string>()
  const taken = new Set<string>()
  for (const o of objects) idMap.set(o.objId, sanitizeId(o.objId, taken))

  // Keep only edges whose BOTH endpoints are known objects.
  const validEdges = edges.filter((e) => idMap.has(e.source) && idMap.has(e.target))

  const inDeg = new Map<string, number>()
  const outDeg = new Map<string, number>()
  for (const e of validEdges) {
    outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1)
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1)
  }

  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()
  const push = (map: Map<string, string[]>, key: string, value: string): void => {
    const list = map.get(key)
    if (list) list.push(value)
    else map.set(key, [value])
  }
  const flows = validEdges.map((e, i) => {
    const id = `flow_${i + 1}`
    const src = idMap.get(e.source) as string
    const tgt = idMap.get(e.target) as string
    push(outgoing, src, id)
    push(incoming, tgt, id)
    return { id, sourceRef: src, targetRef: tgt }
  })

  let out = '<definitions'
  out += ` xmlns="${NS_MODEL}"`
  out += ` xmlns:bpmndi="${NS_BPMNDI}"`
  out += ` xmlns:dc="${NS_DC}"`
  out += ` xmlns:di="${NS_DI}"`
  out += ' id="definitions_1">'
  out += '<process id="Process_1" isExecutable="false">'

  for (const o of objects) {
    const nodeId = idMap.get(o.objId) as string
    // Degree maps are keyed by RAW object id (edges carry raw ids); the
    // incoming/outgoing flow-id maps are keyed by the sanitized node id.
    const type = elementType(o.typeNum, inDeg.get(o.objId) ?? 0, outDeg.get(o.objId) ?? 0)
    const label = o.name && o.name.trim() ? o.name.trim() : o.objId
    let open = `<${type} id="${escapeAttr(nodeId)}" name="${escapeAttr(label)}"`
    const children: string[] = []
    for (const f of incoming.get(nodeId) ?? []) children.push(`<incoming>${escapeText(f)}</incoming>`)
    for (const f of outgoing.get(nodeId) ?? []) children.push(`<outgoing>${escapeText(f)}</outgoing>`)
    if (children.length === 0) out += `${open} />`
    else out += `${open}>${children.join('')}</${type}>`
  }

  for (const f of flows) {
    out += `<sequenceFlow id="${escapeAttr(f.id)}" sourceRef="${escapeAttr(
      f.sourceRef
    )}" targetRef="${escapeAttr(f.targetRef)}" />`
  }

  out += '</process></definitions>'

  try {
    const layouted = await layoutBpmn(out)
    return { xml: layouted }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

// EXPERIMENTAL ARIS (.apc / AML) → BPMN import.
//
// ARIS exports a whole database (or group) as AML — a flat object catalogue
// (`<ObjDef>`: functions, events, rules/operators, plus "satellite" objects
// like persons, application systems, entity types…) and a list of `<Model>`
// diagrams whose `<ObjOcc>` occurrences place those objects on a canvas and
// whose `<CxnOcc>` occurrences draw the connections. This converter turns each
// EPC diagram (`Model.Type="MT_EEPC"`) into ONE laid-out BPMN 2.0 file:
//
//   • control-flow connections (event activates function, function creates
//     event, rule leads to event, …) become sequence flows;
//   • satellite connections (who executes, which system supports, what data
//     goes in/out, who must be informed) become `orbitpm:*` attributes on the
//     flow node they describe — they are metadata, NEVER flow;
//   • AT_NAMEs are bilingual (the org's databases carry Arabic + English) —
//     the requested language becomes `name`, and both locales are preserved
//     as `orbitpm:nameEn` / `orbitpm:nameAr`;
//   • the ARIS layout is kept: occurrence Position/Size map straight onto
//     BPMN DI (see ARIS_UNIT_SCALE); models without geometry fall back to
//     `layoutBpmn` auto-layout;
//   • a function that references a process detailed in another exported model
//     (CT_REFS_TO_2 / CT_IS_PRCS_ORNT_SUPER) becomes a `callActivity` whose
//     `calledElement` is that model's process id — wiring the app's existing
//     drill-down.
//
// The parsing itself lives in ./amlParse and stays deliberately TOLERANT:
// regex/scan based (no DOMParser, so it runs in node unit tests), multiline-
// attribute-safe, and internal-DTD-entity aware. Everything here is
// best-effort by design — a real ARIS file converts to an approximate,
// hand-tidyable diagram, never a byte-perfect round-trip. Never throws.

import { layoutBpmn } from '@app/gen'
import {
  looksLikeAml,
  parseAml,
  pickText,
  type AmlCxn,
  type AmlDatabase,
  type AmlModel,
  type AmlObj,
  type AmlOcc,
  type LocalizedText
} from './amlParse'

export { looksLikeAml }

export type ApcConversion = { xml: string } | { error: string }

/** One converted BPMN file, named per locale like the source model. */
export interface ConvertedModel {
  name: string
  nameAr?: string
  nameEn?: string
  xml: string
}

export type AmlConversion = { files: ConvertedModel[] } | { error: string }

const NS_MODEL = 'http://www.omg.org/spec/BPMN/20100524/MODEL'
const NS_BPMNDI = 'http://www.omg.org/spec/BPMN/20100524/DI'
const NS_DC = 'http://www.omg.org/spec/DD/20100524/DC'
const NS_DI = 'http://www.omg.org/spec/DD/20100524/DI'
// Must stay in sync with ORBITPM_URI in src/org/orbitpmModdle.ts — the app
// registers this namespace as a moddle extension, so the `orbitpm:*`
// attributes emitted here round-trip through the editor.
const NS_ORBITPM = 'http://orbitpm.ae/schema/bpmn/1.0'

/**
 * ARIS occurrence geometry → BPMN DI pixels.
 *
 * The real export stores occurrence Position/Size in ARIS logical units of
 * 1/10 mm: event symbols measure ~554×151, functions ~670×240, rule operators
 * 140×140, and whole EPC canvases run to ~6200×7600 units. Multiplying by
 * 0.25 maps an operator square (140) onto a ~35 px diamond and a function
 * onto a ~168×60 px box — right in bpmn-js's native size range (task 100×80,
 * event 36, gateway 50) — and keeps the largest real canvas under ~2000 px,
 * so the imported diagram is readable without zooming games.
 */
const ARIS_UNIT_SCALE = 0.25

// BPMN renders events as circles and gateways as diamonds, so instead of
// stretching them to the ARIS box (wide hexagons/rectangles) we center a
// standard-sized symbol inside the scaled ARIS bounds.
const EVENT_SIZE = 36
const GATEWAY_SIZE = 50

// XML 1.0 forbids these C0 control chars; strip so a stray one in an AML name
// can't produce invalid BPMN that layoutBpmn/importXML would reject.
const XML_ILLEGAL_CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g

function stripIllegalXmlChars(text: string): string {
  return text.replace(XML_ILLEGAL_CONTROL_CHARS, '')
}

// Newlines/tabs in attribute values must be character-referenced: a literal
// newline would be silently normalized to a space on re-parse, destroying the
// '\n'-joined multi-value attrs (respList, inputs, …).
function escapeAttr(text: string): string {
  return stripIllegalXmlChars(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
    .replace(/\t/g, '&#9;')
}

function escapeText(text: string): string {
  return stripIllegalXmlChars(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
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

// ---------------------------------------------------------------------------
// Object / connection classification
// ---------------------------------------------------------------------------

/** Object types that map onto BPMN flow nodes. */
const FLOW_OBJECT_TYPES = new Set(['OT_FUNC', 'OT_EVT', 'OT_RULE'])

/**
 * Satellite/metadata object types: these must NEVER appear as flow nodes.
 * Their information reaches the BPMN through `orbitpm:*` attributes instead.
 * (Object types outside BOTH lists — exotic or future OT_* — degrade to plain
 * tasks, preserving the converter's old tolerance for unknown objects.)
 */
const METADATA_OBJECT_TYPES = new Set([
  'OT_PERS',
  'OT_PERS_TYPE',
  'OT_POS',
  'OT_ORG_UNIT',
  'OT_GRP',
  'OT_GROUP',
  'OT_PERF',
  'OT_INFO_CARR',
  'OT_ENT_TYPE',
  'OT_APPL_SYS',
  'OT_BUSINESS_RULE',
  'OT_REQUIREMENT',
  'OT_POLICY',
  'OT_CLST',
  'OT_TECH_TRM',
  'OT_DOC',
  'OT_RISK',
  'OT_SCREEN',
  'OT_KNWLDG_CAT'
])

/**
 * Control-flow connection types (the EPC backbone), direction source→target
 * as written in the export:
 *   CT_ACTIV_1        event/rule activates function
 *   CT_CRT_1          function creates event
 *   CT_LEADS_TO_1/2   function leads to rule / rule leads to event
 *   CT_IS_PREDEC_OF_1 function is predecessor of function
 * CT_CRT_OUT_TO ("creates output to") must NOT match the CT_CRT rule — the
 * pattern requires a digit suffix.
 */
function isFlowCxnType(type: string | undefined): boolean {
  if (!type) return true // legacy exports omit the type on plain flow edges
  return (
    /^CT_LEADS_TO/i.test(type) ||
    /^CT_ACTIV/i.test(type) ||
    /^CT_CRT(_\d+)?$/i.test(type) ||
    /^CT_IS_PREDEC_OF/i.test(type)
  )
}

/**
 * "Event is evaluated by rule" — in a real ARIS 10 EPC this connects an
 * OT_EVT to the OT_RULE gateway that weighs it, i.e. it IS part of the
 * control flow (dropping it would leave every such gateway with no inputs).
 * It doubles as decision documentation: the evaluated event's name is also
 * recorded in the gateway's `orbitpm:decisionBasis`.
 */
function isEvalCxnType(type: string | undefined): boolean {
  return !!type && /^CT_IS_EVAL_BY/i.test(type)
}

/** Process-hierarchy connections that can turn a function into a callActivity. */
function isHierarchyCxnType(type: string | undefined): boolean {
  return !!type && (/^CT_REFS_TO/i.test(type) || /^CT_IS_PRCS_ORNT_SUPER/i.test(type))
}

/** The orbitpm attribute a metadata connection lands in. */
type MetaAttr = 'respList' | 'ccList' | 'inputs' | 'outputs' | 'system' | 'decisionBasis'

interface MetaRule {
  match: RegExp
  attr: MetaAttr
  /** Which connection end carries the metadata VALUE (the satellite object);
   *  the attribute attaches to the OPPOSITE (flow-node) end. */
  valueEnd: 'source' | 'target'
}

// Satellite-connection routing, directions verified against the real export:
//   CT_EXEC_1/2            performer  → function   (who executes)
//   CT_MUST_BE_INFO_ABT_1  person     → function   (who is informed/cc'd)
//   CT_SUPP_3              app system → function   (supporting IT system)
//   CT_IS_INP_FOR          entity     → function   (data input)
//   CT_READ_1              function   → entity     (function reads = input)
//   CT_HAS_OUT             function   → entity     (data output)
//   CT_CRT_OUT_TO          function   → info carr. (created output document)
// No reliable role source exists in these exports, so respList entries carry
// the performer's name without a " — role" suffix.
const METADATA_CXN_RULES: MetaRule[] = [
  { match: /^CT_EXEC/i, attr: 'respList', valueEnd: 'source' },
  { match: /^CT_MUST_BE_INFO_ABT/i, attr: 'ccList', valueEnd: 'source' },
  { match: /^CT_SUPP/i, attr: 'system', valueEnd: 'source' },
  { match: /^CT_IS_INP_FOR/i, attr: 'inputs', valueEnd: 'source' },
  { match: /^CT_READ/i, attr: 'inputs', valueEnd: 'target' },
  { match: /^CT_HAS_OUT/i, attr: 'outputs', valueEnd: 'target' },
  { match: /^CT_CRT_OUT_TO/i, attr: 'outputs', valueEnd: 'target' }
]

/** Connections that carry nothing we map (CT_AFFECTS et al.). */
function isIgnoredCxnType(type: string | undefined): boolean {
  return !!type && /^CT_AFFECTS/i.test(type)
}

/** Map a rule occurrence's symbol onto a BPMN gateway element. */
function gatewayTag(symbolNum: string | undefined): string {
  const sym = symbolNum ?? ''
  if (/^ST_OPR_AND/i.test(sym)) return 'parallelGateway'
  // Test OR only after AND/XOR cannot match: "ST_OPR_XOR_1" must stay
  // exclusive — `^ST_OPR_OR` cannot match it, so plain prefix tests suffice.
  if (/^ST_OPR_OR/i.test(sym)) return 'inclusiveGateway'
  return 'exclusiveGateway'
}

// ---------------------------------------------------------------------------
// Per-model conversion planning
// ---------------------------------------------------------------------------

/** A flow node scheduled for emission. */
interface PlanNode {
  def: AmlObj
  bpmnId: string
  /** BPMN element tag; rules resolve to a gateway, functions may upgrade to
   *  callActivity in the hierarchy pass. */
  tag: string
  calledElement?: string
  /** orbitpm metadata gathered from satellite connections (insertion-ordered,
   *  deduped). */
  meta: Map<MetaAttr, string[]>
  incoming: string[]
  outgoing: string[]
  occ?: AmlOcc
}

interface PlanEdge {
  id: string
  source: PlanNode
  target: PlanNode
}

/** One model scheduled for conversion (or the whole-file pseudo model). */
interface ModelPlan {
  model?: AmlModel
  processId: string
  name: LocalizedText
  /** Member defs in document order (flow-capable only → nodes). */
  nodes: Map<string, PlanNode>
  edges: PlanEdge[]
  hasGeometry: boolean
}

/** Push a metadata value onto a node, deduped, insertion-ordered. */
function addMeta(node: PlanNode, attr: MetaAttr, value: string | undefined): void {
  if (!value) return
  const list = node.meta.get(attr)
  if (!list) node.meta.set(attr, [value])
  else if (!list.includes(value)) list.push(value)
}

/** Is this def one we materialize as a flow node? */
function isFlowCapable(def: AmlObj): boolean {
  return FLOW_OBJECT_TYPES.has(def.typeNum) || !METADATA_OBJECT_TYPES.has(def.typeNum)
}

/**
 * Collect a model's members and edge set.
 *
 * Membership is by OCCURRENCE: the model's elements are its ObjOccs' referenced
 * ObjDefs. The edge set is the union of
 *   (a) the model's CxnOccs resolved to their CxnDefs (the drawn connections),
 *   (b) every CxnDef whose BOTH endpoints are members (covers exports whose
 *       occurrence linkage is incomplete — e.g. a shared function whose
 *       satellite connection was only drawn on one of its diagrams).
 * For a file with no <Model> sections at all (the legacy single-EPC .apc
 * shape) the caller passes `model === undefined` and every object becomes a
 * member with all of its connections.
 */
function collectMembers(db: AmlDatabase, model: AmlModel | undefined): {
  members: AmlObj[]
  occByDef: Map<string, AmlOcc>
  cxns: AmlCxn[]
} {
  const members: AmlObj[] = []
  const occByDef = new Map<string, AmlOcc>()
  const memberIds = new Set<string>()
  if (!model) {
    for (const o of db.objects) {
      members.push(o)
      memberIds.add(o.id)
    }
  } else {
    for (const occ of model.occs) {
      const def = db.objectById.get(occ.defId)
      if (!def) continue
      if (!memberIds.has(def.id)) {
        memberIds.add(def.id)
        members.push(def)
      }
      // First occurrence wins for geometry/symbol (no EPC in the verified
      // export places the same flow object twice, so this is exact there).
      if (!occByDef.has(def.id)) occByDef.set(def.id, occ)
    }
  }

  const cxns: AmlCxn[] = []
  const seen = new Set<string>()
  const push = (c: AmlCxn | undefined): void => {
    if (!c) return
    const key = `${c.from} ${c.to} ${c.type ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    cxns.push(c)
  }
  if (model) for (const co of model.cxnOccs) push(co.cxnRef ? db.cxnById.get(co.cxnRef) : undefined)
  for (const m of members) for (const c of m.cxns) if (memberIds.has(c.to)) push(c)
  return { members, occByDef, cxns }
}

/**
 * Build the conversion plan for one model: materialize flow nodes, partition
 * connections into sequence flows vs orbitpm metadata, resolve event kinds
 * and gateway symbols.
 */
function planModel(
  db: AmlDatabase,
  model: AmlModel | undefined,
  processId: string,
  lang: 'en' | 'ar',
  taken: Set<string>
): ModelPlan {
  const { members, occByDef, cxns } = collectMembers(db, model)

  // Materialize flow nodes (satellite objects never become nodes).
  const nodes = new Map<string, PlanNode>()
  for (const def of members) {
    if (!isFlowCapable(def)) continue
    nodes.set(def.id, {
      def,
      bpmnId: sanitizeId(def.id, taken),
      tag: 'task', // provisional; finalized below
      meta: new Map(),
      incoming: [],
      outgoing: [],
      occ: occByDef.get(def.id)
    })
  }

  // Metadata values carry the satellite object's localized name; an unnamed
  // satellite contributes nothing (raw AML ids would be noise in respList &co).
  const displayName = (def: AmlObj): string | undefined => pickText(def.name, lang)

  // Partition connections: control flow vs metadata.
  const flowPairs: { source: PlanNode; target: PlanNode }[] = []
  for (const c of cxns) {
    const srcDef = db.objectById.get(c.from)
    const tgtDef = db.objectById.get(c.to)
    if (!srcDef || !tgtDef) continue // dangling reference — drop
    const srcNode = nodes.get(c.from)
    const tgtNode = nodes.get(c.to)

    // Business-rule links are decision documentation regardless of their CT
    // type: the rule's name lands in decisionBasis on the flow-node end.
    if (srcDef.typeNum === 'OT_BUSINESS_RULE' || tgtDef.typeNum === 'OT_BUSINESS_RULE') {
      const ruleDef = srcDef.typeNum === 'OT_BUSINESS_RULE' ? srcDef : tgtDef
      const flowEnd = srcDef.typeNum === 'OT_BUSINESS_RULE' ? tgtNode : srcNode
      if (flowEnd) addMeta(flowEnd, 'decisionBasis', displayName(ruleDef))
      continue
    }

    if (isIgnoredCxnType(c.type)) continue
    if (isHierarchyCxnType(c.type)) continue // handled by the hierarchy pass

    // "Is evaluated by": control flow into the gateway when both ends are on
    // this diagram (see isEvalCxnType); the evaluated name doubles as the
    // gateway's decision basis. When one end is a satellite object the link
    // degrades to pure decision documentation.
    if (isEvalCxnType(c.type)) {
      if (srcNode && tgtNode) {
        flowPairs.push({ source: srcNode, target: tgtNode })
        const rule = tgtDef.typeNum === 'OT_RULE' ? tgtNode : srcDef.typeNum === 'OT_RULE' ? srcNode : undefined
        const other = rule === tgtNode ? srcDef : tgtDef
        if (rule) addMeta(rule, 'decisionBasis', displayName(other))
      } else {
        const flowEnd = srcNode ?? tgtNode
        const valueDef = srcNode ? tgtDef : srcDef
        if (flowEnd) addMeta(flowEnd, 'decisionBasis', displayName(valueDef))
      }
      continue
    }

    // Satellite metadata → orbitpm attribute on the flow-node end.
    const rule = c.type ? METADATA_CXN_RULES.find((r) => r.match.test(c.type as string)) : undefined
    if (rule) {
      let valueDef = rule.valueEnd === 'source' ? srcDef : tgtDef
      let attachNode = rule.valueEnd === 'source' ? tgtNode : srcNode
      // Graceful flip for reversed exports: if the expected flow end isn't a
      // node here but the opposite end is, swap.
      if (!attachNode) {
        const flipped = rule.valueEnd === 'source' ? srcNode : tgtNode
        if (flipped) {
          attachNode = flipped
          valueDef = rule.valueEnd === 'source' ? tgtDef : srcDef
        }
      }
      if (attachNode) addMeta(attachNode, rule.attr, displayName(valueDef))
      continue
    }

    // Everything that remains is control flow when it connects two flow
    // nodes: the known flow types, untyped edges, and unknown CT_* (keeping
    // the old converter's tolerance for exotic exports). Anything touching a
    // satellite object that no rule above claimed is dropped.
    if (srcNode && tgtNode) flowPairs.push({ source: srcNode, target: tgtNode })
  }

  // Wire flows and degrees.
  const edges: PlanEdge[] = []
  const seenPair = new Set<string>()
  for (const p of flowPairs) {
    const key = `${p.source.bpmnId} ${p.target.bpmnId}`
    if (seenPair.has(key)) continue // parallel duplicates collapse to one flow
    seenPair.add(key)
    const id = `flow_${edges.length + 1}`
    edges.push({ id, source: p.source, target: p.target })
    p.source.outgoing.push(id)
    p.target.incoming.push(id)
  }

  // Finalize element tags now that degrees are known.
  for (const node of nodes.values()) {
    const t = node.def.typeNum
    if (t === 'OT_EVT') {
      if (node.incoming.length === 0) node.tag = 'startEvent'
      else if (node.outgoing.length === 0) node.tag = 'endEvent'
      else node.tag = 'intermediateThrowEvent'
    } else if (t === 'OT_RULE') {
      node.tag = gatewayTag(node.occ?.symbolNum)
    } else {
      node.tag = 'task' // OT_FUNC and tolerated unknown types
    }
  }

  // The model's OWN layout is used only when it is complete: every node needs
  // Position AND Size, otherwise a half-placed diagram would render broken —
  // those models go through layoutBpmn instead.
  const nodeList = [...nodes.values()]
  const hasGeometry =
    nodeList.length > 0 &&
    nodeList.every(
      (n) => n.occ && n.occ.x !== undefined && n.occ.y !== undefined && n.occ.w !== undefined && n.occ.h !== undefined
    )

  return {
    model,
    processId,
    name: model?.name ?? { others: [] },
    nodes,
    edges,
    hasGeometry
  }
}

/**
 * Upgrade functions that reference another converted model's content to
 * callActivities: a member OT_FUNC carrying CT_REFS_TO_2 /
 * CT_IS_PRCS_ORNT_SUPER to an object occurring in ANOTHER plan links to that
 * plan's process id (the app's drill-down follows `calledElement`).
 */
function wireHierarchy(plans: ModelPlan[]): void {
  for (const plan of plans) {
    for (const node of plan.nodes.values()) {
      if (node.def.typeNum !== 'OT_FUNC') continue
      for (const c of node.def.cxns) {
        if (!isHierarchyCxnType(c.type)) continue
        const targetPlan = plans.find((p) => p !== plan && p.nodes.has(c.to))
        if (targetPlan) {
          node.tag = 'callActivity'
          node.calledElement = targetPlan.processId
          break
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// XML emission
// ---------------------------------------------------------------------------

const META_ATTR_ORDER: MetaAttr[] = ['respList', 'ccList', 'inputs', 'outputs', 'system', 'decisionBasis']

/** Serialize a node's orbitpm attributes (names + satellite metadata). */
function orbitpmAttrs(node: PlanNode): string {
  let out = ''
  if (node.def.name.en) out += ` orbitpm:nameEn="${escapeAttr(node.def.name.en)}"`
  if (node.def.name.ar) out += ` orbitpm:nameAr="${escapeAttr(node.def.name.ar)}"`
  for (const attr of META_ATTR_ORDER) {
    const values = node.meta.get(attr)
    if (!values || values.length === 0) continue
    // decisionBasis reads as prose → '; '; the list attrs are '\n'-joined
    // multi-value strings (escapeAttr turns the newline into &#10;).
    const joined = attr === 'decisionBasis' ? values.join('; ') : values.join('\n')
    out += ` orbitpm:${attr}="${escapeAttr(joined)}"`
  }
  return out
}

interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

/** Scaled DI bounds for a node: tasks keep the ARIS box, events/gateways get
 *  a standard-size symbol centered inside it. */
function nodeBounds(node: PlanNode): Bounds {
  const occ = node.occ as AmlOcc // hasGeometry guarantees presence
  const x = (occ.x as number) * ARIS_UNIT_SCALE
  const y = (occ.y as number) * ARIS_UNIT_SCALE
  const w = (occ.w as number) * ARIS_UNIT_SCALE
  const h = (occ.h as number) * ARIS_UNIT_SCALE
  let size: number | undefined
  if (node.tag.endsWith('Event')) size = EVENT_SIZE
  else if (node.tag.endsWith('Gateway')) size = GATEWAY_SIZE
  if (size !== undefined) {
    return {
      x: Math.round(x + w / 2 - size / 2),
      y: Math.round(y + h / 2 - size / 2),
      w: size,
      h: size
    }
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
}

/** Emit one plan as a complete BPMN file (own DI or auto-layout). */
async function emitModel(plan: ModelPlan, lang: 'en' | 'ar'): Promise<ConvertedModel | undefined> {
  const nodeList = [...plan.nodes.values()]
  if (nodeList.length === 0) return undefined

  const procNameEn = plan.name.en
  const procNameAr = plan.name.ar
  const procName = pickText(plan.name, lang)

  let out = '<definitions'
  out += ` xmlns="${NS_MODEL}"`
  out += ` xmlns:bpmndi="${NS_BPMNDI}"`
  out += ` xmlns:dc="${NS_DC}"`
  out += ` xmlns:di="${NS_DI}"`
  out += ` xmlns:orbitpm="${NS_ORBITPM}"`
  out += ' id="definitions_1">'
  out += `<process id="${escapeAttr(plan.processId)}"`
  if (procName) out += ` name="${escapeAttr(procName)}"`
  out += ' isExecutable="false"'
  out += ` orbitpm:activeLang="${lang}"`
  if (procNameEn) out += ` orbitpm:nameEn="${escapeAttr(procNameEn)}"`
  if (procNameAr) out += ` orbitpm:nameAr="${escapeAttr(procNameAr)}"`
  out += '>'

  for (const node of nodeList) {
    // Unnamed objects (ARIS rules usually carry no AT_NAME) get NO name
    // attribute — an id-as-label would clutter every gateway diamond.
    const label = pickText(node.def.name, lang)
    let open = `<${node.tag} id="${escapeAttr(node.bpmnId)}"`
    if (label) open += ` name="${escapeAttr(label)}"`
    if (node.calledElement) open += ` calledElement="${escapeAttr(node.calledElement)}"`
    open += orbitpmAttrs(node)
    const children: string[] = []
    for (const f of node.incoming) children.push(`<incoming>${escapeText(f)}</incoming>`)
    for (const f of node.outgoing) children.push(`<outgoing>${escapeText(f)}</outgoing>`)
    if (children.length === 0) out += `${open} />`
    else out += `${open}>${children.join('')}</${node.tag}>`
  }

  for (const e of plan.edges) {
    out += `<sequenceFlow id="${escapeAttr(e.id)}" sourceRef="${escapeAttr(
      e.source.bpmnId
    )}" targetRef="${escapeAttr(e.target.bpmnId)}" />`
  }

  out += '</process>'

  if (plan.hasGeometry) {
    // The ARIS diagram's own layout, scaled — shapes from occurrence bounds,
    // edges as straight center→center lines (bpmn-js renders those fine and
    // the user can re-route them like any manual edge).
    const bounds = new Map<PlanNode, Bounds>()
    for (const n of nodeList) bounds.set(n, nodeBounds(n))
    out += '<bpmndi:BPMNDiagram id="BPMNDiagram_1">'
    out += `<bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${escapeAttr(plan.processId)}">`
    for (const n of nodeList) {
      const b = bounds.get(n) as Bounds
      const marker = n.tag === 'exclusiveGateway' ? ' isMarkerVisible="true"' : ''
      out += `<bpmndi:BPMNShape id="BPMNShape_${escapeAttr(n.bpmnId)}" bpmnElement="${escapeAttr(n.bpmnId)}"${marker}>`
      out += `<dc:Bounds x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" />`
      out += '</bpmndi:BPMNShape>'
    }
    for (const e of plan.edges) {
      const sb = bounds.get(e.source) as Bounds
      const tb = bounds.get(e.target) as Bounds
      out += `<bpmndi:BPMNEdge id="BPMNEdge_${escapeAttr(e.id)}" bpmnElement="${escapeAttr(e.id)}">`
      out += `<di:waypoint x="${Math.round(sb.x + sb.w / 2)}" y="${Math.round(sb.y + sb.h / 2)}" />`
      out += `<di:waypoint x="${Math.round(tb.x + tb.w / 2)}" y="${Math.round(tb.y + tb.h / 2)}" />`
      out += '</bpmndi:BPMNEdge>'
    }
    out += '</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></definitions>'
    return finishModel(plan, lang, out)
  }

  // No usable geometry → semantic-only document + auto-layout.
  out += '</definitions>'
  const layouted = await layoutBpmn(out)
  return finishModel(plan, lang, layouted)
}

function finishModel(plan: ModelPlan, lang: 'en' | 'ar', xml: string): ConvertedModel {
  const name = pickText(plan.name, lang) ?? plan.model?.procCode ?? plan.processId
  const file: ConvertedModel = { name, xml }
  if (plan.name.en) file.nameEn = plan.name.en
  if (plan.name.ar) file.nameAr = plan.name.ar
  return file
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert an ARIS AML export into one BPMN file per EPC model
 * (`Model.Type="MT_EEPC"`). Value-chain overview models
 * (MT_VAL_ADD_CHN_DGM et al.) are not flow-converted; exports with no
 * `<Model>` sections at all (the legacy minimal .apc shape) convert as a
 * single flat process. Error codes: 'not-aml' (sniff failed), 'no-objects'
 * (nothing convertible in the catalogue), 'no-models' (models exist but none
 * is a convertible EPC). Never throws.
 */
export async function convertAmlToBpmnFiles(
  text: string,
  opts?: { lang?: 'en' | 'ar' }
): Promise<AmlConversion> {
  try {
    if (!looksLikeAml(text)) return { error: 'not-aml' }
    const lang = opts?.lang ?? 'en'
    const db = parseAml(text)
    if (db.objects.length === 0) return { error: 'no-objects' }

    const epcModels = db.models.filter((m) => m.type === 'MT_EEPC')
    if (db.models.length > 0 && epcModels.length === 0) return { error: 'no-models' }

    // Process ids are assigned up front, ALL before any model is planned
    // (AT_PROC_CODE when the model carries one, else the Model.ID; globally
    // deduped) so callActivity links can point across files regardless of
    // emission order — and so per-file node ids can be seeded against the
    // complete process-id set and can never shadow a calledElement target.
    const takenProcessIds = new Set<string>()
    const scheduled: { model?: AmlModel; processId: string }[] =
      epcModels.length === 0
        ? // Legacy flat export: everything into one process.
          [{ model: undefined, processId: sanitizeId('Process_1', takenProcessIds) }]
        : epcModels.map((model) => ({
            model,
            processId: sanitizeId(model.procCode?.trim() || model.id, takenProcessIds)
          }))
    const plans: ModelPlan[] = scheduled.map(({ model, processId }) =>
      planModel(db, model, processId, lang, new Set(takenProcessIds))
    )

    wireHierarchy(plans)

    const files: ConvertedModel[] = []
    for (const plan of plans) {
      const file = await emitModel(plan, lang)
      if (file) files.push(file)
    }
    if (files.length === 0) return { error: db.models.length > 0 ? 'no-models' : 'no-objects' }
    return { files }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Legacy single-file wrapper (the App's `.apc` import path): converts the
 * export and returns the FIRST resulting BPMN file. Same error codes as
 * `convertAmlToBpmnFiles`. Never throws.
 */
export async function convertApcToBpmn(text: string): Promise<ApcConversion> {
  const result = await convertAmlToBpmnFiles(text)
  if ('error' in result) return { error: result.error }
  return { xml: result.files[0].xml }
}

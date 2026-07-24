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
//   • EVERY diagram is re-laid out by ./epcLayout (deterministic layered
//     layout, decoration-margin aware); the ARIS occurrence Position survives
//     only as an ordering HINT, never as output coordinates;
//   • a function that references a process detailed in another exported model
//     — via the `LinkedModels.IdRefs` model assignment (primary) or a
//     CT_REFS_TO_2 / CT_IS_PRCS_ORNT_SUPER connection (legacy secondary) —
//     becomes a `callActivity` whose `calledElement` is that model's process
//     id, wiring the app's existing drill-down;
//   • when at least one EPC converts, each value-chain overview model
//     (MT_VAL_ADD_CHN_DGM) is emitted too, LAST: its leaf chevrons (container
//     chevrons and satellites excluded) become one task/callActivity chain —
//     explicit CT_IS_PREDEC_OF* edges when the map has them, else the drawn
//     reading order — and chevrons whose object occurs inside a converted EPC
//     link to that EPC (tertiary, overview-only rule).
//
// The parsing itself lives in ./amlParse and stays deliberately TOLERANT:
// regex/scan based (no DOMParser, so it runs in node unit tests), multiline-
// attribute-safe, and internal-DTD-entity aware. Everything here is
// best-effort by design — a real ARIS file converts to an approximate,
// hand-tidyable diagram, never a byte-perfect round-trip. Never throws.

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
import { emitLayoutDi, layoutEpc, type LayoutEdge, type LayoutNode, type Orientation } from './epcLayout'

export { looksLikeAml }

export type ApcConversion = { xml: string } | { error: string }

/** One converted BPMN file, named per locale like the source model. */
export interface ConvertedModel {
  name: string
  nameAr?: string
  nameEn?: string
  xml: string
  /** The file's BPMN process id (callActivity calledElement target). */
  processId: string
  /** 'epc' = one process diagram; 'overview' = the value-chain map. */
  kind: 'epc' | 'overview'
}

export type AmlConversion =
  | {
      files: ConvertedModel[]
      /** Suggested workspace folder for a multi-file import: the first
       *  value-chain overview's name in the active language, else the
       *  export's DatabaseName. */
      folderName?: string
    }
  | { error: string }

const NS_MODEL = 'http://www.omg.org/spec/BPMN/20100524/MODEL'
const NS_BPMNDI = 'http://www.omg.org/spec/BPMN/20100524/DI'
const NS_DC = 'http://www.omg.org/spec/DD/20100524/DC'
const NS_DI = 'http://www.omg.org/spec/DD/20100524/DI'
// Must stay in sync with ORBITPM_URI in src/org/orbitpmModdle.ts — the app
// registers this namespace as a moddle extension, so the `orbitpm:*`
// attributes emitted here round-trip through the editor.
const NS_ORBITPM = 'http://orbitpm.ae/schema/bpmn/1.0'

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
  /** 'epc' = flow diagram; 'overview' = value-chain map (chevron chain). */
  kind: 'epc' | 'overview'
  name: LocalizedText
  /** Member defs in document order (flow-capable only → nodes). */
  nodes: Map<string, PlanNode>
  edges: PlanEdge[]
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

  return {
    model,
    processId,
    kind: 'epc',
    name: model?.name ?? { others: [] },
    nodes,
    edges
  }
}

/**
 * Order overview leaves the way the map reads: rows top→bottom (bucketed by
 * vertical occurrence overlap), left→right inside a row; leaves without a
 * placed occurrence come last, by object id. Pure and deterministic.
 */
function rowMajor(list: PlanNode[]): PlanNode[] {
  const placed = list.filter((n) => n.occ && n.occ.x !== undefined && n.occ.y !== undefined)
  const unplaced = list
    .filter((n) => !(n.occ && n.occ.x !== undefined && n.occ.y !== undefined))
    .sort((a, b) => (a.def.id < b.def.id ? -1 : a.def.id > b.def.id ? 1 : 0))
  placed.sort((a, b) => {
    const ya = (a.occ as AmlOcc).y as number
    const yb = (b.occ as AmlOcc).y as number
    if (ya !== yb) return ya - yb
    return a.def.id < b.def.id ? -1 : a.def.id > b.def.id ? 1 : 0
  })
  const buckets: PlanNode[][] = []
  let bucketBottom = -Infinity
  for (const n of placed) {
    const occ = n.occ as AmlOcc
    const y = occ.y as number
    const h = occ.h ?? 0
    if (y >= bucketBottom || buckets.length === 0) {
      buckets.push([n])
      bucketBottom = y + h
    } else {
      buckets[buckets.length - 1].push(n)
      bucketBottom = Math.max(bucketBottom, y + h)
    }
  }
  const ordered: PlanNode[] = []
  for (const bucket of buckets) {
    bucket.sort((a, b) => {
      const xa = (a.occ as AmlOcc).x as number
      const xb = (b.occ as AmlOcc).x as number
      if (xa !== xb) return xa - xb
      return a.def.id < b.def.id ? -1 : a.def.id > b.def.id ? 1 : 0
    })
    ordered.push(...bucket)
  }
  ordered.push(...unplaced)
  return ordered
}

/**
 * Build the conversion plan for one value-chain overview (MT_VAL_ADD_CHN_DGM):
 * the map's LEAF chevrons become one task/callActivity chain.
 *
 *   • Containers ("Animal Welfare" → "Phase 1" → chevrons) are excluded: any
 *     member with an outgoing CT_IS_PRCS_ORNT_SUPER / CT_REFS_TO* connection
 *     to ANOTHER member of this same map is a grouping chevron, not a step.
 *   • Satellites (OT_PERF service tiles etc.) are excluded as everywhere else.
 *   • The chain uses explicit CT_IS_PREDEC_OF* connections between leaves
 *     when the map draws them; real exports usually don't, so the fallback
 *     chains the leaves in drawn reading order (rowMajor above).
 *   • Chevrons stay plain tasks here — wireHierarchy upgrades the ones that
 *     resolve to a converted model (LinkedModels / legacy connection / the
 *     overview-only "occurs inside a converted EPC" rule) to callActivities.
 */
function planOverview(db: AmlDatabase, model: AmlModel, processId: string, taken: Set<string>): ModelPlan {
  const { members, occByDef } = collectMembers(db, model)
  const memberIds = new Set(members.map((m) => m.id))

  const containerIds = new Set<string>()
  for (const m of members) {
    for (const c of m.cxns) {
      if (!isHierarchyCxnType(c.type)) continue
      if (c.to !== m.id && memberIds.has(c.to)) {
        containerIds.add(m.id)
        break
      }
    }
  }

  const nodes = new Map<string, PlanNode>()
  for (const def of members) {
    if (!isFlowCapable(def)) continue
    if (containerIds.has(def.id)) continue
    nodes.set(def.id, {
      def,
      bpmnId: sanitizeId(def.id, taken),
      tag: 'task',
      meta: new Map(),
      incoming: [],
      outgoing: [],
      occ: occByDef.get(def.id)
    })
  }

  // Explicit chaining first; drawn reading order as the fallback.
  const pairs: { source: PlanNode; target: PlanNode }[] = []
  for (const def of members) {
    const srcNode = nodes.get(def.id)
    if (!srcNode) continue
    for (const c of def.cxns) {
      if (!c.type || !/^CT_IS_PREDEC_OF/i.test(c.type)) continue
      const tgtNode = nodes.get(c.to)
      if (!tgtNode || tgtNode === srcNode) continue
      pairs.push({ source: srcNode, target: tgtNode })
    }
  }
  if (pairs.length === 0) {
    const ordered = rowMajor([...nodes.values()])
    for (let i = 0; i + 1 < ordered.length; i++) {
      pairs.push({ source: ordered[i], target: ordered[i + 1] })
    }
  }

  const edges: PlanEdge[] = []
  const seenPair = new Set<string>()
  for (const p of pairs) {
    const key = p.source.bpmnId + '\u0000' + p.target.bpmnId
    if (seenPair.has(key)) continue
    seenPair.add(key)
    const id = `flow_${edges.length + 1}`
    edges.push({ id, source: p.source, target: p.target })
    p.source.outgoing.push(id)
    p.target.incoming.push(id)
  }

  return {
    model,
    processId,
    kind: 'overview',
    name: model.name,
    nodes,
    edges
  }
}

/**
 * Upgrade functions that reference another converted model to callActivities
 * (the app's drill-down follows `calledElement`). Three rules, in order:
 *
 *   1. PRIMARY — model assignment: the def's `LinkedModels.IdRefs` names a
 *      converted model's Model.ID (how ARIS 10 links a chevron to its EPC).
 *   2. SECONDARY — legacy connection: the def carries CT_REFS_TO* /
 *      CT_IS_PRCS_ORNT_SUPER to an object that occurs in another plan
 *      (`plans` lists EPCs before overviews, so an EPC target wins).
 *   3. TERTIARY, overview-only — occurrence: a leaf chevron whose def OCCURS
 *      inside a converted EPC links to that EPC even without any explicit
 *      assignment/connection.
 *
 * Self-loop guards throughout: a plan never links to itself, and a node whose
 * resolved target IS its own process stays a plain task.
 */
function wireHierarchy(plans: ModelPlan[]): void {
  const planByModelId = new Map<string, ModelPlan>()
  for (const p of plans) if (p.model) planByModelId.set(p.model.id, p)
  // Def id → the (first) EPC plan whose diagram contains it.
  const epcPlanByDefId = new Map<string, ModelPlan>()
  for (const p of plans) {
    if (p.kind !== 'epc') continue
    for (const defId of p.nodes.keys()) {
      if (!epcPlanByDefId.has(defId)) epcPlanByDefId.set(defId, p)
    }
  }

  for (const plan of plans) {
    for (const node of plan.nodes.values()) {
      if (node.def.typeNum !== 'OT_FUNC') continue
      let target: ModelPlan | undefined

      // 1) Model assignment (first resolvable ref wins, document order).
      for (const modelId of node.def.linkedModelIds) {
        const p = planByModelId.get(modelId)
        if (p && p !== plan) {
          target = p
          break
        }
      }

      // 2) Legacy hierarchy connection.
      if (!target) {
        for (const c of node.def.cxns) {
          if (!isHierarchyCxnType(c.type)) continue
          const p = plans.find((q) => q !== plan && q.nodes.has(c.to))
          if (p) {
            target = p
            break
          }
        }
      }

      // 3) Overview chevron whose object occurs inside a converted EPC.
      if (!target && plan.kind === 'overview') {
        const p = epcPlanByDefId.get(node.def.id)
        if (p && p !== plan) target = p
      }

      if (target && target.processId !== plan.processId) {
        node.tag = 'callActivity'
        node.calledElement = target.processId
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

/**
 * Bridge a plan into ./epcLayout's input model: emit tag + display label +
 * present orbitpm metadata (reserved decoration margins) + the ARIS occurrence
 * Position as an ordering hint.
 */
function layoutInputOf(
  plan: ModelPlan,
  lang: 'en' | 'ar'
): { layoutNodes: LayoutNode[]; layoutEdges: LayoutEdge[] } {
  const layoutNodes: LayoutNode[] = []
  for (const node of plan.nodes.values()) {
    const attrs: { [K in MetaAttr]?: string } = {}
    for (const [attr, values] of node.meta) {
      if (values.length === 0) continue
      attrs[attr] = attr === 'decisionBasis' ? values.join('; ') : values.join('\n')
    }
    const layoutNode: LayoutNode = { id: node.bpmnId, tag: node.tag, attrs }
    const label = pickText(node.def.name, lang)
    if (label) layoutNode.label = label
    if (node.occ && node.occ.x !== undefined && node.occ.y !== undefined) {
      layoutNode.hint = { x: node.occ.x, y: node.occ.y }
    }
    layoutNodes.push(layoutNode)
  }
  const layoutEdges: LayoutEdge[] = plan.edges.map((e) => ({
    id: e.id,
    source: e.source.bpmnId,
    target: e.target.bpmnId
  }))
  return { layoutNodes, layoutEdges }
}

/** Emit one plan as a complete BPMN file (single path: layered auto-layout). */
function emitModel(plan: ModelPlan, lang: 'en' | 'ar', orientation: Orientation): ConvertedModel | undefined {
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

  // ONE layout path for every model: the deterministic layered engine. The
  // ARIS occurrence coordinates only survive as ordering hints inside it.
  const { layoutNodes, layoutEdges } = layoutInputOf(plan, lang)
  const layout = layoutEpc(layoutNodes, layoutEdges, { orientation })
  out += emitLayoutDi(plan.processId, layoutNodes, layoutEdges, layout, escapeAttr)
  out += '</definitions>'
  return finishModel(plan, lang, out)
}

function finishModel(plan: ModelPlan, lang: 'en' | 'ar', xml: string): ConvertedModel {
  const name = pickText(plan.name, lang) ?? plan.model?.procCode ?? plan.processId
  const file: ConvertedModel = { name, xml, processId: plan.processId, kind: plan.kind }
  if (plan.name.en) file.nameEn = plan.name.en
  if (plan.name.ar) file.nameAr = plan.name.ar
  return file
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert an ARIS AML export into one BPMN file per EPC model
 * (`Model.Type="MT_EEPC"`), plus — whenever at least one EPC converted — one
 * overview file per value-chain map (MT_VAL_ADD_CHN_DGM), appended LAST so
 * `files[0]` is always an EPC. Exports with no `<Model>` sections at all (the
 * legacy minimal .apc shape) convert as a single flat process. A successful
 * multi-model conversion also suggests a `folderName` (the first overview's
 * name in the active language, else the export's DatabaseName). Error codes:
 * 'not-aml' (sniff failed), 'no-objects' (nothing convertible in the
 * catalogue), 'no-models' (models exist but none is a convertible EPC).
 * Never throws.
 */
export async function convertAmlToBpmnFiles(
  text: string,
  opts?: { lang?: 'en' | 'ar'; orientation?: Orientation }
): Promise<AmlConversion> {
  try {
    if (!looksLikeAml(text)) return { error: 'not-aml' }
    const lang = opts?.lang ?? 'en'
    const orientation = opts?.orientation ?? 'vertical'
    const db = parseAml(text)
    if (db.objects.length === 0) return { error: 'no-objects' }

    const epcModels = db.models.filter((m) => m.type === 'MT_EEPC')
    if (db.models.length > 0 && epcModels.length === 0) return { error: 'no-models' }

    // Overviews convert only alongside at least one EPC (a lone value-chain
    // map keeps the historical 'no-models' outcome above).
    const overviewModels = epcModels.length > 0 ? db.models.filter((m) => m.type === 'MT_VAL_ADD_CHN_DGM') : []

    // Process ids are assigned up front, ALL before any model is planned
    // (AT_PROC_CODE when the model carries one, else the Model.ID; globally
    // deduped) so callActivity links can point across files regardless of
    // emission order — and so per-file node ids can be seeded against the
    // complete process-id set and can never shadow a calledElement target.
    // EPC ids first: theirs stay stable whether or not overviews exist.
    const takenProcessIds = new Set<string>()
    const scheduledEpc: { model?: AmlModel; processId: string }[] =
      epcModels.length === 0
        ? // Legacy flat export: everything into one process.
          [{ model: undefined, processId: sanitizeId('Process_1', takenProcessIds) }]
        : epcModels.map((model) => ({
            model,
            processId: sanitizeId(model.procCode?.trim() || model.id, takenProcessIds)
          }))
    const scheduledOverview = overviewModels.map((model) => ({
      model,
      processId: sanitizeId(model.procCode?.trim() || model.id, takenProcessIds)
    }))

    const plans: ModelPlan[] = [
      ...scheduledEpc.map(({ model, processId }) => planModel(db, model, processId, lang, new Set(takenProcessIds))),
      ...scheduledOverview.map(({ model, processId }) =>
        planOverview(db, model, processId, new Set(takenProcessIds))
      )
    ]

    wireHierarchy(plans)

    const epcFiles: ConvertedModel[] = []
    const overviewFiles: ConvertedModel[] = []
    for (const plan of plans) {
      const file = emitModel(plan, lang, orientation)
      if (!file) continue
      if (plan.kind === 'overview') overviewFiles.push(file)
      else epcFiles.push(file)
    }
    // The overview only ships when a real EPC converted with it.
    if (epcFiles.length === 0) return { error: db.models.length > 0 ? 'no-models' : 'no-objects' }
    const files = [...epcFiles, ...overviewFiles]

    const firstOverview = overviewModels.length > 0 ? overviewModels[0] : undefined
    const folderName = (firstOverview ? pickText(firstOverview.name, lang) : undefined) ?? db.databaseName
    return folderName ? { files, folderName } : { files }
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

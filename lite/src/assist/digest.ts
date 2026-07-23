// Per-process "digest" model for the OrbitPM Lite process assistant.
//
// A digest is a compact, LLM- and retrieval-friendly summary of a single BPMN
// process parsed straight from its XML with bpmn-moddle (pure JS, runs in the
// browser AND in node unit tests — no bpmn-js / DOM required). The digest keeps
// only what a "what happens next / who is responsible" assistant needs: the
// ordered steps, their owners / channels / CC targets, the branch conditions,
// the process trigger, free-text notes, and the set of sub-processes it calls.
//
// Foreign OrbitPM metadata is carried on elements as namespaced attributes
// (e.g. `orbitpm:owner`). bpmn-moddle exposes those on `element.$attrs` keyed
// by whatever prefix the document declared for the OrbitPM namespace — usually
// `orbitpm:` but not guaranteed — so every read falls back to matching the
// attribute local-name (`endsWith(':owner')`) regardless of prefix.

// bpmn-moddle ships no TypeScript types and, resolving to plain JS, cannot be
// augmented via `declare module` from a module file — and this is the only file
// importing it, so there is no shim in the (non-mine) ambient.d.ts. Suppress the
// untyped-import diagnostic on this one line, then re-attach a precise local
// type via BpmnModdle below so every downstream use stays fully typed.
// @ts-ignore -- untyped third-party module (bpmn-moddle)
import BpmnModdleUntyped from 'bpmn-moddle'

interface ModdleInstance {
  fromXML(xml: string, typeName?: string): Promise<{ rootElement?: unknown }>
}
const BpmnModdle = BpmnModdleUntyped as unknown as { new (options?: unknown): ModdleInstance }

export interface DigestStep {
  id: string
  name: string
  /** Local BPMN type name without the `bpmn:` prefix, e.g. `Task`, `ExclusiveGateway`, `StartEvent`. */
  type: string
  owner?: string
  ownerRole?: string
  channel?: string
  channelDetail?: string
  ccTo?: string
  kind?: string
  /** For a callActivity: the `calledElement` process id it invokes. */
  calledProcess?: string
  nexts: Array<{ targetId: string; condition?: string }>
}

export interface ProcessDigest {
  relPath: string
  folder: string
  processId: string
  processName: string
  trigger?: { type: string; service?: string; detail?: string }
  steps: DigestStep[]
  notes: string[]
  callsTo: string[]
}

// --- moddle shapes (structural; bpmn-moddle ships loose `any`-ish types) -----

interface ModdleElement {
  $type: string
  id?: string
  name?: string
  text?: string
  calledElement?: string
  $attrs?: Record<string, string>
  sourceRef?: ModdleElement
  targetRef?: ModdleElement
  outgoing?: ModdleElement[]
  flowElements?: ModdleElement[]
  artifacts?: ModdleElement[]
}

// --- attribute helpers -------------------------------------------------------

/**
 * Read a namespaced OrbitPM attribute local-name off a moddle element's
 * `$attrs`. Prefers the conventional `orbitpm:<local>` key, then falls back to
 * ANY declared-prefix key ending in `:<local>` (or the bare local-name). Empty
 * strings are treated as absent.
 */
function readAttr(el: ModdleElement, local: string): string | undefined {
  const attrs = el.$attrs
  if (!attrs) return undefined
  const direct = attrs['orbitpm:' + local]
  if (direct != null && direct !== '') return direct
  const suffix = ':' + local
  for (const key of Object.keys(attrs)) {
    if (key === local || key.endsWith(suffix)) {
      const v = attrs[key]
      if (v != null && v !== '') return v
    }
  }
  return undefined
}

// --- type / name helpers -----------------------------------------------------

/** Strip the `bpmn:` (or any) prefix, leaving the local type name. */
function localType(type: string): string {
  const idx = type.indexOf(':')
  return idx >= 0 ? type.slice(idx + 1) : type
}

/** Split a CamelCase type name into spaced words: `CallActivity` -> `Call Activity`. */
function humanizeType(type: string): string {
  return type.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
}

/** Turn a file base name into a readable process name: `employee_exit.bpmn` -> `employee exit`. */
function humanizeFileName(relPath: string): string {
  const base = relPath.split('/').pop() ?? relPath
  const noExt = base.replace(/\.bpmn$/i, '')
  return noExt
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Enclosing folder of a workspace-relative path (`''` at the root). */
function folderOf(relPath: string): string {
  const i = relPath.lastIndexOf('/')
  return i >= 0 ? relPath.slice(0, i) : ''
}

/** Display name for a flow node, with type-appropriate fallbacks when unnamed. */
function nameFor(el: ModdleElement, lt: string): string {
  const raw = typeof el.name === 'string' ? el.name.trim() : ''
  if (raw) return raw
  if (lt === 'StartEvent') return 'Start'
  if (lt === 'EndEvent') return 'End'
  if (lt.endsWith('Gateway')) return 'Decision'
  return humanizeType(lt)
}

// Flow-element types that are NOT steps (connections / annotations / data /
// swimlane containers). Everything else in `flowElements` is a step.
const NON_STEP_TYPES = new Set([
  'SequenceFlow',
  'Association',
  'TextAnnotation',
  'Group',
  'DataObject',
  'DataObjectReference',
  'DataStoreReference',
  'Lane',
  'LaneSet'
])

function isStepElement(el: ModdleElement): boolean {
  return !NON_STEP_TYPES.has(localType(el.$type))
}

// --- core --------------------------------------------------------------------

/**
 * Parse a single BPMN document into a {@link ProcessDigest} for its first
 * process, or `null` when the XML cannot be parsed or contains no process.
 * Never throws — every failure path resolves to `null`.
 */
export async function buildDigest(relPath: string, xml: string): Promise<ProcessDigest | null> {
  try {
    const moddle = new BpmnModdle()
    const { rootElement } = (await moddle.fromXML(xml)) as { rootElement: ModdleElement & { rootElements?: ModdleElement[] } }
    const roots = rootElement?.rootElements ?? []
    const process = roots.find((e) => e.$type === 'bpmn:Process')
    if (!process) return null

    const flowElements = process.flowElements ?? []
    const stepEls = flowElements.filter(isStepElement).filter((e) => typeof e.id === 'string')

    // Build steps keyed by id (file order for now — reordered by BFS below).
    const byId = new Map<string, ModdleElement>()
    for (const el of stepEls) byId.set(el.id as string, el)

    const makeStep = (el: ModdleElement): DigestStep => {
      const lt = localType(el.$type)
      const nexts: Array<{ targetId: string; condition?: string }> = []
      for (const flow of el.outgoing ?? []) {
        const targetId = flow.targetRef?.id
        if (!targetId) continue
        const condRaw = typeof flow.name === 'string' ? flow.name.trim() : ''
        nexts.push(condRaw ? { targetId, condition: condRaw } : { targetId })
      }
      const step: DigestStep = {
        id: el.id as string,
        name: nameFor(el, lt),
        type: lt,
        nexts
      }
      const owner = readAttr(el, 'owner')
      if (owner) step.owner = owner
      const ownerRole = readAttr(el, 'ownerRole')
      if (ownerRole) step.ownerRole = ownerRole
      const channel = readAttr(el, 'channel')
      if (channel) step.channel = channel
      const channelDetail = readAttr(el, 'channelDetail')
      if (channelDetail) step.channelDetail = channelDetail
      const ccTo = readAttr(el, 'ccTo')
      if (ccTo) step.ccTo = ccTo
      const kind = readAttr(el, 'kind')
      if (kind) step.kind = kind
      if (lt === 'CallActivity') {
        const called = typeof el.calledElement === 'string' ? el.calledElement.trim() : ''
        if (called) step.calledProcess = called
      }
      return step
    }

    const stepById = new Map<string, DigestStep>()
    for (const el of stepEls) stepById.set(el.id as string, makeStep(el))

    // BFS order from the start event(s) over sequence flows; unreachable nodes
    // appended in file order.
    const startEls = stepEls.filter((e) => localType(e.$type) === 'StartEvent')
    const orderedIds: string[] = []
    const seen = new Set<string>()
    const queue: string[] = startEls.map((e) => e.id as string)
    while (queue.length) {
      const id = queue.shift() as string
      if (seen.has(id)) continue
      seen.add(id)
      orderedIds.push(id)
      const el = byId.get(id)
      for (const flow of el?.outgoing ?? []) {
        const targetId = flow.targetRef?.id
        if (targetId && byId.has(targetId) && !seen.has(targetId)) queue.push(targetId)
      }
    }
    for (const el of stepEls) {
      const id = el.id as string
      if (!seen.has(id)) orderedIds.push(id)
    }

    const steps = orderedIds.map((id) => stepById.get(id)).filter((s): s is DigestStep => !!s)

    // Trigger: from the first start event's OrbitPM attributes.
    let trigger: ProcessDigest['trigger']
    const firstStart = startEls[0]
    if (firstStart) {
      const type = readAttr(firstStart, 'trigger')
      if (type) {
        trigger = { type }
        const service = readAttr(firstStart, 'triggerService')
        if (service) trigger.service = service
        const detail = readAttr(firstStart, 'triggerDetail')
        if (detail) trigger.detail = detail
      }
    }

    // Notes: every non-empty text annotation.
    const notes: string[] = []
    for (const art of process.artifacts ?? []) {
      if (localType(art.$type) === 'TextAnnotation') {
        const text = typeof art.text === 'string' ? art.text.trim() : ''
        if (text) notes.push(text)
      }
    }

    // callsTo: deduped calledElement values across every callActivity.
    const callsTo: string[] = []
    const seenCalls = new Set<string>()
    for (const step of steps) {
      if (step.calledProcess && !seenCalls.has(step.calledProcess)) {
        seenCalls.add(step.calledProcess)
        callsTo.push(step.calledProcess)
      }
    }

    const processId = typeof process.id === 'string' ? process.id : ''
    const processName =
      typeof process.name === 'string' && process.name.trim()
        ? process.name.trim()
        : humanizeFileName(relPath)

    return {
      relPath,
      folder: folderOf(relPath),
      processId,
      processName,
      trigger,
      steps,
      notes,
      callsTo
    }
  } catch {
    return null
  }
}

/**
 * Digest every workspace file in parallel, dropping any that fail to parse.
 * Order of the result follows the order of `files`.
 */
export async function buildAllDigests(
  files: Array<{ relPath: string; xml: string }>
): Promise<ProcessDigest[]> {
  const results = await Promise.all(files.map((f) => buildDigest(f.relPath, f.xml)))
  return results.filter((d): d is ProcessDigest => d !== null)
}

/**
 * Deterministic semantic BPMN 2.0 XML emitter.
 *
 * The generated identity is stable for equivalent IR, no document repeats the
 * historical `definitions_1` / `Process_1` constants, and every BPMN `xsd:ID`
 * is globally unique. Branch conditions are emitted as real formal
 * `conditionExpression` children; the `name` remains their visible label.
 */
import { validateBpmn } from './ir/validate'
import { transform } from './transform'
import type { BpmnElement } from './ir/schema'

const NS_MODEL = 'http://www.omg.org/spec/BPMN/20100524/MODEL'
const NS_BPMNDI = 'http://www.omg.org/spec/BPMN/20100524/DI'
const NS_DC = 'http://www.omg.org/spec/DD/20100524/DC'
const NS_DI = 'http://www.omg.org/spec/DD/20100524/DI'
const NS_XSI = 'http://www.w3.org/2001/XMLSchema-instance'
const NS_ORBITPM = 'http://orbitpm.ae/schema/bpmn/1.0'
const DEFAULT_NAMESPACE_BASE = 'https://orbitpm.ae/bpmn/'
const XML_ILLEGAL_CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g
const NCNAME = /^[\p{L}_][\p{L}\p{N}_.\-\u00B7\u0300-\u036F\u203F-\u2040]*$/u

export interface BpmnXmlGenerationOptions {
  /** Stable process link target. Defaults to a deterministic IR fingerprint. */
  processId?: string
  definitionsId?: string
  targetNamespace?: string
  processName?: string
  processNameEn?: string
  processNameAr?: string
  activeLang?: 'en' | 'ar'
  /** Optional stable caller seed (for example workbook process_id). */
  identitySeed?: string
  /** Existing workspace link targets that a newly derived process must avoid. */
  existingProcessIds?: Iterable<string>
}

export interface BpmnGenerationIdentity {
  definitionsId: string
  processId: string
  targetNamespace: string
}

export class BpmnGenerationIdentityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BpmnGenerationIdentityError'
  }
}

function stripIllegalXmlChars(text: string): string {
  return text.replace(XML_ILLEGAL_CONTROL_CHARS, '')
}

function escapeText(text: string): string {
  return stripIllegalXmlChars(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(text: string): string {
  return stripIllegalXmlChars(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r/g, '&#13;')
    .replace(/\n/g, '&#10;')
    .replace(/\t/g, '&#09;')
}

function isArabicCodepoint(cp: number): boolean {
  return (
    (cp >= 0x0600 && cp <= 0x06ff) ||
    (cp >= 0x0750 && cp <= 0x077f) ||
    (cp >= 0x08a0 && cp <= 0x08ff) ||
    (cp >= 0xfb50 && cp <= 0xfdff) ||
    (cp >= 0xfe70 && cp <= 0xfeff)
  )
}

export function arabicRatio(text: string): number {
  let arabic = 0
  let letters = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number
    if (isArabicCodepoint(cp)) {
      arabic += 1
      letters += 1
    } else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) {
      letters += 1
    }
  }
  return letters === 0 ? 0 : arabic / letters
}

export function detectActiveLang(
  labels: ReadonlyArray<string | null | undefined>
): 'en' | 'ar' {
  const joined = labels
    .filter((label): label is string => typeof label === 'string' && label.length > 0)
    .join(' ')
  return arabicRatio(joined) > 0.5 ? 'ar' : 'en'
}

function orbitpmAttrString(bag: Record<string, string> | undefined): string {
  if (!bag) return ''
  return Object.entries(bag)
    .map(([key, value]) => ` orbitpm:${key}="${escapeAttr(value)}"`)
    .join('')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function fingerprint(value: string): string {
  // Two independent FNV-1a passes make accidental workspace collisions much
  // less likely while remaining deterministic in every supported browser.
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first ^= code
    first = Math.imul(first, 0x01000193)
    second ^= code + index
    second = Math.imul(second, 0x85ebca6b)
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0)
    .toString(16)
    .padStart(8, '0')}`
}

function assertNcName(value: string, label: string): void {
  if (!NCNAME.test(value)) {
    throw new BpmnGenerationIdentityError(
      `${label} '${value}' is not a valid XML NCName`
    )
  }
}

function assertNamespace(value: string): void {
  if (/\s/.test(value) || !/^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/.test(value)) {
    throw new BpmnGenerationIdentityError(
      `targetNamespace '${value}' must be an absolute URI`
    )
  }
}

export function deriveGenerationIdentity(
  process: readonly BpmnElement[] | readonly Record<string, unknown>[],
  options: BpmnXmlGenerationOptions = {},
  reservedIds: ReadonlySet<string> = new Set()
): BpmnGenerationIdentity {
  const seed = options.identitySeed ?? stableJson(process)
  const hash = fingerprint(seed)
  const existingProcessIds = new Set(options.existingProcessIds ?? [])
  const explicitProcessId = options.processId?.trim()
  let processId = explicitProcessId || `Process_${hash}`
  if (explicitProcessId && existingProcessIds.has(explicitProcessId)) {
    throw new BpmnGenerationIdentityError(
      `Process ID '${explicitProcessId}' already exists in the workspace`
    )
  }
  if (!explicitProcessId && existingProcessIds.has(processId)) {
    const base = processId
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${base}_${suffix}`
      if (!existingProcessIds.has(candidate)) {
        processId = candidate
        break
      }
    }
  }
  const definitionsId = options.definitionsId?.trim() || `Definitions_${hash}`
  assertNcName(processId, 'Process ID')
  assertNcName(definitionsId, 'Definitions ID')
  if (processId === definitionsId || reservedIds.has(processId) || reservedIds.has(definitionsId)) {
    throw new BpmnGenerationIdentityError(
      `Generated document identity collides with a BPMN element ID (${processId}, ${definitionsId})`
    )
  }
  const targetNamespace =
    options.targetNamespace?.trim() || `${DEFAULT_NAMESPACE_BASE}${encodeURIComponent(processId)}`
  assertNamespace(targetNamespace)
  return { definitionsId, processId, targetNamespace }
}

export function generateBpmnXml(
  process: readonly BpmnElement[] | readonly Record<string, unknown>[],
  options: BpmnXmlGenerationOptions = {}
): string {
  // Direct callers cannot bypass IR invariants.
  validateBpmn(process as readonly never[])
  const { elements, flows } = transform(process as readonly never[])
  const reservedIds = new Set<string>()
  for (const element of elements) {
    reservedIds.add(element.id)
    if (element.event_definition_id) reservedIds.add(element.event_definition_id)
  }
  for (const flow of flows) reservedIds.add(flow.id)
  const identity = deriveGenerationIdentity(process, options, reservedIds)

  const hasOrbitpm =
    Boolean(options.processNameEn || options.processNameAr) ||
    elements.some((element) => element.orbitpm !== undefined) ||
    flows.some((flow) => flow.orbitpm !== undefined)

  let out = '<definitions'
  out += ` xmlns="${NS_MODEL}"`
  out += ` xmlns:bpmndi="${NS_BPMNDI}"`
  out += ` xmlns:dc="${NS_DC}"`
  out += ` xmlns:di="${NS_DI}"`
  out += ` xmlns:xsi="${NS_XSI}"`
  if (hasOrbitpm) out += ` xmlns:orbitpm="${NS_ORBITPM}"`
  out += ` id="${escapeAttr(identity.definitionsId)}"`
  out += ` targetNamespace="${escapeAttr(identity.targetNamespace)}">`

  out += `<process id="${escapeAttr(identity.processId)}" isExecutable="false"`
  if (options.processName) out += ` name="${escapeAttr(options.processName)}"`
  if (hasOrbitpm) {
    const activeLang =
      options.activeLang ??
      detectActiveLang([
        options.processName,
        ...elements.map((element) => element.label),
        ...flows.map((flow) => flow.condition)
      ])
    out += ` orbitpm:activeLang="${activeLang}"`
    if (options.processNameEn) {
      out += ` orbitpm:nameEn="${escapeAttr(options.processNameEn)}"`
    }
    if (options.processNameAr) {
      out += ` orbitpm:nameAr="${escapeAttr(options.processNameAr)}"`
    }
  }
  out += '>'

  for (const element of elements) {
    let open = `<${element.type} id="${escapeAttr(element.id)}"`
    if (element.label) open += ` name="${escapeAttr(element.label)}"`
    if (element.called_element) {
      open += ` calledElement="${escapeAttr(element.called_element)}"`
    }
    if (element.default_flow) open += ` default="${escapeAttr(element.default_flow)}"`
    open += orbitpmAttrString(element.orbitpm)

    const children: string[] = []
    for (const incoming of element.incoming) {
      children.push(`<incoming>${escapeText(incoming)}</incoming>`)
    }
    for (const outgoing of element.outgoing) {
      children.push(`<outgoing>${escapeText(outgoing)}</outgoing>`)
    }
    if (element.eventDefinition) {
      children.push(
        `<${element.eventDefinition} id="${escapeAttr(
          element.event_definition_id as string
        )}" />`
      )
    }
    out +=
      children.length === 0
        ? `${open} />`
        : `${open}>${children.join('')}</${element.type}>`
  }

  for (const flow of flows) {
    let open = `<sequenceFlow id="${escapeAttr(flow.id)}" sourceRef="${escapeAttr(
      flow.sourceRef
    )}" targetRef="${escapeAttr(flow.targetRef)}"`
    if (flow.condition) open += ` name="${escapeAttr(flow.condition)}"`
    open += orbitpmAttrString(flow.orbitpm)
    if (flow.condition) {
      out += `${open}><conditionExpression xsi:type="tFormalExpression">${escapeText(
        flow.condition
      )}</conditionExpression></sequenceFlow>`
    } else {
      out += `${open} />`
    }
  }

  out += '</process></definitions>'
  return out
}

export class BpmnXmlGenerator {
  createBpmnXml(
    process: readonly BpmnElement[] | readonly Record<string, unknown>[],
    options?: BpmnXmlGenerationOptions
  ): string {
    return generateBpmnXml(process, options)
  }
}

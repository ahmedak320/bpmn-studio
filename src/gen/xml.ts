/**
 * Semantic BPMN 2.0 XML emitter — port of `services/bpmn_xml_generator.py`
 * (BpmnXmlGenerator.create_bpmn_xml). Produces plain semantic BPMN (bpmn2
 * namespaces declared, NO BPMNDI); layout/DI is added later by bpmn-auto-layout.
 *
 * The output structure (tags, attribute order, child order, self-closing form)
 * and escaping mirror Python's xml.etree.ElementTree.tostring(encoding="unicode")
 * so the result is byte-comparable with the vendored golden fixtures:
 *  - definitions attrs: xmlns, xmlns:bpmndi, xmlns:dc, xmlns:di, id
 *  - process attrs:     id, isExecutable
 *  - element attrs:     id, name (if label), calledElement (if called_element), default (if default_flow)
 *  - element children:  <incoming>… , <outgoing>… , then <eventDefinition …/>
 *  - sequenceFlow attrs: id, sourceRef, targetRef, name (if condition)
 *  - empty elements self-close as `<tag … />` (note the space, like ElementTree)
 *
 * 2026-07 extension: when (and ONLY when) the IR carries any bilingual/org
 * metadata, the emitter additionally declares `xmlns:orbitpm` on <definitions>,
 * stamps `orbitpm:activeLang` on <process> (Arabic-codepoint heuristic over the
 * primary labels — see detectActiveLang), and appends the `orbitpm:*`
 * attributes carried by each transformed element/flow AFTER the base
 * attributes. The conditional namespace keeps plain IRs byte-identical to the
 * vendored Python goldens (and to what the desktop app produced before).
 */
import { transform } from './transform'
import type { BpmnElement } from './ir/schema'

const NS_MODEL = 'http://www.omg.org/spec/BPMN/20100524/MODEL'
const NS_BPMNDI = 'http://www.omg.org/spec/BPMN/20100524/DI'
const NS_DC = 'http://www.omg.org/spec/DD/20100524/DC'
const NS_DI = 'http://www.omg.org/spec/DD/20100524/DI'
const NS_ORBITPM = 'http://orbitpm.ae/schema/bpmn/1.0'

// XML 1.0 only permits #x9 | #xA | #xD | [#x20-#xD7FF] | ... — strip any
// other C0 control character (\x00-\x08, \x0B, \x0C, \x0E-\x1F) so a
// model-produced label with a stray control char degrades gracefully
// (dropped char) instead of producing invalid XML that bpmn-auto-layout /
// importXML would reject outright. \t \n \r are explicitly kept (and are
// separately entity-escaped in escapeAttr below).
const XML_ILLEGAL_CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g

function stripIllegalXmlChars(text: string): string {
  return text.replace(XML_ILLEGAL_CONTROL_CHARS, '')
}

/** Escape element text exactly like ElementTree `_escape_cdata`. */
function escapeText(text: string): string {
  return stripIllegalXmlChars(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Escape an attribute value exactly like ElementTree `_escape_attrib`. */
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

// Arabic-script Unicode blocks: Arabic, Arabic Supplement, Arabic Extended-A,
// and the two Presentation Forms blocks.
function isArabicCodepoint(cp: number): boolean {
  return (
    (cp >= 0x0600 && cp <= 0x06ff) ||
    (cp >= 0x0750 && cp <= 0x077f) ||
    (cp >= 0x08a0 && cp <= 0x08ff) ||
    (cp >= 0xfb50 && cp <= 0xfdff) ||
    (cp >= 0xfe70 && cp <= 0xfeff)
  )
}

/**
 * Ratio of Arabic-script codepoints among the "alphabetic-ish" codepoints
 * (Arabic blocks + ASCII Latin letters) of `text`. 0 when the text has no such
 * codepoints at all (digits/punctuation-only strings count as not-Arabic).
 */
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

/**
 * Decide the diagram's primary language from its emitted primary labels
 * (element `name`s and flow condition `name`s): 'ar' when Arabic codepoints
 * dominate ({@link arabicRatio} > 0.5), otherwise 'en'. Null/empty entries are
 * ignored. Emitted as `orbitpm:activeLang` on the <process> element.
 */
export function detectActiveLang(
  labels: ReadonlyArray<string | null | undefined>
): 'en' | 'ar' {
  const joined = labels
    .filter((label): label is string => typeof label === 'string' && label.length > 0)
    .join(' ')
  return arabicRatio(joined) > 0.5 ? 'ar' : 'en'
}

/** Serialize an element's/flow's `orbitpm` bag as ` orbitpm:key="value"…`. */
function orbitpmAttrString(bag: Record<string, string> | undefined): string {
  if (!bag) return ''
  let out = ''
  for (const [key, value] of Object.entries(bag)) {
    out += ` orbitpm:${key}="${escapeAttr(value)}"`
  }
  return out
}

/**
 * Build semantic BPMN XML from an IR `process` list.
 * @param process the (validated) IR element list.
 */
export function generateBpmnXml(
  process: readonly BpmnElement[] | readonly Record<string, unknown>[]
): string {
  const { elements, flows } = transform(process as never[])

  // The orbitpm namespace (and process-level activeLang) appears ONLY when the
  // IR carries some bilingual/org metadata — plain IRs stay byte-identical.
  const hasOrbitpm =
    elements.some((e) => e.orbitpm !== undefined) || flows.some((f) => f.orbitpm !== undefined)

  let out = '<definitions'
  out += ` xmlns="${NS_MODEL}"`
  out += ` xmlns:bpmndi="${NS_BPMNDI}"`
  out += ` xmlns:dc="${NS_DC}"`
  out += ` xmlns:di="${NS_DI}"`
  if (hasOrbitpm) {
    out += ` xmlns:orbitpm="${NS_ORBITPM}"`
  }
  out += ' id="definitions_1">'
  out += '<process id="Process_1" isExecutable="false"'
  if (hasOrbitpm) {
    const activeLang = detectActiveLang([
      ...elements.map((e) => e.label),
      ...flows.map((f) => f.condition)
    ])
    out += ` orbitpm:activeLang="${activeLang}"`
  }
  out += '>'

  for (const element of elements) {
    let open = `<${element.type} id="${escapeAttr(element.id)}"`
    if (element.label) {
      open += ` name="${escapeAttr(element.label)}"`
    }
    if (element.called_element) {
      open += ` calledElement="${escapeAttr(element.called_element)}"`
    }
    if (element.default_flow) {
      open += ` default="${escapeAttr(element.default_flow)}"`
    }
    open += orbitpmAttrString(element.orbitpm)

    const children: string[] = []
    for (const incoming of element.incoming) {
      children.push(`<incoming>${escapeText(incoming)}</incoming>`)
    }
    for (const outgoing of element.outgoing) {
      children.push(`<outgoing>${escapeText(outgoing)}</outgoing>`)
    }
    if (element.eventDefinition) {
      const defType = element.eventDefinition
      children.push(`<${defType} id="${escapeAttr(`${defType}_${element.id}`)}" />`)
    }

    if (children.length === 0) {
      out += `${open} />`
    } else {
      out += `${open}>${children.join('')}</${element.type}>`
    }
  }

  for (const flow of flows) {
    let seq = `<sequenceFlow id="${escapeAttr(flow.id)}" sourceRef="${escapeAttr(
      flow.sourceRef
    )}" targetRef="${escapeAttr(flow.targetRef)}"`
    if (flow.condition) {
      seq += ` name="${escapeAttr(flow.condition)}"`
    }
    seq += orbitpmAttrString(flow.orbitpm)
    seq += ' />'
    out += seq
  }

  out += '</process></definitions>'
  return out
}

/** Class shim mirroring the Python `BpmnXmlGenerator`. */
export class BpmnXmlGenerator {
  createBpmnXml(process: readonly BpmnElement[] | readonly Record<string, unknown>[]): string {
    return generateBpmnXml(process)
  }
}

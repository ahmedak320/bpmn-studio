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
 *  - element attrs:     id, name (if label), default (if default_flow)
 *  - element children:  <incoming>… , <outgoing>… , then <eventDefinition …/>
 *  - sequenceFlow attrs: id, sourceRef, targetRef, name (if condition)
 *  - empty elements self-close as `<tag … />` (note the space, like ElementTree)
 */
import { transform } from './transform'
import type { BpmnElement } from './ir/schema'

const NS_MODEL = 'http://www.omg.org/spec/BPMN/20100524/MODEL'
const NS_BPMNDI = 'http://www.omg.org/spec/BPMN/20100524/DI'
const NS_DC = 'http://www.omg.org/spec/DD/20100524/DC'
const NS_DI = 'http://www.omg.org/spec/DD/20100524/DI'

/** Escape element text exactly like ElementTree `_escape_cdata`. */
function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Escape an attribute value exactly like ElementTree `_escape_attrib`. */
function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r/g, '&#13;')
    .replace(/\n/g, '&#10;')
    .replace(/\t/g, '&#09;')
}

/**
 * Build semantic BPMN XML from an IR `process` list.
 * @param process the (validated) IR element list.
 */
export function generateBpmnXml(
  process: readonly BpmnElement[] | readonly Record<string, unknown>[]
): string {
  const { elements, flows } = transform(process as never[])

  let out = '<definitions'
  out += ` xmlns="${NS_MODEL}"`
  out += ` xmlns:bpmndi="${NS_BPMNDI}"`
  out += ` xmlns:dc="${NS_DC}"`
  out += ` xmlns:di="${NS_DI}"`
  out += ' id="definitions_1">'
  out += '<process id="Process_1" isExecutable="false">'

  for (const element of elements) {
    let open = `<${element.type} id="${escapeAttr(element.id)}"`
    if (element.label) {
      open += ` name="${escapeAttr(element.label)}"`
    }
    if (element.default_flow) {
      open += ` default="${escapeAttr(element.default_flow)}"`
    }

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

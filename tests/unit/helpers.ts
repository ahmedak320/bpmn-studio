/**
 * Shared test helpers: fixture loaders and an XML canonicalizer.
 *
 * The canonicalizer parses XML into a DOM (via @xmldom/xmldom) and serializes a
 * normalized form — element localName + attributes sorted by name + ordered
 * children, whitespace-only text nodes dropped. This makes golden comparison
 * robust to cosmetic serialization differences (attribute ordering, self-closing
 * form, escaping style) while still catching real differences: a missing/extra
 * element or flow, a changed attribute value, or a changed element/child order.
 * Since both sides are parsed, malformed XML (e.g. an unescaped `&`) fails to
 * parse and thus fails the test.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DOMParser } from '@xmldom/xmldom'
import { BILINGUAL_ORG_SECTION } from '../../src/gen/prompts'

const ROOT = process.cwd()

/* eslint-disable @typescript-eslint/no-explicit-any */
export function loadIr(name: string): { process: any[] } {
  const raw = readFileSync(resolve(ROOT, 'tests/fixtures/ir', `${name}.json`), 'utf-8')
  return JSON.parse(raw)
}

/**
 * The golden create_bpmn fixture is the REAL vendored jinja2 render; since
 * 2026-07 composeCreateBpmn deliberately diverges by always appending the
 * bilingual/org section between the examples (or catalog section) and the
 * message-history framing. This splices that section into a golden render so
 * byte-fidelity assertions stay exact around the deliberate addition.
 */
export function spliceBilingualOrgSection(golden: string): string {
  const marker = '---\n\nThe following is the message history'
  const at = golden.lastIndexOf(marker)
  if (at === -1) {
    throw new Error('golden prompt fixture is missing the message-history framing marker')
  }
  return golden.slice(0, at) + BILINGUAL_ORG_SECTION + golden.slice(at)
}

/**
 * A representative bilingual + fully org-attributed IR (Arabic-primary):
 * start trigger, userTask with every activity org field, an exclusive gateway
 * with decisionBasis + bilingual branch conditions, and a linked callActivity.
 * Returns a fresh deep copy each call so tests can mutate freely.
 */
export function bilingualOrgIr(): any[] {
  return JSON.parse(
    JSON.stringify([
      {
        type: 'startEvent',
        id: 'start',
        label: 'استلام الطلب',
        labelEn: 'Request received',
        labelAr: 'استلام الطلب',
        trigger: 'Employee submits a purchase request',
        triggerService: 'DMT HUB',
        triggerDetail: 'PR-101 form'
      },
      {
        type: 'userTask',
        id: 'task1',
        label: 'مراجعة الطلب',
        labelEn: 'Review request',
        labelAr: 'مراجعة الطلب',
        owner: 'Procurement Section',
        ownerRole: 'R',
        channel: 'dmthub',
        channelDetail: 'PR-101 form',
        kind: 'cc',
        cc: ['Finance Department', 'Audit Office'],
        inputs: ['Purchase request form', 'Budget sheet'],
        outputs: ['Approved request'],
        respList: ['Sara Al Marri — Reviewer', 'Ahmed Ali — Approver']
      },
      {
        type: 'exclusiveGateway',
        id: 'gw',
        label: 'هل الطلب مكتمل؟',
        labelEn: 'Request complete?',
        labelAr: 'هل الطلب مكتمل؟',
        decisionBasis: 'Procurement policy section 4',
        has_join: false,
        branches: [
          {
            condition: 'نعم',
            conditionEn: 'Yes',
            conditionAr: 'نعم',
            path: [
              {
                type: 'callActivity',
                id: 'ca1',
                label: 'تنفيذ الشراء',
                labelEn: 'Run purchasing',
                labelAr: 'تنفيذ الشراء',
                calledProcess: 'Process_Purchasing',
                owner: 'Procurement Section'
              },
              {
                type: 'endEvent',
                id: 'end1',
                label: 'تم',
                labelEn: 'Done',
                labelAr: 'تم'
              }
            ]
          },
          {
            condition: 'لا',
            conditionEn: 'No',
            conditionAr: 'لا',
            path: [
              {
                type: 'endEvent',
                id: 'end2',
                label: 'مرفوض',
                labelEn: 'Rejected',
                labelAr: 'مرفوض'
              }
            ]
          }
        ]
      }
    ])
  )
}

export function loadGolden(name: string): string {
  return readFileSync(resolve(ROOT, 'tests/fixtures/golden', `${name}.xml`), 'utf-8')
}

export function loadPromptFixture(name: string): string {
  return readFileSync(resolve(ROOT, 'tests/fixtures/prompt', name), 'utf-8')
}

const ELEMENT_NODE = 1
const TEXT_NODE = 3
const CDATA_NODE = 4

function canonicalNode(node: any): string {
  if (node.nodeType === ELEMENT_NODE) {
    const attrs: string[] = []
    const attributes = node.attributes
    if (attributes) {
      for (let i = 0; i < attributes.length; i++) {
        const a = attributes.item(i)
        attrs.push(`${a.name}=${JSON.stringify(a.value)}`)
      }
    }
    attrs.sort()
    let out = `<${node.localName ?? node.tagName}${attrs.length ? ' ' + attrs.join(' ') : ''}>`
    const children = node.childNodes
    for (let i = 0; i < children.length; i++) {
      out += canonicalNode(children.item ? children.item(i) : children[i])
    }
    out += `</${node.localName ?? node.tagName}>`
    return out
  }
  if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_NODE) {
    const text = node.nodeValue ?? ''
    if (text.trim() === '') return ''
    return `#text(${JSON.stringify(text)})`
  }
  return ''
}

/** Parse XML and return a canonical, comparison-stable string form. */
export function canonicalXml(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  if (!doc || !doc.documentElement) {
    throw new Error('Failed to parse XML for canonicalization')
  }
  return canonicalNode(doc.documentElement)
}

/** Collect every `id="..."` value present in an XML string. */
export function collectIds(xml: string): Set<string> {
  const ids = new Set<string>()
  const re = /\sid="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    ids.add(m[1])
  }
  return ids
}

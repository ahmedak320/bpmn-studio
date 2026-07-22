import { describe, it, expect } from 'vitest'
import {
  extractDiagramText,
  buildSearchDoc,
  buildSearchIndex,
  searchWorkspace,
  countHits,
  queryTerms
} from '../workspace/searchIndex'

const ORDER_XML = `<bpmn:definitions xmlns:bpmn="x">
  <bpmn:process id="Process_order" name="Order Fulfillment">
    <bpmn:documentation>Handles customer orders end to end</bpmn:documentation>
    <bpmn:startEvent id="s1" name="Order received" />
    <bpmn:task id="t1" name="Check stock" />
    <bpmn:exclusiveGateway id="g1" name="In stock?" />
  </bpmn:process>
</bpmn:definitions>`

const HIRE_XML = `<bpmn:definitions xmlns:bpmn="x">
  <bpmn:process id="Process_hire" name="Hiring">
    <bpmn:task id="t2" name="Interview candidate" />
  </bpmn:process>
</bpmn:definitions>`

describe('extractDiagramText', () => {
  it('pulls element names and documentation, decoded and de-duplicated', () => {
    const text = extractDiagramText(
      `<x name="Ship &amp; bill" /><y name="Ship &amp; bill" /><z:documentation>Do the <b>thing</b></z:documentation>`
    )
    expect(text).toContain('Ship & bill')
    // de-duplicated (same name twice → once)
    expect(text.filter((t) => t === 'Ship & bill')).toHaveLength(1)
    expect(text).toContain('Do the  thing')
  })
  it('is empty for empty xml', () => {
    expect(extractDiagramText('')).toEqual([])
  })
})

describe('buildSearchDoc', () => {
  it('derives folder / fileName / process fields', () => {
    const doc = buildSearchDoc({ relPath: 'Sales/order.bpmn', xml: ORDER_XML })
    expect(doc.fileName).toBe('order.bpmn')
    expect(doc.folder).toBe('Sales')
    expect(doc.processes).toEqual([{ id: 'Process_order', name: 'Order Fulfillment' }])
    expect(doc.namesText).toContain('order fulfillment')
    expect(doc.idsText).toContain('process_order')
    expect(doc.contentText).toContain('check stock')
  })
  it('omits full content for files larger than the cap (but keeps names/ids)', () => {
    const doc = buildSearchDoc({ relPath: 'x.bpmn', xml: ORDER_XML, size: 10_000 }, 1000)
    expect(doc.contentText).toBe('')
    expect(doc.idsText).toContain('process_order')
    expect(doc.namesText).toContain('order fulfillment')
  })
})

describe('searchWorkspace', () => {
  const index = buildSearchIndex([
    { relPath: 'Sales/order.bpmn', xml: ORDER_XML },
    { relPath: 'HR/hire.bpmn', xml: HIRE_XML }
  ])

  it('matches on process name and reports matchedOn=name', () => {
    const groups = searchWorkspace(index, 'fulfillment')
    expect(countHits(groups)).toBe(1)
    expect(groups[0].folder).toBe('Sales')
    expect(groups[0].hits[0].matchedOn).toBe('name')
    expect(groups[0].hits[0].processId).toBe('Process_order')
  })

  it('matches on process id', () => {
    const groups = searchWorkspace(index, 'process_hire')
    expect(countHits(groups)).toBe(1)
    expect(groups[0].hits[0].matchedOn).toBe('id')
  })

  it('matches on diagram text content (matchedOn=content)', () => {
    const groups = searchWorkspace(index, 'interview')
    expect(countHits(groups)).toBe(1)
    expect(groups[0].hits[0].matchedOn).toBe('content')
    expect(groups[0].hits[0].relPath).toBe('HR/hire.bpmn')
  })

  it('matches on the file name', () => {
    const groups = searchWorkspace(index, 'order.bpmn')
    expect(countHits(groups)).toBe(1)
    expect(groups[0].hits[0].matchedOn).toBe('file')
  })

  it('applies AND semantics across whitespace-separated terms', () => {
    // "order" (name) AND "stock" (content) both in the order file only.
    const groups = searchWorkspace(index, 'order stock')
    expect(countHits(groups)).toBe(1)
    expect(groups[0].hits[0].relPath).toBe('Sales/order.bpmn')
    // A term present in neither file narrows to nothing.
    expect(countHits(searchWorkspace(index, 'order zzz'))).toBe(0)
  })

  it('groups by folder, folders sorted', () => {
    const groups = searchWorkspace(index, 'process_') // both ids share this
    expect(groups.map((g) => g.folder)).toEqual(['HR', 'Sales'])
    expect(countHits(groups)).toBe(2)
  })

  it('returns nothing for an empty query', () => {
    expect(searchWorkspace(index, '   ')).toEqual([])
  })
})

describe('queryTerms', () => {
  it('lowercases and splits on whitespace, dropping empties', () => {
    expect(queryTerms('  Order   Stock ')).toEqual(['order', 'stock'])
    expect(queryTerms('')).toEqual([])
  })
})

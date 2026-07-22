import { describe, it, expect } from 'vitest'
import { buildProcessIndex } from '@app/shared/processIndex'
import { buildCatalog, sortCatalog, filterCatalog, rowLabel } from '../workspace/catalog'

const ORDER_XML = `<bpmn:definitions xmlns:bpmn="x">
  <bpmn:process id="Process_order" name="Order">
    <bpmn:task id="t" name="Check stock" />
    <bpmn:callActivity id="c" name="Ship it" calledElement="Process_missing" />
  </bpmn:process>
</bpmn:definitions>`

const SHIP_XML = `<bpmn:definitions xmlns:bpmn="x">
  <bpmn:process id="Process_ship" name="Shipping" />
</bpmn:definitions>`

const NO_PROC_XML = `<bpmn:definitions xmlns:bpmn="x"></bpmn:definitions>`

const files = [
  { relPath: 'Sales/order.bpmn', xml: ORDER_XML, lastModified: 2000 },
  { relPath: 'ship.bpmn', xml: SHIP_XML, lastModified: 0 },
  { relPath: 'weird.bpmn', xml: NO_PROC_XML, lastModified: 1000 }
]
const index = buildProcessIndex(files)

describe('buildCatalog', () => {
  const rows = buildCatalog(files, index)

  it('emits one row per process, plus a file-level row when a file has none', () => {
    expect(rows).toHaveLength(3)
    const order = rows.find((r) => r.processId === 'Process_order')!
    expect(order.processName).toBe('Order')
    expect(order.folder).toBe('Sales')
    const weird = rows.find((r) => r.relPath === 'weird.bpmn')!
    expect(weird.processId).toBeUndefined()
    expect(rowLabel(weird)).toBe('weird') // file name without .bpmn
  })

  it('counts unresolved links per source file', () => {
    const order = rows.find((r) => r.processId === 'Process_order')!
    expect(order.unresolvedCount).toBe(1) // Process_missing is not in the index
    const ship = rows.find((r) => r.processId === 'Process_ship')!
    expect(ship.unresolvedCount).toBe(0)
  })

  it('normalizes a zero lastModified to undefined', () => {
    const ship = rows.find((r) => r.processId === 'Process_ship')!
    expect(ship.lastModified).toBeUndefined()
    const order = rows.find((r) => r.processId === 'Process_order')!
    expect(order.lastModified).toBe(2000)
  })
})

describe('sortCatalog', () => {
  const rows = buildCatalog(files, index)

  it('sorts by name asc/desc', () => {
    const asc = sortCatalog(rows, 'name', 'asc').map(rowLabel)
    expect(asc).toEqual(['Order', 'Shipping', 'weird'])
    const desc = sortCatalog(rows, 'name', 'desc').map(rowLabel)
    expect(desc).toEqual(['weird', 'Shipping', 'Order'])
  })

  it('sorts by folder', () => {
    const byFolder = sortCatalog(rows, 'folder', 'asc')
    // Root-folder rows ('') sort before "Sales".
    expect(byFolder[0].folder).toBe('')
    expect(byFolder[byFolder.length - 1].folder).toBe('Sales')
  })

  it('sorts by modified with unknown timestamps last in both directions', () => {
    const asc = sortCatalog(rows, 'modified', 'asc')
    expect(asc[asc.length - 1].processId).toBe('Process_ship') // unknown → last
    const desc = sortCatalog(rows, 'modified', 'desc')
    expect(desc[desc.length - 1].processId).toBe('Process_ship') // still last
    // known values ordered: asc → weird(1000) before order(2000)
    const knownAsc = asc.filter((r) => r.lastModified !== undefined).map((r) => r.lastModified)
    expect(knownAsc).toEqual([1000, 2000])
  })
})

describe('filterCatalog', () => {
  const rows = buildCatalog(files, index)

  it('filters by name / id / folder without content', () => {
    expect(filterCatalog(rows, 'order').map(rowLabel)).toEqual(['Order'])
    expect(filterCatalog(rows, 'sales').map(rowLabel)).toEqual(['Order'])
    expect(filterCatalog(rows, 'process_ship').map(rowLabel)).toEqual(['Shipping'])
  })

  it('reaches into diagram text when xml is supplied', () => {
    const xmlByPath = new Map(files.map((f) => [f.relPath, f.xml]))
    expect(filterCatalog(rows, 'stock').length).toBe(0) // no content map → no match
    expect(filterCatalog(rows, 'stock', xmlByPath).map(rowLabel)).toEqual(['Order'])
  })

  it('returns all rows for an empty query', () => {
    expect(filterCatalog(rows, '  ')).toHaveLength(3)
  })
})

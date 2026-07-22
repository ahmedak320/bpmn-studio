import { describe, it, expect } from 'vitest'
import { buildProcessIndex } from '@app/shared/processIndex'
import { collectWorkspaceUnresolved } from '../workspace/unresolved'

const ORDER_XML = `<bpmn:definitions xmlns:bpmn="x">
  <bpmn:process id="Process_order" name="Order">
    <bpmn:callActivity id="ca1" calledElement="Process_ship" />
    <bpmn:callActivity id="ca2" calledElement="Process_missing" />
  </bpmn:process>
</bpmn:definitions>`

const SHIP_XML = `<bpmn:definitions xmlns:bpmn="x">
  <bpmn:process id="Process_ship" name="Shipping">
    <bpmn:callActivity id="ca3" calledElement="Process_absent" />
  </bpmn:process>
</bpmn:definitions>`

const files = [
  { relPath: 'a/order.bpmn', xml: ORDER_XML },
  { relPath: 'b/ship.bpmn', xml: SHIP_XML }
]

describe('collectWorkspaceUnresolved', () => {
  const index = buildProcessIndex(files)
  const links = collectWorkspaceUnresolved(files, index)

  it('flags only calledElements not present in the index', () => {
    const called = links.map((l) => l.calledElement)
    expect(called).toContain('Process_missing') // order → missing
    expect(called).toContain('Process_absent') // ship → absent
    expect(called).not.toContain('Process_ship') // resolves (ship.bpmn exists)
    expect(links).toHaveLength(2)
  })

  it('attaches the source file + first process name + element id', () => {
    const missing = links.find((l) => l.calledElement === 'Process_missing')!
    expect(missing.sourceRelPath).toBe('a/order.bpmn')
    expect(missing.sourceFileName).toBe('order.bpmn')
    expect(missing.sourceProcessName).toBe('Order')
    expect(missing.elementId).toBe('ca2')
  })

  it('is sorted by source path then calledElement', () => {
    expect(links.map((l) => l.sourceRelPath)).toEqual(['a/order.bpmn', 'b/ship.bpmn'])
  })

  it('returns nothing when every link resolves', () => {
    const okFiles = [{ relPath: 'x.bpmn', xml: SHIP_XML.replace('Process_absent', 'Process_ship') }]
    expect(collectWorkspaceUnresolved(okFiles, buildProcessIndex(okFiles))).toEqual([])
  })
})

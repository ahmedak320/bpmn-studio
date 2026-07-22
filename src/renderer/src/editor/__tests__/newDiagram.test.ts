import { describe, expect, it } from 'vitest'
import { createNewDiagramXml, NEW_DIAGRAM_XML } from '../newDiagram'

describe('createNewDiagramXml', () => {
  it('produces a well-formed BPMN document with a startEvent and DI', () => {
    const xml = createNewDiagramXml()
    expect(xml).toContain('<bpmn2:definitions')
    expect(xml).toContain('<bpmn2:process')
    expect(xml).toContain('<bpmn2:startEvent')
    expect(xml).toContain('<bpmndi:BPMNDiagram')
    expect(xml).toContain('<bpmndi:BPMNPlane')
  })

  it('generates a process id matching the proc_<random> convention', () => {
    const xml = createNewDiagramXml()
    expect(xml).toMatch(/id="proc_[a-z0-9]+"/)
  })

  it('generates a unique process id on every call', () => {
    const first = createNewDiagramXml()
    const second = createNewDiagramXml()
    const idOf = (xml: string): string => xml.match(/id="(proc_[a-z0-9]+)"/)?.[1] ?? ''
    expect(idOf(first)).not.toBe('')
    expect(idOf(first)).not.toBe(idOf(second))
  })

  it('references the process id from the BPMNPlane bpmnElement attribute', () => {
    const xml = createNewDiagramXml()
    const processId = xml.match(/id="(proc_[a-z0-9]+)"/)?.[1]
    expect(processId).toBeTruthy()
    expect(xml).toContain(`bpmnElement="${processId}"`)
  })

  it('NEW_DIAGRAM_XML is the same factory function', () => {
    expect(NEW_DIAGRAM_XML).toBe(createNewDiagramXml)
    expect(typeof NEW_DIAGRAM_XML()).toBe('string')
  })
})

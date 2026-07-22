import { describe, expect, it } from 'vitest'
import {
  buildProcessIndex,
  listUnresolvedCalledElements,
  parseProcessesFromXml
} from '../processIndex'

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n'

describe('parseProcessesFromXml', () => {
  it('parses a standard bpmn:process tag', () => {
    const xml = `${XML_HEADER}<bpmn:definitions xmlns:bpmn="x"><bpmn:process id="Process_1" name="Onboarding" isExecutable="false"></bpmn:process></bpmn:definitions>`
    const entries = parseProcessesFromXml(xml, 'a.bpmn')
    expect(entries).toEqual([{ processId: 'Process_1', processName: 'Onboarding', relPath: 'a.bpmn' }])
  })

  it('parses an unprefixed process tag', () => {
    const xml = `<definitions><process id="Process_2" name="No Prefix"></process></definitions>`
    const entries = parseProcessesFromXml(xml, 'b.bpmn')
    expect(entries).toEqual([{ processId: 'Process_2', processName: 'No Prefix', relPath: 'b.bpmn' }])
  })

  it('parses a different namespace prefix', () => {
    const xml = `<bpmn2:definitions xmlns:bpmn2="y"><bpmn2:process id="Process_3"></bpmn2:process></bpmn2:definitions>`
    const entries = parseProcessesFromXml(xml, 'c.bpmn')
    expect(entries).toEqual([{ processId: 'Process_3', processName: undefined, relPath: 'c.bpmn' }])
  })

  it('handles weird attribute order (name before id, extra attrs interleaved)', () => {
    const xml = `<bpmn:process name="Reordered" isExecutable="false" id="Process_4">`
    const entries = parseProcessesFromXml(xml, 'd.bpmn')
    expect(entries).toEqual([{ processId: 'Process_4', processName: 'Reordered', relPath: 'd.bpmn' }])
  })

  it('handles self-closing process tags', () => {
    const xml = `<bpmn:process id="Process_5" name="Empty" />`
    const entries = parseProcessesFromXml(xml, 'e.bpmn')
    expect(entries).toEqual([{ processId: 'Process_5', processName: 'Empty', relPath: 'e.bpmn' }])
  })

  it('handles single-quoted attributes', () => {
    const xml = `<bpmn:process id='Process_6' name='Single Quoted'>`
    const entries = parseProcessesFromXml(xml, 'f.bpmn')
    expect(entries).toEqual([{ processId: 'Process_6', processName: 'Single Quoted', relPath: 'f.bpmn' }])
  })

  it('parses multiple processes in one file', () => {
    const xml = `<bpmn:definitions>
      <bpmn:process id="Process_A" name="A"></bpmn:process>
      <bpmn:process id="Process_B" name="B"></bpmn:process>
    </bpmn:definitions>`
    const entries = parseProcessesFromXml(xml, 'multi.bpmn')
    expect(entries.map((e) => e.processId)).toEqual(['Process_A', 'Process_B'])
  })

  it('decodes XML entities in id/name', () => {
    const xml = `<bpmn:process id="Process_7" name="Foo &amp; Bar &lt;baz&gt;">`
    const entries = parseProcessesFromXml(xml, 'g.bpmn')
    expect(entries[0].processName).toBe('Foo & Bar <baz>')
  })

  it('ignores a process tag with no id', () => {
    const xml = `<bpmn:process name="No Id">`
    expect(parseProcessesFromXml(xml, 'h.bpmn')).toEqual([])
  })

  it('does not match unrelated tags containing "process" as a substring', () => {
    const xml = `<bpmn:subProcess id="Sub_1"></bpmn:subProcess>`
    expect(parseProcessesFromXml(xml, 'i.bpmn')).toEqual([])
  })

  it('returns [] for empty input', () => {
    expect(parseProcessesFromXml('', 'j.bpmn')).toEqual([])
  })
})

describe('buildProcessIndex', () => {
  it('builds an index keyed by processId across multiple files', () => {
    const index = buildProcessIndex([
      { relPath: 'a.bpmn', xml: '<bpmn:process id="P1" name="One">' },
      { relPath: 'b.bpmn', xml: '<bpmn:process id="P2" name="Two">' }
    ])
    expect(index.size).toBe(2)
    expect(index.get('P1')).toEqual({ processId: 'P1', processName: 'One', relPath: 'a.bpmn' })
    expect(index.get('P2')?.relPath).toBe('b.bpmn')
  })

  it('last file scanned wins on duplicate ids', () => {
    const index = buildProcessIndex([
      { relPath: 'first.bpmn', xml: '<bpmn:process id="Dup">' },
      { relPath: 'second.bpmn', xml: '<bpmn:process id="Dup">' }
    ])
    expect(index.get('Dup')?.relPath).toBe('second.bpmn')
  })

  it('handles a file with multiple processes and files with none', () => {
    const index = buildProcessIndex([
      { relPath: 'multi.bpmn', xml: '<process id="M1"></process><process id="M2"></process>' },
      { relPath: 'empty.bpmn', xml: '<bpmn:definitions></bpmn:definitions>' }
    ])
    expect(Array.from(index.keys()).sort()).toEqual(['M1', 'M2'])
  })
})

describe('listUnresolvedCalledElements', () => {
  const index = buildProcessIndex([{ relPath: 'known.bpmn', xml: '<bpmn:process id="Known_Process">' }])

  it('finds a callActivity pointing at an id not in the index', () => {
    const xml = `<bpmn:callActivity id="CallActivity_1" calledElement="Missing_Process" />`
    expect(listUnresolvedCalledElements(xml, index)).toEqual([
      { elementId: 'CallActivity_1', calledElement: 'Missing_Process' }
    ])
  })

  it('does not flag a callActivity pointing at a known process', () => {
    const xml = `<bpmn:callActivity id="CallActivity_2" calledElement="Known_Process" />`
    expect(listUnresolvedCalledElements(xml, index)).toEqual([])
  })

  it('does not flag an unlinked callActivity (no calledElement)', () => {
    const xml = `<bpmn:callActivity id="CallActivity_3" />`
    expect(listUnresolvedCalledElements(xml, index)).toEqual([])
  })

  it('does not flag a callActivity with an empty calledElement', () => {
    const xml = `<bpmn:callActivity id="CallActivity_4" calledElement="" />`
    expect(listUnresolvedCalledElements(xml, index)).toEqual([])
  })

  it('handles multiple call activities, namespace-agnostic, attribute order agnostic', () => {
    const xml = `
      <callActivity calledElement="Missing_A" id="CA_A"></callActivity>
      <bpmn2:callActivity id="CA_B" calledElement="Known_Process"></bpmn2:callActivity>
      <bpmn:callActivity calledElement="Missing_C" id="CA_C" />
    `
    const result = listUnresolvedCalledElements(xml, index)
    expect(result).toEqual([
      { elementId: 'CA_A', calledElement: 'Missing_A' },
      { elementId: 'CA_C', calledElement: 'Missing_C' }
    ])
  })

  it('returns [] for empty xml', () => {
    expect(listUnresolvedCalledElements('', index)).toEqual([])
  })
})

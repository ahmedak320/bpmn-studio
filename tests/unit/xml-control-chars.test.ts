/**
 * E1-7: XML-1.0-illegal control characters (\x00-\x08, \x0b, \x0c, \x0e-\x1f)
 * in a model-produced label must not break generation — they're stripped so
 * the emitted XML stays well-formed. \t \n \r are legal and must survive
 * (entity-escaped, per the existing golden behavior).
 */
import { describe, it, expect } from 'vitest'
import { DOMParser } from '@xmldom/xmldom'
import { generateBpmnXml } from '../../src/gen/xml'

describe('xml.ts: illegal control characters', () => {
  it('strips \\x00-\\x08 from a task label instead of emitting invalid XML', () => {
    const nulByte = String.fromCharCode(0)
    const bell = String.fromCharCode(7)
    const backspace = String.fromCharCode(8)
    const label = `Review${nulByte} order${bell}${backspace} details`

    const process = [
      { id: 'start_1', type: 'startEvent', label: 'Start' },
      { id: 'task_1', type: 'task', label, next: 'end_1' },
      { id: 'end_1', type: 'endEvent', label: 'End' }
    ]

    const xml = generateBpmnXml(process as never[])

    // No raw control chars leaked through.
    expect(xml).not.toContain(nulByte)
    expect(xml).not.toContain(bell)
    expect(xml).not.toContain(backspace)
    // The rest of the label survives, control chars just dropped.
    expect(xml).toContain('name="Review order details"')
    // Well-formed enough for a DOM parser to accept (proves generation
    // "survives" — this is the property that matters, not byte parity).
    let sawError = false
    const doc = new DOMParser({
      onError: (level: string) => {
        if (level !== 'warn') sawError = true
      }
    }).parseFromString(xml, 'application/xml')
    expect(sawError).toBe(false)
    expect(doc.documentElement?.localName ?? doc.documentElement?.tagName).toBe('definitions')
  })

  it('keeps \\t \\n \\r (legal XML whitespace) entity-escaped, not stripped', () => {
    const label = 'Line1\nLine2\tTabbed\rCR'
    const process = [
      { id: 'start_1', type: 'startEvent', label: 'Start' },
      { id: 'task_1', type: 'task', label, next: 'end_1' },
      { id: 'end_1', type: 'endEvent', label: 'End' }
    ]

    const xml = generateBpmnXml(process as never[])

    expect(xml).toContain('&#10;')
    expect(xml).toContain('&#09;')
    expect(xml).toContain('&#13;')
  })
})

import { describe, expect, it } from 'vitest'
import { ArisWriterError } from './errors'
import {
  applyAmlEdits,
  assertNoOverlappingEdits,
  assertOnlySpanChanged,
  deleteEdit,
  diffTexts,
  insertEdit,
  pruneNoOpEdits,
  replaceEdit,
  verifyUnchangedRegions
} from './patch'
import { makeSpan } from './spans'

const DOCUMENT = '<A x="1"><!-- keep --><B y="2"/>\n\t<C/>\n</A>\n'

describe('applyAmlEdits — span patching', () => {
  it('returns byte-identical output for an empty edit set', () => {
    const result = applyAmlEdits(DOCUMENT, [])
    expect(result.text).toBe(DOCUMENT)
    expect(result.changed).toBe(false)
    expect(result.derivedByteLength).toBe(result.originalByteLength)
  })

  it('replaces one span and copies every other byte verbatim', () => {
    const span = makeSpan(DOCUMENT.indexOf('1'), DOCUMENT.indexOf('1') + 1)
    const result = applyAmlEdits(DOCUMENT, [replaceEdit(span, '9', 'set x')])
    expect(result.text).toBe(DOCUMENT.replace('x="1"', 'x="9"'))
    expect(assertOnlySpanChanged(DOCUMENT, result.text, span)).toMatchObject({
      originalText: '1',
      derivedText: '9'
    })
  })

  it('produces the same output regardless of the order edits are supplied in', () => {
    const first = replaceEdit(makeSpan(DOCUMENT.indexOf('1'), DOCUMENT.indexOf('1') + 1), '9', 'a')
    const second = replaceEdit(makeSpan(DOCUMENT.indexOf('2'), DOCUMENT.indexOf('2') + 1), '8', 'b')
    expect(applyAmlEdits(DOCUMENT, [first, second]).text).toBe(
      applyAmlEdits(DOCUMENT, [second, first]).text
    )
  })

  it('orders several insertions at the same anchor by their position in the input array', () => {
    const anchor = DOCUMENT.indexOf('<C/>')
    const result = applyAmlEdits(DOCUMENT, [
      insertEdit(anchor, '<P/>', 'first'),
      insertEdit(anchor, '<Q/>', 'second')
    ])
    expect(result.text).toContain('<P/><Q/><C/>')
  })

  it('reports the derived span each edit occupies after earlier edits shifted it', () => {
    const xSpan = makeSpan(DOCUMENT.indexOf('1'), DOCUMENT.indexOf('1') + 1)
    const ySpan = makeSpan(DOCUMENT.indexOf('2'), DOCUMENT.indexOf('2') + 1)
    const result = applyAmlEdits(DOCUMENT, [
      replaceEdit(xSpan, 'LONGER', 'grow x'),
      replaceEdit(ySpan, '8', 'set y')
    ])
    const [grow, setY] = result.applied
    expect(result.text.slice(grow!.derivedSpan.start, grow!.derivedSpan.end)).toBe('LONGER')
    expect(result.text.slice(setY!.derivedSpan.start, setY!.derivedSpan.end)).toBe('8')
  })

  it('deletes a span without disturbing neighbouring whitespace', () => {
    const start = DOCUMENT.indexOf('<B')
    const result = applyAmlEdits(DOCUMENT, [
      deleteEdit(makeSpan(start, start + '<B y="2"/>'.length), 'drop B')
    ])
    expect(result.text).toBe('<A x="1"><!-- keep -->\n\t<C/>\n</A>\n')
  })
})

describe('applyAmlEdits — overlap validation', () => {
  it('rejects two edits whose spans intersect instead of letting the last writer win', () => {
    const edits = [
      replaceEdit(makeSpan(0, 8), 'X', 'wide'),
      replaceEdit(makeSpan(4, 12), 'Y', 'narrow')
    ]
    expect(() => applyAmlEdits(DOCUMENT, edits)).toThrowError(ArisWriterError)
    try {
      applyAmlEdits(DOCUMENT, edits)
      expect.unreachable('overlapping edits must throw')
    } catch (error) {
      expect((error as ArisWriterError).code).toBe('overlapping-edits')
      expect((error as ArisWriterError).detail).toMatchObject({ first: 'wide', second: 'narrow' })
    }
  })

  it('rejects an insertion that lands strictly inside a replaced span', () => {
    expect(() =>
      assertNoOverlappingEdits(
        [replaceEdit(makeSpan(0, 8), 'X', 'wide'), insertEdit(4, 'Y', 'inner')],
        DOCUMENT.length
      )
    ).toThrowError(/overlap/)
  })

  it('accepts an insertion exactly at the boundary of a replaced span', () => {
    expect(() =>
      assertNoOverlappingEdits(
        [replaceEdit(makeSpan(0, 8), 'X', 'wide'), insertEdit(8, 'Y', 'boundary')],
        DOCUMENT.length
      )
    ).not.toThrow()
  })

  it('rejects a span that runs past the end of the document', () => {
    expect(() =>
      applyAmlEdits(DOCUMENT, [replaceEdit(makeSpan(0, DOCUMENT.length + 1), 'X', 'oob')])
    ).toThrowError(/outside the document/)
  })

  it('rejects an inverted span', () => {
    expect(() => applyAmlEdits(DOCUMENT, [replaceEdit(makeSpan(5, 2), 'X', 'inverted')])).toThrowError(
      ArisWriterError
    )
  })
})

describe('pruneNoOpEdits', () => {
  it('drops edits that replace bytes with themselves', () => {
    const span = makeSpan(DOCUMENT.indexOf('1'), DOCUMENT.indexOf('1') + 1)
    expect(pruneNoOpEdits(DOCUMENT, [replaceEdit(span, '1', 'inert')])).toHaveLength(0)
    expect(pruneNoOpEdits(DOCUMENT, [replaceEdit(span, '2', 'real')])).toHaveLength(1)
  })

  it('drops empty insertions', () => {
    expect(pruneNoOpEdits(DOCUMENT, [insertEdit(3, '', 'nothing')])).toHaveLength(0)
  })
})

describe('verifyUnchangedRegions', () => {
  it('accounts for every byte outside the edited spans', () => {
    const xSpan = makeSpan(DOCUMENT.indexOf('1'), DOCUMENT.indexOf('1') + 1)
    const ySpan = makeSpan(DOCUMENT.indexOf('2'), DOCUMENT.indexOf('2') + 1)
    const result = applyAmlEdits(DOCUMENT, [
      replaceEdit(xSpan, 'LONGER', 'grow x'),
      replaceEdit(ySpan, '8', 'set y')
    ])
    const report = verifyUnchangedRegions(DOCUMENT, result)
    expect(report.replacedCharacters).toBe(2)
    expect(report.insertedCharacters).toBe(7)
    expect(report.unchangedCharacters).toBe(DOCUMENT.length - 2)
    expect(report.unchangedBytes).toBe(DOCUMENT.length - 2)
    expect(report.regions).toBe(3)
  })

  it('counts the whole document as unchanged for an empty edit set', () => {
    const report = verifyUnchangedRegions(DOCUMENT, applyAmlEdits(DOCUMENT, []))
    expect(report.unchangedCharacters).toBe(DOCUMENT.length)
    expect(report.regions).toBe(1)
  })

  it('throws when a byte outside an edited span moved', () => {
    const result = applyAmlEdits(DOCUMENT, [replaceEdit(makeSpan(1, 2), 'Z', 'edit')])
    const tampered = { ...result, text: `${result.text}tampered` }
    expect(() => verifyUnchangedRegions(DOCUMENT, tampered)).toThrowError(
      /Bytes outside the edited spans changed/
    )
  })

  it('counts multi-byte characters by their UTF-8 length', () => {
    const arabic = '<A name="تسجيل"/>'
    const span = makeSpan(arabic.indexOf('تسجيل'), arabic.indexOf('تسجيل') + 'تسجيل'.length)
    const result = applyAmlEdits(arabic, [replaceEdit(span, 'name', 'translate')])
    const report = verifyUnchangedRegions(arabic, result)
    expect(report.unchangedCharacters).toBe(arabic.length - 5)
    expect(report.unchangedBytes).toBe(arabic.length - 5)
    expect(result.originalByteLength).toBe(arabic.length + 5)
  })
})

describe('diffTexts', () => {
  it('returns null for identical texts', () => {
    expect(diffTexts(DOCUMENT, DOCUMENT)).toBeNull()
  })

  it('collapses a single localized change to one region', () => {
    const derived = DOCUMENT.replace('y="2"', 'y="22"')
    const difference = diffTexts(DOCUMENT, derived)
    expect(difference).not.toBeNull()
    expect(difference!.originalText).toBe('')
    expect(difference!.derivedText).toBe('2')
  })

  it('rejects a change outside the expected span', () => {
    const derived = DOCUMENT.replace('y="2"', 'y="22"')
    expect(() => assertOnlySpanChanged(DOCUMENT, derived, makeSpan(0, 4))).toThrowError(
      /only \[0, 4\) was expected to change/
    )
  })
})

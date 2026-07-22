/**
 * parse.ts — port of parse_json_loose. Candidate order: whole trimmed string,
 * then each fenced block, then the first balanced {..}/[..] snippet.
 */
import { describe, it, expect } from 'vitest'
import { parseJsonLoose } from '../../src/gen/parse'

describe('parseJsonLoose', () => {
  it('parses a plain JSON object', () => {
    expect(parseJsonLoose('{"process": [1, 2]}')).toEqual({ process: [1, 2] })
  })

  it('parses with surrounding whitespace (trim first)', () => {
    expect(parseJsonLoose('   \n {"a": 1}\n  ')).toEqual({ a: 1 })
  })

  it('extracts a ```json fenced block wrapped in prose', () => {
    const raw = 'Sure! Here you go:\n```json\n{"process": [{"id": "start"}]}\n```\nHope that helps.'
    expect(parseJsonLoose(raw)).toEqual({ process: [{ id: 'start' }] })
  })

  it('extracts a plain ``` fenced block (no json tag)', () => {
    const raw = 'Result:\n```\n{"ok": true}\n```'
    expect(parseJsonLoose(raw)).toEqual({ ok: true })
  })

  it('is case-insensitive about the ```JSON tag', () => {
    const raw = '```JSON\n{"x": 42}\n```'
    expect(parseJsonLoose(raw)).toEqual({ x: 42 })
  })

  it('finds the first balanced object snippet amid leading & trailing prose', () => {
    const raw = 'The BPMN is: {"process": [{"id": "s"}]} — done, thanks!'
    expect(parseJsonLoose(raw)).toEqual({ process: [{ id: 's' }] })
  })

  it('handles braces inside strings when scanning for the snippet', () => {
    const raw = 'prefix {"label": "a } b { c"} suffix'
    expect(parseJsonLoose(raw)).toEqual({ label: 'a } b { c' })
  })

  it('parses a top-level array', () => {
    expect(parseJsonLoose('[{"id": "start"}]')).toEqual([{ id: 'start' }])
  })

  it('throws when there is no decodable JSON', () => {
    expect(() => parseJsonLoose('this is not json at all')).toThrow()
  })
})

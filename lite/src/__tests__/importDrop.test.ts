import { describe, it, expect } from 'vitest'
import {
  isBpmnName,
  isApcName,
  isImportableName,
  isInternalDrag,
  collectDroppedBpmn,
  INTERNAL_DND_MIME
} from '../workspace/importDrop'

describe('isBpmnName', () => {
  it('matches .bpmn case-insensitively only', () => {
    expect(isBpmnName('order.bpmn')).toBe(true)
    expect(isBpmnName('ORDER.BPMN')).toBe(true)
    expect(isBpmnName('notes.txt')).toBe(false)
    expect(isBpmnName('order.bpmn.txt')).toBe(false)
  })
})

describe('isApcName / isImportableName', () => {
  it('matches .apc case-insensitively', () => {
    expect(isApcName('model.apc')).toBe(true)
    expect(isApcName('MODEL.APC')).toBe(true)
    expect(isApcName('model.bpmn')).toBe(false)
  })

  it('accepts both bpmn and apc as importable', () => {
    expect(isImportableName('a.bpmn')).toBe(true)
    expect(isImportableName('b.apc')).toBe(true)
    expect(isImportableName('c.txt')).toBe(false)
  })
})

describe('isInternalDrag', () => {
  it('detects our internal move mime among the drag types', () => {
    expect(isInternalDrag({ types: [INTERNAL_DND_MIME, 'text/plain'] })).toBe(true)
    expect(isInternalDrag({ types: ['Files'] })).toBe(false)
    expect(isInternalDrag({ types: undefined as unknown as string[] })).toBe(false)
  })
})

function fakeFile(name: string, text: string): { name: string; text: () => Promise<string> } {
  return { name, text: async () => text }
}

describe('collectDroppedBpmn — flat files fallback', () => {
  it('keeps only .bpmn files from DataTransfer.files', async () => {
    const dt = {
      items: [],
      files: [fakeFile('a.bpmn', 'A'), fakeFile('b.txt', 'B'), fakeFile('c.BPMN', 'C')]
    }
    const out = await collectDroppedBpmn(dt)
    expect(out.map((d) => d.name).sort()).toEqual(['a.bpmn', 'c.BPMN'])
    expect(await out[0].getText()).toBe('A')
  })

  it('handles a missing items list', async () => {
    const dt = { files: [fakeFile('x.bpmn', 'X')] }
    const out = await collectDroppedBpmn(dt)
    expect(out).toHaveLength(1)
    expect(out[0].relPath).toBe('x.bpmn')
  })

  it('also collects .apc files (experimental ARIS import)', async () => {
    const dt = {
      items: [],
      files: [fakeFile('a.bpmn', 'A'), fakeFile('m.apc', 'M'), fakeFile('n.txt', 'N')]
    }
    const out = await collectDroppedBpmn(dt)
    expect(out.map((d) => d.name).sort()).toEqual(['a.bpmn', 'm.apc'])
  })
})

describe('collectDroppedBpmn — handle walk (folder support)', () => {
  it('walks a dropped folder recursively, preserving its subtree, ignoring non-bpmn', async () => {
    const fileHandle = (name: string, text: string): unknown => ({
      kind: 'file',
      name,
      getFile: async () => ({ text: async () => text })
    })
    const dirHandle = {
      kind: 'directory',
      name: 'Sub',
      async *entries(): AsyncIterableIterator<[string, unknown]> {
        yield ['inner.bpmn', fileHandle('inner.bpmn', 'INNER')]
        yield ['skip.txt', fileHandle('skip.txt', 'NOPE')]
      }
    }
    const dt = {
      items: [
        { kind: 'file', getAsFileSystemHandle: async () => fileHandle('order.bpmn', 'ORDER') },
        { kind: 'file', getAsFileSystemHandle: async () => dirHandle }
      ]
    }
    const out = await collectDroppedBpmn(dt as never)
    const byPath = Object.fromEntries(await Promise.all(out.map(async (d) => [d.relPath, await d.getText()])))
    expect(byPath).toEqual({ 'order.bpmn': 'ORDER', 'Sub/inner.bpmn': 'INNER' })
  })
})

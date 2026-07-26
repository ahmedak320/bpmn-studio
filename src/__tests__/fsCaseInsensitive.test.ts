import { describe, it, expect } from 'vitest'
import {
  writeFileAt,
  writeBytesAt,
  readFileAt,
  readBytesAt,
  createFolderAt,
  renameAt,
  resolveDir
} from '../fs/fsAccess'
import { newRoot, newRootCI } from './mockFs'

// Codex NEW-CRITICAL-1: on a CASE-INSENSITIVE filesystem (macOS/Windows) a
// case-only rename — Order.bpmn → order.bpmn — resolves source and destination
// to the SAME underlying entry. The old copy-then-delete then deleted the file
// it had just written, destroying the user's data. A safe two-step rename via a
// temp name must preserve the content and land the new casing.

const BINARY = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x80, 0x01, 0x02])

describe('case-only rename on a case-insensitive filesystem (NEW-C1)', () => {
  it('renames a FILE by case only WITHOUT losing its content', async () => {
    const root = newRootCI()
    await writeFileAt(root, 'Order.bpmn', 'ORDER-CONTENT')
    const res = await renameAt(root, 'Order.bpmn', 'order.bpmn', 'file')
    expect(res.destRel).toBe('order.bpmn')
    // The file still exists and carries its original content (NOT deleted).
    expect(await readFileAt(root, 'order.bpmn')).toBe('ORDER-CONTENT')
    // And it is now stored under the new casing.
    const dir = await resolveDir(root, '')
    const names = [...(dir as unknown as { entriesMap: Map<string, unknown> }).entriesMap.keys()]
    expect(names).toContain('order.bpmn')
    expect(names).not.toContain('Order.bpmn')
  })

  it('preserves BINARY bytes exactly on a case-only file rename', async () => {
    const root = newRootCI()
    await writeBytesAt(root, 'Logo.PNG', BINARY.buffer as ArrayBuffer)
    // extension-preserving rename keeps .PNG? it's not .bpmn, but rename of a
    // file always ensures .bpmn — so rename a .bpmn to be safe about extension.
    await writeFileAt(root, 'Doc.bpmn', 'X')
    const res = await renameAt(root, 'Doc.bpmn', 'doc.bpmn', 'file')
    expect(res.destRel).toBe('doc.bpmn')
    expect(await readFileAt(root, 'doc.bpmn')).toBe('X')
    // The untouched binary sibling is intact.
    expect(Array.from(new Uint8Array(await readBytesAt(root, 'Logo.PNG')))).toEqual(
      Array.from(BINARY)
    )
  })

  it('renames a FOLDER by case only WITHOUT losing its nested files', async () => {
    const root = newRootCI()
    await writeFileAt(root, 'Docs/spec.bpmn', 'SPEC')
    await writeBytesAt(root, 'Docs/pic.png', BINARY.buffer as ArrayBuffer)
    const res = await renameAt(root, 'Docs', 'docs', 'directory')
    expect(res.destRel).toBe('docs')
    expect(res.files).toBe(2)
    // Nested files survive with content intact.
    expect(await readFileAt(root, 'docs/spec.bpmn')).toBe('SPEC')
    expect(Array.from(new Uint8Array(await readBytesAt(root, 'docs/pic.png')))).toEqual(
      Array.from(BINARY)
    )
  })

  it('a genuinely different-named rename still works on a case-insensitive fs', async () => {
    const root = newRootCI()
    await writeFileAt(root, 'Order.bpmn', 'ORDER')
    const res = await renameAt(root, 'Order.bpmn', 'invoice.bpmn', 'file')
    expect(res.destRel).toBe('invoice.bpmn')
    expect(await readFileAt(root, 'invoice.bpmn')).toBe('ORDER')
    await expect(readFileAt(root, 'Order.bpmn')).rejects.toBeTruthy()
  })
})

describe('case-only rename on a case-SENSITIVE filesystem (no regression)', () => {
  it('treats Order.bpmn → order.bpmn as a normal move to a distinct name', async () => {
    const root = newRoot() // case-sensitive
    await writeFileAt(root, 'Order.bpmn', 'ORDER')
    const res = await renameAt(root, 'Order.bpmn', 'order.bpmn', 'file')
    expect(res.destRel).toBe('order.bpmn')
    expect(await readFileAt(root, 'order.bpmn')).toBe('ORDER')
    // On a case-sensitive fs the original name is a different entry and is gone.
    await expect(readFileAt(root, 'Order.bpmn')).rejects.toBeTruthy()
  })
})

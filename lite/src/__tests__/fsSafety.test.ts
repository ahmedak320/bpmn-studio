import { describe, it, expect } from 'vitest'
import {
  writeFileAt,
  writeBytesAt,
  readBytesAt,
  readFileAt,
  createFolderAt,
  moveAt,
  renameAt,
  resolveDir,
  hasPathSeparator,
  ensureBpmnExtension
} from '../fs/fsAccess'
import { newRoot } from './mockFs'

// Bytes that DO NOT survive a UTF-8 text() round-trip: lone 0xFF / 0x80 / 0xFE
// become U+FFFD and re-encode to 3 different bytes. A binary-safe copy must
// preserve them exactly (Codex CRITICAL-2).
const BINARY = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x80, 0x01, 0x02])

describe('binary-safe folder move/rename (CRITICAL-2)', () => {
  it('preserves NON-text file bytes verbatim when a folder is moved', async () => {
    const root = newRoot()
    await writeBytesAt(root, 'Docs/logo.png', BINARY.buffer as ArrayBuffer)
    await writeFileAt(root, 'Docs/spec.bpmn', '<bpmn/>')
    await createFolderAt(root, '', 'Archive')

    const res = await moveAt(root, 'Docs', 'Archive', 'directory')

    // Counts surfaced for the toast: 2 files, 1 of them non-BPMN.
    expect(res.destRel).toBe('Archive/Docs')
    expect(res.files).toBe(2)
    expect(res.nonBpmn).toBe(1)

    // The binary bytes round-tripped EXACTLY (not corrupted through text()).
    const moved = new Uint8Array(await readBytesAt(root, 'Archive/Docs/logo.png'))
    expect(Array.from(moved)).toEqual(Array.from(BINARY))
    // The text file also survived.
    expect(await readFileAt(root, 'Archive/Docs/spec.bpmn')).toBe('<bpmn/>')
    // Originals were removed after the copy.
    await expect(resolveDir(root, 'Docs')).rejects.toBeTruthy()
  })

  it('preserves bytes when a single non-.bpmn file is moved and reports nonBpmn=1', async () => {
    const root = newRoot()
    await writeBytesAt(root, 'invoice.pdf', BINARY.buffer as ArrayBuffer)
    await createFolderAt(root, '', 'Sales')
    const res = await moveAt(root, 'invoice.pdf', 'Sales', 'file')
    expect(res.files).toBe(1)
    expect(res.nonBpmn).toBe(1)
    const moved = new Uint8Array(await readBytesAt(root, 'Sales/invoice.pdf'))
    expect(Array.from(moved)).toEqual(Array.from(BINARY))
  })

  it('a renamed folder carries and preserves its nested binary attachments', async () => {
    const root = newRoot()
    await writeBytesAt(root, 'Old/deep/photo.jpg', BINARY.buffer as ArrayBuffer)
    await writeFileAt(root, 'Old/proc.bpmn', '<x/>')
    const res = await renameAt(root, 'Old', 'New', 'directory')
    expect(res.destRel).toBe('New')
    expect(res.files).toBe(2)
    expect(res.nonBpmn).toBe(1)
    const moved = new Uint8Array(await readBytesAt(root, 'New/deep/photo.jpg'))
    expect(Array.from(moved)).toEqual(Array.from(BINARY))
  })
})

describe('rename validation (MINOR)', () => {
  it('auto-appends .bpmn when a file rename strips the extension', async () => {
    const root = newRoot()
    await writeFileAt(root, 'order.bpmn', 'X')
    const res = await renameAt(root, 'order.bpmn', 'purchase', 'file')
    expect(res.destRel).toBe('purchase.bpmn')
    expect(await readFileAt(root, 'purchase.bpmn')).toBe('X')
  })

  it('keeps an already-correct .bpmn extension (case-insensitive)', async () => {
    const root = newRoot()
    await writeFileAt(root, 'order.bpmn', 'X')
    const res = await renameAt(root, 'order.bpmn', 'keep.BPMN', 'file')
    expect(res.destRel).toBe('keep.BPMN')
  })

  it('rejects a name containing a forward slash', async () => {
    const root = newRoot()
    await writeFileAt(root, 'order.bpmn', 'X')
    await expect(renameAt(root, 'order.bpmn', 'sub/order', 'file')).rejects.toThrow(/\/|\\/)
    // original untouched
    expect(await readFileAt(root, 'order.bpmn')).toBe('X')
  })

  it('rejects a name containing a backslash (folder too)', async () => {
    const root = newRoot()
    await writeFileAt(root, 'F/a.bpmn', 'A')
    await expect(renameAt(root, 'F', 'a\\b', 'directory')).rejects.toThrow(/\/|\\/)
    expect(await readFileAt(root, 'F/a.bpmn')).toBe('A')
  })

  it('rejects an empty / whitespace-only name', async () => {
    const root = newRoot()
    await writeFileAt(root, 'order.bpmn', 'X')
    await expect(renameAt(root, 'order.bpmn', '   ', 'file')).rejects.toThrow(/empty/i)
  })
})

describe('rename validation helpers', () => {
  it('hasPathSeparator detects / and \\', () => {
    expect(hasPathSeparator('a/b')).toBe(true)
    expect(hasPathSeparator('a\\b')).toBe(true)
    expect(hasPathSeparator('plain name')).toBe(false)
  })
  it('ensureBpmnExtension appends only when missing (case-insensitive)', () => {
    expect(ensureBpmnExtension('order')).toBe('order.bpmn')
    expect(ensureBpmnExtension('order.bpmn')).toBe('order.bpmn')
    expect(ensureBpmnExtension('order.BPMN')).toBe('order.BPMN')
  })
})

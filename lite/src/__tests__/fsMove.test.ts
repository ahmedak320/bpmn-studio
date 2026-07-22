import { describe, it, expect } from 'vitest'
import {
  writeFileAt,
  readFileAt,
  createFolderAt,
  moveAt,
  countDirEntries,
  scanWorkspaceFiles,
  resolveDir
} from '../fs/fsAccess'
import { newRoot } from './mockFs'

describe('moveAt', () => {
  it('moves a file into a different folder, keeping its name', async () => {
    const root = newRoot()
    await writeFileAt(root, 'order.bpmn', 'ORDER')
    await createFolderAt(root, '', 'Sales')
    const newRel = await moveAt(root, 'order.bpmn', 'Sales', 'file')
    expect(newRel.destRel).toBe('Sales/order.bpmn')
    expect(newRel.files).toBe(1)
    expect(newRel.nonBpmn).toBe(0)
    expect(await readFileAt(root, 'Sales/order.bpmn')).toBe('ORDER')
    await expect(readFileAt(root, 'order.bpmn')).rejects.toBeTruthy()
  })

  it('moves a folder subtree into another folder', async () => {
    const root = newRoot()
    await writeFileAt(root, 'HR/hire.bpmn', 'HIRE')
    await writeFileAt(root, 'HR/deep/onboard.bpmn', 'ONBOARD')
    await createFolderAt(root, '', 'Archive')
    const newRel = await moveAt(root, 'HR', 'Archive', 'directory')
    expect(newRel.destRel).toBe('Archive/HR')
    expect(newRel.files).toBe(2)
    expect(await readFileAt(root, 'Archive/HR/hire.bpmn')).toBe('HIRE')
    expect(await readFileAt(root, 'Archive/HR/deep/onboard.bpmn')).toBe('ONBOARD')
    await expect(resolveDir(root, 'HR')).rejects.toBeTruthy()
  })

  it('moving a file to the folder it already lives in is a no-op', async () => {
    const root = newRoot()
    await writeFileAt(root, 'Sales/order.bpmn', 'X')
    const rel = await moveAt(root, 'Sales/order.bpmn', 'Sales', 'file')
    expect(rel.destRel).toBe('Sales/order.bpmn')
    expect(await readFileAt(root, 'Sales/order.bpmn')).toBe('X')
  })

  it('moves a nested file up to the workspace root', async () => {
    const root = newRoot()
    await writeFileAt(root, 'Sales/order.bpmn', 'X')
    const rel = await moveAt(root, 'Sales/order.bpmn', '', 'file')
    expect(rel.destRel).toBe('order.bpmn')
    expect(await readFileAt(root, 'order.bpmn')).toBe('X')
  })

  it('refuses to move a folder into itself or a descendant', async () => {
    const root = newRoot()
    await writeFileAt(root, 'A/x.bpmn', 'X')
    await createFolderAt(root, 'A', 'B')
    await expect(moveAt(root, 'A', 'A', 'directory')).rejects.toThrow(/into itself/i)
    await expect(moveAt(root, 'A', 'A/B', 'directory')).rejects.toThrow(/into itself/i)
    // original untouched
    expect(await readFileAt(root, 'A/x.bpmn')).toBe('X')
  })

  it('refuses to clobber an existing entry with the same name in the destination', async () => {
    const root = newRoot()
    await writeFileAt(root, 'order.bpmn', 'A')
    await writeFileAt(root, 'Sales/order.bpmn', 'B')
    await expect(moveAt(root, 'order.bpmn', 'Sales', 'file')).rejects.toThrow(/already exists/i)
    // both originals intact
    expect(await readFileAt(root, 'order.bpmn')).toBe('A')
    expect(await readFileAt(root, 'Sales/order.bpmn')).toBe('B')
  })
})

describe('countDirEntries', () => {
  it('counts direct entries of any type', async () => {
    const root = newRoot()
    await writeFileAt(root, 'F/a.bpmn', 'x')
    await writeFileAt(root, 'F/notes.txt', 'y')
    await createFolderAt(root, 'F', 'sub')
    expect(await countDirEntries(root, 'F')).toBe(3)
  })
  it('returns 0 for an empty folder', async () => {
    const root = newRoot()
    await createFolderAt(root, '', 'Empty')
    expect(await countDirEntries(root, 'Empty')).toBe(0)
  })
  it('returns 0 for a missing folder', async () => {
    const root = newRoot()
    expect(await countDirEntries(root, 'nope')).toBe(0)
  })
})

describe('scanWorkspaceFiles', () => {
  it('captures relPath, xml, lastModified and size for every .bpmn file', async () => {
    const root = newRoot()
    await writeFileAt(root, 'a.bpmn', '<a/>')
    await writeFileAt(root, 'sub/b.bpmn', '<bb/>')
    await writeFileAt(root, 'sub/skip.md', 'nope')
    const metas = await scanWorkspaceFiles(root)
    const byPath = Object.fromEntries(metas.map((m) => [m.relPath, m]))
    expect(Object.keys(byPath).sort()).toEqual(['a.bpmn', 'sub/b.bpmn'])
    expect(byPath['a.bpmn'].xml).toBe('<a/>')
    expect(byPath['sub/b.bpmn'].size).toBe('<bb/>'.length)
    expect(typeof byPath['a.bpmn'].lastModified).toBe('number')
    expect(byPath['a.bpmn'].lastModified).toBeGreaterThan(0)
  })
})

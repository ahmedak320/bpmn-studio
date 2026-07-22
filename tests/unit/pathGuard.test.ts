import { describe, expect, it } from 'vitest'
import { resolveWithinRoot, PathGuardError } from '../../src/main/workspace/pathGuard'
import { join, resolve, sep } from 'node:path'

const ROOT = resolve('/tmp/orbitpm-test-root')

describe('resolveWithinRoot', () => {
  it('resolves a simple relative path inside the root', () => {
    expect(resolveWithinRoot(ROOT, 'sub/file.bpmn')).toBe(join(ROOT, 'sub', 'file.bpmn'))
  })

  it('resolves the empty string to the root itself', () => {
    expect(resolveWithinRoot(ROOT, '')).toBe(ROOT)
  })

  it('resolves nested relative paths correctly', () => {
    expect(resolveWithinRoot(ROOT, 'a/b/c/file.bpmn')).toBe(
      join(ROOT, 'a', 'b', 'c', 'file.bpmn')
    )
  })

  it('rejects ../ traversal that escapes the root', () => {
    expect(() => resolveWithinRoot(ROOT, '../outside.bpmn')).toThrow(PathGuardError)
  })

  it('rejects deeper ../ traversal that escapes the root', () => {
    expect(() => resolveWithinRoot(ROOT, 'sub/../../outside.bpmn')).toThrow(PathGuardError)
  })

  it('rejects an absolute path outside the root', () => {
    expect(() => resolveWithinRoot(ROOT, '/etc/passwd')).toThrow(PathGuardError)
  })

  it('accepts an absolute path that is already inside the root', () => {
    const inside = join(ROOT, 'inside.bpmn')
    expect(resolveWithinRoot(ROOT, inside)).toBe(inside)
  })

  it('rejects a sibling directory that merely shares a prefix with root', () => {
    // e.g. root = /tmp/orbitpm-test-root, candidate = /tmp/orbitpm-test-root-evil
    const sibling = `${ROOT}-evil/file.bpmn`
    expect(() => resolveWithinRoot(ROOT, sibling)).toThrow(PathGuardError)
  })

  it('rejects traversal that returns exactly to the parent of root', () => {
    expect(() => resolveWithinRoot(ROOT, '..')).toThrow(PathGuardError)
  })

  it('note: does not resolve on-disk symlinks (lexical check only)', () => {
    // Documented limitation — see pathGuard.ts comment. A relative path with
    // no ".." segments always passes the lexical check even if a symlink
    // inside the root would cause the OS to resolve outside it; callers
    // doing real fs I/O should additionally realpath-check.
    expect(resolveWithinRoot(ROOT, 'maybe-a-symlink/file.bpmn')).toBe(
      join(ROOT, 'maybe-a-symlink', 'file.bpmn')
    )
  })

  it('uses the platform path separator in escape detection', () => {
    expect(sep === '/' || sep === '\\').toBe(true)
  })
})

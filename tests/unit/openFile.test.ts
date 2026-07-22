import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// openFile.ts imports `app`/`dialog` from 'electron' for the orchestration
// functions this file doesn't exercise (only the pure classify/normalize
// helpers below) — mock it so the module can be imported under vitest's
// plain Node runtime, same convention as tests/unit/secrets.test.ts.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/orbitpm-openfile-userdata' },
  dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 1 }) }
}))

import {
  classifyFilePath,
  findBpmnArg,
  isBpmnPath,
  normalizeArgPath
} from '../../src/main/openFile'

const ROOT = resolve('/tmp/orbitpm-openfile-root')

describe('normalizeArgPath', () => {
  it('trims whitespace', () => {
    expect(normalizeArgPath('  /a/b.bpmn  ')).toBe('/a/b.bpmn')
  })

  it('strips a wrapping pair of double quotes', () => {
    expect(normalizeArgPath('"/a/b.bpmn"')).toBe('/a/b.bpmn')
  })

  it('strips a wrapping pair of single quotes', () => {
    expect(normalizeArgPath("'/a/b.bpmn'")).toBe('/a/b.bpmn')
  })

  it('leaves an unquoted path alone', () => {
    expect(normalizeArgPath('/a/b.bpmn')).toBe('/a/b.bpmn')
  })
})

describe('isBpmnPath', () => {
  it('accepts a lowercase .bpmn extension', () => {
    expect(isBpmnPath('/a/b/file.bpmn')).toBe(true)
  })

  it('accepts a mixed-case .BPMN extension', () => {
    expect(isBpmnPath('C:\\a\\file.BPMN')).toBe(true)
  })

  it('rejects other extensions', () => {
    expect(isBpmnPath('/a/b/file.xml')).toBe(false)
    expect(isBpmnPath('/a/b/file')).toBe(false)
  })
})

describe('findBpmnArg', () => {
  it('skips argv[0] (the exe) and finds a .bpmn argument', () => {
    expect(findBpmnArg(['electron.exe', 'C:\\Users\\a\\file.bpmn'])).toBe(
      'C:\\Users\\a\\file.bpmn'
    )
  })

  it('ignores CLI flags', () => {
    expect(findBpmnArg(['electron.exe', '--smoke-test', '/a/file.bpmn'])).toBe('/a/file.bpmn')
  })

  it('returns null when no .bpmn argument is present', () => {
    expect(findBpmnArg(['electron.exe', '--smoke-test'])).toBeNull()
    expect(findBpmnArg(['electron.exe'])).toBeNull()
  })

  it('returns null on an empty argv', () => {
    expect(findBpmnArg([])).toBeNull()
  })
})

describe('classifyFilePath', () => {
  it('classifies a non-.bpmn path as not-bpmn regardless of root', () => {
    expect(classifyFilePath(ROOT, resolve(ROOT, 'notes.txt'))).toEqual({ kind: 'not-bpmn' })
  })

  it('classifies as no-root when no workspace root is selected yet', () => {
    expect(classifyFilePath(null, resolve(ROOT, 'a.bpmn'))).toEqual({ kind: 'no-root' })
  })

  it('classifies a path inside the root, returning a posix relPath', () => {
    const result = classifyFilePath(ROOT, resolve(ROOT, 'sub', 'a.bpmn'))
    expect(result).toEqual({ kind: 'inside', relPath: 'sub/a.bpmn' })
  })

  it('classifies a top-level file inside the root', () => {
    const result = classifyFilePath(ROOT, resolve(ROOT, 'a.bpmn'))
    expect(result).toEqual({ kind: 'inside', relPath: 'a.bpmn' })
  })

  it('classifies a path outside the root, returning its absolute path', () => {
    const outside = resolve('/tmp/somewhere-else/a.bpmn')
    expect(classifyFilePath(ROOT, outside)).toEqual({ kind: 'outside', absPath: outside })
  })

  it('classifies a sibling directory that merely shares a name prefix as outside', () => {
    // ROOT-evil/a.bpmn must not be misclassified as inside ROOT
    const sibling = `${ROOT}-evil/a.bpmn`
    const result = classifyFilePath(ROOT, sibling)
    expect(result.kind).toBe('outside')
  })

  it('normalizes quoted/whitespace-padded raw paths before classifying', () => {
    const result = classifyFilePath(ROOT, `  "${resolve(ROOT, 'a.bpmn')}"  `)
    expect(result).toEqual({ kind: 'inside', relPath: 'a.bpmn' })
  })
})

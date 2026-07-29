import { describe, expect, it } from 'vitest'
import {
  ARIS_MEMBER_NAME_MAX_BYTES,
  ArisPackagePathError,
  arisAttachmentPath,
  arisGenerationSourcePath,
  arisPackageDigestFromPath,
  arisPackageDirectories,
  arisPackagePaths,
  arisReferencePath,
  arisRevisionPath,
  assertArisMemberName,
  assertArisMutableMemberPath,
  isArisImmutableMemberPath,
  isArisPackagePath,
  normalizeArisSourceDigest,
  sanitizeArisMemberName
} from '../layout'

const DIGEST = 'a'.repeat(64)

describe('ARIS package layout', () => {
  it('produces exactly the paths the plan specifies', () => {
    const paths = arisPackagePaths(DIGEST)
    expect(paths).toMatchObject({
      root: `.orbitpm/aris/${DIGEST}`,
      originalSource: `.orbitpm/aris/${DIGEST}/original/source.xml`,
      manifest: `.orbitpm/aris/${DIGEST}/manifest.json`,
      accounting: `.orbitpm/aris/${DIGEST}/accounting.v2.json`,
      currentRevision: `.orbitpm/aris/${DIGEST}/working/current-revision.json`,
      revisionsDirectory: `.orbitpm/aris/${DIGEST}/working/revisions`,
      attachmentsDirectory: `.orbitpm/aris/${DIGEST}/attachments`,
      referencesDirectory: `.orbitpm/aris/${DIGEST}/references`
    })
    expect(arisRevisionPath(DIGEST, 'r000003-0123456789abcdef01234567')).toBe(
      `.orbitpm/aris/${DIGEST}/working/revisions/r000003-0123456789abcdef01234567.patch.json`
    )
    expect(arisAttachmentPath(DIGEST, 'ObjDef.7', 'plan.pdf')).toBe(
      `.orbitpm/aris/${DIGEST}/attachments/ObjDef.7/plan.pdf`
    )
    expect(arisReferencePath(DIGEST, 'symbols.png')).toBe(
      `.orbitpm/aris/${DIGEST}/references/symbols.png`
    )
  })

  it('lists ancestors before descendants so directory creation is ordered', () => {
    const directories = arisPackageDirectories(DIGEST)
    for (const [index, directory] of directories.entries()) {
      const separator = directory.lastIndexOf('/')
      if (separator < 0) continue
      const parent = directory.slice(0, separator)
      expect(directories.slice(0, index)).toContain(parent)
    }
  })

  it('rejects malformed digests and normalizes case', () => {
    expect(normalizeArisSourceDigest('A'.repeat(64))).toBe(DIGEST)
    for (const bad of ['', 'zz', 'a'.repeat(63), 'a'.repeat(65), `${'a'.repeat(63)}g`, '../etc']) {
      expect(() => normalizeArisSourceDigest(bad)).toThrow(ArisPackagePathError)
    }
  })

  it('rejects invalid revision ids in revision paths', () => {
    for (const bad of [
      '',
      'r1-abc',
      'r000001-XYZ',
      '../escape',
      'r0000001-0123456789abcdef01234567'
    ]) {
      expect(() => arisRevisionPath(DIGEST, bad)).toThrow(ArisPackagePathError)
    }
  })

  it('identifies package membership and the immutable original directory', () => {
    const paths = arisPackagePaths(DIGEST)
    expect(isArisPackagePath(paths.manifest)).toBe(true)
    expect(isArisPackagePath('models/intake.xml')).toBe(false)
    expect(arisPackageDigestFromPath(paths.originalSource)).toBe(DIGEST)
    expect(arisPackageDigestFromPath('.orbitpm/aris/not-a-digest/manifest.json')).toBeNull()
    expect(isArisImmutableMemberPath(paths.originalSource)).toBe(true)
    expect(isArisImmutableMemberPath(`${paths.originalDirectory}/description.md`)).toBe(true)
    expect(isArisImmutableMemberPath(paths.manifest)).toBe(false)
    expect(() => assertArisMutableMemberPath(paths.originalSource)).toThrow(ArisPackagePathError)
    expect(assertArisMutableMemberPath(paths.manifest)).toBe(paths.manifest)
  })

  it('never lets a retained generation source take the original source name', () => {
    expect(arisGenerationSourcePath(DIGEST, 'brief.docx')).toBe(
      `.orbitpm/aris/${DIGEST}/original/brief.docx`
    )
    expect(() => arisGenerationSourcePath(DIGEST, 'source.xml')).toThrow(ArisPackagePathError)
    expect(() => arisGenerationSourcePath(DIGEST, '../../source.xml')).toThrow(ArisPackagePathError)
  })
})

describe('member name sanitization', () => {
  const traversals = [
    '../../../etc/passwd',
    '..\\..\\windows\\system32\\config\\sam',
    '/etc/shadow',
    'C:\\Windows\\notepad.exe',
    '\\\\server\\share\\secret.txt',
    './.././evil',
    '..',
    '.',
    '....',
    'a/../../b'
  ]

  it('collapses every traversal and absolute form into a single safe leaf', () => {
    for (const input of traversals) {
      const safe = sanitizeArisMemberName(input)
      expect(safe).not.toContain('/')
      expect(safe).not.toContain('\\')
      expect(safe).not.toBe('.')
      expect(safe).not.toBe('..')
      expect(() => assertArisMemberName(safe)).not.toThrow()
    }
    expect(sanitizeArisMemberName('../../../etc/passwd')).toBe('passwd')
    expect(sanitizeArisMemberName('C:\\Windows\\notepad.exe')).toBe('notepad.exe')
  })

  it('strips control, bidi and separator characters', () => {
    const nasty = 'inv\u0000oice\u001f\u007f\u202e fdp.exe'
    const safe = sanitizeArisMemberName(nasty)
    expect(safe).toBe('invoice fdp.exe')
    expect(() => assertArisMemberName(nasty)).toThrow(ArisPackagePathError)
    expect(sanitizeArisMemberName('a\u2028b\u2029c\ufeffd')).toBe('abcd')
  })

  it('replaces Windows-illegal characters instead of dropping them silently', () => {
    expect(sanitizeArisMemberName('re:port<1>|2?.json')).toBe('re_port_1__2_.json')
    expect(() => assertArisMemberName('re:port.json')).toThrow(ArisPackagePathError)
  })

  it('escapes reserved Windows device names with and without extensions', () => {
    for (const reserved of ['CON', 'con', 'PRN.txt', 'aux', 'NUL.json', 'COM1', 'lpt9.dat']) {
      const safe = sanitizeArisMemberName(reserved)
      expect(safe.startsWith('_')).toBe(true)
      expect(() => assertArisMemberName(reserved)).toThrow(ArisPackagePathError)
      expect(() => assertArisMemberName(safe)).not.toThrow()
    }
    expect(sanitizeArisMemberName('console.json')).toBe('console.json')
  })

  it('trims leading and trailing dots and spaces', () => {
    expect(sanitizeArisMemberName('  spaced.txt  ')).toBe('spaced.txt')
    expect(sanitizeArisMemberName('.hidden')).toBe('hidden')
    expect(sanitizeArisMemberName('trailing.')).toBe('trailing')
    expect(() => assertArisMemberName(' leading.txt')).toThrow(ArisPackagePathError)
    expect(() => assertArisMemberName('trailing.txt.')).toThrow(ArisPackagePathError)
  })

  it('truncates overlong names deterministically and keeps them distinguishable', () => {
    const first = `${'k'.repeat(400)}-one.xml`
    const second = `${'k'.repeat(400)}-two.xml`
    const safeFirst = sanitizeArisMemberName(first)
    const safeSecond = sanitizeArisMemberName(second)
    expect(new TextEncoder().encode(safeFirst).byteLength).toBeLessThanOrEqual(
      ARIS_MEMBER_NAME_MAX_BYTES
    )
    expect(safeFirst.endsWith('.xml')).toBe(true)
    expect(safeFirst).not.toBe(safeSecond)
    expect(sanitizeArisMemberName(first)).toBe(safeFirst)
    const multibyte = `${'\u0645'.repeat(300)}.xml`
    expect(
      new TextEncoder().encode(sanitizeArisMemberName(multibyte)).byteLength
    ).toBeLessThanOrEqual(ARIS_MEMBER_NAME_MAX_BYTES)
  })

  it('produces a deterministic fallback when nothing usable remains', () => {
    const first = sanitizeArisMemberName('...')
    expect(first).toMatch(/^unnamed-[0-9a-f]{8}$/u)
    expect(sanitizeArisMemberName('...')).toBe(first)
    expect(sanitizeArisMemberName('..')).not.toBe(first)
  })

  it('always yields a sanitized name that satisfies the strict rule', () => {
    const inputs = [
      ...traversals,
      '',
      ' ',
      '\u0000',
      'COM9',
      'a'.repeat(5000),
      'file\u202e.gnp.exe',
      'ünïcödé — filename.pdf',
      'tab\there.json'
    ]
    for (const input of inputs) {
      expect(() => assertArisMemberName(sanitizeArisMemberName(input))).not.toThrow()
    }
  })

  it('keeps every sanitized name inside its own package root', () => {
    for (const input of traversals) {
      const path = arisAttachmentPath(DIGEST, input, input)
      expect(path.startsWith(`.orbitpm/aris/${DIGEST}/attachments/`)).toBe(true)
      expect(path.includes('/../')).toBe(false)
    }
  })
})

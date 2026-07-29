import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../../../workspace/adapters/hash'
import { SingleFileWorkspaceAdapter } from '../../../workspace/adapters/singleFile'
import type { MemoryWorkspaceAdapter } from '../../../workspace/adapters/memory'
import type { WorkspaceAdapter } from '../../../workspace/adapters/types'
import { ArisPackagePathError, arisPackagePaths } from '../layout'
import { collectArisPackageArchive, compareArisPackageArchives } from '../packageBackup'
import {
  ARIS_PORTABLE_FORMAT,
  ArisPortableError,
  ArisPortableWorkspaceSession,
  EMPTY_ARIS_PORTABLE_CONTAINER,
  arisPortableFileName,
  base64ToBytes,
  bytesToBase64,
  classifyArisWorkspace,
  collectArisPortableContainer,
  hydrateArisPortableContainer,
  importArisPortableContainer,
  openArisWorkspace,
  parseArisPortableContainer,
  readArisPortableOriginal,
  serializeArisPortableContainer,
  upsertArisPortablePackage,
  type ArisPortableContainerV1
} from '../portable'
import { ArisPackageStore } from '../store'
import { commitArisSourcePackage, planArisImportedPackage } from '../transaction'
import {
  SAMPLE_ANALYSIS,
  SAMPLE_MODELS,
  amlBytes,
  createWorkspace,
  importedSource,
  sampleAccounting
} from './harness'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const PORTABLE_PATH = 'animals.orbitpm-aris.json'

/** Build a package in a package-directory workspace. */
async function directoryPackage(id = 'directory-workspace'): Promise<{
  adapter: MemoryWorkspaceAdapter
  digest: string
}> {
  const adapter = createWorkspace(id)
  const source = await importedSource()
  const plan = await planArisImportedPackage({
    adapter,
    source,
    analysis: SAMPLE_ANALYSIS,
    accounting: sampleAccounting(source.sha256),
    models: SAMPLE_MODELS,
    attachments: [
      {
        attachmentId: 'Att.1',
        sourceId: 'ObjDef.7',
        name: 'plan.pdf',
        mediaType: 'application/pdf',
        bytes: encoder.encode('%PDF-1.4 attachment')
      }
    ],
    references: [
      { name: 'symbols.png', mediaType: 'image/png', bytes: encoder.encode('reference asset') }
    ]
  })
  const outcome = await commitArisSourcePackage({
    adapter,
    plan,
    reviewedDigest: plan.reviewDigest
  })
  if (outcome.status !== 'committed') throw new Error(`import failed: ${outcome.status}`)
  return { adapter, digest: source.sha256 }
}

interface PortableFile {
  readonly adapter: SingleFileWorkspaceAdapter
  readonly downloads: Uint8Array[]
  bytes(): Uint8Array
}

/**
 * A download-mode single-file workspace — the exact shape a browser without
 * File System Access gets from `<input type=file>`.
 */
function portableFile(
  initial: Uint8Array = serializeArisPortableContainer(EMPTY_ARIS_PORTABLE_CONTAINER),
  options: { failWrites?: boolean } = {}
): PortableFile {
  const downloads: Uint8Array[] = []
  let latest = initial
  const adapter = new SingleFileWorkspaceAdapter({
    path: PORTABLE_PATH,
    bytes: initial,
    mimeType: 'application/json',
    download: (request) => {
      if (options.failWrites) throw new Error('injected download failure')
      downloads.push(request.bytes)
      latest = request.bytes
    }
  })
  return { adapter, downloads, bytes: () => latest }
}

async function importInto(session: { workspace: WorkspaceAdapter }): Promise<{ digest: string }> {
  const source = await importedSource()
  const plan = await planArisImportedPackage({
    adapter: session.workspace,
    source,
    analysis: SAMPLE_ANALYSIS,
    accounting: sampleAccounting(source.sha256),
    models: SAMPLE_MODELS
  })
  const outcome = await commitArisSourcePackage({
    adapter: session.workspace,
    plan,
    reviewedDigest: plan.reviewDigest
  })
  if (outcome.status === 'rolled-back' || outcome.status === 'rollback-failed') {
    throw new Error(`import failed: ${outcome.error.message}`)
  }
  return { digest: source.sha256 }
}

describe('portable container format', () => {
  it('round-trips arbitrary bytes through base64', () => {
    const cases = [
      new Uint8Array(),
      new Uint8Array([0]),
      new Uint8Array([0, 255]),
      new Uint8Array([1, 2, 3]),
      new Uint8Array([0xff, 0xfe, 0xfd, 0xfc]),
      encoder.encode('عربي — ünïcödé'),
      Uint8Array.from({ length: 512 }, (_value, index) => index % 256)
    ]
    for (const bytes of cases) {
      expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes))
    }
    expect(bytesToBase64(encoder.encode('hi'))).toBe('aGk=')
    expect(() => base64ToBytes('not base64!')).toThrow(ArisPortableError)
    expect(() => base64ToBytes('abc')).toThrow(ArisPortableError)
  })

  it('serializes deterministically regardless of package or member order', async () => {
    const { adapter, digest } = await directoryPackage()
    const container = await collectArisPortableContainer(adapter)
    const first = serializeArisPortableContainer(container)
    expect(Array.from(serializeArisPortableContainer(container))).toEqual(Array.from(first))

    const entry = container.packages[0]
    if (!entry) throw new Error('expected one package')
    const shuffled: ArisPortableContainerV1 = {
      format: container.format,
      version: container.version,
      packages: [{ sourceSha256: entry.sourceSha256, members: [...entry.members].reverse() }]
    }
    expect(Array.from(serializeArisPortableContainer(shuffled))).toEqual(Array.from(first))
    expect(decoder.decode(first)).toContain(`"${ARIS_PORTABLE_FORMAT}"`)
    expect(decoder.decode(first)).not.toMatch(/\d{4}-\d{2}-\d{2}T/u)
    expect(digest).toHaveLength(64)
  })

  it('verifies every member digest and rejects a tampered container', async () => {
    const { adapter } = await directoryPackage()
    const container = await collectArisPortableContainer(adapter)
    const bytes = serializeArisPortableContainer(container)
    await expect(parseArisPortableContainer(bytes)).resolves.toMatchObject({
      format: ARIS_PORTABLE_FORMAT
    })

    const parsed = JSON.parse(decoder.decode(bytes)) as {
      packages: Array<{ members: Array<{ path: string; base64: string }> }>
    }
    const original = parsed.packages[0]?.members.find(
      (member) => member.path === 'original/source.xml'
    )
    if (!original) throw new Error('expected an original member')
    original.base64 = bytesToBase64(encoder.encode('<AML>tampered</AML>'))
    await expect(parseArisPortableContainer(JSON.stringify(parsed))).rejects.toThrow(
      expect.objectContaining({ code: 'digest-mismatch' })
    )

    await expect(parseArisPortableContainer('{"format":"something-else"}')).rejects.toThrow(
      expect.objectContaining({ code: 'not-a-container' })
    )
    await expect(parseArisPortableContainer('{ broken')).rejects.toThrow(
      expect.objectContaining({ code: 'invalid-json' })
    )
  })

  it('rejects traversal in member paths and credential material in authored members', async () => {
    const evil = {
      format: ARIS_PORTABLE_FORMAT,
      version: 1,
      packages: [
        {
          sourceSha256: 'a'.repeat(64),
          members: [
            {
              path: '../../escape.json',
              sha256: await sha256Hex(encoder.encode('{}')),
              byteLength: 2,
              base64: bytesToBase64(encoder.encode('{}'))
            }
          ]
        }
      ]
    }
    await expect(parseArisPortableContainer(JSON.stringify(evil))).rejects.toThrow(
      ArisPackagePathError
    )

    const secret = encoder.encode('{"apiKey":"sk-ant-api03-AAAAAAAAAAAAAAAAAAAA"}')
    const leaky = {
      format: ARIS_PORTABLE_FORMAT,
      version: 1,
      packages: [
        {
          sourceSha256: 'a'.repeat(64),
          members: [
            {
              path: 'manifest.json',
              sha256: await sha256Hex(secret),
              byteLength: secret.byteLength,
              base64: bytesToBase64(secret)
            }
          ]
        }
      ]
    }
    await expect(parseArisPortableContainer(JSON.stringify(leaky))).rejects.toThrow(
      /API keys must never enter an ARIS source package/u
    )
  })

  it('keeps an existing digest untouched when the same package is added again', async () => {
    const { adapter } = await directoryPackage()
    const container = await collectArisPortableContainer(adapter)
    const entry = container.packages[0]
    if (!entry) throw new Error('expected one package')
    const again = upsertArisPortablePackage(container, {
      sourceSha256: entry.sourceSha256,
      members: []
    })
    expect(again).toBe(container)
    expect(again.packages[0]?.members.length).toBe(entry.members.length)
  })

  it('suggests a portable file name', () => {
    expect(arisPortableFileName('AnimalWF.xml')).toBe('AnimalWF.orbitpm-aris.json')
    expect(arisPortableFileName('../../etc/passwd')).toBe('passwd.orbitpm-aris.json')
  })
})

describe('portable single-file workspace (plan §2.5, §17.2)', () => {
  it('routes a single-file workspace to the portable session instead of refusing it', async () => {
    const file = portableFile()
    expect(classifyArisWorkspace(file.adapter)).toBe('portable-single-file')
    expect(classifyArisWorkspace(createWorkspace())).toBe('package-directory')

    const session = await openArisWorkspace(file.adapter)
    expect(session.kind).toBe('portable-single-file')
    const { digest } = await importInto(session)
    expect((await session.flush()).status).toBe('flushed')
    expect(await session.store.listPackages()).toEqual([digest])
  })

  it('preserves the original byte-for-byte across save, edit and reopen', async () => {
    const file = portableFile()
    const session = await openArisWorkspace(file.adapter)
    const { digest } = await importInto(session)
    await session.flush()

    await session.store.saveRevision(digest, [
      { type: 'aris.object.rename', payload: { id: 'ObjOcc.1', name: 'Triage' } }
    ])
    await session.store.saveRevision(digest, [
      { type: 'aris.object.move', payload: { x: 3, y: 9 } }
    ])
    await session.store.deleteModel(digest, 'Model.1')
    expect((await session.flush()).status).toBe('flushed')

    // Reopen the written container exactly as a returning user would.
    const reopened = await ArisPortableWorkspaceSession.open(portableFile(file.bytes()).adapter)
    const original = await reopened.store.readOriginalSource(digest)
    expect(Array.from(original.bytes)).toEqual(Array.from(amlBytes()))
    expect(original.hash).toBe(digest)
    expect(await sha256Hex(original.bytes)).toBe(digest)
    expect(Array.from(readArisPortableOriginal(reopened.container, digest))).toEqual(
      Array.from(amlBytes())
    )
    expect((await reopened.store.replayRevisions(digest)).commands).toHaveLength(3)
    expect((await reopened.store.verifyIntegrity(digest)).problems).toEqual([])
    expect(await reopened.store.scanForSecrets(digest)).toEqual([])
  })

  it('keeps the original write-once inside a portable session', async () => {
    const file = portableFile()
    const session = await openArisWorkspace(file.adapter)
    const { digest } = await importInto(session)
    await session.flush()

    const paths = arisPackagePaths(digest)
    await expect(
      session.store.writeWorkingMember(paths.originalSource, encoder.encode('<AML>no</AML>'))
    ).rejects.toThrow(ArisPackagePathError)
    await expect(
      session.store.createMemberOnce(paths.originalSource, encoder.encode('<AML>no</AML>'))
    ).rejects.toThrow(expect.objectContaining({ code: 'already-exists' }))
    expect((await session.store.readOriginalSource(digest)).hash).toBe(digest)
  })

  it('deduplicates an identical source digest in portable mode', async () => {
    const file = portableFile()
    const session = await openArisWorkspace(file.adapter)
    const { digest } = await importInto(session)
    await session.flush()
    const afterFirst = file.bytes()

    const source = await importedSource()
    const duplicate = await planArisImportedPackage({
      adapter: session.workspace,
      source,
      analysis: SAMPLE_ANALYSIS,
      accounting: sampleAccounting(source.sha256),
      models: SAMPLE_MODELS
    })
    expect(duplicate.status).toBe('duplicate')
    const outcome = await commitArisSourcePackage({
      adapter: session.workspace,
      plan: duplicate,
      reviewedDigest: duplicate.reviewDigest
    })
    expect(outcome.status).toBe('deduplicated')

    expect((await session.flush()).status).toBe('unchanged')
    expect(Array.from(file.bytes())).toEqual(Array.from(afterFirst))
    expect(await session.store.listPackages()).toEqual([digest])
  })

  it('leaves the previous file byte-identical when the write fails', async () => {
    // Seed a container that already holds one committed package.
    const seed = portableFile()
    const seeding = await openArisWorkspace(seed.adapter)
    const { digest } = await importInto(seeding)
    await seeding.flush()
    const committedBytes = seed.bytes()
    const committedHash = await sha256Hex(committedBytes)

    const failing = portableFile(committedBytes, { failWrites: true })
    const session = await ArisPortableWorkspaceSession.open(failing.adapter)
    await session.store.saveRevision(digest, [
      { type: 'aris.object.rename', payload: { id: 'ObjOcc.1', name: 'Triage' } }
    ])

    const result = await session.flush()
    expect(result.status).toBe('failed')
    if (result.status === 'failed') {
      expect(result.message).toContain('injected download failure')
    }

    // The file never changed...
    expect(failing.downloads).toEqual([])
    expect(Array.from(failing.bytes())).toEqual(Array.from(committedBytes))
    expect(await sha256Hex(failing.bytes())).toBe(committedHash)
    const onDisk = await failing.adapter.read(PORTABLE_PATH)
    expect(Array.from(onDisk.bytes)).toEqual(Array.from(committedBytes))
    expect(onDisk.hash).toBe(committedHash)

    // ...and the session was restored to the last committed container, so the
    // failed edit is not silently retained as if it had been saved.
    const state = await session.store.readRevisionState(digest)
    expect(state.current.ordinal).toBe(0)
    expect(await session.isDirty()).toBe(false)
    const original = await session.store.readOriginalSource(digest)
    expect(Array.from(original.bytes)).toEqual(Array.from(amlBytes()))
  })

  it('refuses a stale flush when the container changed underneath it', async () => {
    const seed = portableFile()
    const seeding = await openArisWorkspace(seed.adapter)
    const { digest } = await importInto(seeding)
    await seeding.flush()

    // Two sessions open the same container file, as two tabs would.
    const file = portableFile(seed.bytes())
    const stale = await ArisPortableWorkspaceSession.open(file.adapter)
    const winner = await ArisPortableWorkspaceSession.open(file.adapter)

    await winner.store.saveRevision(digest, [{ type: 'aris.winner', payload: {} }])
    expect((await winner.flush()).status).toBe('flushed')
    const winnerBytes = file.bytes()
    const winnerHash = await sha256Hex(winnerBytes)

    await stale.store.saveRevision(digest, [{ type: 'aris.stale', payload: {} }])
    const result = await stale.flush()
    expect(result.status).toBe('failed')
    if (result.status === 'failed') {
      expect(result.message).toContain('changed outside OrbitPM')
    }

    // The winner's bytes are intact and the stale session did not half-apply.
    expect(Array.from(file.bytes())).toEqual(Array.from(winnerBytes))
    expect((await file.adapter.read(PORTABLE_PATH)).hash).toBe(winnerHash)
    const reopened = await ArisPortableWorkspaceSession.open(portableFile(file.bytes()).adapter)
    const commands = (await reopened.store.replayRevisions(digest)).commands
    expect(commands.map((command) => command.type)).toEqual(['aris.winner'])
    expect((await reopened.store.readOriginalSource(digest)).hash).toBe(digest)
  })

  it('refuses to silently replace a file that is not a container', async () => {
    const foreign = new SingleFileWorkspaceAdapter({
      path: 'AnimalWF.xml',
      bytes: amlBytes(),
      download: () => undefined
    })
    await expect(ArisPortableWorkspaceSession.open(foreign)).rejects.toThrow(
      expect.objectContaining({ code: 'not-a-container' })
    )
    // `initialize: true` alone does not make this safe: without an explicit
    // `path`, the only candidate is `foreign`'s one file, which has real
    // content (the opened AML). See the dedicated footgun test below for the
    // full "would have destroyed the source" proof.
    await expect(ArisPortableWorkspaceSession.open(foreign, { initialize: true })).rejects.toThrow(
      expect.objectContaining({ code: 'unsafe-default-target' })
    )
  })

  it('never lets a forgotten `path` destroy the workspace file it auto-selects', async () => {
    // Regression test for the portable-path footgun: with no `path` option,
    // portable mode used to default the container path to the workspace's
    // only file. In this application that file is the AML the user just
    // opened, so `initialize: true` plus a later `flush()` would have
    // silently replaced the user's source export with a JSON container,
    // violating the §1.2 original-source rule and §7.4 immutability.
    const originalBytes = amlBytes()
    const source = new SingleFileWorkspaceAdapter({
      path: 'AnimalWF.xml',
      bytes: originalBytes,
      download: () => {
        throw new Error('must never write: the caller forgot to pass an explicit path')
      }
    })

    // The previously-dangerous call: no `path`, just `initialize: true`.
    await expect(openArisWorkspace(source, { initialize: true })).rejects.toThrow(
      expect.objectContaining({ code: 'unsafe-default-target' })
    )

    // The source file was never touched: not read-and-replaced, not flushed.
    const after = await source.read('AnimalWF.xml')
    expect(Array.from(after.bytes)).toEqual(Array.from(originalBytes))
    expect(after.hash).toBe(await sha256Hex(originalBytes))

    // The safe alternative — an explicit sibling target — works exactly as
    // before and never touches the source file either.
    const target = new SingleFileWorkspaceAdapter({
      path: arisPortableFileName('AnimalWF.xml'),
      bytes: new Uint8Array(),
      download: () => undefined
    })
    const session = await openArisWorkspace(target, {
      path: arisPortableFileName('AnimalWF.xml'),
      initialize: true
    })
    expect(await session.store.listPackages()).toEqual([])
    const untouched = await source.read('AnimalWF.xml')
    expect(Array.from(untouched.bytes)).toEqual(Array.from(originalBytes))

    // An auto-selected path is still accepted when the file is genuinely
    // empty — the shape a caller gets from purpose-building a fresh
    // single-file adapter as the intended new-container target.
    const freshTarget = new SingleFileWorkspaceAdapter({
      path: arisPortableFileName('AnimalWF.xml'),
      bytes: new Uint8Array(),
      download: () => undefined
    })
    const freshSession = await openArisWorkspace(freshTarget, { initialize: true })
    expect(await freshSession.store.listPackages()).toEqual([])
  })
})

describe('portable round-trip with directory mode', () => {
  it('exports a directory package to portable form with a byte-identical original', async () => {
    const { adapter, digest } = await directoryPackage('rt-directory')
    const before = await collectArisPackageArchive(adapter, digest)

    const container = await collectArisPortableContainer(adapter)
    const bytes = serializeArisPortableContainer(container)
    const reparsed = await parseArisPortableContainer(bytes)

    const portable = portableFile(bytes)
    const session = await ArisPortableWorkspaceSession.open(portable.adapter)
    const store = session.store
    const original = await store.readOriginalSource(digest)
    expect(Array.from(original.bytes)).toEqual(Array.from(amlBytes()))
    expect(original.hash).toBe(digest)
    expect(Array.from(readArisPortableOriginal(reparsed, digest))).toEqual(Array.from(amlBytes()))
    expect((await store.verifyIntegrity(digest)).problems).toEqual([])

    const after = await collectArisPackageArchive(session.workspace, digest)
    expect((await compareArisPackageArchives(before, after)).differences).toEqual([])
  })

  it('imports a portable container back into a directory workspace unchanged', async () => {
    const portable = portableFile()
    const session = await openArisWorkspace(portable.adapter)
    const { digest } = await importInto(session)
    await session.store.saveRevision(digest, [{ type: 'aris.a', payload: {} }])
    expect((await session.flush()).status).toBe('flushed')

    const before = await collectArisPackageArchive(session.workspace, digest)
    const container = await parseArisPortableContainer(portable.bytes())

    const directory = createWorkspace('rt-restored-directory')
    expect(await importArisPortableContainer(directory, container)).toEqual([digest])

    const store = new ArisPackageStore(directory)
    const original = await store.readOriginalSource(digest)
    expect(Array.from(original.bytes)).toEqual(Array.from(amlBytes()))
    expect(original.hash).toBe(digest)
    expect(await sha256Hex(original.bytes)).toBe(digest)
    expect((await store.verifyIntegrity(digest)).problems).toEqual([])
    expect((await store.replayRevisions(digest)).commands).toHaveLength(1)

    const after = await collectArisPackageArchive(directory, digest)
    expect((await compareArisPackageArchives(before, after)).differences).toEqual([])

    // The restored directory package keeps working exactly like a native one.
    await store.saveRevision(digest, [{ type: 'aris.b', payload: {} }])
    expect((await store.replayRevisions(digest)).commands).toHaveLength(2)
    expect((await store.readOriginalSource(digest)).hash).toBe(digest)
  })

  it('survives a directory -> portable -> directory -> portable cycle', async () => {
    const { adapter, digest } = await directoryPackage('cycle-directory')
    const firstContainer = await collectArisPortableContainer(adapter)
    const firstBytes = serializeArisPortableContainer(firstContainer)

    const restored = createWorkspace('cycle-restored')
    await importArisPortableContainer(restored, await parseArisPortableContainer(firstBytes))
    const secondBytes = serializeArisPortableContainer(await collectArisPortableContainer(restored))

    expect(Array.from(secondBytes)).toEqual(Array.from(firstBytes))
    expect(Array.from(readArisPortableOriginal(firstContainer, digest))).toEqual(
      Array.from(amlBytes())
    )
  })

  it('hydrates a container into the same tree a directory workspace holds', async () => {
    const { adapter, digest } = await directoryPackage('hydrate-directory')
    const container = await collectArisPortableContainer(adapter)
    const hydrated = hydrateArisPortableContainer(container, 'hydrated')

    const directoryFiles = (await adapter.list(''))
      .filter((entry) => entry.kind === 'file')
      .map((entry) => entry.path)
      .sort()
    const hydratedFiles = (await hydrated.list(''))
      .filter((entry) => entry.kind === 'file')
      .map((entry) => entry.path)
      .sort()
    expect(hydratedFiles).toEqual(directoryFiles)

    for (const path of directoryFiles) {
      expect((await hydrated.read(path)).hash, path).toBe((await adapter.read(path)).hash)
    }
    expect((await new ArisPackageStore(hydrated).verifyIntegrity(digest)).problems).toEqual([])
  })
})

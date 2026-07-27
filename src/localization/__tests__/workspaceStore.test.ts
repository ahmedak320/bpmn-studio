import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import {
  assertLocalizationReviewCurrent,
  inspectDiagramLocalization,
  type LocalizationModeler
} from '../modelerAdapter'
import {
  WORKSPACE_GLOSSARY_FORMAT,
  WORKSPACE_GLOSSARY_LIMITS,
  WORKSPACE_GLOSSARY_PATH,
  WORKSPACE_LOCALIZATION_PUBLIC_CONTRACT,
  WORKSPACE_TRANSLATION_MEMORY_FORMAT,
  WORKSPACE_TRANSLATION_MEMORY_LIMITS,
  WORKSPACE_TRANSLATION_MEMORY_PATH,
  WorkspaceLocalizationConflictError,
  WorkspaceLocalizationResourceLimitError,
  WorkspaceLocalizationStore,
  WorkspaceLocalizationValidationError,
  createWorkspaceGlossaryDocument,
  createWorkspaceTranslationMemoryDocument,
  parseWorkspaceGlossaryJson,
  parseWorkspaceTranslationMemoryJson,
  serializeWorkspaceGlossaryDocument,
  serializeWorkspaceTranslationMemoryDocument
} from '../workspaceStore'
import {
  MemoryWorkspaceAdapter,
  SingleFileWorkspaceAdapter,
  WORKSPACE_BACKUP_MANIFEST_PATH,
  WorkspaceOperationError,
  type SaveOutcome
} from '../../workspace/adapters'
import type { GlossaryEntry, TranslationMemoryEntry } from '../types'

const decode = (bytes: Uint8Array): string =>
  new TextDecoder('utf-8', { fatal: true }).decode(bytes)

async function jsonFile(
  adapter: MemoryWorkspaceAdapter,
  path: string
): Promise<Record<string, unknown>> {
  return JSON.parse(decode((await adapter.read(path)).bytes)) as Record<string, unknown>
}

function localizationModeler(english: string): LocalizationModeler {
  const process = {
    $type: 'bpmn:Process',
    id: 'Process_1',
    $attrs: { 'orbitpm:activeLang': 'en' },
    flowElements: [] as unknown[]
  }
  const task = {
    $type: 'bpmn:Task',
    id: 'Task_1',
    name: english,
    $attrs: { 'orbitpm:nameEn': english },
    $parent: process
  }
  process.flowElements.push(task)
  return {
    getDefinitions: () => ({
      $type: 'bpmn:Definitions',
      id: 'Definitions_1',
      rootElements: [process]
    }),
    get: () => {
      throw new Error('inspectDiagramLocalization should use getDefinitions')
    }
  }
}

describe('public workspace localization store', () => {
  it('seeds versioned public files and includes both in a complete workspace backup', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'workspace:public-i18n' })
    const state = await new WorkspaceLocalizationStore(adapter).load()

    expect(state.resources.glossary).toEqual([
      { en: 'API', ar: 'API', neutral: true },
      { en: 'SLA', ar: 'SLA', neutral: true },
      { en: 'DMT HUB', ar: 'DMT HUB', neutral: true }
    ])
    expect(state.resources.translationMemory).toEqual([])
    expect(state.files.glossary.document).toMatchObject({
      format: WORKSPACE_GLOSSARY_FORMAT,
      version: 1
    })
    expect(state.files.translationMemory.document).toMatchObject({
      format: WORKSPACE_TRANSLATION_MEMORY_FORMAT,
      version: 1
    })
    expect((await adapter.list()).map((entry) => entry.path)).toEqual(
      expect.arrayContaining([
        '.orbitpm',
        '.orbitpm/i18n',
        WORKSPACE_GLOSSARY_PATH,
        WORKSPACE_TRANSLATION_MEMORY_PATH
      ])
    )
    expect(WORKSPACE_LOCALIZATION_PUBLIC_CONTRACT).toMatchObject({
      scope: 'public-workspace',
      includedInWorkspaceBackup: true,
      acceptedTranslationPairsOnly: true
    })

    const archive = unzipSync(
      new Uint8Array(
        await (
          await adapter.exportBackup({
            generatedAt: new Date('2026-07-26T00:00:00.000Z')
          })
        ).arrayBuffer()
      )
    )
    expect(Object.keys(archive)).toEqual(
      expect.arrayContaining([
        WORKSPACE_BACKUP_MANIFEST_PATH,
        `workspace/${WORKSPACE_GLOSSARY_PATH}`,
        `workspace/${WORKSPACE_TRANSLATION_MEMORY_PATH}`
      ])
    )
    expect(JSON.parse(strFromU8(archive[`workspace/${WORKSPACE_GLOSSARY_PATH}`]))).toEqual(
      await jsonFile(adapter, WORKSPACE_GLOSSARY_PATH)
    )
  })

  it('migrates legacy top-level arrays with hash-conditional atomic writes', async () => {
    const legacyGlossary = JSON.stringify([{ en: 'Review request', ar: 'مراجعة الطلب' }])
    const legacyMemory = JSON.stringify([
      {
        en: 'Archive request',
        ar: 'أرشفة الطلب',
        accepted: true,
        acceptedAt: '2026-07-26T00:00:00.000Z'
      }
    ])
    const adapter = new MemoryWorkspaceAdapter({
      id: 'workspace:migrate-i18n',
      files: {
        [WORKSPACE_GLOSSARY_PATH]: legacyGlossary,
        [WORKSPACE_TRANSLATION_MEMORY_PATH]: legacyMemory
      }
    })
    const glossaryBefore = await adapter.read(WORKSPACE_GLOSSARY_PATH)
    const memoryBefore = await adapter.read(WORKSPACE_TRANSLATION_MEMORY_PATH)
    const writeAtomic = vi.spyOn(adapter, 'writeAtomic')

    const state = await new WorkspaceLocalizationStore(adapter).load()

    expect(state.resources.glossary).toEqual([{ en: 'Review request', ar: 'مراجعة الطلب' }])
    expect(state.resources.translationMemory).toEqual([
      {
        en: 'Archive request',
        ar: 'أرشفة الطلب',
        accepted: true,
        acceptedAt: '2026-07-26T00:00:00.000Z'
      }
    ])
    expect(await jsonFile(adapter, WORKSPACE_GLOSSARY_PATH)).toMatchObject({
      format: WORKSPACE_GLOSSARY_FORMAT,
      version: 1
    })
    expect(await jsonFile(adapter, WORKSPACE_TRANSLATION_MEMORY_PATH)).toMatchObject({
      format: WORKSPACE_TRANSLATION_MEMORY_FORMAT,
      version: 1
    })
    expect(writeAtomic).toHaveBeenCalledWith(
      WORKSPACE_GLOSSARY_PATH,
      expect.any(Uint8Array),
      glossaryBefore.hash,
      expect.objectContaining({
        expectedWorkspaceId: adapter.id
      })
    )
    expect(writeAtomic).toHaveBeenCalledWith(
      WORKSPACE_TRANSLATION_MEMORY_PATH,
      expect.any(Uint8Array),
      memoryBefore.hash,
      expect.objectContaining({
        expectedWorkspaceId: adapter.id
      })
    )
  })

  it.each([
    {
      name: 'malformed JSON',
      path: WORKSPACE_GLOSSARY_PATH,
      bytes: '{"format":',
      message: 'valid JSON'
    },
    {
      name: 'future schema',
      path: WORKSPACE_GLOSSARY_PATH,
      bytes: JSON.stringify({
        format: WORKSPACE_GLOSSARY_FORMAT,
        version: 2,
        entries: []
      }),
      message: 'unsupported schema version'
    },
    {
      name: 'unaccepted translation candidate',
      path: WORKSPACE_TRANSLATION_MEMORY_PATH,
      bytes: JSON.stringify({
        format: WORKSPACE_TRANSLATION_MEMORY_FORMAT,
        version: 1,
        entries: [
          {
            en: 'Review request',
            ar: 'مراجعة الطلب',
            accepted: false
          }
        ]
      }),
      message: 'must be true'
    },
    {
      name: 'malformed UTF-8',
      path: WORKSPACE_GLOSSARY_PATH,
      bytes: new Uint8Array([0xc3, 0x28]),
      message: 'valid UTF-8'
    }
  ])('rejects $name without replacing the public file', async ({ path, bytes, message }) => {
    const adapter = new MemoryWorkspaceAdapter({
      id: `workspace:corrupt:${path}`,
      files: [{ path, bytes }]
    })
    const before = await adapter.read(path)

    await expect(new WorkspaceLocalizationStore(adapter).load()).rejects.toMatchObject({
      name: 'WorkspaceLocalizationValidationError',
      code: 'invalid-resource',
      path: expect.stringContaining(path)
    })
    await expect(new WorkspaceLocalizationStore(adapter).load()).rejects.toThrow(message)
    expect((await adapter.read(path)).hash).toBe(before.hash)
  })

  it('edits and persists curated terms while caching only explicitly accepted pairs', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'workspace:edit-i18n' })
    const store = new WorkspaceLocalizationStore(adapter, {
      now: () => new Date('2026-07-26T12:00:00.000Z')
    })
    await store.load()

    const afterGlossary = await store.editGlossary((draft) => {
      draft.push({ en: 'Review request', ar: 'مراجعة الطلب' })
    })
    expect(afterGlossary.resources.glossary.at(-1)).toEqual({
      en: 'Review request',
      ar: 'مراجعة الطلب'
    })
    const afterAcceptance = await store.acceptTranslationPair({
      en: 'Archive request',
      ar: 'أرشفة الطلب'
    })
    expect(afterAcceptance.resources.translationMemory).toEqual([
      {
        en: 'Archive request',
        ar: 'أرشفة الطلب',
        accepted: true,
        acceptedAt: '2026-07-26T12:00:00.000Z'
      }
    ])
    expect(await jsonFile(adapter, WORKSPACE_GLOSSARY_PATH)).toMatchObject({
      entries: expect.arrayContaining([{ en: 'Review request', ar: 'مراجعة الطلب' }])
    })
    expect(await jsonFile(adapter, WORKSPACE_TRANSLATION_MEMORY_PATH)).toMatchObject({
      entries: [
        {
          en: 'Archive request',
          ar: 'أرشفة الطلب',
          accepted: true,
          acceptedAt: '2026-07-26T12:00:00.000Z'
        }
      ]
    })

    const beforeRejectedWrite = await adapter.read(WORKSPACE_TRANSLATION_MEMORY_PATH)
    const unaccepted = [
      {
        en: 'Do not cache',
        ar: 'لا تخزن',
        accepted: false
      }
    ] as unknown as readonly TranslationMemoryEntry[]
    await expect(store.replaceTranslationMemory(unaccepted)).rejects.toBeInstanceOf(
      WorkspaceLocalizationValidationError
    )
    expect((await adapter.read(WORKSPACE_TRANSLATION_MEMORY_PATH)).hash).toBe(
      beforeRejectedWrite.hash
    )
  })

  it('uses compare-and-set hashes so stale editors cannot overwrite external changes', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'workspace:conflict-i18n' })
    const first = new WorkspaceLocalizationStore(adapter)
    const stale = new WorkspaceLocalizationStore(adapter)
    await first.load()
    await stale.load()

    await first.editGlossary((draft) => {
      draft.push({ en: 'First edit', ar: 'التعديل الأول' })
    })
    await expect(
      stale.editGlossary((draft) => {
        draft.push({ en: 'Stale edit', ar: 'تعديل قديم' })
      })
    ).rejects.toMatchObject({
      name: 'WorkspaceLocalizationConflictError',
      code: 'external-conflict',
      path: WORKSPACE_GLOSSARY_PATH
    })

    expect((await jsonFile(adapter, WORKSPACE_GLOSSARY_PATH)).entries).toEqual(
      expect.arrayContaining([{ en: 'First edit', ar: 'التعديل الأول' }])
    )
    expect(
      JSON.stringify((await jsonFile(adapter, WORKSPACE_GLOSSARY_PATH)).entries)
    ).not.toContain('Stale edit')

    await stale.load()
    const recovered = await stale.editGlossary((draft) => {
      draft.push({ en: 'Fresh edit', ar: 'تعديل جديد' })
    })
    expect(recovered.resources.glossary.map((entry) => entry.en)).toEqual(
      expect.arrayContaining(['First edit', 'Fresh edit'])
    )
  })

  it('upserts only an exact accepted pair and retains ordered synonyms', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'workspace:synonyms-i18n' })
    const store = new WorkspaceLocalizationStore(adapter)
    await store.load()
    await store.acceptTranslationPair({
      en: 'Approve request',
      ar: 'اعتماد الطلب',
      acceptedAt: '2026-07-26T01:00:00.000Z'
    })
    await store.acceptTranslationPair({
      en: 'Accept request',
      ar: 'اعتماد الطلب',
      acceptedAt: '2026-07-26T02:00:00.000Z'
    })
    await store.acceptTranslationPair({
      en: 'Approve request',
      ar: 'الموافقة على الطلب',
      acceptedAt: '2026-07-26T03:00:00.000Z'
    })
    const state = await store.acceptTranslationPair({
      en: 'Approve request',
      ar: 'اعتماد الطلب',
      acceptedAt: '2026-07-26T04:00:00.000Z'
    })

    expect(state.resources.translationMemory).toEqual([
      {
        en: 'Approve request',
        ar: 'اعتماد الطلب',
        accepted: true,
        acceptedAt: '2026-07-26T04:00:00.000Z'
      },
      {
        en: 'Accept request',
        ar: 'اعتماد الطلب',
        accepted: true,
        acceptedAt: '2026-07-26T02:00:00.000Z'
      },
      {
        en: 'Approve request',
        ar: 'الموافقة على الطلب',
        accepted: true,
        acceptedAt: '2026-07-26T03:00:00.000Z'
      }
    ])
  })

  it('accepts a reviewed batch with one atomic translation-memory write', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'workspace:batch-i18n' })
    const store = new WorkspaceLocalizationStore(adapter)
    await store.load()
    const writeAtomic = vi.spyOn(adapter, 'writeAtomic')

    const state = await store.acceptTranslationPairs([
      {
        en: 'Review request',
        ar: 'مراجعة الطلب',
        acceptedAt: '2026-07-26T01:00:00.000Z'
      },
      {
        en: 'Archive request',
        ar: 'أرشفة الطلب',
        acceptedAt: '2026-07-26T02:00:00.000Z'
      },
      {
        en: 'Review request',
        ar: 'مراجعة الطلب',
        acceptedAt: '2026-07-26T03:00:00.000Z'
      }
    ])

    expect(writeAtomic).toHaveBeenCalledTimes(1)
    expect(writeAtomic).toHaveBeenCalledWith(
      WORKSPACE_TRANSLATION_MEMORY_PATH,
      expect.any(Uint8Array),
      expect.any(String),
      expect.objectContaining({ expectedWorkspaceId: adapter.id })
    )
    expect(state.resources.translationMemory).toEqual([
      {
        en: 'Review request',
        ar: 'مراجعة الطلب',
        accepted: true,
        acceptedAt: '2026-07-26T03:00:00.000Z'
      },
      {
        en: 'Archive request',
        ar: 'أرشفة الطلب',
        accepted: true,
        acceptedAt: '2026-07-26T02:00:00.000Z'
      }
    ])
  })

  it('merges five thousand reviewed pairs within the linear-operation budget', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'workspace:large-batch-i18n' })
    const cooperativeYield = vi.fn(async () => Promise.resolve())
    const store = new WorkspaceLocalizationStore(adapter, { cooperativeYield })
    await store.load()
    const writeAtomic = vi.spyOn(adapter, 'writeAtomic')
    const inputs = Array.from({ length: 5_000 }, (_, index) => ({
      en: `Review request ${index}`,
      ar: `مراجعة الطلب ${index}`,
      acceptedAt: '2026-07-26T03:00:00.000Z'
    }))

    const startedAt = performance.now()
    const state = await store.acceptTranslationPairs(inputs)
    const elapsedMs = performance.now() - startedAt

    expect(elapsedMs).toBeLessThan(1_500)
    expect(state.resources.translationMemory).toHaveLength(5_000)
    expect(state.resources.translationMemory[4_999]).toMatchObject(inputs[4_999]!)
    expect(writeAtomic).toHaveBeenCalledTimes(1)
    expect(cooperativeYield.mock.calls.length).toBeGreaterThan(75)
  })

  it('preserves stable duplicate positions while the last normalized batch duplicate wins', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'workspace:indexed-duplicates-i18n' })
    const store = new WorkspaceLocalizationStore(adapter, {
      cooperativeYield: async () => Promise.resolve()
    })
    await store.load()
    await store.replaceTranslationMemory([
      {
        en: 'Review request',
        ar: 'مراجعة الطلب',
        accepted: true,
        acceptedAt: '2026-07-26T01:00:00.000Z'
      },
      {
        en: 'Archive request',
        ar: 'أرشفة الطلب',
        accepted: true,
        acceptedAt: '2026-07-26T02:00:00.000Z'
      },
      {
        en: 'Review request',
        ar: 'مراجعة الطلب',
        accepted: true,
        acceptedAt: '2026-07-26T03:00:00.000Z'
      }
    ])

    const state = await store.acceptTranslationPairs([
      {
        en: ' REVIEW REQUEST ',
        ar: ' مراجعة الطلب ',
        acceptedAt: '2026-07-26T04:00:00.000Z'
      },
      {
        en: 'review request',
        ar: 'مراجعة الطلب',
        acceptedAt: '2026-07-26T05:00:00.000Z'
      }
    ])

    expect(state.resources.translationMemory).toEqual([
      {
        en: 'review request',
        ar: 'مراجعة الطلب',
        accepted: true,
        acceptedAt: '2026-07-26T05:00:00.000Z'
      },
      {
        en: 'Archive request',
        ar: 'أرشفة الطلب',
        accepted: true,
        acceptedAt: '2026-07-26T02:00:00.000Z'
      }
    ])
  })

  it('fails visibly at documented resource limits without dropping or writing any pair', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'workspace:batch-limit-i18n' })
    const store = new WorkspaceLocalizationStore(adapter)
    const before = await store.load()
    const writeAtomic = vi.spyOn(adapter, 'writeAtomic')
    const overLimit = Array.from(
      { length: WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxBatchEntries + 1 },
      () => ({ en: 'Review request', ar: 'مراجعة الطلب' })
    )

    await expect(store.acceptTranslationPairs(overLimit)).rejects.toMatchObject({
      name: 'WorkspaceLocalizationResourceLimitError',
      code: 'resource-limit',
      resource: 'batch-entries',
      limit: WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxBatchEntries,
      actual: overLimit.length
    })
    expect(writeAtomic).not.toHaveBeenCalled()
    expect(store.current).toBe(before)
    expect((await jsonFile(adapter, WORKSPACE_TRANSLATION_MEMORY_PATH)).entries).toEqual([])

    expect(() =>
      createWorkspaceTranslationMemoryDocument([
        {
          en: 'R'.repeat(WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxEntryTextCodeUnits + 1),
          ar: 'مراجعة الطلب',
          accepted: true
        }
      ])
    ).toThrow(WorkspaceLocalizationResourceLimitError)
  })

  it('rejects an oversized translation-memory file before adapter copy/hash or JSON decode', async () => {
    const bytes = new Uint8Array(WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxFileBytes + 1)
    const adapter = new MemoryWorkspaceAdapter({
      id: 'workspace:oversized-tm',
      files: [{ path: WORKSPACE_TRANSLATION_MEMORY_PATH, bytes }]
    })
    const read = vi.spyOn(adapter, 'read')

    await expect(new WorkspaceLocalizationStore(adapter).load()).rejects.toMatchObject({
      name: 'WorkspaceLocalizationResourceLimitError',
      code: 'resource-limit',
      resource: 'file-bytes',
      limit: WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxFileBytes,
      actual: bytes.byteLength
    })
    expect(read).toHaveBeenCalledWith(WORKSPACE_TRANSLATION_MEMORY_PATH, {
      maxBytes: WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxFileBytes,
      signal: undefined
    })
  })

  it('rejects excessive JSON depth and structural work before JSON.parse', () => {
    const depth = WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxJsonDepth + 1
    expect(() =>
      parseWorkspaceTranslationMemoryJson(`${'['.repeat(depth)}0${']'.repeat(depth)}`)
    ).toThrow(
      expect.objectContaining({
        resource: 'json-depth',
        limit: WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxJsonDepth
      })
    )

    const items = WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxJsonStructuralItems + 1
    expect(() => parseWorkspaceTranslationMemoryJson(`[${'0,'.repeat(items)}0]`)).toThrow(
      expect.objectContaining({
        resource: 'json-items',
        limit: WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxJsonStructuralItems
      })
    )
  })

  it('bounds glossary entries, text, JSON work, and encoded writes like translation memory', async () => {
    expect(() =>
      createWorkspaceGlossaryDocument(
        Array.from({ length: WORKSPACE_GLOSSARY_LIMITS.maxEntries + 1 }, () => ({
          en: 'API',
          ar: 'API',
          neutral: true
        }))
      )
    ).toThrow(
      expect.objectContaining({
        name: 'WorkspaceLocalizationResourceLimitError',
        scope: 'glossary',
        resource: 'entries',
        limit: WORKSPACE_GLOSSARY_LIMITS.maxEntries
      })
    )
    expect(() =>
      createWorkspaceGlossaryDocument([
        {
          en: 'A'.repeat(WORKSPACE_GLOSSARY_LIMITS.maxEntryTextCodeUnits + 1),
          ar: 'API',
          neutral: true
        }
      ])
    ).toThrow(
      expect.objectContaining({
        scope: 'glossary',
        resource: 'entry-text',
        limit: WORKSPACE_GLOSSARY_LIMITS.maxEntryTextCodeUnits
      })
    )

    const depth = WORKSPACE_GLOSSARY_LIMITS.maxJsonDepth + 1
    expect(() => parseWorkspaceGlossaryJson(`${'['.repeat(depth)}0${']'.repeat(depth)}`)).toThrow(
      expect.objectContaining({
        scope: 'glossary',
        resource: 'json-depth',
        limit: WORKSPACE_GLOSSARY_LIMITS.maxJsonDepth
      })
    )
    const items = WORKSPACE_GLOSSARY_LIMITS.maxJsonStructuralItems + 1
    expect(() => parseWorkspaceGlossaryJson(`[${'0,'.repeat(items)}0]`)).toThrow(
      expect.objectContaining({
        scope: 'glossary',
        resource: 'json-items',
        limit: WORKSPACE_GLOSSARY_LIMITS.maxJsonStructuralItems
      })
    )

    const adapter = new MemoryWorkspaceAdapter({ id: 'workspace:escaped-glossary-limit' })
    const store = new WorkspaceLocalizationStore(adapter)
    await store.load()
    const writeAtomic = vi.spyOn(adapter, 'writeAtomic')
    const entries: GlossaryEntry[] = []
    let textCodeUnits = 0
    while (
      textCodeUnits + WORKSPACE_GLOSSARY_LIMITS.maxEntryTextCodeUnits * 2 <=
      WORKSPACE_GLOSSARY_LIMITS.maxDocumentTextCodeUnits
    ) {
      const value = '\ud800'.repeat(WORKSPACE_GLOSSARY_LIMITS.maxEntryTextCodeUnits)
      entries.push({ en: value, ar: value, neutral: true })
      textCodeUnits += value.length * 2
    }
    await expect(store.replaceGlossary(entries)).rejects.toMatchObject({
      name: 'WorkspaceLocalizationResourceLimitError',
      scope: 'glossary',
      resource: 'file-bytes',
      limit: WORKSPACE_GLOSSARY_LIMITS.maxFileBytes
    })
    expect(writeAtomic).not.toHaveBeenCalled()
  })

  it('rejects an oversized glossary before adapter copy/hash or JSON decode', async () => {
    const bytes = new Uint8Array(WORKSPACE_GLOSSARY_LIMITS.maxFileBytes + 1)
    const adapter = new MemoryWorkspaceAdapter({
      id: 'workspace:oversized-glossary',
      files: [{ path: WORKSPACE_GLOSSARY_PATH, bytes }]
    })
    const read = vi.spyOn(adapter, 'read')

    await expect(new WorkspaceLocalizationStore(adapter).load()).rejects.toMatchObject({
      name: 'WorkspaceLocalizationResourceLimitError',
      code: 'resource-limit',
      scope: 'glossary',
      resource: 'file-bytes',
      limit: WORKSPACE_GLOSSARY_LIMITS.maxFileBytes,
      actual: bytes.byteLength
    })
    expect(read).toHaveBeenCalledWith(WORKSPACE_GLOSSARY_PATH, {
      maxBytes: WORKSPACE_GLOSSARY_LIMITS.maxFileBytes,
      signal: undefined
    })
  })

  it('checks JSON escape expansion against the byte limit before the atomic write', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'workspace:escaped-tm-limit' })
    const store = new WorkspaceLocalizationStore(adapter)
    await store.load()
    const writeAtomic = vi.spyOn(adapter, 'writeAtomic')
    const entries: TranslationMemoryEntry[] = []
    let textCodeUnits = 0
    for (
      let index = 0;
      textCodeUnits + WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxEntryTextCodeUnits + 8 <=
      WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxDocumentTextCodeUnits;
      index += 1
    ) {
      const prefix = `Review ${index} `
      const en = `${prefix}${'\ud800'.repeat(
        WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxEntryTextCodeUnits - prefix.length
      )}`
      const ar = `طلب ${index}`
      entries.push({ en, ar, accepted: true })
      textCodeUnits += en.length + ar.length
    }

    await expect(store.replaceTranslationMemory(entries)).rejects.toMatchObject({
      name: 'WorkspaceLocalizationResourceLimitError',
      resource: 'file-bytes',
      limit: WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxFileBytes
    })
    expect(writeAtomic).not.toHaveBeenCalled()
    expect(store.current?.resources.translationMemory).toEqual([])
  }, 20_000)

  it('yields and honours cancellation before the atomic mutation starts', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'workspace:cancel-large-batch-i18n' })
    const controller = new AbortController()
    let yields = 0
    const store = new WorkspaceLocalizationStore(adapter, {
      cooperativeYield: async () => {
        yields += 1
        if (yields === 2) controller.abort()
        await Promise.resolve()
      }
    })
    await store.load()
    const writeAtomic = vi.spyOn(adapter, 'writeAtomic')
    const inputs = Array.from({ length: 2_000 }, (_, index) => ({
      en: `Review request ${index}`,
      ar: `مراجعة الطلب ${index}`
    }))

    await expect(
      store.acceptTranslationPairs(inputs, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(yields).toBe(2)
    expect(writeAtomic).not.toHaveBeenCalled()
    expect(store.current?.resources.translationMemory).toEqual([])
    expect((await jsonFile(adapter, WORKSPACE_TRANSLATION_MEMORY_PATH)).entries).toEqual([])
  })

  it('retains atomic CAS semantics across an explicit reload-and-retry', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'workspace:batch-cas-retry-i18n' })
    const winner = new WorkspaceLocalizationStore(adapter, {
      cooperativeYield: async () => Promise.resolve()
    })
    const stale = new WorkspaceLocalizationStore(adapter, {
      cooperativeYield: async () => Promise.resolve()
    })
    await winner.load()
    await stale.load()
    await winner.acceptTranslationPair({
      en: 'Review request',
      ar: 'مراجعة الطلب'
    })

    await expect(
      stale.acceptTranslationPair({
        en: 'Archive request',
        ar: 'أرشفة الطلب'
      })
    ).rejects.toBeInstanceOf(WorkspaceLocalizationConflictError)
    expect((await jsonFile(adapter, WORKSPACE_TRANSLATION_MEMORY_PATH)).entries).toHaveLength(1)

    await stale.load()
    const retried = await stale.acceptTranslationPair({
      en: 'Archive request',
      ar: 'أرشفة الطلب'
    })
    expect(retried.resources.translationMemory.map((entry) => entry.en)).toEqual([
      'Review request',
      'Archive request'
    ])
  })

  it('rejects a stale whole-array editor save after an accepted pair advances the hash', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'workspace:editor-i18n-race' })
    const store = new WorkspaceLocalizationStore(adapter)
    const opened = await store.load()
    const staleHash = opened.files.translationMemory.hash
    await store.acceptTranslationPairs([
      {
        en: 'Review request',
        ar: 'مراجعة الطلب',
        acceptedAt: '2026-07-26T03:00:00.000Z'
      }
    ])

    await expect(
      store.replaceTranslationMemory([], { expectedHash: staleHash })
    ).rejects.toBeInstanceOf(WorkspaceLocalizationConflictError)
    expect((await jsonFile(adapter, WORKSPACE_TRANSLATION_MEMORY_PATH)).entries).toEqual([
      {
        en: 'Review request',
        ar: 'مراجعة الطلب',
        accepted: true,
        acceptedAt: '2026-07-26T03:00:00.000Z'
      }
    ])
  })

  it('rejects a stale caller-view glossary replacement after the store advances', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'workspace:glossary-editor-race' })
    const store = new WorkspaceLocalizationStore(adapter)
    const opened = await store.load()
    const staleHash = opened.files.glossary.hash
    const winner = [{ en: 'Winner term', ar: 'المصطلح الفائز' }]
    await store.replaceGlossary(winner, { expectedHash: staleHash })

    await expect(
      store.replaceGlossary([{ en: 'Stale term', ar: 'مصطلح قديم' }], {
        expectedHash: staleHash
      })
    ).rejects.toBeInstanceOf(WorkspaceLocalizationConflictError)
    expect((await jsonFile(adapter, WORKSPACE_GLOSSARY_PATH)).entries).toEqual(winner)
  })

  it('does not clobber an external edit that races a legacy migration', async () => {
    let changed = false
    const external = JSON.stringify([{ en: 'External edit', ar: 'تعديل خارجي' }])
    const adapter = new MemoryWorkspaceAdapter({
      id: 'workspace:migration-race',
      files: {
        [WORKSPACE_GLOSSARY_PATH]: JSON.stringify([{ en: 'Legacy edit', ar: 'تعديل قديم' }]),
        [WORKSPACE_TRANSLATION_MEMORY_PATH]: '[]'
      },
      beforeWrite(path) {
        if (path === WORKSPACE_GLOSSARY_PATH && !changed) {
          changed = true
          adapter.replaceExternally(path, external)
        }
      }
    })

    await expect(new WorkspaceLocalizationStore(adapter).load()).rejects.toBeInstanceOf(
      WorkspaceLocalizationConflictError
    )
    expect(decode((await adapter.read(WORKSPACE_GLOSSARY_PATH)).bytes)).toBe(external)
  })

  it('keeps a failed corrupt load read-only and recovers the same queued store after repair', async () => {
    const corrupt = '{"format":"broken","version":1,"entries":[]}'
    const adapter = new MemoryWorkspaceAdapter({
      id: 'workspace:corrupt-recovery',
      files: {
        [WORKSPACE_GLOSSARY_PATH]: corrupt,
        [WORKSPACE_TRANSLATION_MEMORY_PATH]: serializeWorkspaceTranslationMemoryDocument(
          createWorkspaceTranslationMemoryDocument([])
        )
      }
    })
    const store = new WorkspaceLocalizationStore(adapter)
    const writeAtomic = vi.spyOn(adapter, 'writeAtomic')
    const before = await adapter.read(WORKSPACE_GLOSSARY_PATH)

    await expect(store.load()).rejects.toBeInstanceOf(WorkspaceLocalizationValidationError)
    expect(store.current).toBeUndefined()
    expect(writeAtomic).not.toHaveBeenCalled()
    expect((await adapter.read(WORKSPACE_GLOSSARY_PATH)).hash).toBe(before.hash)

    const repaired = [{ en: 'Recovered term', ar: 'مصطلح مستعاد' }]
    adapter.replaceExternally(
      WORKSPACE_GLOSSARY_PATH,
      serializeWorkspaceGlossaryDocument(createWorkspaceGlossaryDocument(repaired))
    )
    const recovered = await store.load()

    expect(recovered).toBe(store.current)
    expect(recovered.resources.glossary).toEqual(repaired)
    expect(recovered.resources.translationMemory).toEqual([])
    expect(writeAtomic).not.toHaveBeenCalled()
  })

  it('invalidates a prior aggregate after failed reload and blocks peer saves until all files recover', async () => {
    const glossary = [{ en: 'Review request', ar: 'مراجعة الطلب' }]
    const adapter = new MemoryWorkspaceAdapter({
      id: 'workspace:failed-reload-invalidation',
      files: {
        [WORKSPACE_GLOSSARY_PATH]: serializeWorkspaceGlossaryDocument(
          createWorkspaceGlossaryDocument(glossary)
        ),
        [WORKSPACE_TRANSLATION_MEMORY_PATH]: serializeWorkspaceTranslationMemoryDocument(
          createWorkspaceTranslationMemoryDocument([])
        )
      }
    })
    const store = new WorkspaceLocalizationStore(adapter)
    const opened = await store.load()
    const glossaryBefore = await adapter.read(WORKSPACE_GLOSSARY_PATH)
    adapter.replaceExternally(
      WORKSPACE_TRANSLATION_MEMORY_PATH,
      '{"format":"broken","version":1,"entries":[]}'
    )
    const writeAtomic = vi.spyOn(adapter, 'writeAtomic')

    await expect(store.load()).rejects.toBeInstanceOf(WorkspaceLocalizationValidationError)
    expect(store.current).toBeUndefined()
    await expect(
      store.replaceGlossary([{ en: 'Must not save', ar: 'يجب ألا يحفظ' }], {
        expectedHash: opened.files.glossary.hash
      })
    ).rejects.toBeInstanceOf(WorkspaceLocalizationValidationError)
    expect(writeAtomic).not.toHaveBeenCalled()
    expect((await adapter.read(WORKSPACE_GLOSSARY_PATH)).hash).toBe(glossaryBefore.hash)

    adapter.replaceExternally(
      WORKSPACE_TRANSLATION_MEMORY_PATH,
      serializeWorkspaceTranslationMemoryDocument(createWorkspaceTranslationMemoryDocument([]))
    )
    const recovered = await store.replaceGlossary([{ en: 'Recovered save', ar: 'حفظ مستعاد' }], {
      expectedHash: opened.files.glossary.hash
    })
    expect(recovered).toBe(store.current)
    expect(recovered.resources.glossary).toEqual([{ en: 'Recovered save', ar: 'حفظ مستعاد' }])
  })

  it('preflights both resources before seeding or migrating either file', async () => {
    const corruptTranslationMemory = '{"format":"broken","version":1,"entries":[]}'
    const missingGlossary = new MemoryWorkspaceAdapter({
      id: 'workspace:two-phase-missing-glossary',
      files: {
        [WORKSPACE_TRANSLATION_MEMORY_PATH]: corruptTranslationMemory
      }
    })
    const missingWrite = vi.spyOn(missingGlossary, 'writeAtomic')

    await expect(new WorkspaceLocalizationStore(missingGlossary).load()).rejects.toBeInstanceOf(
      WorkspaceLocalizationValidationError
    )
    expect(missingWrite).not.toHaveBeenCalled()
    await expect(missingGlossary.read(WORKSPACE_GLOSSARY_PATH)).rejects.toMatchObject({
      code: 'not-found'
    })

    const legacyGlossary = JSON.stringify([{ en: 'Legacy term', ar: 'مصطلح قديم' }])
    const legacyBeforeFailure = new MemoryWorkspaceAdapter({
      id: 'workspace:two-phase-legacy-glossary',
      files: {
        [WORKSPACE_GLOSSARY_PATH]: legacyGlossary,
        [WORKSPACE_TRANSLATION_MEMORY_PATH]: corruptTranslationMemory
      }
    })
    const legacyWrite = vi.spyOn(legacyBeforeFailure, 'writeAtomic')

    await expect(new WorkspaceLocalizationStore(legacyBeforeFailure).load()).rejects.toBeInstanceOf(
      WorkspaceLocalizationValidationError
    )
    expect(legacyWrite).not.toHaveBeenCalled()
    expect(decode((await legacyBeforeFailure.read(WORKSPACE_GLOSSARY_PATH)).bytes)).toBe(
      legacyGlossary
    )
  })

  it('keeps a phase-two partial seed unavailable and safely adopts it on explicit retry', async () => {
    let failTranslationMemorySeed = true
    const adapter = new MemoryWorkspaceAdapter({
      id: 'workspace:two-phase-partial-seed',
      beforeWrite(path) {
        if (path !== WORKSPACE_TRANSLATION_MEMORY_PATH || !failTranslationMemorySeed) return
        throw new WorkspaceOperationError({
          code: 'quota-exceeded',
          operation: 'write',
          path,
          message: 'Translation-memory seed storage is full.'
        })
      }
    })
    const store = new WorkspaceLocalizationStore(adapter)

    await expect(store.load()).rejects.toMatchObject({
      name: 'WorkspaceLocalizationPartialLoadError',
      code: 'partial-load',
      committedPaths: [WORKSPACE_GLOSSARY_PATH],
      cause: {
        name: 'WorkspaceOperationError',
        code: 'quota-exceeded',
        path: WORKSPACE_TRANSLATION_MEMORY_PATH
      }
    })
    expect(store.current).toBeUndefined()
    expect(await jsonFile(adapter, WORKSPACE_GLOSSARY_PATH)).toMatchObject({
      format: WORKSPACE_GLOSSARY_FORMAT,
      version: 1
    })
    await expect(adapter.read(WORKSPACE_TRANSLATION_MEMORY_PATH)).rejects.toMatchObject({
      code: 'not-found'
    })

    failTranslationMemorySeed = false
    const recovered = await store.load()
    expect(recovered).toBe(store.current)
    expect(recovered.resources.translationMemory).toEqual([])
  })

  it('types a second-file migration CAS race after the first commit and recovers without clobbering', async () => {
    const legacyGlossary = JSON.stringify([{ en: 'Legacy term', ar: 'مصطلح قديم' }])
    const legacyTranslationMemory = JSON.stringify([
      {
        en: 'Legacy pair',
        ar: 'زوج قديم',
        accepted: true
      }
    ])
    const externalTranslationMemory = [
      {
        en: 'External pair',
        ar: 'زوج خارجي',
        accepted: true as const
      }
    ]
    let raced = false
    const adapter = new MemoryWorkspaceAdapter({
      id: 'workspace:two-phase-second-cas',
      files: {
        [WORKSPACE_GLOSSARY_PATH]: legacyGlossary,
        [WORKSPACE_TRANSLATION_MEMORY_PATH]: legacyTranslationMemory
      },
      beforeWrite(path) {
        if (path !== WORKSPACE_TRANSLATION_MEMORY_PATH || raced) return
        raced = true
        adapter.replaceExternally(
          path,
          serializeWorkspaceTranslationMemoryDocument(
            createWorkspaceTranslationMemoryDocument(externalTranslationMemory)
          )
        )
      }
    })
    const store = new WorkspaceLocalizationStore(adapter)

    await expect(store.load()).rejects.toMatchObject({
      name: 'WorkspaceLocalizationPartialLoadError',
      code: 'partial-load',
      committedPaths: [WORKSPACE_GLOSSARY_PATH],
      cause: {
        name: 'WorkspaceLocalizationConflictError',
        code: 'external-conflict',
        path: WORKSPACE_TRANSLATION_MEMORY_PATH
      }
    })
    expect(store.current).toBeUndefined()
    expect(await jsonFile(adapter, WORKSPACE_GLOSSARY_PATH)).toMatchObject({
      format: WORKSPACE_GLOSSARY_FORMAT,
      version: 1
    })
    expect((await jsonFile(adapter, WORKSPACE_TRANSLATION_MEMORY_PATH)).entries).toEqual(
      externalTranslationMemory
    )

    const recovered = await store.load()
    expect(recovered).toBe(store.current)
    expect(recovered.resources.translationMemory).toEqual(externalTranslationMemory)
  })

  it('adopts external files that win both creation races instead of overwriting them', async () => {
    const glossary = [{ en: 'External term', ar: 'مصطلح خارجي' }]
    const translationMemory = [
      {
        en: 'External pair',
        ar: 'زوج خارجي',
        accepted: true as const,
        acceptedAt: '2026-07-26T01:02:03.000Z'
      }
    ]
    const raced = new Set<string>()
    const adapter = new MemoryWorkspaceAdapter({
      id: 'workspace:seed-races',
      beforeWrite(path) {
        if (raced.has(path)) return
        raced.add(path)
        if (path === WORKSPACE_GLOSSARY_PATH) {
          adapter.replaceExternally(
            path,
            serializeWorkspaceGlossaryDocument(createWorkspaceGlossaryDocument(glossary))
          )
        }
        if (path === WORKSPACE_TRANSLATION_MEMORY_PATH) {
          adapter.replaceExternally(
            path,
            serializeWorkspaceTranslationMemoryDocument(
              createWorkspaceTranslationMemoryDocument(translationMemory)
            )
          )
        }
      }
    })
    const writeAtomic = vi.spyOn(adapter, 'writeAtomic')

    const state = await new WorkspaceLocalizationStore(adapter).load()

    expect(raced).toEqual(new Set([WORKSPACE_GLOSSARY_PATH, WORKSPACE_TRANSLATION_MEMORY_PATH]))
    expect(writeAtomic).toHaveBeenCalledTimes(2)
    expect(state.resources.glossary).toEqual(glossary)
    expect(state.resources.translationMemory).toEqual(translationMemory)
    expect(await jsonFile(adapter, WORKSPACE_GLOSSARY_PATH)).toEqual(
      JSON.parse(serializeWorkspaceGlossaryDocument(createWorkspaceGlossaryDocument(glossary)))
    )
  })

  it.each<{
    name: string
    outcome: SaveOutcome
    expectedCode: string
  }>([
    {
      name: 'storage failure',
      outcome: {
        ok: false,
        status: 'storage-failure',
        error: {
          code: 'quota-exceeded',
          operation: 'write',
          path: WORKSPACE_GLOSSARY_PATH,
          message: 'Localization storage is full.'
        }
      },
      expectedCode: 'quota-exceeded'
    },
    {
      name: 'stale workspace',
      outcome: {
        ok: false,
        status: 'stale-workspace',
        expectedWorkspaceId: 'workspace:seed-failure',
        actualWorkspaceId: 'workspace:replacement'
      },
      expectedCode: 'stale-workspace'
    }
  ])(
    'surfaces a $name during seed and succeeds on explicit reload',
    async ({ outcome, expectedCode }) => {
      const adapter = new MemoryWorkspaceAdapter({ id: 'workspace:seed-failure' })
      const originalWriteAtomic = adapter.writeAtomic.bind(adapter)
      vi.spyOn(adapter, 'writeAtomic')
        .mockResolvedValueOnce(outcome)
        .mockImplementation(originalWriteAtomic)
      const store = new WorkspaceLocalizationStore(adapter)

      await expect(store.load()).rejects.toMatchObject({
        name: 'WorkspaceOperationError',
        code: expectedCode,
        path: WORKSPACE_GLOSSARY_PATH
      })
      expect(store.current).toBeUndefined()

      const recovered = await store.load()
      expect(recovered).toBe(store.current)
      expect(recovered.resources.glossary).toEqual([
        { en: 'API', ar: 'API', neutral: true },
        { en: 'SLA', ar: 'SLA', neutral: true },
        { en: 'DMT HUB', ar: 'DMT HUB', neutral: true }
      ])
      expect(recovered.resources.translationMemory).toEqual([])
    }
  )

  it('serializes same-store edits and exposes resources to the non-App modeler API', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'workspace:api-i18n' })
    const store = new WorkspaceLocalizationStore(adapter, {
      now: () => new Date('2026-07-26T12:00:00.000Z')
    })
    await store.load()
    const [first, second] = await Promise.all([
      store.editGlossary((draft) => {
        draft.push({ en: 'One', ar: 'واحد' })
      }),
      store.editGlossary((draft) => {
        draft.push({ en: 'Two', ar: 'اثنان' })
      })
    ])
    expect(first.resources.glossary.some((entry) => entry.en === 'One')).toBe(true)
    expect(second.resources.glossary.map((entry) => entry.en)).toEqual(
      expect.arrayContaining(['One', 'Two'])
    )

    const state = await store.acceptTranslationPair({
      en: 'Review request',
      ar: 'مراجعة الطلب'
    })
    const review = inspectDiagramLocalization(
      localizationModeler('Review request'),
      'ar',
      state.resources
    )
    expect(review.localUpdates).toEqual([
      expect.objectContaining({
        property: 'orbitpm:nameAr',
        value: 'مراجعة الطلب',
        reason: 'translation-memory'
      })
    ])
    expect(review.queue).toEqual([])
    expect(review.complete).toBe(true)
    expect(review.localResources.translationMemory).toEqual(state.resources.translationMemory)
    expect(() =>
      assertLocalizationReviewCurrent(localizationModeler('Review request'), review)
    ).not.toThrow()
  })

  it('loads on the first edit and honors replacement arrays returned by both editors', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'workspace:first-edit' })
    const store = new WorkspaceLocalizationStore(adapter)

    const afterGlossary = await store.editGlossary(() => [
      { en: 'Replacement term', ar: 'مصطلح بديل' }
    ])
    expect(afterGlossary.resources.glossary).toEqual([{ en: 'Replacement term', ar: 'مصطلح بديل' }])

    const afterMemory = await store.editTranslationMemory(() => [
      {
        en: 'Replacement pair',
        ar: 'زوج بديل',
        accepted: true
      }
    ])
    expect(afterMemory.resources.translationMemory).toEqual([
      {
        en: 'Replacement pair',
        ar: 'زوج بديل',
        accepted: true
      }
    ])
    expect(store.current).toBe(afterMemory)
  })

  it('preserves ordered synonyms while validating scripts, timestamps, and unknown fields', () => {
    expect(
      parseWorkspaceGlossaryJson(
        JSON.stringify([
          { en: 'Review', ar: 'مراجعة' },
          { en: ' review ', ar: 'تدقيق' },
          { en: 'Audit', ar: 'مراجعة' }
        ])
      ).document.entries
    ).toEqual([
      { en: 'Review', ar: 'مراجعة' },
      { en: 'review', ar: 'تدقيق' },
      { en: 'Audit', ar: 'مراجعة' }
    ])
    expect(() =>
      parseWorkspaceGlossaryJson(
        JSON.stringify({
          format: WORKSPACE_GLOSSARY_FORMAT,
          version: 1,
          entries: [],
          credentials: 'must-not-live-here'
        })
      )
    ).toThrow(/unsupported field/)
    expect(() =>
      parseWorkspaceTranslationMemoryJson(
        JSON.stringify([{ en: 'Review', ar: 'مراجعة', accepted: false }])
      )
    ).toThrow(/must be true/)
    expect(() =>
      parseWorkspaceTranslationMemoryJson(
        JSON.stringify([
          {
            en: 'Review',
            ar: 'Still English',
            accepted: true,
            acceptedAt: '2026-07-26T00:00:00.000Z'
          }
        ])
      )
    ).toThrow(/meaningful Arabic/)
    expect(() =>
      parseWorkspaceTranslationMemoryJson(
        JSON.stringify([
          {
            en: 'Review',
            ar: 'مراجعة',
            accepted: true,
            acceptedAt: 'Sun, 26 Jul 2026 00:00:00 GMT'
          }
        ])
      )
    ).toThrow(/ISO-8601/)
    expect(() =>
      parseWorkspaceTranslationMemoryJson(
        JSON.stringify([
          {
            en: 'Review',
            ar: 'مراجعة',
            accepted: true,
            acceptedAt: '2026-02-30T00:00:00.000Z'
          }
        ])
      )
    ).toThrow(/ISO-8601/)
  })

  it.each([
    {
      name: 'a scalar document',
      parse: () => parseWorkspaceGlossaryJson('null'),
      message: /JSON object or a legacy top-level array/
    },
    {
      name: 'non-array glossary entries',
      parse: () =>
        parseWorkspaceGlossaryJson(
          JSON.stringify({
            format: WORKSPACE_GLOSSARY_FORMAT,
            version: 1,
            entries: {}
          })
        ),
      message: /must be an array/
    },
    {
      name: 'a scalar glossary row',
      parse: () => parseWorkspaceGlossaryJson(JSON.stringify([17])),
      message: /must be an object/
    },
    {
      name: 'a non-string term',
      parse: () => parseWorkspaceGlossaryJson(JSON.stringify([{ en: 17, ar: 'مراجعة' }])),
      message: /must be a string/
    },
    {
      name: 'control characters',
      parse: () =>
        parseWorkspaceGlossaryJson(JSON.stringify([{ en: 'Bad\u0000term', ar: 'مراجعة' }])),
      message: /control characters/
    },
    {
      name: 'an empty normalized term',
      parse: () => parseWorkspaceGlossaryJson(JSON.stringify([{ en: '   ', ar: 'مراجعة' }])),
      message: /must not be empty/
    },
    {
      name: 'multiple unsupported fields',
      parse: () =>
        parseWorkspaceGlossaryJson(
          JSON.stringify({
            format: WORKSPACE_GLOSSARY_FORMAT,
            version: 1,
            entries: [],
            secret: true,
            providerDraft: true
          })
        ),
      message: /unsupported fields/
    },
    {
      name: 'a non-boolean neutral marker',
      parse: () =>
        parseWorkspaceGlossaryJson(JSON.stringify([{ en: 'API', ar: 'API', neutral: 'yes' }])),
      message: /must be a boolean/
    },
    {
      name: 'a mismatched neutral pair',
      parse: () =>
        parseWorkspaceGlossaryJson(JSON.stringify([{ en: 'API', ar: 'Api', neutral: true }])),
      message: /same normalized value/
    },
    {
      name: 'Arabic text in the English field',
      parse: () => parseWorkspaceGlossaryJson(JSON.stringify([{ en: 'مراجعة', ar: 'مراجعة' }])),
      message: /valid English/
    },
    {
      name: 'non-array translation-memory entries',
      parse: () =>
        parseWorkspaceTranslationMemoryJson(
          JSON.stringify({
            format: WORKSPACE_TRANSLATION_MEMORY_FORMAT,
            version: 1,
            entries: {}
          })
        ),
      message: /must be an array/
    },
    {
      name: 'a scalar translation-memory row',
      parse: () => parseWorkspaceTranslationMemoryJson(JSON.stringify([17])),
      message: /must be an object/
    },
    {
      name: 'a non-string acceptance timestamp',
      parse: () =>
        parseWorkspaceTranslationMemoryJson(
          JSON.stringify([
            {
              en: 'Review',
              ar: 'مراجعة',
              accepted: true,
              acceptedAt: 17
            }
          ])
        ),
      message: /ISO-8601/
    }
  ])('rejects $name at the public schema boundary', ({ parse, message }) => {
    expect(parse).toThrow(message)
  })

  it('refuses single-file adapters because public i18n files require a workspace', () => {
    const adapter = new SingleFileWorkspaceAdapter({
      workspaceId: 'single:process',
      path: 'process.bpmn',
      bytes: new TextEncoder().encode('<definitions />'),
      download: vi.fn()
    })
    expect(() => new WorkspaceLocalizationStore(adapter)).toThrow(/directory or browser workspace/)
  })
})

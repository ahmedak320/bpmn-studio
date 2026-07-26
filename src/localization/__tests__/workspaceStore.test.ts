import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import {
  assertLocalizationReviewCurrent,
  inspectDiagramLocalization,
  type LocalizationModeler
} from '../modelerAdapter'
import {
  WORKSPACE_GLOSSARY_FORMAT,
  WORKSPACE_GLOSSARY_PATH,
  WORKSPACE_LOCALIZATION_PUBLIC_CONTRACT,
  WORKSPACE_TRANSLATION_MEMORY_FORMAT,
  WORKSPACE_TRANSLATION_MEMORY_PATH,
  WorkspaceLocalizationConflictError,
  WorkspaceLocalizationStore,
  WorkspaceLocalizationValidationError,
  parseWorkspaceGlossaryJson,
  parseWorkspaceTranslationMemoryJson
} from '../workspaceStore'
import {
  MemoryWorkspaceAdapter,
  SingleFileWorkspaceAdapter,
  WORKSPACE_BACKUP_MANIFEST_PATH
} from '../../workspace/adapters'
import type { TranslationMemoryEntry } from '../types'

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
    ).rejects.toBeInstanceOf(WorkspaceLocalizationConflictError)

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

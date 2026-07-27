// @vitest-environment jsdom

import { useState } from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setLang, t } from '../../i18n'
import type { GlossaryEntry, TranslationMemoryEntry } from '../../localization/types'
import { MemoryWorkspaceAdapter, WorkspaceOperationError } from '../../workspace/adapters'
import {
  WORKSPACE_GLOSSARY_PATH,
  WORKSPACE_TRANSLATION_MEMORY_PATH,
  WorkspaceLocalizationResourceLimitError,
  WorkspaceLocalizationStore,
  createWorkspaceGlossaryDocument,
  createWorkspaceTranslationMemoryDocument,
  serializeWorkspaceGlossaryDocument,
  serializeWorkspaceTranslationMemoryDocument,
  type WorkspaceLocalizationState
} from '../../localization/workspaceStore'
import {
  LocalizationResourcesEditor,
  type LocalizationResourcesEditorProps
} from '../LocalizationResourcesEditor'
import { VALIDATION_TECHNICAL_DETAIL_MAX_CODE_POINTS } from '../../validation/technicalEvidence'

const baseGlossary: readonly GlossaryEntry[] = [
  { en: 'API', ar: 'API', neutral: true },
  { en: 'SLA', ar: 'SLA', neutral: true }
]

const baseTranslationMemory: readonly TranslationMemoryEntry[] = [
  {
    en: 'Review request',
    ar: 'مراجعة الطلب',
    accepted: true,
    acceptedAt: '2026-07-26T01:00:00.000Z'
  },
  {
    en: 'Archive request',
    ar: 'أرشفة الطلب',
    accepted: true
  }
]

function workspaceState(
  glossary: readonly GlossaryEntry[] = baseGlossary,
  translationMemory: readonly TranslationMemoryEntry[] = baseTranslationMemory,
  revision = 'initial'
): WorkspaceLocalizationState {
  const glossaryDocument = createWorkspaceGlossaryDocument(glossary)
  const translationMemoryDocument = createWorkspaceTranslationMemoryDocument(translationMemory)
  return {
    files: {
      glossary: {
        path: WORKSPACE_GLOSSARY_PATH,
        document: glossaryDocument,
        hash: `glossary-${revision}`,
        size: 1,
        modifiedAt: 1
      },
      translationMemory: {
        path: WORKSPACE_TRANSLATION_MEMORY_PATH,
        document: translationMemoryDocument,
        hash: `translation-memory-${revision}`,
        size: 1,
        modifiedAt: 1
      }
    },
    resources: {
      glossary: glossaryDocument.entries,
      translationMemory: translationMemoryDocument.entries
    }
  }
}

function withSavedGlossary(
  initial: WorkspaceLocalizationState,
  entries: readonly GlossaryEntry[]
): WorkspaceLocalizationState {
  const saved = workspaceState(entries, initial.resources.translationMemory, 'saved-glossary')
  return {
    files: {
      glossary: saved.files.glossary,
      translationMemory: initial.files.translationMemory
    },
    resources: {
      glossary: saved.resources.glossary,
      translationMemory: initial.resources.translationMemory
    }
  }
}

function withSavedTranslationMemory(
  initial: WorkspaceLocalizationState,
  entries: readonly TranslationMemoryEntry[]
): WorkspaceLocalizationState {
  const saved = workspaceState(initial.resources.glossary, entries, 'saved-translation-memory')
  return {
    files: {
      glossary: initial.files.glossary,
      translationMemory: saved.files.translationMemory
    },
    resources: {
      glossary: initial.resources.glossary,
      translationMemory: saved.resources.translationMemory
    }
  }
}

function callbacks(
  initial = workspaceState()
): Pick<
  LocalizationResourcesEditorProps,
  'onSaveGlossary' | 'onSaveTranslationMemory' | 'onReload'
> {
  let current = initial
  return {
    onSaveGlossary: vi.fn(async (entries, _expectedHash) => {
      current = withSavedGlossary(current, entries)
      return current
    }),
    onSaveTranslationMemory: vi.fn(async (entries) => {
      current = withSavedTranslationMemory(current, entries)
      return current
    }),
    onReload: vi.fn(async () => current)
  }
}

function realLocalizationAdapter(
  options: ConstructorParameters<typeof MemoryWorkspaceAdapter>[0] = {}
): MemoryWorkspaceAdapter {
  return new MemoryWorkspaceAdapter({
    id: 'workspace:localization-editor',
    ...options,
    files: {
      [WORKSPACE_GLOSSARY_PATH]: serializeWorkspaceGlossaryDocument(
        createWorkspaceGlossaryDocument(baseGlossary)
      ),
      [WORKSPACE_TRANSLATION_MEMORY_PATH]: serializeWorkspaceTranslationMemoryDocument(
        createWorkspaceTranslationMemoryDocument(baseTranslationMemory)
      ),
      ...(!Array.isArray(options.files) ? options.files : {})
    }
  })
}

interface StoreBackedEditorProps {
  initial: WorkspaceLocalizationState
  store: WorkspaceLocalizationStore
}

function StoreBackedEditor({ initial, store }: StoreBackedEditorProps): JSX.Element {
  const [snapshot, setSnapshot] = useState(initial)
  return (
    <LocalizationResourcesEditor
      snapshot={snapshot}
      onSaveGlossary={(entries, expectedHash) => store.replaceGlossary(entries, { expectedHash })}
      onSaveTranslationMemory={(entries, expectedHash) =>
        store.replaceTranslationMemory(entries, { expectedHash })
      }
      onReload={() => store.load()}
      onSnapshotChange={setSnapshot}
    />
  )
}

function AppLikeStoreBackedEditor({ initial, store }: StoreBackedEditorProps): JSX.Element {
  const [snapshot, setSnapshot] = useState<WorkspaceLocalizationState | null>(initial)
  const [loadError, setLoadError] = useState<string | null>(null)
  return (
    <LocalizationResourcesEditor
      workspaceBindingKey="app-like-store"
      snapshot={snapshot}
      loadError={loadError}
      loadErrorCode={loadError ? 'validation' : null}
      onSaveGlossary={(entries, expectedHash) => store.replaceGlossary(entries, { expectedHash })}
      onSaveTranslationMemory={(entries, expectedHash) =>
        store.replaceTranslationMemory(entries, { expectedHash })
      }
      onReload={async () => {
        try {
          const next = await store.load()
          setSnapshot(next)
          setLoadError(null)
          return next
        } catch (error) {
          setSnapshot(null)
          setLoadError(error instanceof Error ? error.message : String(error))
          throw error
        }
      }}
      onSnapshotChange={(next) => {
        setSnapshot(next)
        setLoadError(null)
      }}
    />
  )
}

afterEach(() => {
  cleanup()
  setLang('en')
})

describe('LocalizationResourcesEditor', () => {
  it('edits an explicit neutral glossary term and persists the ordered snapshot', async () => {
    const user = userEvent.setup()
    const initial = workspaceState()
    const handlers = callbacks(initial)
    render(<LocalizationResourcesEditor snapshot={initial} {...handlers} />)

    const first = screen.getByRole('group', {
      name: t('settings.localization.glossary.row', { index: 1 })
    })
    expect((within(first).getByRole('checkbox') as HTMLInputElement).checked).toBe(true)

    await user.click(
      screen.getByRole('button', {
        name: t('settings.localization.glossary.add')
      })
    )
    const added = screen.getByRole('group', {
      name: t('settings.localization.glossary.row', { index: 3 })
    })
    await user.type(within(added).getByLabelText(t('settings.localization.english')), 'Case code')
    await user.type(within(added).getByLabelText(t('settings.localization.arabic')), 'Case code')
    expect(within(added).getByText(t('settings.localization.validation.arabicScript'))).toBeTruthy()
    await user.click(within(added).getByRole('checkbox'))
    expect(within(added).queryByText(t('settings.localization.validation.arabicScript'))).toBeNull()

    await user.click(
      screen.getByRole('button', {
        name: t('settings.localization.glossary.save')
      })
    )
    await waitFor(() => expect(handlers.onSaveGlossary).toHaveBeenCalledTimes(1))
    expect(handlers.onSaveGlossary).toHaveBeenCalledWith(
      [...baseGlossary, { en: 'Case code', ar: 'Case code', neutral: true }],
      initial.files.glossary.hash
    )
    expect(screen.getByRole('status').textContent).toContain(
      t('settings.localization.glossary.saved')
    )
  })

  it('reorders glossary rows, removes translation-memory rows, and preserves accepted-only data', async () => {
    const user = userEvent.setup()
    const initial = workspaceState()
    const handlers = callbacks(initial)
    render(<LocalizationResourcesEditor snapshot={initial} {...handlers} />)

    const glossaryPanel = screen.getByRole('region', {
      name: t('settings.localization.glossary.title')
    })
    await user.click(
      within(glossaryPanel).getByRole('button', {
        name: t('settings.localization.moveDown', { index: 1 })
      })
    )
    await user.click(
      within(glossaryPanel).getByRole('button', {
        name: t('settings.localization.glossary.save')
      })
    )
    await waitFor(() => expect(handlers.onSaveGlossary).toHaveBeenCalledTimes(1))
    expect(handlers.onSaveGlossary).toHaveBeenCalledWith(
      [baseGlossary[1], baseGlossary[0]],
      initial.files.glossary.hash
    )

    const translationPanel = screen.getByRole('region', {
      name: t('settings.localization.translationMemory.title')
    })
    expect(
      within(translationPanel).getAllByLabelText(
        t('settings.localization.translationMemory.accepted')
      )
    ).toHaveLength(2)
    await user.click(
      within(translationPanel).getByRole('button', {
        name: t('settings.localization.remove', { index: 1 })
      })
    )
    await user.click(
      within(translationPanel).getByRole('button', {
        name: t('settings.localization.translationMemory.addAccepted')
      })
    )
    const newPair = within(translationPanel).getByRole('group', {
      name: t('settings.localization.translationMemory.row', { index: 2 })
    })
    await user.type(
      within(newPair).getByRole('textbox', {
        name: t('settings.localization.english')
      }),
      'Approve request'
    )
    await user.type(
      within(newPair).getByRole('textbox', {
        name: t('settings.localization.arabic')
      }),
      'اعتماد الطلب'
    )
    await user.click(
      within(translationPanel).getByRole('button', {
        name: t('settings.localization.translationMemory.save')
      })
    )
    await waitFor(() => expect(handlers.onSaveTranslationMemory).toHaveBeenCalledTimes(1))
    expect(handlers.onSaveTranslationMemory).toHaveBeenCalledWith(
      [
        baseTranslationMemory[1],
        {
          en: 'Approve request',
          ar: 'اعتماد الطلب',
          accepted: true
        }
      ],
      initial.files.translationMemory.hash
    )
  })

  it('shows inline script validation and blocks persistence until the row is valid', async () => {
    const user = userEvent.setup()
    const initial = workspaceState([], [])
    const handlers = callbacks(initial)
    render(<LocalizationResourcesEditor snapshot={initial} {...handlers} />)

    await user.click(
      screen.getByRole('button', {
        name: t('settings.localization.glossary.add')
      })
    )
    const row = screen.getByRole('group', {
      name: t('settings.localization.glossary.row', { index: 1 })
    })
    await user.type(
      within(row).getByLabelText(t('settings.localization.english')),
      'Review request'
    )
    await user.type(within(row).getByLabelText(t('settings.localization.arabic')), 'Still English')
    const save = screen.getByRole('button', {
      name: t('settings.localization.glossary.save')
    })
    expect(within(row).getByText(t('settings.localization.validation.arabicScript'))).toBeTruthy()
    expect((save as HTMLButtonElement).disabled).toBe(true)

    const arabic = within(row).getByLabelText(t('settings.localization.arabic'))
    await user.clear(arabic)
    await user.type(arabic, 'مراجعة الطلب')
    expect(within(row).queryByText(t('settings.localization.validation.arabicScript'))).toBeNull()
    expect((save as HTMLButtonElement).disabled).toBe(false)
  })

  it('preserves both drafts and shows no false success across a real failed glossary retry', async () => {
    let failGlossaryWrite = true
    const adapter = realLocalizationAdapter({
      beforeWrite(path) {
        if (path !== WORKSPACE_GLOSSARY_PATH || !failGlossaryWrite) return
        failGlossaryWrite = false
        throw new WorkspaceOperationError({
          code: 'storage-failure',
          operation: 'write',
          path,
          message: 'NotReadableError: glossary write interrupted'
        })
      }
    })
    const store = new WorkspaceLocalizationStore(adapter)
    const initial = await store.load()
    const saveGlossary = vi.spyOn(store, 'replaceGlossary')
    const user = userEvent.setup()
    render(<StoreBackedEditor initial={initial} store={store} />)

    const glossaryPanel = screen.getByRole('region', {
      name: t('settings.localization.glossary.title')
    })
    const translationPanel = screen.getByRole('region', {
      name: t('settings.localization.translationMemory.title')
    })
    await user.click(
      within(glossaryPanel).getByRole('button', {
        name: t('settings.localization.remove', { index: 2 })
      })
    )
    await user.click(
      within(translationPanel).getByRole('button', {
        name: t('settings.localization.remove', { index: 2 })
      })
    )

    const glossarySaveButton = within(glossaryPanel).getByRole('button', {
      name: t('settings.localization.glossary.save')
    })
    const translationMemorySaveButton = within(translationPanel).getByRole('button', {
      name: t('settings.localization.translationMemory.save')
    })
    await user.click(glossarySaveButton)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(
      t('settings.localization.saveFailed', {
        error: t('settings.localization.failure.storage')
      })
    )
    expect(screen.queryByRole('status')).toBeNull()
    expect(saveGlossary).toHaveBeenCalledTimes(1)
    expect(saveGlossary).toHaveBeenLastCalledWith([baseGlossary[0]], {
      expectedHash: initial.files.glossary.hash
    })
    expect((glossarySaveButton as HTMLButtonElement).disabled).toBe(false)
    expect((translationMemorySaveButton as HTMLButtonElement).disabled).toBe(false)

    await user.click(glossarySaveButton)

    await waitFor(() => expect(saveGlossary).toHaveBeenCalledTimes(2))
    expect(saveGlossary).toHaveBeenLastCalledWith([baseGlossary[0]], {
      expectedHash: initial.files.glossary.hash
    })
    expect(screen.getByRole('status').textContent).toContain(
      t('settings.localization.glossary.saved')
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect((glossarySaveButton as HTMLButtonElement).disabled).toBe(true)
    expect((translationMemorySaveButton as HTMLButtonElement).disabled).toBe(false)
    expect(
      within(translationPanel).queryByRole('group', {
        name: t('settings.localization.translationMemory.row', { index: 2 })
      })
    ).toBeNull()
  })

  it('blocks a stale translation-memory overwrite until real reload and explicit draft review', async () => {
    const adapter = realLocalizationAdapter()
    const store = new WorkspaceLocalizationStore(adapter)
    const initial = await store.load()
    const saveGlossary = vi.spyOn(store, 'replaceGlossary')
    const saveTranslationMemory = vi.spyOn(store, 'replaceTranslationMemory')
    const externalTranslationMemory: readonly TranslationMemoryEntry[] = [
      ...baseTranslationMemory,
      {
        en: 'External approval',
        ar: 'اعتماد خارجي',
        accepted: true
      }
    ]
    const user = userEvent.setup()
    render(<StoreBackedEditor initial={initial} store={store} />)

    const glossaryPanel = screen.getByRole('region', {
      name: t('settings.localization.glossary.title')
    })
    const translationPanel = screen.getByRole('region', {
      name: t('settings.localization.translationMemory.title')
    })
    await user.click(
      within(glossaryPanel).getByRole('button', {
        name: t('settings.localization.remove', { index: 2 })
      })
    )
    await user.click(
      within(translationPanel).getByRole('button', {
        name: t('settings.localization.remove', { index: 2 })
      })
    )
    adapter.replaceExternally(
      WORKSPACE_TRANSLATION_MEMORY_PATH,
      serializeWorkspaceTranslationMemoryDocument(
        createWorkspaceTranslationMemoryDocument(externalTranslationMemory)
      )
    )
    const externalHash = (await adapter.read(WORKSPACE_TRANSLATION_MEMORY_PATH)).hash

    const glossarySaveButton = within(glossaryPanel).getByRole('button', {
      name: t('settings.localization.glossary.save')
    })
    const translationMemorySaveButton = within(translationPanel).getByRole('button', {
      name: t('settings.localization.translationMemory.save')
    })
    await user.click(glossarySaveButton)
    await waitFor(() => expect(saveGlossary).toHaveBeenCalledTimes(1))
    expect(saveGlossary).toHaveBeenCalledWith([baseGlossary[0]], {
      expectedHash: initial.files.glossary.hash
    })
    expect((translationMemorySaveButton as HTMLButtonElement).disabled).toBe(false)

    await user.click(
      within(glossaryPanel).getByRole('button', {
        name: t('settings.localization.glossary.add')
      })
    )
    const unrelatedGlossaryDraft = within(glossaryPanel).getByRole('group', {
      name: t('settings.localization.glossary.row', { index: 2 })
    })
    await user.type(
      within(unrelatedGlossaryDraft).getByLabelText(t('settings.localization.english')),
      'Case code'
    )
    await user.type(
      within(unrelatedGlossaryDraft).getByLabelText(t('settings.localization.arabic')),
      'Case code'
    )
    await user.click(within(unrelatedGlossaryDraft).getByRole('checkbox'))

    await user.click(translationMemorySaveButton)

    expect(await screen.findByText(t('settings.localization.conflictReloadRequired'))).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(saveTranslationMemory).toHaveBeenCalledTimes(1)
    expect(saveTranslationMemory).toHaveBeenLastCalledWith([baseTranslationMemory[0]], {
      expectedHash: initial.files.translationMemory.hash
    })
    expect((translationMemorySaveButton as HTMLButtonElement).disabled).toBe(true)
    // The save commits through the adapter asynchronously; wait for the
    // written bytes instead of sampling them immediately after the call.
    await waitFor(async () => {
      const written = JSON.parse(
        new TextDecoder().decode((await adapter.read(WORKSPACE_TRANSLATION_MEMORY_PATH)).bytes)
      ) as { entries: TranslationMemoryEntry[] }
      expect(written.entries).toEqual(externalTranslationMemory)
    })

    await user.click(
      screen.getByRole('button', {
        name: t('settings.localization.reload')
      })
    )

    expect(await screen.findByText(t('settings.localization.conflictReview'))).toBeTruthy()
    const conflictAlert = screen.getByRole('alert', {
      name: t('settings.localization.conflictTitle', {
        resource: t('settings.localization.translationMemory.title')
      })
    })
    await user.click(
      within(conflictAlert).getByText(t('settings.localization.conflictCompareVersions'))
    )
    const draftBase = within(conflictAlert).getByRole('region', {
      name: t('settings.localization.conflictDraftBase', {
        count: baseTranslationMemory.length
      })
    })
    const workspaceVersion = within(conflictAlert).getByRole('region', {
      name: t('settings.localization.conflictWorkspaceVersion', {
        count: externalTranslationMemory.length
      })
    })
    expect(within(draftBase).getByText('Archive request')).toBeTruthy()
    expect(within(workspaceVersion).getByText('External approval')).toBeTruthy()
    expect(screen.getAllByDisplayValue('Case code')).toHaveLength(2)
    expect(
      within(translationPanel).queryByRole('group', {
        name: t('settings.localization.translationMemory.row', { index: 2 })
      })
    ).toBeNull()
    expect((glossarySaveButton as HTMLButtonElement).disabled).toBe(false)
    expect((translationMemorySaveButton as HTMLButtonElement).disabled).toBe(true)

    await user.click(
      screen.getByRole('button', {
        name: t('settings.localization.keepDraftForReview', {
          resource: t('settings.localization.translationMemory.title')
        })
      })
    )

    expect(screen.getByRole('status').textContent).toContain(
      t('settings.localization.draftKeptForReview', {
        resource: t('settings.localization.translationMemory.title')
      })
    )
    expect((translationMemorySaveButton as HTMLButtonElement).disabled).toBe(false)
    await user.click(translationMemorySaveButton)

    await waitFor(() => expect(saveTranslationMemory).toHaveBeenCalledTimes(2))
    expect(saveTranslationMemory).toHaveBeenLastCalledWith([baseTranslationMemory[0]], {
      expectedHash: externalHash
    })
    // The save commits through the adapter asynchronously; wait for the
    // written bytes instead of sampling them immediately after the call.
    await waitFor(async () => {
      const written = JSON.parse(
        new TextDecoder().decode((await adapter.read(WORKSPACE_TRANSLATION_MEMORY_PATH)).bytes)
      ) as { entries: TranslationMemoryEntry[] }
      expect(written.entries).toEqual([baseTranslationMemory[0]])
    })
    expect(screen.getAllByDisplayValue('Case code')).toHaveLength(2)
    expect((glossarySaveButton as HTMLButtonElement).disabled).toBe(false)
  })

  it('detects an advanced other-resource hash returned by a real scoped save', async () => {
    const adapter = realLocalizationAdapter()
    const store = new WorkspaceLocalizationStore(adapter)
    const initial = await store.load()
    const user = userEvent.setup()
    render(<StoreBackedEditor initial={initial} store={store} />)

    const glossaryPanel = screen.getByRole('region', {
      name: t('settings.localization.glossary.title')
    })
    const translationPanel = screen.getByRole('region', {
      name: t('settings.localization.translationMemory.title')
    })
    await user.click(
      within(glossaryPanel).getByRole('button', {
        name: t('settings.localization.remove', { index: 2 })
      })
    )
    await user.click(
      within(translationPanel).getByRole('button', {
        name: t('settings.localization.remove', { index: 2 })
      })
    )
    await store.acceptTranslationPair({
      en: 'Concurrent approval',
      ar: 'اعتماد متزامن',
      acceptedAt: '2026-07-27T07:00:00.000Z'
    })

    await user.click(
      within(glossaryPanel).getByRole('button', {
        name: t('settings.localization.glossary.save')
      })
    )

    expect(await screen.findByText(t('settings.localization.conflictReloadRequired'))).toBeTruthy()
    const translationMemorySaveButton = within(translationPanel).getByRole('button', {
      name: t('settings.localization.translationMemory.save')
    })
    expect((translationMemorySaveButton as HTMLButtonElement).disabled).toBe(true)
    expect(
      within(translationPanel).queryByRole('group', {
        name: t('settings.localization.translationMemory.row', { index: 2 })
      })
    ).toBeNull()

    await user.click(
      screen.getByRole('button', {
        name: t('settings.localization.reload')
      })
    )
    expect(await screen.findByText(t('settings.localization.conflictReview'))).toBeTruthy()
    await user.click(
      screen.getByRole('button', {
        name: t('settings.localization.useWorkspaceVersion', {
          resource: t('settings.localization.translationMemory.title')
        })
      })
    )

    expect(screen.getByDisplayValue('Concurrent approval')).toBeTruthy()
    expect((translationMemorySaveButton as HTMLButtonElement).disabled).toBe(true)
  })

  it('symmetrically preserves a dirty glossary when translation-memory save returns a newer glossary', async () => {
    const adapter = realLocalizationAdapter()
    const store = new WorkspaceLocalizationStore(adapter)
    const initial = await store.load()
    const user = userEvent.setup()
    render(<StoreBackedEditor initial={initial} store={store} />)

    const glossaryPanel = screen.getByRole('region', {
      name: t('settings.localization.glossary.title')
    })
    const translationPanel = screen.getByRole('region', {
      name: t('settings.localization.translationMemory.title')
    })
    await user.click(
      within(glossaryPanel).getByRole('button', {
        name: t('settings.localization.remove', { index: 2 })
      })
    )
    await user.click(
      within(translationPanel).getByRole('button', {
        name: t('settings.localization.remove', { index: 2 })
      })
    )
    const externalGlossary = [{ en: 'External term', ar: 'مصطلح خارجي' }]
    const advanced = await store.replaceGlossary(externalGlossary, {
      expectedHash: initial.files.glossary.hash
    })
    const saveGlossary = vi.spyOn(store, 'replaceGlossary')

    await user.click(
      within(translationPanel).getByRole('button', {
        name: t('settings.localization.translationMemory.save')
      })
    )

    expect(await screen.findByText(t('settings.localization.conflictReloadRequired'))).toBeTruthy()
    const glossarySaveButton = within(glossaryPanel).getByRole('button', {
      name: t('settings.localization.glossary.save')
    })
    expect((glossarySaveButton as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByDisplayValue('External term')).toBeNull()
    expect(
      within(glossaryPanel).queryByRole('group', {
        name: t('settings.localization.glossary.row', { index: 2 })
      })
    ).toBeNull()

    await user.click(
      screen.getByRole('button', {
        name: t('settings.localization.reload')
      })
    )
    expect(await screen.findByText(t('settings.localization.conflictReview'))).toBeTruthy()
    await user.click(
      screen.getByRole('button', {
        name: t('settings.localization.keepDraftForReview', {
          resource: t('settings.localization.glossary.title')
        })
      })
    )
    expect((glossarySaveButton as HTMLButtonElement).disabled).toBe(false)
    await user.click(glossarySaveButton)

    await waitFor(() => expect(saveGlossary).toHaveBeenCalledTimes(1))
    expect(saveGlossary).toHaveBeenCalledWith([baseGlossary[0]], {
      expectedHash: advanced.files.glossary.hash
    })
    // The save commits through the adapter asynchronously; wait for the
    // written bytes instead of sampling them immediately after the call.
    await waitFor(async () => {
      const written = JSON.parse(
        new TextDecoder().decode((await adapter.read(WORKSPACE_GLOSSARY_PATH)).bytes)
      ) as { entries: GlossaryEntry[] }
      expect(written.entries).toEqual([baseGlossary[0]])
    })
  })

  it('keeps retained drafts read-only after failed all-resource reload and unlocks only after recovery', async () => {
    const adapter = realLocalizationAdapter()
    const store = new WorkspaceLocalizationStore(adapter)
    const initial = await store.load()
    const user = userEvent.setup()
    render(<AppLikeStoreBackedEditor initial={initial} store={store} />)

    const glossaryPanel = screen.getByRole('region', {
      name: t('settings.localization.glossary.title')
    })
    const translationPanel = screen.getByRole('region', {
      name: t('settings.localization.translationMemory.title')
    })
    await user.click(
      within(glossaryPanel).getByRole('button', {
        name: t('settings.localization.remove', { index: 2 })
      })
    )
    await user.click(
      within(translationPanel).getByRole('button', {
        name: t('settings.localization.remove', { index: 2 })
      })
    )
    adapter.replaceExternally(
      WORKSPACE_TRANSLATION_MEMORY_PATH,
      '{"format":"broken","version":1,"entries":[]}'
    )

    await user.click(
      within(translationPanel).getByRole('button', {
        name: t('settings.localization.translationMemory.save')
      })
    )
    await user.click(
      await screen.findByRole('button', {
        name: t('settings.localization.reload')
      })
    )

    expect(await screen.findByText(t('settings.localization.loadFailedHint'))).toBeTruthy()
    expect(store.current).toBeUndefined()
    expect(
      (
        within(glossaryPanel).getByRole('button', {
          name: t('settings.localization.glossary.save')
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(
      (
        within(translationPanel).getByRole('button', {
          name: t('settings.localization.translationMemory.save')
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect((screen.getAllByDisplayValue('API')[0] as HTMLInputElement).disabled).toBe(true)
    expect(
      (
        screen.getByRole('button', {
          name: t('settings.localization.reload')
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)

    adapter.replaceExternally(
      WORKSPACE_TRANSLATION_MEMORY_PATH,
      serializeWorkspaceTranslationMemoryDocument(
        createWorkspaceTranslationMemoryDocument(baseTranslationMemory)
      )
    )
    await user.click(
      screen.getByRole('button', {
        name: t('settings.localization.reload')
      })
    )

    await waitFor(() => expect(store.current).toBeTruthy())
    expect(screen.queryByText(t('settings.localization.loadFailedHint'))).toBeNull()
    expect((screen.getAllByDisplayValue('API')[0] as HTMLInputElement).disabled).toBe(false)
    expect(
      (
        within(glossaryPanel).getByRole('button', {
          name: t('settings.localization.glossary.save')
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
    expect(
      within(glossaryPanel).queryByRole('group', {
        name: t('settings.localization.glossary.row', { index: 2 })
      })
    ).toBeNull()
  })

  it('resets drafts at a workspace binding key even when both stores have identical hashes', async () => {
    const firstAdapter = realLocalizationAdapter({ id: 'workspace:first-identical' })
    const secondAdapter = realLocalizationAdapter({ id: 'workspace:second-identical' })
    const firstStore = new WorkspaceLocalizationStore(firstAdapter)
    const secondStore = new WorkspaceLocalizationStore(secondAdapter)
    const first = await firstStore.load()
    const second = await secondStore.load()
    expect(first.files.glossary.hash).toBe(second.files.glossary.hash)
    expect(first.files.translationMemory.hash).toBe(second.files.translationMemory.hash)
    const user = userEvent.setup()
    const editor = (
      key: string,
      snapshot: WorkspaceLocalizationState,
      store: WorkspaceLocalizationStore
    ) => (
      <LocalizationResourcesEditor
        key={key}
        workspaceBindingKey={key}
        snapshot={snapshot}
        onSaveGlossary={(entries, expectedHash) => store.replaceGlossary(entries, { expectedHash })}
        onSaveTranslationMemory={(entries, expectedHash) =>
          store.replaceTranslationMemory(entries, { expectedHash })
        }
        onReload={() => store.load()}
      />
    )
    const { rerender } = render(editor('first-binding', first, firstStore))
    const glossaryPanel = screen.getByRole('region', {
      name: t('settings.localization.glossary.title')
    })
    await user.click(
      within(glossaryPanel).getByRole('button', {
        name: t('settings.localization.remove', { index: 2 })
      })
    )
    expect(
      within(glossaryPanel).queryByRole('group', {
        name: t('settings.localization.glossary.row', { index: 2 })
      })
    ).toBeNull()

    rerender(editor('second-binding', second, secondStore))

    const reboundGlossaryPanel = screen.getByRole('region', {
      name: t('settings.localization.glossary.title')
    })
    expect(
      within(reboundGlossaryPanel).getByRole('group', {
        name: t('settings.localization.glossary.row', { index: 2 })
      })
    ).toBeTruthy()
    expect(
      (
        within(reboundGlossaryPanel).getByRole('button', {
          name: t('settings.localization.glossary.save')
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
  })

  it('keeps corrupt resources read-only and exposes an explicit retry that restores editing', async () => {
    const user = userEvent.setup()
    const recovered = workspaceState(
      [{ en: 'Recovered term', ar: 'مصطلح مستعاد' }],
      [],
      'recovered'
    )
    const handlers = {
      ...callbacks(recovered),
      onReload: vi.fn(async () => recovered)
    }
    const onSnapshotChange = vi.fn()
    render(
      <LocalizationResourcesEditor
        snapshot={null}
        loadError="glossary.json: invalid format"
        {...handlers}
        onSnapshotChange={onSnapshotChange}
      />
    )

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(
      t('settings.localization.loadFailed', {
        error: t('settings.localization.failure.unknown')
      })
    )
    const detail = within(alert).getByLabelText(t('settings.localization.technicalDetail'))
    expect(detail.tagName).toBe('CODE')
    expect(detail.getAttribute('lang')).toBe('en')
    expect(detail.getAttribute('dir')).toBe('ltr')
    expect(detail.textContent).toBe('glossary.json: invalid format')
    expect(screen.getByText(t('settings.localization.loadFailedHint'))).toBeTruthy()
    expect(
      screen.queryByRole('button', {
        name: t('settings.localization.glossary.add')
      })
    ).toBeNull()
    expect(
      screen.queryByRole('button', {
        name: t('settings.localization.glossary.save')
      })
    ).toBeNull()

    await user.click(
      screen.getByRole('button', {
        name: t('settings.localization.reload')
      })
    )
    await waitFor(() => expect(handlers.onReload).toHaveBeenCalledTimes(1))
    expect(onSnapshotChange).toHaveBeenCalledWith(recovered)
    expect(screen.getByDisplayValue('Recovered term')).toBeTruthy()
  })

  it('bounds technical evidence by Unicode code point without splitting a surrogate pair', () => {
    const prefix = 'x'.repeat(VALIDATION_TECHNICAL_DETAIL_MAX_CODE_POINTS - 2)
    render(
      <LocalizationResourcesEditor
        snapshot={null}
        loadError={`${prefix}😀more untrusted detail`}
        {...callbacks()}
      />
    )

    const detail = screen.getByLabelText(t('settings.localization.technicalDetail'))
    expect(Array.from(detail.textContent ?? '')).toHaveLength(
      VALIDATION_TECHNICAL_DETAIL_MAX_CODE_POINTS
    )
    expect(detail.textContent).toBe(`${prefix}😀…`)
  })

  it('localizes a retained resource-limit failure instead of calling it unexpected storage', () => {
    const error = new WorkspaceLocalizationResourceLimitError('glossary', 'file-bytes', 10, 11)
    render(
      <LocalizationResourcesEditor
        snapshot={null}
        loadError={error.message}
        loadErrorCode="resource-limit"
        {...callbacks()}
      />
    )

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(
      t('settings.localization.loadFailed', {
        error: t('settings.localization.failure.resourceLimit')
      })
    )
    expect(alert.textContent).not.toContain(t('settings.localization.failure.unknown'))
  })

  it('keeps a typed partial-load state read-only without claiming every file was unchanged', async () => {
    const initial = workspaceState()
    const handlers = callbacks(initial)
    const user = userEvent.setup()
    const { rerender } = render(<LocalizationResourcesEditor snapshot={initial} {...handlers} />)
    const glossaryPanel = screen.getByRole('region', {
      name: t('settings.localization.glossary.title')
    })
    await user.click(
      within(glossaryPanel).getByRole('button', {
        name: t('settings.localization.remove', { index: 2 })
      })
    )

    rerender(
      <LocalizationResourcesEditor
        snapshot={null}
        loadError="Glossary seed committed before translation-memory CAS failed."
        loadErrorCode="partial-load"
        {...handlers}
      />
    )

    expect(screen.getByRole('alert').textContent).toContain(
      t('settings.localization.failure.partialLoad')
    )
    const hint = screen.getByText(t('settings.localization.loadFailedHint'))
    expect(hint.textContent).not.toContain('original files were not changed')
    expect(
      (
        within(glossaryPanel).getByRole('button', {
          name: t('settings.localization.glossary.save')
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(
      (
        screen.getByRole('button', {
          name: t('settings.localization.reload')
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  })

  it('localizes an Arabic workspace permission failure from its stable code', async () => {
    setLang('ar')
    const user = userEvent.setup()
    const initial = workspaceState()
    const handlers = {
      ...callbacks(initial),
      onSaveGlossary: vi.fn(async () => {
        throw new WorkspaceOperationError({
          code: 'permission-loss',
          operation: 'write',
          path: WORKSPACE_GLOSSARY_PATH,
          message: 'NotAllowedError: native workspace permission revoked'
        })
      })
    }
    render(<LocalizationResourcesEditor snapshot={initial} {...handlers} />)

    const glossaryPanel = screen.getByRole('region', {
      name: t('settings.localization.glossary.title')
    })
    await user.click(
      within(glossaryPanel).getByRole('button', {
        name: t('settings.localization.remove', { index: 2 })
      })
    )
    await user.click(
      within(glossaryPanel).getByRole('button', {
        name: t('settings.localization.glossary.save')
      })
    )

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(
      t('settings.localization.saveFailed', {
        error: t('settings.localization.failure.permission')
      })
    )
    const detail = within(alert).getByLabelText(t('settings.localization.technicalDetail'))
    expect(detail.tagName).toBe('CODE')
    expect(detail.getAttribute('lang')).toBe('en')
    expect(detail.getAttribute('dir')).toBe('ltr')
    expect(detail.textContent).toBe('NotAllowedError: native workspace permission revoked')
  })

  it('renders Arabic parity, RTL inputs, and an honest single-file unavailable state', async () => {
    setLang('ar')
    const user = userEvent.setup()
    const initial = workspaceState()
    const handlers = callbacks(initial)
    const { rerender, unmount } = render(
      <LocalizationResourcesEditor snapshot={initial} {...handlers} />
    )
    expect(
      screen.getByRole('heading', {
        name: t('settings.localization.title')
      })
    ).toBeTruthy()
    const first = screen.getByRole('group', {
      name: t('settings.localization.glossary.row', { index: 1 })
    })
    expect(
      within(first).getByLabelText(t('settings.localization.arabic')).getAttribute('dir')
    ).toBe('rtl')
    expect(
      within(first).getByLabelText(t('settings.localization.english')).getAttribute('dir')
    ).toBe('ltr')
    const glossaryPanel = screen.getByRole('region', {
      name: t('settings.localization.glossary.title')
    })
    await user.click(
      within(glossaryPanel).getByRole('button', {
        name: t('settings.localization.remove', { index: 2 })
      })
    )

    rerender(<LocalizationResourcesEditor snapshot={null} {...handlers} />)
    expect(
      screen.getByRole('group', {
        name: t('settings.localization.glossary.row', { index: 1 })
      })
    ).toBeTruthy()

    rerender(<LocalizationResourcesEditor snapshot={initial} {...handlers} />)
    expect(
      within(glossaryPanel).queryByRole('group', {
        name: t('settings.localization.glossary.row', { index: 2 })
      })
    ).toBeNull()
    expect(
      (
        within(glossaryPanel).getByRole('button', {
          name: t('settings.localization.glossary.save')
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)

    unmount()
    render(<LocalizationResourcesEditor snapshot={null} {...handlers} />)
    expect(screen.getByText(t('settings.localization.unavailable'))).toBeTruthy()
  })
})

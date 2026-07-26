// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setLang, t } from '../../i18n'
import type { GlossaryEntry, TranslationMemoryEntry } from '../../localization/types'
import {
  WORKSPACE_GLOSSARY_PATH,
  WORKSPACE_TRANSLATION_MEMORY_PATH,
  WorkspaceLocalizationConflictError,
  createWorkspaceGlossaryDocument,
  createWorkspaceTranslationMemoryDocument,
  type WorkspaceLocalizationState
} from '../../localization/workspaceStore'
import {
  LocalizationResourcesEditor,
  type LocalizationResourcesEditorProps
} from '../LocalizationResourcesEditor'

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

function callbacks(
  initial = workspaceState()
): Pick<
  LocalizationResourcesEditorProps,
  'onSaveGlossary' | 'onSaveTranslationMemory' | 'onReload'
> {
  return {
    onSaveGlossary: vi.fn(async (entries) =>
      workspaceState(entries, initial.resources.translationMemory, 'saved-glossary')
    ),
    onSaveTranslationMemory: vi.fn(async (entries) =>
      workspaceState(initial.resources.glossary, entries, 'saved-translation-memory')
    ),
    onReload: vi.fn(async () => initial)
  }
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
    expect(handlers.onSaveGlossary).toHaveBeenCalledWith([
      ...baseGlossary,
      { en: 'Case code', ar: 'Case code', neutral: true }
    ])
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
    expect(handlers.onSaveGlossary).toHaveBeenCalledWith([baseGlossary[1], baseGlossary[0]])

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
    expect(handlers.onSaveTranslationMemory).toHaveBeenCalledWith([
      baseTranslationMemory[1],
      {
        en: 'Approve request',
        ar: 'اعتماد الطلب',
        accepted: true
      }
    ])
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

  it('offers Reload after a CAS conflict and replaces the stale draft with returned hashes', async () => {
    const user = userEvent.setup()
    const initial = workspaceState()
    const external = workspaceState(
      [{ en: 'External term', ar: 'مصطلح خارجي' }],
      baseTranslationMemory,
      'external'
    )
    const conflict = new WorkspaceLocalizationConflictError(WORKSPACE_GLOSSARY_PATH, {
      ok: false,
      status: 'external-conflict',
      reason: 'hash-mismatch',
      expectedHash: initial.files.glossary.hash
    })
    const onSnapshotChange = vi.fn()
    const handlers = {
      ...callbacks(initial),
      onSaveGlossary: vi.fn(async () => {
        throw conflict
      }),
      onReload: vi.fn(async () => external)
    }
    render(
      <LocalizationResourcesEditor
        snapshot={initial}
        {...handlers}
        onSnapshotChange={onSnapshotChange}
      />
    )

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
    expect(await screen.findByText(t('settings.localization.conflict'))).toBeTruthy()
    await user.click(
      screen.getByRole('button', {
        name: t('settings.localization.reload')
      })
    )
    await waitFor(() => expect(handlers.onReload).toHaveBeenCalledTimes(1))
    expect(onSnapshotChange).toHaveBeenCalledWith(external)
    expect(screen.getByDisplayValue('External term')).toBeTruthy()
    expect(screen.queryByText(t('settings.localization.conflict'))).toBeNull()
  })

  it('renders Arabic parity, RTL inputs, and an honest single-file unavailable state', async () => {
    setLang('ar')
    const initial = workspaceState()
    const handlers = callbacks(initial)
    const { rerender } = render(<LocalizationResourcesEditor snapshot={initial} {...handlers} />)
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

    rerender(<LocalizationResourcesEditor snapshot={null} {...handlers} />)
    await waitFor(() =>
      expect(screen.getByText(t('settings.localization.unavailable'))).toBeTruthy()
    )
  })
})

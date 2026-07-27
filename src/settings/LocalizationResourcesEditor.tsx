import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { t } from '../i18n'
import { useLang } from '../i18n/useLang'
import type { GlossaryEntry, TranslationMemoryEntry } from '../localization/types'
import { WorkspaceOperationError, type WorkspaceErrorCode } from '../workspace/adapters'
import {
  WorkspaceLocalizationConflictError,
  WorkspaceLocalizationPartialLoadError,
  WorkspaceLocalizationResourceLimitError,
  WorkspaceLocalizationValidationError,
  type WorkspaceLocalizationState
} from '../localization/workspaceStore'
import {
  issueForField,
  validateGlossaryDraft,
  validateTranslationMemoryDraft,
  type LocalizationResourceDraftIssue
} from './localizationResourceDraft'
import { boundedValidationTechnicalDetail } from '../validation/technicalEvidence'
import './LocalizationResourcesEditor.css'

interface DraftRow<Entry> {
  id: string
  entry: Entry
}

type PendingAction = 'glossary' | 'translation-memory' | 'reload'
type ResourceScope = Exclude<PendingAction, 'reload'>

export type LocalizationResourcesFailureCode =
  'conflict' | 'validation' | 'resource-limit' | 'partial-load' | WorkspaceErrorCode | 'unknown'

interface EditorFailure {
  scope: PendingAction
  code: LocalizationResourcesFailureCode
  detail: string | null
}

interface ResourceBaseline<Entry> {
  hash: string
  entries: readonly Entry[]
}

type ResourceConflict<Entry> =
  { stage: 'reload-required' } | { stage: 'review'; remote: ResourceBaseline<Entry> }

export interface LocalizationResourcesEditorProps {
  /** Remount boundary for one adapter generation; prevents cross-workspace drafts. */
  workspaceBindingKey?: string
  /** Latest compare-and-set snapshot returned by WorkspaceLocalizationStore. */
  snapshot: WorkspaceLocalizationState | null
  /** Exact load failure retained while the public files remain read-only. */
  loadError?: string | null
  /** Stable failure classification retained separately from technical evidence. */
  loadErrorCode?: LocalizationResourcesFailureCode | null
  onSaveGlossary: (
    entries: readonly GlossaryEntry[],
    expectedHash: string
  ) => Promise<WorkspaceLocalizationState>
  onSaveTranslationMemory: (
    entries: readonly TranslationMemoryEntry[],
    expectedHash: string
  ) => Promise<WorkspaceLocalizationState>
  onReload: () => Promise<WorkspaceLocalizationState>
  /** Lets Settings/App retain each callback's new hashes without re-reading. */
  onSnapshotChange?: (snapshot: WorkspaceLocalizationState) => void
  disabled?: boolean
}

function glossaryBaselineFrom(
  snapshot: WorkspaceLocalizationState
): ResourceBaseline<GlossaryEntry> {
  return {
    hash: snapshot.files.glossary.hash,
    entries: snapshot.resources.glossary
  }
}

function translationMemoryBaselineFrom(
  snapshot: WorkspaceLocalizationState
): ResourceBaseline<TranslationMemoryEntry> {
  return {
    hash: snapshot.files.translationMemory.hash,
    entries: snapshot.resources.translationMemory
  }
}

function entriesEqual<Entry>(left: readonly Entry[], right: readonly Entry[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function rowsFrom<Entry extends GlossaryEntry | TranslationMemoryEntry>(
  entries: readonly Entry[],
  prefix: string
): DraftRow<Entry>[] {
  return entries.map((entry, index) => ({
    id: `${prefix}-${index}`,
    entry: { ...entry }
  }))
}

function moveRow<Entry>(
  rows: readonly DraftRow<Entry>[],
  index: number,
  offset: -1 | 1
): DraftRow<Entry>[] {
  const destination = index + offset
  if (destination < 0 || destination >= rows.length) return [...rows]
  const next = [...rows]
  const [row] = next.splice(index, 1)
  if (row) next.splice(destination, 0, row)
  return next
}

function errorMessage(issue: LocalizationResourceDraftIssue): string {
  switch (issue.code) {
    case 'english-required':
      return t('settings.localization.validation.englishRequired')
    case 'arabic-required':
      return t('settings.localization.validation.arabicRequired')
    case 'english-script':
      return t('settings.localization.validation.englishScript')
    case 'arabic-script':
      return t('settings.localization.validation.arabicScript')
    case 'neutral-mismatch':
      return t('settings.localization.validation.neutralMismatch')
    case 'accepted-only':
      return t('settings.localization.validation.acceptedOnly')
    case 'schema':
      return t('settings.localization.validation.schema')
  }
}

function technicalErrorDetail(error: unknown): string | null {
  return boundedValidationTechnicalDetail(error) ?? null
}

function failureFrom(error: unknown, scope: PendingAction): EditorFailure {
  if (error instanceof WorkspaceLocalizationConflictError) {
    return { scope, code: 'conflict', detail: null }
  }
  if (error instanceof WorkspaceLocalizationValidationError) {
    return { scope, code: 'validation', detail: technicalErrorDetail(error) }
  }
  if (error instanceof WorkspaceLocalizationResourceLimitError) {
    return { scope, code: 'resource-limit', detail: technicalErrorDetail(error) }
  }
  if (error instanceof WorkspaceLocalizationPartialLoadError) {
    return { scope, code: 'partial-load', detail: technicalErrorDetail(error) }
  }
  if (error instanceof WorkspaceOperationError) {
    return { scope, code: error.code, detail: technicalErrorDetail(error) }
  }
  return { scope, code: 'unknown', detail: technicalErrorDetail(error) }
}

function workspaceFailureReason(code: EditorFailure['code']): string {
  switch (code) {
    case 'conflict':
      return t('settings.localization.conflict')
    case 'validation':
      return t('settings.localization.validation.schema')
    case 'resource-limit':
      return t('settings.localization.failure.resourceLimit')
    case 'partial-load':
      return t('settings.localization.failure.partialLoad')
    case 'invalid-path':
      return t('settings.localization.failure.invalidPath')
    case 'invalid-encoding':
      return t('settings.localization.failure.invalidEncoding')
    case 'not-found':
      return t('settings.localization.failure.notFound')
    case 'already-exists':
      return t('settings.localization.failure.alreadyExists')
    case 'not-a-file':
    case 'not-a-directory':
      return t('settings.localization.failure.wrongKind')
    case 'permission-loss':
      return t('settings.localization.failure.permission')
    case 'cancelled':
      return t('settings.localization.failure.cancelled')
    case 'stale-workspace':
      return t('settings.localization.failure.staleWorkspace')
    case 'unsupported':
      return t('settings.localization.failure.unsupported')
    case 'quota-exceeded':
      return t('settings.localization.failure.quotaExceeded')
    case 'integrity-failure':
      return t('settings.localization.failure.integrity')
    case 'storage-failure':
      return t('settings.localization.failure.storage')
    case 'unknown':
      return t('settings.localization.failure.unknown')
  }
}

function editorFailureMessage(failure: EditorFailure): string {
  if (failure.code === 'conflict') return workspaceFailureReason(failure.code)
  const reason = workspaceFailureReason(failure.code)
  return failure.scope === 'reload'
    ? t('settings.localization.loadFailed', { error: reason })
    : t('settings.localization.saveFailed', { error: reason })
}

function FailureAlert({ failure }: { failure: EditorFailure }): JSX.Element {
  return (
    <div className="orbitpm-localization-resources__failure" role="alert">
      <div>{editorFailureMessage(failure)}</div>
      {failure.detail ? (
        <details>
          <summary>{t('settings.localization.technicalDetails')}</summary>
          <code
            aria-label={t('settings.localization.technicalDetail')}
            lang="en"
            dir="ltr"
            style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}
          >
            {failure.detail}
          </code>
        </details>
      ) : null}
    </div>
  )
}

const CONFLICT_PREVIEW_LIMIT = 10

interface ResourceConflictAlertProps<Entry extends { en: string; ar: string }> {
  resource: string
  baseline: ResourceBaseline<Entry>
  conflict: ResourceConflict<Entry>
  disabled: boolean
  onUseWorkspace: () => void
  onKeepDraft: () => void
}

function ConflictVersionPreview<Entry extends { en: string; ar: string }>({
  title,
  entries
}: {
  title: string
  entries: readonly Entry[]
}): JSX.Element {
  const visible = entries.slice(0, CONFLICT_PREVIEW_LIMIT)
  return (
    <section aria-label={title}>
      <strong>{title}</strong>
      {visible.length === 0 ? (
        <p>{t('settings.localization.conflictPreviewEmpty')}</p>
      ) : (
        <ol>
          {visible.map((entry, index) => (
            <li key={`${entry.en}\u0000${entry.ar}\u0000${index}`}>
              <span lang="en" dir="ltr">
                {entry.en}
              </span>
              <span lang="ar" dir="rtl">
                {entry.ar}
              </span>
            </li>
          ))}
        </ol>
      )}
      {entries.length > visible.length && (
        <p>
          {t('settings.localization.conflictPreviewOmitted', {
            count: entries.length - visible.length
          })}
        </p>
      )}
    </section>
  )
}

function ResourceConflictAlert<Entry extends { en: string; ar: string }>({
  resource,
  baseline,
  conflict,
  disabled,
  onUseWorkspace,
  onKeepDraft
}: ResourceConflictAlertProps<Entry>): JSX.Element {
  return (
    <section
      className="orbitpm-localization-resources__failure"
      aria-label={t('settings.localization.conflictTitle', { resource })}
      role="alert"
    >
      <strong>{t('settings.localization.conflictTitle', { resource })}</strong>
      {conflict.stage === 'reload-required' ? (
        <p>{t('settings.localization.conflictReloadRequired')}</p>
      ) : (
        <>
          <p>{t('settings.localization.conflictReview')}</p>
          <p>
            {t('settings.localization.conflictVersions')}{' '}
            <span dir="ltr">
              <code>{baseline.hash}</code> → <code>{conflict.remote.hash}</code>
            </span>
          </p>
          <details>
            <summary>{t('settings.localization.conflictCompareVersions')}</summary>
            <div className="orbitpm-localization-resources__conflict-comparison">
              <ConflictVersionPreview
                title={t('settings.localization.conflictDraftBase', {
                  count: baseline.entries.length
                })}
                entries={baseline.entries}
              />
              <ConflictVersionPreview
                title={t('settings.localization.conflictWorkspaceVersion', {
                  count: conflict.remote.entries.length
                })}
                entries={conflict.remote.entries}
              />
            </div>
          </details>
          <div className="orbitpm-localization-resources__conflict-actions">
            <button
              type="button"
              className="orbitpm-localization-resources__secondary"
              onClick={onUseWorkspace}
              disabled={disabled}
            >
              {t('settings.localization.useWorkspaceVersion', { resource })}
            </button>
            <button
              type="button"
              className="orbitpm-localization-resources__primary"
              onClick={onKeepDraft}
              disabled={disabled}
            >
              {t('settings.localization.keepDraftForReview', { resource })}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

export function LocalizationResourcesEditor({
  snapshot,
  loadError = null,
  loadErrorCode = null,
  onSaveGlossary,
  onSaveTranslationMemory,
  onReload,
  onSnapshotChange,
  disabled = false
}: LocalizationResourcesEditorProps): JSX.Element {
  useLang()
  const nextRowId = useRef(0)
  const lastPropHashes = useRef({
    glossary: snapshot?.files.glossary.hash ?? null,
    translationMemory: snapshot?.files.translationMemory.hash ?? null
  })
  const [glossaryBaseline, setGlossaryBaseline] = useState<ResourceBaseline<GlossaryEntry> | null>(
    () => (snapshot ? glossaryBaselineFrom(snapshot) : null)
  )
  const [translationMemoryBaseline, setTranslationMemoryBaseline] =
    useState<ResourceBaseline<TranslationMemoryEntry> | null>(() =>
      snapshot ? translationMemoryBaselineFrom(snapshot) : null
    )
  const [glossaryRows, setGlossaryRows] = useState(() =>
    rowsFrom(
      snapshot?.resources.glossary ?? [],
      `glossary-${snapshot?.files.glossary.hash ?? 'new'}`
    )
  )
  const [translationMemoryRows, setTranslationMemoryRows] = useState(() =>
    rowsFrom(
      snapshot?.resources.translationMemory ?? [],
      `translation-memory-${snapshot?.files.translationMemory.hash ?? 'new'}`
    )
  )
  const [glossaryConflict, setGlossaryConflict] = useState<ResourceConflict<GlossaryEntry> | null>(
    null
  )
  const [translationMemoryConflict, setTranslationMemoryConflict] =
    useState<ResourceConflict<TranslationMemoryEntry> | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [failure, setFailure] = useState<EditorFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const glossary = useMemo(() => glossaryRows.map((row) => row.entry), [glossaryRows])
  const translationMemory = useMemo(
    () => translationMemoryRows.map((row) => row.entry),
    [translationMemoryRows]
  )
  const glossaryBaselineRef = useRef(glossaryBaseline)
  const translationMemoryBaselineRef = useRef(translationMemoryBaseline)
  const glossaryDraftRef = useRef<readonly GlossaryEntry[]>(glossary)
  const translationMemoryDraftRef = useRef<readonly TranslationMemoryEntry[]>(translationMemory)
  glossaryBaselineRef.current = glossaryBaseline
  translationMemoryBaselineRef.current = translationMemoryBaseline
  glossaryDraftRef.current = glossary
  translationMemoryDraftRef.current = translationMemory

  useEffect(() => {
    if (!snapshot) {
      lastPropHashes.current = { glossary: null, translationMemory: null }
      return
    }

    const nextGlossary = glossaryBaselineFrom(snapshot)
    const nextTranslationMemory = translationMemoryBaselineFrom(snapshot)
    const glossaryPropChanged = nextGlossary.hash !== lastPropHashes.current.glossary
    const translationMemoryPropChanged =
      nextTranslationMemory.hash !== lastPropHashes.current.translationMemory
    lastPropHashes.current = {
      glossary: nextGlossary.hash,
      translationMemory: nextTranslationMemory.hash
    }

    if (glossaryPropChanged) {
      const current = glossaryBaselineRef.current
      if (!current || entriesEqual(glossaryDraftRef.current, current.entries)) {
        glossaryBaselineRef.current = nextGlossary
        setGlossaryBaseline(nextGlossary)
        setGlossaryRows(rowsFrom(nextGlossary.entries, `glossary-${nextGlossary.hash}`))
        setGlossaryConflict(null)
      } else if (nextGlossary.hash === current.hash) {
        setGlossaryConflict(null)
      } else {
        setGlossaryConflict({ stage: 'reload-required' })
      }
    }

    if (translationMemoryPropChanged) {
      const current = translationMemoryBaselineRef.current
      if (!current || entriesEqual(translationMemoryDraftRef.current, current.entries)) {
        translationMemoryBaselineRef.current = nextTranslationMemory
        setTranslationMemoryBaseline(nextTranslationMemory)
        setTranslationMemoryRows(
          rowsFrom(
            nextTranslationMemory.entries,
            `translation-memory-${nextTranslationMemory.hash}`
          )
        )
        setTranslationMemoryConflict(null)
      } else if (nextTranslationMemory.hash === current.hash) {
        setTranslationMemoryConflict(null)
      } else {
        setTranslationMemoryConflict({ stage: 'reload-required' })
      }
    }
  }, [snapshot])

  const glossaryIssues = useMemo(() => validateGlossaryDraft(glossary), [glossary])
  const translationMemoryIssues = useMemo(
    () => validateTranslationMemoryDraft(translationMemory),
    [translationMemory]
  )
  const glossaryDirty =
    glossaryBaseline !== null && !entriesEqual(glossary, glossaryBaseline.entries)
  const translationMemoryDirty =
    translationMemoryBaseline !== null &&
    !entriesEqual(translationMemory, translationMemoryBaseline.entries)
  const operationDisabled = disabled || pending !== null
  const loadBlocked = snapshot === null && loadError !== null
  const controlsDisabled = operationDisabled || loadBlocked
  const propLoadFailure: EditorFailure | null = loadError
    ? {
        scope: 'reload',
        code: loadErrorCode ?? 'unknown',
        detail: technicalErrorDetail(loadError)
      }
    : null

  const acceptSavedSnapshot = (
    next: WorkspaceLocalizationState,
    scope: ResourceScope,
    message: string
  ): void => {
    const nextGlossary = glossaryBaselineFrom(next)
    const nextTranslationMemory = translationMemoryBaselineFrom(next)
    if (scope === 'glossary') {
      glossaryBaselineRef.current = nextGlossary
      setGlossaryBaseline(nextGlossary)
      setGlossaryRows(rowsFrom(nextGlossary.entries, `glossary-${nextGlossary.hash}`))
      setGlossaryConflict(null)

      // The returned aggregate may expose a newer translation-memory file, but
      // this glossary save is not authorization to rebase its draft.
      const currentTranslationMemory = translationMemoryBaselineRef.current
      if (
        currentTranslationMemory &&
        nextTranslationMemory.hash !== currentTranslationMemory.hash &&
        !entriesEqual(translationMemoryDraftRef.current, currentTranslationMemory.entries)
      ) {
        setTranslationMemoryConflict((current) =>
          current?.stage === 'review' && current.remote.hash === nextTranslationMemory.hash
            ? current
            : { stage: 'reload-required' }
        )
      }
    } else {
      translationMemoryBaselineRef.current = nextTranslationMemory
      setTranslationMemoryBaseline(nextTranslationMemory)
      setTranslationMemoryRows(
        rowsFrom(nextTranslationMemory.entries, `translation-memory-${nextTranslationMemory.hash}`)
      )
      setTranslationMemoryConflict(null)

      // Symmetrically, a translation-memory save cannot advance the glossary
      // caller view while a glossary draft is still based on an older hash.
      const currentGlossary = glossaryBaselineRef.current
      if (
        currentGlossary &&
        nextGlossary.hash !== currentGlossary.hash &&
        !entriesEqual(glossaryDraftRef.current, currentGlossary.entries)
      ) {
        setGlossaryConflict((current) =>
          current?.stage === 'review' && current.remote.hash === nextGlossary.hash
            ? current
            : { stage: 'reload-required' }
        )
      }
    }
    setFailure(null)
    setNotice(message)
    onSnapshotChange?.(next)
  }

  const saveGlossary = async (): Promise<void> => {
    if (
      glossaryIssues.length > 0 ||
      !glossaryDirty ||
      !glossaryBaseline ||
      glossaryConflict ||
      controlsDisabled
    ) {
      return
    }
    setPending('glossary')
    setFailure(null)
    setNotice(null)
    try {
      acceptSavedSnapshot(
        await onSaveGlossary(glossary, glossaryBaseline.hash),
        'glossary',
        t('settings.localization.glossary.saved')
      )
    } catch (error) {
      if (error instanceof WorkspaceLocalizationConflictError) {
        setGlossaryConflict({ stage: 'reload-required' })
      } else {
        setFailure(failureFrom(error, 'glossary'))
      }
    } finally {
      setPending(null)
    }
  }

  const saveTranslationMemory = async (): Promise<void> => {
    if (
      translationMemoryIssues.length > 0 ||
      !translationMemoryDirty ||
      !translationMemoryBaseline ||
      translationMemoryConflict ||
      controlsDisabled
    ) {
      return
    }
    setPending('translation-memory')
    setFailure(null)
    setNotice(null)
    try {
      acceptSavedSnapshot(
        await onSaveTranslationMemory(translationMemory, translationMemoryBaseline.hash),
        'translation-memory',
        t('settings.localization.translationMemory.saved')
      )
    } catch (error) {
      if (error instanceof WorkspaceLocalizationConflictError) {
        setTranslationMemoryConflict({ stage: 'reload-required' })
      } else {
        setFailure(failureFrom(error, 'translation-memory'))
      }
    } finally {
      setPending(null)
    }
  }

  const reload = async (): Promise<void> => {
    if (operationDisabled) return
    setPending('reload')
    setFailure(null)
    setNotice(null)
    try {
      const next = await onReload()
      const nextGlossary = glossaryBaselineFrom(next)
      const nextTranslationMemory = translationMemoryBaselineFrom(next)
      const currentGlossary = glossaryBaselineRef.current
      const currentTranslationMemory = translationMemoryBaselineRef.current
      const preserveGlossary =
        currentGlossary !== null && !entriesEqual(glossaryDraftRef.current, currentGlossary.entries)
      const preserveTranslationMemory =
        currentTranslationMemory !== null &&
        !entriesEqual(translationMemoryDraftRef.current, currentTranslationMemory.entries)
      let reviewRequired = false

      if (preserveGlossary && currentGlossary) {
        if (nextGlossary.hash === currentGlossary.hash) {
          setGlossaryConflict(null)
        } else {
          setGlossaryConflict({ stage: 'review', remote: nextGlossary })
          reviewRequired = true
        }
      } else {
        glossaryBaselineRef.current = nextGlossary
        setGlossaryBaseline(nextGlossary)
        setGlossaryRows(rowsFrom(nextGlossary.entries, `glossary-${nextGlossary.hash}`))
        setGlossaryConflict(null)
      }

      if (preserveTranslationMemory && currentTranslationMemory) {
        if (nextTranslationMemory.hash === currentTranslationMemory.hash) {
          setTranslationMemoryConflict(null)
        } else {
          setTranslationMemoryConflict({
            stage: 'review',
            remote: nextTranslationMemory
          })
          reviewRequired = true
        }
      } else {
        translationMemoryBaselineRef.current = nextTranslationMemory
        setTranslationMemoryBaseline(nextTranslationMemory)
        setTranslationMemoryRows(
          rowsFrom(
            nextTranslationMemory.entries,
            `translation-memory-${nextTranslationMemory.hash}`
          )
        )
        setTranslationMemoryConflict(null)
      }

      lastPropHashes.current = {
        glossary: nextGlossary.hash,
        translationMemory: nextTranslationMemory.hash
      }
      setNotice(
        reviewRequired
          ? t('settings.localization.reloadedDraftsPreserved')
          : t('settings.localization.reloaded')
      )
      onSnapshotChange?.(next)
    } catch (error) {
      setFailure(failureFrom(error, 'reload'))
    } finally {
      setPending(null)
    }
  }

  const clearFeedback = (scope: ResourceScope): void => {
    setNotice(null)
    setFailure((current) => (current?.scope === scope ? null : current))
  }

  const useWorkspaceGlossary = (): void => {
    if (glossaryConflict?.stage !== 'review') return
    const next = glossaryConflict.remote
    glossaryBaselineRef.current = next
    setGlossaryBaseline(next)
    setGlossaryRows(rowsFrom(next.entries, `glossary-${next.hash}`))
    setGlossaryConflict(null)
    setFailure(null)
    setNotice(
      t('settings.localization.workspaceVersionSelected', {
        resource: t('settings.localization.glossary.title')
      })
    )
  }

  const keepGlossaryDraftForReview = (): void => {
    if (glossaryConflict?.stage !== 'review') return
    const next = glossaryConflict.remote
    glossaryBaselineRef.current = next
    setGlossaryBaseline(next)
    setGlossaryConflict(null)
    setFailure(null)
    setNotice(
      t('settings.localization.draftKeptForReview', {
        resource: t('settings.localization.glossary.title')
      })
    )
  }

  const useWorkspaceTranslationMemory = (): void => {
    if (translationMemoryConflict?.stage !== 'review') return
    const next = translationMemoryConflict.remote
    translationMemoryBaselineRef.current = next
    setTranslationMemoryBaseline(next)
    setTranslationMemoryRows(rowsFrom(next.entries, `translation-memory-${next.hash}`))
    setTranslationMemoryConflict(null)
    setFailure(null)
    setNotice(
      t('settings.localization.workspaceVersionSelected', {
        resource: t('settings.localization.translationMemory.title')
      })
    )
  }

  const keepTranslationMemoryDraftForReview = (): void => {
    if (translationMemoryConflict?.stage !== 'review') return
    const next = translationMemoryConflict.remote
    translationMemoryBaselineRef.current = next
    setTranslationMemoryBaseline(next)
    setTranslationMemoryConflict(null)
    setFailure(null)
    setNotice(
      t('settings.localization.draftKeptForReview', {
        resource: t('settings.localization.translationMemory.title')
      })
    )
  }

  if (!glossaryBaseline || !translationMemoryBaseline) {
    const visibleLoadFailure: EditorFailure | null =
      failure?.scope === 'reload' ? failure : propLoadFailure
    return (
      <section
        className="orbitpm-localization-resources"
        aria-labelledby="orbitpm-localization-resources-title"
      >
        <h2 id="orbitpm-localization-resources-title">{t('settings.localization.title')}</h2>
        {visibleLoadFailure ? (
          <>
            <FailureAlert failure={visibleLoadFailure} />
            <p>{t('settings.localization.loadFailedHint')}</p>
            <button
              type="button"
              className="orbitpm-localization-resources__secondary"
              onClick={() => void reload()}
              disabled={operationDisabled}
            >
              {pending === 'reload'
                ? t('settings.localization.reloading')
                : t('settings.localization.reload')}
            </button>
          </>
        ) : (
          <p>{t('settings.localization.unavailable')}</p>
        )}
      </section>
    )
  }

  const visibleFailure =
    loadBlocked && failure?.scope !== 'reload' ? propLoadFailure : (failure ?? propLoadFailure)

  return (
    <section
      className="orbitpm-localization-resources"
      aria-labelledby="orbitpm-localization-resources-title"
    >
      <header className="orbitpm-localization-resources__header">
        <div>
          <h2 id="orbitpm-localization-resources-title">{t('settings.localization.title')}</h2>
          <p>{t('settings.localization.description')}</p>
        </div>
        {(loadBlocked ||
          failure?.code === 'conflict' ||
          glossaryConflict?.stage === 'reload-required' ||
          translationMemoryConflict?.stage === 'reload-required') && (
          <button
            type="button"
            className="orbitpm-localization-resources__secondary"
            onClick={() => void reload()}
            disabled={operationDisabled}
          >
            {pending === 'reload'
              ? t('settings.localization.reloading')
              : t('settings.localization.reload')}
          </button>
        )}
      </header>

      <p className="orbitpm-localization-resources__public-note" role="note">
        {t('settings.localization.publicNotice')}
      </p>

      {visibleFailure && <FailureAlert failure={visibleFailure} />}
      {loadBlocked && <p>{t('settings.localization.loadFailedHint')}</p>}
      {notice && (
        <p className="orbitpm-localization-resources__notice" role="status">
          {notice}
        </p>
      )}
      {glossaryConflict && (
        <ResourceConflictAlert
          resource={t('settings.localization.glossary.title')}
          baseline={glossaryBaseline}
          conflict={glossaryConflict}
          disabled={controlsDisabled}
          onUseWorkspace={useWorkspaceGlossary}
          onKeepDraft={keepGlossaryDraftForReview}
        />
      )}
      {translationMemoryConflict && (
        <ResourceConflictAlert
          resource={t('settings.localization.translationMemory.title')}
          baseline={translationMemoryBaseline}
          conflict={translationMemoryConflict}
          disabled={controlsDisabled}
          onUseWorkspace={useWorkspaceTranslationMemory}
          onKeepDraft={keepTranslationMemoryDraftForReview}
        />
      )}

      <ResourcePanel
        title={t('settings.localization.glossary.title')}
        description={t('settings.localization.glossary.description')}
        empty={glossaryRows.length === 0}
        emptyMessage={t('settings.localization.glossary.empty')}
        addLabel={t('settings.localization.glossary.add')}
        saveLabel={
          pending === 'glossary'
            ? t('settings.localization.saving')
            : t('settings.localization.glossary.save')
        }
        saveDisabled={
          controlsDisabled || glossaryIssues.length > 0 || !glossaryDirty || !!glossaryConflict
        }
        controlsDisabled={controlsDisabled}
        onAdd={() => {
          clearFeedback('glossary')
          setGlossaryRows((rows) => [
            ...rows,
            {
              id: `new-glossary-${++nextRowId.current}`,
              entry: { en: '', ar: '', neutral: false }
            }
          ])
        }}
        onSave={() => void saveGlossary()}
      >
        {glossaryRows.map((row, index) => {
          const englishIssue = issueForField(glossaryIssues, index, 'en')
          const arabicIssue = issueForField(glossaryIssues, index, 'ar')
          const neutralIssue = issueForField(glossaryIssues, index, 'neutral')
          const englishErrorId = englishIssue ? `${row.id}-en-error` : undefined
          const arabicErrorId = arabicIssue ? `${row.id}-ar-error` : undefined
          const neutralErrorId = neutralIssue ? `${row.id}-neutral-error` : undefined
          return (
            <fieldset className="orbitpm-localization-resources__row" key={row.id}>
              <legend>{t('settings.localization.glossary.row', { index: index + 1 })}</legend>
              <RowActions
                index={index}
                count={glossaryRows.length}
                disabled={controlsDisabled}
                onMove={(offset) => {
                  clearFeedback('glossary')
                  setGlossaryRows((rows) => moveRow(rows, index, offset))
                }}
                onRemove={() => {
                  clearFeedback('glossary')
                  setGlossaryRows((rows) => rows.filter((_, current) => current !== index))
                }}
              />
              <div className="orbitpm-localization-resources__fields">
                <ResourceTextField
                  id={`${row.id}-en`}
                  label={t('settings.localization.english')}
                  value={row.entry.en}
                  language="en"
                  direction="ltr"
                  disabled={controlsDisabled}
                  issue={englishIssue}
                  errorId={englishErrorId}
                  onChange={(value) => {
                    clearFeedback('glossary')
                    setGlossaryRows((rows) =>
                      rows.map((current, currentIndex) =>
                        currentIndex === index
                          ? { ...current, entry: { ...current.entry, en: value } }
                          : current
                      )
                    )
                  }}
                />
                <ResourceTextField
                  id={`${row.id}-ar`}
                  label={t('settings.localization.arabic')}
                  value={row.entry.ar}
                  language="ar"
                  direction="rtl"
                  disabled={controlsDisabled}
                  issue={arabicIssue}
                  errorId={arabicErrorId}
                  onChange={(value) => {
                    clearFeedback('glossary')
                    setGlossaryRows((rows) =>
                      rows.map((current, currentIndex) =>
                        currentIndex === index
                          ? { ...current, entry: { ...current.entry, ar: value } }
                          : current
                      )
                    )
                  }}
                />
              </div>
              <label className="orbitpm-localization-resources__neutral">
                <input
                  type="checkbox"
                  checked={row.entry.neutral === true}
                  disabled={controlsDisabled}
                  aria-describedby={neutralErrorId}
                  aria-invalid={neutralIssue ? 'true' : undefined}
                  onChange={(event) => {
                    clearFeedback('glossary')
                    const neutral = event.target.checked
                    setGlossaryRows((rows) =>
                      rows.map((current, currentIndex) =>
                        currentIndex === index
                          ? {
                              ...current,
                              entry: { ...current.entry, neutral }
                            }
                          : current
                      )
                    )
                  }}
                />
                <span>
                  <strong>{t('settings.localization.glossary.neutral')}</strong>
                  <small>{t('settings.localization.glossary.neutralHint')}</small>
                </span>
              </label>
              {neutralIssue && neutralErrorId && (
                <InlineIssue id={neutralErrorId} issue={neutralIssue} />
              )}
            </fieldset>
          )
        })}
        {glossaryIssues
          .filter((issue) => issue.row < 0)
          .map((issue, index) => (
            <InlineIssue key={`glossary-document-${index}`} issue={issue} />
          ))}
      </ResourcePanel>

      <ResourcePanel
        title={t('settings.localization.translationMemory.title')}
        description={t('settings.localization.translationMemory.description')}
        empty={translationMemoryRows.length === 0}
        emptyMessage={t('settings.localization.translationMemory.empty')}
        addLabel={t('settings.localization.translationMemory.addAccepted')}
        saveLabel={
          pending === 'translation-memory'
            ? t('settings.localization.saving')
            : t('settings.localization.translationMemory.save')
        }
        saveDisabled={
          controlsDisabled ||
          translationMemoryIssues.length > 0 ||
          !translationMemoryDirty ||
          !!translationMemoryConflict
        }
        controlsDisabled={controlsDisabled}
        onAdd={() => {
          clearFeedback('translation-memory')
          setTranslationMemoryRows((rows) => [
            ...rows,
            {
              id: `new-translation-memory-${++nextRowId.current}`,
              entry: { en: '', ar: '', accepted: true }
            }
          ])
        }}
        onSave={() => void saveTranslationMemory()}
      >
        {translationMemoryRows.map((row, index) => {
          const englishIssue = issueForField(translationMemoryIssues, index, 'en')
          const arabicIssue = issueForField(translationMemoryIssues, index, 'ar')
          const acceptedIssue = issueForField(
            translationMemoryIssues,
            index,
            'accepted',
            'acceptedAt'
          )
          const englishErrorId = englishIssue ? `${row.id}-en-error` : undefined
          const arabicErrorId = arabicIssue ? `${row.id}-ar-error` : undefined
          return (
            <fieldset className="orbitpm-localization-resources__row" key={row.id}>
              <legend>
                {t('settings.localization.translationMemory.row', {
                  index: index + 1
                })}
              </legend>
              <RowActions
                index={index}
                count={translationMemoryRows.length}
                disabled={controlsDisabled}
                onMove={(offset) => {
                  clearFeedback('translation-memory')
                  setTranslationMemoryRows((rows) => moveRow(rows, index, offset))
                }}
                onRemove={() => {
                  clearFeedback('translation-memory')
                  setTranslationMemoryRows((rows) => rows.filter((_, current) => current !== index))
                }}
              />
              <div className="orbitpm-localization-resources__fields">
                <ResourceTextField
                  id={`${row.id}-en`}
                  label={t('settings.localization.english')}
                  value={row.entry.en}
                  language="en"
                  direction="ltr"
                  disabled={controlsDisabled}
                  issue={englishIssue}
                  errorId={englishErrorId}
                  onChange={(value) => {
                    clearFeedback('translation-memory')
                    setTranslationMemoryRows((rows) =>
                      rows.map((current, currentIndex) =>
                        currentIndex === index
                          ? { ...current, entry: { ...current.entry, en: value } }
                          : current
                      )
                    )
                  }}
                />
                <ResourceTextField
                  id={`${row.id}-ar`}
                  label={t('settings.localization.arabic')}
                  value={row.entry.ar}
                  language="ar"
                  direction="rtl"
                  disabled={controlsDisabled}
                  issue={arabicIssue}
                  errorId={arabicErrorId}
                  onChange={(value) => {
                    clearFeedback('translation-memory')
                    setTranslationMemoryRows((rows) =>
                      rows.map((current, currentIndex) =>
                        currentIndex === index
                          ? { ...current, entry: { ...current.entry, ar: value } }
                          : current
                      )
                    )
                  }}
                />
              </div>
              <div className="orbitpm-localization-resources__accepted">
                <span aria-label={t('settings.localization.translationMemory.accepted')}>
                  ✓ {t('settings.localization.translationMemory.accepted')}
                </span>
                {row.entry.acceptedAt && (
                  <time dateTime={row.entry.acceptedAt} dir="ltr">
                    {t('settings.localization.translationMemory.acceptedAt', {
                      date: row.entry.acceptedAt
                    })}
                  </time>
                )}
              </div>
              {acceptedIssue && <InlineIssue issue={acceptedIssue} />}
            </fieldset>
          )
        })}
        {translationMemoryIssues
          .filter((issue) => issue.row < 0)
          .map((issue, index) => (
            <InlineIssue key={`translation-memory-document-${index}`} issue={issue} />
          ))}
      </ResourcePanel>
    </section>
  )
}

interface ResourcePanelProps {
  title: string
  description: string
  empty: boolean
  emptyMessage: string
  addLabel: string
  saveLabel: string
  saveDisabled: boolean
  controlsDisabled: boolean
  onAdd: () => void
  onSave: () => void
  children: ReactNode
}

function ResourcePanel({
  title,
  description,
  empty,
  emptyMessage,
  addLabel,
  saveLabel,
  saveDisabled,
  controlsDisabled,
  onAdd,
  onSave,
  children
}: ResourcePanelProps): JSX.Element {
  return (
    <section className="orbitpm-localization-resources__panel" aria-label={title}>
      <header>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <button
          type="button"
          className="orbitpm-localization-resources__secondary"
          onClick={onAdd}
          disabled={controlsDisabled}
        >
          {addLabel}
        </button>
      </header>
      {empty && <p className="orbitpm-localization-resources__empty">{emptyMessage}</p>}
      <div className="orbitpm-localization-resources__rows">{children}</div>
      <button
        type="button"
        className="orbitpm-localization-resources__primary"
        onClick={onSave}
        disabled={saveDisabled}
      >
        {saveLabel}
      </button>
    </section>
  )
}

interface RowActionsProps {
  index: number
  count: number
  disabled: boolean
  onMove: (offset: -1 | 1) => void
  onRemove: () => void
}

function RowActions({ index, count, disabled, onMove, onRemove }: RowActionsProps): JSX.Element {
  return (
    <div className="orbitpm-localization-resources__row-actions">
      <button
        type="button"
        onClick={() => onMove(-1)}
        disabled={disabled || index === 0}
        aria-label={t('settings.localization.moveUp', { index: index + 1 })}
        title={t('settings.localization.moveUp', { index: index + 1 })}
      >
        ↑
      </button>
      <button
        type="button"
        onClick={() => onMove(1)}
        disabled={disabled || index === count - 1}
        aria-label={t('settings.localization.moveDown', { index: index + 1 })}
        title={t('settings.localization.moveDown', { index: index + 1 })}
      >
        ↓
      </button>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={t('settings.localization.remove', { index: index + 1 })}
        title={t('settings.localization.remove', { index: index + 1 })}
      >
        ×
      </button>
    </div>
  )
}

interface ResourceTextFieldProps {
  id: string
  label: string
  value: string
  language: 'en' | 'ar'
  direction: 'ltr' | 'rtl'
  disabled: boolean
  issue: LocalizationResourceDraftIssue | undefined
  errorId: string | undefined
  onChange: (value: string) => void
}

function ResourceTextField({
  id,
  label,
  value,
  language,
  direction,
  disabled,
  issue,
  errorId,
  onChange
}: ResourceTextFieldProps): JSX.Element {
  return (
    <div className="orbitpm-localization-resources__field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        lang={language}
        dir={direction}
        disabled={disabled}
        aria-invalid={issue ? 'true' : undefined}
        aria-describedby={errorId}
        onChange={(event) => onChange(event.target.value)}
      />
      {issue && errorId && <InlineIssue id={errorId} issue={issue} />}
    </div>
  )
}

function InlineIssue({
  id,
  issue
}: {
  id?: string
  issue: LocalizationResourceDraftIssue
}): JSX.Element {
  return (
    <small id={id} className="orbitpm-localization-resources__issue">
      {errorMessage(issue)}
    </small>
  )
}

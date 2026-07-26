import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { t } from '../i18n'
import { useLang } from '../i18n/useLang'
import type { GlossaryEntry, TranslationMemoryEntry } from '../localization/types'
import {
  WorkspaceLocalizationConflictError,
  WorkspaceLocalizationValidationError,
  type WorkspaceLocalizationState
} from '../localization/workspaceStore'
import {
  issueForField,
  validateGlossaryDraft,
  validateTranslationMemoryDraft,
  type LocalizationResourceDraftIssue
} from './localizationResourceDraft'
import './LocalizationResourcesEditor.css'

interface DraftRow<Entry> {
  id: string
  entry: Entry
}

type PendingAction = 'glossary' | 'translation-memory' | 'reload'
type ResourceScope = Exclude<PendingAction, 'reload'>

interface EditorFailure {
  scope: PendingAction
  conflict: boolean
  message: string
}

export interface LocalizationResourcesEditorProps {
  /** Latest compare-and-set snapshot returned by WorkspaceLocalizationStore. */
  snapshot: WorkspaceLocalizationState | null
  onSaveGlossary: (entries: readonly GlossaryEntry[]) => Promise<WorkspaceLocalizationState>
  onSaveTranslationMemory: (
    entries: readonly TranslationMemoryEntry[]
  ) => Promise<WorkspaceLocalizationState>
  onReload: () => Promise<WorkspaceLocalizationState>
  /** Lets Settings/App retain each callback's new hashes without re-reading. */
  onSnapshotChange?: (snapshot: WorkspaceLocalizationState) => void
  disabled?: boolean
}

function snapshotSignature(snapshot: WorkspaceLocalizationState | null): string {
  if (!snapshot) return ''
  return `${snapshot.files.glossary.hash}:${snapshot.files.translationMemory.hash}`
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

function failureFrom(error: unknown, scope: PendingAction): EditorFailure {
  if (error instanceof WorkspaceLocalizationConflictError) {
    return {
      scope,
      conflict: true,
      message: t('settings.localization.conflict')
    }
  }
  if (error instanceof WorkspaceLocalizationValidationError) {
    return {
      scope,
      conflict: false,
      message: t('settings.localization.validation.schema')
    }
  }
  return {
    scope,
    conflict: false,
    message: t('settings.localization.saveFailed', {
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

export function LocalizationResourcesEditor({
  snapshot,
  onSaveGlossary,
  onSaveTranslationMemory,
  onReload,
  onSnapshotChange,
  disabled = false
}: LocalizationResourcesEditorProps): JSX.Element {
  useLang()
  const nextRowId = useRef(0)
  const lastPropSignature = useRef(snapshotSignature(snapshot))
  const [baseline, setBaseline] = useState(snapshot)
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
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [failure, setFailure] = useState<EditorFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const resetDrafts = useCallback((next: WorkspaceLocalizationState): void => {
    const signature = snapshotSignature(next)
    setBaseline(next)
    setGlossaryRows(rowsFrom(next.resources.glossary, `glossary-${signature}`))
    setTranslationMemoryRows(
      rowsFrom(next.resources.translationMemory, `translation-memory-${signature}`)
    )
    setFailure(null)
  }, [])

  useEffect(() => {
    const signature = snapshotSignature(snapshot)
    if (signature === lastPropSignature.current) return
    lastPropSignature.current = signature
    if (!snapshot) {
      setBaseline(null)
      setGlossaryRows([])
      setTranslationMemoryRows([])
      setFailure(null)
      setNotice(null)
      return
    }
    resetDrafts(snapshot)
    setNotice(null)
  }, [resetDrafts, snapshot])

  const glossary = useMemo(() => glossaryRows.map((row) => row.entry), [glossaryRows])
  const translationMemory = useMemo(
    () => translationMemoryRows.map((row) => row.entry),
    [translationMemoryRows]
  )
  const glossaryIssues = useMemo(() => validateGlossaryDraft(glossary), [glossary])
  const translationMemoryIssues = useMemo(
    () => validateTranslationMemoryDraft(translationMemory),
    [translationMemory]
  )
  const glossaryDirty =
    baseline !== null && JSON.stringify(glossary) !== JSON.stringify(baseline.resources.glossary)
  const translationMemoryDirty =
    baseline !== null &&
    JSON.stringify(translationMemory) !== JSON.stringify(baseline.resources.translationMemory)
  const controlsDisabled = disabled || pending !== null

  const acceptSnapshot = (next: WorkspaceLocalizationState, message: string): void => {
    lastPropSignature.current = snapshotSignature(next)
    resetDrafts(next)
    setNotice(message)
    onSnapshotChange?.(next)
  }

  const saveGlossary = async (): Promise<void> => {
    if (glossaryIssues.length > 0 || !glossaryDirty || controlsDisabled) return
    setPending('glossary')
    setFailure(null)
    setNotice(null)
    try {
      acceptSnapshot(await onSaveGlossary(glossary), t('settings.localization.glossary.saved'))
    } catch (error) {
      setFailure(failureFrom(error, 'glossary'))
    } finally {
      setPending(null)
    }
  }

  const saveTranslationMemory = async (): Promise<void> => {
    if (translationMemoryIssues.length > 0 || !translationMemoryDirty || controlsDisabled) {
      return
    }
    setPending('translation-memory')
    setFailure(null)
    setNotice(null)
    try {
      acceptSnapshot(
        await onSaveTranslationMemory(translationMemory),
        t('settings.localization.translationMemory.saved')
      )
    } catch (error) {
      setFailure(failureFrom(error, 'translation-memory'))
    } finally {
      setPending(null)
    }
  }

  const reload = async (): Promise<void> => {
    if (controlsDisabled) return
    setPending('reload')
    setFailure(null)
    setNotice(null)
    try {
      acceptSnapshot(await onReload(), t('settings.localization.reloaded'))
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

  if (!baseline) {
    return (
      <section
        className="orbitpm-localization-resources"
        aria-labelledby="orbitpm-localization-resources-title"
      >
        <h2 id="orbitpm-localization-resources-title">{t('settings.localization.title')}</h2>
        <p>{t('settings.localization.unavailable')}</p>
      </section>
    )
  }

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
        {failure?.conflict && (
          <button
            type="button"
            className="orbitpm-localization-resources__secondary"
            onClick={() => void reload()}
            disabled={controlsDisabled}
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

      {failure && (
        <p className="orbitpm-localization-resources__failure" role="alert">
          {failure.message}
        </p>
      )}
      {notice && (
        <p className="orbitpm-localization-resources__notice" role="status">
          {notice}
        </p>
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
        saveDisabled={controlsDisabled || glossaryIssues.length > 0 || !glossaryDirty}
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
          controlsDisabled || translationMemoryIssues.length > 0 || !translationMemoryDirty
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

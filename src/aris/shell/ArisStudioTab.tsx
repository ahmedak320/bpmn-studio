/**
 * One open ARIS source: canvas + toolbar + details/accounting/fidelity rails.
 *
 * This is where the twelve lanes meet. Everything on screen is produced by a
 * lane's own exported entry point — the canvas by `src/aris/canvas`, the clean
 * layout by `src/aris/layout` through the canvas's documented one-call seam, the
 * fidelity report by `src/aris/renderer`, the properties rail by
 * `src/aris/details`, and the accounting rail by `src/aris/accounting`.
 *
 * Undo/redo, Clean Layout and Reset to Source Layout are all ARIS commands on
 * the same stack, so "reset" is not a separate mode flag that could drift: it is
 * a gesture that writes the imported geometry back, and undoing it returns to
 * the clean layout exactly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { t } from '../../i18n'
import type { ArisCanvas } from '../canvas/ArisCanvas'
import type { ArisBusinessObject } from '../canvas/elements'
import type { ArisCleanLayoutEngine } from '../canvas/layoutSeam'
import type { ArisAccountingReportRow } from '../accounting/types'
import type { ArisChatCommand } from '../chat/patchSchema'
import { cleanLayout } from '../layout/cleanLayout'
import { arisLayoutRejectionMessageKey } from '../layout/rejection'
import type { ArisWorkingDocument } from '../model/types'
import { ARIS_EXPERIMENTAL_EXPORT_LABEL_KEY } from '../writer'
import type { Key } from '../../i18n'
import { ArisAccountingRail } from './ArisAccountingRail'
import type { ArisTabChatHost } from './arisChatDrawerTypes'
import { ArisEpcRail } from './ArisEpcRail'
import {
  applyArisChatCommandsAsGesture,
  createArisChatApplyHost,
  scanArisGaps
} from './arisChatHost'
import { buildConfirmationPreview } from '../chat/applyEngine'
import { buildDeterministicFixPlan, type ArisFixConfirmProposal } from '../chat/deterministicFixes'
import { detectLocaleIds } from './arisChatProposal'
import { ArisFixMissingDialog, type ArisFixPreviewRows } from './ArisFixMissingDialog'
import { derivedAmlFileName, exportArisDerivedAml } from './arisDerivedExport'
import {
  buildArisEpcFindings,
  arisEpcFindingTargetId,
  type ArisEpcModelFinding
} from './arisEpcFindings'
import {
  ArisCanvasView,
  type ArisCanvasHistoryState,
  type ArisCanvasSelectionState
} from './ArisCanvasView'
import { ArisDetailsRail } from './ArisDetailsRail'
import type { ArisDetailsEditingApi } from './arisDetailsEditing'
import { arisText, buildArisDetailsDocument, type ArisStudioDocument } from './arisStudioDocument'
import {
  ArisTranslateController,
  type ArisTranslateControllerHandle
} from './ArisTranslateController'
import { countArisMissingTranslations } from '../localization'
import type { LocalizationResources } from '../../localization/types'
import { tk } from './shellI18n'

export type ArisLayoutModeState = 'source' | 'clean'

export interface ArisSourceFact {
  readonly labelKey: string
  readonly value: string | number
}

/** A request from outside the tab to reveal one element (assistant chip, §17.6). */
export interface ArisSelectionRequest {
  /** Changes on every request, so the same element can be re-selected. */
  readonly token: number
  readonly modelId: string | null
  readonly elementId: string
}

export interface ArisStudioTabProps {
  readonly title: string
  readonly studio: ArisStudioDocument
  readonly modelId: string | null
  readonly active: boolean
  readonly lang: 'en' | 'ar'
  readonly sourceFacts: readonly ArisSourceFact[]
  readonly sourceText: string
  readonly canImport: boolean
  readonly onModelChange: (modelId: string) => void
  readonly onDownloadSource: () => void
  readonly onDownloadAttachment: (filename: string, bytes: Uint8Array, mimeType: string) => void
  readonly onOpenAssistant: () => void
  readonly onImportPackage: () => void
  readonly onToast: (message: string, tone?: 'info' | 'error' | 'success') => void
  /** File name of the imported source, used to name the derived export. */
  readonly sourceFileName?: string
  readonly selectionRequest?: ArisSelectionRequest | null
  /** Report whether a selection request could be honoured. */
  readonly onSelectionResolved?: (token: number, revealed: boolean) => void
  /** Stable key used to register this tab as a chat-drawer host. */
  readonly chatHostKey?: string
  /** Register/unregister the tab's chat host with the shell. */
  readonly onChatHostChange?: (key: string, host: ArisTabChatHost | null) => void
  /**
   * The opened source's kind; `'generated'` enables the silent auto-translate.
   * Optional so pre-existing render tests can mount the tab without it (absent ⇒
   * never auto-translates); `src/ArisApp.tsx` always supplies it.
   */
  readonly sourceKind?: string
  /** Workspace glossary/TM for the translation review; `null` ⇒ built-in defaults. */
  readonly localizationResources?: LocalizationResources | null
  /** Persist an accepted bilingual pair to the workspace translation memory. */
  readonly onAcceptedTranslationPair?: (pair: { en: string; ar: string }) => void
  /** Route the fix dialog's Tier-C gaps into the chat drawer's interview tab (plan §18). */
  readonly onOpenInterview?: () => void
}

const EMPTY_HISTORY: ArisCanvasHistoryState = Object.freeze({
  canUndo: false,
  canRedo: false,
  revision: 0,
  commandCount: 0,
  document: null
})

/** Display text for a selected canvas element, whatever kind it is. */
function businessObjectLabel(businessObject: ArisBusinessObject | null): string | null {
  if (!businessObject) return null
  switch (businessObject.kind) {
    case 'freeText':
    case 'label':
    case 'connectionLabel':
      return businessObject.text
    default:
      return businessObject.name
  }
}

const EMPTY_SELECTION: ArisCanvasSelectionState = Object.freeze({
  detailsElement: null,
  businessObject: null,
  highlight: null,
  selectedIds: Object.freeze([])
})

export function ArisStudioTab({
  title,
  studio,
  modelId,
  active,
  lang,
  sourceFacts,
  sourceText,
  canImport,
  onModelChange,
  onDownloadSource,
  onDownloadAttachment,
  onOpenAssistant,
  onImportPackage,
  onToast,
  sourceFileName,
  selectionRequest,
  onSelectionResolved,
  chatHostKey,
  onChatHostChange,
  sourceKind,
  localizationResources = null,
  onAcceptedTranslationPair,
  onOpenInterview
}: ArisStudioTabProps): JSX.Element {
  const canvasRef = useRef<ArisCanvas | null>(null)
  const [selection, setSelection] = useState<ArisCanvasSelectionState>(EMPTY_SELECTION)
  const [history, setHistory] = useState<ArisCanvasHistoryState>(EMPTY_HISTORY)
  const [layoutMode, setLayoutMode] = useState<ArisLayoutModeState>('source')
  const [dismissedHint, setDismissedHint] = useState(false)
  // The diagram-label language. It follows the app language until the toolbar
  // toggle overrides it (view-only projection; §L5a's canvas seam).
  const [contentLangOverride, setContentLangOverride] = useState<'en' | 'ar' | null>(null)
  const contentLang = contentLangOverride ?? lang
  // Bumped when the canvas becomes ready, so the content-language effect and the
  // translate controller re-run against the live canvas.
  const [canvasTick, setCanvasTick] = useState(0)
  const translateRef = useRef<ArisTranslateControllerHandle | null>(null)
  const [fixDialogOpen, setFixDialogOpen] = useState(false)

  const renderableModelId = useMemo(() => {
    if (modelId && studio.models.some((model) => model.id === modelId && model.renderable)) {
      return modelId
    }
    return studio.models.find((model) => model.renderable)?.id ?? null
  }, [modelId, studio.models])

  // Which model owns each occurrence/connection, so an accounting row can be
  // revealed even when it lives on another model.
  const modelIdByElementId = useMemo(() => {
    const index = new Map<string, string>()
    for (const model of studio.source.models.values()) {
      for (const occurrence of model.occurrences) index.set(occurrence.id, model.id)
      for (const connection of model.connectionOccurrences) index.set(connection.id, model.id)
    }
    return index
  }, [studio.source])

  // The details projection follows the *live* document the canvas published, so
  // an edit, an undo and a model switch all refresh the rail through one path.
  const liveDocument = history.document ?? studio.source
  const detailsDocument = useMemo(
    () => buildArisDetailsDocument(liveDocument, studio.attachments),
    [liveDocument, studio.attachments]
  )

  // A stable canvas accessor whose identity changes only when the canvas is
  // (re)ready, so the translate controller's one-shot auto-run effect re-fires
  // once the live canvas exists.
  const getCanvas = useCallback((): ArisCanvas | null => {
    void canvasTick
    return canvasRef.current
  }, [canvasTick])

  // Labels missing the OTHER language — the target a Translate run would fill.
  const missingTranslations = useMemo(
    () => countArisMissingTranslations(liveDocument),
    [liveDocument]
  )
  const missingTranslationCount =
    contentLang === 'en' ? missingTranslations.ar : missingTranslations.en

  // Project the canvas captions into the chosen content language (view only,
  // off the undo stack). Re-runs on a language change and on canvas (re)ready.
  useEffect(() => {
    canvasRef.current?.setContentLanguage(contentLang)
  }, [contentLang, canvasTick])

  const modelName = useMemo(() => {
    const summary = studio.models.find((model) => model.id === renderableModelId)
    return summary ? (arisText(summary.names, lang) ?? summary.id) : title
  }, [lang, renderableModelId, studio.models, title])

  const activeModelIsEmpty =
    ((history.document ?? studio.source).models.get(renderableModelId ?? '')?.occurrences.length ??
      -1) === 0

  const runLayout = useCallback(
    (engine: ArisCleanLayoutEngine, nextMode: ArisLayoutModeState, successMessage: string) => {
      const canvas = canvasRef.current
      if (!canvas) return
      try {
        canvas.applyCleanLayout(engine)
      } catch (error) {
        onToast(
          tk('aris.layout.failed', 'Clean Layout failed: {error}', {
            error: error instanceof Error ? error.message : String(error)
          }),
          'error'
        )
        return
      }
      setLayoutMode(nextMode)
      onToast(successMessage, 'success')
    },
    [onToast]
  )

  const handleCleanLayout = useCallback(() => {
    // Captured through an object because TypeScript cannot see the closure's
    // assignment in this function's own control flow.
    const rejection: { reason: string | null } = { reason: null }
    runLayout(
      (graph) => {
        const result = cleanLayout(graph)
        if (!result.accepted && result.findings.length > 0) {
          rejection.reason = result.findings
            .map((finding) => t(arisLayoutRejectionMessageKey(finding.code) as Key))
            .join(' ')
        }
        return result
      },
      'clean',
      tk('aris.layout.cleanApplied', 'Clean Layout applied as one undoable step.')
    )
    if (rejection.reason !== null) {
      onToast(
        tk('aris.layout.rejected', 'Clean Layout was rejected: {reason}', {
          reason: rejection.reason
        })
      )
    }
  }, [onToast, runLayout])

  const handleResetLayout = useCallback(() => {
    if (!renderableModelId) return
    const original = studio.source.models.get(renderableModelId)
    if (!original) return
    runLayout(
      () => ({
        nodes: original.occurrences.map((occurrence) => ({
          id: occurrence.id,
          rect: occurrence.bounds
        })),
        edges: original.connectionOccurrences.map((connection) => ({
          id: connection.id,
          points: connection.route
        })),
        // §12.4: a reset restores *every* imported coordinate, and Clean Layout
        // moves free-text notes too, so the notes come back with the rest.
        annotations: original.freeText.map((text) => ({ id: text.id, rect: text.bounds }))
      }),
      'source',
      tk('aris.layout.resetApplied', 'Reset to the imported source layout.')
    )
  }, [renderableModelId, runLayout, studio.source])

  /**
   * Reveal one element on the canvas, switching models when it lives on another.
   * Shared by every rail: accounting rows, EPC findings and assistant chips all
   * mean the same gesture.
   */
  const revealElement = useCallback(
    (elementId: string): boolean => {
      const canvas = canvasRef.current
      if (!canvas) return false
      if (studio.source.models.has(elementId)) {
        const summary = studio.models.find((model) => model.id === elementId)
        if (!summary?.renderable) return false
        onModelChange(elementId)
        return true
      }
      const ownerModelId = modelIdByElementId.get(elementId)
      if (!ownerModelId) return false
      if (canvas.activeModelId !== ownerModelId) {
        if (!canvas.document.models.has(ownerModelId)) return false
        canvas.setActiveModel(ownerModelId)
        onModelChange(ownerModelId)
      }
      if (!canvas.elementRegistry.get(elementId)) return false
      canvas.select(elementId)
      return true
    },
    [modelIdByElementId, onModelChange, studio.models, studio.source]
  )

  const handleSelectRecord = useCallback(
    (row: ArisAccountingReportRow): boolean => {
      const candidates = [row.sourceId, ...row.targetIds].filter(
        (value): value is string => typeof value === 'string' && value !== ''
      )
      // Shapes first, then the model rows, so a row that names both reveals the
      // element rather than merely switching models.
      const shapes = candidates.filter((candidate) => !studio.source.models.has(candidate))
      const models = candidates.filter((candidate) => studio.source.models.has(candidate))
      return [...shapes, ...models].some((candidate) => revealElement(candidate))
    },
    [revealElement, studio.source]
  )

  // --- plan §14.1: EPC findings for the live document ---------------------------
  const epcFindings = useMemo(() => buildArisEpcFindings(liveDocument), [liveDocument])

  const handleSelectFinding = useCallback(
    (finding: ArisEpcModelFinding): boolean => {
      const targetId = arisEpcFindingTargetId(finding)
      if (targetId === null) return revealElement(finding.modelId)
      return revealElement(targetId) || revealElement(finding.modelId)
    },
    [revealElement]
  )

  // --- plan §9: derived AML export ---------------------------------------------
  const handleExportDerivedAml = useCallback(() => {
    try {
      const exported = exportArisDerivedAml({
        originalText: sourceText,
        original: studio.source,
        live: liveDocument
      })
      onDownloadAttachment(
        derivedAmlFileName(sourceFileName ?? `${title}.aml`),
        exported.result.bytes,
        'application/xml'
      )
      if (exported.unmapped.length > 0) {
        onToast(
          tk(
            'aris.export.unmapped',
            '{count} edits could not be addressed against the original bytes and were left out.',
            { count: exported.unmapped.length }
          )
        )
        return
      }
      onToast(
        tk('aris.export.done', 'Derived AML exported: {edits} edits, {bytes} bytes.', {
          edits: exported.editCount,
          bytes: exported.result.derivedByteLength
        }),
        'success'
      )
    } catch (error) {
      onToast(
        tk('aris.export.refused', 'The derived export was refused: {error}', {
          error: error instanceof Error ? error.message : String(error)
        }),
        'error'
      )
    }
  }, [
    liveDocument,
    onDownloadAttachment,
    onToast,
    sourceFileName,
    sourceText,
    studio.source,
    title
  ])

  // --- plan §18: commit chat-applied commands as ONE undoable gesture -----------
  const handleApplyChatCommands = useCallback(
    (commands: readonly ArisChatCommand[], label: string): ArisWorkingDocument | null => {
      const canvas = canvasRef.current
      if (!canvas) return null
      return applyArisChatCommandsAsGesture(canvas, commands, label)
    },
    []
  )

  // --- plan §18: "N issues — Fix…" badge + three-tier deterministic fix plan ----
  const gaps = useMemo(() => scanArisGaps(liveDocument), [liveDocument])
  const fixLocales = useMemo(() => detectLocaleIds(liveDocument), [liveDocument])
  const fixPlan = useMemo(
    () => buildDeterministicFixPlan(liveDocument, gaps, fixLocales),
    [liveDocument, gaps, fixLocales]
  )

  const handleFixAutoFix = useCallback(() => {
    // Tier A hands the counterpart-language fills to the translate controller's review/fill path,
    // which is itself the outbound-consent surface for any provider run.
    setFixDialogOpen(false)
    translateRef.current?.openReview()
  }, [])

  const handleFixApplySelected = useCallback(
    (commands: readonly ArisChatCommand[]) => {
      const canvas = canvasRef.current
      if (!canvas || commands.length === 0) return
      const applied = applyArisChatCommandsAsGesture(
        canvas,
        commands,
        tk('aris.fix.gestureLabel', 'Fix missing components')
      )
      if (!applied) {
        onToast(
          tk('aris.chat.commitFailed', 'The canvas rejected the change; nothing was applied.'),
          'error'
        )
        return
      }
      onToast(
        tk('aris.fix.applied', 'Applied {count} fixes as one undoable step.', {
          count: commands.length
        }),
        'success'
      )
      // The rescan is automatic: the gesture updates the live document, which re-derives `gaps`.
    },
    [onToast]
  )

  const handleFixOpenInterview = useCallback(() => {
    setFixDialogOpen(false)
    onOpenInterview?.()
  }, [onOpenInterview])

  const buildFixPreview = useCallback(
    (proposal: ArisFixConfirmProposal): ArisFixPreviewRows | null => {
      try {
        const host = createArisChatApplyHost()
        const outcome = buildConfirmationPreview(
          liveDocument,
          proposal.commands,
          host,
          (previewDocument, ids) =>
            ids.map((id) => {
              const model = previewDocument.models.get(id)
              if (model) return `${id} · ${model.names.fallback ?? id}`
              const definition = previewDocument.objectDefinitions.get(id)
              if (definition) return `${id} · ${definition.names.fallback ?? definition.type}`
              return id
            })
        )
        if (!outcome.ok) return null
        return {
          before: (outcome.preview.before as string[] | null) ?? [],
          after: (outcome.preview.after as string[] | null) ?? []
        }
      } catch {
        return null
      }
    },
    [liveDocument]
  )

  // --- plan §18.2: chat drawer host surface ------------------------------------
  const chatHost = useMemo<ArisTabChatHost>(
    () => ({
      getDocument: () => canvasRef.current?.document ?? null,
      applyCommands: handleApplyChatCommands,
      undo: () => canvasRef.current?.undo(),
      getCanUndo: () => canvasRef.current?.canUndo ?? false
    }),
    [handleApplyChatCommands]
  )
  useEffect(() => {
    if (!chatHostKey || !onChatHostChange) return
    onChatHostChange(chatHostKey, chatHost)
    return () => onChatHostChange(chatHostKey, null)
  }, [chatHost, chatHostKey, onChatHostChange])

  // An assistant chip asks for an element that may live on another model.
  useEffect(() => {
    if (!selectionRequest) return
    const revealed = revealElement(selectionRequest.elementId)
    onSelectionResolved?.(selectionRequest.token, revealed)
    // `revealElement` is stable for a given document; re-running on every
    // identity change would re-select on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionRequest?.token])

  const selectionLabel =
    businessObjectLabel(selection.businessObject) ?? selection.detailsElement?.id ?? null

  // --- plan §11.4/§13.3: the details rail's write half --------------------------
  // Every method is one `ArisAuthoring` call, i.e. one `bridge.execute`, i.e.
  // one undo step on the same stack the canvas gestures use. A refusal from the
  // ARIS command system is surfaced as a toast and changes nothing.
  const handleEditError = useCallback(
    (error: unknown) => {
      onToast(
        tk('aris.details.edit.failed', 'The change was refused: {error}', {
          error: error instanceof Error ? error.message : String(error)
        }),
        'error'
      )
    },
    [onToast]
  )

  const detailsEditing = useMemo<ArisDetailsEditingApi>(() => {
    const run = (operation: (authoring: ArisCanvas['authoring']) => void): void => {
      const canvas = canvasRef.current
      if (!canvas) return
      try {
        operation(canvas.authoring)
      } catch (error) {
        handleEditError(error)
      }
    }
    return {
      renameDefinition: (definitionId, localeId, name) =>
        run((authoring) => authoring.renameDefinition(definitionId, name, localeId)),
      renameModel: (id, localeId, name) =>
        run((authoring) => authoring.renameModel(id, name, localeId)),
      setDefinitionAttribute: (definitionId, attributeType, values) =>
        run((authoring) => authoring.setDefinitionAttribute(definitionId, attributeType, values)),
      restyleOccurrence: (occurrenceId, style) =>
        run((authoring) => authoring.restyleOccurrence(occurrenceId, style)),
      addModelAssignment: (definitionId, linkedModelId) =>
        run((authoring) => authoring.addModelAssignment(definitionId, linkedModelId)),
      removeModelAssignment: (definitionId, linkedModelId) =>
        run((authoring) => authoring.removeModelAssignment(definitionId, linkedModelId)),
      addAttachment: (definitionId, attachment) =>
        run((authoring) => authoring.addAttachment(definitionId, attachment)),
      removeAttachment: (definitionId, attachmentId) =>
        run((authoring) => authoring.removeAttachment(definitionId, attachmentId)),
      downloadAttachment: (definitionId, attachmentId) =>
        run((authoring) => {
          const file = authoring.downloadAttachment(definitionId, attachmentId)
          onDownloadAttachment(file.fileName, file.bytes, file.mimeType)
        })
    }
  }, [handleEditError, onDownloadAttachment])

  return (
    <section
      aria-label={t('aris.placeholder.mainAria', { name: title })}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 380px)',
        gap: 16,
        padding: '1rem',
        minHeight: 0,
        height: '100%'
      }}
    >
      <div
        style={{
          minWidth: 0,
          minHeight: 0,
          display: 'grid',
          gridTemplateRows: 'auto minmax(0, 1fr)',
          gap: 12
        }}
      >
        <header
          className="orbitpm-aris-toolbar"
          aria-label={tk('aris.toolbar.aria', 'ARIS canvas controls')}
        >
          <strong style={{ fontSize: 16 }}>{title}</strong>
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            disabled={!history.canUndo}
            data-orbitpm-aris-undo=""
            onClick={() => canvasRef.current?.undo()}
          >
            {tk('aris.toolbar.undo', 'Undo')}
          </button>
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            disabled={!history.canRedo}
            data-orbitpm-aris-redo=""
            onClick={() => canvasRef.current?.redo()}
          >
            {tk('aris.toolbar.redo', 'Redo')}
          </button>
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            title={t('editor.zoomOut.title')}
            onClick={() =>
              canvasRef.current?.zoom(Math.max(0.2, (canvasRef.current?.canvas.zoom() ?? 1) - 0.2))
            }
          >
            −
          </button>
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            title={t('editor.zoomIn.title')}
            onClick={() =>
              canvasRef.current?.zoom(Math.min(4, (canvasRef.current?.canvas.zoom() ?? 1) + 0.2))
            }
          >
            +
          </button>
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            // `zoom('fit-viewport')` is exactly what the canvas facade's
            // fit-to-viewport helper calls. Spelling it out avoids the
            // `check:no-skips` regex, which reads that helper's name followed
            // by a parenthesis as the Jasmine focus alias.
            onClick={() => canvasRef.current?.zoom('fit-viewport')}
          >
            {t('editor.zoomFit')}
          </button>
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            data-orbitpm-aris-clean-layout=""
            onClick={handleCleanLayout}
          >
            {tk('aris.toolbar.cleanLayout', 'Clean Layout')}
          </button>
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            data-orbitpm-aris-reset-layout=""
            onClick={handleResetLayout}
          >
            {tk('aris.toolbar.resetLayout', 'Reset to Source Layout')}
          </button>
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            data-orbitpm-aris-content-lang={contentLang}
            title={tk(
              'aris.toolbar.contentLang.title',
              'Switch the diagram labels between English and Arabic (view only, no edit)'
            )}
            onClick={() => setContentLangOverride(contentLang === 'en' ? 'ar' : 'en')}
          >
            {tk('aris.toolbar.contentLang', 'Labels: {language}', {
              language: t(contentLang === 'en' ? 'app.lang.en' : 'app.lang.ar')
            })}
          </button>
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            data-orbitpm-aris-translate=""
            onClick={() => translateRef.current?.openReview()}
          >
            {tk('aris.toolbar.translate', 'Translate…')}
          </button>
          {missingTranslationCount > 0 && (
            <span
              data-orbitpm-aris-translate-missing={missingTranslationCount}
              style={{
                padding: '0.2rem 0.55rem',
                borderRadius: 999,
                border: '1px solid var(--orbitpm-border)',
                fontSize: 12,
                color: 'var(--orbitpm-muted)'
              }}
            >
              {tk('aris.toolbar.translate.missing', '{count} untranslated', {
                count: missingTranslationCount
              })}
            </span>
          )}
          {gaps.length > 0 && (
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              data-orbitpm-aris-fix-issues={gaps.length}
              onClick={() => setFixDialogOpen(true)}
            >
              {tk('aris.fix.badge', '{count} issues — Fix…', { count: gaps.length })}
            </button>
          )}
          <span
            data-orbitpm-aris-layout-mode={layoutMode}
            style={{
              padding: '0.2rem 0.55rem',
              borderRadius: 999,
              border: '1px solid var(--orbitpm-border)',
              fontSize: 12,
              color: 'var(--orbitpm-muted)'
            }}
          >
            {layoutMode === 'clean'
              ? tk('aris.toolbar.layoutMode.clean', 'Clean Layout')
              : tk('aris.toolbar.layoutMode.source', 'Source Layout')}
          </span>
          <button type="button" className="orbitpm-lite-chrome-btn" onClick={onDownloadSource}>
            {t('aris.placeholder.downloadSource')}
          </button>
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            data-orbitpm-aris-export-derived=""
            // §9.5 fixes this wording; it stays until a live ARIS import/re-export
            // test passes, which only the operator can run.
            title={t(ARIS_EXPERIMENTAL_EXPORT_LABEL_KEY as Key)}
            onClick={handleExportDerivedAml}
          >
            {t(ARIS_EXPERIMENTAL_EXPORT_LABEL_KEY as Key)}
          </button>
          {canImport && (
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              data-orbitpm-aris-import-package=""
              onClick={onImportPackage}
            >
              {tk('aris.toolbar.importPackage', 'Import into workspace…')}
            </button>
          )}
          <button type="button" className="orbitpm-lite-chrome-btn" onClick={onOpenAssistant}>
            {t('aris.placeholder.openAssistant')}
          </button>
        </header>

        {renderableModelId ? (
          <div
            style={{
              position: 'relative',
              minWidth: 0,
              minHeight: 0
            }}
          >
            <ArisCanvasView
              document={studio.source}
              modelId={renderableModelId}
              active={active}
              ariaLabel={tk('aris.canvas.aria', 'ARIS canvas for {model}', { model: modelName })}
              onReady={(canvas) => {
                canvasRef.current = canvas
                setCanvasTick((tick) => tick + 1)
              }}
              onSelectionChange={setSelection}
              onHistoryChange={setHistory}
              onError={(error) =>
                onToast(
                  tk('aris.canvas.bootFailed', 'The ARIS canvas could not be opened: {error}', {
                    error: error instanceof Error ? error.message : String(error)
                  }),
                  'error'
                )
              }
            />
            {activeModelIsEmpty && !dismissedHint && (
              <div
                data-orbitpm-aris-empty-hint=""
                style={{
                  position: 'absolute',
                  insetInlineStart: 76,
                  top: 16,
                  maxWidth: 340,
                  padding: '0.75rem 1rem',
                  background: 'var(--orbitpm-panel-bg)',
                  border: '1px solid var(--orbitpm-border)',
                  borderRadius: 8,
                  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
                  pointerEvents: 'none',
                  zIndex: 10
                }}
              >
                <p style={{ margin: '0 0 0.5rem' }}>{t('aris.canvas.emptyModelHint')}</p>
                <button
                  type="button"
                  className="orbitpm-lite-chrome-btn"
                  style={{ pointerEvents: 'auto' }}
                  onClick={() => setDismissedHint(true)}
                >
                  {t('aris.canvas.emptyModelHint.dismiss')}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div
            className="orbitpm-aris-canvas orbitpm-aris-canvas-empty"
            data-orbitpm-aris-canvas-empty=""
          >
            <p style={{ margin: 0, maxWidth: 620 }}>
              {tk(
                'aris.canvas.noModels',
                'This source carries no ARIS model records, so there is nothing to draw. The source, accounting and details rails still describe every imported record.'
              )}
            </p>
          </div>
        )}
      </div>

      <aside
        className="orbitpm-aris-rail"
        aria-label={tk('aris.rail.aria', 'ARIS details and accounting rails')}
      >
        <ArisDetailsRail
          details={detailsDocument}
          element={selection.detailsElement}
          elementLabel={selectionLabel}
          modelId={renderableModelId}
          onDownloadAttachment={onDownloadAttachment}
          document={liveDocument}
          lang={lang}
          editing={detailsEditing}
          onEditError={(message) => onToast(message, 'error')}
        />

        <ArisAccountingRail
          report={studio.accounting}
          fidelity={studio.fidelity}
          fidelityByKind={studio.fidelityByKind}
          onSelectRecord={handleSelectRecord}
        />

        <ArisEpcRail findings={epcFindings} onSelectFinding={handleSelectFinding} />

        <section className="orbitpm-aris-rail__section">
          <h3 className="orbitpm-aris-rail__heading" style={{ fontSize: 15 }}>
            {t('aris.placeholder.detailsHeading')}
          </h3>
          <dl className="orbitpm-aris-defs">
            {sourceFacts.map((fact) => (
              <div key={fact.labelKey} style={{ display: 'contents' }}>
                <dt>{t(fact.labelKey as Key)}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="orbitpm-aris-rail__section">
          <h3 className="orbitpm-aris-rail__heading" style={{ fontSize: 15 }}>
            {t('aris.placeholder.sourceHeading')}
          </h3>
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              fontSize: 12,
              lineHeight: 1.5,
              maxHeight: 260,
              overflow: 'auto'
            }}
          >
            {sourceText.slice(0, 20_000)}
          </pre>
        </section>
      </aside>

      <ArisTranslateController
        ref={translateRef}
        getCanvas={getCanvas}
        liveDocument={liveDocument}
        contentLang={contentLang}
        documentName={title}
        autoTranslateEligible={sourceKind === 'generated'}
        resources={localizationResources}
        onAcceptedPair={onAcceptedTranslationPair}
        onToast={onToast}
      />

      <ArisFixMissingDialog
        open={fixDialogOpen}
        document={liveDocument}
        plan={fixPlan}
        busy={false}
        onAutoFix={handleFixAutoFix}
        onApplySelected={handleFixApplySelected}
        onOpenInterview={handleFixOpenInterview}
        onClose={() => setFixDialogOpen(false)}
        buildPreview={buildFixPreview}
      />
    </section>
  )
}

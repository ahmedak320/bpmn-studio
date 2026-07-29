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
import { ArisChatImproveRail } from './ArisChatImproveRail'
import { ArisEpcRail } from './ArisEpcRail'
import { toArisEditCommand } from './arisChatHost'
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
import { arisText, buildArisDetailsDocument, type ArisStudioDocument } from './arisStudioDocument'
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
  onSelectionResolved
}: ArisStudioTabProps): JSX.Element {
  const canvasRef = useRef<ArisCanvas | null>(null)
  const [selection, setSelection] = useState<ArisCanvasSelectionState>(EMPTY_SELECTION)
  const [history, setHistory] = useState<ArisCanvasHistoryState>(EMPTY_HISTORY)
  const [layoutMode, setLayoutMode] = useState<ArisLayoutModeState>('source')

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

  const modelName = useMemo(() => {
    const summary = studio.models.find((model) => model.id === renderableModelId)
    return summary ? (arisText(summary.names, lang) ?? summary.id) : title
  }, [lang, renderableModelId, studio.models, title])

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
        }))
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
      try {
        canvas.bridge.execute(
          label,
          commands.map(
            (command) => (document: ArisWorkingDocument) =>
              toArisEditCommand(document, command, 'ai-auto')
          )
        )
        return canvas.document
      } catch {
        return null
      }
    },
    []
  )

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
          <ArisCanvasView
            document={studio.source}
            modelId={renderableModelId}
            active={active}
            ariaLabel={tk('aris.canvas.aria', 'ARIS canvas for {model}', { model: modelName })}
            onReady={(canvas) => {
              canvasRef.current = canvas
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
        />

        <ArisAccountingRail
          report={studio.accounting}
          fidelity={studio.fidelity}
          fidelityByKind={studio.fidelityByKind}
          onSelectRecord={handleSelectRecord}
        />

        <ArisEpcRail findings={epcFindings} onSelectFinding={handleSelectFinding} />

        <ArisChatImproveRail
          document={liveDocument}
          onApplyCommands={handleApplyChatCommands}
          onUndo={() => canvasRef.current?.undo()}
          canUndo={history.canUndo}
        />

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
    </section>
  )
}

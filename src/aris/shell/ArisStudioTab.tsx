/**
 * One open ARIS source: canvas + toolbar + details/validation rails.
 *
 * This is where the twelve lanes meet. Everything on screen is produced by a
 * lane's own exported entry point — the canvas by `src/aris/canvas`, the clean
 * layout by `src/aris/layout` through the canvas's documented one-call seam, the
 * properties rail by `src/aris/details`, and the validation section by the
 * unified findings core (`arisValidationFindings`).
 *
 * Undo/redo, Clean Layout and Reset to Source Layout are all ARIS commands on
 * the same stack, so "reset" is not a separate mode flag that could drift: it is
 * a gesture that writes the imported geometry back, and undoing it returns to
 * the clean layout exactly.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'

import { getDir, t } from '../../i18n'
import type { ArisCanvas } from '../canvas/ArisCanvas'
import { arisBusinessObject, rootElementId, type ArisBusinessObject } from '../canvas/elements'
import type { ArisChatCommand } from '../chat/patchSchema'
import type { ArisWorkingDocument } from '../model/types'
import { ARIS_EXPERIMENTAL_EXPORT_LABEL_KEY } from '../writer'
import { type Key } from '../../i18n'
import type { ArisTabChatHost } from './arisChatDrawerTypes'
import { ArisEpcRail } from './ArisEpcRail'
import {
  buildArisValidationFindings,
  findingsByCanvasElement,
  type ArisValidationFinding
} from './arisValidationFindings'
import {
  installArisValidationOverlays,
  type ArisValidationOverlayController
} from './arisValidationOverlays'
import {
  installArisAssignmentUx,
  type ArisAssignmentActivation,
  type ArisAssignmentUxController
} from './arisAssignmentUx'
import type { ProcessEntry, ProcessIndex } from '../../core/processIndex'
import { LinkPicker } from '../../links/LinkPicker'
import {
  applyArisChatCommandsAsGesture,
  scanArisGaps
} from './arisChatHost'
import { derivedAmlFileName, exportArisDerivedAml } from './arisDerivedExport'
import { arisPdfFileName, exportArisCanvasPdf } from '../canvas/exportArisPdf'
import { buildArisEpcFindings } from './arisEpcFindings'
import { buildConventionFindings } from '../conventions/validate'
import {
  ArisCanvasView,
  type ArisCanvasHistoryState,
  type ArisCanvasSelectionState
} from './ArisCanvasView'
import { PaneResizer } from '../../common/PaneResizer'
import { ArisDetailsRail, type ArisDetailsRailHighlight } from './ArisDetailsRail'
import { ArisToolsPanel } from './ArisToolsPanel'
import { ArisCanvasContextMenu } from './ArisCanvasContextMenu'
import {
  ARIS_RAIL_MAX_WIDTH,
  ARIS_RAIL_MIN_WIDTH,
  useArisRailLayout,
  useArisRailTab,
  type ArisRailTab
} from './arisRailLayout'
import type { ArisDetailsEditingApi } from './arisDetailsEditing'
import { arisText, buildArisDetailsDocument, type ArisStudioDocument } from './arisStudioDocument'
import {
  ArisTranslateController,
  type ArisAutoTranslateState,
  type ArisTranslateControllerHandle
} from './ArisTranslateController'
import type { LocalizationResources } from '../../localization/types'
import { tk } from './shellI18n'
import { ArisGenerationPanel } from '../../ArisGenerationPanel'
import { zipSync } from 'fflate'
import { ArisExportDialog } from './ArisExportDialog'

/** Resolves after `count` animation frames, so a canvas model switch has painted. */
function nextAnimationFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (remaining: number): void => {
      if (remaining <= 0) resolve()
      else requestAnimationFrame(() => step(remaining - 1))
    }
    step(count)
  })
}

export type ArisLayoutModeState = 'source' | 'clean'

/**
 * A drill-down whose target model is NOT in this open source — every linked id
 * lives in another workspace file. The shell (T8) resolves it against the
 * workspace and opens the right file.
 */
export interface ArisOpenAssignedModelRequest {
  readonly linkedModelIds: readonly string[]
  readonly definitionId: string
  readonly definitionName: string
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
  readonly sourceText: string
  readonly canImport: boolean
  readonly onModelChange: (modelId: string) => void
  readonly onDownloadSource: () => void
  readonly onDownloadAttachment: (filename: string, bytes: Uint8Array, mimeType: string) => void
  readonly workspaceId: string | null
  readonly onCreateModel: React.ComponentProps<typeof ArisGenerationPanel>['onCreateModel']
  readonly onDownloadFile: React.ComponentProps<typeof ArisGenerationPanel>['onDownloadFile']
  readonly onOpenAssistant: () => void
  readonly onOpenSettings: () => void
  readonly onContinueInChat: () => void
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
   * The opened source's kind, retained as shell metadata. Automatic translation
   * is universal; `src/ArisApp.tsx` still supplies this for source provenance.
   */
  readonly sourceKind?: string
  /** Workspace glossary/TM for the translation review; `null` ⇒ built-in defaults. */
  readonly localizationResources?: LocalizationResources | null
  /** Persist an accepted bilingual pair to the workspace translation memory. */
  readonly onAcceptedTranslationPair?: (pair: { en: string; ar: string }) => void
  /** Route the fix dialog's Tier-C gaps into the chat drawer's interview tab (plan §18). */
  readonly onOpenInterview?: (focusTargetIds?: readonly string[]) => void
  /**
   * Workspace-wide model index (id → entry) used by the Link-model picker and to
   * mark cross-file assignment targets as known (so they are not flagged
   * dangling). Only T8 (the workspace shell) supplies it; absent ⇒ the picker
   * falls back to the models in this open source.
   */
  readonly workspaceModelIndex?: ProcessIndex
  /**
   * Open a linked model that lives in ANOTHER workspace file. Only T8 supplies
   * it; absent ⇒ a foreign drill-down is a no-op.
   */
  readonly onOpenAssignedModel?: (request: ArisOpenAssignedModelRequest) => void
  /** Publish the live working document to the workspace shell on every change. */
  readonly onLiveDocumentChange?: (document: ArisWorkingDocument) => void
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

interface CanvasContextMenuState {
  readonly elementId: string
  readonly x: number
  readonly y: number
  readonly returnFocus: HTMLElement | null
}

const ARIS_RAIL_TABS: readonly ArisRailTab[] = Object.freeze(['tools', 'generate', 'details'])

export function ArisStudioTab({
  title,
  studio,
  modelId,
  active,
  lang,
  sourceText,
  onModelChange,
  onDownloadSource,
  onDownloadAttachment,
  workspaceId,
  onCreateModel,
  onDownloadFile,
  canImport,
  onImportPackage,
  onOpenAssistant,
  onOpenSettings,
  onContinueInChat,
  onToast,
  sourceFileName,
  selectionRequest,
  onSelectionResolved,
  chatHostKey,
  onChatHostChange,
  localizationResources = null,
  onAcceptedTranslationPair,
  onOpenInterview,
  workspaceModelIndex,
  onOpenAssignedModel,
  onLiveDocumentChange
}: ArisStudioTabProps): JSX.Element {
  const canvasRef = useRef<ArisCanvas | null>(null)
  const [selection, setSelection] = useState<ArisCanvasSelectionState>(EMPTY_SELECTION)
  const [history, setHistory] = useState<ArisCanvasHistoryState>(EMPTY_HISTORY)
  const [dismissedHint, setDismissedHint] = useState(false)
  // The diagram-label language. It follows the app language until the toolbar
  // toggle overrides it (view-only projection; §L5a's canvas seam).
  const [contentLangOverride, setContentLangOverride] = useState<'en' | 'ar' | null>(null)
  const contentLang = contentLangOverride ?? lang
  // The print frame (header band + bottom legend) is view-only page furniture
  // on top of the diagram; toggling it never touches the document.
  // Bumped when the canvas becomes ready, so the content-language effect and the
  // translate controller re-run against the live canvas.
  const [canvasTick, setCanvasTick] = useState(0)
  const [canvasContextMenu, setCanvasContextMenu] = useState<CanvasContextMenuState | null>(null)
  const translateRef = useRef<ArisTranslateControllerHandle | null>(null)
  const [autoTranslateState, setAutoTranslateState] = useState<ArisAutoTranslateState>('idle')
  const [exportOpen, setExportOpen] = useState(false)
  const [linkPickerOpen, setLinkPickerOpen] = useState(false)
  const dir: 'ltr' | 'rtl' = lang === 'ar' ? 'rtl' : 'ltr'
  const railId = `orbitpm-aris-rail-${useId().replaceAll(':', '')}`
  const railTabsId = `orbitpm-aris-rail-tabs-${useId().replaceAll(':', '')}`
  const rail = useArisRailLayout()
  const [railTab, setRailTab] = useArisRailTab()
  const railTabRefs = useRef<Partial<Record<ArisRailTab, HTMLButtonElement | null>>>({})
  const shouldFocusRailTab = useRef(false)
  const lastDetailsRef = useRef(selection.detailsElement)

  const railTabId = useCallback((tab: ArisRailTab) => `${railTabsId}-tab-${tab}`, [railTabsId])
  const railPanelId = useCallback((tab: ArisRailTab) => `${railTabsId}-panel-${tab}`, [railTabsId])
  const onRailTabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
      const forward = getDir() === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
      const backward = getDir() === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
      const last = ARIS_RAIL_TABS.length - 1
      let next: number | null = null
      if (event.key === forward) next = index === last ? 0 : index + 1
      else if (event.key === backward) next = index === 0 ? last : index - 1
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = last
      if (next === null) return
      event.preventDefault()
      shouldFocusRailTab.current = true
      setRailTab(ARIS_RAIL_TABS[next]!)
    },
    [setRailTab]
  )

  useEffect(() => {
    if (!shouldFocusRailTab.current) return
    shouldFocusRailTab.current = false
    railTabRefs.current[railTab]?.focus()
  }, [railTab])

  // Rail-tab policy (plan L-P2 Task 4): the rail boots on Tools (the docked
  // palette) and auto-switches to Details ONLY on an explicit detail-oriented
  // gesture — a NEW canvas selection (below) or a finding reveal (the
  // railHighlight effect). Merely importing a document with findings must NOT
  // steal the tab: findings stay discoverable through the canvas warning
  // markers and the toolbar issues badge. Never auto-switch back to Tools.
  useEffect(() => {
    const previous = lastDetailsRef.current
    const next = selection.detailsElement
    const changed = previous?.kind !== next?.kind || previous?.id !== next?.id
    lastDetailsRef.current = next
    if (next && changed) setRailTab('details')
  }, [selection.detailsElement, setRailTab])

  const renderableModelId = useMemo(() => {
    if (modelId && studio.models.some((model) => model.id === modelId && model.renderable)) {
      return modelId
    }
    return studio.models.find((model) => model.renderable)?.id ?? null
  }, [modelId, studio.models])

  // Which model owns each occurrence/connection, so a validation row can be
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

  // Project the canvas captions into the chosen content language (view only,
  // off the undo stack). Re-runs on a language change and on canvas (re)ready.
  // Lost in the toolbar cut, which made the Labels EN/AR button do nothing.
  useEffect(() => {
    canvasRef.current?.setContentLanguage(contentLang)
  }, [contentLang, canvasTick])

  useEffect(() => {
    const canvas = canvasRef.current
    setCanvasContextMenu(null)
    if (!canvas) return
    const handler = (rawEvent: unknown): void => {
      const event = rawEvent as {
        readonly element?: { readonly id?: string; readonly businessObject?: unknown }
        readonly originalEvent?: {
          readonly clientX?: number
          readonly clientY?: number
          preventDefault: () => void
        }
      }
      const element = event.element
      if (!element?.id || arisBusinessObject(element)?.kind !== 'occurrence') return
      event.originalEvent?.preventDefault()
      const activeElement = document.activeElement
      setCanvasContextMenu({
        elementId: element.id,
        x: event.originalEvent?.clientX ?? 0,
        y: event.originalEvent?.clientY ?? 0,
        returnFocus: activeElement instanceof HTMLElement ? activeElement : null
      })
    }
    canvas.eventBus.on('element.contextmenu', handler)
    return () => canvas.eventBus.off('element.contextmenu', handler)
  }, [canvasTick])

  const activeModelIsEmpty =
    ((history.document ?? studio.source).models.get(renderableModelId ?? '')?.occurrences.length ??
      -1) === 0

  const modelName = useMemo(() => {
    const summary = studio.models.find((model) => model.id === renderableModelId)
    return summary ? (arisText(summary.names, lang) ?? summary.id) : title
  }, [lang, renderableModelId, studio.models, title])

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

  // --- plan §14.1: EPC findings for the live document ---------------------------
  // Cross-file assignment targets (workspace models in OTHER files) count as known,
  // so a legitimate cross-file `LinkedModels.IdRef` is not flagged dangling.
  const externallyKnownModelIds = useMemo(
    () => new Set(workspaceModelIndex?.keys() ?? []),
    [workspaceModelIndex]
  )
  const epcFindings = useMemo(
    () => [
      ...buildArisEpcFindings(liveDocument, undefined, externallyKnownModelIds),
      ...buildConventionFindings(liveDocument)
    ],
    [liveDocument, externallyKnownModelIds]
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

  // --- Wave 7: PDF export. One process exports as a PDF; several (selected or the
  // whole open file) render one by one and download as a single zip.
  const exportPdfForModels = useCallback(
    (modelIds: readonly string[]) => {
      const canvas = canvasRef.current
      if (!canvas || modelIds.length === 0) return
      void (async () => {
        const original = canvas.activeModelId
        const files: Record<string, Uint8Array> = {}
        try {
          for (const id of modelIds) {
            canvas.setActiveModel(id)
            await nextAnimationFrames(2)
            const name = studio.models.find((model) => model.id === id)
            const label = name ? (arisText(name.names, lang) ?? id) : id
            const result = await exportArisCanvasPdf(canvas.canvas.getContainer(), label)
            files[arisPdfFileName(sourceFileName ?? `${title}.aml`, label)] = new Uint8Array(
              result.bytes
            )
          }
          const names = Object.keys(files)
          if (names.length === 1) {
            const [only] = names
            if (only) onDownloadAttachment(only, files[only] ?? new Uint8Array(), 'application/pdf')
          } else {
            onDownloadAttachment(
              `${sourceFileName ?? title}-processes.zip`,
              zipSync(files),
              'application/zip'
            )
          }
          onToast(
            tk('aris.exportPdf.exported', 'Exported {count} PDF(s).', { count: names.length }),
            'success'
          )
        } catch (error) {
          onToast(
            tk('aris.exportPdf.failed', 'The PDF export failed: {error}', {
              error: error instanceof Error ? error.message : String(error)
            }),
            'error'
          )
        } finally {
          if (original && canvas.document.models.has(original)) canvas.setActiveModel(original)
        }
      })()
    },
    [lang, onDownloadAttachment, onToast, sourceFileName, studio.models, title]
  )

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
  // --- issue 5/6: the unified validation findings for the rail and the canvas --
  const validationFindings = useMemo(
    () =>
      buildArisValidationFindings(liveDocument, epcFindings, gaps, {
        preferredModelId: renderableModelId
      }),
    [liveDocument, epcFindings, gaps, renderableModelId]
  )
  const validationByElement = useMemo(
    () => findingsByCanvasElement(validationFindings),
    [validationFindings]
  )

  const railHighlightToken = useRef(0)
  const [railHighlight, setRailHighlight] = useState<ArisDetailsRailHighlight | null>(null)

  useEffect(() => {
    if (railHighlight) setRailTab('details')
  }, [railHighlight, setRailTab])

  /**
   * The one gesture shared by validation rows (and, later, canvas markers):
   * reveal the finding's element (switching models when needed), scroll it into
   * view, and open the details rail on the specific field to fix.
   */
  const handleRevealFinding = useCallback(
    (finding: ArisValidationFinding): boolean => {
      const canvas = canvasRef.current
      let revealed = false
      if (finding.anchorElementId) revealed = revealElement(finding.anchorElementId)
      if (!revealed && finding.fallbackModelId) {
        // Model-scoped finding: switch AND select the model root so the details
        // rail shows the model's own tabs (name editor included).
        const summary = studio.models.find((model) => model.id === finding.fallbackModelId)
        if (canvas && summary?.renderable && canvas.document.models.has(finding.fallbackModelId)) {
          if (canvas.activeModelId !== finding.fallbackModelId) {
            canvas.setActiveModel(finding.fallbackModelId)
            onModelChange(finding.fallbackModelId)
          }
          canvas.select(rootElementId(finding.fallbackModelId))
          revealed = true
        }
      }
      if (!revealed) return false
      // Expand the rail (if the collapse lane left it collapsed) before the
      // scroll/flash so the flashed field is on screen.
      if (rail.collapsed) rail.setCollapsed(false)
      if (canvas && finding.anchorElementId) {
        const element = canvas.elementRegistry.get(finding.anchorElementId)
        if (element) {
          // Port of main:src/editor/EditorTabLite.tsx:1514-1519.
          try {
            canvas.canvas.scrollToElement(element, 120)
          } catch {
            canvas.zoom('fit-viewport')
          }
        }
      }
      if (finding.railTarget) {
        railHighlightToken.current += 1
        setRailHighlight({
          token: railHighlightToken.current,
          tab: finding.railTarget.tab,
          field: finding.railTarget.field
        })
      }
      return true
    },
    [onModelChange, rail, revealElement, studio.models]
  )

  // --- issue 6: per-element canvas warning markers -----------------------------
  // The installer reads the findings map through a ref so a findings change never
  // tears down the overlay subscription; a dedicated effect just re-diffs it.
  const overlaysRef = useRef<ArisValidationOverlayController | null>(null)
  const validationByElementRef = useRef(validationByElement)
  useEffect(() => {
    validationByElementRef.current = validationByElement
    overlaysRef.current?.resync()
  }, [validationByElement])
  /**
   * A warning marker on a step opens the completion chat on that step: its gaps are
   * asked first, so the user answers the open items for the step they clicked.
   */
  const handleMarkerActivate = useCallback(
    (finding: ArisValidationFinding): void => {
      const focus: string[] = []
      const elementId = finding.anchorElementId
      if (elementId) {
        for (const model of liveDocument.models.values()) {
          const occurrence = model.occurrences.find((candidate) => candidate.id === elementId)
          if (occurrence) {
            focus.push(occurrence.definitionId)
            break
          }
        }
        focus.push(elementId)
      } else if (finding.fallbackModelId) {
        focus.push(finding.fallbackModelId)
      }
      onOpenInterview?.(focus)
    },
    [liveDocument, onOpenInterview]
  )

  useEffect(() => {
    const canvas = getCanvas()
    if (!canvas) return
    const controller = installArisValidationOverlays(
      canvas,
      () => validationByElementRef.current,
      handleMarkerActivate
    )
    overlaysRef.current = controller
    return () => {
      overlaysRef.current = null
      controller.uninstall()
    }
  }, [getCanvas, handleMarkerActivate])

  // --- Lane T6: canvas assignment drill-down (⊞ marker + dblclick @2000) --------
  /**
   * Open one linked model. In-document targets switch the canvas in place; a
   * target that lives in another workspace file is delegated to the shell (T8).
   */
  const openAssignedModelId = useCallback(
    (modelId: string, definitionId: string, definitionName: string): void => {
      const canvas = canvasRef.current
      if (canvas && canvas.document.models.has(modelId)) {
        canvas.setActiveModel(modelId)
        onModelChange(modelId)
        return
      }
      onOpenAssignedModel?.({ linkedModelIds: [modelId], definitionId, definitionName })
    },
    [onModelChange, onOpenAssignedModel]
  )

  /**
   * A ⊞ marker click or a priority-2000 double-click fires this. The first
   * linked model that lives in THIS document wins and switches the canvas; when
   * none do, the whole id list is delegated to the workspace shell.
   */
  const handleAssignmentActivation = useCallback(
    (activation: ArisAssignmentActivation): void => {
      const canvas = canvasRef.current
      if (canvas) {
        for (const modelId of activation.linkedModelIds) {
          if (canvas.document.models.has(modelId)) {
            canvas.setActiveModel(modelId)
            onModelChange(modelId)
            return
          }
        }
      }
      onOpenAssignedModel?.({
        linkedModelIds: activation.linkedModelIds,
        definitionId: activation.definitionId,
        definitionName: activation.definitionName
      })
    },
    [onModelChange, onOpenAssignedModel]
  )

  // Install the assignment UX exactly like the validation overlays: install once
  // per canvas readiness, resync on model switch or an edit (history revision).
  const assignmentUxRef = useRef<ArisAssignmentUxController | null>(null)
  useEffect(() => {
    const canvas = getCanvas()
    if (!canvas) return
    const controller = installArisAssignmentUx(canvas, handleAssignmentActivation)
    assignmentUxRef.current = controller
    return () => {
      assignmentUxRef.current = null
      controller.uninstall()
    }
  }, [getCanvas, handleAssignmentActivation])
  useEffect(() => {
    assignmentUxRef.current?.resync()
  }, [renderableModelId, history.revision])

  // The Link-model toolbar button targets a single selected OT_FUNC occurrence.
  const linkSelection = useMemo(() => {
    const businessObject = selection.businessObject
    if (
      selection.selectedIds.length === 1 &&
      businessObject?.kind === 'occurrence' &&
      businessObject.objectType === 'OT_FUNC'
    ) {
      return { definitionId: businessObject.definitionId, definitionName: businessObject.name }
    }
    return null
  }, [selection])

  // The picker's index: the workspace-wide one when supplied, else a local index
  // built from the models in THIS open source.
  const linkPickerIndex = useMemo<ProcessIndex>(() => {
    if (workspaceModelIndex) return workspaceModelIndex
    const index: ProcessIndex = new Map()
    for (const [modelId, model] of liveDocument.models) {
      const entry: ProcessEntry = {
        processId: modelId,
        processName: model.names.fallback ?? undefined,
        relPath: sourceFileName ?? title
      }
      index.set(modelId, entry)
    }
    return index
  }, [workspaceModelIndex, liveDocument, sourceFileName, title])

  const handlePickLinkedModel = useCallback(
    (modelId: string): void => {
      setLinkPickerOpen(false)
      const canvas = canvasRef.current
      if (!canvas || !linkSelection) return
      try {
        canvas.authoring.addModelAssignment(linkSelection.definitionId, modelId)
      } catch (error) {
        onToast(
          tk('aris.details.edit.failed', 'The change was refused: {error}', {
            error: error instanceof Error ? error.message : String(error)
          }),
          'error'
        )
        return
      }
      onToast(
        t('aris.assign.linked', {
          model: linkPickerIndex.get(modelId)?.processName || modelId,
          name: linkSelection.definitionName
        }),
        'success'
      )
    },
    [linkPickerIndex, linkSelection, onToast]
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
      setModelAttribute: (modelId, attributeType, values) =>
        run((authoring) => authoring.setModelAttribute(modelId, attributeType, values)),
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
        display: 'flex',
        alignItems: 'stretch',
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
          gap: 12,
          flex: '1 1 auto'
        }}
      >
        <header
          className="orbitpm-aris-toolbar"
          aria-label={tk('aris.toolbar.aria', 'ARIS canvas controls')}
          data-orbitpm-aris-auto-translate={autoTranslateState}
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
          <button type="button" className="orbitpm-lite-chrome-btn" onClick={onDownloadSource}>
            {t('aris.placeholder.downloadSource')}
          </button>
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            data-orbitpm-aris-export=""
            disabled={studio.models.length === 0}
            onClick={() => setExportOpen(true)}
          >
            {tk('aris.toolbar.export', 'Export…')}
          </button>
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            data-orbitpm-aris-link-model=""
            title={t('aris.assign.link.title')}
            disabled={!linkSelection}
            onClick={() => setLinkPickerOpen(true)}
          >
            {t('aris.assign.link')}
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
              onHistoryChange={(next) => {
                setHistory(next)
                if (next.document) onLiveDocumentChange?.(next.document)
              }}
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

      {canvasContextMenu && canvasRef.current && (
        <ArisCanvasContextMenu
          canvas={canvasRef.current}
          elementId={canvasContextMenu.elementId}
          x={canvasContextMenu.x}
          y={canvasContextMenu.y}
          returnFocus={canvasContextMenu.returnFocus}
          onClose={() => setCanvasContextMenu(null)}
          onToast={onToast}
        />
      )}

      <button
        type="button"
        className="orbitpm-lite-rail"
        data-orbitpm-aris-rail-collapse=""
        // .orbitpm-lite-rail draws its divider on the inline-end edge (built for the
        // left explorer); this rail sits on the inline-end side, so flip the border.
        style={{ borderInlineEnd: 'none', borderInlineStart: '1px solid var(--orbitpm-border)' }}
        onClick={() => rail.setCollapsed(!rail.collapsed)}
        aria-label={tk('aris.rail.toggle.aria', 'Show or hide the details rail')}
        title={tk('aris.rail.toggle.aria', 'Show or hide the details rail')}
        aria-expanded={!rail.collapsed}
        aria-controls={railId}
      >
        <span aria-hidden>
          {lang === 'ar' ? (rail.collapsed ? '⟩' : '⟨') : rail.collapsed ? '⟨' : '⟩'}
        </span>
      </button>
      {!rail.collapsed && (
        <div data-orbitpm-aris-rail-resize="" style={{ display: 'flex', alignSelf: 'stretch' }}>
          <PaneResizer
            edge="inline-start"
            dir={dir}
            width={rail.width}
            min={ARIS_RAIL_MIN_WIDTH}
            max={ARIS_RAIL_MAX_WIDTH}
            onWidthChange={rail.setWidth}
            onReset={rail.resetWidth}
            ariaLabel={tk('aris.rail.resize.aria', 'Resize the details rail')}
          />
        </div>
      )}

      <aside
        id={railId}
        className="orbitpm-aris-rail"
        data-orbitpm-aris-rail=""
        aria-label={tk('aris.rail.aria', 'ARIS details and accounting rails')}
        style={{
          display: rail.collapsed ? 'none' : undefined,
          inlineSize: rail.width,
          flex: '0 0 auto',
          gridTemplateRows: 'auto minmax(0, 1fr)',
          overflow: 'hidden'
        }}
      >
        <div
          role="tablist"
          aria-label={tk('aris.rail.tabsAria', 'Tools, generation, and details panels')}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}
        >
          {ARIS_RAIL_TABS.map((tab, index) => (
            <button
              key={tab}
              type="button"
              role="tab"
              id={railTabId(tab)}
              aria-selected={railTab === tab}
              aria-controls={railPanelId(tab)}
              tabIndex={railTab === tab ? 0 : -1}
              data-orbitpm-aris-rail-tab={tab}
              ref={(node) => {
                railTabRefs.current[tab] = node
              }}
              className="orbitpm-lite-chrome-btn"
              style={{
                fontSize: 12,
                padding: '0.15rem 0.5rem',
                borderColor: railTab === tab ? 'var(--orbitpm-primary-bg)' : 'var(--orbitpm-border)'
              }}
              onClick={() => setRailTab(tab)}
              onKeyDown={(event) => onRailTabKeyDown(event, index)}
            >
              {tab === 'tools'
                ? tk('aris.rail.tab.tools', 'Tools')
                : tab === 'generate'
                  ? tk('aris.rail.tab.generate', '✨ Generate')
                  : tk('aris.rail.details', 'Details')}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id={railPanelId('tools')}
          aria-labelledby={railTabId('tools')}
          hidden={railTab !== 'tools'}
          data-orbitpm-aris-rail-panel="tools"
          style={{ minHeight: 0, overflow: 'hidden' }}
        >
          <ArisToolsPanel
            key={canvasTick}
            canvas={canvasRef.current}
            modelType={liveDocument.models.get(renderableModelId ?? '')?.type ?? 'MT_EEPC'}
            lang={lang}
          />
        </div>

        <div
          role="tabpanel"
          id={railPanelId('generate')}
          aria-labelledby={railTabId('generate')}
          hidden={railTab !== 'generate'}
          data-orbitpm-aris-rail-panel="generate"
          style={{ minHeight: 0, overflow: 'auto' }}
        >
          <ArisGenerationPanel
            embedded
            workspaceId={workspaceId}
            onCreateModel={onCreateModel}
            onDownloadFile={onDownloadFile}
            onOpenAssistant={onOpenAssistant}
            onOpenSettings={onOpenSettings}
            onContinueInChat={onContinueInChat}
          />
        </div>

        <div
          role="tabpanel"
          id={railPanelId('details')}
          aria-labelledby={railTabId('details')}
          hidden={railTab !== 'details'}
          data-orbitpm-aris-rail-panel="details"
          style={{
            minHeight: 0,
            overflow: 'auto',
            display: railTab === 'details' ? 'grid' : undefined,
            gap: 12,
            alignContent: 'start'
          }}
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
            highlight={railHighlight}
            onOpenAssignedModel={(modelId) => {
              const businessObject = selection.businessObject
              const definitionId =
                businessObject?.kind === 'occurrence' ? businessObject.definitionId : modelId
              const definitionName =
                businessObject?.kind === 'occurrence' ? businessObject.name : modelId
              openAssignedModelId(modelId, definitionId, definitionName)
            }}
          />

          <ArisEpcRail findings={validationFindings} onSelectFinding={handleRevealFinding} />
        </div>
      </aside>

      <ArisTranslateController
        ref={translateRef}
        getCanvas={getCanvas}
        liveDocument={liveDocument}
        contentLang={contentLang}
        documentName={title}
        autoTranslateEligible={true}
        onAutoTranslateState={setAutoTranslateState}
        resources={localizationResources}
        onAcceptedPair={onAcceptedTranslationPair}
        onToast={onToast}
      />

      <LinkPicker
        open={linkPickerOpen}
        index={linkPickerIndex}
        onPick={handlePickLinkedModel}
        onClose={() => setLinkPickerOpen(false)}
      />

      <ArisExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        models={studio.models.map((model) => ({
          id: model.id,
          name: arisText(model.names, lang) ?? model.id,
          renderable: model.renderable
        }))}
        currentModelId={renderableModelId}
        amlLabel={t(ARIS_EXPERIMENTAL_EXPORT_LABEL_KEY as Key)}
        onExportPdf={exportPdfForModels}
        onExportAml={handleExportDerivedAml}
      />
    </section>
  )
}

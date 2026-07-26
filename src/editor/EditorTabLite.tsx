// Ported from the desktop app's EditorTab (src/renderer/src/editor/EditorTab.tsx).
// The component shell is copied here — not imported — because it is the one
// reused React file that pulls in bpmn-js, and (a) resolving bpmn-js's nested
// bpmn-moddle correctly requires the import to originate from lite/src, and
// (b) the desktop file carries a latent canvas-type annotation that only a real
// typecheck (which the desktop repo never runs) surfaces. Everything else — the
// dirty-state machine, the call-activity inspection, the SVG/PNG export helpers
// and the editor CSS — is REUSED verbatim by direct import from the desktop
// tree, so this file stays a thin shell around shared logic.

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react'
import BpmnModeler from 'bpmn-js/lib/Modeler'
import { BpmnPropertiesPanelModule, BpmnPropertiesProviderModule } from 'bpmn-js-properties-panel'
import { CreateAppendAnythingModule } from 'bpmn-js-create-append-anything'
import BpmnLintModule from 'bpmn-js-bpmnlint'
import minimapModule from 'diagram-js-minimap'

import 'bpmn-js/dist/assets/diagram-js.css'
import 'bpmn-js/dist/assets/bpmn-js.css'
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css'
import '@bpmn-io/properties-panel/dist/assets/properties-panel.css'
import 'diagram-js-minimap/assets/diagram-js-minimap.css'
import 'bpmn-js-bpmnlint/dist/assets/css/bpmn-js-bpmnlint.css'

// Reused, unchanged, from the desktop app:
import './EditorTab.css'
import {
  createDirtyState,
  withCommandStackChanged,
  withSaved,
  isDirty,
  type DirtyState
} from './dirty'
import { inspectCallActivityElement, shouldSuppressDefaultDblClick } from './callActivity'
import {
  computeExportSize,
  svgToPngDataUrl,
  svgToDataUrl,
  triggerDownload,
  type CanvasLike
} from './exportImage'
import { createDeterministicDiagramPdf } from './exportPdf'
import { orbitpmModdleDescriptor } from '../org/orbitpmModdle'
import { OrgRenderModule } from '../org/orgRenderer'
import { installAutomaticConnectionRouting } from '../org/automaticConnectionRouting'
import { refreshOrgStyling } from '../org/orgSettings'
import { isStepBlockElement } from '../org/stepDetailsCtx'
import { ShapeLegend } from '../org/ShapeLegend'
import { ConnectedEdgeHighlightModule } from '../org/connectedEdgeHighlight'
import { ModelingBatchModule } from './modelingBatch'
import { installDragWatchdog } from './dragWatchdog'
import { installPaletteDrag } from './paletteDrag'
import { installCanvasDecor } from './canvasDecor'
import { installLabelBilingualSync } from './labelSync'
import type { LangToggleModeler } from './langToggle'
import { installAutoSize, type AutoSizeModeler } from './autoSize'
import { BidiTextRendererModule } from './bidiTextRenderer'
import { t } from '../i18n'
import { useLang } from '../i18n/useLang'
import { recommendedBpmnlintBundle } from '../validation/bpmnlintBundle'
import { getRuntimeValidationAdapters } from '../validation/runtimeAdapters'
import { validateBpmnXml } from '../validation/model'
import { validateUnknownExtensionPreservation } from '../validation/extensions'
import {
  mergeValidationSummaries,
  type ValidationIssue,
  type ValidationSummary
} from '../validation/contracts'
import { evaluateValidationPolicy } from '../validation/policy'
import { ValidationCenter } from '../validation/ValidationCenter'
import { SourceEditorDialog } from '../validation/SourceEditorDialog'
import { SaveDraftDialog } from '../validation/SaveDraftDialog'
import { layoutBpmnValidated } from '../generation/layout'
import { ProcessOutlineEditor } from './ProcessOutlineEditor'
import { processOutlineMessages } from './processOutlineMessages'
import type { ProcessOutlineModeler } from './processOutline'
import { EmbeddedDiagramControlsModule } from './embeddedDiagramControls'
import {
  DetailsRail,
  DetailsResizer,
  ResponsiveDrawer,
  useDetailsPreferences,
  useResponsiveShellMode,
  type DetailsPreferencesController,
  type ResponsiveShellMode
} from '../shell'

export interface EditorTabProps {
  xml: string
  onDirtyChange: (dirty: boolean) => void
  onRequestSave: (
    xml: string,
    options?: { explicitDraftWithErrors?: boolean }
  ) => Promise<void | { durable: boolean }>
  onOpenCalledProcess?: (processId: string) => void
  /** Workspace process IDs used to resolve cross-file call activities. */
  knownProcessIds?: readonly string[]
  exportFileBaseName?: string
  onModelerReady?: (modeler: unknown | null) => void
  toolbarExtra?: import('react').ReactNode
  onCommandsReady?: (commands: EditorTabCommands | null) => void
  /** A canvas missing-info badge was clicked. The element has already been
   *  selected in this modeler, so the caller can open the Step-details dialog
   *  with the machine-readable missing categories highlighted. */
  onOpenStepDetails?: (elementId: string, missing: string[]) => void
  /** React content stacked ABOVE the bpmn-js properties panel inside the
   *  right side pane (the App renders the Details card here). */
  sidePaneExtra?: import('react').ReactNode
  /** Optional shared controller. App should provide one when multiple tabs stay mounted. */
  detailsController?: DetailsPreferencesController
  /** Optional shared viewport mode. App should provide this when coordinating both side panes. */
  responsiveMode?: ResponsiveShellMode
  /** Notifies App so opening Details can close an overlay explorer. */
  onDetailsOpenChange?: (open: boolean) => void
}

export interface EditorTabCommands {
  save: () => void
  exportSvg: () => void
  exportPng: () => void
  exportPdf: () => void
}

interface CommandStackLike {
  _stackIdx: number
}

interface CanvasApiLike {
  /** No-arg reads the current zoom level; a number sets it; 'fit-viewport' fits. */
  zoom(): number
  zoom(mode: 'fit-viewport'): void
  zoom(level: number): void
  viewbox(): { width: number; height: number }
  getRootElement(): ElementLike
  scrollToElement(element: ElementLike, padding?: number): void
}

interface ElementLike {
  id?: string
  type?: string
  businessObject?: {
    $type?: string
    id?: string
    get?: (name: string) => unknown
  }
  labelTarget?: unknown
  waypoints?: unknown
}

interface ElementRegistryLike {
  getAll(): ElementLike[]
  get(id: string): ElementLike | undefined
}

interface SelectionApiLike {
  select(el: unknown): void
}

interface ModelingApiLike {
  updateProperties(element: unknown, properties: Record<string, unknown>): void
}

interface EventBusLike {
  on(event: string, priority: number, callback: (event: { element?: unknown }) => unknown): void
  off(event: string, callback: (event: { element?: unknown }) => unknown): void
}

interface BpmnModelerLike {
  importXML(xml: string): Promise<{ warnings: string[] }>
  saveXML(options: { format: boolean }): Promise<{ xml?: string }>
  saveSVG(): Promise<{ svg: string }>
  get(name: 'commandStack'): CommandStackLike
  get(name: 'canvas'): CanvasApiLike
  get(name: 'eventBus'): EventBusLike
  get(name: 'elementRegistry'): ElementRegistryLike
  get(name: 'selection'): SelectionApiLike
  get(name: 'modeling'): ModelingApiLike
  get(name: 'i18n'): { changed(): void }
  destroy(): void
  attachTo(container: HTMLElement): void
}

/** How many BPMN flow-node shapes (excluding the root process/collaboration,
 *  labels and connections) a diagram contains — 0/1 marks a brand-new diagram,
 *  which is when the "drag from the palette" hint overlay is worth showing. */
function countFlowNodeShapes(registry: ElementRegistryLike): number {
  return registry.getAll().filter((el) => {
    const t = el.type
    if (typeof t !== 'string' || !t.startsWith('bpmn:')) return false
    if (t === 'bpmn:Process' || t === 'bpmn:Collaboration') return false
    // Labels carry a labelTarget; connections carry waypoints — neither counts.
    return el.labelTarget == null && el.waypoints == null
  }).length
}

function getStackIndex(modeler: BpmnModelerLike): number {
  return modeler.get('commandStack')._stackIdx ?? 0
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function EditorTab(props: EditorTabProps): JSX.Element {
  const {
    xml,
    onDirtyChange,
    onRequestSave,
    onOpenCalledProcess,
    knownProcessIds,
    exportFileBaseName,
    onModelerReady,
    toolbarExtra,
    onCommandsReady,
    onOpenStepDetails,
    sidePaneExtra,
    detailsController: sharedDetailsController,
    responsiveMode,
    onDetailsOpenChange
  } = props
  const lang = useLang()
  const detailsPaneId = `orbitpm-details-pane-${useId().replaceAll(':', '')}`
  const outlinePaneId = `orbitpm-process-outline-pane-${useId().replaceAll(':', '')}`
  const outlineMessages = processOutlineMessages(lang)
  const onModelerReadyRef = useRef(onModelerReady)
  onModelerReadyRef.current = onModelerReady

  const editorRootRef = useRef<HTMLDivElement | null>(null)
  const canvasContainerRef = useRef<HTMLDivElement | null>(null)
  const propertiesContainerRef = useRef<HTMLDivElement | null>(null)
  const detailsToggleRef = useRef<HTMLButtonElement | null>(null)
  const detailsHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const outlineToggleRef = useRef<HTMLButtonElement | null>(null)
  const outlineCloseRef = useRef<HTMLButtonElement | null>(null)
  const modelerRef = useRef<BpmnModelerLike | null>(null)
  const dirtyStateRef = useRef<DirtyState>(createDirtyState(0))
  const originalXmlRef = useRef(xml)
  const sourceRollbackRef = useRef<{ xml: string; wasDirty: boolean } | null>(null)
  const ignoreNextSourceJournalCommandRef = useRef(false)
  const onOpenCalledProcessRef = useRef(onOpenCalledProcess)
  onOpenCalledProcessRef.current = onOpenCalledProcess
  const onOpenStepDetailsRef = useRef(onOpenStepDetails)
  onOpenStepDetailsRef.current = onOpenStepDetails

  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [validationRunning, setValidationRunning] = useState(false)
  const [validationOpen, setValidationOpen] = useState(false)
  const [validationSummary, setValidationSummary] = useState<ValidationSummary | null>(null)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [sourceXml, setSourceXml] = useState(xml)
  const [sourceRollbackAvailable, setSourceRollbackAvailable] = useState(false)
  const [pendingDraft, setPendingDraft] = useState<{
    xml: string
    summary: ValidationSummary
  } | null>(null)
  // True right after importing a brand-new (empty / start-event-only) diagram —
  // drives the "drag from the palette" hint overlay. `hintDismissed` latches on
  // the first edit so the hint never comes back (e.g. it must NOT reappear after
  // a Save clears the dirty flag over a now-populated diagram).
  const [isNewDiagram, setIsNewDiagram] = useState(false)
  const [hintDismissed, setHintDismissed] = useState(false)
  const localDetailsController = useDetailsPreferences()
  const detailsController = sharedDetailsController ?? localDetailsController
  const { preferences: detailsPreferences, setWidth: setPropsWidth, resetWidth } = detailsController
  const propsOpen = detailsPreferences.open
  const propsWidth = detailsPreferences.width
  const focusPaneAfterOpenRef = useRef(false)
  const focusToggleAfterCloseRef = useRef(false)
  const detectedResponsiveMode = useResponsiveShellMode()
  const shellMode = responsiveMode ?? detectedResponsiveMode
  const isSidePaneModal = shellMode !== 'docked'
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [outlineModeler, setOutlineModeler] = useState<ProcessOutlineModeler | null>(null)
  const focusOutlineAfterOpenRef = useRef(false)
  const focusOutlineToggleAfterCloseRef = useRef(false)
  const setPropsPanelOpen = useCallback(
    (next: boolean): void => {
      detailsController.setOpen(next)
      onDetailsOpenChange?.(next)
    },
    [detailsController, onDetailsOpenChange]
  )

  const closePropsPanel = useCallback(() => {
    focusToggleAfterCloseRef.current = true
    setPropsPanelOpen(false)
  }, [setPropsPanelOpen])

  const setDetailsOpenFromRail = useCallback(
    (next: boolean): void => {
      if (!next) {
        closePropsPanel()
        return
      }
      if (isSidePaneModal && outlineOpen) setOutlineOpen(false)
      setPropsPanelOpen(true)
    },
    [closePropsPanel, isSidePaneModal, outlineOpen, setPropsPanelOpen]
  )

  const closeOutline = useCallback(() => {
    focusOutlineToggleAfterCloseRef.current = true
    setOutlineOpen(false)
  }, [])

  const toggleOutline = useCallback(
    (keyboardTriggered: boolean): void => {
      if (outlineOpen) {
        closeOutline()
        return
      }
      if (isSidePaneModal && propsOpen) setPropsPanelOpen(false)
      focusOutlineAfterOpenRef.current = keyboardTriggered || isSidePaneModal
      setOutlineOpen(true)
    },
    [closeOutline, isSidePaneModal, outlineOpen, propsOpen, setPropsPanelOpen]
  )

  useEffect(() => {
    if (propsOpen) {
      if (!focusPaneAfterOpenRef.current) return
      focusPaneAfterOpenRef.current = false
      const frame = requestAnimationFrame(() => detailsHeadingRef.current?.focus())
      return () => cancelAnimationFrame(frame)
    }
    if (!focusToggleAfterCloseRef.current) return
    focusToggleAfterCloseRef.current = false
    const frame = requestAnimationFrame(() => detailsToggleRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [propsOpen])

  useEffect(() => {
    if (!isSidePaneModal || !propsOpen || !outlineOpen) return
    setOutlineOpen(false)
  }, [isSidePaneModal, outlineOpen, propsOpen])

  useEffect(() => {
    if (outlineOpen) {
      if (!focusOutlineAfterOpenRef.current) return
      focusOutlineAfterOpenRef.current = false
      const frame = requestAnimationFrame(() => outlineCloseRef.current?.focus())
      return () => cancelAnimationFrame(frame)
    }
    if (!focusOutlineToggleAfterCloseRef.current) return
    focusOutlineToggleAfterCloseRef.current = false
    const frame = requestAnimationFrame(() => outlineToggleRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [outlineOpen])

  const applyDirtyState = useCallback(
    (next: DirtyState) => {
      dirtyStateRef.current = next
      const nowDirty = isDirty(next)
      setDirty(nowDirty)
      onDirtyChange(nowDirty)
    },
    [onDirtyChange]
  )

  useEffect(() => {
    if (!canvasContainerRef.current || !propertiesContainerRef.current) return

    // bpmn-js Modeler already ships the full editing stack: the complete palette
    // (all events/tasks/gateways/sub-process/call-activity/data objects/pool),
    // context pad, direct label editing (dblclick), copy/paste, snapping +
    // alignment, ctrl+scroll zoom (ZoomScrollModule) and — since diagram-js 15
    // (bpmn-js 18) — keyboard shortcuts (undo/redo/copy/paste/delete/select-all)
    // that AUTO-BIND to the focusable canvas SVG (tabindex=0). The old
    // `keyboard: { bindTo: document }` option is UNSUPPORTED now (it logs an
    // error) and, with multiple tabs each holding a live modeler, would let
    // background diagrams react to a Delete meant for the active one — so it is
    // deliberately NOT set; the per-canvas auto-binding is both working and
    // correctly scoped. `additionalModules` only adds what Modeler lacks:
    // properties panel, searchable create/append (the core module only — the
    // element-templates variant needs an `elementTemplates` service we do not
    // configure) and the minimap.
    const modeler = new BpmnModeler({
      container: canvasContainerRef.current,
      propertiesPanel: {
        parent: propertiesContainerRef.current
      },
      // The `orbitpm:*` org-pack attributes are registered as a real moddle
      // extension so modeling.updateProperties writes them as round-trippable
      // XML; OrgRenderModule (priority 1500) paints the DMT decorations over the
      // stock renderer and reads the live styling flag on every draw.
      moddleExtensions: { orbitpm: orbitpmModdleDescriptor },
      // diagram-js's AutoScroll pans the canvas whenever a drag (hand-tool pans
      // included) nears the viewport edge. Its trigger check is a STRICT
      // between(): scrollThresholdOut[i] < diff < scrollThresholdIn[i]
      // (diagram-js AutoScroll.js:90,112-118), so all-zero inner thresholds
      // make it mathematically inert. This also disables edge auto-pan during
      // element drags — accepted (the minimap and ctrl+scroll still navigate).
      autoScroll: { scrollThresholdIn: [0, 0, 0, 0] },
      linting: {
        active: true,
        bpmnlint: recommendedBpmnlintBundle
      },
      additionalModules: [
        BpmnPropertiesPanelModule,
        BpmnPropertiesProviderModule,
        CreateAppendAnythingModule,
        minimapModule,
        BidiTextRendererModule,
        OrgRenderModule,
        ConnectedEdgeHighlightModule,
        ModelingBatchModule,
        BpmnLintModule,
        EmbeddedDiagramControlsModule
      ]
    }) as unknown as BpmnModelerLike

    modelerRef.current = modeler
    setOutlineModeler(modeler as unknown as ProcessOutlineModeler)
    onModelerReadyRef.current?.(modeler)

    const handleCommandStackChanged = (): void => {
      if (sourceRollbackRef.current) {
        if (ignoreNextSourceJournalCommandRef.current) {
          ignoreNextSourceJournalCommandRef.current = false
        } else {
          // Any modeling edit after source Apply makes restoring the old XML
          // destructive, so expire the one-shot rollback immediately.
          sourceRollbackRef.current = null
          setSourceRollbackAvailable(false)
        }
      }
      applyDirtyState(withCommandStackChanged(dirtyStateRef.current, getStackIndex(modeler)))
    }

    const handleDblClick = (event: { element?: unknown }): unknown => {
      const inspection = inspectCallActivityElement(
        event.element as Parameters<typeof inspectCallActivityElement>[0]
      )
      if (shouldSuppressDefaultDblClick(inspection) && inspection.calledElementId) {
        onOpenCalledProcessRef.current?.(inspection.calledElementId)
        return false
      }
      if (isStepBlockElement(event.element as Parameters<typeof isStepBlockElement>[0])) {
        modeler.get('selection').select(event.element)
        setPropsPanelOpen(true)
        return false
      }
      return undefined
    }

    const eventBus = modeler.get('eventBus')
    eventBus.on('commandStack.changed', 1000, handleCommandStackChanged)
    eventBus.on('element.dblclick', 1500, handleDblClick)

    // diagram-js's MoveCanvas (and the minimap) end a canvas pan only when a
    // mouseup reaches `document`; a release swallowed by the OS/devtools/an
    // iframe leaves the pan glued to the cursor. The watchdog detects the lost
    // release (buttons === 0 on the next move, or focus loss) and dispatches a
    // synthetic mouseup so the libraries run their own normal end handlers.
    const uninstallDragWatchdog = installDragWatchdog(canvasContainerRef.current)

    // Movable tool palette: a grip bar appended at the palette's bottom lets the
    // user drag it anywhere in the canvas (double-click resets; position
    // persists). The installer waits for bpmn-js to create `.djs-palette`.
    const uninstallPaletteDrag = installPaletteDrag(canvasContainerRef.current)

    // Missing-info badge UX: floating HTML tooltip (delegated pointer events)
    // plus click-through to the Step-details dialog. The click SELECTS the
    // element first — synchronously — so the dialog derives element mode from
    // the live selection before App reads it; the callback only fires when the
    // badge resolved to a real data-element-id.
    const uninstallCanvasDecor = installCanvasDecor(
      canvasContainerRef.current,
      editorRootRef.current ?? canvasContainerRef.current,
      {
        elementRegistry: modeler.get('elementRegistry'),
        onBadgeClick: (elementId, missing) => {
          try {
            const el = modeler.get('elementRegistry').get(elementId)
            if (el) modeler.get('selection').select(el)
          } catch {
            /* selection is best-effort — the dialog still opens */
          }
          onOpenStepDetailsRef.current?.(elementId, missing)
        }
      }
    )

    // Typing a label on the canvas mirrors the visible name into the ACTIVE
    // diagram language's orbitpm attr (same undo step), so the Details dialog
    // opens pre-filled instead of waiting for a language toggle to self-heal.
    const uninstallLabelSync = installLabelBilingualSync(modeler as unknown as LangToggleModeler)
    const uninstallAutoSize = installAutoSize(modeler as unknown as AutoSizeModeler)
    const uninstallConnectionRouting = installAutomaticConnectionRouting(modeler)

    return () => {
      uninstallConnectionRouting()
      uninstallAutoSize()
      uninstallLabelSync()
      uninstallCanvasDecor()
      uninstallPaletteDrag()
      uninstallDragWatchdog()
      eventBus.off('commandStack.changed', handleCommandStackChanged)
      eventBus.off('element.dblclick', handleDblClick)
      modeler.destroy()
      modelerRef.current = null
      setOutlineModeler(null)
      onModelerReadyRef.current?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The modeler survives language changes. Ask diagram-js controls to rebuild
  // their translated labels, then repaint the OrbitPM canvas decorations that
  // also resolve localized text at draw time.
  useEffect(() => {
    const m = modelerRef.current
    if (!m) return
    m.get('i18n').changed()
    refreshOrgStyling(m as never)
  }, [lang])

  useEffect(() => {
    const modeler = modelerRef.current
    if (!modeler) return

    let cancelled = false
    setError(null)
    modeler
      .importXML(xml)
      .then(({ warnings }) => {
        if (cancelled) return
        if (warnings && warnings.length > 0) {
          console.warn('BPMN import warnings:', warnings)
        }
        originalXmlRef.current = xml
        sourceRollbackRef.current = null
        setSourceRollbackAvailable(false)
        setValidationSummary(null)
        applyDirtyState(createDirtyState(getStackIndex(modeler)))
        modeler.get('canvas').zoom('fit-viewport')
        // Show the palette hint only for a freshly-created, near-empty diagram
        // (nothing but a start event), never when opening a real process file.
        setIsNewDiagram(countFlowNodeShapes(modeler.get('elementRegistry')) <= 1)
        setHintDismissed(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(t('editor.error.loadFailed', { error: errorMessage(err) }))
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xml])

  const validateDocument = useCallback(
    async (
      candidateXml: string,
      requireDi: boolean,
      verifyPreservation: boolean
    ): Promise<ValidationSummary> => {
      const parsed = await validateBpmnXml(candidateXml, {
        adapters: getRuntimeValidationAdapters(),
        knownProcessIds: knownProcessIds ?? [],
        requireBilingual: false,
        requireDi
      })
      if (!verifyPreservation || !parsed.summary.xmlWellFormed) {
        return parsed.summary
      }
      const preservation = await validateUnknownExtensionPreservation(
        originalXmlRef.current,
        candidateXml
      )
      return mergeValidationSummaries(parsed.summary, preservation)
    },
    [knownProcessIds]
  )

  const readCurrentXml = useCallback(async (): Promise<string> => {
    const modeler = modelerRef.current
    if (!modeler) throw new Error('editor not ready')
    const { xml: currentXml } = await modeler.saveXML({ format: true })
    if (typeof currentXml !== 'string') {
      throw new Error('bpmn-js returned no XML')
    }
    return currentXml
  }, [])

  const persistXml = useCallback(
    async (savedXml: string, explicitDraftWithErrors = false): Promise<void> => {
      const outcome = await onRequestSave(savedXml, { explicitDraftWithErrors })
      if (outcome && !outcome.durable) return
      originalXmlRef.current = savedXml
      sourceRollbackRef.current = null
      setSourceRollbackAvailable(false)
      applyDirtyState(withSaved(dirtyStateRef.current))
    },
    [applyDirtyState, onRequestSave]
  )

  const handleRunValidation = useCallback(async (): Promise<ValidationSummary | null> => {
    if (validationRunning) return validationSummary
    setValidationRunning(true)
    setError(null)
    try {
      const currentXml = await readCurrentXml()
      const summary = await validateDocument(currentXml, true, true)
      setValidationSummary(summary)
      return summary
    } catch (err) {
      setError(t('editor.error.loadFailed', { error: errorMessage(err) }))
      return null
    } finally {
      setValidationRunning(false)
    }
  }, [readCurrentXml, validateDocument, validationRunning, validationSummary])

  const handleOpenValidation = useCallback(() => {
    setValidationOpen(true)
    void handleRunValidation()
  }, [handleRunValidation])

  const handleOpenSource = useCallback(async () => {
    setError(null)
    try {
      setSourceXml(await readCurrentXml())
      setSourceOpen(true)
    } catch (err) {
      setError(t('editor.error.loadFailed', { error: errorMessage(err) }))
    }
  }, [readCurrentXml])

  const markImportedDocumentDirty = useCallback(
    (modeler: BpmnModelerLike): void => {
      try {
        const root = modeler.get('canvas').getRootElement()
        const rootId = root.businessObject?.id ?? root.id
        if (!rootId) throw new Error('canvas root has no ID')
        // A same-value command marks the imported definitions dirty without
        // silently adding or changing semantic/source data.
        modeler.get('modeling').updateProperties(root, { id: rootId })
      } catch {
        applyDirtyState(
          withCommandStackChanged(
            createDirtyState(Math.min(-1, getStackIndex(modeler) - 1)),
            getStackIndex(modeler)
          )
        )
      }
    },
    [applyDirtyState]
  )

  const handleApplySource = useCallback(
    async (candidateXml: string): Promise<void> => {
      const modeler = modelerRef.current
      if (!modeler) throw new Error('editor not ready')
      const previousXml = await readCurrentXml()
      const wasDirty = dirty
      let importedCandidate = false
      try {
        await modeler.importXML(candidateXml)
        importedCandidate = true

        // A parseable source may still contain opaque vendor content that the
        // modeler's serializer does not understand. Verify the exact
        // round-trip before accepting the replacement; otherwise restore the
        // previous definitions immediately.
        const roundTripXml = await readCurrentXml()
        const roundTripPreservation = await validateUnknownExtensionPreservation(
          candidateXml,
          roundTripXml
        )
        if (!roundTripPreservation.valid) {
          throw new Error(t('sourceEditor.preservationBlocked'))
        }

        const roundTripValidation = await validateDocument(roundTripXml, true, true)
        if (!evaluateValidationPolicy(roundTripValidation, 'apply-editor').allowed) {
          throw new Error(t('sourceEditor.invalidBlocked'))
        }

        modeler.get('canvas').zoom('fit-viewport')
        sourceRollbackRef.current = { xml: previousXml, wasDirty }
        setSourceRollbackAvailable(true)
        ignoreNextSourceJournalCommandRef.current = true
        markImportedDocumentDirty(modeler)
        setValidationSummary(roundTripValidation)
      } catch (err) {
        sourceRollbackRef.current = null
        setSourceRollbackAvailable(false)
        ignoreNextSourceJournalCommandRef.current = false
        if (importedCandidate) {
          try {
            await modeler.importXML(previousXml)
            modeler.get('canvas').zoom('fit-viewport')
            if (wasDirty) {
              markImportedDocumentDirty(modeler)
            } else {
              applyDirtyState(createDirtyState(getStackIndex(modeler)))
            }
          } catch {
            // Preserve the original error. The editor's visible error banner
            // still tells the user that Apply did not complete.
          }
        }
        throw err
      }
    },
    [applyDirtyState, dirty, markImportedDocumentDirty, readCurrentXml, validateDocument]
  )

  const handleRollbackSourceApply = useCallback(async () => {
    const rollback = sourceRollbackRef.current
    const modeler = modelerRef.current
    if (!rollback || !modeler) return
    setError(null)
    try {
      sourceRollbackRef.current = null
      setSourceRollbackAvailable(false)
      ignoreNextSourceJournalCommandRef.current = false
      await modeler.importXML(rollback.xml)
      modeler.get('canvas').zoom('fit-viewport')
      if (rollback.wasDirty) {
        markImportedDocumentDirty(modeler)
      } else {
        applyDirtyState(createDirtyState(getStackIndex(modeler)))
      }
      setValidationSummary(await validateDocument(rollback.xml, true, true))
    } catch (err) {
      sourceRollbackRef.current = rollback
      setSourceRollbackAvailable(true)
      setError(t('sourceEditor.applyFailed', { error: errorMessage(err) }))
    }
  }, [applyDirtyState, markImportedDocumentDirty, validateDocument])

  const handleAutoLayout = useCallback(
    async (candidateXml: string): Promise<string> => {
      const result = await layoutBpmnValidated(candidateXml, {
        validation: {
          knownProcessIds: knownProcessIds ?? [],
          requireBilingual: false
        }
      })
      return result.xml
    },
    [knownProcessIds]
  )

  const handleFocusIssue = useCallback((issue: ValidationIssue) => {
    if (!issue.elementId) return
    const modeler = modelerRef.current
    const element = modeler?.get('elementRegistry').get(issue.elementId)
    if (!modeler || !element) return
    modeler.get('selection').select(element)
    try {
      modeler.get('canvas').scrollToElement(element, 120)
    } catch {
      modeler.get('canvas').zoom('fit-viewport')
    }
    setValidationOpen(false)
  }, [])

  const handleRepairIssue = useCallback(
    (issue: ValidationIssue) => {
      if (issue.source === 'di' || issue.location) {
        setValidationOpen(false)
        void handleOpenSource()
        return
      }
      handleFocusIssue(issue)
    },
    [handleFocusIssue, handleOpenSource]
  )

  const handleSave = useCallback(async () => {
    if (!modelerRef.current || saving || validationRunning) return
    setSaving(true)
    setValidationRunning(true)
    setError(null)
    try {
      const savedXml = await readCurrentXml()
      const summary = await validateDocument(savedXml, true, true)
      setValidationSummary(summary)

      const normalSave = evaluateValidationPolicy(summary, 'save')
      if (normalSave.allowed) {
        await persistXml(savedXml)
        return
      }

      const draftSave = evaluateValidationPolicy(summary, 'save-draft-with-errors')
      if (draftSave.requiresExplicitDraftConfirmation) {
        setPendingDraft({ xml: savedXml, summary })
        return
      }

      setValidationOpen(true)
      setError(t('save.blocked'))
    } catch (err) {
      setError(t('editor.error.saveFailed', { error: errorMessage(err) }))
    } finally {
      setValidationRunning(false)
      setSaving(false)
    }
  }, [persistXml, readCurrentXml, saving, validateDocument, validationRunning])

  const handleConfirmDraftSave = useCallback(async () => {
    if (!pendingDraft || saving) return
    const decision = evaluateValidationPolicy(pendingDraft.summary, 'save-draft-with-errors', {
      explicitDraftConfirmation: true
    })
    if (!decision.allowed) {
      setPendingDraft(null)
      setValidationOpen(true)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await persistXml(pendingDraft.xml, true)
      setPendingDraft(null)
    } catch (err) {
      setError(t('editor.error.saveFailed', { error: errorMessage(err) }))
    } finally {
      setSaving(false)
    }
  }, [pendingDraft, persistXml, saving])

  // Latch the hint dismissed on the first edit; never bring it back.
  useEffect(() => {
    if (dirty) setHintDismissed(true)
  }, [dirty])

  const baseName = exportFileBaseName?.trim() || 'diagram'

  const handleExportSvg = useCallback(async () => {
    const modeler = modelerRef.current
    if (!modeler) return
    try {
      const { svg } = await modeler.saveSVG()
      triggerDownload(`${baseName}.svg`, svgToDataUrl(svg))
    } catch (err) {
      setError(t('editor.error.exportSvgFailed', { error: errorMessage(err) }))
    }
  }, [baseName])

  const handleExportPng = useCallback(async () => {
    const modeler = modelerRef.current
    if (!modeler) return
    try {
      const { svg } = await modeler.saveSVG()
      const size = computeExportSize(modeler.get('canvas').viewbox())
      const dataUrl = await svgToPngDataUrl(svg, size, {
        createCanvas: (width, height) => {
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          // The desktop CanvasLike interface narrows fillStyle to `string`;
          // a real HTMLCanvasElement's context widens it. The runtime shape is
          // compatible — cast at this single boundary.
          return canvas as unknown as CanvasLike
        },
        loadImage: (svgDataUrl) =>
          new Promise((resolve, reject) => {
            const image = new Image()
            image.onload = () => resolve(image)
            image.onerror = () => reject(new Error('Failed to rasterize diagram SVG'))
            image.src = svgDataUrl
          })
      })
      triggerDownload(`${baseName}.png`, dataUrl)
    } catch (err) {
      setError(t('editor.error.exportPngFailed', { error: errorMessage(err) }))
    }
  }, [baseName])

  const handleExportPdf = useCallback(async () => {
    const modeler = modelerRef.current
    if (!modeler) return
    try {
      const { svg } = await modeler.saveSVG()
      const size = computeExportSize(modeler.get('canvas').viewbox())
      const dataUrl = await svgToPngDataUrl(svg, size, {
        createCanvas: (width, height) => {
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          return canvas as unknown as CanvasLike
        },
        loadImage: (svgDataUrl) =>
          new Promise((resolve, reject) => {
            const image = new Image()
            image.onload = () => resolve(image)
            image.onerror = () => reject(new Error('Failed to rasterize diagram SVG'))
            image.src = svgDataUrl
          })
      })
      const pdf = createDeterministicDiagramPdf(dataUrl, size, baseName)
      const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }))
      triggerDownload(`${baseName}.pdf`, url)
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (err) {
      setError(t('editor.error.exportPdfFailed', { error: errorMessage(err) }))
    }
  }, [baseName])

  const handleZoomFit = useCallback(() => {
    modelerRef.current?.get('canvas').zoom('fit-viewport')
  }, [])

  const zoomByFactor = useCallback((factor: number) => {
    const canvas = modelerRef.current?.get('canvas')
    if (!canvas) return
    const current = canvas.zoom()
    const next = Math.max(0.2, Math.min(4, current * factor))
    canvas.zoom(next)
  }, [])

  const uiDir = lang === 'ar' ? 'rtl' : 'ltr'
  useEffect(() => {
    onCommandsReady?.({
      save: () => void handleSave(),
      exportSvg: () => void handleExportSvg(),
      exportPng: () => void handleExportPng(),
      exportPdf: () => void handleExportPdf()
    })
    return () => onCommandsReady?.(null)
  }, [onCommandsReady, handleSave, handleExportSvg, handleExportPng, handleExportPdf])

  return (
    // The editor chrome follows the active UI direction. Only the canvas
    // subtree remains LTR because bpmn-js's coordinates/palette/context pad
    // have no RTL mode of their own.
    <div ref={editorRootRef} className="orbitpm-editor" dir={uiDir}>
      <div className="orbitpm-editor__toolbar">
        <button
          type="button"
          className="orbitpm-editor__button orbitpm-editor__button--primary"
          onClick={() => void handleSave()}
          disabled={saving}
          title={t('editor.save.title')}
        >
          {saving ? t('editor.save.saving') : t('editor.save')}
        </button>
        <button
          type="button"
          className="orbitpm-editor__button"
          onClick={() => void handleExportSvg()}
          title={t('editor.exportSvg.title')}
        >
          {t('editor.exportSvg')}
        </button>
        <button
          type="button"
          className="orbitpm-editor__button"
          onClick={() => void handleExportPng()}
          title={t('editor.exportPng.title')}
        >
          {t('editor.exportPng')}
        </button>
        <button
          type="button"
          className="orbitpm-editor__button"
          onClick={() => void handleExportPdf()}
          title={t('editor.exportPdf.title')}
        >
          {t('editor.exportPdf')}
        </button>
        <button
          type="button"
          className="orbitpm-editor__button"
          onClick={handleOpenValidation}
          disabled={validationRunning}
          title={t('validation.open.title')}
        >
          {validationRunning
            ? t('validation.running')
            : `${t('validation.open')}${
                validationSummary && validationSummary.blockingErrors > 0
                  ? ` (${validationSummary.blockingErrors})`
                  : ''
              }`}
        </button>
        <button
          type="button"
          className="orbitpm-editor__button"
          onClick={() => void handleOpenSource()}
          title={t('sourceEditor.open.title')}
        >
          {t('sourceEditor.open')}
        </button>
        <button
          ref={outlineToggleRef}
          type="button"
          className="orbitpm-editor__button"
          onClick={(event: ReactMouseEvent<HTMLButtonElement>) => toggleOutline(event.detail === 0)}
          onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
            if (event.key === 'Enter' || event.key === ' ') {
              focusOutlineAfterOpenRef.current = !outlineOpen
            }
          }}
          aria-expanded={outlineOpen}
          aria-controls={outlinePaneId}
          title={outlineMessages.title}
        >
          {outlineMessages.title}
        </button>
        {sourceRollbackAvailable ? (
          <button
            type="button"
            className="orbitpm-editor__button"
            onClick={() => void handleRollbackSourceApply()}
            title={t('sourceEditor.rollback')}
          >
            {t('sourceEditor.rollback')}
          </button>
        ) : null}
        <button
          type="button"
          className="orbitpm-editor__button"
          onClick={() => zoomByFactor(1 / 1.15)}
          title={t('editor.zoomOut.title')}
          aria-label={t('editor.zoomOut.title')}
        >
          −
        </button>
        <button
          type="button"
          className="orbitpm-editor__button"
          onClick={() => zoomByFactor(1.15)}
          title={t('editor.zoomIn.title')}
          aria-label={t('editor.zoomIn.title')}
        >
          ＋
        </button>
        <button
          type="button"
          className="orbitpm-editor__button"
          onClick={handleZoomFit}
          title={t('editor.zoomFit.title')}
        >
          {t('editor.zoomFit')}
        </button>
        <span
          className={
            dirty
              ? 'orbitpm-editor__dirty-flag orbitpm-editor__dirty-flag--dirty'
              : 'orbitpm-editor__dirty-flag'
          }
          title={dirty ? t('editor.dirtyFlag.dirty.title') : t('editor.dirtyFlag.saved.title')}
        >
          {dirty ? t('editor.dirtyFlag.dirty') : t('editor.dirtyFlag.saved')}
        </span>
        {toolbarExtra}
      </div>
      {error ? <div className="orbitpm-editor__error">{error}</div> : null}
      <div className="orbitpm-editor__body" dir={uiDir}>
        <ResponsiveDrawer
          id={outlinePaneId}
          className="orbitpm-process-outline-pane"
          open={outlineOpen}
          mode={shellMode}
          side="inline-start"
          label={outlineMessages.title}
          direction={uiDir}
          inlineSize="clamp(320px, 32vw, 440px)"
          initialFocusRef={outlineCloseRef}
          returnFocusRef={outlineToggleRef}
          onClose={closeOutline}
        >
          <div className="orbitpm-process-outline-pane__controls">
            <button
              ref={outlineCloseRef}
              type="button"
              className="orbitpm-process-outline-pane__close"
              onClick={closeOutline}
              aria-label={outlineMessages.closeOutline}
              title={outlineMessages.closeOutline}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          {outlineOpen ? (
            <ProcessOutlineEditor
              modeler={outlineModeler}
              messages={outlineMessages}
              direction={uiDir}
              onOpenProcessDetails={() => {
                // Process Details is an explicit no-element context. Clear the
                // live bpmn-js selection first so the properties panel cannot
                // retain element mode while the process card is active.
                modelerRef.current?.get('selection').select(null)
                focusPaneAfterOpenRef.current = true
                setDetailsOpenFromRail(true)
              }}
            />
          ) : null}
        </ResponsiveDrawer>
        <div className="orbitpm-editor__canvas-island" dir="ltr">
          <div ref={canvasContainerRef} className="orbitpm-editor__canvas" dir="ltr" />
          {isNewDiagram && !hintDismissed && (
            <div
              // Non-interactive so the palette, canvas and context pad underneath
              // stay fully usable; it vanishes on the first edit (dirty === true).
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1rem'
              }}
            >
              <div
                style={{
                  maxWidth: 340,
                  textAlign: 'center',
                  padding: '0.9rem 1.1rem',
                  borderRadius: 10,
                  background: 'var(--orbitpm-editor-panel-bg)',
                  border: '1px dashed var(--orbitpm-editor-border)',
                  color: 'var(--orbitpm-editor-muted-fg)',
                  boxShadow: '0 4px 18px rgba(0,0,0,0.12)',
                  fontSize: 13,
                  lineHeight: 1.5
                }}
              >
                <div style={{ fontSize: 22, marginBottom: 4 }} aria-hidden>
                  🎨
                </div>
                <strong style={{ color: 'var(--orbitpm-editor-fg)' }}>
                  {t('editor.hint.startDrawing')}
                </strong>
                <div style={{ marginTop: 4 }}>{t('editor.hint.startDrawing.body')}</div>
              </div>
            </div>
          )}
          <ShapeLegend />
        </div>
        {!propsOpen || shellMode === 'docked' ? (
          <DetailsRail
            ref={detailsToggleRef}
            open={propsOpen}
            controlsId={detailsPaneId}
            label={t('pane.details.toggle')}
            title={t('pane.details.toggle.title')}
            direction={uiDir}
            onOpenChange={setDetailsOpenFromRail}
            onRequestPaneFocus={() => {
              focusPaneAfterOpenRef.current = true
            }}
            onRequestToggleFocus={() => {
              focusToggleAfterCloseRef.current = true
            }}
          />
        ) : null}
        <DetailsResizer
          visible={propsOpen && shellMode === 'docked'}
          width={propsWidth}
          direction={uiDir}
          ariaLabel={t('pane.resize.props.aria')}
          onWidthChange={setPropsWidth}
          onReset={resetWidth}
        />
        <ResponsiveDrawer
          id={detailsPaneId}
          className="orbitpm-editor__details-pane"
          open={propsOpen}
          mode={shellMode}
          side="inline-end"
          label={t('pane.details.aria')}
          direction={uiDir}
          inlineSize={shellMode === 'docked' ? propsWidth : `calc(${propsWidth}px + 36px)`}
          keepMounted
          initialFocusRef={detailsHeadingRef}
          onClose={closePropsPanel}
          modalChrome={
            propsOpen && shellMode !== 'docked' ? (
              <DetailsRail
                ref={detailsToggleRef}
                className="orbitpm-details-rail--modal"
                open
                controlsId={detailsPaneId}
                label={t('pane.details.toggle')}
                title={t('pane.details.toggle.title')}
                direction={uiDir}
                onOpenChange={setDetailsOpenFromRail}
                onRequestToggleFocus={() => {
                  focusToggleAfterCloseRef.current = true
                }}
              />
            ) : undefined
          }
        >
          <div className="orbitpm-editor__details-content">
            <h2 ref={detailsHeadingRef} className="orbitpm-editor__details-heading" tabIndex={-1}>
              {t('pane.details.toggle')}
            </h2>
            {sidePaneExtra}
            <div ref={propertiesContainerRef} className="orbitpm-editor__properties" />
          </div>
        </ResponsiveDrawer>
      </div>
      <ValidationCenter
        open={validationOpen}
        summary={validationSummary}
        running={validationRunning}
        documentName={exportFileBaseName}
        onClose={() => setValidationOpen(false)}
        onRun={() => void handleRunValidation()}
        onFocus={handleFocusIssue}
        onRepair={handleRepairIssue}
      />
      <SourceEditorDialog
        open={sourceOpen}
        originalXml={sourceXml}
        validate={(candidateXml, requireDi) => validateDocument(candidateXml, requireDi, true)}
        apply={handleApplySource}
        autoLayout={handleAutoLayout}
        onClose={() => setSourceOpen(false)}
      />
      <SaveDraftDialog
        summary={pendingDraft?.summary ?? null}
        busy={saving}
        onConfirm={() => void handleConfirmDraftSave()}
        onCancel={() => setPendingDraft(null)}
      />
    </div>
  )
}

export default EditorTab

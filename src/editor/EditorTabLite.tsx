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
  useLayoutEffect,
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
import { getDiagramLang, type LangToggleModeler } from './langToggle'
import { installAutoSize, type AutoSizeModeler } from './autoSize'
import { BidiTextRendererModule } from './bidiTextRenderer'
import { t } from '../i18n'
import { useLang } from '../i18n/useLang'
import { SEEDED_GLOSSARY, approvedNeutralTerms } from '../localization/glossary'
import type { LocalizationFieldException } from '../localization/audit'
import {
  reviewBpmnXmlLocalization,
  type ReviewedXmlIngestionReviewer
} from '../localization/xmlIngestion'
import { LocalizationSource, type LocalizationResources } from '../localization/types'
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
import { SourceEditorDialog, type SourceEditorApplyResult } from '../validation/SourceEditorDialog'
import { SaveDraftDialog } from '../validation/SaveDraftDialog'
import { ActionMenu } from '../common/ActionMenu'
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
  /** Exact durable XML used for opaque-extension preservation checks. */
  baselineXml?: string
  /** Marks an initial/replaced prop snapshot as unsaved editor work. */
  initiallyDirty?: boolean
  onDirtyChange: (dirty: boolean) => void
  onRequestSave: (
    xml: string,
    options?: { explicitDraftWithErrors?: boolean }
  ) => Promise<void | { durable: boolean; acceptedSubmittedXml?: boolean }>
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
  /** Optional shell-owned Process Outline state. Omit for local editor ownership. */
  outlineOpen?: boolean
  /** Notifies the shell whenever the effective Process Outline state changes. */
  onOutlineOpenChange?: (open: boolean) => void
  /**
   * Mounted background editors keep their modelers alive, but must not mount
   * modal side panes or participate in shell focus/inert management.
   */
  sidePanesActive?: boolean
  /** Exact workspace glossary/TM snapshot for Source Apply. */
  sourceLocalizationResources?: LocalizationResources
  /**
   * Awaited, digest-bound review for unresolved Source XML. Omitting it keeps
   * unresolved drafts open and blocked; fully complete drafts still apply.
   */
  onReviewSourceBilingual?: ReviewedXmlIngestionReviewer
}

export interface EditorTabCommands {
  save: () => void
  exportSvg: () => void
  exportPng: () => void
  exportPdf: () => void
  /** Apply a durable external baseline once and acknowledge the next matching prop. */
  applyExternalXml: (
    xml: string,
    options?: { dirty?: boolean; baselineXml?: string }
  ) => Promise<void>
  /**
   * Own the editor's XML mutation lane for the complete callback. Callers must
   * use `importXml` instead of the modeler's raw import method so imports stay
   * bound to this live modeler and do not leak command-stack events.
   */
  runExclusiveXmlTransaction: <Result>(
    operation: (transaction: EditorXmlTransaction) => Promise<Result> | Result
  ) => Promise<Result>
}

export interface EditorXmlTransactionModeler {
  saveXML(options: { format: boolean }): Promise<{ xml?: string }>
  get(name: string): unknown
}

export interface EditorXmlTransaction {
  readonly modeler: EditorXmlTransactionModeler
  importXml(xml: string): Promise<{ warnings: string[] }>
  assertActive(): void
  /** Mark the current imported XML dirty without issuing another modeler command. */
  markDirty(): void
  /** Restore the dirty/clean state captured when this transaction acquired the lane. */
  restoreDirtyState(): void
}

interface SourceApplyCommandContext {
  initialExecution: boolean
  restorePrevious(): void
  restoreApplied(): void
}

interface CommandHandlerLike {
  execute?(context: SourceApplyCommandContext): void
  revert?(context: SourceApplyCommandContext): void
}

interface CommandStackLike {
  _stackIdx: number
  execute(command: string, context: SourceApplyCommandContext): void
  register(command: string, handler: CommandHandlerLike): void
}

const SOURCE_APPLY_COMMAND = 'orbitpm.source-editor.apply'
const DEFAULT_SOURCE_LOCALIZATION_RESOURCES: LocalizationResources = Object.freeze({
  glossary: SEEDED_GLOSSARY,
  translationMemory: Object.freeze([])
})

/**
 * Source replacement necessarily calls bpmn-js importXML, whose diagram clear
 * resets the command stack but retains registered handlers. We therefore
 * register this journal handler once per modeler, then add one marker after a
 * successful import. Undo imports the exact pre-Apply XML. That restore clears
 * the marker (and thus redo history) by design; users can re-Apply from Source,
 * while an impossible/stale redo can never overwrite later work.
 */
const sourceApplyCommandHandler: CommandHandlerLike = {
  execute(context): void {
    if (context.initialExecution) {
      context.initialExecution = false
      return
    }
    context.restoreApplied()
  },
  revert(context): void {
    context.restorePrevious()
  }
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

interface BpmnModelerLike extends EditorXmlTransactionModeler {
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
  get(name: string): unknown
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

async function serializeModelerXml(modeler: EditorXmlTransactionModeler): Promise<string> {
  const { xml } = await modeler.saveXML({ format: true })
  if (typeof xml !== 'string') {
    throw new Error('bpmn-js returned no XML')
  }
  return xml
}

export function EditorTab(props: EditorTabProps): JSX.Element {
  const {
    xml,
    baselineXml,
    initiallyDirty,
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
    onDetailsOpenChange,
    outlineOpen: controlledOutlineOpen,
    onOutlineOpenChange,
    sidePanesActive = true,
    sourceLocalizationResources,
    onReviewSourceBilingual
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
  const actionMenuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const modelerRef = useRef<BpmnModelerLike | null>(null)
  const dirtyStateRef = useRef<DirtyState>(createDirtyState(0))
  const xmlPropRef = useRef(xml)
  xmlPropRef.current = xml
  const originalXmlRef = useRef(baselineXml ?? xml)
  const lastPropSnapshotRef = useRef<{
    xml: string
    baselineXml: string | undefined
    initiallyDirty: boolean
  } | null>(null)
  const hasImportedXmlRef = useRef(false)
  const externallyAppliedXmlRef = useRef<string | null>(null)
  const savedPropAcknowledgementRef = useRef<string | null>(null)
  const sourceRollbackRef = useRef<{
    xml: string
    appliedXml: string
    wasDirty: boolean
    previousApprovals: readonly LocalizationFieldException[]
    appliedApprovals: readonly LocalizationFieldException[]
  } | null>(null)
  const sourceApprovedFieldExceptionsRef = useRef<readonly LocalizationFieldException[]>([])
  const ignoreNextSourceJournalCommandRef = useRef(false)
  const importCommandEventDepthRef = useRef(0)
  const xmlTransactionTailRef = useRef<Promise<void>>(Promise.resolve())
  const saveInFlightRef = useRef(false)
  const xmlTransactionCountRef = useRef(0)
  const onOpenCalledProcessRef = useRef(onOpenCalledProcess)
  onOpenCalledProcessRef.current = onOpenCalledProcess
  const onOpenStepDetailsRef = useRef(onOpenStepDetails)
  onOpenStepDetailsRef.current = onOpenStepDetails
  const sidePanesActiveRef = useRef(sidePanesActive)
  const sidePaneSessionRef = useRef(0)

  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [xmlTransactionCount, setXmlTransactionCount] = useState(0)
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
  const {
    preferences: detailsPreferences,
    setOpen: setDetailsPreferenceOpen,
    setWidth: setPropsWidth,
    resetWidth
  } = detailsController
  const propsWidth = detailsPreferences.width
  const focusPaneAfterOpenRef = useRef(false)
  const focusToggleAfterCloseRef = useRef(false)
  const detectedResponsiveMode = useResponsiveShellMode()
  const shellMode = responsiveMode ?? detectedResponsiveMode
  const isSidePaneModal = shellMode !== 'docked'
  const [localOutlineOpen, setLocalOutlineOpen] = useState(false)
  const outlineOpen = controlledOutlineOpen ?? localOutlineOpen
  const propsOpen = sidePanesActive && detailsPreferences.open
  // Details wins if controlled state briefly presents both panes after a
  // docked -> modal breakpoint change. The layout reconciliation below then
  // reports/closes Outline before the browser can paint two modal surfaces.
  const outlinePaneOpen = sidePanesActive && outlineOpen && (!isSidePaneModal || !propsOpen)
  const [outlineModeler, setOutlineModeler] = useState<ProcessOutlineModeler | null>(null)
  const focusOutlineAfterOpenRef = useRef(false)
  const focusOutlineToggleAfterCloseRef = useRef(false)
  const outlineOpenRef = useRef(outlineOpen)
  outlineOpenRef.current = outlineOpen
  const lastActiveOutlineOpenRef = useRef(sidePanesActive && outlineOpen)
  const controlledOutlineOpenRef = useRef(controlledOutlineOpen)
  controlledOutlineOpenRef.current = controlledOutlineOpen
  const onOutlineOpenChangeRef = useRef(onOutlineOpenChange)
  onOutlineOpenChangeRef.current = onOutlineOpenChange

  const isSidePaneSessionCurrent = useCallback(
    (session: number): boolean =>
      sidePanesActiveRef.current && sidePaneSessionRef.current === session,
    []
  )

  const setOutlineOpenState = useCallback((next: boolean): void => {
    if (next && !sidePanesActiveRef.current) return
    if (outlineOpenRef.current === next) return
    outlineOpenRef.current = next
    lastActiveOutlineOpenRef.current = next
    if (controlledOutlineOpenRef.current === undefined) {
      setLocalOutlineOpen(next)
    }
    onOutlineOpenChangeRef.current?.(next)
  }, [])

  useLayoutEffect(() => {
    if (sidePanesActive) lastActiveOutlineOpenRef.current = outlineOpen
  }, [outlineOpen, sidePanesActive])

  const setPropsPanelOpen = useCallback(
    (next: boolean): void => {
      if (next && !sidePanesActiveRef.current) return
      setDetailsPreferenceOpen(next)
      onDetailsOpenChange?.(next)
    },
    [onDetailsOpenChange, setDetailsPreferenceOpen]
  )

  useLayoutEffect(() => {
    const wasActive = sidePanesActiveRef.current
    if (wasActive === sidePanesActive) return
    sidePanesActiveRef.current = sidePanesActive
    sidePaneSessionRef.current += 1
    if (sidePanesActive) return

    // Do not request focus restoration into an editor that is becoming
    // inactive. Conditional rendering below removes the modal surfaces in this
    // commit; clearing state prevents them from returning on reactivation.
    focusPaneAfterOpenRef.current = false
    focusToggleAfterCloseRef.current = false
    focusOutlineAfterOpenRef.current = false
    focusOutlineToggleAfterCloseRef.current = false
    setValidationOpen(false)
    setSourceOpen(false)
    setPendingDraft(null)
    // A controlled shell commonly gates its value with `sidePanesActive`.
    // Restore the prior active value for transition deduplication so the
    // forced close is still reported to, and durably cleared by, that shell.
    if (lastActiveOutlineOpenRef.current) outlineOpenRef.current = true
    setOutlineOpenState(false)
    // A shared controller is shell state, not tab state. Preserve its open
    // preference so the newly active editor can host Details; render gating
    // above already removes this inactive editor's drawer surface.
    if (!sharedDetailsController && wasActive && detailsPreferences.open) {
      setPropsPanelOpen(false)
    }
  }, [
    detailsPreferences.open,
    sharedDetailsController,
    setOutlineOpenState,
    setPropsPanelOpen,
    sidePanesActive
  ])

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
      if (!sidePanesActiveRef.current) return
      if (isSidePaneModal && outlineOpen) setOutlineOpenState(false)
      setPropsPanelOpen(true)
    },
    [closePropsPanel, isSidePaneModal, outlineOpen, setOutlineOpenState, setPropsPanelOpen]
  )
  const setDetailsOpenFromRailRef = useRef(setDetailsOpenFromRail)
  setDetailsOpenFromRailRef.current = setDetailsOpenFromRail

  const closeOutline = useCallback(() => {
    focusOutlineToggleAfterCloseRef.current = true
    setOutlineOpenState(false)
  }, [setOutlineOpenState])

  const toggleOutline = useCallback(
    (keyboardTriggered: boolean): void => {
      if (!sidePanesActiveRef.current) return
      if (outlineOpen) {
        closeOutline()
        return
      }
      if (isSidePaneModal && propsOpen) setPropsPanelOpen(false)
      focusOutlineAfterOpenRef.current = keyboardTriggered || isSidePaneModal
      setOutlineOpenState(true)
    },
    [closeOutline, isSidePaneModal, outlineOpen, propsOpen, setOutlineOpenState, setPropsPanelOpen]
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

  useLayoutEffect(() => {
    if (!isSidePaneModal || !propsOpen || !outlineOpen) return
    setOutlineOpenState(false)
  }, [isSidePaneModal, outlineOpen, propsOpen, setOutlineOpenState])

  useEffect(() => {
    if (outlinePaneOpen) {
      if (!focusOutlineAfterOpenRef.current) return
      focusOutlineAfterOpenRef.current = false
      const frame = requestAnimationFrame(() => outlineCloseRef.current?.focus())
      return () => cancelAnimationFrame(frame)
    }
    if (!focusOutlineToggleAfterCloseRef.current) return
    focusOutlineToggleAfterCloseRef.current = false
    const frame = requestAnimationFrame(() =>
      (shellMode === 'compact' ? actionMenuTriggerRef.current : outlineToggleRef.current)?.focus()
    )
    return () => cancelAnimationFrame(frame)
  }, [outlinePaneOpen, shellMode])

  const applyDirtyState = useCallback(
    (next: DirtyState) => {
      dirtyStateRef.current = next
      const nowDirty = isDirty(next)
      setDirty(nowDirty)
      onDirtyChange(nowDirty)
    },
    [onDirtyChange]
  )

  const runExclusiveXmlTransaction = useCallback(
    <Result,>(
      operation: (transaction: EditorXmlTransaction) => Promise<Result> | Result
    ): Promise<Result> => {
      const modeler = modelerRef.current
      if (!modeler) return Promise.reject(new Error('editor not ready'))

      xmlTransactionCountRef.current += 1
      setXmlTransactionCount((count) => count + 1)
      const assertActive = (): void => {
        if (modelerRef.current !== modeler) {
          throw new DOMException('The editor modeler is no longer active.', 'AbortError')
        }
      }
      const queued = xmlTransactionTailRef.current
        .catch(() => undefined)
        .then(async () => {
          assertActive()
          const transactionStartedDirty = isDirty(dirtyStateRef.current)
          return await operation({
            modeler,
            assertActive,
            markDirty: () => {
              assertActive()
              const stackIndex = getStackIndex(modeler)
              applyDirtyState(withCommandStackChanged(createDirtyState(stackIndex - 1), stackIndex))
            },
            restoreDirtyState: () => {
              assertActive()
              const stackIndex = getStackIndex(modeler)
              applyDirtyState(
                transactionStartedDirty
                  ? withCommandStackChanged(createDirtyState(stackIndex - 1), stackIndex)
                  : createDirtyState(stackIndex)
              )
            },
            importXml: async (candidateXml) => {
              assertActive()
              importCommandEventDepthRef.current += 1
              try {
                const result = await modeler.importXML(candidateXml)
                assertActive()
                return result
              } finally {
                importCommandEventDepthRef.current = Math.max(
                  0,
                  importCommandEventDepthRef.current - 1
                )
              }
            }
          })
        })
        .finally(() => {
          xmlTransactionCountRef.current = Math.max(0, xmlTransactionCountRef.current - 1)
          setXmlTransactionCount((count) => Math.max(0, count - 1))
        })
      xmlTransactionTailRef.current = queued.then(
        () => undefined,
        () => undefined
      )
      return queued
    },
    [applyDirtyState]
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
    // CommandStack#clear (fired by importXML) clears actions, not handlers.
    modeler.get('commandStack').register(SOURCE_APPLY_COMMAND, sourceApplyCommandHandler)
    setOutlineModeler(modeler as unknown as ProcessOutlineModeler)
    onModelerReadyRef.current?.(modeler)

    const handleCommandStackChanged = (): void => {
      if (importCommandEventDepthRef.current > 0) return
      // Initial document creation/import can truthfully start dirty without
      // being a modeling interaction. Any command event that reaches this
      // unguarded path is a real edit (or its undo/redo), so it permanently
      // dismisses the near-empty-diagram guidance.
      setHintDismissed(true)
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
        setDetailsOpenFromRailRef.current(true)
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
    const snapshot = {
      xml,
      baselineXml,
      initiallyDirty: Boolean(initiallyDirty)
    }
    const previousSnapshot = lastPropSnapshotRef.current
    lastPropSnapshotRef.current = snapshot

    const externalAcknowledgement = externallyAppliedXmlRef.current === xml
    const savedAcknowledgement = savedPropAcknowledgementRef.current === xml
    if (externalAcknowledgement) {
      externallyAppliedXmlRef.current = null
      if (savedAcknowledgement) {
        savedPropAcknowledgementRef.current = null
      }
    }
    if (savedAcknowledgement) {
      savedPropAcknowledgementRef.current = null
    }

    setError(null)
    const adoptMetadataWithoutImport = async (
      transaction: EditorXmlTransaction,
      trustedDirtyUpgrade: boolean
    ): Promise<void> => {
      if (transaction.modeler !== modeler || lastPropSnapshotRef.current !== snapshot) {
        return
      }
      // Baseline adoption is independent of canvas serialization. Even an
      // temporarily uncapturable dirty canvas must use the new durable XML for
      // the next preservation check.
      originalXmlRef.current = snapshot.baselineXml ?? snapshot.xml
      if (!snapshot.initiallyDirty || isDirty(dirtyStateRef.current)) return
      if (!trustedDirtyUpgrade) {
        let currentXml: string
        try {
          currentXml = await serializeModelerXml(transaction.modeler)
        } catch {
          return
        }
        transaction.assertActive()
        if (lastPropSnapshotRef.current !== snapshot || currentXml !== snapshot.xml) {
          return
        }
      }
      const stackIndex = getStackIndex(modeler)
      applyDirtyState(withCommandStackChanged(createDirtyState(stackIndex - 1), stackIndex))
    }

    if (externalAcknowledgement || savedAcknowledgement || previousSnapshot?.xml === snapshot.xml) {
      void runExclusiveXmlTransaction(async (transaction) => {
        // A baseline-only prop update must never re-import `xml`: the canvas
        // may contain newer dirty work. Matching external/save acknowledgements
        // can conservatively upgrade clean -> dirty without reading the canvas.
        await adoptMetadataWithoutImport(
          transaction,
          externalAcknowledgement || savedAcknowledgement
        )
      }).catch((err: unknown) => {
        if (lastPropSnapshotRef.current === snapshot) {
          setError(t('editor.error.loadFailed', { error: errorMessage(err) }))
        }
      })
      return
    }

    void runExclusiveXmlTransaction(async (transaction) => {
      if (transaction.modeler !== modeler) {
        throw new DOMException('The editor modeler is no longer active.', 'AbortError')
      }
      if (lastPropSnapshotRef.current !== snapshot) return
      let previousXml: string | null = null
      try {
        previousXml = await serializeModelerXml(transaction.modeler)
        transaction.assertActive()
      } catch (error) {
        if (hasImportedXmlRef.current) throw error
      }
      if (lastPropSnapshotRef.current !== snapshot) return

      let warnings: string[]
      try {
        ;({ warnings } = await transaction.importXml(snapshot.xml))
      } catch (error) {
        if (previousXml !== null && hasImportedXmlRef.current) {
          try {
            await transaction.importXml(previousXml)
            transaction.restoreDirtyState()
          } catch {
            // Keep the prop import error primary; rollback is best-effort.
          }
        }
        throw error
      }
      hasImportedXmlRef.current = true
      transaction.assertActive()
      if (lastPropSnapshotRef.current !== snapshot) {
        if (previousXml !== null) {
          await transaction.importXml(previousXml)
          transaction.restoreDirtyState()
        }
        return
      }
      if (warnings && warnings.length > 0) {
        console.warn('BPMN import warnings:', warnings)
      }
      originalXmlRef.current = snapshot.baselineXml ?? snapshot.xml
      externallyAppliedXmlRef.current = null
      savedPropAcknowledgementRef.current = null
      sourceApprovedFieldExceptionsRef.current = []
      sourceRollbackRef.current = null
      setSourceRollbackAvailable(false)
      setValidationSummary(null)
      const stackIndex = getStackIndex(modeler)
      applyDirtyState(
        snapshot.initiallyDirty
          ? withCommandStackChanged(createDirtyState(stackIndex - 1), stackIndex)
          : createDirtyState(stackIndex)
      )
      try {
        modeler.get('canvas').zoom('fit-viewport')
      } catch {
        // View fitting is cosmetic.
      }
      // Show the palette hint only for a freshly-created, near-empty diagram
      // (nothing but a start event), never when opening a real process file.
      setIsNewDiagram(countFlowNodeShapes(modeler.get('elementRegistry')) <= 1)
      setHintDismissed(false)
    }).catch((err: unknown) => {
      if (lastPropSnapshotRef.current === snapshot) {
        setError(t('editor.error.loadFailed', { error: errorMessage(err) }))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xml, baselineXml, initiallyDirty])

  const validateDocument = useCallback(
    async (
      candidateXml: string,
      requireDi: boolean,
      preservationBaseline?: string,
      requireBilingual = false,
      approvedFieldExceptions: readonly LocalizationFieldException[] = sourceApprovedFieldExceptionsRef.current
    ): Promise<ValidationSummary> => {
      const parsed = await validateBpmnXml(candidateXml, {
        adapters: getRuntimeValidationAdapters(),
        knownProcessIds: knownProcessIds ?? [],
        neutralTerms: approvedNeutralTerms(
          sourceLocalizationResources?.glossary ?? SEEDED_GLOSSARY
        ),
        approvedFieldExceptions,
        requireBilingual,
        requireDi
      })
      if (preservationBaseline === undefined || !parsed.summary.xmlWellFormed) {
        return parsed.summary
      }
      const preservation = await validateUnknownExtensionPreservation(
        preservationBaseline,
        candidateXml
      )
      return mergeValidationSummaries(parsed.summary, preservation)
    },
    [knownProcessIds, sourceLocalizationResources]
  )

  const readCurrentXml = useCallback(async (): Promise<string> => {
    const modeler = modelerRef.current
    if (!modeler) throw new Error('editor not ready')
    return await serializeModelerXml(modeler)
  }, [])

  const applyExternalXml = useCallback(
    async (
      candidateXml: string,
      options?: { dirty?: boolean; baselineXml?: string }
    ): Promise<void> => {
      const modeler = modelerRef.current
      if (!modeler) throw new Error('editor not ready')
      setError(null)
      await runExclusiveXmlTransaction(async (transaction) => {
        if (transaction.modeler !== modeler) {
          throw new DOMException('The editor modeler is no longer active.', 'AbortError')
        }
        const previousXml = await serializeModelerXml(transaction.modeler)
        transaction.assertActive()
        let mutationAttempted = false
        try {
          mutationAttempted = true
          const { warnings } = await transaction.importXml(candidateXml)
          hasImportedXmlRef.current = true
          transaction.assertActive()
          if (warnings && warnings.length > 0) {
            console.warn('BPMN import warnings:', warnings)
          }
          try {
            modeler.get('canvas').zoom('fit-viewport')
          } catch {
            // View fitting is cosmetic and must not turn a committed XML
            // replacement into a rollback attempt.
          }

          // No awaited work follows this point: XML and its editor metadata
          // become visible as one exclusive commit.
          externallyAppliedXmlRef.current = candidateXml
          if (options?.baselineXml !== undefined) {
            originalXmlRef.current = options.baselineXml
          } else if (!options?.dirty) {
            originalXmlRef.current = candidateXml
          }
          sourceApprovedFieldExceptionsRef.current = []
          sourceRollbackRef.current = null
          setSourceRollbackAvailable(false)
          setValidationSummary(null)
          // Unlike a prop import, this is an explicit XML replacement. Do not
          // leave the new-diagram guidance floating over the replacement.
          setHintDismissed(true)
          const stackIndex = getStackIndex(modeler)
          applyDirtyState(
            options?.dirty
              ? withCommandStackChanged(createDirtyState(stackIndex - 1), stackIndex)
              : createDirtyState(stackIndex)
          )
        } catch (error) {
          if (mutationAttempted && modelerRef.current === modeler) {
            try {
              await transaction.importXml(previousXml)
              transaction.assertActive()
              transaction.restoreDirtyState()
            } catch {
              // The replacement error remains primary. Import failures may
              // occur before mutation, and rollback itself is best-effort.
            }
          }
          throw error
        }
      })
    },
    [applyDirtyState, runExclusiveXmlTransaction]
  )

  const persistXml = useCallback(
    async (savedXml: string, explicitDraftWithErrors = false): Promise<void> => {
      const acknowledgeProp = savedXml !== xmlPropRef.current
      if (acknowledgeProp) savedPropAcknowledgementRef.current = savedXml
      let outcome: void | { durable: boolean; acceptedSubmittedXml?: boolean }
      try {
        outcome = await onRequestSave(savedXml, { explicitDraftWithErrors })
      } catch (error) {
        if (acknowledgeProp && savedPropAcknowledgementRef.current === savedXml) {
          savedPropAcknowledgementRef.current = null
        }
        throw error
      }
      if (outcome && (!outcome.durable || outcome.acceptedSubmittedXml === false)) {
        if (acknowledgeProp && savedPropAcknowledgementRef.current === savedXml) {
          savedPropAcknowledgementRef.current = null
        }
        return
      }
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
      const summary = await validateDocument(currentXml, true, originalXmlRef.current, true)
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
    if (!sidePanesActiveRef.current) return
    setValidationOpen(true)
    void handleRunValidation()
  }, [handleRunValidation])

  const handleOpenSource = useCallback(async () => {
    if (!sidePanesActiveRef.current) return
    const sidePaneSession = sidePaneSessionRef.current
    setError(null)
    try {
      const currentXml = await readCurrentXml()
      if (!isSidePaneSessionCurrent(sidePaneSession)) return
      setSourceXml(currentXml)
      setSourceOpen(true)
    } catch (err) {
      if (!isSidePaneSessionCurrent(sidePaneSession)) return
      setError(t('editor.error.loadFailed', { error: errorMessage(err) }))
    }
  }, [isSidePaneSessionCurrent, readCurrentXml])

  const setImportedDocumentDirtyState = useCallback(
    (modeler: BpmnModelerLike, shouldBeDirty: boolean): void => {
      const stackIndex = getStackIndex(modeler)
      applyDirtyState(
        shouldBeDirty
          ? withCommandStackChanged(createDirtyState(stackIndex - 1), stackIndex)
          : createDirtyState(stackIndex)
      )
    },
    [applyDirtyState]
  )

  const restoreSourceSnapshotInTransaction = useCallback(
    async (
      transaction: EditorXmlTransaction,
      snapshotXml: string,
      shouldBeDirty: boolean,
      requireBilingual: boolean,
      approvedFieldExceptions: readonly LocalizationFieldException[]
    ): Promise<void> => {
      const modeler = transaction.modeler as BpmnModelerLike
      await transaction.importXml(snapshotXml)
      hasImportedXmlRef.current = true
      transaction.assertActive()
      sourceApprovedFieldExceptionsRef.current = approvedFieldExceptions
      try {
        modeler.get('canvas').zoom('fit-viewport')
      } catch {
        // View fitting is cosmetic.
      }
      setImportedDocumentDirtyState(modeler, shouldBeDirty)
      let summary: ValidationSummary
      try {
        summary = await validateDocument(
          snapshotXml,
          true,
          snapshotXml,
          requireBilingual,
          approvedFieldExceptions
        )
      } catch {
        transaction.assertActive()
        // The exact snapshot is already restored. A later Validation Center
        // run can retry adapters that were temporarily unavailable.
        setValidationSummary(null)
        return
      }
      transaction.assertActive()
      setValidationSummary(summary)
    },
    [setImportedDocumentDirtyState, validateDocument]
  )

  const restoreSourceSnapshot = useCallback(
    async (
      modeler: BpmnModelerLike,
      target: {
        xml: string
        dirty: boolean
        requireBilingual: boolean
        approvedFieldExceptions: readonly LocalizationFieldException[]
      },
      fallback: {
        xml: string
        dirty: boolean
        requireBilingual: boolean
        approvedFieldExceptions: readonly LocalizationFieldException[]
      } | null = null
    ): Promise<void> => {
      await runExclusiveXmlTransaction(async (transaction) => {
        if (transaction.modeler !== modeler) {
          throw new DOMException('The editor modeler is no longer active.', 'AbortError')
        }
        try {
          await restoreSourceSnapshotInTransaction(
            transaction,
            target.xml,
            target.dirty,
            target.requireBilingual,
            target.approvedFieldExceptions
          )
        } catch (caught) {
          if (fallback) {
            try {
              await restoreSourceSnapshotInTransaction(
                transaction,
                fallback.xml,
                fallback.dirty,
                fallback.requireBilingual,
                fallback.approvedFieldExceptions
              )
            } catch {
              // Keep the first restoration error; it identifies the requested
              // transaction side that could not be recovered.
            }
          }
          throw caught
        }
      })
    },
    [restoreSourceSnapshotInTransaction, runExclusiveXmlTransaction]
  )

  const queueSourceSnapshotRestore = useCallback(
    (
      modeler: BpmnModelerLike,
      target: {
        xml: string
        dirty: boolean
        requireBilingual: boolean
        approvedFieldExceptions: readonly LocalizationFieldException[]
      },
      fallback: {
        xml: string
        dirty: boolean
        requireBilingual: boolean
        approvedFieldExceptions: readonly LocalizationFieldException[]
      }
    ): void => {
      sourceRollbackRef.current = null
      setSourceRollbackAvailable(false)
      ignoreNextSourceJournalCommandRef.current = false
      void restoreSourceSnapshot(modeler, target, fallback).catch((caught) => {
        if (modelerRef.current !== modeler) return
        setError(
          t('sourceEditor.applyFailed', {
            error: errorMessage(caught)
          })
        )
      })
    },
    [restoreSourceSnapshot]
  )

  const handleApplySource = useCallback(
    async (candidateXml: string, signal: AbortSignal): Promise<SourceEditorApplyResult> => {
      const modeler = modelerRef.current
      if (!modeler) throw new Error('editor not ready')
      const previousXml = await readCurrentXml()
      const previousApprovals = sourceApprovedFieldExceptionsRef.current
      const isSourceCurrent = async (): Promise<boolean> => {
        if (signal.aborted || modelerRef.current !== modeler) return false
        try {
          return (await readCurrentXml()) === previousXml
        } catch {
          return false
        }
      }
      const target = getDiagramLang(modeler as unknown as LangToggleModeler)
      const ingestion = await reviewBpmnXmlLocalization(candidateXml, {
        source: LocalizationSource.Xml,
        target,
        defaultActive: target,
        resources: sourceLocalizationResources ?? DEFAULT_SOURCE_LOCALIZATION_RESOURCES,
        approvedFieldExceptions: previousApprovals,
        validation: {
          adapters: getRuntimeValidationAdapters(),
          knownProcessIds: knownProcessIds ?? [],
          requireDi: true
        },
        review: onReviewSourceBilingual,
        signal,
        isCurrent: isSourceCurrent
      })
      if (ingestion.status === 'cancelled') return { status: 'cancelled' }
      if (ingestion.status === 'review-required') {
        return { status: 'blocked', message: t('sourceEditor.invalidBlocked') }
      }

      const reviewedXml = ingestion.xml
      const appliedApprovals = Object.freeze([
        ...previousApprovals,
        ...ingestion.evidence.reviewedApprovals
      ])
      const preImportValidation = await validateDocument(
        reviewedXml,
        true,
        previousXml,
        true,
        appliedApprovals
      )
      if (
        !preImportValidation.valid ||
        !evaluateValidationPolicy(preImportValidation, 'apply-editor').allowed
      ) {
        return { status: 'blocked', message: t('sourceEditor.invalidBlocked') }
      }

      return await runExclusiveXmlTransaction(async (transaction) => {
        if (transaction.modeler !== modeler) {
          throw new DOMException('The editor modeler is no longer active.', 'AbortError')
        }
        if (signal.aborted) return { status: 'cancelled' }
        if (saveInFlightRef.current) {
          return { status: 'blocked', message: t('sourceEditor.invalidBlocked') }
        }
        const mutationBaseline = await serializeModelerXml(transaction.modeler)
        transaction.assertActive()
        if (signal.aborted) return { status: 'cancelled' }
        if (mutationBaseline !== previousXml) {
          return { status: 'blocked', message: t('sourceEditor.invalidBlocked') }
        }
        const mutationWasDirty = isDirty(dirtyStateRef.current)

        let sourceMutationStarted = false
        try {
          sourceRollbackRef.current = null
          setSourceRollbackAvailable(false)
          sourceMutationStarted = true
          await transaction.importXml(reviewedXml)
          hasImportedXmlRef.current = true
          if (signal.aborted) {
            throw signal.reason ?? new DOMException('Operation was aborted.', 'AbortError')
          }

          // A parseable source may still contain opaque vendor content that
          // the modeler's serializer does not understand. Keep ownership of
          // the mutation lane through round-trip checks and any rollback.
          const roundTripXml = await serializeModelerXml(transaction.modeler)
          transaction.assertActive()
          const roundTripPreservation = await validateUnknownExtensionPreservation(
            reviewedXml,
            roundTripXml
          )
          transaction.assertActive()
          if (!roundTripPreservation.valid) {
            throw new Error(t('sourceEditor.preservationBlocked'))
          }

          const roundTripValidation = await validateDocument(
            roundTripXml,
            true,
            previousXml,
            true,
            appliedApprovals
          )
          transaction.assertActive()
          if (
            !roundTripValidation.valid ||
            !evaluateValidationPolicy(roundTripValidation, 'apply-editor').allowed
          ) {
            throw new Error(t('sourceEditor.invalidBlocked'))
          }

          try {
            modeler.get('canvas').zoom('fit-viewport')
          } catch {
            // View fitting is cosmetic.
          }
          externallyAppliedXmlRef.current = null
          savedPropAcknowledgementRef.current = null
          sourceRollbackRef.current = {
            xml: previousXml,
            appliedXml: roundTripXml,
            wasDirty: mutationWasDirty,
            previousApprovals,
            appliedApprovals
          }
          sourceApprovedFieldExceptionsRef.current = appliedApprovals
          setSourceRollbackAvailable(true)
          ignoreNextSourceJournalCommandRef.current = true
          modeler.get('commandStack').execute(SOURCE_APPLY_COMMAND, {
            initialExecution: true,
            restorePrevious: () =>
              queueSourceSnapshotRestore(
                modeler,
                {
                  xml: previousXml,
                  dirty: mutationWasDirty,
                  requireBilingual: false,
                  approvedFieldExceptions: previousApprovals
                },
                {
                  xml: roundTripXml,
                  dirty: true,
                  requireBilingual: true,
                  approvedFieldExceptions: appliedApprovals
                }
              ),
            restoreApplied: () =>
              queueSourceSnapshotRestore(
                modeler,
                {
                  xml: roundTripXml,
                  dirty: true,
                  requireBilingual: true,
                  approvedFieldExceptions: appliedApprovals
                },
                {
                  xml: previousXml,
                  dirty: mutationWasDirty,
                  requireBilingual: false,
                  approvedFieldExceptions: previousApprovals
                }
              )
          })
          setImportedDocumentDirtyState(modeler, true)
          setValidationSummary(roundTripValidation)
          return { status: 'applied' }
        } catch (err) {
          if (sourceMutationStarted) {
            sourceRollbackRef.current = null
            setSourceRollbackAvailable(false)
            ignoreNextSourceJournalCommandRef.current = false
            try {
              await restoreSourceSnapshotInTransaction(
                transaction,
                previousXml,
                mutationWasDirty,
                false,
                previousApprovals
              )
            } catch (rollbackError) {
              throw new Error(
                `${errorMessage(err)}; rollback failed: ${errorMessage(rollbackError)}`
              )
            }
          }
          throw err
        }
      })
    },
    [
      knownProcessIds,
      onReviewSourceBilingual,
      queueSourceSnapshotRestore,
      readCurrentXml,
      restoreSourceSnapshotInTransaction,
      runExclusiveXmlTransaction,
      setImportedDocumentDirtyState,
      sourceLocalizationResources,
      validateDocument
    ]
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
      await restoreSourceSnapshot(
        modeler,
        {
          xml: rollback.xml,
          dirty: rollback.wasDirty,
          requireBilingual: false,
          approvedFieldExceptions: rollback.previousApprovals
        },
        {
          xml: rollback.appliedXml,
          dirty: true,
          requireBilingual: true,
          approvedFieldExceptions: rollback.appliedApprovals
        }
      )
    } catch (err) {
      sourceRollbackRef.current = rollback
      setSourceRollbackAvailable(true)
      setError(t('sourceEditor.applyFailed', { error: errorMessage(err) }))
    }
  }, [restoreSourceSnapshot])

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
    if (
      !modelerRef.current ||
      saveInFlightRef.current ||
      xmlTransactionCountRef.current > 0 ||
      validationRunning
    ) {
      return
    }
    const sidePaneSession = sidePanesActiveRef.current ? sidePaneSessionRef.current : null
    saveInFlightRef.current = true
    setSaving(true)
    setValidationRunning(true)
    setError(null)
    try {
      const savedXml = await readCurrentXml()
      const summary = await validateDocument(savedXml, true, originalXmlRef.current, true)
      setValidationSummary(summary)

      const normalSave = evaluateValidationPolicy(summary, 'save')
      if (normalSave.allowed) {
        await persistXml(savedXml)
        return
      }

      const draftSave = evaluateValidationPolicy(summary, 'save-draft-with-errors')
      if (draftSave.requiresExplicitDraftConfirmation) {
        if (sidePaneSession !== null && isSidePaneSessionCurrent(sidePaneSession)) {
          setPendingDraft({ xml: savedXml, summary })
        }
        return
      }

      if (sidePaneSession !== null && isSidePaneSessionCurrent(sidePaneSession)) {
        setValidationOpen(true)
        setError(t('save.blocked'))
      }
    } catch (err) {
      setError(t('editor.error.saveFailed', { error: errorMessage(err) }))
    } finally {
      setValidationRunning(false)
      setSaving(false)
      saveInFlightRef.current = false
    }
  }, [isSidePaneSessionCurrent, persistXml, readCurrentXml, validateDocument, validationRunning])

  const handleConfirmDraftSave = useCallback(async () => {
    if (!pendingDraft || saveInFlightRef.current || xmlTransactionCountRef.current > 0) {
      return
    }
    const decision = evaluateValidationPolicy(pendingDraft.summary, 'save-draft-with-errors', {
      explicitDraftConfirmation: true
    })
    if (!decision.allowed) {
      setPendingDraft(null)
      if (sidePanesActiveRef.current) setValidationOpen(true)
      return
    }
    saveInFlightRef.current = true
    setSaving(true)
    setError(null)
    try {
      await persistXml(pendingDraft.xml, true)
      setPendingDraft(null)
    } catch (err) {
      setError(t('editor.error.saveFailed', { error: errorMessage(err) }))
    } finally {
      setSaving(false)
      saveInFlightRef.current = false
    }
  }, [pendingDraft, persistXml])

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
  const interactionLocked = saving || xmlTransactionCount > 0
  useEffect(() => {
    const root = editorRootRef.current
    if (!root) return
    root.inert = interactionLocked
    return () => {
      root.inert = false
    }
  }, [interactionLocked])
  useEffect(() => {
    onCommandsReady?.({
      save: () => void handleSave(),
      exportSvg: () => void handleExportSvg(),
      exportPng: () => void handleExportPng(),
      exportPdf: () => void handleExportPdf(),
      applyExternalXml,
      runExclusiveXmlTransaction
    })
    return () => onCommandsReady?.(null)
  }, [
    onCommandsReady,
    handleSave,
    handleExportSvg,
    handleExportPng,
    handleExportPdf,
    applyExternalXml,
    runExclusiveXmlTransaction
  ])

  return (
    // The editor chrome follows the active UI direction. Only the canvas
    // subtree remains LTR because bpmn-js's coordinates/palette/context pad
    // have no RTL mode of their own.
    <div ref={editorRootRef} className="orbitpm-editor" dir={uiDir} aria-busy={interactionLocked}>
      <div className="orbitpm-editor__toolbar">
        <button
          type="button"
          className="orbitpm-editor__button orbitpm-editor__button--primary orbitpm-editor__save"
          onClick={() => void handleSave()}
          disabled={saving}
          title={t('editor.save.title')}
        >
          {saving ? t('editor.save.saving') : t('editor.save')}
        </button>
        <button
          type="button"
          className="orbitpm-editor__button orbitpm-editor__zoom-action"
          onClick={() => zoomByFactor(1 / 1.15)}
          title={t('editor.zoomOut.title')}
          aria-label={t('editor.zoomOut.title')}
        >
          −
        </button>
        <button
          type="button"
          className="orbitpm-editor__button orbitpm-editor__zoom-action"
          onClick={() => zoomByFactor(1.15)}
          title={t('editor.zoomIn.title')}
          aria-label={t('editor.zoomIn.title')}
        >
          ＋
        </button>
        <button
          type="button"
          className="orbitpm-editor__button orbitpm-editor__zoom-action"
          onClick={handleZoomFit}
          title={t('editor.zoomFit.title')}
        >
          <span className="orbitpm-editor__zoom-fit-label">{t('editor.zoomFit')}</span>
          <span className="orbitpm-editor__zoom-fit-glyph" aria-hidden="true">
            ⛶
          </span>
        </button>
        <ActionMenu
          mode={shellMode === 'compact' ? 'menu' : 'inline'}
          label={t('editor.actions.menu')}
          direction={uiDir}
          triggerRef={actionMenuTriggerRef}
          triggerClassName="orbitpm-editor__button orbitpm-editor__action-menu-trigger"
          triggerContent={
            <>
              <span aria-hidden="true">⋯</span>
              <span className="orbitpm-editor__action-menu-label">{t('editor.actions.more')}</span>
            </>
          }
        >
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
            onClick={(event: ReactMouseEvent<HTMLButtonElement>) =>
              toggleOutline(event.detail === 0)
            }
            onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
              if (event.key === 'Enter' || event.key === ' ') {
                focusOutlineAfterOpenRef.current = !outlineOpen
              }
            }}
            aria-expanded={outlinePaneOpen}
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
          {toolbarExtra}
        </ActionMenu>
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
      </div>
      {error ? <div className="orbitpm-editor__error">{error}</div> : null}
      <div
        className={
          interactionLocked
            ? 'orbitpm-editor__body orbitpm-editor__body--interaction-locked'
            : 'orbitpm-editor__body'
        }
        dir={uiDir}
      >
        <ResponsiveDrawer
          id={outlinePaneId}
          className="orbitpm-process-outline-pane"
          open={outlinePaneOpen}
          mode={shellMode}
          side="inline-start"
          label={outlineMessages.title}
          direction={uiDir}
          inlineSize="clamp(320px, 32vw, 440px)"
          initialFocusRef={outlineCloseRef}
          returnFocusRef={shellMode === 'compact' ? actionMenuTriggerRef : outlineToggleRef}
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
          {outlinePaneOpen ? (
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
        <div
          className="orbitpm-editor__details-return-target"
          hidden={propsOpen && shellMode !== 'docked'}
        >
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
        </div>
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
          returnFocusRef={detailsToggleRef}
          onClose={closePropsPanel}
          modalChrome={
            propsOpen && shellMode !== 'docked' ? (
              <DetailsRail
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
      {sidePanesActive ? (
        <>
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
            validate={(candidateXml, requireDi) =>
              validateDocument(candidateXml, requireDi, sourceXml)
            }
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
        </>
      ) : null}
    </div>
  )
}

export default EditorTab

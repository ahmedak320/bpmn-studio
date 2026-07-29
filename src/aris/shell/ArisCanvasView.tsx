/**
 * The React mount for `src/aris/canvas`.
 *
 * `ArisCanvas` was built headless: it takes a container element and owns
 * everything inside it, including its own command stack. This component is the
 * only place in the shell that knows that, and it keeps three rules:
 *
 *  - the canvas is created once per (document, container) pair and destroyed on
 *    unmount, so the ARIS command stack — and therefore undo history — survives
 *    every re-render, model switch and rail interaction;
 *  - a model switch goes through `canvas.setActiveModel`, never through a
 *    remount, because a remount would silently discard the history;
 *  - React state is derived from canvas events (`selection.changed`,
 *    `commandStack.changed`, `aris.document.changed`), never the other way
 *    round. The document is the single source of truth, exactly as the command
 *    bridge requires.
 *
 * Booting is deferred until the tab is first shown: diagram-js measures its
 * container, and a hidden tab panel measures 0×0.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import 'diagram-js/assets/diagram-js.css'
import 'diagram-js-minimap/assets/diagram-js-minimap.css'
import './shell.css'

import { ArisCanvas } from '../canvas/ArisCanvas'
import { ARIS_DOCUMENT_CHANGED } from '../canvas/commandBridge'
import { arisBusinessObject, type ArisBusinessObject } from '../canvas/elements'
import type { ArisHighlightPlan } from '../canvas/highlight'
import type EventBus from 'diagram-js/lib/core/EventBus'
import type { Element } from 'diagram-js/lib/model/Types'

import type { ArisDetailsElement } from '../details/seam'
import type { ArisWorkingDocument } from '../model/types'
import { installPaletteDrag } from './arisPaletteDrag'

export interface ArisCanvasSelectionState {
  /** The selected element projected into the Phase 10 details vocabulary. */
  readonly detailsElement: ArisDetailsElement | null
  /** The raw canvas business object, for labels and diagnostics. */
  readonly businessObject: ArisBusinessObject | null
  readonly highlight: ArisHighlightPlan | null
  readonly selectedIds: readonly string[]
}

export interface ArisCanvasHistoryState {
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly revision: number
  readonly commandCount: number
  /**
   * The document the canvas currently holds. Published with every history
   * change so rails derive from the live document without reaching into the
   * canvas imperatively.
   */
  readonly document: ArisWorkingDocument | null
}

export interface ArisCanvasViewProps {
  /** The working document to edit. Changing it re-boots the canvas. */
  readonly document: ArisWorkingDocument
  /** The model to render. Changing it switches models in place. */
  readonly modelId: string
  /** Boot is deferred until this is first `true`. */
  readonly active: boolean
  readonly minimap?: boolean
  readonly ariaLabel: string
  readonly onReady?: (canvas: ArisCanvas) => void
  readonly onSelectionChange?: (state: ArisCanvasSelectionState) => void
  readonly onHistoryChange?: (state: ArisCanvasHistoryState) => void
  readonly onError?: (error: unknown) => void
}

/** Project a diagram-js selection into the details layer's element vocabulary. */
export function detailsElementFor(
  businessObject: ArisBusinessObject | null
): ArisDetailsElement | null {
  if (!businessObject) return null
  switch (businessObject.kind) {
    case 'occurrence':
      return { kind: 'objectOccurrence', id: businessObject.occurrenceId }
    case 'connection':
      return { kind: 'connectionOccurrence', id: businessObject.connectionOccurrenceId }
    case 'label':
      // Section 11.5: an external label resolves to the occurrence that owns it.
      return { kind: 'objectOccurrence', id: businessObject.ownerOccurrenceId }
    case 'model':
      return { kind: 'model', id: businessObject.modelId }
    default:
      return null
  }
}

const EMPTY_SELECTION: ArisCanvasSelectionState = Object.freeze({
  detailsElement: null,
  businessObject: null,
  highlight: null,
  selectedIds: Object.freeze([])
})

export function ArisCanvasView({
  document: workingDocument,
  modelId,
  active,
  minimap = true,
  ariaLabel,
  onReady,
  onSelectionChange,
  onHistoryChange,
  onError
}: ArisCanvasViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<ArisCanvas | null>(null)
  const initialModelIdRef = useRef(modelId)
  const [bootGeneration, setBootGeneration] = useState(0)

  // Callbacks are read through a ref so a new inline handler never re-boots the
  // canvas (which would drop the command stack).
  const handlersRef = useRef({ onReady, onSelectionChange, onHistoryChange, onError })
  useEffect(() => {
    handlersRef.current = { onReady, onSelectionChange, onHistoryChange, onError }
  })

  // `active` gates the first boot only; once booted the canvas stays alive so
  // switching tabs never loses history.
  const [everActive, setEverActive] = useState(active)
  useEffect(() => {
    if (active) setEverActive(true)
  }, [active])

  const publish = useCallback((canvas: ArisCanvas) => {
    const selected = canvas.selection.get() as Element[]
    const businessObject = selected.length === 1 ? arisBusinessObject(selected[0]) : null
    handlersRef.current.onSelectionChange?.({
      detailsElement: detailsElementFor(businessObject),
      businessObject,
      highlight: canvas.currentHighlight(),
      selectedIds: selected.map((element) => element.id)
    })
    handlersRef.current.onHistoryChange?.({
      canUndo: canvas.canUndo,
      canRedo: canvas.canRedo,
      revision: canvas.document.revision,
      commandCount: canvas.commandLog.length,
      document: canvas.document
    })
  }, [])

  useEffect(() => {
    if (!everActive) return
    const container = containerRef.current
    if (!container) return

    let canvas: ArisCanvas
    try {
      canvas = ArisCanvas.create({
        container,
        document: workingDocument,
        modelId: initialModelIdRef.current,
        minimap
      })
    } catch (error) {
      handlersRef.current.onError?.(error)
      return
    }

    canvasRef.current = canvas
    const eventBus = canvas.get<EventBus>('eventBus')
    const republish = (): void => publish(canvas)
    eventBus.on(['selection.changed', 'elements.changed', ARIS_DOCUMENT_CHANGED], republish)
    eventBus.on('commandStack.changed', republish)

    handlersRef.current.onReady?.(canvas)
    const uninstallDrag = installPaletteDrag(container)
    republish()
    setBootGeneration((current) => current + 1)

    return () => {
      eventBus.off(['selection.changed', 'elements.changed', ARIS_DOCUMENT_CHANGED], republish)
      eventBus.off('commandStack.changed', republish)
      uninstallDrag()
      canvasRef.current = null
      handlersRef.current.onSelectionChange?.(EMPTY_SELECTION)
      canvas.destroy()
    }
  }, [everActive, minimap, publish, workingDocument])

  // A model switch is an in-place rebuild through the store + bridge, so the
  // command stack and the highlight overlay both follow it.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (canvas.activeModelId === modelId) return
    if (!canvas.document.models.has(modelId)) return
    try {
      canvas.setActiveModel(modelId)
    } catch (error) {
      handlersRef.current.onError?.(error)
    }
  }, [bootGeneration, modelId])

  // jsdom and hidden panels both report 0×0; only fit when there is a viewport.
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !active) return
    canvas.canvas.resized()
  }, [active, bootGeneration, modelId])

  return (
    <div
      ref={containerRef}
      className="orbitpm-aris-canvas"
      role="application"
      aria-label={ariaLabel}
      data-orbitpm-aris-canvas=""
    />
  )
}

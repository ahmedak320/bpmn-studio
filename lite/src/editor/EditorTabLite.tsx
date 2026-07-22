// Ported from the desktop app's EditorTab (src/renderer/src/editor/EditorTab.tsx).
// The component shell is copied here — not imported — because it is the one
// reused React file that pulls in bpmn-js, and (a) resolving bpmn-js's nested
// bpmn-moddle correctly requires the import to originate from lite/src, and
// (b) the desktop file carries a latent canvas-type annotation that only a real
// typecheck (which the desktop repo never runs) surfaces. Everything else — the
// dirty-state machine, the call-activity inspection, the SVG/PNG export helpers
// and the editor CSS — is REUSED verbatim by direct import from the desktop
// tree, so this file stays a thin shell around shared logic.

import { useCallback, useEffect, useRef, useState } from 'react'
import BpmnModeler from 'bpmn-js/lib/Modeler'
import {
  BpmnPropertiesPanelModule,
  BpmnPropertiesProviderModule
} from 'bpmn-js-properties-panel'
import { CreateAppendAnythingModule } from 'bpmn-js-create-append-anything'
// eslint-disable-next-line import/no-named-as-default
import minimapModule from 'diagram-js-minimap'

import 'bpmn-js/dist/assets/diagram-js.css'
import 'bpmn-js/dist/assets/bpmn-js.css'
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css'
import '@bpmn-io/properties-panel/dist/assets/properties-panel.css'
import 'diagram-js-minimap/assets/diagram-js-minimap.css'

// Reused, unchanged, from the desktop app:
import '@app/renderer/src/editor/EditorTab.css'
import {
  createDirtyState,
  withCommandStackChanged,
  withSaved,
  isDirty,
  type DirtyState
} from '@app/renderer/src/editor/dirty'
import {
  inspectCallActivityElement,
  shouldSuppressDefaultDblClick
} from '@app/renderer/src/editor/callActivity'
import {
  computeExportSize,
  svgToPngDataUrl,
  svgToDataUrl,
  triggerDownload,
  type CanvasLike
} from '@app/renderer/src/editor/exportImage'

export interface EditorTabProps {
  xml: string
  onDirtyChange: (dirty: boolean) => void
  onRequestSave: (xml: string) => Promise<void>
  onOpenCalledProcess?: (processId: string) => void
  exportFileBaseName?: string
  onModelerReady?: (modeler: unknown | null) => void
  toolbarExtra?: import('react').ReactNode
  onCommandsReady?: (commands: EditorTabCommands | null) => void
}

export interface EditorTabCommands {
  save: () => void
  exportSvg: () => void
  exportPng: () => void
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
}

interface ElementLike {
  type?: string
  labelTarget?: unknown
  waypoints?: unknown
}

interface ElementRegistryLike {
  getAll(): ElementLike[]
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
    exportFileBaseName,
    onModelerReady,
    toolbarExtra,
    onCommandsReady
  } = props
  const onModelerReadyRef = useRef(onModelerReady)
  onModelerReadyRef.current = onModelerReady

  const canvasContainerRef = useRef<HTMLDivElement | null>(null)
  const propertiesContainerRef = useRef<HTMLDivElement | null>(null)
  const modelerRef = useRef<BpmnModelerLike | null>(null)
  const dirtyStateRef = useRef<DirtyState>(createDirtyState(0))
  const onOpenCalledProcessRef = useRef(onOpenCalledProcess)
  onOpenCalledProcessRef.current = onOpenCalledProcess

  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // True right after importing a brand-new (empty / start-event-only) diagram —
  // drives the "drag from the palette" hint overlay. `hintDismissed` latches on
  // the first edit so the hint never comes back (e.g. it must NOT reappear after
  // a Save clears the dirty flag over a now-populated diagram).
  const [isNewDiagram, setIsNewDiagram] = useState(false)
  const [hintDismissed, setHintDismissed] = useState(false)

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
      additionalModules: [
        BpmnPropertiesPanelModule,
        BpmnPropertiesProviderModule,
        CreateAppendAnythingModule,
        minimapModule
      ]
    }) as unknown as BpmnModelerLike

    modelerRef.current = modeler
    onModelerReadyRef.current?.(modeler)

    const handleCommandStackChanged = (): void => {
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
      return undefined
    }

    const eventBus = modeler.get('eventBus')
    eventBus.on('commandStack.changed', 1000, handleCommandStackChanged)
    eventBus.on('element.dblclick', 1500, handleDblClick)

    return () => {
      eventBus.off('commandStack.changed', handleCommandStackChanged)
      eventBus.off('element.dblclick', handleDblClick)
      modeler.destroy()
      modelerRef.current = null
      onModelerReadyRef.current?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
          // eslint-disable-next-line no-console
          console.warn('BPMN import warnings:', warnings)
        }
        applyDirtyState(createDirtyState(getStackIndex(modeler)))
        modeler.get('canvas').zoom('fit-viewport')
        // Show the palette hint only for a freshly-created, near-empty diagram
        // (nothing but a start event), never when opening a real process file.
        setIsNewDiagram(countFlowNodeShapes(modeler.get('elementRegistry')) <= 1)
        setHintDismissed(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(`Failed to load diagram: ${errorMessage(err)}`)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xml])

  const handleSave = useCallback(async () => {
    const modeler = modelerRef.current
    if (!modeler || saving) return
    setSaving(true)
    setError(null)
    try {
      const { xml: savedXml } = await modeler.saveXML({ format: true })
      if (typeof savedXml !== 'string') {
        throw new Error('bpmn-js returned no XML to save')
      }
      await onRequestSave(savedXml)
      applyDirtyState(withSaved(dirtyStateRef.current))
    } catch (err) {
      setError(`Save failed: ${errorMessage(err)}`)
    } finally {
      setSaving(false)
    }
  }, [onRequestSave, applyDirtyState, saving])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const isSaveCombo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's'
      if (!isSaveCombo) return
      event.preventDefault()
      void handleSave()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave])

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
      setError(`SVG export failed: ${errorMessage(err)}`)
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
      setError(`PNG export failed: ${errorMessage(err)}`)
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

  useEffect(() => {
    onCommandsReady?.({
      save: () => void handleSave(),
      exportSvg: () => void handleExportSvg(),
      exportPng: () => void handleExportPng()
    })
    return () => onCommandsReady?.(null)
  }, [onCommandsReady, handleSave, handleExportSvg, handleExportPng])

  return (
    <div className="orbitpm-editor">
      <div className="orbitpm-editor__toolbar">
        <button
          type="button"
          className="orbitpm-editor__button orbitpm-editor__button--primary"
          onClick={() => void handleSave()}
          disabled={saving}
          title="Save (Ctrl+S)"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="orbitpm-editor__button"
          onClick={() => void handleExportSvg()}
          title="Download the diagram as an SVG vector image"
        >
          Export SVG
        </button>
        <button
          type="button"
          className="orbitpm-editor__button"
          onClick={() => void handleExportPng()}
          title="Download the diagram as a PNG image"
        >
          Export PNG
        </button>
        <button
          type="button"
          className="orbitpm-editor__button"
          onClick={() => zoomByFactor(1 / 1.15)}
          title="Zoom out"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          className="orbitpm-editor__button"
          onClick={() => zoomByFactor(1.15)}
          title="Zoom in"
          aria-label="Zoom in"
        >
          ＋
        </button>
        <button
          type="button"
          className="orbitpm-editor__button"
          onClick={handleZoomFit}
          title="Zoom to fit the whole diagram (or Ctrl + mouse-wheel to zoom)"
        >
          Zoom Fit
        </button>
        <span
          className={
            dirty
              ? 'orbitpm-editor__dirty-flag orbitpm-editor__dirty-flag--dirty'
              : 'orbitpm-editor__dirty-flag'
          }
          title={dirty ? 'This diagram has changes you have not saved yet' : 'All changes saved'}
        >
          {dirty ? '● Unsaved changes' : 'Saved'}
        </span>
        {toolbarExtra}
      </div>
      {error ? <div className="orbitpm-editor__error">{error}</div> : null}
      <div className="orbitpm-editor__body">
        <div style={{ position: 'relative', flex: '1 1 auto', minWidth: 0, display: 'flex' }}>
          <div ref={canvasContainerRef} className="orbitpm-editor__canvas" />
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
                <strong style={{ color: 'var(--orbitpm-editor-fg)' }}>Start drawing</strong>
                <div style={{ marginTop: 4 }}>
                  Drag a shape from the palette on the left (or click one) to add it. Double-click
                  any element to rename it.
                </div>
              </div>
            </div>
          )}
        </div>
        <div ref={propertiesContainerRef} className="orbitpm-editor__properties" />
      </div>
    </div>
  )
}

export default EditorTab

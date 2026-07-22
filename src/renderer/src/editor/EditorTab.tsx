import { useCallback, useEffect, useRef, useState } from 'react'
import BpmnModeler from 'bpmn-js/lib/Modeler'
import {
  BpmnPropertiesPanelModule,
  BpmnPropertiesProviderModule
} from 'bpmn-js-properties-panel'
// NOTE: only the core CreateAppendAnythingModule is used. The package's
// CreateAppendElementTemplatesModule requires an `elementTemplates` service
// (from bpmn-js-element-templates), which this app does not configure —
// including it makes bpmn-js throw `No provider for "elementTemplates"!` on
// every modeler mount, crashing the editor. This app has no element templates.
import { CreateAppendAnythingModule } from 'bpmn-js-create-append-anything'
// eslint-disable-next-line import/no-named-as-default -- diagram-js-minimap's default export is the module descriptor
import minimapModule from 'diagram-js-minimap'

import 'bpmn-js/dist/assets/diagram-js.css'
import 'bpmn-js/dist/assets/bpmn-js.css'
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css'
import '@bpmn-io/properties-panel/dist/assets/properties-panel.css'
import 'diagram-js-minimap/assets/diagram-js-minimap.css'

import './EditorTab.css'
import { createDirtyState, withCommandStackChanged, withSaved, isDirty, DirtyState } from './dirty'
import { inspectCallActivityElement, shouldSuppressDefaultDblClick } from './callActivity'
import { computeExportSize, svgToPngDataUrl, svgToDataUrl, triggerDownload } from './exportImage'

export interface EditorTabProps {
  /** The BPMN 2.0 XML to load. Re-imported whenever this reference changes. */
  xml: string
  onDirtyChange: (dirty: boolean) => void
  onRequestSave: (xml: string) => Promise<void>
  /** Fired on double-click of a bpmn:CallActivity that has a calledElement set. */
  onOpenCalledProcess?: (processId: string) => void
  /** Base filename (no extension) used for SVG/PNG export downloads. */
  exportFileBaseName?: string
  /** Fired once the bpmn-js modeler instance exists (mount) and again with
   *  null on unmount. Lets a parent toolbar (e.g. SelectionLinkButton) read
   *  live selection/modeling state without EditorTab needing to know about
   *  it. Untyped (`unknown`) here deliberately — callers narrow to their
   *  own structural interface (see links/SelectionLinkButton.tsx). */
  onModelerReady?: (modeler: unknown | null) => void
  /** Extra controls rendered at the end of the toolbar (e.g. the
   *  call-activity link button) — kept as an opaque ReactNode so EditorTab
   *  itself never needs to know what's mounted there. */
  toolbarExtra?: import('react').ReactNode
  /** Fired (with the current imperative command set) whenever this tab's
   *  save/export handlers are (re)created, and with null on unmount. Lets a
   *  parent (App's native-menu command bus) trigger this tab's Save/Export
   *  without EditorTab needing to know about menus at all — every mounted
   *  tab reports its own commands; the parent picks whichever belongs to
   *  the currently-active tab. */
  onCommandsReady?: (commands: EditorTabCommands | null) => void
}

export interface EditorTabCommands {
  save: () => void
  exportSvg: () => void
  exportPng: () => void
}

// A minimal structural view of what we read off the live bpmn-js instance.
// Kept narrow (rather than importing bpmn-js's own loose `any`-heavy types)
// so this file stays honest about exactly what it depends on.
interface CommandStackLike {
  // diagram-js does not expose the stack index as a public API; this is the
  // same field bpmn-io's own example apps read for dirty-tracking/undo UI.
  _stackIdx: number
}

interface CanvasApiLike {
  zoom(mode: 'fit-viewport'): void
  viewbox(): { width: number; height: number }
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
  destroy(): void
  attachTo(container: HTMLElement): void
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

  const applyDirtyState = useCallback(
    (next: DirtyState) => {
      dirtyStateRef.current = next
      const nowDirty = isDirty(next)
      setDirty(nowDirty)
      onDirtyChange(nowDirty)
    },
    [onDirtyChange]
  )

  // Create the modeler once. Additional modules + dblclick hook are wired
  // here; the `xml` prop is (re)imported by the effect below.
  useEffect(() => {
    if (!canvasContainerRef.current || !propertiesContainerRef.current) return

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
        return false // swallow bpmn-js's default dblclick behavior for this element
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
    // Only re-run if the container nodes themselves are replaced; `xml`
    // changes are handled by the import effect below, not a full remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Import (or re-import) the diagram whenever `xml` changes.
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
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(`Failed to load diagram: ${errorMessage(err)}`)
      })

    return () => {
      cancelled = true
    }
    // Re-import whenever the `xml` prop changes. `modelerRef.current` is a
    // ref (not reactive) but is guaranteed set by the time this runs, since
    // the modeler-creation effect above is declared first and mount-time
    // effects run in declaration order.
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

  // Ctrl+S / Cmd+S save shortcut.
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
          return canvas
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

  // Report this tab's imperative commands (for the native-menu command bus)
  // whenever the underlying handlers change identity, and clear on unmount.
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
        >
          Export SVG
        </button>
        <button
          type="button"
          className="orbitpm-editor__button"
          onClick={() => void handleExportPng()}
        >
          Export PNG
        </button>
        <button type="button" className="orbitpm-editor__button" onClick={handleZoomFit}>
          Zoom Fit
        </button>
        <span
          className={
            dirty
              ? 'orbitpm-editor__dirty-flag orbitpm-editor__dirty-flag--dirty'
              : 'orbitpm-editor__dirty-flag'
          }
        >
          {dirty ? 'Unsaved changes' : 'Saved'}
        </span>
        {toolbarExtra}
      </div>
      {error ? <div className="orbitpm-editor__error">{error}</div> : null}
      <div className="orbitpm-editor__body">
        <div ref={canvasContainerRef} className="orbitpm-editor__canvas" />
        <div ref={propertiesContainerRef} className="orbitpm-editor__properties" />
      </div>
    </div>
  )
}

export default EditorTab

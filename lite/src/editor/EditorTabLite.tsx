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
        <button type="button" className="orbitpm-editor__button" onClick={() => void handleExportSvg()}>
          Export SVG
        </button>
        <button type="button" className="orbitpm-editor__button" onClick={() => void handleExportPng()}>
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

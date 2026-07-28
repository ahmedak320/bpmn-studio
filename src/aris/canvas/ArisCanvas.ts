/**
 * `ArisCanvas` — the public facade over the diagram-js instance.
 *
 * Callers get one object exposing the Section 11.1 services, the Section 11.4
 * authoring API, the Section 11.5 highlight overlay, and undo/redo. The
 * underlying injector stays reachable through `get()` for anything the facade
 * does not wrap.
 *
 * ## Undo/redo has exactly one path
 *
 * `undo()` and `redo()` delegate to diagram-js's command stack, whose only
 * registered handler is the ARIS gesture handler. A keyboard shortcut, an
 * `editorActions` trigger, `commandStack.undo()` and `ArisCanvas.undo()`
 * therefore all run the same code — see `commandBridge.ts`.
 */

import Diagram from 'diagram-js'
import type Canvas from 'diagram-js/lib/core/Canvas'
import type CommandStack from 'diagram-js/lib/command/CommandStack'
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry'
import type EventBus from 'diagram-js/lib/core/EventBus'
import type Selection from 'diagram-js/lib/features/selection/Selection'
import type { Element } from 'diagram-js/lib/model/Types'

import type { ArisEditCommand } from '../model/commands'
import type { SerializedCommandStack } from '../model/serialize'
import type { ArisSupportedModelType, ArisWorkingDocument } from '../model/types'
import { ArisAuthoring } from './authoring'
import { ArisCanvasSync } from './canvasSync'
import { ArisClipboard } from './clipboard'
import { ArisCommandBridge } from './commandBridge'
import { ArisDocumentStore } from './documentStore'
import { ArisModeling } from './arisModeling'
import { ArisPaletteProvider } from './paletteProvider'
import { ArisSearchProvider } from './searchProvider'
import { ArisSelectionHighlight, type ArisHighlightPlan } from './highlight'
import { applyCleanLayout, type ArisCleanLayoutEngine } from './layoutSeam'
import { ARIS_DIAGRAM_JS_MODULES, ArisCanvasModule, ArisMinimapModule, type DiagramModuleDeclaration } from './modules'
import { createEmptyArisCanvasDocument } from './emptyDocument'
import { isSupportedModelType } from './vocabulary'

export interface ArisCanvasOptions {
  /** DOM node the canvas renders into. */
  readonly container: HTMLElement
  /** The working document to edit. Defaults to a fresh single-model document. */
  readonly document?: ArisWorkingDocument
  /** The model rendered first. Defaults to the document's first model. */
  readonly modelId?: string
  /** Prefix for generated ARIS ids, so sibling canvases cannot collide. */
  readonly idNamespace?: string
  /** Include `diagram-js-minimap`. Default `true`. */
  readonly minimap?: boolean
  /** Extra diagram-js modules (e.g. test doubles). */
  readonly additionalModules?: readonly DiagramModuleDeclaration[]
}

export class ArisCanvas {
  private readonly diagram: Diagram

  private constructor(diagram: Diagram) {
    this.diagram = diagram
  }

  /** Boot a canvas. The first `sync()` renders the active model. */
  static create(options: ArisCanvasOptions): ArisCanvas {
    const fallback = createEmptyArisCanvasDocument()
    const document = options.document ?? fallback.document
    const modelId = options.modelId ?? [...document.models.keys()][0]
    if (modelId === undefined) {
      throw new Error('An ARIS canvas needs a document with at least one model.')
    }
    const model = document.models.get(modelId)
    if (!model) throw new Error(`Unknown model ${modelId}.`)
    if (!isSupportedModelType(model.type)) {
      throw new Error(`Model type ${model.type} is outside the Section 11.2 scope.`)
    }

    const modules: DiagramModuleDeclaration[] = [
      ...ARIS_DIAGRAM_JS_MODULES,
      ...(options.minimap === false ? [] : [ArisMinimapModule]),
      ArisCanvasModule,
      ...(options.additionalModules ?? [])
    ]

    const diagram = new Diagram({
      modules,
      canvas: { container: options.container },
      aris: {
        document,
        activeModelId: modelId,
        idNamespace: options.idNamespace ?? ''
      }
    })

    const canvas = new ArisCanvas(diagram)
    canvas.bridge.refresh('boot')
    return canvas
  }

  // -- services --------------------------------------------------------------

  get<T>(name: string): T {
    return this.diagram.get<T>(name)
  }

  get store(): ArisDocumentStore {
    return this.get<ArisDocumentStore>('arisDocumentStore')
  }

  get bridge(): ArisCommandBridge {
    return this.get<ArisCommandBridge>('arisCommandBridge')
  }

  get sync(): ArisCanvasSync {
    return this.get<ArisCanvasSync>('arisCanvasSync')
  }

  get authoring(): ArisAuthoring {
    return this.get<ArisAuthoring>('arisAuthoring')
  }

  get modeling(): ArisModeling {
    return this.get<ArisModeling>('modeling')
  }

  get clipboard(): ArisClipboard {
    return this.get<ArisClipboard>('arisClipboard')
  }

  get highlight(): ArisSelectionHighlight {
    return this.get<ArisSelectionHighlight>('arisSelectionHighlight')
  }

  get search(): ArisSearchProvider {
    return this.get<ArisSearchProvider>('arisSearchProvider')
  }

  get palette(): ArisPaletteProvider {
    return this.get<ArisPaletteProvider>('arisPaletteProvider')
  }

  get elementRegistry(): ElementRegistry {
    return this.get<ElementRegistry>('elementRegistry')
  }

  get selection(): Selection {
    return this.get<Selection>('selection')
  }

  get canvas(): Canvas {
    return this.get<Canvas>('canvas')
  }

  get eventBus(): EventBus {
    return this.get<EventBus>('eventBus')
  }

  get commandStack(): CommandStack {
    return this.get<CommandStack>('commandStack')
  }

  // -- document --------------------------------------------------------------

  get document(): ArisWorkingDocument {
    return this.store.document
  }

  get activeModelId(): string {
    return this.store.activeModelId
  }

  get activeModelType(): ArisSupportedModelType | string {
    return this.document.models.get(this.activeModelId)?.type ?? 'MT_EEPC'
  }

  /** Every ARIS command recorded so far, oldest first (Section 11.6 export). */
  get commandLog(): readonly ArisEditCommand[] {
    return this.store.undoStack
  }

  serialize(): SerializedCommandStack {
    return this.store.serialize()
  }

  /** Switch the rendered model and rebuild the canvas. */
  setActiveModel(modelId: string): void {
    this.store.setActiveModelId(modelId)
    this.selection.select([])
    this.bridge.refresh('model-switch')
  }

  // -- history ---------------------------------------------------------------

  undo(): void {
    this.bridge.undo()
  }

  redo(): void {
    this.bridge.redo()
  }

  get canUndo(): boolean {
    return this.bridge.canUndo
  }

  get canRedo(): boolean {
    return this.bridge.canRedo
  }

  // -- view ------------------------------------------------------------------

  zoom(level: number | 'fit-viewport'): number {
    return this.canvas.zoom(level)
  }

  fit(): number {
    return this.canvas.zoom('fit-viewport')
  }

  scroll(delta: { readonly dx: number; readonly dy: number }): void {
    this.canvas.scroll(delta)
  }

  select(elementOrId: Element | string | null): void {
    if (elementOrId === null) {
      this.selection.select([])
      return
    }
    const element =
      typeof elementOrId === 'string' ? (this.elementRegistry.get(elementOrId) as Element | undefined) : elementOrId
    this.selection.select(element ?? [])
  }

  currentHighlight(): ArisHighlightPlan {
    return this.highlight.currentPlan
  }

  /** Apply a clean layout produced by `src/aris/layout` (see `layoutSeam.ts`). */
  applyCleanLayout(engine: ArisCleanLayoutEngine): void {
    applyCleanLayout(this.bridge, this.store, engine)
  }

  destroy(): void {
    this.diagram.destroy()
  }
}

/**
 * diagram-js module wiring for the ARIS canvas.
 *
 * ## What is reused vs. what is ours
 *
 * Reused from diagram-js verbatim (Section 11.1 services):
 * core (canvas, element registry, element factory, event bus, graphics
 * factory), command stack, change-support, selection + outline,
 * interaction-events, dragging, move, resize, bendpoints, connect,
 * connection-preview, create, clipboard, align-elements, distribute-elements,
 * keyboard + keyboard-bindings, keyboard-move-selection, editor-actions,
 * context-pad, palette, overlays, search, rules, snapping + grid-snapping,
 * hand-tool, lasso-tool, tool-manager, zoomscroll, movecanvas, keyboard-move,
 * and `diagram-js-minimap` for the minimap.
 *
 * Ours, because no BPMN-free diagram-js equivalent exists:
 * `modeling` (replaced wholesale so gestures become ARIS commands), the ARIS
 * document store and command bridge, canvas↔document reconciliation, the
 * symbol-registry renderer, ARIS rules, palette/context-pad providers, the
 * Section 11.5 highlight overlay, identity-aware copy/paste, attachments, and
 * the authoring API.
 *
 * **`modeling` is deliberately re-registered.** diagram-js's own
 * `features/modeling` module is *not* included; `move`, `resize`, `connect`,
 * `bendpoints`, `create`, `align-elements` and `distribute-elements` only
 * depend on the injected *name* `modeling`, so registering `ArisModeling` under
 * that name captures every stock gesture at one seam. `layouter` is still
 * provided (diagram-js's `BaseLayouter`) because `connection-preview` optionally
 * asks for it.
 */

import CommandModule from 'diagram-js/lib/command'
import ChangeSupportModule from 'diagram-js/lib/features/change-support'
import SelectionModule from 'diagram-js/lib/features/selection'
import OutlineModule from 'diagram-js/lib/features/outline'
import InteractionEventsModule from 'diagram-js/lib/features/interaction-events'
import DraggingModule from 'diagram-js/lib/features/dragging'
import MoveModule from 'diagram-js/lib/features/move'
import ResizeModule from 'diagram-js/lib/features/resize'
import BendpointsModule from 'diagram-js/lib/features/bendpoints'
import ConnectModule from 'diagram-js/lib/features/connect'
import ConnectionPreviewModule from 'diagram-js/lib/features/connection-preview'
import CreateModule from 'diagram-js/lib/features/create'
import ClipboardModule from 'diagram-js/lib/features/clipboard'
import AlignElementsModule from 'diagram-js/lib/features/align-elements'
import DistributeElementsModule from 'diagram-js/lib/features/distribute-elements'
import KeyboardModule from 'diagram-js/lib/features/keyboard'
import KeyboardMoveSelectionModule from 'diagram-js/lib/features/keyboard-move-selection'
import EditorActionsModule from 'diagram-js/lib/features/editor-actions'
import ContextPadModule from 'diagram-js/lib/features/context-pad'
import PaletteModule from 'diagram-js/lib/features/palette'
import OverlaysModule from 'diagram-js/lib/features/overlays'
import SearchModule from 'diagram-js/lib/features/search'
import RulesModule from 'diagram-js/lib/features/rules'
import SnappingModule from 'diagram-js/lib/features/snapping'
import GridSnappingModule from 'diagram-js/lib/features/grid-snapping'
import HandToolModule from 'diagram-js/lib/features/hand-tool'
import LassoToolModule from 'diagram-js/lib/features/lasso-tool'
import ToolManagerModule from 'diagram-js/lib/features/tool-manager'
import ZoomScrollModule from 'diagram-js/lib/navigation/zoomscroll'
import MoveCanvasModule from 'diagram-js/lib/navigation/movecanvas'
import KeyboardMoveModule from 'diagram-js/lib/navigation/keyboard-move'
import BaseLayouter from 'diagram-js/lib/layout/BaseLayouter'
import MinimapModule from 'diagram-js-minimap/dist/index.esm.js'
import DirectEditingModule from 'diagram-js-direct-editing'

import { ArisAuthoring } from './authoring'
import { ArisDirectEditingProvider } from './directEdit'
import { ArisCanvasSync } from './canvasSync'
import { ArisClipboard } from './clipboard'
import { ArisCommandBridge } from './commandBridge'
import { ArisContextPadProvider } from './contextPadProvider'
import { ArisDocumentStore } from './documentStore'
import { ArisModeling } from './arisModeling'
import { ArisPaletteProvider } from './paletteProvider'
import { ArisQuickPick } from './quickPick'
import { ArisRenderer } from './renderer'
import { ArisRules } from './arisRules'
import { ArisSearchProvider } from './searchProvider'
import { ArisSelectionHighlight } from './highlight'

/**
 * Structural stand-in for didi's `ModuleDeclaration`.
 *
 * `didi` is a transitive dependency of diagram-js, not a declared dependency of
 * this app, so its types are not imported directly.
 */
export type DiagramModuleDeclaration = Record<string, unknown>

/** The ARIS-specific services. */
export const ArisCanvasModule: DiagramModuleDeclaration = {
  __init__: [
    'arisDocumentStore',
    'arisCanvasSync',
    'arisCommandBridge',
    'modeling',
    'arisRenderer',
    'arisRules',
    'arisPaletteProvider',
    'arisQuickPick',
    'arisContextPadProvider',
    'arisSelectionHighlight',
    'arisClipboard',
    'arisAuthoring',
    'arisSearchProvider',
    'arisDirectEditingProvider'
  ],
  arisDocumentStore: ['type', ArisDocumentStore],
  arisCanvasSync: ['type', ArisCanvasSync],
  arisCommandBridge: ['type', ArisCommandBridge],
  // Registered under diagram-js's own service name — see the module header.
  modeling: ['type', ArisModeling],
  layouter: ['type', BaseLayouter],
  arisRenderer: ['type', ArisRenderer],
  arisRules: ['type', ArisRules],
  arisPaletteProvider: ['type', ArisPaletteProvider],
  arisQuickPick: ['type', ArisQuickPick],
  arisContextPadProvider: ['type', ArisContextPadProvider],
  arisSelectionHighlight: ['type', ArisSelectionHighlight],
  arisClipboard: ['type', ArisClipboard],
  arisAuthoring: ['type', ArisAuthoring],
  arisSearchProvider: ['type', ArisSearchProvider],
  arisDirectEditingProvider: ['type', ArisDirectEditingProvider]
}

/** diagram-js modules the canvas depends on, in load order. */
export const ARIS_DIAGRAM_JS_MODULES: readonly DiagramModuleDeclaration[] = Object.freeze([
  CommandModule as DiagramModuleDeclaration,
  ChangeSupportModule as DiagramModuleDeclaration,
  InteractionEventsModule as DiagramModuleDeclaration,
  SelectionModule as DiagramModuleDeclaration,
  OutlineModule as DiagramModuleDeclaration,
  RulesModule as DiagramModuleDeclaration,
  DraggingModule as DiagramModuleDeclaration,
  ToolManagerModule as DiagramModuleDeclaration,
  MoveModule as DiagramModuleDeclaration,
  ResizeModule as DiagramModuleDeclaration,
  BendpointsModule as DiagramModuleDeclaration,
  ConnectionPreviewModule as DiagramModuleDeclaration,
  ConnectModule as DiagramModuleDeclaration,
  CreateModule as DiagramModuleDeclaration,
  ClipboardModule as DiagramModuleDeclaration,
  AlignElementsModule as DiagramModuleDeclaration,
  DistributeElementsModule as DiagramModuleDeclaration,
  SnappingModule as DiagramModuleDeclaration,
  GridSnappingModule as DiagramModuleDeclaration,
  HandToolModule as DiagramModuleDeclaration,
  LassoToolModule as DiagramModuleDeclaration,
  OverlaysModule as DiagramModuleDeclaration,
  ContextPadModule as DiagramModuleDeclaration,
  PaletteModule as DiagramModuleDeclaration,
  SearchModule as DiagramModuleDeclaration,
  KeyboardModule as DiagramModuleDeclaration,
  KeyboardMoveSelectionModule as DiagramModuleDeclaration,
  KeyboardMoveModule as DiagramModuleDeclaration,
  EditorActionsModule as DiagramModuleDeclaration,
  ZoomScrollModule as DiagramModuleDeclaration,
  MoveCanvasModule as DiagramModuleDeclaration,
  // Provides the `directEditing` service the ARIS inline label editor drives
  // (Lane C3); the ARIS provider itself is registered in `ArisCanvasModule`.
  DirectEditingModule as DiagramModuleDeclaration
])

/** The optional minimap (Section 11.1). BPMN-free; kept separate so it can be omitted. */
export const ArisMinimapModule = MinimapModule as DiagramModuleDeclaration

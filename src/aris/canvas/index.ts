/**
 * Public surface of the ARIS canvas — Plan Section 11.
 *
 * Nothing in this directory imports any of the BPMN packages Section 5.4 bans
 * (the BPMN modeler, its moddle, its auto-layout, its linter, its properties
 * panel, its create/append modules, or a BPMN icon font). The only vendor
 * packages in the graph are generic `diagram-js` and `diagram-js-minimap`, both
 * of which Section 5.4 explicitly retains.
 */

export { ArisCanvas, type ArisCanvasOptions } from './ArisCanvas'
export {
  ArisAuthoring,
  type CreateObjectOptions,
  type CreateObjectResult,
  type DeleteDefinitionRequest
} from './authoring'
export {
  ArisCanvasSync,
  externalNamePlacement,
  externalNameRect,
  freeTextBounds,
  FREE_TEXT_DEFAULT_HEIGHT,
  FREE_TEXT_DEFAULT_WIDTH,
  LANE_DEFAULT_THICKNESS,
  LANE_FALLBACK_LENGTH,
  laneBandBounds,
  laneOrientation,
  modelContentBounds,
  type ArisLaneOrientation,
  type ArisRect
} from './canvasSync'
export {
  ARIS_FIT_PADDING_RATIO,
  ARIS_MAX_FIT_SCALE,
  arisContentBounds,
  arisFitViewbox,
  fitCanvasToContent,
  isArisContentElement,
  type ArisFitRect,
  type ArisFitSize
} from './fitView'
export {
  ArisClipboard,
  type ArisClipboardContent,
  type ArisPasteIdentityMode,
  type ArisPasteResult
} from './clipboard'
export {
  ARIS_DOCUMENT_CHANGED,
  ARIS_GESTURE_COMMAND,
  ArisCanvasCommandError,
  ArisCommandBridge
} from './commandBridge'
export { ArisDocumentStore, type ArisCommandThunk, type ArisPlannedGesture } from './documentStore'
export {
  ArisModeling,
  ArisUnsupportedOperationError,
  findConnectionDefinitionId
} from './arisModeling'
export { ArisRenderer } from './renderer'
export { ArisRules } from './arisRules'
export { ArisPaletteProvider } from './paletteProvider'
export { ArisContextPadProvider } from './contextPadProvider'
export { ArisSearchProvider, type ArisSearchResult } from './searchProvider'
export {
  ARIS_HIGHLIGHT_COLOR_PREFIX,
  ARIS_HIGHLIGHT_COLOR_SLOTS,
  ARIS_HIGHLIGHT_DASHED_MARKER,
  ARIS_HIGHLIGHT_MARKER,
  ARIS_HIGHLIGHT_OWNER_MARKER,
  ArisSelectionHighlight,
  computeHighlightPlan,
  type ArisHighlightPlan,
  type ArisHighlightRelation,
  type ArisHighlightRole
} from './highlight'
export {
  base64ToBytes,
  bytesToBase64,
  downloadAttachment,
  listAttachments,
  type ArisAttachment,
  type ArisAttachmentDownload
} from './attachments'
export {
  applyCleanLayout,
  buildLayoutGraph,
  type ArisCleanLayoutEngine,
  type ArisLayoutSeamGraph,
  type ArisLayoutSeamResult
} from './layoutSeam'
export {
  ARIS_CANVAS_MODEL_TYPES,
  ARIS_CANVAS_OBJECT_TYPES,
  ARIS_FALLBACK_CONNECTION_TYPE,
  ARIS_RULE_SYMBOLS,
  ARIS_SATELLITE_OBJECT_TYPES,
  AT_NAME,
  AT_ORBITPM_ATTACHMENT,
  isSatelliteObjectType,
  isSupportedModelType,
  isSupportedObjectType,
  resolveConnectionType,
  ruleOperatorOfSymbol,
  type ArisRuleOperator
} from './vocabulary'
export {
  createEmptyArisCanvasDocument,
  createEmptyArisDocument,
  createEmptyArisModel,
  DEFAULT_LOCALE_ID,
  EMPTY_ARIS_SOURCE_INDEX,
  localizedValue,
  withAdditionalModel
} from './emptyDocument'
export {
  assertCanonicalNumbers,
  ArisGeometryError,
  toCanonicalBounds,
  toCanonicalNumber,
  toCanonicalPoint,
  toCanonicalRoute
} from './geometry'
export { createArisIdFactory, seedIdFactory, type ArisIdFactory, type ArisIdKind } from './ids'
export {
  arisBusinessObject,
  isConnectionElement,
  isLabelElement,
  isModelRootElement,
  isOccurrenceElement,
  labelElementId,
  resolveOwnerOccurrenceId,
  rootElementId,
  type ArisBusinessObject
} from './elements'
export { ARIS_DIAGRAM_JS_MODULES, ArisCanvasModule, ArisMinimapModule } from './modules'
export { connectionWaypoints, dockPoint, selfLoopWaypoints } from './waypoints'

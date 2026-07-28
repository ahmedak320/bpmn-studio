/**
 * The React shell that mounts the ARIS subsystems into the application.
 *
 * Everything here is composition: no ARIS semantics are implemented in this
 * directory, only the wiring between `src/ArisApp.tsx` and the twelve lanes
 * under `src/aris/*`.
 */

export { ArisAccountingRail, type ArisAccountingRailProps } from './ArisAccountingRail'
export {
  ArisCanvasView,
  detailsElementFor,
  type ArisCanvasHistoryState,
  type ArisCanvasSelectionState,
  type ArisCanvasViewProps
} from './ArisCanvasView'
export { ArisDetailsRail, type ArisDetailsRailProps } from './ArisDetailsRail'
export { ArisImportReviewDialog, type ArisImportReviewDialogProps } from './ArisImportReviewDialog'
export { ArisModelExplorer, type ArisModelExplorerProps } from './ArisModelExplorer'
export {
  ArisStudioTab,
  type ArisLayoutModeState,
  type ArisSourceFact,
  type ArisStudioTabProps
} from './ArisStudioTab'
export {
  arisText,
  buildArisDetailsDocument,
  buildArisStudioDocument,
  type ArisStudioDocument,
  type ArisStudioModelSummary
} from './arisStudioDocument'
export {
  commitArisWorkspaceImport,
  prepareArisWorkspaceImport,
  type ArisImportResult,
  type ArisPreparedImport
} from './arisPackageImport'
export { ARIS_SHELL_MESSAGE_KEYS, tk } from './shellI18n'

/**
 * The React shell that mounts the ARIS subsystems into the application.
 *
 * Everything here is composition: no ARIS semantics are implemented in this
 * directory, only the wiring between `src/ArisApp.tsx` and the twelve lanes
 * under `src/aris/*`.
 */

export { ArisAccountingRail, type ArisAccountingRailProps } from './ArisAccountingRail'
export {
  ArisExplorerPane,
  type ArisExplorerActiveTab,
  type ArisExplorerPaneProps
} from './ArisExplorerPane'
export { ArisAssistantPanel, type ArisAssistantPanelProps } from './ArisAssistantPanel'
export { ArisChatImproveRail, type ArisChatImproveRailProps } from './ArisChatImproveRail'
export { ArisEpcRail, type ArisEpcRailProps } from './ArisEpcRail'
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
  type ArisSelectionRequest,
  type ArisSourceFact,
  type ArisStudioTabProps
} from './ArisStudioTab'
export {
  AssistantIndexCache,
  buildArisAssistantDigests,
  type ArisAssistantIndexMode,
  type ArisAssistantSourceInput
} from './arisAssistantDigests'
export {
  createArisChatApplyHost,
  createArisChatInterviewHost,
  scanArisGaps,
  toArisEditCommand,
  ArisChatUnsupportedCommandError,
  ARIS_CHAT_SUPPORTED_COMMAND_KINDS
} from './arisChatHost'
export {
  buildLocalArisPatchProposal,
  resolveOwnerKind,
  ARIS_CHAT_REMOVE_ANSWER,
  type ArisLocalProposalInput
} from './arisChatProposal'
export {
  buildArisDerivedEdits,
  derivedAmlFileName,
  exportArisDerivedAml,
  prepareArisDerivedExport,
  ARIS_DERIVED_UNMAPPED_KINDS,
  type ArisDerivedEditOptions,
  type ArisDerivedEditSet,
  type ArisDerivedExportInput,
  type ArisDerivedExportPreview,
  type ArisUnmappedEdit
} from './arisDerivedExport'
export {
  arisEpcFindingTargetId,
  buildArisEpcFindings,
  countArisEpcFindings,
  type ArisEpcModelFinding
} from './arisEpcFindings'
export {
  arisIdForWorkbookId,
  arisExcelIssueAddress,
  buildAmlFromArisWorkbook,
  isLegacyBpmnWorkbook,
  type ArisWorkbookAmlResult
} from './arisExcelCreate'
export { arisIdForLogicalId, buildAmlFromArisAiDraft, type ArisAiAmlResult } from './arisAiCreate'
export {
  checkArisAiAttachment,
  classifyArisAiAttachmentFile,
  encodeArisAiAttachment,
  extractArisAiDocxText,
  isArisAiDocxFile,
  ARIS_AI_PDF_MEDIA_TYPE,
  type ArisAiAttachmentAccepted,
  type ArisAiAttachmentCheck,
  type ArisAiAttachmentFileInfo,
  type ArisAiAttachmentKind,
  type ArisAiAttachmentRejected,
  type ArisAiAttachmentRejectionCode,
  type ArisAiDocxExtraction,
  type ArisAiDocxParser
} from './arisAiAttachments'
export {
  isArisAiCancellation,
  isArisAiTransportFailure,
  parseArisAiResponseJson,
  runArisAiGeneration,
  MAX_ARIS_AI_REPAIR_ECHO_CHARS,
  MAX_ARIS_AI_RESPONSE_CHARS,
  type ArisAiGenerationFailure,
  type ArisAiGenerationInput,
  type ArisAiGenerationMessage,
  type ArisAiGenerationRequest,
  type ArisAiGenerationResult,
  type ArisAiGenerationSuccess,
  type ArisAiSend
} from './arisAiGeneration'
export {
  arisAiRecoveryArtifact,
  arisAiRecoveryFileName,
  resolveArisAiPlacement,
  type ArisAiPlacementDecision,
  type ArisAiPlacementDiscardReason,
  type ArisAiPlacementInput,
  type ArisAiRecoveryArtifact
} from './arisAiPlacement'
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

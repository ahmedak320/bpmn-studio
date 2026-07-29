// lite/src/i18n/dictionaries.ts
// Placeholder-bearing values use `{name}` tokens — see i18n/index.ts `t()`.

export const en = {
  // --- App chrome ---
  'app.title': 'OrbitPM ARIS Studio Lite',
  'app.version.aria': 'Version {version}',
  'app.newProcess': '＋ New model',
  'app.newProcess.title': 'Create a new ARIS model placeholder',
  'app.changeFolder': 'Change folder…',
  'app.changeFolder.title': 'Open a different workspace folder',
  'app.openBpmn': 'Open ARIS file…',
  'app.openBpmn.title': 'Open an existing ARIS AML/XML file from disk',
  'app.showAi': '✨ AI',
  'app.showAi.title': 'Show the AI generation panel',
  'app.settings': '⚙ Settings',
  'app.settings.title': 'Settings — manage AI provider keys',
  'app.loading': 'Loading…',
  'app.home.title': 'Go to the process catalog',
  'app.home': '🏠 Home',
  'app.import.title': 'Import ARIS AML/XML files or folders',
  'app.import': 'Import',
  'app.lang.toggle.title': 'Switch the interface language to Arabic; diagram labels stay unchanged',
  'app.lang.control': 'Interface: {language}',
  'app.lang.en': 'EN',
  'app.lang.ar': 'العربية',
  'app.skipToMain': 'Skip to process workspace',
  'app.main.aria': 'Process workspace',
  'app.actions.aria': 'More application actions',

  // --- Sidebar rail toggle ---
  'sidebar.toggle.aria': 'Toggle side panel',
  'sidebar.hide.title': 'Hide the side panel',
  'sidebar.show.title': 'Show the side panel',
  'sidebar.explorer.aria': 'Workspace explorer and generation tools',
  'sidebar.close.aria': 'Close workspace explorer',

  // --- Sidebar: directory mode ---
  'tree.newProcess': '＋ New process',
  'tree.newProcess.title': 'Create a new process at the workspace root',
  'tree.newFolder.title': 'Create a new folder at the workspace root',
  'tree.newFolder.aria': 'New folder',
  'tree.search.placeholder': 'Search processes…',
  'tree.search.aria': 'Search processes',

  // --- Sidebar: fallback mode ---
  'fallback.singleFileNote':
    'Single-file mode — no folder is open. Open an ARIS AML/XML source or use the AI create panel.',
  'fallback.newProcess': '＋ New model',
  'fallback.newProcess.title': 'Create a new ARIS model placeholder',
  'fallback.openBpmnFile': 'Open an ARIS file…',
  'fallback.openBpmnFile.title': 'Open an existing ARIS AML/XML file from disk',
  'fallback.newBlank': 'New placeholder canvas',
  'fallback.newBlank.title': 'Start an empty ARIS placeholder canvas',

  // --- Empty-tab placeholder ---
  'emptyTab.directory':
    'Select a .bpmn file from the tree to open it, or press ＋ New process (top-right or in the sidebar) to start one. You can also generate a draft with AI.',
  'emptyTab.fallback':
    'Open an ARIS AML/XML source, or use Create with AI while the native ARIS canvas is being built.',
  'editor.loadingDiagram': 'Loading diagram…',

  // --- Tab strip ---
  'tab.closeTitle': 'Close',
  'tab.list.aria': 'Open process diagrams',
  'tab.dirty.aria': 'Unsaved changes',

  // --- Footer ---
  'footer.folderPrefix': '📁 {folderName}',
  'footer.singleFileMode': 'Single-file mode (saving downloads)',
  'footer.unresolvedLinks.one': '{count} unresolved link',
  'footer.unresolvedLinks.other': '{count} unresolved links',
  'footer.unresolvedLinks.title.directory':
    'Click to create the missing linked process "{calledElement}"',
  'footer.unresolvedLinks.title.fallback':
    'Call activities linked to a process id not found in this workspace',
  'footer.tagline': 'Zero-install · ARIS-focused · runs in your browser',

  // --- Dialogs (promptText call sites) ---
  'dialog.createMissingProcess.title': 'Create linked process',
  'dialog.createMissingProcess.label': 'Process name',
  'dialog.createMissingProcess.okLabel': 'Create & open',
  'dialog.createMissingProcess.hint':
    'Creates a new .bpmn whose process id is "{calledElementId}", so this call activity resolves.',
  'dialog.newProcess.title': 'New Process',
  'dialog.newProcess.label': 'Process name',
  'dialog.newProcess.initialValue': 'New Process',
  'dialog.newProcess.okLabel': 'Create',
  'dialog.newProcess.hint.directory':
    'A .bpmn file with a start event is created; other processes can link to it.',
  'dialog.newProcess.hint.fallback': 'No folder is open, so Save will download the .bpmn file.',
  'dialog.newFolder.title': 'New Folder',
  'dialog.newFolder.label': 'Folder name',
  'dialog.newFolder.initialValue': 'New Folder',
  'dialog.newFolder.okLabel': 'Create',
  'dialog.rename.title': 'Rename',
  'dialog.rename.label': 'New name',
  'dialog.rename.okLabel': 'Rename',
  'dialog.moveTo.title': 'Move "{name}"',
  'dialog.moveTo.okLabel': 'Move here',
  'dialog.moveTo.cancel': 'Cancel',
  'dialog.moveTo.noFolders': 'There is no other folder to move this into. Create a folder first.',
  'dialog.moveTo.destination': 'Destination folder',

  // --- alert()/confirm() strings ---
  'alert.openFileFailed': 'Could not open {relPath}: {error}',
  'alert.createMissingProcessNoFolder':
    'Process "{calledElementId}" doesn’t exist yet. Open a folder to create and link processes.',
  'alert.createProcessFailed': 'Could not create process: {error}',
  'alert.noProcessWithId':
    'No process with id "{processId}" in this workspace — link a different process or open a folder to create it.',
  'alert.createFolderFailed': 'Could not create folder: {error}',
  'alert.renameFailed': 'Could not rename: {error}',
  'alert.deleteFailed': 'Could not delete: {error}',
  'alert.moveFailed': 'Could not move: {error}',
  'alert.importFailed': 'Could not import {name}: {error}',
  'confirm.discardUnsaved.title': 'Discard unsaved changes?',
  'confirm.discardUnsaved': 'Discard unsaved changes to {title}?',
  'confirm.discardUnsaved.confirm': 'Discard and close',
  'confirm.deleteNode': 'Delete "{name}"? This cannot be undone.',
  'confirm.deleteFolder.notEmptyBody':
    'is not empty. Deleting it removes the folder and everything inside it. This cannot be undone.',
  'confirm.deleteFolder.typeNameLabel': 'Type the folder name "{name}" to confirm deletion',
  'alert.permissionNotGranted.open': 'Permission to read/write the folder was not granted.',
  'alert.permissionNotGranted.reconnect':
    'Permission was not granted. Try opening the folder again.',
  'alert.picker.security':
    'The browser blocked folder access for security reasons. Try a folder inside your user profile (for example, Documents), or use a browser workspace or a single ARIS AML/XML file.',
  'alert.picker.notAllowed':
    'The browser did not allow folder access. Check this site’s file-system permission in your browser settings, then retry or use a browser workspace or a single ARIS AML/XML file.',
  'alert.picker.unknown':
    'Could not open the folder. Try again, or use a browser workspace or open a single ARIS AML/XML file.',

  // --- WorkspacePickerLite ---
  'picker.title': 'OrbitPM ARIS Studio Lite',
  'picker.subtitle':
    'Open ARIS AML/XML exports, review exact source evidence, and prepare ARIS-native workspace flows — all in your browser, nothing to install.',
  'picker.open.button': 'Open a folder…',
  'picker.open.button.busy': 'Opening…',
  'picker.open.hint':
    'Choose a folder on your computer to browse ARIS AML/XML sources. The browser asks permission the first time and remembers the folder for next time.',
  'picker.reconnect.button': 'Reconnect to "{rememberedName}"',
  'picker.reconnect.button.busy': 'Reconnecting…',
  'picker.reconnect.button.fallbackName': 'your folder',
  'picker.reconnect.openDifferent': 'Open a different folder…',
  'picker.reconnect.hint':
    'Your browser needs you to re-grant read/write access to this folder for this session.',
  'picker.fallback.banner':
    "This browser doesn't allow opening a folder (the File System Access API is unavailable or disabled by policy). Use a browser workspace for local multi-file storage, or open a single ARIS AML/XML file. Microsoft Edge or Google Chrome can provide direct folder access.",
  'picker.fallback.newProcess': '＋ New model',
  'picker.fallback.openFile': 'Open an ARIS file…',
  'picker.fallback.newDiagram': 'New placeholder canvas',

  // --- EmptyWorkspaceCard ---
  'emptyWorkspace.heading': 'No models yet',
  'emptyWorkspace.createFirst': '＋ Create your first model',
  'emptyWorkspace.explain':
    'Create a blank EPC or value-added chain model in {folderName}, or import ARIS AML/XML exports.',
  'emptyWorkspace.explain.fallbackFolderName': 'this folder',

  // --- New-model dialog (Lane L2d) ---
  'aris.newModel.title': 'New ARIS model',
  'aris.newModel.nameLabel': 'Model name',
  'aris.newModel.nameInitial': 'New model',
  'aris.newModel.create': 'Create model',
  'aris.newModel.type': 'Model type',
  'aris.newModel.type.epc': 'EPC (event-driven process chain)',
  'aris.newModel.type.vacd': 'Value-added chain diagram',
  'aris.newModel.hint.directory':
    'A new .aml source file is created in the selected folder and opened for drawing immediately.',
  'aris.newModel.hint.fallback':
    'The model opens as an in-memory tab; use "Import into workspace…" to store it in a workspace.',
  'aris.newModel.created': 'Created {name}.',
  'aris.newModel.failed': 'Could not create the model: {error}',
  'aris.header.assistant': 'Assistant',
  'aris.header.openFile': 'Open file…',
  'aris.emptyMain':
    'Open an ARIS AML/XML source from the explorer, or create a reviewed placeholder tab through the AI panel.',
  'aris.main.aria': 'ARIS workspace',
  'aris.tab.list.aria': 'Open ARIS source tabs',
  'aris.tab.closeTitle': 'Close source tab',
  'aris.explorer.aria': 'ARIS workspace explorer and generation tools',
  'aris.pane.resize.sidebar.aria': 'Resize the ARIS explorer panel',
  'aris.explorer.empty':
    'No visible ARIS AML/XML sources were found in this workspace yet. Use Import or Open file to load one.',
  'aris.explorer.unsupportedBpmn': 'Unsupported BPMN',
  'aris.explorer.newModel': '＋ New model',
  'aris.explorer.newModel.title':
    'Create a blank ARIS model (EPC or value-added chain) in this workspace',
  'aris.explorer.imported': 'Imported {count} file(s) into the workspace.',
  'aris.generated.fallbackName': 'Generated draft',
  'aris.source.virtual': 'In-memory tab',
  'aris.sourceKind.aml': 'ARIS AML',
  'aris.sourceKind.apc': 'Legacy .apc alias',
  'aris.sourceKind.xml': 'ARIS XML',
  'aris.sourceKind.generated': 'Generated draft',
  'aris.placeholder.heading': 'ARIS placeholder canvas',
  'aris.placeholder.body':
    'This Phase 2 shell preserves exact source content and keeps the workspace, AI, settings, and assistant surfaces available while the native ARIS modeler is being built.',
  'aris.placeholder.readOnly':
    'The current tab is read-only. Original source bytes remain available for download and later lossless ingestion.',
  'aris.placeholder.zoom': 'Zoom 100%',
  'aris.placeholder.layout': 'Layout pending native ARIS canvas',
  'aris.placeholder.downloadSource': 'Download exact source',
  'aris.placeholder.openAssistant': 'Open assistant',
  'aris.placeholder.detailsHeading': 'Source details',
  'aris.placeholder.accountingHeading': 'Accounting and validation',
  'aris.placeholder.accountingBody':
    'Source-accounting, fidelity, and semantic validation remain pending Phase 3 and later ARIS-native layers. No source bytes are rewritten here.',
  'aris.placeholder.sourceHeading': 'Exact source preview',
  'aris.placeholder.sourceKind': 'Source kind',
  'aris.placeholder.sourcePath': 'Source path',
  'aris.placeholder.sourceBytes': 'Bytes',
  'aris.placeholder.rootElement': 'Root element',
  'aris.placeholder.sourceTokens': 'XML tokens',
  'aris.placeholder.sourceNodes': 'Syntax nodes',
  'aris.placeholder.sourceDoctype': 'DOCTYPE system/public id',
  'aris.placeholder.modelCount': 'Models',
  'aris.placeholder.objectDefinitionCount': 'Object definitions',
  'aris.placeholder.objectOccurrenceCount': 'Object occurrences',
  'aris.placeholder.connectionDefinitionCount': 'Connection definitions',
  'aris.placeholder.connectionOccurrenceCount': 'Connection occurrences',
  'aris.placeholder.attributeCount': 'Attribute definitions',
  'aris.placeholder.semanticDiagnostics': 'Semantic diagnostics',
  'aris.placeholder.unknownRecordCount': 'Unknown records',
  'aris.placeholder.sourceDigest': 'SHA-256',
  'aris.placeholder.mainAria': 'ARIS workspace tab for {name}',
  'aris.placeholder.newDiagramUnavailable':
    'The ARIS placeholder shell does not create blank native canvases yet. Open an ARIS AML/XML source or use Create with AI.',
  'aris.placeholder.newProcessUnavailable':
    'The ARIS placeholder shell does not create native ARIS models yet. Open an ARIS AML/XML source or use Create with AI.',
  'aris.footer.summary': '{files} workspace sources · {tabs} open tabs',
  'aris.ai.body':
    'Generate a native ARIS model — an EPC or a value-added chain diagram — from a plain-language description, a document, or the Excel template.',
  'aris.ai.name': 'Draft name',
  'aris.ai.namePlaceholder': 'Generated draft',
  'aris.ai.description': 'Process description',
  'aris.ai.descriptionPlaceholder':
    'Describe the process, scope, actors, and key decisions. The selected AI provider drafts a native ARIS model from this description for your review before anything is created.',
  'aris.ai.create': 'Generate ARIS model',
  'aris.ai.creating': 'Generating…',
  'aris.assistant.body':
    'The ARIS assistant surface stays available in Phase 2 while BPMN-specific retrieval and interview flows are removed from the shipped artifact.',
  'aris.assistant.workspace': 'Current workspace context',
  'aris.assistant.root': 'Workspace root',
  'aris.assistant.sources': 'Visible sources',
  'aris.assistant.tabs': 'Open tabs',
  'aris.assistant.activeTab': 'Active tab',
  'aris.assistant.activeKind': 'Active source kind',
  'aris.assistant.none': 'None',

  // --- FolderTreeLite context menu ---
  'contextMenu.newProcess': 'New process',
  'contextMenu.newFolder': 'New folder',
  'contextMenu.rename': 'Rename',
  'contextMenu.delete': 'Delete',
  'contextMenu.moveTo': 'Move to…',
  'treeAction.newProcessIn': 'New process in {name}',
  'treeAction.rename': 'Rename {name}',
  'treeAction.move': 'Move {name}',
  'treeAction.delete': 'Delete {name}',

  // --- SettingsDialogLite ---
  'settings.title': 'Settings — AI keys',
  'settings.close.aria': 'Close',
  'settings.keyStorageWarning':
    'API keys stay only in memory for this browser session by default. Optional persistence encrypts a key with your passphrase; the passphrase is never stored.',
  'settings.getKey': 'Get a key ↗',
  'settings.keyPlaceholder.configured': 'Configured (••••{last4}) — type to replace',
  'settings.keyPlaceholder.encrypted': 'Encrypted key available — enter the passphrase to unlock',
  'settings.keyPlaceholder.empty': 'Paste API key',
  'settings.clearKey': 'Clear stored key',
  'settings.saved': 'Saved.',
  'settings.keyCleared': 'Key cleared.',
  'settings.credentials.saving': 'Saving credentials…',
  'settings.credentials.unlocking': 'Unlocking encrypted credentials…',
  'settings.close': 'Close',
  'settings.saveKeys': 'Save keys',
  'settings.title.providers': 'Settings — AI providers',
  'settings.apiKey.aria': '{label} API key',
  'settings.testConnection': 'Test connection',
  'settings.testConnection.testing': 'Testing…',
  'settings.testConnection.billableDisclosure':
    'I understand this sends a small inference request that may be billable.',
  'settings.aiSelection.title': 'AI provider and model',
  'settings.aiSelection.hint':
    'This explicit choice is shared by generation, assistant, interview, and translation.',
  'settings.encryption.title': 'Credential storage',
  'settings.encryption.persist': 'Encrypt newly entered keys and persist them in this browser',
  'settings.encryption.passphrase': 'Encryption passphrase',
  'settings.encryption.unlock': 'Unlock encrypted keys for this session',
  'settings.encryption.hint':
    'AES-256-GCM with a PBKDF2-derived key is used. Losing the passphrase makes the ciphertext unrecoverable.',
  'settings.encryption.unlocked': 'Unlocked {count} encrypted key(s) for this session.',
  'settings.storageError.invalidInput': 'Review the required credential fields and try again.',
  'settings.storageError.unavailable': 'Browser storage is unavailable.',
  'settings.storageError.failed': 'The browser could not store or clean up credential data.',
  'settings.storageError.cryptoUnavailable':
    'Encrypted credential storage is unavailable in this browser.',
  'settings.storageError.invalidCiphertext':
    'The stored encrypted credential is missing or invalid.',
  'settings.storageError.unlockFailed':
    'The encrypted credential could not be unlocked. Check the passphrase and stored data.',
  'settings.storageError.operationCancelled':
    'A newer credential action replaced the pending operation.',
  'settings.storageError.startup': 'Legacy credential cleanup could not be completed. {error}',
  'settings.storageError.providerSelection':
    'The AI provider and model selection could not be saved. {error}',
  'settings.storageError.keySave': 'The key for {provider} could not be saved. {error}',
  'settings.storageError.unlock': 'The key for {provider} could not be unlocked. {error}',
  'settings.storageError.clear': 'The stored key for {provider} could not be cleared. {error}',
  'settings.storageError.unknownProvider': 'the AI provider',
  'settings.storageError.technicalDetails': 'Technical details',
  'settings.storageError.technicalDetail': 'Credential storage technical detail',
  'settings.localization.title': 'Bilingual resources',
  'settings.localization.description':
    'Edit the curated glossary and accepted translation memory for this workspace.',
  'settings.localization.publicNotice':
    'These are public workspace files included in complete backups. Do not add credentials or unreviewed provider output.',
  'settings.localization.unavailable':
    'Open a folder or browser workspace to edit portable localization resources.',
  'settings.localization.english': 'English',
  'settings.localization.arabic': 'Arabic',
  'settings.localization.glossary.title': 'Glossary',
  'settings.localization.glossary.description':
    'Curated terms are checked in file order; the first matching source value wins.',
  'settings.localization.glossary.empty':
    'This workspace has no glossary terms or neutral approvals.',
  'settings.localization.glossary.add': 'Add term',
  'settings.localization.glossary.save': 'Save glossary',
  'settings.localization.glossary.saved': 'Glossary saved.',
  'settings.localization.glossary.row': 'Glossary term {index}',
  'settings.localization.glossary.neutral': 'Do not translate (neutral)',
  'settings.localization.glossary.neutralHint':
    'English and Arabic must be identical when this is selected.',
  'settings.localization.translationMemory.title': 'Translation memory',
  'settings.localization.translationMemory.description':
    'Only explicitly accepted pairs are stored; file order controls first-match precedence.',
  'settings.localization.translationMemory.empty': 'No translation pairs have been accepted yet.',
  'settings.localization.translationMemory.addAccepted': 'Add accepted pair',
  'settings.localization.translationMemory.save': 'Save translation memory',
  'settings.localization.translationMemory.saved': 'Translation memory saved.',
  'settings.localization.translationMemory.row': 'Accepted pair {index}',
  'settings.localization.translationMemory.accepted': 'Accepted',
  'settings.localization.translationMemory.acceptedAt': 'Accepted {date}',
  'settings.localization.moveUp': 'Move row {index} up',
  'settings.localization.moveDown': 'Move row {index} down',
  'settings.localization.remove': 'Remove row {index}',
  'settings.localization.reload': 'Reload workspace resources',
  'settings.localization.reloading': 'Reloading…',
  'settings.localization.reloaded': 'Workspace resources reloaded.',
  'settings.localization.saving': 'Saving…',
  'settings.localization.conflict':
    'These workspace resources changed elsewhere. Reload before saving again.',
  'settings.localization.conflictTitle': '{resource} changed elsewhere',
  'settings.localization.conflictReloadRequired':
    'Your unsaved draft is preserved. Reload the latest workspace version before reconciling it.',
  'settings.localization.conflictReview':
    'The workspace version changed after this draft began. Choose the workspace version, or keep the draft against the reloaded version for explicit review before saving.',
  'settings.localization.conflictVersions': 'Draft base and workspace hashes:',
  'settings.localization.conflictCompareVersions': 'Compare the draft base and workspace version',
  'settings.localization.conflictDraftBase': 'Draft base ({count} entries)',
  'settings.localization.conflictWorkspaceVersion': 'Workspace version ({count} entries)',
  'settings.localization.conflictPreviewEmpty': 'No entries.',
  'settings.localization.conflictPreviewOmitted': '{count} more entries are not shown.',
  'settings.localization.useWorkspaceVersion': 'Use workspace version for {resource}',
  'settings.localization.keepDraftForReview': 'Keep {resource} draft for review',
  'settings.localization.reloadedDraftsPreserved':
    'Workspace resources reloaded. Unsaved drafts were preserved for conflict review.',
  'settings.localization.workspaceVersionSelected': 'Using the workspace version of {resource}.',
  'settings.localization.draftKeptForReview':
    '{resource} draft kept against the reloaded workspace version. Review it before saving.',
  'settings.localization.saveFailed': 'Could not save localization resources: {error}',
  'settings.localization.loadFailed':
    'Workspace localization resources could not be loaded: {error}',
  'settings.localization.loadFailedHint':
    'Editing remains disabled until both files reload successfully. Fix the reported file externally, then retry. A completed first-use or legacy-format update may remain if a later storage operation failed.',
  'settings.localization.failure.invalidPath': 'A localization resource path is invalid.',
  'settings.localization.failure.invalidEncoding':
    'A localization resource is not valid UTF-8 text.',
  'settings.localization.failure.notFound': 'A required localization resource was not found.',
  'settings.localization.failure.alreadyExists':
    'A localization resource already exists where a new file was expected.',
  'settings.localization.failure.wrongKind':
    'A localization resource path points to the wrong kind of workspace entry.',
  'settings.localization.failure.permission': 'Workspace file permission was lost.',
  'settings.localization.failure.cancelled': 'The workspace operation was cancelled.',
  'settings.localization.failure.staleWorkspace':
    'The selected workspace changed before the operation completed.',
  'settings.localization.failure.unsupported':
    'This workspace cannot store portable localization resources.',
  'settings.localization.failure.quotaExceeded': 'The workspace has insufficient storage space.',
  'settings.localization.failure.integrity':
    'The saved localization resource did not pass its integrity check.',
  'settings.localization.failure.storage': 'The workspace storage operation failed.',
  'settings.localization.failure.resourceLimit':
    'A localization resource exceeds the supported size or complexity limit.',
  'settings.localization.failure.partialLoad':
    'One localization file was updated before a later resource operation failed.',
  'settings.localization.failure.unknown': 'An unexpected workspace storage error occurred.',
  'settings.localization.technicalDetails': 'Technical details',
  'settings.localization.technicalDetail': 'Workspace localization technical detail',
  'settings.localization.validation.englishRequired': 'Enter the English value.',
  'settings.localization.validation.arabicRequired': 'Enter the Arabic value.',
  'settings.localization.validation.englishScript':
    'Use meaningful English-script text, or create an explicit neutral glossary term.',
  'settings.localization.validation.arabicScript': 'Use meaningful Arabic-script text.',
  'settings.localization.validation.neutralMismatch':
    'A neutral term must use the same value in English and Arabic.',
  'settings.localization.validation.acceptedOnly':
    'Translation memory can contain explicitly accepted pairs only.',
  'settings.localization.validation.schema':
    'This resource contains invalid fields, scripts, or acceptance metadata.',

  // --- AiPanelLite ---
  'ai.collapsedButton': '✨ Generate with AI',
  'ai.header': '✨ Generate with AI',
  'ai.hide.title': 'Hide AI panel',
  'ai.offlineWarning':
    'You appear to be offline. AI generation needs an internet connection; drawing and organizing diagrams still works.',
  'ai.noKeys.note':
    'Add an OpenRouter, Anthropic, or Gemini API key to generate diagrams from a description.',
  'ai.noKeys.openSettings': 'Open Settings',
  'ai.description.label': 'Description',
  'ai.description.placeholder':
    'Describe the process in plain language, e.g. "A customer submits an order; if it’s valid it’s fulfilled, otherwise it’s rejected."',
  'ai.provider.label': 'Provider',
  'ai.provider.select': 'Select a provider…',
  'ai.provider.selectHint':
    'Choose a provider and model explicitly before any AI request can be sent.',
  'ai.model.label': 'Model',
  'ai.targetFolder.label': 'Target folder',
  'ai.name.label': 'Name',
  'ai.name.placeholder': 'Order process (optional)',
  'ai.generate': 'Generate',
  'ai.generating': 'Generating…',
  'ai.noKeyForProvider': 'No key stored for {providerLabel}.',
  'ai.addOneInSettings': 'Add one in Settings',
  'ai.errorTip.offline': 'Tip: this looks like a connectivity issue. Check your network.',
  'ai.created': 'Created: {resultLabel}',
  'ai.openedInMemory': 'Opened {label} in a new tab (use Save to download).',
  'ai.placement.discarded.staleWorkspace':
    'The generated diagram was discarded because the workspace changed. It was not saved or opened.',
  'ai.placement.discarded.cancelled':
    'The generated diagram was discarded because placement was cancelled. It was not saved or opened.',
  'ai.placement.recoveryHint': 'Download the exact generated BPMN to recover it.',
  'ai.placement.downloadRecovery': 'Download generated BPMN',
  'ai.folderOption.root': '/ (workspace root)',
  'ai.error.cors':
    'The provider blocked the browser request (CORS). Use one of the supported browser providers: OpenRouter, Anthropic, or Gemini.',
  'ai.error.network':
    'Could not reach the AI provider. Check your internet connection, then try again.',
  'ai.error.auth':
    'The provider rejected the request (authentication). Check your API key in Settings.',
  'ai.error.rateLimit':
    'The provider is rate-limiting or overloaded right now. Wait a moment and try again.',
  'ai.error.provider': 'The AI provider returned an error. Try again or choose another provider.',
  'ai.error.invalidResponse':
    'The AI provider returned an unreadable or empty response. Try again.',
  'ai.error.unknown': 'The AI operation failed unexpectedly.',
  'ai.error.technicalDetail': 'Technical detail:',
  'ai.error.noApiKey': 'No API key for this provider. Add one in Settings.',
  'ai.error.selectProvider': 'Select a provider and model before generating.',
  'ai.pdf.label': 'Or upload a PDF',
  'ai.pdf.button': 'Upload PDF…',
  'ai.pdf.extracting': 'Extracting text…',
  'ai.pdf.error': 'Could not read the PDF: {error}',
  'ai.noKeysAtAll.note':
    'No API keys yet. Pick a provider below and {link} to generate — you can also test provider connectivity there without a key.',
  'ai.noKeysAtAll.link': 'add a key in Settings',
  'ai.tablist.aria': 'Generation source',
  'ai.tab.description': 'From description',
  'ai.tab.pdf': 'From PDF / image',
  'ai.tab.pdf.title.supported': 'Generate from a PDF document or an image of a process drawing',
  'ai.tab.pdf.title.unsupported':
    'PDF/image input is not supported by the selected provider and model. Choose a compatible model or provider.',
  'ai.pdfDocument.label': 'PDF document or image',
  'ai.pdfHint.label': 'Which process?',
  'ai.pdfHint.optional': '(optional)',
  'ai.pdfHint.placeholder':
    'Which process from this document? / ما هي العملية المطلوبة من هذا المستند؟',
  'ai.targetFolder.aria': 'Target folder',
  'ai.generateFromPdf': 'Generate from document',
  'ai.addOneInSettings.period': '.',
  'ai.note.updated':
    '{anthropic}, {gemini}, and {openrouter} can be called directly from a web page. Reach GLM, Kimi, and DeepSeek through OpenRouter. The direct vendor APIs for {desktopOnlyProviders} don’t allow browser (CORS) access — reach those models through OpenRouter here.',
  'ai.error.chooseNoPdf': 'Choose a PDF or image file first.',
  'ai.pdf.sizeGate.overLimit':
    'PDF is {size} — over the {limit} limit for this provider. Please {alt}.',
  'ai.pdf.sizeGate.alt.splitOnly': 'split the file',
  'ai.pdf.sizeGate.alt.tryGeminiOrSplit': 'try Gemini (larger limit) or split the file',
  'ai.attach.label': 'Description document',
  'ai.attach.hint':
    'Attach a Word (.docx) or PDF file that contains the process description — it is read together with the text above.',
  'ai.attach.extracted': '{name} · {chars} characters of text extracted',
  'ai.attach.docxEmpty': 'No readable text found in {name} — is it a scanned document?',
  'ai.attach.readFailed': 'Could not read {name}: {error}',
  'ai.attach.docxError.notZip': '{name} is not a valid Word (.docx) document.',
  'ai.attach.docxError.missingDocument': '{name} does not contain the main Word document content.',
  'ai.attach.docxError.tooLarge':
    '{name} exceeds the safe document archive limits. Use a smaller document.',
  'ai.attach.docxError.unsafe':
    '{name} contains unsafe or conflicting archive paths and was rejected.',
  'ai.attach.docxError.encrypted':
    '{name} is encrypted or password protected. Save an unprotected copy and try again.',
  'ai.attach.docxError.unsupported':
    '{name} uses an unsupported Word archive format or compression method.',
  'ai.attach.docxError.malformed': '{name} is damaged or is not a readable Word document.',
  'ai.attach.docxError.cancelled': 'Reading {name} was cancelled.',
  'ai.attach.docxError.unknown': 'The Word document {name} could not be read.',
  'ai.attach.remove': 'Remove attachment',
  'ai.attach.unsupportedProvider':
    'This attachment type is not supported by the selected provider and model. Choose a compatible model or provider.',
  'ai.image.sizeGate.overLimit':
    'Image is {size} — over the {limit} limit for this provider. Compress or crop it and try again.',
  'ai.image.unsupportedType': 'Unsupported image type. Use PNG, JPEG, WebP, or GIF.',
  'import.notBpmnXml': '{name} is XML but not a BPMN diagram — skipped.',
  'editor.langToggle.missing':
    'No labels can be shown in the requested diagram language, so the diagram language was not changed.',
  'canvas.inputs': 'Inputs',
  'canvas.cc': 'CC',
  'canvas.responsible': 'Responsible',
  'canvas.basis': 'Basis',
  'org.nameEn.label': 'Name (English)',
  'org.nameAr.label': 'Name (Arabic)',
  'org.inputs.label': 'Inputs / base information',
  'org.inputs.hint': 'One per line — data, documents, or base information this step needs.',
  'org.ccList.label': 'CC (informed parties)',
  'org.ccList.hint':
    'One per line — add the purpose after a dash, e.g. "Finance — budget check". Shown as a list beside the step.',
  'org.respList.label': 'Responsible people',
  'org.respList.hint': 'One per line, e.g. "Sara Al Marri — Approver".',
  'org.decisionBasis.label': 'Decision basis',
  'org.decisionBasis.hint': 'The rule, policy, or criteria this decision is based on.',
  'org.outputs.label': 'Outputs',
  'org.system.label': 'Supporting system',
  'apc.convertedMany': 'Converted {count} process models from {name}.',
  'apc.reason.noModels': 'No process models found in the ARIS export.',
  'translate.noKey': 'No AI key configured — add one in Settings to translate.',
  'translate.nothing':
    'No named label has enough source text to create a missing English or Arabic counterpart.',
  'translate.nothing.switched':
    'No translation was needed — the diagram is now showing the other language.',
  'translate.nothing.alreadyArabic':
    'No translation was needed, and the requested language could not replace the current display.',
  'translate.nothing.omitted':
    'No eligible labels need translation. Showing {switched} labels in the requested language; {missing} remain unchanged. {omitted} labels lack usable source text or an id.',
  'translate.running': 'Translating {count} labels…',
  'translate.done':
    'Translated {count} labels and switched the diagram language. Save to keep the changes.',
  'translate.partial':
    'Translated {done} of {total} eligible labels. Showing {switched} labels in the requested language; {missing} remain unchanged. Save to keep the changes.',
  'translate.failed':
    'Translation failed. Unresolved fields remain available for retry or manual review.',
  'settings.completeness.label': 'Highlight missing step information',
  'settings.completeness.hint':
    'Marks steps that lack a responsible party, inputs, or outputs — and decisions lacking a basis, start events lacking a trigger.',
  'missing.title': 'Missing: {list}',
  'missing.owner': 'responsible party',
  'missing.inputs': 'inputs',
  'missing.outputs': 'outputs',
  'missing.basis': 'decision basis',
  'missing.trigger': 'trigger',
  'missing.tooltip.action': 'Click to complete these details',
  'missing.highlight.hint': 'This information is still missing.',
  'canvas.subprocess.tooltip': 'Contains a linked sub-process — double-click to open',
  'canvas.subprocess.tooltip.generic': 'Contains a sub-process',
  'canvas.subchip': 'sub',
  'assist.tab.library': 'Ask the library',
  'assist.tab.interview': 'Complete this process',
  'assist.interview.start':
    'I generated a draft from your description. I will ask a few questions to fill the gaps — answer in either language, or press Finish anytime.',
  'assist.interview.finish': 'Finish',
  'assist.interview.applying': 'Updating the diagram…',
  'assist.interview.applied': 'Diagram updated.',
  'assist.interview.done':
    'All key information is filled in. You can keep refining or close the chat.',
  'assist.interview.noModeler': 'Open the generated process first, then start the interview.',
  'assist.interview.editWarning':
    'Answers regenerate the diagram — finish manual canvas edits after the interview.',
  'assist.error.redaction':
    'The request could not be prepared safely after name redaction. Review the included context and try again.',
  'assist.error.emptyResponse': 'The provider returned no usable interview questions. Try again.',
  'assist.model.line': 'Model: {model} ({provider})',
  'ai.continueInChat': '💬 Fill gaps in chat',
  'ai.continueInChat.title':
    'Open the assistant and answer its questions to complete the missing step information',

  // --- Diagram toolbar (legacy BPMN editor removed; keys retained where still used) ---
  'editor.zoomOut.title': 'Zoom out',
  'editor.zoomIn.title': 'Zoom in',
  'editor.zoomFit': 'Zoom Fit',
  'editor.propsToggle': 'Panel',
  'editor.propsToggle.title': 'Show/hide the properties panel',
  'editor.dirtyFlag.dirty': '● Unsaved changes',
  'editor.dirtyFlag.dirty.title': 'This diagram has changes you have not saved yet',
  'editor.print.title':
    'Print or Save as PDF — opens the print dialog with a full-page, landscape view of this diagram',
  'editor.print': 'Print / PDF',

  // --- Link picker ---
  'link.changeProcess': 'Change process link…',
  'link.linkToProcess': 'Link to process…',
  'link.button.title.linked': 'Linked to {calledElementId}',
  'link.button.title.unlinked': 'Link this call activity to a process',

  // --- AI link verification (LinkVerifyDialog) ---
  'ai.linkVerify.title': 'Review process links',
  'ai.linkVerify.intro':
    'The AI suggested links to existing processes. Confirm the uncertain ones below; unchecked links stay unlinked.',
  'ai.linkVerify.uncertain': '(uncertain)',
  'ai.linkVerify.noMatch': '(no matching process — stays unlinked)',
  'ai.linkVerify.confirm': 'Confirm links',
  'ai.linkVerify.cancel': 'Cancel',
  'ai.linked.summary': 'Linked {count}: {list}',

  // --- AI credits / usage (CreditsLine) ---
  'ai.credits.remaining': 'Credits remaining: ${amount}',
  'ai.credits.refresh': 'Refresh credit balance',
  'ai.credits.loading': 'Checking credit balance…',
  'ai.credits.refreshHint': 'Credit balance is not checked automatically.',
  'ai.credits.error.auth': 'Balance check failed — invalid key.',
  'ai.credits.error.network': 'Balance check failed — network error.',
  'ai.credits.error.timeout': 'Balance check timed out.',
  'ai.credits.error.unexpected': 'Balance check failed.',
  'ai.usage.session': 'This session: {requests} requests · {tokens} tokens · {cost}',
  'ai.usage.sessionDetailed':
    'Session: {requests} requests · {tokens} input/output tokens · {reasoning} reasoning tokens · {cost}',
  'ai.usage.allTimeDetailed':
    'All time: {requests} requests · {tokens} input/output tokens · {reasoning} reasoning tokens · {cost}',
  'ai.usage.priceAsOf':
    'Local price estimate last reviewed {date}; provider-reported cost is used when available.',
  'ai.usage.incomplete':
    'Usage is incomplete; values marked ≥ are lower bounds from the data still available in this browser.',
  'ai.usage.costNa': 'cost n/a',
  'ai.usage.reset': 'Reset',
  'settings.credits.noBalanceApi':
    'This provider does not expose a balance API — showing locally tracked usage instead.',
  'linkPicker.title': 'Link to process…',
  'linkPicker.close.aria': 'Close',
  'linkPicker.searchPlaceholder': 'Search by id, name, or path…',
  'linkPicker.empty.noProcesses': 'No processes found in this workspace yet.',
  'linkPicker.empty.noMatches': 'No processes match your search.',

  // --- Shared modal defaults ---
  'modal.cancel': 'Cancel',
  'modal.ok': 'OK',
  'modal.close.aria': 'Close',

  // --- Catalog (home view) ---
  'catalog.title': 'Process catalog',
  'catalog.empty': 'No processes found.',
  'catalog.column.name': 'Name',
  'catalog.column.folder': 'Folder',
  'catalog.column.modified': 'Last modified',
  'catalog.column.status': 'Status',
  'catalog.status.unresolved': 'Unresolved links',
  'catalog.status.ok': 'OK',
  'catalog.everyProcessIn': 'Every process in {rootName}.',
  'catalog.showingMatching': 'Showing {shown} of {total} matching "{query}".',
  'catalog.process.one': '{total} process.',
  'catalog.process.other': '{total} processes.',
  'catalog.withUnresolvedLinks': '{count} with unresolved links',
  'catalog.noMatch': 'No processes match "{query}".',
  'catalog.emptyBody': 'No processes yet. Click {newProcess} to create the first one.',
  'catalog.column.links': 'Links',
  'catalog.openRow.aria': 'Open {name}',
  'catalog.folderTitle': '{folder}',
  'catalog.unresolvedTooltip.one': '{count} unresolved call-activity link',
  'catalog.unresolvedTooltip.other': '{count} unresolved call-activity links',
  'catalog.ok': 'ok',

  // --- Search ---
  'search.results.title': 'Search results',
  'search.noResults': 'No processes match "{query}".',
  'search.matches.one': '{count} search match',
  'search.matches.other': '{count} search matches',
  'search.resultCount.one': '{count} result for "{query}"',
  'search.resultCount.other': '{count} results for "{query}"',
  'search.close.aria': 'Close search results',
  'search.noResults.full': 'No processes, files, ids or diagram text match.',
  'search.field.name': 'name',
  'search.field.file': 'file',
  'search.field.id': 'id',
  'search.field.content': 'in diagram',

  // --- Unresolved links panel ---
  'unresolved.title': 'Unresolved links',
  'unresolved.empty': 'All call activities resolve to a process in this workspace.',
  'unresolved.createNow': 'Create now',
  'unresolved.openSource': 'Open source',
  'unresolved.badge.title': 'Unresolved links — click to view',
  'unresolved.title.count': 'Unresolved links ({count})',
  'unresolved.close': 'Close',
  'unresolved.empty.full':
    'No unresolved links — every call activity points at a process that exists in this workspace.',
  'unresolved.intro': 'Each row is a call activity whose target process isn’t in this workspace. ',
  'unresolved.intro.canCreate':
    'Create the missing process (its id is fixed so the link resolves), or open the source to fix it.',
  'unresolved.intro.cannotCreate':
    'Open a folder to create the missing processes; here you can jump to each source.',
  'unresolved.createNow.title': 'Create a process with id "{calledElement}"',
  'unresolved.openSource.title': 'Open the file that contains this call activity',

  // --- Navigation ---
  'nav.back': 'Back',
  'nav.back.title': 'Back (Alt+Left)',
  'nav.forward': 'Forward',
  'nav.forward.title': 'Forward (Alt+Right)',
  'breadcrumb.root': 'Workspace',
  'breadcrumb.aria': 'Breadcrumb',

  // --- Import ---
  'import.dropHint': 'Drop ARIS AML/XML files or folders here to import',
  'import.toast.imported': 'Imported {name}',
  'import.toast.renamed': 'Imported as {name} (name already existed)',

  // --- Confirm dialog ---
  'confirmDialog.deleteFolder.title': 'Delete folder',
  'confirmDialog.deleteFile.title': 'Delete process',
  'confirmDialog.cancel': 'Cancel',
  'confirmDialog.confirm': 'Delete',
  'confirmDialog.confirm.default': 'Confirm',
  'confirmDialog.typeToConfirm': 'Type {name} to confirm:',

  // --- Print ---
  'print.button': 'Print / PDF',
  'print.title.prefix': 'Process: ',
  'print.ownerLine': 'Process owner: {name} ({type})',
  // Owner types — canonical keys reused by every owner-facing surface.
  'owner.type.individual': 'Individual',
  'owner.type.department': 'Department',
  'owner.type.division': 'Division',

  // --- Toasts ---
  'toast.dismiss.aria': 'Dismiss',
  'toast.deleted': 'Deleted "{name}".',
  'toast.moved': 'Moved "{name}" to {dest}.',
  'toast.imported.count': 'Imported {count} file{plural}',
  'toast.imported.renamed': ' ({renamed} renamed to avoid a name clash)',
  'toast.import.openFolderFirst': 'Open a folder first to import files into your workspace.',
  'toast.import.arisOnly': 'This ARIS-only build accepts ARIS AML/XML exports.',
  'toast.import.noBpmnFound':
    'No importable ARIS AML/XML sources (.aml, .apc, or .xml) were found in what you dropped.',
  'toast.print.loading': 'The diagram is still loading — try Print again in a moment.',
  'toast.print.failed': 'Print failed: {error}',

  // --- FX1: workspace & data-safety fixes (KEEP BOTH sides on rebase conflict) ---
  'tree.refresh': '↻',
  'tree.refresh.title': 'Rescan this folder for changes made outside the app',
  'tree.refresh.aria': 'Refresh workspace',
  'toast.refreshed': 'Workspace refreshed.',
  'toast.moved.withCount': 'Moved "{name}" to {dest} — {count} files (incl. {nonBpmn} non-BPMN).',
  'toast.renamed': 'Renamed to "{name}".',
  'toast.renamed.withCount': 'Renamed "{name}" — {count} files (incl. {nonBpmn} non-BPMN).',
  'alert.rename.invalidChars': 'A name cannot contain "/" or "\\".',
  'alert.import.failed': 'Import failed: {error}',
  'alert.open.failed': 'Could not open the file: {error}',
  'alert.staleWrite':
    'This diagram belongs to a folder that is no longer open — its save was skipped.',
  'alert.staleGeneration':
    'The workspace folder changed while generating — the diagram was not saved. Open it again and re-generate.',
  'alert.saveAll.failed': 'Could not save all changes: {error}. Keeping the current folder open.',
  'confirm.switch.title': 'Unsaved changes',
  'confirm.switch.body':
    'You have unsaved changes in {count} open diagram(s). Save them before switching folders?',
  'confirm.switch.saveAll': 'Save all & switch',
  'confirm.switch.discard': 'Discard & switch',
  'confirm.switch.cancel': 'Cancel',
  'confirm.switch.downloadedTitle': 'Downloaded drafts remain unsaved',
  'confirm.switch.downloadedBody':
    '{count} draft download(s) were prepared, but downloads are not durable workspace saves. Continue switching and keep the recovery drafts, or cancel and return to the open documents.',
  'confirm.switch.continue': 'Continue switching',

  // --- FX2 lane: AI/provider/CSP/naming/i18n fixes (F1 + Codex M4/5/6/9/10) ---
  // Provider blurbs — rendered via i18n (RTL-safe) instead of English literals.
  'ai.provider.openrouter.desc':
    'One key, many models (GLM-5.2, Kimi K3, DeepSeek V4, Claude, Gemini). Browser-callable; PDF supported.',
  'ai.provider.anthropic.desc':
    'Claude models, called browser-direct with your key. Native PDF understanding.',
  'ai.provider.gemini.desc': 'Gemini via raw generateContent. Native PDF understanding.',
  // Test-connection verdicts (localized; {status} is the HTTP code).
  'settings.verdict.reachableOk': 'Reachable — request accepted (HTTP {status}). Your key works.',
  'settings.verdict.reachableAuth':
    'Reachable (CORS OK) — the provider rejected the key (HTTP {status}). Expected for a keyless test; enter a valid key to use it.',
  'settings.verdict.reachableOther':
    'Reachable (CORS OK) — HTTP {status}. The endpoint is callable from the browser.',
  'settings.verdict.blocked':
    'Blocked or unreachable (CORS, offline, or DNS) — the browser could not read any response. Check your network, retry, or choose a browser-callable provider such as OpenRouter, Anthropic, or Gemini.',
  'settings.verdict.timeout': 'The connection timed out. Check your network and try again.',
  // Generation timeout + PDF notes.
  'ai.error.timeout': 'The request took too long and timed out. Try again, or use a smaller input.',
  'ai.error.cancelled': 'The request was cancelled.',
  'ai.cancel': 'Cancel request',
  'ai.retry.attempt': 'Request attempt {attempt} of {max}.',
  'ai.retry.waiting': 'Attempt {attempt} of {max} failed; retrying in {seconds}s.',
  'ai.privacy.preview.title': 'External request preview',
  'ai.privacy.providerModel': 'Provider/model: {provider} / {model}',
  'ai.privacy.description': 'Included description',
  'ai.privacy.attachment': 'Included attachment: {name} ({bytes} bytes)',
  'ai.privacy.includeWorkspace': 'Include relevant workspace process context',
  'ai.privacy.redactNames': 'Redact process names (stable process IDs remain for linking)',
  'ai.privacy.workspaceCount':
    'Workspace context: {included} included, {relevant} relevant, {total} total. Zero-confidence matches are never sent.',
  'ai.privacy.sensitivity': 'Contains names: {names}. Obvious sensitive metadata: {sensitive}.',
  'ai.privacy.requestCount': 'Estimated maximum inference requests for this action: {count}.',
  'ai.privacy.consent': 'I reviewed this request and consent to sending the listed data.',
  'common.yes': 'Yes',
  'common.no': 'No',
  'ai.pdf.engineNote': 'PDF parsing engine is managed by the provider.',
  'ai.pdf.memoryNote':
    'PDFs are capped at 20 MB. Sending base64-encodes the file (~+33%) and copies it into the JSON request, so a large PDF briefly uses several times its size in memory — split scanned or very large documents.',
  'ai.pdf.sizeGate.softWarn':
    'This PDF is {size} — large files may be slow or brush provider limits. Split it if generation fails.',

  // --- Org pack: step-details dialog + owner picker + styling (B4) ---
  'org.dialog.title.element': 'Step details',
  'org.dialog.title.process': 'Process details',
  'org.apply': 'Apply',
  'org.cancel': 'Cancel',
  'org.applied': 'Details applied.',
  'org.applyFailed': 'Could not apply the details: {error}',
  'org.export.owners': 'Export owners (CSV)',

  'org.section.owner': 'Owner',
  'org.section.note': 'Note',
  'org.section.channel': 'Channel',
  'org.section.cc': 'Carbon copy (CC)',
  'org.section.trigger': 'Trigger',

  'org.ownerRole.label': 'RACI role',
  'org.ownerRole.R': 'Responsible',
  'org.ownerRole.A': 'Accountable',
  'org.ownerRole.C': 'Consulted',
  'org.ownerRole.I': 'Informed',

  'org.channel.none': 'None',
  'org.channel.dmthub': 'DMT Hub',
  'org.channel.email': 'Email',
  'org.channel.data': 'Data',
  'org.channel.detail.label': 'Channel detail',
  'org.channel.detail.placeholder': 'e.g. recipient, queue or reference',
  'org.channel.dmthub.placeholder': 'DMT Hub service name',

  'org.cc.label': 'Copy another owner on this step',
  'org.cc.to.label': 'CC recipient',
  'org.cc.to.placeholder': 'Name or role to copy',

  'org.trigger.label': 'Trigger',
  'org.trigger.none': 'None',
  'org.trigger.email': 'Email',
  'org.trigger.dmthub': 'DMT Hub',
  'org.trigger.manual': 'Manual',
  'org.trigger.schedule': 'Schedule',
  'org.trigger.other': 'Other',
  'org.trigger.service.label': 'DMT Hub service',
  'org.trigger.service.placeholder': 'Hub service that fires this start event',
  'org.trigger.detail.label': 'Trigger detail',
  'org.trigger.detail.placeholder': 'e.g. schedule, sender or reference',
  'org.trigger.serviceRequired': 'A DMT Hub service name is required.',
  'org.trigger.add': '＋ Add trigger',
  'org.trigger.remove.aria': 'Remove this trigger',
  'org.trigger.rowLabel': 'Trigger {n}',

  'org.note.label': 'Note',
  'org.note.placeholder': 'Add a note shown beside this step…',

  // Owner-picker labels (reuse owner.type.individual/department/division above).
  'owner.name.label': 'Owner',
  'owner.name.placeholder': 'Owner name…',
  'owner.type.label': 'Type',
  'owner.type.none': '—',
  'owner.suggestions.aria': 'Owner suggestions',

  // --- Settings: diagram styling (B4) ---
  'settings.diagram.title': 'Diagram',
  'settings.orgStyling.label': 'DMT colour coding & step details',
  'settings.orgStyling.desc':
    'Show owner chips, RACI roles, channel and trigger tags, and note styling on the canvas and in exports.',

  // --- Process assistant (chat drawer, B5) ---
  'assist.open': 'Ask the process assistant',
  'assist.title': 'Process assistant',
  'assist.close': 'Close assistant',
  'assist.placeholder': 'Ask what happens next, or who owns a step…',
  'assist.send': 'Send',
  'assist.thinking': 'Thinking…',
  'assist.empty':
    'Ask about your documented processes — what happens after a step, who is responsible, or which process to follow.',
  'assist.sources': 'Based on',
  'assist.poweredBy': 'AI answers via {provider}',
  'assist.localMode': 'Direct answers from your process files',
  'assist.fellBack':
    'The AI provider could not be reached, so here is a direct answer from your process files:',
  'assist.local.next': 'In “{process}”, after “{step}” the next step is:',
  'assist.local.complete': 'In “{process}”, “{step}” is the final step — the process is complete.',
  'assist.local.candidates': 'That could refer to a few processes — which did you mean?',
  'assist.local.none': 'I could not find that in your documented processes.',

  // --- Whole-library export / import (.zip, B5) ---
  'library.export': 'Export library',
  'library.export.title': 'Download the whole workspace as a .zip library',
  'library.import': 'Import library',
  'library.import.title': 'Import a .zip process library',
  'library.import.confirmTitle': 'Import process library',
  'library.import.summary': 'Import {count} process file(s) from this library into your workspace?',
  'library.import.skippedNote': '{skipped} entr(ies) in the archive will be skipped:',
  'library.import.confirm': 'Import',
  'library.exported': 'Exported {count} process file(s) as a .zip library.',
  'library.import.empty': 'No process files were found in this library.',
  'library.skip.not-bpmn': 'not a .bpmn file',
  'library.skip.unsafe-path': 'unsafe path',
  'library.skip.too-large': 'file too large',
  'library.skip.decode-failed': 'could not decode',

  // --- ARIS (.apc) experimental import (B5) ---
  'apc.converted': 'Imported “{name}” from ARIS — experimental conversion, please review it.',
  'apc.failed': 'Could not convert an ARIS (.apc) file: {reason}',
  'apc.reason.notAml': 'it is not a recognized ARIS AML export',
  'apc.reason.noObjects': 'no process objects were found',
  'apc.convertedInto': 'Imported {count} processes into folder “{folder}”.',

  // --- Details card / owner picker / pane resizers / free translate / tree nesting ---
  'details.card.title': 'Details',
  'details.card.processScope': 'Process',
  'details.card.elementScope': 'Selected step',
  'details.card.noSelection': 'No step selected — showing process details.',
  'details.card.owner': 'Owner',
  'details.card.inputs': 'Inputs',
  'details.card.outputs': 'Outputs',
  'details.card.empty': '—',
  'details.card.missingTitle': 'Missing information',
  'details.card.complete': 'All key information is filled in.',
  'details.card.open': 'Open Details…',
  'details.card.open.title': 'Edit the full step/process details',
  'details.card.more': '+{count} more',
  'owner.browse.aria': 'Browse all owners',
  'owner.empty': 'No owners yet — type a name to add one.',
  'pane.resize.sidebar.aria': 'Resize the explorer panel',
  'pane.resize.props.aria': 'Resize the properties panel',
  'pane.resize.hint': 'Drag to resize — double-click to reset',
  'translate.free.using': 'No AI key — translating {count} labels with a free translation service…',
  'translate.free.rate':
    'The free translation service hit its daily limit. Try again later or add an AI key in Settings.',
  'translate.free.offline': 'You appear to be offline — translation needs a network connection.',
  'translate.free.down':
    'The free translation service could not be reached. Try again later or add an AI key in Settings.',
  'translationReview.retry.service.google': 'Google Translate',
  'translationReview.retry.service.mymemory': 'MyMemory',
  'translationReview.retry.attempt':
    '{service}: item {item} of {items}, request attempt {attempt} of {max}.',
  'translationReview.retry.waiting':
    '{service}: item {item} of {items}, request attempt {attempt} of {max}; retrying in {seconds}s.',
  'tree.linkedChildren': 'Linked sub-processes',
  'tree.linkDepthCapped': 'More levels not shown',
  'library.manifestInfo': 'Library manifest: {files} file(s), {links} link(s).',
  'library.ownersCsvInfo': 'Owners list (process-owners.csv) detected — informational only.',

  // --- Process hierarchy references (append-only) ---
  'tree.reference.canonicalPath': 'Canonical file: {path}',
  'tree.shared': 'Shared',
  'tree.shared.title': 'Referenced by {count} parent processes',
  'tree.owned': 'Owned',
  'tree.owned.title': 'Owned subprocess — its canonical file is nested here',
  'tree.reused': 'Reused',
  'tree.reused.title': 'Reused subprocess reference — opens the canonical file',
  'tree.cycle.title': 'Cycle — this process already appears in this branch',

  // --- Viewer interactions: Details pane, shape legend, semantic tooltips (append-only) ---
  'pane.details.toggle': 'Details',
  'pane.details.toggle.title': 'Show or hide the Details pane',
  'pane.details.aria': 'Step details and properties',
  'legend.toggle': 'Shape legend',
  'legend.toggle.title': 'Show the shape legend',
  'legend.title': 'Shape legend',
  'legend.close.aria': 'Close shape legend',
  'legend.event': 'Event',
  'legend.event.start': 'Start event',
  'legend.event.intermediate': 'Intermediate event',
  'legend.event.end': 'End event',
  'legend.step': 'Step / function',
  'legend.subprocess': 'Sub-process',
  'legend.gateway': 'Gateway',
  'legend.gateway.eventBased': 'Event-based gateway',
  'legend.gateway.complex': 'Complex gateway',
  'legend.participant': 'Pool / participant',
  'legend.lane': 'Lane',
  'legend.annotation': 'Text annotation',
  'legend.dataObject': 'Data object',
  'legend.dataStore': 'Data store',
  'legend.owner': 'Owner / responsible',
  'legend.input': 'Input',
  'legend.output': 'Output',
  'legend.cc': 'CC / informed',
  'legend.basis': 'Decision basis',
  'legend.subprocessChip': 'Sub-process link',
  'semantic.event.tooltip': 'Marks where a process starts, ends, or waits for something.',
  'semantic.event.start.tooltip': 'Starts the process when its trigger occurs.',
  'semantic.event.intermediate.tooltip':
    'Waits for or throws an event while the process is running.',
  'semantic.event.end.tooltip': 'Ends this path through the process.',
  'semantic.step.tooltip': 'Performs one unit of work in the process.',
  'semantic.subprocess.tooltip': 'Groups a detailed flow inside a larger process.',
  'semantic.gateway.eventBased.tooltip': 'Chooses a path according to which event happens first.',
  'semantic.gateway.complex.tooltip':
    'Uses a custom combination rule for splitting or joining paths.',
  'semantic.participant.tooltip':
    'Shows one participating organization, role, or system and contains its process.',
  'semantic.lane.tooltip':
    'Groups work assigned to one role, team, or responsibility inside a pool.',
  'semantic.annotation.tooltip': 'Adds explanatory text without changing the process flow.',
  'semantic.dataObject.tooltip': 'Shows information or a document used or produced by the process.',
  'semantic.dataStore.tooltip': 'Shows information kept in persistent storage.',
  'semantic.owner.tooltip': 'Shows who owns the step or is responsible for doing it.',
  'semantic.input.tooltip': 'Information required before this step can run.',
  'semantic.output.tooltip': 'Information produced by this step.',
  'semantic.cc.tooltip': 'People or roles kept informed about this step.',
  'semantic.basis.tooltip': 'The rule, policy, or criteria used for this decision.',
  'semantic.subprocessChip.tooltip': 'Marks a collapsed or linked sub-process that can be opened.',

  // --- Audited localization review / external-request consent ---
  'translationReview.title': 'Review translation',
  'translationReview.direction.enAr': 'English → Arabic',
  'translationReview.direction.arEn': 'Arabic → English',
  'translationReview.document': 'Target document:',
  'translationReview.summary':
    '{fields} bilingual fields checked · {missing} missing · {invalid} wrong-script/mixed · {failed} provider failures',
  'translationReview.fields.title': 'Fields requiring review',
  'translationReview.fields.issue': '{issue}',
  'translationReview.fields.paginationLabel': 'Fields requiring review pages',
  'translationReview.issue.missing': 'Missing translation',
  'translationReview.issue.wrongScript': 'Wrong writing system',
  'translationReview.issue.duplicateCounterpart': 'Duplicate counterpart',
  'translationReview.issue.mixed': 'Mixed writing systems',
  'translationReview.issue.providerFailed': 'Translation provider failed',
  'translationReview.provider': 'Translation provider',
  'translationReview.provider.choose': 'Choose a provider…',
  'translationReview.provider.ai':
    'The exact texts below will be sent to the selected AI provider and model.',
  'translationReview.provider.free':
    'Each exact text will be sent to Google Translate; failed items may be sent to MyMemory.',
  'translationReview.outbound.title': 'Exact text leaving this browser',
  'translationReview.outbound.paginationLabel': 'Outbound text review pages',
  'translationReview.outbound.disclosure':
    '{provider} will receive {count} text item(s) in an estimated {min}–{max} external request(s). Nothing is sent until you press Translate now or explicitly confirm a one-field retry.',
  'translationReview.outbound.chooseProvider':
    'Choose a provider to see the final disclosure and request estimate. Nothing has been sent.',
  'translationReview.pagination.status':
    'Showing {start}–{end} of {total}. Page {page} of {pages}.',
  'translationReview.pagination.previous': 'Previous page',
  'translationReview.pagination.next': 'Next page',
  'translationReview.sensitive':
    '{count} item(s) are owner/responsibility fields and may contain people’s names.',
  'translationReview.mixedManual':
    'Mixed-script source items remain listed for segmentation or manual review and will not be sent automatically.',
  'translationReview.translateNow': 'Translate now',
  'translationReview.partialPreview': 'Preview translated fields only',
  'translationReview.applyCompleted': 'Apply completed language view',
  'translationReview.postpone': 'Postpone',
  'translationReview.cancel': 'Cancel translation',
  'translationReview.running': 'Translation is running…',
  'translationReview.memorySaving':
    'The translation was applied. Saving accepted pairs to workspace translation memory…',
  'translationReview.cancelled': 'Translation was cancelled. All unresolved fields remain listed.',
  'translationReview.partialStatus':
    'Some fields are still unresolved. They remain listed and the diagram language was not reported as complete.',
  'translationReview.proposalStatus':
    '{count} provider translation proposals require your acceptance, edit, or rejection before anything is applied.',
  'translationReview.stagedStatus':
    '{count} reviewed value(s) are staged. Nothing changes until final Apply.',
  'translationReview.applying': 'Applying all reviewed values as one undoable change…',
  'translationReview.progress.partial':
    '{resolved} resolved · {unresolved} unresolved · {failed} provider failures. The diagram language is not complete.',
  'translationReview.progress.ready':
    'All target fields now pass the bilingual audit. Apply the completed language view to finish.',
  'translationReview.field.source': 'Source text',
  'translationReview.field.target': 'Target text',
  'translationReview.field.proposed': 'Provider proposal',
  'translationReview.field.staged': 'Accepted for final apply',
  'translationReview.field.acceptProposal': 'Accept this proposal',
  'translationReview.field.rejectProposal': 'Reject this proposal',
  'translationReview.field.unavailable':
    'This diagnostic no longer has a safe BPMN storage target. Refresh the review after correcting the source field.',
  'translationReview.field.retry': 'Retry this field',
  'translationReview.field.retrying': 'Retrying this field…',
  'translationReview.field.retryDisclosureTitle': 'Confirm this one-field request',
  'translationReview.field.retryDisclosure':
    'Only the exact field below will be sent in an estimated {min}–{max} external requests. No other reviewed field is included.',
  'translationReview.field.retryProvider': 'Provider and model',
  'translationReview.field.retryContext': 'Field context',
  'translationReview.field.retryFingerprint': 'Consent fingerprint',
  'translationReview.field.retrySensitivity.sensitive':
    'This owner/responsibility field may contain a person’s name.',
  'translationReview.field.retrySensitivity.standard':
    'This field is not marked as an owner/responsibility field.',
  'translationReview.field.retryCancel': 'Cancel one-field retry',
  'translationReview.field.retryConfirm': 'Confirm and retry this field',
  'translationReview.field.consentRequired':
    'Review and confirm the current one-field disclosure before retrying.',
  'translationReview.memorySaveFailed':
    'The translation was applied, but accepted translation pairs could not be saved to workspace translation memory.',
  'translationReview.memoryRecoveryRequired':
    'Choose Retry saving to preserve the accepted pairs, or Continue without saving. This dialog will remain open until you choose one of these recovery actions.',
  'translationReview.memoryRetry': 'Retry saving accepted translations',
  'translationReview.memoryContinue': 'Continue without saving these pairs',
  'translationReview.memorySkipped':
    'The translation remains applied. OrbitPM continued without another attempt to save these pairs to workspace translation memory.',
  'translationReview.field.manual': 'Edit this field manually',
  'translationReview.field.manualCancel': 'Close manual editor',
  'translationReview.field.manualSave': 'Save reviewed value',
  'translationReview.field.manualSaving': 'Saving reviewed value…',
  'translationReview.field.manualPlaceholder': 'Enter the reviewed translation',
  'translationReview.field.manualEmpty': 'Enter a non-empty reviewed translation.',
  'translationReview.field.manualFailed': 'The reviewed value could not be saved.',
  'translationReview.field.retryFailed': 'This field could not be translated again.',
  'translationReview.error.technicalDetails': 'Technical details',
  'translationReview.error.technicalDetail': 'Translation review technical detail',
  'translationReview.stale':
    'The diagram changed after review. Review the current outbound text before translating.',
  'translationReview.noProvider': 'Choose a translation provider first.',

  // --- Manual reviewed XML ingestion ---
  'reviewedXmlReview.title': 'Complete bilingual XML review',
  'reviewedXmlReview.close': 'Close bilingual XML review',
  'reviewedXmlReview.summary':
    'Resolve {count} unique bilingual field target(s). The BPMN source is not changed until every row is valid and you explicitly complete the review.',
  'reviewedXmlReview.pending': '{count} row(s) still require a valid reviewed value.',
  'reviewedXmlReview.ready': 'Every row is valid. You can explicitly complete the review.',
  'reviewedXmlReview.row.title': '{process} / {element} / {field} / {target}',
  'reviewedXmlReview.target.en': 'English',
  'reviewedXmlReview.target.ar': 'Arabic',
  'reviewedXmlReview.source': 'Exact source ({language})',
  'reviewedXmlReview.current': 'Current target ({language})',
  'reviewedXmlReview.counterpart': 'Current counterpart ({language})',
  'reviewedXmlReview.empty': '(missing)',
  'reviewedXmlReview.issues': 'Detected issues',
  'reviewedXmlReview.issue.missing': 'A target value is missing.',
  'reviewedXmlReview.issue.wrongScript': 'The value uses the wrong script.',
  'reviewedXmlReview.issue.duplicateCounterpart':
    'The value duplicates its non-neutral counterpart.',
  'reviewedXmlReview.issue.mixed': 'The value contains unapproved mixed-script text.',
  'reviewedXmlReview.issue.providerFailed': 'Automatic translation did not produce a value.',
  'reviewedXmlReview.targetValue': 'Reviewed target value ({language})',
  'reviewedXmlReview.rowValid': 'Valid for this target.',
  'reviewedXmlReview.approval': 'Exact field approval',
  'reviewedXmlReview.approval.none': 'No exception',
  'reviewedXmlReview.approval.neutral': 'Approve as a neutral term or code',
  'reviewedXmlReview.approval.englishBilingual': 'Approve as an English bilingual proper name',
  'reviewedXmlReview.approval.help':
    'Approval is scoped to this field and exact value. Editing the value clears it.',
  'reviewedXmlReview.cancel': 'Cancel review',
  'reviewedXmlReview.complete': 'Complete review',

  // --- Workspace import transaction review ---
  'workspaceImportReview.title': 'Review workspace import',
  'workspaceImportReview.close': 'Close workspace import review',
  'workspaceImportReview.intro':
    'Review the exact sealed plan, all evidence, and every collision before explicitly confirming. Closing this dialog cancels without changing workspace files.',
  'workspaceImportReview.plan': 'Sealed plan',
  'workspaceImportReview.status': 'Plan status',
  'workspaceImportReview.status.ready': 'Ready',
  'workspaceImportReview.status.blocked': 'Blocked',
  'workspaceImportReview.reviewDigest': 'Review digest (SHA-256)',
  'workspaceImportReview.planId': 'Plan ID',
  'workspaceImportReview.createdAt': 'Created at',
  'workspaceImportReview.workspaceId': 'Workspace ID',
  'workspaceImportReview.workspaceMode': 'Workspace mode',
  'workspaceImportReview.targetFolder': 'Target folder',
  'workspaceImportReview.root': '(workspace root)',
  'workspaceImportReview.summary': 'Plan summary',
  'workspaceImportReview.summary.sources': 'Sources',
  'workspaceImportReview.summary.artifacts': 'Artifacts',
  'workspaceImportReview.summary.collisions': 'Collisions',
  'workspaceImportReview.summary.skipped': 'Skipped',
  'workspaceImportReview.summary.repairs': 'Repairs',
  'workspaceImportReview.summary.warnings': 'Warnings',
  'workspaceImportReview.summary.arisReports': 'ARIS reports',
  'workspaceImportReview.summary.creates': 'New files',
  'workspaceImportReview.summary.identical': 'Identical collisions',
  'workspaceImportReview.artifacts': 'Prepared artifacts',
  'workspaceImportReview.artifact': 'Artifact {index}: {name}',
  'workspaceImportReview.artifactId': 'Artifact ID',
  'workspaceImportReview.sourceName': 'Source name',
  'workspaceImportReview.sourceId': 'Source ID',
  'workspaceImportReview.sourceKind': 'Source kind',
  'workspaceImportReview.sourcePath': 'Source path',
  'workspaceImportReview.destinationPath': 'Destination path',
  'workspaceImportReview.utf8Bytes': 'Exact UTF-8 byte size',
  'workspaceImportReview.sha256': 'Artifact SHA-256',
  'workspaceImportReview.processIds': 'Process IDs',
  'workspaceImportReview.replacesProcessIds': 'Replaced process IDs',
  'workspaceImportReview.localizationMode': 'Localization review mode',
  'workspaceImportReview.localizationMode.automatic': 'Automatically complete',
  'workspaceImportReview.localizationMode.explicit': 'Explicitly reviewed',
  'workspaceImportReview.localizationDigest': 'Localization review digest',
  'workspaceImportReview.none': 'None',
  'workspaceImportReview.pagination.navigation': '{section} pages',
  'workspaceImportReview.pagination.status':
    'Showing {start}–{end} of {total}. Page {page} of {pages}.',
  'workspaceImportReview.pagination.previous': 'Previous page',
  'workspaceImportReview.pagination.next': 'Next page',
  'workspaceImportReview.pagination.previousFor': 'Previous {section} page',
  'workspaceImportReview.pagination.nextFor': 'Next {section} page',
  'workspaceImportReview.technicalEvidence': 'Technical evidence',
  'workspaceImportReview.technicalEvidenceTruncated':
    'Technical evidence was truncated to {limit} Unicode characters.',
  'workspaceImportReview.autoLayoutPreview.title': 'Auto-layout diagram previews',
  'workspaceImportReview.autoLayoutPreview.intro':
    'To keep large reviews responsive, diagram rendering starts only when you choose a reviewed artifact. Opening another preview closes the current one.',
  'workspaceImportReview.autoLayoutPreview.open': 'Preview diagram',
  'workspaceImportReview.autoLayoutPreview.close': 'Close diagram preview',
  'workspaceImportReview.autoLayoutPreview.openFor': 'Preview diagram for {path}',
  'workspaceImportReview.autoLayoutPreview.closeFor': 'Close diagram preview for {path}',
  'workspaceImportReview.autoLayoutPreview.pagination': 'Auto-layout preview pages',
  'workspaceImportReview.autoLayoutPreview.failed':
    'The reviewed diagram preview could not be rendered.',
  'workspaceImportReview.autoLayoutPreview.ready': 'The reviewed diagram preview is ready.',
  'workspaceImportReview.autoLayoutPreview.warnings':
    'The reviewed diagram preview is ready with {count} rendering warning(s).',
  'workspaceImportReview.autoLayoutAcceptance.label':
    'I accept every listed auto-layout repair ({count} total).',
  'workspaceImportReview.autoLayoutAcceptance.hint':
    'Diagram previews are available on demand above. Confirm import applies the exact sealed repaired XML for every listed artifact.',
  'workspaceImportReview.autoLayoutAcceptance.required':
    'Accept all listed auto-layout repairs before confirming this import.',
  'workspaceImportReview.skipped': 'Skipped inputs',
  'workspaceImportReview.skippedItem': 'Skipped input {index}',
  'workspaceImportReview.path': 'Path',
  'workspaceImportReview.reason': 'Reason',
  'workspaceImportReview.reason.unsupportedContent': 'Unsupported content',
  'workspaceImportReview.reason.bpmnNotSupported': 'BPMN input is not supported in this build',
  'workspaceImportReview.reason.unsafePath': 'Unsafe path',
  'workspaceImportReview.reason.invalidBpmn': 'Invalid BPMN',
  'workspaceImportReview.reason.amlConversionFailed': 'ARIS AML conversion failed',
  'workspaceImportReview.reason.processIdCollision': 'Process ID collision',
  'workspaceImportReview.reason.processIdentityChanged': 'Process identity changed during review',
  'workspaceImportReview.reason.localizationReviewRequired': 'Localization review required',
  'workspaceImportReview.reason.localizationReviewCancelled': 'Localization review cancelled',
  'workspaceImportReview.reason.localizationInvalid': 'Localization validation failed',
  'workspaceImportReview.reason.destinationParentFile': 'Destination parent is a file',
  'workspaceImportReview.reason.libraryNotBpmn': 'ZIP entry is not BPMN',
  'workspaceImportReview.reason.libraryUnsafePath': 'ZIP entry has an unsafe path',
  'workspaceImportReview.reason.libraryTooLarge': 'ZIP entry is too large',
  'workspaceImportReview.reason.libraryDecodeFailed': 'ZIP entry could not be decoded',
  'workspaceImportReview.reason.unknown': 'Unknown skip reason',
  'workspaceImportReview.skip.unsupportedContent':
    'The input was skipped because it is not recognizable ARIS AML/XML.',
  'workspaceImportReview.skip.bpmnNotSupported':
    'The input was skipped because this ARIS-only build accepts ARIS AML/XML exports only.',
  'workspaceImportReview.skip.unsafePath':
    'The input was skipped because its path cannot be contained safely in the workspace.',
  'workspaceImportReview.skip.invalidBpmn':
    'The input was skipped because BPMN validation did not complete successfully.',
  'workspaceImportReview.skip.amlConversionFailed':
    'The ARIS AML input could not be converted into reviewed BPMN.',
  'workspaceImportReview.skip.processIdCollision':
    'The input would create or move a process identity outside its reviewed workspace binding.',
  'workspaceImportReview.skip.processIdentityChanged':
    'The process identity changed after review, so the sealed plan can no longer apply it.',
  'workspaceImportReview.skip.localizationReviewRequired':
    'The input needs an explicit bilingual review before it can be prepared.',
  'workspaceImportReview.skip.localizationReviewCancelled':
    'The input was not prepared because its bilingual review was cancelled.',
  'workspaceImportReview.skip.localizationInvalid':
    'The reviewed bilingual content did not pass validation.',
  'workspaceImportReview.skip.destinationParentFile':
    'The destination cannot be created because one of its parent paths is a file.',
  'workspaceImportReview.skip.libraryNotBpmn':
    'The ZIP entry was skipped because it is not a BPMN file.',
  'workspaceImportReview.skip.libraryUnsafePath':
    'The ZIP entry was skipped because its path is unsafe.',
  'workspaceImportReview.skip.libraryTooLarge':
    'The ZIP entry was skipped because it exceeds the safe size limit.',
  'workspaceImportReview.skip.libraryDecodeFailed':
    'The ZIP entry was skipped because its text could not be decoded safely.',
  'workspaceImportReview.skip.unknown':
    'The input was skipped for a reason this version does not recognize.',
  'workspaceImportReview.guidance.chooseSupportedContent':
    'Provide recognizable ARIS AML/XML content and review it again.',
  'workspaceImportReview.guidance.chooseArisOnlyContent':
    'Export ARIS AML/XML from the source system, then review that import again.',
  'workspaceImportReview.guidance.useSafePath':
    'Choose a safe relative destination whose parent folders are inside the workspace.',
  'workspaceImportReview.guidance.repairBpmn':
    'Correct the BPMN validation findings, then rebuild and review the import plan.',
  'workspaceImportReview.guidance.reviewArisExport':
    'Check the ARIS export and conversion report, then export or convert the model again.',
  'workspaceImportReview.guidance.resolveProcessIdentity':
    'Resolve the process ID and workspace-path conflict, then create a new review plan.',
  'workspaceImportReview.guidance.repeatReview':
    'Refresh the workspace and repeat the import review against the current process identities.',
  'workspaceImportReview.guidance.completeLocalization':
    'Complete the bilingual review and resolve every localization finding before importing.',
  'workspaceImportReview.guidance.reduceLibraryEntry':
    'Reduce or split the BPMN file so the archive entry stays within the safe size limit.',
  'workspaceImportReview.guidance.decodeUtf8':
    'Re-encode the BPMN file as valid UTF-8 and rebuild the ZIP library.',
  'workspaceImportReview.guidance.reviewArisReport':
    'Review the downloadable ARIS conversion report and verify the converted model.',
  'workspaceImportReview.guidance.reviewReplacement':
    'Confirm that each listed process should be replaced only at the reviewed workspace path.',
  'workspaceImportReview.guidance.unknown':
    'Review the labeled technical evidence, correct the source, and create a new import plan.',
  'workspaceImportReview.message': 'Message',
  'workspaceImportReview.suggestedRepair': 'Suggested repair',
  'workspaceImportReview.technicalCode': 'Technical code',
  'workspaceImportReview.technicalDiagnostic': 'Technical diagnostic',
  'workspaceImportReview.validationSeverity': 'Validation severity',
  'workspaceImportReview.validationSource': 'Validation source',
  'workspaceImportReview.validationSeverityUnknown': 'Unknown validation severity',
  'workspaceImportReview.validationSourceUnknown': 'Unknown validation source',
  'workspaceImportReview.validationCode': 'Validation code',
  'workspaceImportReview.validationRuleId': 'Validation rule ID',
  'workspaceImportReview.validationDiagnostic': 'Validation diagnostic',
  'workspaceImportReview.warnings': 'Warnings',
  'workspaceImportReview.warningItem': 'Warning {index}',
  'workspaceImportReview.warning.amlDowngraded':
    'ARIS conversion simplified {count} source decision(s).',
  'workspaceImportReview.warning.amlIgnored': 'ARIS conversion ignored {count} source decision(s).',
  'workspaceImportReview.warning.amlAmbiguous':
    'ARIS conversion found {count} ambiguous source decision(s).',
  'workspaceImportReview.warning.amlUnmapped':
    'ARIS conversion could not map {count} source decision(s).',
  'workspaceImportReview.warning.samePathProcessReplacement':
    '{count} existing process ID(s) will be replaced at the same reviewed workspace path.',
  'workspaceImportReview.warning.unknown':
    'The import planner reported a warning this version does not recognize.',
  'workspaceImportReview.code': 'Code',
  'workspaceImportReview.count': 'Count',
  'workspaceImportReview.validationIssue': 'Validation issue',
  'workspaceImportReview.repairs': 'Automatic repairs',
  'workspaceImportReview.repairItem': 'Repair {index}',
  'workspaceImportReview.appliedRepair.amlConverted':
    'ARIS AML was converted into reviewed BPMN 2.0 output.',
  'workspaceImportReview.appliedRepair.autoLayout':
    'Missing BPMN diagram information was generated and the exact output was revalidated.',
  'workspaceImportReview.appliedRepair.destinationNormalized':
    'The destination was normalized to a portable BPMN workspace path.',
  'workspaceImportReview.appliedRepair.destinationDeduplicated':
    'The destination was changed to avoid another artifact in this plan.',
  'workspaceImportReview.appliedRepair.destinationCaseNormalized':
    'The destination letter case was normalized to the existing workspace path.',
  'workspaceImportReview.appliedRepair.unknown':
    'The planner applied an automatic repair this version does not recognize.',
  'workspaceImportReview.before': 'Before',
  'workspaceImportReview.after': 'After',
  'workspaceImportReview.aris': 'ARIS conversion reports',
  'workspaceImportReview.arisItem': 'ARIS report {index}: {name}',
  'workspaceImportReview.aris.converted': 'Converted',
  'workspaceImportReview.aris.downgraded': 'Downgraded',
  'workspaceImportReview.aris.ignored': 'Ignored',
  'workspaceImportReview.aris.ambiguous': 'Ambiguous',
  'workspaceImportReview.aris.unmapped': 'Unmapped',
  'workspaceImportReview.reportFile': 'Report file',
  'workspaceImportReview.arisDownload': 'Download ARIS report',
  'workspaceImportReview.arisDownloadUnavailable': 'Report download is unavailable.',
  'workspaceImportReview.collisions': 'Destination collisions',
  'workspaceImportReview.collisionItem': 'Collision {index}: {path}',
  'workspaceImportReview.incomingHash': 'Incoming SHA-256',
  'workspaceImportReview.existingHash': 'Existing SHA-256',
  'workspaceImportReview.suggestedKeepBoth': 'Suggested keep-both destination',
  'workspaceImportReview.identical': 'Identical file — the default and only action is skip.',
  'workspaceImportReview.decision': 'Collision decision',
  'workspaceImportReview.decision.choose': 'Choose an action…',
  'workspaceImportReview.decision.replace': 'Replace existing file',
  'workspaceImportReview.decision.skip': 'Skip this file',
  'workspaceImportReview.decision.keepBoth': 'Keep both files',
  'workspaceImportReview.keepBothDestination': 'Keep-both destination',
  'workspaceImportReview.keepBoth.adapterDisabled':
    'Keep both is unavailable because this workspace adapter cannot create multiple files.',
  'workspaceImportReview.keepBoth.identityDisabled':
    'Keep both is unavailable because this artifact replaces existing process identities.',
  'workspaceImportReview.keepBoth.invalid': 'Enter a valid relative workspace file path.',
  'workspaceImportReview.keepBoth.reserved':
    'The reserved .orbitpm workspace namespace cannot be an import destination.',
  'workspaceImportReview.keepBoth.occupied':
    'This destination is already occupied by an artifact in the reviewed plan.',
  'workspaceImportReview.keepBoth.duplicate':
    'Two keep-both decisions cannot use the same destination.',
  'workspaceImportReview.reservedPlanDestination':
    'Confirmation is blocked because the plan contains a reserved .orbitpm destination.',
  'workspaceImportReview.blocked': 'This import plan is blocked and cannot be confirmed.',
  'workspaceImportReview.unresolved':
    '{count} non-identical collision decision(s) still require an explicit choice.',
  'workspaceImportReview.invalidDecision':
    'Fix every invalid keep-both destination before confirming.',
  'workspaceImportReview.ready': 'The reviewed plan is ready for explicit confirmation.',
  'workspaceImportReview.error': 'Import error',
  'workspaceImportReview.errorSummary':
    'The workspace import could not be completed. Review the technical evidence, then retry or cancel.',
  'workspaceImportReview.busy': 'The workspace import is being applied…',
  'workspaceImportReview.cancel': 'Cancel import',
  'workspaceImportReview.confirm': 'Confirm import',
  'workspaceImportReview.confirming': 'Confirming…',

  // --- Workspace storage modes / recovery ---
  'workspace.storage.current': 'Storage: {mode}',
  'workspace.storage.mode.directory': 'Folder workspace',
  'workspace.storage.mode.opfs': 'Browser workspace',
  'workspace.storage.mode.singleFile': 'Single file',
  'workspace.storage.persistence.directory': 'Files persist in the folder you selected.',
  'workspace.storage.persistence.opfsDurable': 'Browser storage is durable on this device.',
  'workspace.storage.persistence.opfsBestEffort':
    'Browser storage is best-effort; export backups regularly.',
  'workspace.storage.persistence.singleFile':
    'Saving downloads a BPMN file; no workspace is retained.',
  'workspace.storage.chooseDirectory': 'Choose folder workspace',
  'workspace.storage.openOpfs': 'Open browser workspace',
  'workspace.storage.opfsOpenFailed':
    'The browser workspace could not be opened. Try again or choose another storage option.',
  'workspace.storage.opfsOpenTechnicalEvidence':
    'Technical evidence — browser workspace open: {error}',
  'workspace.storage.openSingleFile': 'Open a single ARIS AML/XML file',
  'workspace.storage.backupExport': 'Export workspace backup',
  'workspace.storage.backupImport': 'Import workspace backup',
  'workspace.storage.collisionReview': 'Review backup file collisions',
  'workspace.storage.collisionReplace': 'Replace existing file',
  'workspace.storage.collisionSkip': 'Skip this file',
  'workspace.storage.collisionKeepBoth': 'Keep both files',
  'workspace.storage.collisionIdentical': 'Identical file — no change needed',
  'workspace.storage.backupApply': 'Apply backup import',
  'workspace.storage.backupReview.intro':
    'Review the exact sealed backup plan and active BPMN localization evidence before applying. Closing this dialog changes no workspace files.',
  'workspace.storage.backupReview.summary': '{files} files · {size}',
  'workspace.storage.backupReview.sealedPlan': 'Sealed backup plan',
  'workspace.storage.backupReview.planReviewDigest': 'Plan review digest (SHA-256)',
  'workspace.storage.backupReview.localizationTitle': 'Active BPMN localization evidence',
  'workspace.storage.backupReview.localizationIntro':
    'Each active BPMN below completed reviewed localization. Reserved internal history BPMN remains exact recovery evidence and is reviewed only when restored.',
  'workspace.storage.backupReview.localizationNone':
    'No active BPMN files require localization evidence.',
  'workspace.storage.backupReview.file': 'Reviewed BPMN {index}',
  'workspace.storage.backupReview.path': 'Workspace path',
  'workspace.storage.backupReview.mode': 'Review mode',
  'workspace.storage.backupReview.mode.automatic': 'Automatically complete',
  'workspace.storage.backupReview.mode.explicit': 'Explicitly reviewed',
  'workspace.storage.backupReview.target': 'Target language',
  'workspace.storage.backupReview.target.en': 'English',
  'workspace.storage.backupReview.target.ar': 'Arabic',
  'workspace.storage.backupReview.localizationReviewDigest': 'Localization review digest',
  'workspace.storage.backupReview.outputDigest': 'Reviewed output digest',
  'workspace.storage.backupReview.processIds': 'Process IDs',
  'workspace.storage.backupReview.replacesProcessIds': 'Replaced process IDs',
  'workspace.storage.backupReview.audit': 'Localization audit',
  'workspace.storage.backupReview.auditSummary':
    '{initial} issues before review · {final} after review',
  'workspace.storage.backupReview.patches': 'Applied localization changes',
  'workspace.storage.backupReview.verified':
    'Visible target language and unknown-extension preservation verified.',
  'workspace.storage.backupReview.none': 'None',
  'workspace.storage.backupReview.collisions': 'File collisions',
  'workspace.storage.backupReview.collisionDecision': 'Collision decision',
  'workspace.storage.backupReview.keepBothIdentityDisabled':
    'Keep both is unavailable because this BPMN replaces existing process identities.',
  'workspace.storage.history': 'Recovery history',
  'workspace.storage.switchWarning':
    'Switching storage closes the current workspace. Save or export a backup first.',
  'workspace.duplicate.title': 'Process ID {id} appears in multiple files: {paths}',
  'workspace.duplicate.repair': 'Repair duplicate process IDs',
  'workspace.history.preview': 'Preview revision',
  'workspace.history.diff': 'Compare with current',
  'workspace.history.restore': 'Restore revision',
  'workspace.history.restoreCopy': 'Restore as a copy',
  'workspace.history.empty': 'No recovery revisions are available for this file.',
  'workspace.history.pageEmpty': 'No recovery revisions are available on this page.',
  'workspace.history.pagination.label': 'Recovery history pages',
  'workspace.history.pagination.status': 'History page {page}. Showing {count} entries.',
  'workspace.history.pagination.previous': 'Previous page',
  'workspace.history.pagination.next': 'Next page',
  'workspace.history.reason.overwrite': 'Before overwrite',
  'workspace.history.reason.delete': 'Before deletion',
  'workspace.history.reason.restore': 'Before restore',
  'workspace.history.reason.manual': 'Manual revision',
  'workspace.history.reason.backupImport': 'Before backup import',
  'workspace.history.reason.unknown': 'Unknown revision reason',
  'workspace.history.copyPrompt': 'File name for the restored copy',
  'workspace.history.copyDestinationRequired': 'Enter a destination for the restored copy.',
  'workspace.history.copyDestinationInvalid':
    '“{destination}” is not a valid relative BPMN file path. Use a file name ending in .bpmn.',
  'workspace.history.copyFailed': 'Restore-as-copy did not complete ({outcome}).',
  'workspace.history.restoreFailed': 'History restore failed: {error}',
  'workspace.history.restoreNotComplete': 'Restore did not complete ({outcome}).',
  'workspace.history.action.listFailed': 'Could not load recovery history.',
  'workspace.history.action.previewFailed': 'Could not preview this history revision.',
  'workspace.history.action.diffFailed': 'Could not compare this history revision.',
  'workspace.history.action.restoreFailed': 'Could not restore this history revision.',
  'workspace.history.action.restoreCopyFailed':
    'Could not restore this history revision as a copy.',
  'workspace.history.action.workspaceRefreshAfterRestoreFailed':
    'The revision was restored in storage, but the workspace could not be refreshed.',
  'workspace.history.action.sessionRefreshAfterRestoreFailed':
    'The revision was restored in storage, but the open session could not be refreshed.',
  'workspace.history.action.technicalDetails': 'Technical details:',
  'workspace.history.restoreCancelled': 'History restore was cancelled.',
  'workspace.history.applyEditorChangedBefore':
    'The open editor changed before history XML was applied.',
  'workspace.history.applyEditorSynchronizationUnavailable':
    'The editor synchronization command is not ready.',
  'workspace.history.applyTargetSessionChanged':
    'The history target session changed while XML was applied.',
  'workspace.history.applyLiveEditorUnverified':
    'History XML was applied, but the live editor could not be verified: {error}',
  'workspace.history.applyEditorChangedDuring':
    'The open editor changed while history XML was applied.',
  'workspace.history.restoreReason.cancelled': 'The restore was cancelled',
  'workspace.history.restoreReason.reviewRequired': 'Additional review is required',
  'workspace.history.restoreReason.stale': 'The workspace changed before restore',
  'workspace.history.restoreReason.unknown': 'The restore could not be prepared',
  'workspace.history.saveOutcome.permissionLoss': 'Workspace permission was lost',
  'workspace.history.saveOutcome.externalConflict': 'The destination changed ({reason})',
  'workspace.history.saveOutcome.staleWorkspace': 'The active workspace changed',
  'workspace.history.saveOutcome.cancelled': 'The storage write was cancelled',
  'workspace.history.saveOutcome.storageFailure': 'The storage write failed',
  'workspace.history.saveOutcome.unknown': 'An unknown storage result was returned',
  'workspace.history.conflictReason.hashMismatch': 'the file contents changed',
  'workspace.history.conflictReason.missing': 'the file is missing',
  'workspace.history.conflictReason.alreadyExists': 'the file already exists',
  'workspace.history.conflictReason.unknown': 'an unknown conflict occurred',
  'workspace.history.issue.unreadable': 'Could not read history metadata for “{path}”.',
  'workspace.history.issue.invalidMetadata': 'History metadata for “{path}” is invalid.',
  'workspace.history.issue.missingContent':
    'History metadata for “{path}” refers to missing revision content.',
  'workspace.history.issue.checksumMismatch':
    'The saved revision for “{path}” failed checksum verification.',
  'workspace.history.issue.orphanContent': 'Unreferenced recovery content was found at “{path}”.',
  'workspace.history.issue.retentionLimit':
    'Recovery history reached its storage limit; newest process revisions were preserved.',
  'workspace.history.issue.unknown': 'A history entry for “{path}” could not be loaded.',
  'workspace.history.restoreWorkspaceRefreshFailed':
    'The revision was restored in storage, but the workspace could not be refreshed: {error}',
  'workspace.history.restoreSessionRefreshFailed':
    'The revision was restored in storage, but the open session could not be refreshed: {error}',
  'workspace.history.unknownError': 'No additional error details were provided.',
  'workspace.history.unavailable':
    'History restore is unavailable because the workspace session is no longer active.',
  'workspace.history.current': 'Current file',
  'workspace.history.previewTruncated':
    'This revision preview is limited to the first {shown} characters for safety; {omitted} characters are not displayed. Restore still uses the complete revision.',
  'workspace.history.diffBounded':
    'A bounded replacement block is shown because detailed line alignment exceeded the safe work limit.',
  'workspace.history.diffTruncated':
    'This comparison preview is incomplete and was limited for safety. Omitted: {rows} rows, {characters} characters, {hunks} hunks, and {operations} alignment operations.',
  'workspace.history.diffInputTruncated':
    'Detailed input limits were exceeded by {oldCharacters} revision characters and {newCharacters} current characters, plus {oldLines} revision lines and {newLines} current lines.',
  'workspace.history.liveEditorUnverifiedAfterRestore':
    'History storage was restored, but the live editor could not be verified.',
  'workspace.history.newerRevisionBeforeCleanup':
    'A newer editor revision arrived before history cleanup completed.',
  'workspace.history.liveEditorUnverifiedAfterCleanup':
    'History cleanup completed, but the live editor could not be verified.',
  'workspace.history.newerRevisionDuringCleanup':
    'A newer editor revision arrived during history cleanup.',
  'workspace.history.editorRefreshIncompleteAfterRestore':
    'History storage was restored, but the editor refresh did not complete.',
  'workspace.diagnostic.none': 'none',
  'workspace.diagnostic.complete': 'complete',
  'workspace.diagnostic.unknown': 'unknown',
  'workspace.import.rollbackEvidence':
    '{error}; review: {review}; applied: {applied}; rollback: {rollback}',
  'workspace.import.postCommitReconciliationFailed':
    'Workspace import storage committed, but the open workspace could not be reconciled. Review technical evidence before continuing.',
  'workspace.import.postCommitWarning':
    'The workspace import completed, but recovery-history cleanup needs attention.',
  'workspace.import.postCommitTechnicalEvidence':
    'Technical evidence — post-commit workspace import: {error}',
  'workspace.backup.rollbackEvidence': '{error}; applied: {applied}; rollback: {rollback}',
  'workspace.backup.historyRetentionFailed':
    'The backup import completed, but recovery-history cleanup failed.',
  'workspace.backup.historyRetentionTechnicalEvidence':
    'Technical evidence — backup history retention: {error}',
  'workspace.backup.postCommitReconciliationFailed':
    'Backup storage committed, but the open workspace could not be reconciled. Review technical evidence before continuing.',
  'workspace.backup.postCommitTechnicalEvidence':
    'Technical evidence — post-commit backup import: {error}',
  'workspace.localization.workspaceImportRollbackUncertain':
    'Workspace import rollback left localization resources uncertain.',
  'workspace.localization.backupRollbackUncertain':
    'Backup rollback left localization resources uncertain.',
  'workspace.localization.backupCommittedReloadFailed':
    'Backup committed localization resources could not be reloaded.',
  'workspace.sync.reviewedImportEditorChanged':
    'The open editor changed while the reviewed import committed.',
  'workspace.sync.reviewedImportLocalRetained':
    'The open editor changed while the reviewed import committed; its local XML was retained as a recovery draft.',
  'workspace.sync.committedReloadEditorChanged':
    'The open editor changed while committed XML was being reloaded.',
  'workspace.sync.committedReloadLocalRetained':
    'The open editor changed while committed XML was being reloaded; its newer local XML was retained as a recovery draft.',
  'workspace.sync.postCommitCleanupLocalRetained':
    'The open editor changed during post-commit cleanup; its newer local XML was retained as a recovery draft.',
  'workspace.manifest.warning': 'Workspace manifest warning at “{path}”: {error}',
  'workspace.manifest.postCommitError':
    'Your change was saved, but the workspace manifest could not be updated: {error}',
  'workspace.manifest.repaired': 'Workspace manifest repaired.',
  'workspace.manifest.retryFailed': 'Workspace manifest repair failed: {error}',
  'workspace.manifest.retryTitle': 'Repair workspace manifest?',
  'workspace.manifest.retryMessage':
    'Your files are saved, but workspace metadata is out of date: {error}',
  'workspace.manifest.retryAction': 'Retry repair',
  'workspace.path.finalizeWarning':
    'The change to “{path}” was committed, but cleanup could not finish. Recovery data was kept: {error}',
  'workspace.path.dirtyTitle': 'Unsaved changes in affected documents',
  'workspace.path.dirtyMessage':
    '{operation} “{path}” affects {count} unsaved documents. Save them before continuing, continue without saving, or cancel.',
  'workspace.path.operation.rename': 'Renaming',
  'workspace.path.operation.move': 'Moving',
  'workspace.path.operation.delete': 'Deleting',
  'workspace.path.operation.history': 'Restoring history',
  'workspace.path.saveContinue': 'Save and continue',
  'workspace.path.continueWithoutSaving': 'Continue without saving',
  'workspace.path.cancel': 'Cancel',
  'workspace.path.recoveryTitle': 'Finish committed change cleanup',
  'workspace.path.recoveryMessage':
    'The change to “{path}” was committed, but recovery cleanup did not finish: {error}',
  'workspace.path.recoveryRetry': 'Retry cleanup',
  'workspace.path.recoveryLater': 'Keep recovery data for later',
  'workspace.path.recoverySuccess': 'Recovery cleanup completed.',
  'workspace.path.recoveryFailed': 'Recovery cleanup failed: {error}',
  'workspace.path.unavailable':
    'This workspace operation is no longer available because the workspace changed.',
  'workspace.path.saveFailed': 'Could not save an affected document: {error}',
  'workspace.path.failed': 'The workspace operation failed: {error}',
  'workspace.create.stale': 'The workspace changed before the item could be created. Try again.',
  'workspace.create.failed': 'The item could not be created ({status}).',
  'workspace.create.noAvailableName': 'No collision-free file name is available.',
  'draftRecovery.title': 'Review recovery draft',
  'draftRecovery.summary':
    'An unsaved draft for “{title}” was found from {timestamp}. Status: {relation}. Nothing will be replaced until you choose.',
  'draftRecovery.saved': 'Saved version',
  'draftRecovery.draft': 'Recovery draft',
  'draftRecovery.download': 'Download draft',
  'draftRecovery.discard': 'Keep saved and discard draft',
  'draftRecovery.restore': 'Restore draft',
  'draftRecovery.relation.same-content': 'content matches',
  'draftRecovery.relation.same-base': 'draft is based on the current saved version',
  'draftRecovery.relation.base-diverged': 'saved content changed after this draft was created',
  'draftRecovery.relation.unknown-base': 'the draft base could not be verified',
  'draftRecovery.error': 'Draft recovery failed: {error}',
  'draftRecovery.degraded':
    'Persistent draft recovery is unavailable in this browser session. Unsaved drafts can be downloaded, but they will not survive a reload.',
  'workspace.coordination.error': 'Workspace coordination failed: {error}',
  'workspace.coordination.changed':
    '“{path}” changed in another OrbitPM tab. Your local draft was kept; review it before saving.',
  'session.save.externalConflict':
    '“{path}” changed outside this tab ({reason}). Saving was stopped and your local draft was kept.',
  'session.save.reloadEditorFailed':
    'The disk version was selected, but the live editor could not be refreshed. The session may still show your prior edits; review it before continuing: {error}',
  'session.save.liveXmlCaptureDetail': '{error}; live XML capture: {captureError}',
  'session.save.localCanvasRecoveryDetail': '{error}; local canvas recovery: {recoveryError}',
  'session.save.retainedEditorCaptureFailed':
    '{reason} Live XML capture failed, so the canvas was left untouched and marked dirty: {error}',
  'session.save.retainedEditorChangedDuringRecovery':
    '{reason} The editor kept changing during recovery; its canvas was left untouched and remains dirty.',
  'session.save.locked':
    'Another OrbitPM tab is saving this file. Wait briefly and try again; your local draft was kept.',
  'session.save.failed': 'Save did not complete ({status}). Your local draft was kept.',
  'session.save.preservationBlocked':
    'Save was blocked because protected BPMN extension data changed. Your local draft was kept.',
  'session.save.preservationTechnicalEvidence':
    'Technical evidence — preservation issue codes: {codes}',
  'session.save.permissionLoss':
    'Save could not continue because workspace access was lost. Your local draft was kept.',
  'session.save.storageFailure':
    'Save could not be written to workspace storage. Your local draft was kept.',
  'session.save.storageTechnicalEvidence': 'Technical evidence — save storage ({code}): {error}',
  'session.save.newerEdits': 'The captured version was saved, but newer edits remain unsaved.',
  'session.download.draftRetained':
    'The BPMN download was prepared. The session remains unsaved and its recovery draft was retained until a durable save or explicit discard.',
  'session.conflict.title': '“{path}” changed on disk',
  'session.conflict.message':
    'This file changed outside this tab. Your local edits are still intact. Choose how to resolve the conflict.',
  'session.conflict.compare': 'Compare versions',
  'session.conflict.local': 'Your edits',
  'session.conflict.external': 'Disk version',
  'session.conflict.externalMissing': 'The file no longer exists on disk.',
  'session.conflict.reload': 'Reload disk version',
  'session.conflict.overwrite': 'Overwrite disk version',
  'session.conflict.saveAs': 'Save as a new file',
  'session.conflict.saveAsLabel': 'New relative .bpmn path',
  'session.conflict.invalidDestination': 'Enter a valid relative .bpmn path for Save As.',
  'session.conflict.cancel': 'Keep editing',

  // --- Spreadsheet import ---
  'spreadsheet.tab': 'Excel / CSV',
  'spreadsheet.title': 'Import Excel or CSV',
  'spreadsheet.intro':
    'Build validated BPMN processes locally from an .xlsx or UTF-8 .csv file. Spreadsheet data never leaves this browser.',
  'spreadsheet.template.blank': 'Download blank template',
  'spreadsheet.template.example': 'Download example template',
  'spreadsheet.upload': 'Choose .xlsx or .csv',
  'spreadsheet.uploadHint': 'Excel (.xlsx only) or UTF-8 CSV',
  'spreadsheet.parsing': 'Reading spreadsheet…',
  'spreadsheet.cancel': 'Cancel',
  'spreadsheet.cancelling': 'Cancelling…',
  'spreadsheet.cancelled': 'Operation cancelled.',
  'spreadsheet.progress': '{phase}: {percent}%',
  'spreadsheet.reset': 'Start over',
  'spreadsheet.officialDetected':
    'Official OrbitPM template detected ({version}). Mapping was applied automatically.',
  'spreadsheet.ordinaryDetected':
    'Ordinary spreadsheet detected. Review the sheet and column mapping.',
  'spreadsheet.mapping.title': 'Map spreadsheet columns',
  'spreadsheet.mapping.presetName': 'Preset name',
  'spreadsheet.mapping.sheet': 'Worksheet',
  'spreadsheet.mapping.noSheet': 'Not used',
  'spreadsheet.mapping.headerRow': 'Header row',
  'spreadsheet.mapping.required': 'required',
  'spreadsheet.mapping.oneLanguageRequired': 'at least one language required',
  'spreadsheet.mapping.confidence': '{percent}% confidence',
  'spreadsheet.mapping.confirm': 'I confirm this low-confidence required mapping',
  'spreadsheet.mapping.delimiters': 'List delimiters',
  'spreadsheet.mapping.flowMode': 'Flow inference',
  'spreadsheet.mapping.flow.auto': 'Auto',
  'spreadsheet.mapping.flow.explicit': 'Explicit source/target',
  'spreadsheet.mapping.flow.next': 'Next-step columns',
  'spreadsheet.mapping.flow.order': 'Numeric order',
  'spreadsheet.mapping.role.processes': 'Processes and destination',
  'spreadsheet.mapping.role.participants': 'Pools and lanes',
  'spreadsheet.mapping.role.steps': 'Steps, IDs, order, type, bilingual details',
  'spreadsheet.mapping.role.flows': 'Source/target flows and conditions',
  'spreadsheet.mapping.role.glossary': 'Glossary',
  'spreadsheet.mapping.defaultProcessId': 'Default process ID',
  'spreadsheet.mapping.defaultNameEn': 'Default process name (English)',
  'spreadsheet.mapping.defaultNameAr': 'Default process name (Arabic)',
  'spreadsheet.mapping.saveDraft': 'Save draft',
  'spreadsheet.mapping.draftSaved': 'Mapping draft saved locally.',
  'spreadsheet.mapping.exportPreset': 'Export preset',
  'spreadsheet.mapping.importPreset': 'Import preset',
  'spreadsheet.mapping.presetLoaded': 'Mapping preset loaded.',
  'spreadsheet.destination.title': 'Destination',
  'spreadsheet.destination.folder': 'Destination folder',
  'spreadsheet.destination.collision': 'If a file already exists',
  'spreadsheet.destination.error': 'Stop and report',
  'spreadsheet.destination.overwrite': 'Overwrite after recovery copy',
  'spreadsheet.destination.rename': 'Create a numbered name',
  'spreadsheet.review': 'Validate and preview',
  'spreadsheet.reviewing': 'Validating workbook…',
  'spreadsheet.validation.title': 'Workbook validation',
  'spreadsheet.validation.summary': '{errors} errors · {reviews} reviews · {warnings} warnings',
  'spreadsheet.validation.location': '{sheet} {cell}',
  'spreadsheet.validation.worksheet': 'Worksheet',
  'spreadsheet.validation.cell': 'Cell',
  'spreadsheet.validation.rawValue': 'Raw value',
  'spreadsheet.validation.normalizedValue': 'Normalized value',
  'spreadsheet.validation.guidance': 'Repair guidance',
  'spreadsheet.validation.issueFallback': 'Review this workbook issue.',
  'spreadsheet.validation.guidanceFallback':
    'Correct the source value or mapping, then validate again.',
  'spreadsheet.validation.bilingual-audit-failed':
    'The bilingual audit could not validate this process.',
  'spreadsheet.validation.branch-topology-requires-explicit-conditions':
    'This branch needs explicit targets and conditions.',
  'spreadsheet.validation.cached-formula-value':
    'A cached formula result was imported; verify that it is current.',
  'spreadsheet.validation.called-process-on-non-call-activity':
    'A called process is assigned to an element that is not a call activity.',
  'spreadsheet.validation.called-process-reviewed-unlinked':
    'The missing called process was explicitly reviewed as unlinked.',
  'spreadsheet.validation.called-process-unresolved':
    'The called process does not exist in this import or workspace.',
  'spreadsheet.validation.data-connections-ignored':
    'Workbook data connections were ignored for safety.',
  'spreadsheet.validation.default-flow-has-condition':
    'A default flow must not also have a condition.',
  'spreadsheet.validation.default-flow-source-invalid':
    'This element type cannot own a default flow.',
  'spreadsheet.validation.destination-folder-unsafe':
    'The destination folder is not a safe relative path.',
  'spreadsheet.validation.destination-hash-missing':
    'The overwrite target has no verifiable content hash.',
  'spreadsheet.validation.destination-inspection-failed':
    'The destination could not be inspected safely.',
  'spreadsheet.validation.destination-path-collision':
    'More than one process resolves to the same destination path.',
  'spreadsheet.validation.destination-process-id-collision':
    'This process ID already exists in the destination workspace.',
  'spreadsheet.validation.diagram-readability':
    'This process may be difficult to read because it contains many nodes.',
  'spreadsheet.validation.duplicate-numeric-order':
    'Numeric step order values must be unique within a process.',
  'spreadsheet.validation.end-event-missing': 'The process has no End event.',
  'spreadsheet.validation.end-event-outgoing': 'An End event cannot have outgoing flows.',
  'spreadsheet.validation.event-definition-on-non-event':
    'An event definition is assigned to an element that is not an event.',
  'spreadsheet.validation.explicit-flows-required':
    'Explicit flow mode requires a Flows sheet with source and target values.',
  'spreadsheet.validation.external-links-ignored':
    'External workbook links were ignored for safety.',
  'spreadsheet.validation.flow-duplicate-edge':
    'The same source-to-target flow is defined more than once.',
  'spreadsheet.validation.flow-id-duplicate': 'This flow ID is duplicated in its process.',
  'spreadsheet.validation.flow-id-invalid': 'This flow ID is not a valid BPMN identifier.',
  'spreadsheet.validation.flow-id-missing': 'A flow is missing its required ID.',
  'spreadsheet.validation.flow-self-loop-review':
    'This flow returns to the same element and needs review.',
  'spreadsheet.validation.flow-source-missing': 'The flow source does not exist in this process.',
  'spreadsheet.validation.flow-target-missing': 'The flow target does not exist in this process.',
  'spreadsheet.validation.formula-without-cache':
    'A formula has no cached displayed value and cannot be imported.',
  'spreadsheet.validation.gateway-branch-count': 'A gateway must have enough outgoing branches.',
  'spreadsheet.validation.gateway-condition-not-allowed':
    'This gateway type does not allow conditional outgoing flows.',
  'spreadsheet.validation.gateway-condition-required':
    'Each non-default branch from this gateway needs a condition.',
  'spreadsheet.validation.gateway-default-not-allowed':
    'This gateway type does not allow a default flow.',
  'spreadsheet.validation.gateway-topology-not-inferred':
    'Gateway topology cannot be inferred safely from numeric order.',
  'spreadsheet.validation.glossary-entry-duplicate':
    'This glossary term is defined more than once.',
  'spreadsheet.validation.glossary-entry-incomplete':
    'A glossary entry needs both English and Arabic text.',
  'spreadsheet.validation.invalid-boolean': 'This value is not a recognized true or false value.',
  'spreadsheet.validation.low-confidence-mapping':
    'This required column mapping has low confidence and needs confirmation.',
  'spreadsheet.validation.mapped-header-duplicate':
    'The mapped header occurs more than once in the worksheet.',
  'spreadsheet.validation.mapped-header-missing':
    'The mapped header no longer exists in the worksheet.',
  'spreadsheet.validation.mapped-header-row-missing': 'The selected header row does not exist.',
  'spreadsheet.validation.mapped-next-step-required':
    'Next-step flow mode requires mapped next-step values.',
  'spreadsheet.validation.mapped-sheet-missing': 'The selected worksheet no longer exists.',
  'spreadsheet.validation.missing-required-mapping':
    'A required canonical field is not mapped to a column.',
  'spreadsheet.validation.missing-steps-sheet': 'Select a worksheet that contains process steps.',
  'spreadsheet.validation.model-version-unsupported':
    'This workbook model version is not supported.',
  'spreadsheet.validation.multiple-default-flows':
    'An element can have only one default outgoing flow.',
  'spreadsheet.validation.multiple-lane-assignments':
    'A step cannot be assigned to more than one lane.',
  'spreadsheet.validation.node-id-duplicate': 'This step ID is duplicated in its process.',
  'spreadsheet.validation.node-id-invalid': 'This step ID is not a valid BPMN identifier.',
  'spreadsheet.validation.node-id-missing': 'A step is missing its required ID.',
  'spreadsheet.validation.node-id-workbook-duplicate':
    'This step ID is duplicated elsewhere in the workbook.',
  'spreadsheet.validation.node-name-missing': 'A step needs an English or Arabic name.',
  'spreadsheet.validation.node-order-invalid': 'Step order must be a finite numeric value.',
  'spreadsheet.validation.node-participant-kind-mismatch':
    'The referenced participant is not the required pool or lane type.',
  'spreadsheet.validation.node-participant-missing':
    'The step references a participant that does not exist.',
  'spreadsheet.validation.node-process-limit': 'This process exceeds the maximum number of nodes.',
  'spreadsheet.validation.node-process-missing':
    'The step references a process that does not exist.',
  'spreadsheet.validation.node-transaction-limit':
    'This import exceeds the maximum total number of nodes.',
  'spreadsheet.validation.node-unreachable': 'This step cannot be reached from a Start event.',
  'spreadsheet.validation.numeric-order-required':
    'Numeric-order inference requires an order value for every step.',
  'spreadsheet.validation.official-template-header-mismatch':
    'An official template worksheet has unexpected headers.',
  'spreadsheet.validation.official-template-sheet-missing':
    'An official template worksheet is missing.',
  'spreadsheet.validation.official-template-version-unsupported':
    'This official template version is not supported.',
  'spreadsheet.validation.participant-id-duplicate':
    'This participant ID is duplicated in its process.',
  'spreadsheet.validation.participant-id-invalid':
    'This participant ID is not a valid BPMN identifier.',
  'spreadsheet.validation.participant-id-missing': 'A participant is missing its required ID.',
  'spreadsheet.validation.participant-name-missing':
    'A participant needs an English or Arabic name.',
  'spreadsheet.validation.participant-parent-cycle': 'Participant parent references form a cycle.',
  'spreadsheet.validation.participant-parent-missing': 'The parent participant does not exist.',
  'spreadsheet.validation.participant-process-missing':
    'The participant references a process that does not exist.',
  'spreadsheet.validation.pipeline-diagnostic':
    'The BPMN generation pipeline reported a validation diagnostic.',
  'spreadsheet.validation.pipeline-generation-failed':
    'BPMN generation failed before a valid artifact was produced.',
  'spreadsheet.validation.pool-parent-not-allowed': 'A pool cannot have a parent participant.',
  'spreadsheet.validation.process-id-duplicate': 'This process ID is duplicated.',
  'spreadsheet.validation.process-id-invalid': 'This process ID is not a valid BPMN identifier.',
  'spreadsheet.validation.process-id-missing': 'A process is missing its required ID.',
  'spreadsheet.validation.process-name-missing': 'A process needs an English or Arabic name.',
  'spreadsheet.validation.processes-empty': 'The workbook does not define any processes.',
  'spreadsheet.validation.raci-invalid':
    'The RACI value contains unsupported responsibility codes.',
  'spreadsheet.validation.start-event-incoming': 'A Start event cannot have incoming flows.',
  'spreadsheet.validation.start-event-missing': 'The process has no Start event.',
  'spreadsheet.validation.synthetic-boundary-confirmation-required':
    'Confirm the proposed Start and End events before generation.',
  'spreadsheet.validation.synthetic-end-ambiguous':
    'An End event cannot be added because the final step is ambiguous.',
  'spreadsheet.validation.synthetic-start-ambiguous':
    'A Start event cannot be added because the first step is ambiguous.',
  'spreadsheet.validation.translation-review-required':
    'English and Arabic process content must be reviewed before import.',
  'spreadsheet.validation.unknown-participant-type':
    'This participant type is unknown and needs an explicit mapping.',
  'spreadsheet.validation.unknown-step-type':
    'This step type is unknown and needs an explicit BPMN mapping.',
  'spreadsheet.guidance.choose-collision-behavior':
    'Choose whether to stop, overwrite with recovery history, or rename the file.',
  'spreadsheet.guidance.confirm-field-mapping':
    'Select the correct column and explicitly confirm the required mapping.',
  'spreadsheet.guidance.correct-source-and-revalidate':
    'Correct the referenced source value, then validate the workbook again.',
  'spreadsheet.guidance.map-participant-type': 'Map the raw participant label to Pool or Lane.',
  'spreadsheet.guidance.map-step-type': 'Map the raw step label to a supported BPMN element type.',
  'spreadsheet.guidance.refresh-destination-state':
    'Refresh the workspace and verify the destination before retrying.',
  'spreadsheet.guidance.replace-formula-with-value':
    'Replace the formula with a displayed value in the source workbook.',
  'spreadsheet.guidance.retry-destination-inspection':
    'Check workspace access, then inspect the destination again.',
  'spreadsheet.guidance.review-inference-inputs':
    'Review flow mode, order, next-step targets, and gateway conditions.',
  'spreadsheet.guidance.use-boolean': 'Use a recognized true/false or yes/no value.',
  'spreadsheet.guidance.verify-cached-formula-value':
    'Recalculate and save the workbook, then verify the displayed value.',
  'spreadsheet.validation.noIssues': 'No workbook issues found.',
  'spreadsheet.validation.mappingBlocked': 'Confirm every required mapping before review.',
  'spreadsheet.typeRepair.title': 'Map unknown spreadsheet types',
  'spreadsheet.typeRepair.guidance':
    'Choose the BPMN meaning for each raw type label, then validate again. The reviewed mappings are saved in this preset.',
  'spreadsheet.typeRepair.step': 'Step type “{value}”',
  'spreadsheet.typeRepair.participant': 'Participant type “{value}”',
  'spreadsheet.typeRepair.choose': 'Choose a type…',
  'spreadsheet.type.task': 'Task',
  'spreadsheet.type.userTask': 'User task',
  'spreadsheet.type.serviceTask': 'Service task',
  'spreadsheet.type.sendTask': 'Send task',
  'spreadsheet.type.receiveTask': 'Receive task',
  'spreadsheet.type.businessRuleTask': 'Business rule task',
  'spreadsheet.type.manualTask': 'Manual task',
  'spreadsheet.type.scriptTask': 'Script task',
  'spreadsheet.type.callActivity': 'Call activity',
  'spreadsheet.type.subProcess': 'Sub-process',
  'spreadsheet.type.startEvent': 'Start event',
  'spreadsheet.type.endEvent': 'End event',
  'spreadsheet.type.intermediateCatchEvent': 'Intermediate catch event',
  'spreadsheet.type.intermediateThrowEvent': 'Intermediate throw event',
  'spreadsheet.type.exclusiveGateway': 'Exclusive gateway',
  'spreadsheet.type.inclusiveGateway': 'Inclusive gateway',
  'spreadsheet.type.parallelGateway': 'Parallel gateway',
  'spreadsheet.type.complexGateway': 'Complex gateway',
  'spreadsheet.type.eventBasedGateway': 'Event-based gateway',
  'spreadsheet.type.pool': 'Pool',
  'spreadsheet.type.lane': 'Lane',
  'spreadsheet.repair.generatedIds': '{count} missing IDs will be generated deterministically.',
  'spreadsheet.repair.synthetic': '{count} Start/End boundaries are proposed.',
  'spreadsheet.repair.confirmSynthetic': 'Add the proposed bilingual Start/End events',
  'spreadsheet.repair.skippedRows': '{count} blank rows will be skipped.',
  'spreadsheet.preview.title': 'Read-only graph preview',
  'spreadsheet.preview.processes': '{count} processes',
  'spreadsheet.preview.nodes': '{count} nodes',
  'spreadsheet.preview.flows': '{count} flows',
  'spreadsheet.preview.process': 'Process',
  'spreadsheet.preview.node': 'Node',
  'spreadsheet.preview.type': 'Type',
  'spreadsheet.preview.fromTo': 'Flow',
  'spreadsheet.preview.participant': 'Pool / lane',
  'spreadsheet.preview.condition': 'Condition',
  'spreadsheet.preview.defaultFlow': 'Default flow',
  'spreadsheet.preview.generated': 'Generated ID',
  'spreadsheet.preview.origin.explicit': 'Explicit',
  'spreadsheet.preview.origin.mapped': 'Mapped',
  'spreadsheet.preview.origin.inferred': 'Inferred by order',
  'spreadsheet.preview.origin.synthetic': 'Synthetic boundary',
  'spreadsheet.preview.unassigned': 'Unassigned',
  'spreadsheet.translation.required':
    'Bilingual review required: {missing} missing and {invalid} invalid values.',
  'spreadsheet.translation.handoff': 'Open bilingual review',
  'spreadsheet.prepare': 'Prepare BPMN files',
  'spreadsheet.preparing': 'Generating and validating BPMN…',
  'spreadsheet.plan.blocked': 'Import is blocked until the listed issues are resolved.',
  'spreadsheet.plan.ready': '{count} BPMN files are ready. No destination has been changed yet.',
  'spreadsheet.commit': 'Commit import',
  'spreadsheet.committing': 'Writing all files atomically…',
  'spreadsheet.report.committed': 'Import committed successfully.',
  'spreadsheet.report.rolledBack': 'Import failed; destination changes were rolled back.',
  'spreadsheet.report.rollbackFailed':
    'Import failed and rollback needs attention. Recovery copies were retained.',
  'spreadsheet.report.destination': 'Destination',
  'spreadsheet.report.checksum': 'SHA-256',
  'spreadsheet.report.download': 'Download import report',
  'spreadsheet.error.parse': 'Could not read this spreadsheet.',
  'spreadsheet.error.preset': 'Could not import this mapping preset.',
  'spreadsheet.error.draftSave': 'Could not save this mapping draft.',
  'spreadsheet.error.review': 'Could not build the workbook model.',
  'spreadsheet.error.prepare': 'Could not prepare BPMN files.',
  'spreadsheet.error.bilingualReview': 'Could not complete the bilingual review handoff.',
  'spreadsheet.error.commit': 'Could not commit the spreadsheet import.',
  'spreadsheet.error.postCommit':
    'The import committed, but final workspace follow-up did not complete.',
  'spreadsheet.error.technicalEvidence': 'Technical evidence',
  'spreadsheet.error.technicalCode': 'Error code',
  'spreadsheet.error.technicalDetails': 'Structured details',
  'spreadsheet.error.limitContext': 'Detected {actual}; safe limit {limit}.',
  'spreadsheet.error.rowContext': 'The problem was detected near row {row}.',
  'spreadsheet.error.unsupported-format':
    'This file format is not supported. Choose an .xlsx or UTF-8 .csv file.',
  'spreadsheet.error.legacy-excel-format':
    'Legacy .xls workbooks are not supported. Save a copy as .xlsx or UTF-8 CSV.',
  'spreadsheet.error.macro-enabled-format':
    'Macro-enabled Excel files are not accepted. Save a macro-free .xlsx or CSV copy.',
  'spreadsheet.error.encrypted-workbook':
    'Encrypted or password-protected workbooks cannot be imported.',
  'spreadsheet.error.malformed-csv':
    'The CSV structure is malformed. Check quoting, delimiters, and row boundaries.',
  'spreadsheet.error.invalid-utf8': 'This CSV is not valid UTF-8. Resave it using UTF-8 encoding.',
  'spreadsheet.error.malformed-zip': 'The XLSX container is damaged or malformed.',
  'spreadsheet.error.zip64-unsupported':
    'ZIP64 workbooks are not supported. Export a standard .xlsx file.',
  'spreadsheet.error.multi-disk-zip': 'Multi-disk ZIP workbooks are not supported.',
  'spreadsheet.error.unsupported-compression':
    'The workbook uses an unsupported ZIP compression method.',
  'spreadsheet.error.unsafe-zip-path':
    'The workbook contains an unsafe internal path and was rejected.',
  'spreadsheet.error.duplicate-zip-entry':
    'The workbook contains duplicate internal entries and was rejected.',
  'spreadsheet.error.macro-content':
    'The workbook contains macro or executable content and was rejected.',
  'spreadsheet.error.missing-xlsx-part': 'The workbook is missing a required XLSX component.',
  'spreadsheet.error.compressed-size-limit':
    'The spreadsheet exceeds the safe compressed-size limit.',
  'spreadsheet.error.uncompressed-size-limit': 'The workbook exceeds the safe expanded-size limit.',
  'spreadsheet.error.worksheet-limit': 'The workbook contains too many worksheets.',
  'spreadsheet.error.row-limit': 'The spreadsheet contains too many rows.',
  'spreadsheet.error.column-limit': 'A spreadsheet row contains too many columns.',
  'spreadsheet.error.cell-count-limit': 'The spreadsheet contains too many non-empty cells.',
  'spreadsheet.error.cell-length-limit': 'A spreadsheet cell exceeds the safe text-length limit.',
  'spreadsheet.error.node-process-limit': 'A process contains too many BPMN nodes.',
  'spreadsheet.error.node-transaction-limit': 'This import contains too many BPMN nodes in total.',
  'spreadsheet.error.formula-without-cache':
    'A formula has no saved displayed value. Recalculate and save the workbook first.',
  'spreadsheet.error.parse-cancelled': 'Spreadsheet processing was cancelled.',
  'spreadsheet.error.adapter-contract-violation':
    'An internal spreadsheet boundary returned an invalid result. No destination changes were made.',
  'spreadsheet.error.invalid-mapping-preset':
    'This mapping preset or saved draft is invalid for the selected spreadsheet.',
  'spreadsheet.error.blocking-validation':
    'Workbook validation found blocking issues that must be resolved.',
  'spreadsheet.error.transaction-failed':
    'The spreadsheet import transaction failed. Review rollback status before retrying.',
  'spreadsheet.phase.preflight': 'Security preflight',
  'spreadsheet.phase.parse': 'Parsing',
  'spreadsheet.phase.validate': 'Validating',
  'spreadsheet.phase.buildModel': 'Building workbook model',
  'spreadsheet.phase.applyDestination': 'Applying destinations',
  'spreadsheet.phase.inferGraph': 'Inferring process graph',
  'spreadsheet.phase.applyInference': 'Applying reviewed inference',
  'spreadsheet.phase.validateModel': 'Validating process model',
  'spreadsheet.phase.generate': 'Generating BPMN files',
  'spreadsheet.phase.stage': 'Staging files',
  'spreadsheet.phase.commit': 'Committing files',
  'spreadsheet.phase.rollback': 'Rolling back changes',

  // --- Validation Center / source editor ---
  'validation.open': 'Validate',
  'validation.open.title': 'Open the Validation Center',
  'validation.title': 'Validation Center',
  'validation.close': 'Close',
  'validation.running': 'Validating…',
  'validation.summary': '{errors} errors · {warnings} warnings · {infos} information',
  'validation.errors': 'Errors',
  'validation.warnings': 'Warnings',
  'validation.infos': 'Information',
  'validation.valid': 'The BPMN document is valid.',
  'validation.invalid': 'The BPMN document has validation findings.',
  'validation.empty': 'No validation findings.',
  'validation.issues': 'Validation findings',
  'validation.pagination.label': 'Validation finding pages',
  'validation.pagination.status':
    'Showing findings {start}–{end} of {total}. Page {page} of {pages}.',
  'validation.pagination.previous': 'Previous page',
  'validation.pagination.next': 'Next page',
  'validation.source': 'Source',
  'validation.element': 'Element',
  'validation.location': 'Location',
  'validation.lineColumn': 'Line {line}, column {column}',
  'validation.focus': 'Focus element',
  'validation.repair': 'Repair',
  'validation.export': 'Export report',
  'validation.export.title': 'Download the validation report',
  'validation.severity.error': 'Error',
  'validation.severity.review': 'Review',
  'validation.severity.warning': 'Warning',
  'validation.severity.info': 'Information',
  'validation.stage.xsd': 'BPMN schema',
  'validation.stage.xml': 'XML syntax',
  'validation.stage.moddle': 'BPMN model',
  'validation.stage.preservation': 'Data preservation',
  'validation.stage.bpmnlint': 'BPMN lint',
  'validation.stage.structure': 'Structure',
  'validation.stage.semantic': 'Semantics',
  'validation.stage.di': 'Diagram interchange',
  'validation.stage.orbitpm': 'OrbitPM metadata',
  'validation.suggestedRepair': 'Suggested repair',
  'validation.technicalEvidence': 'Technical evidence',
  'validation.technical.code': 'Code',
  'validation.technical.ruleId': 'Rule ID',
  'validation.technical.diagnostic': 'Raw diagnostic',
  'validation.technical.truncated':
    'This diagnostic is shortened in the view. Export the report for the complete detail.',
  'validation.issue.xml.empty': 'The XML document is empty.',
  'validation.issue.xml.size-limit': 'The XML document exceeds the safe input size limit.',
  'validation.issue.xml.illegal-character':
    'The document contains a character that XML 1.0 does not allow.',
  'validation.issue.xml.unsupported-encoding':
    'The declared character encoding is not supported after text decoding.',
  'validation.issue.xml.doctype': 'The document contains a forbidden DOCTYPE declaration.',
  'validation.issue.xml.entity-declaration':
    'The document contains a forbidden entity declaration.',
  'validation.issue.xml.external-include':
    'The document contains a forbidden external XML include.',
  'validation.issue.xml.processing-instruction':
    'The document contains a processing instruction that is not allowed.',
  'validation.issue.xml.declaration-position':
    'The XML declaration is not the first item in the document.',
  'validation.issue.xml.text-limit': 'An XML text or CDATA node exceeds the safe length limit.',
  'validation.issue.xml.attribute-count-limit':
    'An XML element has more attributes than the safe limit.',
  'validation.issue.xml.attribute-value-limit':
    'An XML attribute value exceeds the safe length limit.',
  'validation.issue.xml.element-count-limit':
    'The document contains more XML elements than the safe limit.',
  'validation.issue.xml.depth-limit': 'The XML nesting depth exceeds the safe limit.',
  'validation.issue.moddle.unresolved-reference':
    'The BPMN model contains a reference that could not be resolved.',
  'validation.issue.moddle.duplicate-id': 'The BPMN parser found a duplicated element identifier.',
  'validation.issue.moddle.unparsable-content': 'Part of the BPMN document could not be parsed.',
  'validation.issue.moddle.warning': 'The BPMN parser reported a model warning.',
  'validation.issue.moddle.parse-error': 'The BPMN XML could not be parsed into a model.',
  'validation.issue.moddle.root-missing': 'The BPMN parser did not return a document root.',
  'validation.issue.structure.definitions-root':
    'The document root is not a BPMN 2.0 definitions element.',
  'validation.issue.structure.definitions-id':
    'The BPMN definitions element is missing its required ID.',
  'validation.issue.structure.target-namespace':
    'The BPMN definitions element is missing a target namespace.',
  'validation.issue.structure.target-namespace-uri':
    'The BPMN target namespace is not a valid absolute URI.',
  'validation.issue.structure.process-missing': 'The BPMN document does not contain a process.',
  'validation.issue.structure.duplicate-id':
    'More than one BPMN or diagram element uses the same ID.',
  'validation.issue.structure.invalid-id': 'A BPMN or diagram element ID is not a valid XML name.',
  'validation.issue.structure.sequence-ref-missing':
    'A sequence flow has an unresolved source or target.',
  'validation.issue.structure.sequence-ref-container':
    'A sequence flow crosses a process or subprocess boundary.',
  'validation.issue.structure.incoming-mismatch':
    'A node’s incoming references do not match its sequence flows.',
  'validation.issue.structure.outgoing-mismatch':
    'A node’s outgoing references do not match its sequence flows.',
  'validation.issue.structure.lane-node-ref': 'A lane references a flow node outside its process.',
  'validation.issue.structure.participant-process-ref':
    'A participant references a process outside this BPMN document.',
  'validation.issue.structure.message-flow-ref': 'A message flow has an unresolved endpoint.',
  'validation.issue.structure.process-id': 'A BPMN process is missing its required ID.',
  'validation.issue.semantic.start-incoming': 'A Start event has an incoming sequence flow.',
  'validation.issue.semantic.end-outgoing': 'An End event has an outgoing sequence flow.',
  'validation.issue.semantic.default-source':
    'This type of BPMN element cannot declare a default flow.',
  'validation.issue.semantic.default-not-outgoing':
    'A declared default flow is not an outgoing flow of its source.',
  'validation.issue.semantic.default-has-condition':
    'A default sequence flow must not have a condition.',
  'validation.issue.semantic.branch-condition-missing':
    'A non-default gateway branch is missing its required condition.',
  'validation.issue.semantic.condition-source':
    'A conditional sequence flow starts from an element type that cannot own conditions.',
  'validation.issue.semantic.boundary-attachment':
    'A Boundary event is not attached to a valid activity.',
  'validation.issue.semantic.disconnected-node':
    'A flow node cannot be reached from the process entry path.',
  'validation.issue.di.plane-missing': 'A BPMN diagram does not contain a diagram plane.',
  'validation.issue.di.plane-target':
    'A BPMN diagram plane does not reference a process or collaboration.',
  'validation.issue.di.element-ref':
    'A diagram element does not reference the BPMN element it represents.',
  'validation.issue.di.element-plane-mismatch':
    'A diagram element represents an element outside its plane.',
  'validation.issue.di.shape-bounds': 'A BPMN shape does not have finite, positive bounds.',
  'validation.issue.di.edge-waypoints': 'A BPMN edge does not have at least two finite waypoints.',
  'validation.issue.di.process-missing': 'A process has no BPMN diagram plane.',
  'validation.issue.orbitpm.active-language': 'A process declares an unsupported active language.',
  'validation.issue.orbitpm.active-projection-mismatch':
    'Visible BPMN text does not match the process’s active-language value.',
  'validation.issue.orbitpm.bilingual-missing-en':
    'A bilingual BPMN field is missing its English value.',
  'validation.issue.orbitpm.bilingual-missing-ar':
    'A bilingual BPMN field is missing its Arabic value.',
  'validation.issue.orbitpm.bilingual-wrong-script-en':
    'An English BPMN field contains unapproved Arabic-script text.',
  'validation.issue.orbitpm.bilingual-wrong-script-ar':
    'An Arabic BPMN field does not contain meaningful Arabic-script text.',
  'validation.issue.orbitpm.bilingual-duplicate-counterpart':
    'The English and Arabic values are identical without an approved neutral exception.',
  'validation.issue.orbitpm.bilingual-mixed-en':
    'An English BPMN field contains mixed Arabic and Latin scripts.',
  'validation.issue.orbitpm.bilingual-mixed-ar':
    'An Arabic BPMN field contains mixed Arabic and Latin scripts.',
  'validation.issue.orbitpm.bilingual-provider-failed':
    'A bilingual BPMN value could not be produced by the selected provider.',
  'validation.issue.orbitpm.call-unlinked': 'A Call activity is not linked to a process.',
  'validation.issue.orbitpm.call-unresolved':
    'A Call activity references a process that is not available.',
  'validation.issue.preservation.snapshot-failed':
    'Unknown extension data could not be checked for preservation.',
  'validation.issue.preservation.extension-element-changed':
    'An unknown extension element was removed, changed, or moved.',
  'validation.issue.preservation.extension-attribute-changed':
    'An unknown extension attribute was removed, changed, or moved.',
  'validation.issue.adapterFailure': 'A required validation engine could not run.',
  'validation.issue.xsd': 'The BPMN XML does not satisfy the BPMN 2.0 schema.',
  'validation.issue.bpmnlint': 'A BPMN modeling rule reported a problem.',
  'validation.issue.fallback':
    'Validation reported a finding that this version does not recognize.',
  'validation.repair.xml.provideDocument': 'Provide a non-empty BPMN XML document.',
  'validation.repair.xml.reduceDocument':
    'Reduce or split the document so it stays within the safe XML limits.',
  'validation.repair.xml.removeInvalidContent':
    'Remove the invalid character or content and validate again.',
  'validation.repair.xml.convertUtf8': 'Convert the source to valid UTF-8 and validate again.',
  'validation.repair.xml.removeUnsafeConstruct':
    'Remove the unsafe XML construct and keep the required BPMN content inline.',
  'validation.repair.xml.moveDeclaration':
    'Move the XML declaration to the beginning of the document.',
  'validation.repair.xml.repairSyntax': 'Correct the XML syntax and validate again.',
  'validation.repair.references':
    'Reconnect the referenced BPMN elements within the correct process scope.',
  'validation.repair.uniqueIds': 'Give every BPMN and diagram element a unique ID.',
  'validation.repair.reviewModel': 'Review the affected model element and correct its BPMN data.',
  'validation.repair.restoreRoot': 'Restore a valid BPMN 2.0 definitions document root.',
  'validation.repair.wrapDefinitions':
    'Wrap the BPMN content in a valid BPMN 2.0 definitions element.',
  'validation.repair.addId': 'Add a stable, unique XML-compatible ID.',
  'validation.repair.targetNamespace': 'Set a stable absolute URI as the BPMN target namespace.',
  'validation.repair.addProcess': 'Add a BPMN process to the definitions document.',
  'validation.repair.validId': 'Use a valid XML name beginning with a letter or underscore.',
  'validation.repair.flowDirection':
    'Remove the invalid flow and reconnect it in the permitted direction.',
  'validation.repair.defaultFlow':
    'Choose a valid outgoing default flow and remove any condition from it.',
  'validation.repair.conditions':
    'Add or remove branch conditions so the gateway rules are satisfied.',
  'validation.repair.boundaryAttachment':
    'Attach the Boundary event to an activity in the same process scope.',
  'validation.repair.reconnectFlow': 'Connect the node to a reachable process path.',
  'validation.repair.regenerateDi':
    'Repair the diagram information or preview and accept auto-layout.',
  'validation.repair.localization':
    'Review the English and Arabic values, scripts, and active-language projection.',
  'validation.repair.linkProcess': 'Link the Call activity to one unambiguous available process.',
  'validation.repair.preserveExtensions':
    'Keep the original XML until the unknown extension data can be preserved exactly.',
  'validation.repair.restoreValidator': 'Restore the validation engine and run validation again.',
  'validation.repair.xsd':
    'Repair the structure identified by the schema diagnostic and validate again.',
  'validation.repair.bpmnlint':
    'Review the referenced element against the labeled BPMN rule and correct the model.',
  'validation.repair.fallback':
    'Review the labeled technical evidence and correct the source before continuing.',
  'sourceEditor.title': 'BPMN XML source',
  'sourceEditor.close': 'Close',
  'sourceEditor.preview': 'Preview changes',
  'sourceEditor.previewing': 'Checking changes…',
  'sourceEditor.apply': 'Apply source',
  'sourceEditor.applying': 'Applying…',
  'sourceEditor.rollback': 'Roll back',
  'sourceEditor.diff': 'Change preview',
  'sourceEditor.diffBounded':
    'This large source uses bounded alignment. Every changed line is shown in its replacement block.',
  'sourceEditor.diffTruncated':
    'This source change exceeds the safe review limit. Some diff content was omitted, so Apply is disabled. Reduce the change and try again.',
  'sourceEditor.diffHunk':
    'Change {index} of {total}, original line {original}, candidate line {candidate}',
  'sourceEditor.diffLine.added': 'Added candidate line {line}',
  'sourceEditor.diffLine.removed': 'Removed original line {line}',
  'sourceEditor.diffLine.context': 'Unchanged original line {original}, candidate line {candidate}',
  'sourceEditor.changedLines':
    '{changed} changed · {added} added · {removed} removed · first change at line {line}',
  'sourceEditor.noChanges': 'No source changes.',
  'sourceEditor.invalidBlocked': 'Apply is blocked because the edited XML is invalid.',
  'sourceEditor.preservationBlocked':
    'Apply is blocked because required diagram data would be lost.',
  'sourceEditor.layoutPreview': 'Preview generated layout',
  'sourceEditor.layoutAccept': 'Accept generated layout',
  'sourceEditor.layoutReady': 'A generated diagram layout is ready to review.',
  'sourceEditor.layoutDiff': 'Generated layout source changes',
  'sourceEditor.layoutDiagramTitle': 'Generated diagram preview',
  'sourceEditor.layoutDiagramAria': 'Read-only generated BPMN diagram preview',
  'sourceEditor.diagramPreview.loading': 'Rendering the read-only diagram preview…',
  'sourceEditor.diagramPreview.ready': 'The read-only diagram preview is ready.',
  'sourceEditor.diagramPreview.warnings': 'The diagram rendered with {count} viewer warning(s).',
  'sourceEditor.diagramPreview.failed': 'Could not render the read-only diagram.',
  'sourceEditor.layoutFailed': 'Could not generate diagram layout: {error}',
  'sourceEditor.action.previewFailed': 'Could not preview the source changes.',
  'sourceEditor.action.layoutFailed': 'Could not generate the diagram layout.',
  'sourceEditor.action.applyFailed': 'Could not apply the source changes.',
  'sourceEditor.action.technicalDetails': 'Technical details:',
  'sourceEditor.missingDi': 'The XML has no usable BPMN diagram layout.',
  'sourceEditor.applied': 'Source changes applied.',
  'save.validationRunning': 'Wait for validation to finish before saving.',
  'save.blocked': 'Save is blocked by validation errors.',
  'save.draftPrompt': 'This document has validation errors. Save it explicitly as a draft?',
  'save.draftAction': 'Save draft with errors',
  'save.cancel': 'Cancel',

  // --- ARIS symbol registry labels (src/aris/symbols) ---
  'aris.symbol.and': 'AND',
  'aris.symbol.applicationSystem': 'Application system',
  'aris.symbol.businessRule': 'Business rule',
  'aris.symbol.document': 'Document',
  'aris.symbol.eDocument': 'Electronic document',
  'aris.symbol.email': 'Email',
  'aris.symbol.entityType': 'Entity type',
  'aris.symbol.event': 'Event',
  'aris.symbol.externalPerson': 'External person',
  'aris.symbol.function': 'Function',
  'aris.symbol.mobile': 'Mobile device',
  'aris.symbol.or': 'OR',
  'aris.symbol.performance': 'Performance indicator',
  'aris.symbol.person': 'Person',
  'aris.symbol.personType': 'Person type',
  'aris.symbol.policy': 'Policy',
  'aris.symbol.processInterface': 'Process interface',
  'aris.symbol.requirement': 'Requirement',
  'aris.symbol.systemFunction': 'System function',
  'aris.symbol.unknown': 'Unknown symbol',
  'aris.symbol.valueAddedChain': 'Value-added chain',
  'aris.symbol.xor': 'XOR',

  // --- ARIS symbol fidelity findings (src/aris/symbols/fidelity.ts, registry.ts) ---
  'aris.fidelity.substitutedVisualResource':
    'The requested ARIS symbol was not found; a related symbol from the same object type was substituted.',
  'aris.fidelity.unknownCustomSymbol':
    'The requested ARIS symbol is a custom symbol this build cannot render; a generic placeholder was substituted.',
  'aris.fidelity.missingTemplate':
    'The requested ARIS symbol has no drawing template registered; a generic placeholder was substituted.',

  // --- ARIS clean-layout engine rejection findings (src/aris/layout/types.ts) ---
  'aris.layout.rejection.shape-overlap': 'Two shapes in the layout overlap.',
  'aris.layout.rejection.label-satellite-overlap':
    'A reserved caption box or satellite shape overlaps another element in the layout.',
  'aris.layout.rejection.edge-through-unrelated-shape':
    "A connection's route passes through a shape it is not connected to.",
  'aris.layout.rejection.detached-endpoint':
    "A connection's endpoint is not attached to its shape's boundary.",
  'aris.layout.rejection.missing-edge':
    'A connection between two related nodes is missing from the produced layout.',
  'aris.layout.rejection.duplicate-edge':
    'The produced layout has more than one identical connection between the same two nodes.',
  'aris.layout.rejection.zero-length-edge': 'A connection in the produced layout has zero length.',
  'aris.layout.rejection.extreme-whitespace':
    'The produced layout has an excessively large empty band, well beyond the canvas balance tolerance.',

  // --- ARIS Excel workbook pipeline issues (src/aris/excel/issues.ts,
  // ARIS_EXCEL_MESSAGE_KEYS is the authoritative emitted-key list) ---
  'aris.excel.issue.unsupported-file-extension':
    'The file was rejected because its extension is not a supported ARIS workbook format.',
  'aris.excel.issue.unsupported-mime-type':
    'The file was rejected because its MIME type does not match a supported ARIS workbook format.',
  'aris.excel.issue.compressed-size-limit':
    'The workbook was rejected because its compressed size exceeds the safe upload limit.',
  'aris.excel.issue.uncompressed-size-limit':
    'The workbook was rejected because its uncompressed size exceeds the safe processing limit.',
  'aris.excel.issue.zip-entry-limit':
    'The workbook was rejected because it contains more ZIP entries than the safe processing limit allows.',
  'aris.excel.issue.sheet-limit':
    'The workbook was rejected because it contains more sheets than the safe processing limit allows.',
  'aris.excel.issue.malformed-zip':
    'The workbook was rejected because its ZIP container is malformed and cannot be parsed.',
  'aris.excel.issue.zip64-unsupported':
    'The workbook was rejected because it uses the ZIP64 format, which this build does not support.',
  'aris.excel.issue.multi-disk-zip':
    'The workbook was rejected because it is a multi-disk ZIP archive, which this build does not support.',
  'aris.excel.issue.unsupported-compression':
    'The workbook was rejected because one of its ZIP entries uses an unsupported compression method.',
  'aris.excel.issue.unsafe-zip-path':
    'The workbook was rejected because one of its ZIP entries has an unsafe path.',
  'aris.excel.issue.duplicate-zip-entry':
    'The workbook was rejected because its ZIP container has more than one entry with the same path.',
  'aris.excel.issue.encrypted-workbook':
    'The workbook was rejected because it is password-protected or encrypted.',
  'aris.excel.issue.macro-content':
    'The workbook was rejected because it contains macro content, which this build does not accept.',
  'aris.excel.issue.executable-content':
    'The workbook was rejected because it contains embedded executable content.',
  'aris.excel.issue.missing-xlsx-part':
    'The workbook was rejected because a required XLSX part is missing.',
  'aris.excel.issue.expanded-size-mismatch':
    "The workbook was rejected because an entry's expanded size does not match the size declared in its ZIP header.",
  'aris.excel.issue.external-links-ignored':
    'The workbook contains external workbook links; they were ignored during import.',
  'aris.excel.issue.data-connections-ignored':
    'The workbook contains external data connections; they were ignored during import.',
  'aris.excel.issue.template-version-missing':
    'The workbook was rejected because it does not declare an ARIS workbook template version.',
  'aris.excel.issue.template-version-unsupported':
    'The workbook was rejected because its declared template version is not supported by this build.',
  'aris.excel.issue.legacy-bpmn-workbook':
    'The workbook was rejected because it is a legacy BPMN workbook, which this ARIS-only build does not accept.',
  'aris.excel.issue.sheet-missing':
    'The workbook was rejected because a required sheet is missing.',
  'aris.excel.issue.sheet-unknown':
    'The workbook contains a sheet that is not part of the official ARIS workbook template.',
  'aris.excel.issue.column-missing':
    'The workbook was rejected because a required column is missing from a sheet.',
  'aris.excel.issue.column-unknown':
    'The workbook contains a column that is not part of the official ARIS workbook template.',
  'aris.excel.issue.header-row-missing':
    'The workbook was rejected because a sheet is missing its header row.',
  'aris.excel.issue.row-limit':
    'The workbook was rejected because a sheet contains more rows than the safe processing limit allows.',
  'aris.excel.issue.column-limit':
    'The workbook was rejected because a sheet contains more columns than the safe processing limit allows.',
  'aris.excel.issue.cell-count-limit':
    'The workbook was rejected because a sheet contains more cells than the safe processing limit allows.',
  'aris.excel.issue.cell-length-limit':
    "The workbook was rejected because a cell's text exceeds the safe length limit.",
  'aris.excel.issue.formula-without-cached-value':
    'The workbook was rejected because a formula cell has no cached value to read.',
  'aris.excel.issue.cached-formula-value':
    'A formula cell was read using its cached value instead of evaluating the formula.',
  'aris.excel.issue.value-required':
    'The workbook was rejected because a required cell value is empty.',
  'aris.excel.issue.value-not-a-number':
    'The workbook was rejected because a cell that must contain a number does not.',
  'aris.excel.issue.value-not-an-integer':
    'The workbook was rejected because a cell that must contain a whole number does not.',
  'aris.excel.issue.value-not-a-boolean':
    'The workbook was rejected because a cell that must contain a boolean value does not.',
  'aris.excel.issue.value-not-allowed':
    "The workbook was rejected because a cell's value is not one of the allowed values for its column.",
  'aris.excel.issue.unknown-object-type':
    'The workbook was rejected because a row references an object type this build does not recognize.',
  'aris.excel.issue.unknown-symbol-type':
    'The workbook was rejected because a row references a symbol type this build does not recognize.',
  'aris.excel.issue.invalid-symbol-type':
    "The workbook was rejected because a row's symbol type does not match its object type.",
  'aris.excel.issue.invalid-connection-type':
    'The workbook was rejected because a row references a connection type this build does not recognize.',
  'aris.excel.issue.invalid-attribute-type':
    'The workbook was rejected because a row references an attribute type this build does not recognize.',
  'aris.excel.issue.invalid-color':
    "The workbook was rejected because a cell's color value is not a valid color.",
  'aris.excel.issue.invalid-route-points':
    "The workbook was rejected because a connection's route points are not valid coordinates.",
  'aris.excel.issue.duplicate-id':
    'The workbook was rejected because more than one row declares the same identifier.',
  'aris.excel.issue.missing-reference':
    'The workbook was rejected because a row references an identifier that does not exist in the workbook.',
  'aris.excel.issue.object-definition-conflict':
    'The workbook was rejected because two rows define the same object with conflicting data.',
  'aris.excel.issue.connection-endpoint-cycle':
    "The workbook was rejected because a connection's endpoints form an unsupported self-referencing cycle.",
  'aris.excel.issue.control-flow-object-limit':
    'The workbook was rejected because a model contains more control-flow objects than the safe processing limit allows.',
  'aris.excel.issue.control-flow-object-warning':
    'A model is approaching the safe limit for control-flow objects.',
  'aris.excel.issue.object-transaction-limit':
    'The workbook was rejected because it contains more objects than the safe single-import limit allows.',
  'aris.excel.issue.empty-workbook':
    'The workbook was rejected because it contains no importable content.',
  'aris.excel.issue.internal-error':
    'The workbook could not be processed because of an unexpected internal error.',
  'aris.excel.guidance.legacy-bpmn-workbook':
    'Export the process from ARIS as an ARIS workbook, not a legacy BPMN workbook, then import it again.',
  'aris.excel.guidance.template-version-missing':
    'Regenerate the workbook from the official ARIS workbook template and import it again.',
  'aris.excel.guidance.template-version-unsupported':
    'Upgrade the workbook to a template version this build supports, then import it again.',
  'aris.excel.guidance.formula-without-cached-value':
    'Open the workbook in a spreadsheet application, let it recalculate, save it, then import it again.',
  'aris.excel.guidance.cached-formula-value':
    'Verify the cached formula values are correct before relying on the imported data.',
  'aris.excel.guidance.missing-reference':
    'Add the missing referenced row to the workbook, or remove the reference, then import it again.',
  'aris.excel.guidance.duplicate-id':
    'Make every identifier in the workbook unique, then import it again.',
  'aris.excel.guidance.unknown-object-type':
    'Correct the object type to a value from the official ARIS workbook template, then import it again.',
  'aris.excel.guidance.invalid-route-points':
    "Correct the connection's route points to valid coordinates, then import it again.",
  'aris.excel.guidance.control-flow-object-limit':
    'Split the model into smaller models that stay within the safe control-flow object limit.',
  'aris.excel.guidance.control-flow-object-warning':
    'Consider splitting the model before it reaches the safe control-flow object limit.',
  'aris.excel.guidance.object-transaction-limit':
    'Split the workbook into smaller batches that stay within the safe single-import limit.',

  // --- ARIS EPC semantic validation findings (src/aris/epc/index.ts, validate.ts) ---
  'aris.epc.finding.alternationViolation':
    'Two directly connected occurrences share the type {objectType}; events and functions must alternate, with a rule between them.',
  'aris.epc.finding.missingStartEvent': 'This model has no start event.',
  'aris.epc.finding.missingEndEvent': 'This model has no end event.',
  'aris.epc.finding.ruleSplitMergeConflict':
    'This rule both merges multiple incoming branches and splits into multiple outgoing branches; split and merge must be modeled as separate rules.',
  'aris.epc.finding.eventPrecedesDecisionSplit':
    'An event is directly followed by a splitting {ruleKind} rule; only a rule may make a decision, never an event.',
  'aris.epc.finding.orphanNode': "This object is disconnected from the model's main control flow.",
  'aris.epc.finding.unrecognizedRuleSymbol':
    'This rule uses the unrecognized connector symbol “{symbolType}”; only AND, OR, and XOR are supported.',
  'aris.epc.finding.missingConnectionType': 'This connection has no connection type.',
  'aris.epc.finding.danglingLinkedModel':
    'This object links to model “{modelId}”, which does not exist in this document.',

  // --- ARIS chat gap-scanner findings (src/aris/chat/messageKeys.ts, gapScanner.ts;
  // ARIS_CHAT_OWN_MESSAGE_KEYS is the authoritative emitted-key list — the module also
  // reuses the aris.epc.finding.* keys above verbatim rather than minting duplicates) ---
  'aris.chat.gap.missingEnglishName': 'No English name is recorded.',
  'aris.chat.gap.missingArabicName': 'No Arabic name is recorded.',
  'aris.chat.gap.missingProcessCode': 'No process code is recorded for this function.',
  'aris.chat.gap.missingOwner': 'No owner or responsible party is recorded for this function.',
  'aris.chat.gap.missingInputsOutputsSystems':
    'No inputs, outputs, or supporting systems are recorded for this function.',
  'aris.chat.gap.missingDecisionBasis': 'No decision basis is recorded for this splitting rule.',
  'aris.chat.gap.missingXorOutcomes':
    "This decision rule's outgoing branches are missing labels or share a duplicate label.",
  'aris.chat.gap.missingReturnTarget': 'No return target was found for this loop-back branch.',
  'aris.chat.gap.missingReturnTarget.ambiguous':
    'More than one possible return target was found for this loop-back branch; a manual selection is required.',
  'aris.chat.gap.dangling.occurrenceDefinition':
    'This occurrence references an object definition that does not exist.',
  'aris.chat.gap.dangling.connectionEndpoint':
    'This connection references a definition or endpoint that does not exist.',
  'aris.chat.gap.missingLinkedModel': 'This process interface has no linked model assigned.',
  'aris.chat.gap.missingAttachment': 'No attachment is recorded for this object.',
  'aris.chat.gap.unusedDefinition':
    'This definition is not used by any occurrence in the document.',
  'aris.chat.gap.unaccountedSourceContent':
    'Some content from the original source could not be accounted for in this document.',

  // --- ARIS source-faithful renderer fidelity findings (src/aris/renderer/fidelity.ts,
  // font.ts, color.ts, textWrap.ts — see ARIS_RENDER_FIDELITY_KINDS in types.ts; the
  // missing-template/unknown-custom-symbol/substituted-visual-resource kinds are owned by
  // the symbol registry above) ---
  'aris.fidelity.missingFont':
    'The requested font “{faceName}” is not in the safe font list; a fallback font was substituted.',
  'aris.fidelity.unsupportedOleRendering':
    'The embedded OLE object “{attachmentId}” is rendered as a placeholder icon only; its content is not decoded or previewed.',
  'aris.fidelity.missingReferenceExport':
    'The attachment “{attachmentId}” has no exported content; nothing can be rendered for it.',
  'aris.fidelity.unsupportedPenEffect':
    'The line style “{style}” is not supported; a solid line was substituted.',
  'aris.fidelity.unsupportedBrushEffect':
    'The fill style “{brushType}” is not supported; a solid fill was substituted.',
  'aris.fidelity.textWrapDifference':
    'This text required line wrapping; its on-screen layout may differ from the original ARIS rendering.',

  // --- ARIS derived-export compatibility status (src/aris/writer/compatibility.ts,
  // plan section 9.5 — the English label below is fixed verbatim by the plan) ---
  'aris.export.experimentalLabel': 'Experimental ARIS AML export',
  'aris.export.experimentalNotice':
    'This exported file has not been verified by importing it into ARIS; treat it as experimental until a real ARIS import and re-export succeeds without repair.',

  // --- ARIS shell (src/aris/shell/shellI18n.ts — ARIS_SHELL_MESSAGE_KEYS) ---
  'aris.canvas.aria': 'ARIS canvas for {model}',
  'aris.canvas.noModels':
    'This source carries no ARIS model records, so there is nothing to draw. The source, accounting and details rails still describe every imported record.',
  'aris.canvas.unsupportedModelType':
    'Model type {type} is outside the supported canvas scope, so it is listed but not drawn.',
  'aris.canvas.bootFailed': 'The ARIS canvas could not be opened: {error}',
  'aris.palette.hand': 'Hand tool (pan)',
  'aris.palette.lasso': 'Lasso select',
  'aris.palette.freeText': 'Free text note',
  'aris.palette.func': 'Function',
  'aris.palette.evt': 'Event',
  'aris.palette.rule.and': 'AND rule',
  'aris.palette.rule.or': 'OR rule',
  'aris.palette.rule.xor': 'XOR rule',
  'aris.palette.entType': 'Entity type',
  'aris.palette.infoCarr': 'Information carrier',
  'aris.palette.businessRule': 'Business rule',
  'aris.palette.perf': 'KPI',
  'aris.palette.applSys': 'Application system',
  'aris.palette.pers': 'Person',
  'aris.palette.requirement': 'Requirement',
  'aris.palette.policy': 'Policy',
  'aris.palette.persType': 'Role (person type)',
  'aris.palette.createTitle': 'Create {name}',
  'aris.palette.grip.title': 'Drag to move the palette. Double-click to reset its position.',
  'aris.canvas.emptyModelHint':
    'This model is empty — drag a shape from the palette, or click a palette entry and then click the canvas, to start drawing.',
  'aris.canvas.emptyModelHint.dismiss': 'Got it',
  'aris.contextPad.connect': 'Connect from here',
  'aris.contextPad.appendFunction': 'Append function',
  'aris.contextPad.appendEvent': 'Append event',
  'aris.contextPad.delete': 'Delete from this model',
  'aris.explorer.models': 'Models',
  'aris.explorer.modelSummary': '{objects} objects · {connections} connections',
  'aris.explorer.modelListAria': 'ARIS models in {source}',
  'aris.explorer.actionUnavailable': 'This workspace does not support that action.',
  'aris.explorer.invalidName': 'A name cannot contain a slash.',
  'aris.explorer.reservedPath': 'The reserved .orbitpm namespace cannot be used here.',
  'aris.toolbar.aria': 'ARIS canvas controls',
  'aris.toolbar.undo': 'Undo',
  'aris.toolbar.redo': 'Redo',
  'aris.toolbar.cleanLayout': 'Clean Layout',
  'aris.toolbar.resetLayout': 'Reset to Source Layout',
  'aris.toolbar.layoutMode.source': 'Source Layout',
  'aris.toolbar.layoutMode.clean': 'Clean Layout',
  'aris.toolbar.importPackage': 'Import into workspace…',
  'aris.toolbar.contentLang': 'Labels: {language}',
  'aris.toolbar.contentLang.title':
    'Switch the diagram labels between English and Arabic (view only, no edit)',
  'aris.toolbar.translate': 'Translate…',
  'aris.toolbar.translate.missing': '{count} untranslated',
  'aris.translate.nothingMissing': 'Every label already has both languages.',
  'aris.translate.applied': 'Applied {count} translations as one undoable step.',
  'aris.translate.autoDone':
    'Translated {count} labels automatically — Undo reverts, review from the toolbar.',
  'aris.translate.stale': 'The model changed during review — the list was refreshed.',
  'aris.translate.gestureLabel': 'Translate labels',
  'aris.translate.failed': 'The translation could not be completed: {error}',
  'aris.translate.memoryFailed': 'The translation could not be saved to memory: {error}',
  'aris.fix.badge': '{count} issues — Fix…',
  'aris.fix.title': 'Fix missing components',
  'aris.fix.autoSection': 'Fill automatically (safe)',
  'aris.fix.confirmSection': 'Proposed changes needing confirmation',
  'aris.fix.interviewSection': 'Needs your answers',
  'aris.fix.openInterview': 'Answer questions…',
  'aris.fix.applied': 'Applied {count} fixes as one undoable step.',
  'aris.fix.gestureLabel': 'Fix missing components',
  'aris.fix.cleanLayoutHint':
    'New elements are placed automatically — run Clean Layout afterwards.',
  'aris.fix.startEvent.name': 'Process started',
  'aris.fix.endEvent.name': 'Process completed',
  'aris.layout.cleanApplied': 'Clean Layout applied as one undoable step.',
  'aris.layout.resetApplied': 'Reset to the imported source layout.',
  'aris.layout.rejected': 'Clean Layout was rejected: {reason}',
  'aris.layout.failed': 'Clean Layout failed: {error}',
  'aris.rail.details': 'Details',
  'aris.rail.metadata': 'Metadata',
  'aris.details.attachment.download': 'Download {name}',
  'aris.rail.accounting': 'Accounting',
  'aris.rail.fidelity': 'Fidelity',
  'aris.rail.aria': 'ARIS details and accounting rails',
  'aris.details.noSelection': 'Select an element on the canvas to inspect it.',
  'aris.details.selectionAria': 'Details for {element}',
  'aris.details.emptyTab': 'No values for this tab.',
  'aris.details.missing': 'Not set',
  'aris.accounting.summary':
    '{accounted} of {total} source records accounted for; {unaccounted} unaccounted.',
  'aris.accounting.summary.derived':
    'Plus {derived} derived entries recorded separately (not part of the source-record total).',
  'aris.accounting.filter': 'Filter accounting rows',
  'aris.accounting.showing': 'Showing {shown} of {matched} matching rows.',
  'aris.accounting.showMore': 'Show more rows',
  'aris.accounting.rowAria': 'Select {id} on the canvas',
  'aris.accounting.notOnCanvas': 'That record has no element on the current model.',
  'aris.accounting.column.path': 'Source path',
  'aris.accounting.column.kind': 'Kind',
  'aris.accounting.column.disposition': 'Disposition',
  'aris.accounting.column.id': 'Source id',
  'aris.accounting.issues': 'Issues',
  'aris.accounting.noIssues': 'No reconciliation issues.',
  'aris.fidelity.none': 'No visual fallbacks were reported for this source.',
  'aris.fidelity.count': '{count} findings',
  'aris.import.review.title': 'Review this import',
  'aris.import.review.source': 'Source',
  'aris.import.review.digest': 'Review digest',
  'aris.import.review.duplicate':
    'An identical source digest is already stored; committing will deduplicate.',
  'aris.import.review.counts':
    '{models} models · {writes} package members · {bytes} bytes · {attachments} attachments',
  'aris.import.review.fidelity':
    '{accounted} of {total} records accounted for, {unaccounted} unaccounted.',
  'aris.import.review.writes': 'Package members to be written',
  'aris.import.review.confirm': 'Commit import',
  'aris.import.review.cancel': 'Cancel',
  'aris.import.committed': 'Imported {name} into the workspace package store.',
  'aris.import.downloaded':
    'Imported {name}; the portable workspace container was downloaded rather than written in place.',
  'aris.import.deduplicated': 'That exact source is already stored; nothing was written.',
  'aris.import.rolledBack': 'The import failed and was rolled back: {error}',
  'aris.import.flushFailed': 'The workspace package was written but the file save failed: {error}',
  'aris.import.failed': 'The import could not be prepared: {error}',
  'aris.ai.cancelled': 'The request was cancelled; nothing was created.',
  'aris.ai.created':
    'Created {models} models, {objects} objects, {relations} relations; {uncertainties} uncertainties reported.',
  'aris.ai.failed': 'The request failed: {error}',
  'aris.ai.notJson': 'The provider did not return strict JSON: {error}',
  'aris.ai.rejected': 'The draft was rejected and nothing was created.',
  'aris.assistant.ai.answeredBy': 'Answered by {provider} · {model}',
  'aris.assistant.ai.asking': 'Asking…',
  'aris.assistant.ai.body':
    'Sends your question to the configured AI provider, grounded only in the process content shown below. Nothing is sent until you review the exact request and consent.',
  'aris.assistant.ai.cancel': 'Cancel',
  'aris.assistant.ai.cancelled': 'The AI request was cancelled.',
  'aris.assistant.ai.consent': 'I reviewed the exact request above and consent to sending it',
  'aris.assistant.ai.contextCount': '{count} relevant process(es) matched and will be included',
  'aris.assistant.ai.contextNone':
    'No relevant process matched this question, so no workspace content will be sent.',
  'aris.assistant.ai.fallback':
    'The AI request failed, so the local answer above is shown instead.',
  'aris.assistant.ai.heading': 'Ask AI (grounded in these processes)',
  'aris.assistant.ai.includeContext': 'Include relevant process context',
  'aris.assistant.ai.preview': 'Exact outbound request',
  'aris.assistant.ai.previewSystem': 'System instructions',
  'aris.assistant.ai.previewUser': 'User message',
  'aris.assistant.ai.redactNames': 'Redact names in process context',
  'aris.assistant.ai.submit': 'Ask AI',
  'aris.assistant.ask.body':
    'Answered locally from the indexed models. No provider and no API key are used.',
  'aris.assistant.ask.heading': 'Ask the process library',
  'aris.assistant.ask.indexed': '{count} indexed models',
  'aris.assistant.ask.label': 'Question',
  'aris.assistant.ask.submit': 'Ask',
  'aris.assistant.chip.unavailable': 'That element is not open on a renderable canvas.',
  'aris.assistant.suggest.missing': 'Which information is missing?',
  'aris.assistant.suggest.processes': 'Which processes are available?',
  'aris.chat.apply': 'Apply answers',
  'aris.chat.commitFailed': 'The canvas rejected the change; nothing was applied.',
  'aris.chat.confirmApply': 'Apply selected changes',
  'aris.chat.confirmHeading': 'These changes need confirmation',
  'aris.chat.finished': 'Interview finished: {status}',
  'aris.chat.gapCount': '{count} gaps found',
  'aris.chat.noProposal':
    'Those answers do not map to a change this build can make deterministically.',
  'aris.chat.nothingSelected': 'Select at least one change to apply.',
  'aris.chat.preview.after': 'After',
  'aris.chat.preview.before': 'Before',
  'aris.chat.proposeRemoval': 'Propose removing it',
  'aris.chat.provenanceRejected': 'A change receipt was withheld from history.',
  'aris.chat.rejected': 'The patch was rejected: {error}',
  'aris.chat.round': 'Round {round} of 5 · {status}',
  'aris.chat.start': 'Start completion interview',
  'aris.chat.undo': 'Undo last applied change',
  'aris.chatDrawer.interview.intro':
    'I scanned {name} and found {count} gap(s). Answer up to 3 questions per round; safe changes apply as one undoable step.',
  'aris.chatDrawer.interview.noTarget':
    'Open an ARIS model first, then start the completion interview.',
  'aris.chatDrawer.interview.clean': 'No gaps found — this model looks complete.',
  'aris.chatDrawer.interview.applied': 'Applied {count} change(s) as one undoable step.',
  'aris.chatDrawer.interview.roundLimit':
    'Round limit reached (5 of 5). Remaining gaps stay listed for a new interview.',
  'aris.create.attachment.blocked': 'Nothing was sent: {reason}',
  'aris.create.attachment.gifUnsupported':
    'GIF is accepted only on verified provider and model routes. {model} on {provider} is not one of them; convert the picture to PNG, JPEG, or WebP.',
  'aris.create.attachment.imageUnsupported':
    '{model} on {provider} cannot accept a picture. Choose a vision-capable model.',
  'aris.create.attachment.modelUnverified':
    '{model} is not a reviewed model for attachments on {provider}. Choose a reviewed model before attaching a file.',
  'aris.create.attachment.outbound':
    'Attached with the first request only: {name} ({size}, {type}). Repair turns are text-only.',
  'aris.create.attachment.pdfUnsupported':
    '{model} on {provider} cannot accept a PDF. Choose a model that reads documents, or describe the process in text instead.',
  'aris.create.attachment.remove': 'Remove attachment',
  'aris.create.attachment.selected': 'Attached {name} ({size}, {type}).',
  'aris.create.attachment.tooLarge': '{name} is too large to attach for {provider}.',
  'aris.create.attachment.unsupportedType':
    'Only PDF, PNG, JPEG, WebP, and GIF files can be attached.',
  'aris.create.attachments.label':
    'Optional attachment — a DOCX is read on this device, a PDF is sent to the provider',
  'aris.create.consent': 'I reviewed the request above and consent to sending it',
  'aris.create.document.body':
    'Attach a PDF or a picture of a process drawing (PNG, JPEG, WebP; GIF only on verified routes). The file is sent to the selected provider only after you review the request and consent.',
  'aris.create.document.choose': 'Choose PDF or picture…',
  'aris.create.document.create': 'Generate from document',
  'aris.create.document.hint':
    'Optional hint — model name, orientation, boundaries, or unclear symbols',
  'aris.create.document.hintPlaceholder':
    'e.g. model the permit renewal flow; the diagram reads right to left; the dashed box is a note, not a step.',
  'aris.create.document.none': 'No document is attached yet.',
  'aris.create.docx.attached':
    'Attached {name}: {chars} characters were extracted on this device. The file itself is never uploaded.',
  'aris.create.docx.choose': 'Attach DOCX…',
  'aris.create.docx.failed': 'The DOCX could not be read: {error}',
  'aris.create.docx.notDocx': 'That is not a .docx file; nothing was attached.',
  'aris.create.model': 'Model',
  'aris.create.modelType': 'Model type',
  'aris.create.noKey': 'No API key is stored for this provider. Open Settings to add one.',
  'aris.create.pdf.choose': 'Attach PDF…',
  'aris.create.pdf.onlyPdf':
    'The description tab accepts a PDF attachment. Use the PDF/Picture tab for a drawing.',
  'aris.create.placement.cancelled':
    'The request was cancelled before placement; nothing was written. The generated AML can still be downloaded below.',
  'aris.create.placement.stale':
    'The workspace changed while the model was being generated, so nothing was written to it. Download the generated AML below to keep it.',
  'aris.create.preview': 'Exact outbound request',
  'aris.create.provider': 'Provider',
  'aris.create.recovery.discard': 'Discard the generated AML',
  'aris.create.recovery.download': 'Download the generated AML ({name})',
  'aris.create.redactNames': 'Redact names in workspace context',
  'aris.create.repairing':
    'The draft was invalid; sending text-only repair turn {attempt} of {max}. The attachment is not sent again.',
  'aris.create.requestEstimate': 'Up to {count} requests',
  'aris.create.semanticExhausted':
    'The provider still returned an invalid draft after {attempts} repair turns; nothing was created.',
  'aris.create.sensitivity': 'Names detected: {names} · Sensitive metadata: {meta}',
  'aris.create.tab.description': 'Description',
  'aris.create.tab.document': 'PDF / Picture',
  'aris.create.tab.excel': 'Excel',
  'aris.create.tabsAria': 'Create input source',
  'aris.create.transportFailed':
    'The provider request failed before any draft came back, so no repair attempt was used: {error}',
  'aris.epc.findingAria': 'Select {id} on the canvas',
  'aris.epc.none': 'No EPC rule violations were found in this source.',
  'aris.epc.notOnCanvas': 'That finding has no element on a renderable model.',
  'aris.epc.severity.error': 'Error',
  'aris.epc.severity.warning': 'Warning',
  'aris.epc.showMore': 'Show more findings',
  'aris.epc.summary': '{errors} errors · {warnings} warnings',
  'aris.excel.body':
    'Fill in the official ARIS template and create native models with no AI at all.',
  'aris.excel.create': 'Create from workbook…',
  'aris.excel.created': 'Created {models} models, {objects} objects, {connections} connections.',
  'aris.excel.downloadBlank': 'Download blank template',
  'aris.excel.downloadExample': 'Download example template',
  'aris.excel.failed': 'The workbook could not be read: {error}',
  'aris.excel.legacy':
    'That is the retired BPMN 0.4.5 workbook. Download the ARIS template below and re-enter the process there.',
  'aris.excel.rejected': 'The workbook was rejected: {errors} errors, {warnings} warnings.',
  'aris.export.done': 'Derived AML exported: {edits} edits, {bytes} bytes.',
  'aris.export.refused': 'The derived export was refused: {error}',
  'aris.export.unmapped':
    '{count} edits could not be addressed against the original bytes and were left out.',
  'aris.export.unmapped.newModel':
    'Model {id} was created after the file was imported. It belongs in a new export, not a patch to this one, so it was left out of this export.',
  'aris.export.unmapped.removedModel':
    'Model {id} was deleted from the workspace. A patch to the original file cannot remove a whole model, so this change was left out of the export.',
  'aris.export.unmapped.defaultLocale':
    'The value on {id} has no language assigned, so there is nowhere in the original file to place it. Assign it a language first.',
  'aris.export.unmapped.clearedAttribute':
    'The value of "{attribute}" on {id} was cleared. A cleared attribute looks the same as one that never had a value, so this change could not be told apart and was left out of the export.',
  'aris.export.unmapped.missingAnchor':
    '{id} could not be placed in the original file: {anchor} does not exist there.',
  'aris.export.unmapped.movedConnectionSource':
    'Connection {id} was reconnected to a different starting point. Exporting that would mean rebuilding the connection from scratch and losing its original line and label styling, so this change was left out.',
  'aris.export.unmapped.linkedModelsOnNewDefinition':
    'New object {id} was linked to other models, but since {id} does not exist in the original file yet, those links have nothing to attach to and were left out.',
  'aris.export.unmapped.unknownRecord':
    '{id} does not match anything in the original file, so it could not be exported.',
  'aris.rail.epc': 'EPC validation',
  'aris.rail.improve': 'Improve this process',

  // --- editable ARIS details rail (src/aris/shell/ArisDetailsRail.tsx,
  // ArisDetailsEditors.tsx — ARIS_SHELL_MESSAGE_KEYS) ---
  'aris.details.edit.name': 'Bilingual name',
  'aris.details.edit.nameEn': 'Name (English locale)',
  'aris.details.edit.nameAr': 'Name (Arabic locale)',
  'aris.details.edit.scope.definition':
    'Definition — this value belongs to the ARIS object itself, so the change reaches all {count} occurrences of it across {models} model(s).',
  'aris.details.edit.scope.occurrence':
    'Occurrence — this value belongs to this shape alone. The other occurrences of the same ARIS object ({count} in total) are left untouched.',
  'aris.details.edit.scope.model': 'Model — this value belongs to the model record itself.',
  'aris.details.edit.badge.definition': 'Definition',
  'aris.details.edit.badge.occurrence': 'This shape only',
  'aris.details.edit.badge.model': 'Model',
  'aris.details.edit.localeStored': 'Stored under locale id {locale}.',
  'aris.details.edit.localeNew': 'Not set yet; will be stored under locale id {locale}.',
  'aris.details.edit.scriptMismatch':
    'The stored text is written in {script} even though the locale id says {tag}. The locale id is kept exactly as the source filed it.',
  'aris.details.edit.lang.en': 'English',
  'aris.details.edit.lang.ar': 'Arabic',
  'aris.details.edit.attributes': 'ARIS attributes',
  'aris.details.edit.attributes.none':
    'This object definition carries no ARIS attributes, so there is no value to edit.',
  'aris.details.edit.valueEn': 'Value (English locale)',
  'aris.details.edit.valueAr': 'Value (Arabic locale)',
  'aris.details.edit.valueOther': 'Value (locale {locale})',
  'aris.details.edit.noLocale': 'no locale id',
  'aris.details.edit.addLocale': 'Add a value in another locale',
  'aris.details.edit.addLocale.id': 'Locale id for the new value',
  'aris.details.edit.addLocale.text': 'Value for the new locale',
  'aris.details.edit.addLocale.submit': 'Add value',
  'aris.details.edit.cancel': 'Cancel',
  'aris.details.edit.remove': 'Remove',
  'aris.details.edit.download': 'Download',
  'aris.details.edit.failed': 'The change was refused: {error}',
  'aris.details.edit.assignments': 'Linked models',
  'aris.details.edit.assignments.none': 'No model is linked to this object yet.',
  'aris.details.edit.assignments.remove': 'Unlink {model}',
  'aris.details.edit.assignments.exhausted':
    'Every model in this source is already linked to this object.',
  'aris.details.edit.assignments.choose': 'Model to link',
  'aris.details.edit.assignments.add': 'Link this model',
  'aris.details.edit.attachments': 'Attachments on this object',
  'aris.details.edit.attachments.none': 'No file is attached to this object.',
  'aris.details.edit.attachments.meta': '{size} bytes · {type}',
  'aris.details.edit.attachments.download': 'Download {name}',
  'aris.details.edit.attachments.remove': 'Remove {name}',
  'aris.details.edit.attachments.confirmAria': 'Confirm removing {name}',
  'aris.details.edit.attachments.confirmBody':
    'Remove {name} from this object? Undo restores it in one step.',
  'aris.details.edit.attachments.confirm': 'Remove the attachment',
  'aris.details.edit.attachments.keep': 'Keep it',
  'aris.details.edit.attachments.add': 'Attach a file to this object',
  'aris.details.edit.attachments.tooLarge':
    '{name} is {size} bytes; an attachment stored inside the model may be at most {limit} bytes.',
  'aris.details.edit.style': 'Occurrence style',
  'aris.details.edit.style.fillColor': 'Fill colour',
  'aris.details.edit.style.strokeColor': 'Outline colour',
  'aris.details.edit.style.strokeWidth': 'Outline width',
  'aris.details.edit.style.lineStyle': 'Outline line style',
  'aris.details.edit.style.solid': 'Solid',
  'aris.details.edit.style.dashed': 'Dashed',
  'aris.details.edit.style.dotted': 'Dotted',
  'aris.details.edit.style.inherit': 'From the ARIS symbol',
  'aris.details.edit.style.appliesToCanvas':
    'The style is drawn on the canvas and travels with the export. The ARIS symbol still supplies the shape.',

  // --- ARIS details side panel (src/aris/details/metadata.ts, tabs.ts) ---
  'aris.details.tab.general': 'General',
  'aris.details.tab.names': 'Names',
  'aris.details.tab.attributes': 'Attributes',
  'aris.details.tab.ids': 'IDs',
  'aris.details.tab.relations': 'Relations',
  'aris.details.tab.assignments': 'Assignments',
  'aris.details.tab.attachments': 'Attachments',
  'aris.details.tab.accounting': 'Accounting',
  'aris.details.tab.fidelity': 'Fidelity',
  'aris.details.tab.history': 'History',
  'aris.details.category.owner': 'Owner',
  'aris.details.category.responsible': 'Responsible',
  'aris.details.category.consulted': 'Consulted',
  'aris.details.category.informed': 'Informed',
  'aris.details.category.input': 'Input',
  'aris.details.category.output': 'Output',
  'aris.details.category.system': 'System',
  'aris.details.category.businessRule': 'Business rule',
  'aris.details.category.policy': 'Policy',
  'aris.details.category.requirement': 'Requirement',
  'aris.details.category.processCode': 'Process code',
  'aris.details.category.arisId': 'ARIS ID',
  'aris.details.category.modelAssignment': 'Model assignment',
  'aris.details.category.other': 'Other',
  'aris.details.general.type': 'Type',
  'aris.details.general.defaultSymbol': 'Default symbol',
  'aris.details.general.linkedModels': 'Linked models',
  'aris.details.general.symbol': 'Symbol',
  'aris.details.general.position': 'Position',
  'aris.details.general.size': 'Size',
  'aris.details.general.modelType': 'Model type',
  'aris.details.general.occurrences': 'Occurrences',
  'aris.details.general.connections': 'Connections',
  'aris.details.general.satellites': 'Satellites',
  'aris.details.general.displayName': 'Display name',
  'aris.details.general.blobs': 'Blobs',
  'aris.details.names.definition': 'Definition name',
  'aris.details.names.inherited': 'Inherited name',
  'aris.details.names.model': 'Model name',
  'aris.details.attributes.attr': 'Attribute',
  'aris.details.attributes.occurrence': 'Attribute occurrence',
  'aris.details.ids.definitionId': 'Definition ID',
  'aris.details.ids.occurrenceId': 'Occurrence ID',
  'aris.details.ids.modelId': 'Model ID',
  'aris.details.ids.oleDefinitionId': 'OLE definition ID',
  'aris.details.ids.oleOccurrenceId': 'OLE occurrence ID',
  'aris.details.relations.category': 'Relation category',
  'aris.details.relations.connectionType': 'Connection type',
  'aris.details.relations.owner': 'Owning occurrence',
  'aris.details.assignments.model': 'Assigned model',
  'aris.details.assignments.none': 'No assigned model',
  'aris.details.attachments.item': 'Attachment',
  'aris.details.attachments.none': 'No attachments',
  'aris.details.attachments.blobs': 'Blob count',
  'aris.details.accounting.occurrences': 'Occurrences',
  'aris.details.accounting.connections': 'Connections',
  'aris.details.accounting.satellites': 'Satellites',
  'aris.details.accounting.attachments': 'Attachments',
  'aris.details.accounting.unsupported': 'Unsupported content',
  'aris.details.fidelity.symbolFallbacks': 'Symbol fallbacks',
  'aris.details.fidelity.oleUnsupported': 'Unsupported OLE objects',
  'aris.details.history.revision': 'Revision',
  'aris.details.history.definitionId': 'Definition ID'
} as const

export const ar: Record<keyof typeof en, string> = {
  // --- App chrome ---
  'app.title': 'OrbitPM ARIS Studio Lite',
  'app.version.aria': 'الإصدار {version}',
  'app.newProcess': '＋ نموذج جديد',
  'app.newProcess.title': 'إنشاء عنصر نائب لنموذج ARIS',
  'app.changeFolder': 'تغيير المجلد…',
  'app.changeFolder.title': 'فتح مجلد مساحة عمل مختلف',
  'app.openBpmn': 'فتح ملف ARIS…',
  'app.openBpmn.title': 'فتح ملف ARIS AML/XML موجود من القرص',
  'app.showAi': '✨ الذكاء الاصطناعي',
  'app.showAi.title': 'إظهار لوحة التوليد بالذكاء الاصطناعي',
  'app.settings': '⚙ الإعدادات',
  'app.settings.title': 'الإعدادات — إدارة مفاتيح مزوّدي الذكاء الاصطناعي',
  'app.loading': 'جارٍ التحميل…',
  'app.home.title': 'الانتقال إلى فهرس العمليات',
  'app.home': '🏠 الرئيسية',
  'app.import.title': 'استيراد ملفات أو مجلدات ARIS AML/XML',
  'app.import': 'استيراد',
  'app.lang.toggle.title': 'تبديل لغة الواجهة إلى الإنجليزية؛ تبقى تسميات المخطط دون تغيير',
  'app.lang.control': 'الواجهة: {language}',
  'app.lang.en': 'EN',
  'app.lang.ar': 'العربية',
  'app.skipToMain': 'تخطَّ إلى مساحة عمل العمليات',
  'app.main.aria': 'مساحة عمل العمليات',
  'app.actions.aria': 'المزيد من إجراءات التطبيق',

  // --- Sidebar rail toggle ---
  'sidebar.toggle.aria': 'إظهار/إخفاء اللوحة الجانبية',
  'sidebar.hide.title': 'إخفاء اللوحة الجانبية',
  'sidebar.show.title': 'إظهار اللوحة الجانبية',
  'sidebar.explorer.aria': 'مستكشف مساحة العمل وأدوات التوليد',
  'sidebar.close.aria': 'إغلاق مستكشف مساحة العمل',

  // --- Sidebar: directory mode ---
  'tree.newProcess': '＋ عملية جديدة',
  'tree.newProcess.title': 'إنشاء عملية جديدة في جذر مساحة العمل',
  'tree.newFolder.title': 'إنشاء مجلد جديد في جذر مساحة العمل',
  'tree.newFolder.aria': 'مجلد جديد',
  'tree.search.placeholder': 'ابحث عن عمليات…',
  'tree.search.aria': 'ابحث عن عمليات',

  // --- Sidebar: fallback mode ---
  'fallback.singleFileNote':
    'وضع الملف الواحد — لا يوجد مجلد مفتوح. افتح مصدر ARIS AML/XML أو استخدم لوحة الإنشاء بالذكاء الاصطناعي.',
  'fallback.newProcess': '＋ نموذج جديد',
  'fallback.newProcess.title': 'إنشاء عنصر نائب لنموذج ARIS',
  'fallback.openBpmnFile': 'فتح ملف ARIS…',
  'fallback.openBpmnFile.title': 'فتح ملف ARIS AML/XML موجود من القرص',
  'fallback.newBlank': 'لوحة عنصر نائب جديدة',
  'fallback.newBlank.title': 'بدء لوحة ARIS فارغة كعنصر نائب',

  // --- Empty-tab placeholder ---
  'emptyTab.directory':
    'اختر ملف .bpmn من الشجرة لفتحه، أو اضغط ＋ عملية جديدة (أعلى اليمين أو في الشريط الجانبي) لبدء عملية. يمكنك أيضًا توليد مسودة بالذكاء الاصطناعي.',
  'emptyTab.fallback':
    'افتح مصدر ARIS AML/XML، أو استخدم الإنشاء بالذكاء الاصطناعي بينما يجري بناء لوحة ARIS الأصلية.',
  'editor.loadingDiagram': 'جارٍ تحميل المخطط…',

  // --- Tab strip ---
  'tab.closeTitle': 'إغلاق',
  'tab.list.aria': 'مخططات العمليات المفتوحة',
  'tab.dirty.aria': 'تغييرات غير محفوظة',

  // --- Footer ---
  'footer.folderPrefix': '📁 {folderName}',
  'footer.singleFileMode': 'وضع الملف الواحد (الحفظ يقوم بالتنزيل)',
  'footer.unresolvedLinks.one': 'رابط واحد غير محلول',
  'footer.unresolvedLinks.other': '{count} روابط غير محلولة',
  'footer.unresolvedLinks.title.directory':
    'انقر لإنشاء العملية المرتبطة المفقودة "{calledElement}"',
  'footer.unresolvedLinks.title.fallback':
    'أنشطة استدعاء مرتبطة بمعرّف عملية غير موجود في مساحة العمل هذه',
  'footer.tagline': 'بلا تثبيت · موجّه إلى ARIS · يعمل في متصفحك',

  // --- Dialogs ---
  'dialog.createMissingProcess.title': 'إنشاء عملية مرتبطة',
  'dialog.createMissingProcess.label': 'اسم العملية',
  'dialog.createMissingProcess.okLabel': 'إنشاء وفتح',
  'dialog.createMissingProcess.hint':
    'يُنشئ ملف .bpmn جديدًا معرّف العملية فيه "{calledElementId}"، بحيث يُحل نشاط الاستدعاء هذا.',
  'dialog.newProcess.title': 'عملية جديدة',
  'dialog.newProcess.label': 'اسم العملية',
  'dialog.newProcess.initialValue': 'عملية جديدة',
  'dialog.newProcess.okLabel': 'إنشاء',
  'dialog.newProcess.hint.directory':
    'يُنشأ ملف .bpmn يحتوي على حدث بداية؛ يمكن للعمليات الأخرى الارتباط به.',
  'dialog.newProcess.hint.fallback': 'لا يوجد مجلد مفتوح، لذا سيقوم الحفظ بتنزيل ملف .bpmn.',
  'dialog.newFolder.title': 'مجلد جديد',
  'dialog.newFolder.label': 'اسم المجلد',
  'dialog.newFolder.initialValue': 'مجلد جديد',
  'dialog.newFolder.okLabel': 'إنشاء',
  'dialog.rename.title': 'إعادة تسمية',
  'dialog.rename.label': 'الاسم الجديد',
  'dialog.rename.okLabel': 'إعادة تسمية',
  'dialog.moveTo.title': 'نقل "{name}"',
  'dialog.moveTo.okLabel': 'نقل هنا',
  'dialog.moveTo.cancel': 'إلغاء',
  'dialog.moveTo.noFolders': 'لا يوجد مجلد آخر لنقل هذا إليه. أنشئ مجلدًا أولًا.',
  'dialog.moveTo.destination': 'المجلد الهدف',

  // --- alert()/confirm() strings ---
  'alert.openFileFailed': 'تعذّر فتح {relPath}: {error}',
  'alert.createMissingProcessNoFolder':
    'العملية "{calledElementId}" غير موجودة بعد. افتح مجلدًا لإنشاء العمليات وربطها.',
  'alert.createProcessFailed': 'تعذّر إنشاء العملية: {error}',
  'alert.noProcessWithId':
    'لا توجد عملية بالمعرّف "{processId}" في مساحة العمل هذه — اربط عملية أخرى أو افتح مجلدًا لإنشائها.',
  'alert.createFolderFailed': 'تعذّر إنشاء المجلد: {error}',
  'alert.renameFailed': 'تعذّرت إعادة التسمية: {error}',
  'alert.deleteFailed': 'تعذّر الحذف: {error}',
  'alert.moveFailed': 'تعذّر النقل: {error}',
  'alert.importFailed': 'تعذّر استيراد {name}: {error}',
  'confirm.discardUnsaved.title': 'تجاهل التغييرات غير المحفوظة؟',
  'confirm.discardUnsaved': 'هل تريد تجاهل التغييرات غير المحفوظة في {title}؟',
  'confirm.discardUnsaved.confirm': 'تجاهل وإغلاق',
  'confirm.deleteNode': 'حذف "{name}"؟ لا يمكن التراجع عن هذا الإجراء.',
  'confirm.deleteFolder.notEmptyBody':
    'غير فارغ. سيؤدي حذفه إلى إزالة المجلد وكل ما بداخله. لا يمكن التراجع عن هذا الإجراء.',
  'confirm.deleteFolder.typeNameLabel': 'اكتب اسم المجلد "{name}" لتأكيد الحذف',
  'alert.permissionNotGranted.open': 'لم يتم منح إذن القراءة/الكتابة للمجلد.',
  'alert.permissionNotGranted.reconnect': 'لم يُمنح الإذن. حاول فتح المجلد مرة أخرى.',
  'alert.picker.security':
    'منع المتصفح الوصول إلى المجلد لأسباب أمنية. جرّب مجلدًا داخل ملف تعريف المستخدم (مثل Documents)، أو استخدم مساحة عمل المتصفح أو ملف ARIS AML/XML واحدًا.',
  'alert.picker.notAllowed':
    'لم يسمح المتصفح بالوصول إلى المجلد. تحقّق من إذن نظام الملفات لهذا الموقع في إعدادات المتصفح، ثم أعد المحاولة أو استخدم مساحة عمل المتصفح أو ملف ARIS AML/XML واحدًا.',
  'alert.picker.unknown':
    'تعذّر فتح المجلد. حاول مرة أخرى، أو استخدم مساحة عمل المتصفح أو افتح ملف ARIS AML/XML واحدًا.',

  // --- WorkspacePickerLite ---
  'picker.title': 'OrbitPM ARIS Studio Lite',
  'picker.subtitle':
    'افتح صادرات ARIS AML/XML، وراجع أدلة المصدر الدقيقة، وجهّز تدفقات عمل ARIS الأصلية — كل ذلك في متصفحك، دون أي تثبيت.',
  'picker.open.button': 'فتح مجلد…',
  'picker.open.button.busy': 'جارٍ الفتح…',
  'picker.open.hint':
    'اختر مجلدًا على جهازك لاستعراض مصادر ARIS AML/XML. سيطلب المتصفح الإذن أول مرة ويتذكّر المجلد لاحقًا.',
  'picker.reconnect.button': 'إعادة الاتصال بـ "{rememberedName}"',
  'picker.reconnect.button.busy': 'جارٍ إعادة الاتصال…',
  'picker.reconnect.button.fallbackName': 'مجلدك',
  'picker.reconnect.openDifferent': 'فتح مجلد مختلف…',
  'picker.reconnect.hint':
    'يحتاج متصفحك إلى إعادة منح إذن القراءة/الكتابة لهذا المجلد لهذه الجلسة.',
  'picker.fallback.banner':
    'هذا المتصفح لا يسمح بفتح مجلد (واجهة File System Access غير متاحة أو معطّلة بسياسة إدارية). استخدم مساحة عمل المتصفح للتخزين المحلي متعدد الملفات، أو افتح ملف ARIS AML/XML واحدًا. يوفّر Microsoft Edge أو Google Chrome وصولًا مباشرًا إلى المجلدات.',
  'picker.fallback.newProcess': '＋ نموذج جديد',
  'picker.fallback.openFile': 'فتح ملف ARIS…',
  'picker.fallback.newDiagram': 'لوحة عنصر نائب جديدة',

  // --- EmptyWorkspaceCard ---
  'emptyWorkspace.heading': 'لا توجد نماذج بعد',
  'emptyWorkspace.createFirst': '＋ أنشئ نموذجك الأول',
  'emptyWorkspace.explain':
    'أنشئ نموذج EPC أو سلسلة قيمة مضافة فارغًا في {folderName}، أو استورد ملفات ARIS AML/XML.',
  'emptyWorkspace.explain.fallbackFolderName': 'هذا المجلد',

  // --- New-model dialog (Lane L2d) ---
  'aris.newModel.title': 'نموذج ARIS جديد',
  'aris.newModel.nameLabel': 'اسم النموذج',
  'aris.newModel.nameInitial': 'نموذج جديد',
  'aris.newModel.create': 'إنشاء النموذج',
  'aris.newModel.type': 'نوع النموذج',
  'aris.newModel.type.epc': 'سلسلة عمليات مقادة بالأحداث (EPC)',
  'aris.newModel.type.vacd': 'مخطط سلسلة القيمة المضافة',
  'aris.newModel.hint.directory': 'يُنشأ ملف مصدر ‎.aml جديد في المجلد المحدد ويُفتح للرسم فورًا.',
  'aris.newModel.hint.fallback':
    'يُفتح النموذج كتبويب في الذاكرة؛ استخدم "استيراد إلى مساحة العمل…" لحفظه.',
  'aris.newModel.created': 'تم إنشاء {name}.',
  'aris.newModel.failed': 'تعذّر إنشاء النموذج: {error}',
  'aris.header.assistant': 'المساعد',
  'aris.header.openFile': 'فتح ملف…',
  'aris.emptyMain':
    'افتح مصدر ARIS AML/XML من المستكشف، أو أنشئ لسان عنصر نائب مُراجَع عبر لوحة الذكاء الاصطناعي.',
  'aris.main.aria': 'مساحة عمل ARIS',
  'aris.tab.list.aria': 'ألسنة مصادر ARIS المفتوحة',
  'aris.tab.closeTitle': 'إغلاق لسان المصدر',
  'aris.explorer.aria': 'مستكشف مساحة عمل ARIS وأدوات التوليد',
  'aris.pane.resize.sidebar.aria': 'تغيير عرض لوحة مستكشف ARIS',
  'aris.explorer.empty':
    'لم يُعثر بعد على مصادر ARIS AML/XML مرئية في مساحة العمل هذه. استخدم الاستيراد أو فتح ملف لتحميل أحدها.',
  'aris.explorer.unsupportedBpmn': 'BPMN غير مدعوم',
  'aris.explorer.newModel': '＋ نموذج جديد',
  'aris.explorer.newModel.title':
    'إنشاء نموذج ARIS فارغ (EPC أو سلسلة قيمة مضافة) في مساحة العمل هذه',
  'aris.explorer.imported': 'تم استيراد {count} ملف/ملفات إلى مساحة العمل.',
  'aris.generated.fallbackName': 'مسودة مولدة',
  'aris.source.virtual': 'لسان داخل الذاكرة',
  'aris.sourceKind.aml': 'ARIS AML',
  'aris.sourceKind.apc': 'الاسم المستعار القديم ‎.apc',
  'aris.sourceKind.xml': 'ARIS XML',
  'aris.sourceKind.generated': 'مسودة مولدة',
  'aris.placeholder.heading': 'لوحة عنصر نائب لـ ARIS',
  'aris.placeholder.body':
    'يحافظ غلاف المرحلة الثانية هذا على محتوى المصدر الدقيق ويُبقي أسطح مساحة العمل والذكاء الاصطناعي والإعدادات والمساعد متاحة بينما يجري بناء نموذج ARIS الأصلي.',
  'aris.placeholder.readOnly':
    'اللسان الحالي للقراءة فقط. تبقى بايتات المصدر الأصلية متاحة للتنزيل وللاستيعاب غير الفاقد لاحقًا.',
  'aris.placeholder.zoom': 'التكبير 100٪',
  'aris.placeholder.layout': 'التخطيط بانتظار لوحة ARIS الأصلية',
  'aris.placeholder.downloadSource': 'تنزيل المصدر الدقيق',
  'aris.placeholder.openAssistant': 'فتح المساعد',
  'aris.placeholder.detailsHeading': 'تفاصيل المصدر',
  'aris.placeholder.accountingHeading': 'المحاسبة والتحقق',
  'aris.placeholder.accountingBody':
    'لا تزال محاسبة المصدر والدقة والتحقق الدلالي معلّقة إلى المرحلة الثالثة والطبقات الأصلية اللاحقة لـ ARIS. لا تُعاد كتابة أي بايتات مصدر هنا.',
  'aris.placeholder.sourceHeading': 'معاينة المصدر الدقيقة',
  'aris.placeholder.sourceKind': 'نوع المصدر',
  'aris.placeholder.sourcePath': 'مسار المصدر',
  'aris.placeholder.sourceBytes': 'البايتات',
  'aris.placeholder.rootElement': 'العنصر الجذر',
  'aris.placeholder.sourceTokens': 'رموز XML',
  'aris.placeholder.sourceNodes': 'عُقد البنية',
  'aris.placeholder.sourceDoctype': 'معرّف DOCTYPE العام/النظامي',
  'aris.placeholder.modelCount': 'النماذج',
  'aris.placeholder.objectDefinitionCount': 'تعريفات الكائنات',
  'aris.placeholder.objectOccurrenceCount': 'ظهورات الكائنات',
  'aris.placeholder.connectionDefinitionCount': 'تعريفات العلاقات',
  'aris.placeholder.connectionOccurrenceCount': 'ظهورات العلاقات',
  'aris.placeholder.attributeCount': 'تعريفات السمات',
  'aris.placeholder.semanticDiagnostics': 'تشخيصات دلالية',
  'aris.placeholder.unknownRecordCount': 'السجلات غير المعروفة',
  'aris.placeholder.sourceDigest': 'SHA-256',
  'aris.placeholder.mainAria': 'لسان مساحة عمل ARIS لـ {name}',
  'aris.placeholder.newDiagramUnavailable':
    'غلاف العنصر النائب لـ ARIS لا ينشئ بعد لوحات أصلية فارغة. افتح مصدر ARIS AML/XML أو استخدم الإنشاء بالذكاء الاصطناعي.',
  'aris.placeholder.newProcessUnavailable':
    'غلاف العنصر النائب لـ ARIS لا ينشئ بعد نماذج ARIS أصلية. افتح مصدر ARIS AML/XML أو استخدم الإنشاء بالذكاء الاصطناعي.',
  'aris.footer.summary': '{files} من مصادر مساحة العمل · {tabs} من الألسنة المفتوحة',
  'aris.ai.body':
    'أنشئ نموذج ARIS أصليًا — مخطط EPC أو مخطط سلسلة القيمة المضافة — من وصف بلغة عادية أو من مستند أو من قالب Excel.',
  'aris.ai.name': 'اسم المسودة',
  'aris.ai.namePlaceholder': 'مسودة مولدة',
  'aris.ai.description': 'وصف العملية',
  'aris.ai.descriptionPlaceholder':
    'صِف العملية والنطاق والأطراف الفاعلة والقرارات الرئيسية. يصوغ مزوّد الذكاء الاصطناعي المحدد نموذج ARIS أصليًا من هذا الوصف لمراجعتك قبل إنشاء أي شيء.',
  'aris.ai.create': 'توليد نموذج ARIS',
  'aris.ai.creating': 'جارٍ التوليد…',
  'aris.assistant.body':
    'يبقى سطح مساعد ARIS متاحًا في المرحلة الثانية بينما تُزال من الملف المشحون مسارات الاسترجاع والمقابلة الخاصة بـ BPMN.',
  'aris.assistant.workspace': 'سياق مساحة العمل الحالية',
  'aris.assistant.root': 'جذر مساحة العمل',
  'aris.assistant.sources': 'المصادر المرئية',
  'aris.assistant.tabs': 'الألسنة المفتوحة',
  'aris.assistant.activeTab': 'اللسان النشط',
  'aris.assistant.activeKind': 'نوع المصدر النشط',
  'aris.assistant.none': 'لا يوجد',

  // --- FolderTreeLite context menu ---
  'contextMenu.newProcess': 'عملية جديدة',
  'contextMenu.newFolder': 'مجلد جديد',
  'contextMenu.rename': 'إعادة تسمية',
  'contextMenu.delete': 'حذف',
  'contextMenu.moveTo': 'نقل إلى…',
  'treeAction.newProcessIn': 'عملية جديدة في {name}',
  'treeAction.rename': 'إعادة تسمية {name}',
  'treeAction.move': 'نقل {name}',
  'treeAction.delete': 'حذف {name}',

  // --- SettingsDialogLite ---
  'settings.title': 'الإعدادات — مفاتيح الذكاء الاصطناعي',
  'settings.close.aria': 'إغلاق',
  'settings.keyStorageWarning':
    'تبقى مفاتيح API في الذاكرة لهذه الجلسة فقط افتراضيًا. ويمكن حفظ المفتاح اختياريًا بعد تشفيره بعبارة مرور لا يتم تخزينها مطلقًا.',
  'settings.getKey': 'الحصول على مفتاح ↗',
  'settings.keyPlaceholder.configured': 'مُهيَّأ (••••{last4}) — اكتب للاستبدال',
  'settings.keyPlaceholder.encrypted': 'يوجد مفتاح مشفّر — أدخل عبارة المرور لفتحه',
  'settings.keyPlaceholder.empty': 'ألصق مفتاح API',
  'settings.clearKey': 'مسح المفتاح المخزّن',
  'settings.saved': 'تم الحفظ.',
  'settings.keyCleared': 'تم مسح المفتاح.',
  'settings.credentials.saving': 'جارٍ حفظ بيانات الاعتماد…',
  'settings.credentials.unlocking': 'جارٍ فتح بيانات الاعتماد المشفّرة…',
  'settings.close': 'إغلاق',
  'settings.saveKeys': 'حفظ المفاتيح',
  'settings.title.providers': 'الإعدادات — مزوّدو الذكاء الاصطناعي',
  'settings.apiKey.aria': 'مفتاح API لـ {label}',
  'settings.testConnection': 'اختبار الاتصال',
  'settings.testConnection.testing': 'جارٍ الاختبار…',
  'settings.testConnection.billableDisclosure':
    'أفهم أن هذا يرسل طلب استدلال صغيرًا قد يكون مدفوعًا.',
  'settings.aiSelection.title': 'مزوّد ونموذج الذكاء الاصطناعي',
  'settings.aiSelection.hint':
    'يُستخدم هذا الاختيار الصريح في الإنشاء والمساعد والمقابلة والترجمة.',
  'settings.encryption.title': 'تخزين بيانات الاعتماد',
  'settings.encryption.persist': 'تشفير المفاتيح المُدخلة حديثًا وحفظها في هذا المتصفح',
  'settings.encryption.passphrase': 'عبارة مرور التشفير',
  'settings.encryption.unlock': 'فتح المفاتيح المشفّرة لهذه الجلسة',
  'settings.encryption.hint':
    'يُستخدم AES-256-GCM مع مفتاح مشتق عبر PBKDF2. لا يمكن استعادة النص المشفّر عند فقدان عبارة المرور.',
  'settings.encryption.unlocked': 'تم فتح {count} من المفاتيح المشفّرة لهذه الجلسة.',
  'settings.storageError.invalidInput': 'راجع حقول بيانات الاعتماد المطلوبة ثم حاول مجددًا.',
  'settings.storageError.unavailable': 'مساحة التخزين في المتصفح غير متاحة.',
  'settings.storageError.failed': 'تعذّر على المتصفح حفظ بيانات الاعتماد أو تنظيفها.',
  'settings.storageError.cryptoUnavailable':
    'تخزين بيانات الاعتماد المشفّرة غير متاح في هذا المتصفح.',
  'settings.storageError.invalidCiphertext':
    'بيانات الاعتماد المشفّرة المخزّنة مفقودة أو غير صالحة.',
  'settings.storageError.unlockFailed':
    'تعذّر فتح بيانات الاعتماد المشفّرة. تحقق من عبارة المرور والبيانات المخزّنة.',
  'settings.storageError.operationCancelled':
    'حلّ إجراء أحدث لبيانات الاعتماد محل العملية المعلّقة.',
  'settings.storageError.startup': 'تعذّر إكمال تنظيف بيانات الاعتماد القديمة. {error}',
  'settings.storageError.providerSelection':
    'تعذّر حفظ اختيار مزوّد الذكاء الاصطناعي ونموذجه. {error}',
  'settings.storageError.keySave': 'تعذّر حفظ مفتاح {provider}. {error}',
  'settings.storageError.unlock': 'تعذّر فتح مفتاح {provider}. {error}',
  'settings.storageError.clear': 'تعذّر مسح المفتاح المخزّن لـ {provider}. {error}',
  'settings.storageError.unknownProvider': 'مزوّد الذكاء الاصطناعي',
  'settings.storageError.technicalDetails': 'التفاصيل التقنية',
  'settings.storageError.technicalDetail': 'تفصيل تقني لتخزين بيانات الاعتماد',
  'settings.localization.title': 'الموارد ثنائية اللغة',
  'settings.localization.description':
    'حرّر المسرد المنسّق وذاكرة الترجمة المقبولة لمساحة العمل هذه.',
  'settings.localization.publicNotice':
    'هذه ملفات عامة في مساحة العمل وتُضمَّن في النسخ الاحتياطية الكاملة. لا تضف بيانات اعتماد أو مخرجات مزوّد لم تُراجع.',
  'settings.localization.unavailable':
    'افتح مجلدًا أو مساحة عمل في المتصفح لتحرير موارد الترجمة المحمولة.',
  'settings.localization.english': 'الإنجليزية',
  'settings.localization.arabic': 'العربية',
  'settings.localization.glossary.title': 'المسرد',
  'settings.localization.glossary.description':
    'تُفحص المصطلحات المنسّقة حسب ترتيب الملف، وتكون الأولوية لأول قيمة مصدر مطابقة.',
  'settings.localization.glossary.empty':
    'لا تحتوي مساحة العمل هذه على مصطلحات في المسرد أو حيادات معتمدة.',
  'settings.localization.glossary.add': 'إضافة مصطلح',
  'settings.localization.glossary.save': 'حفظ المسرد',
  'settings.localization.glossary.saved': 'تم حفظ المسرد.',
  'settings.localization.glossary.row': 'مصطلح المسرد {index}',
  'settings.localization.glossary.neutral': 'عدم الترجمة (محايد)',
  'settings.localization.glossary.neutralHint':
    'يجب أن تتطابق القيمتان الإنجليزية والعربية عند تحديد هذا الخيار.',
  'settings.localization.translationMemory.title': 'ذاكرة الترجمة',
  'settings.localization.translationMemory.description':
    'لا تُخزَّن إلا الأزواج المقبولة صراحةً، ويحدد ترتيب الملف أولوية أول تطابق.',
  'settings.localization.translationMemory.empty': 'لم تُقبل أي أزواج ترجمة بعد.',
  'settings.localization.translationMemory.addAccepted': 'إضافة زوج مقبول',
  'settings.localization.translationMemory.save': 'حفظ ذاكرة الترجمة',
  'settings.localization.translationMemory.saved': 'تم حفظ ذاكرة الترجمة.',
  'settings.localization.translationMemory.row': 'الزوج المقبول {index}',
  'settings.localization.translationMemory.accepted': 'مقبول',
  'settings.localization.translationMemory.acceptedAt': 'تم القبول في {date}',
  'settings.localization.moveUp': 'نقل الصف {index} إلى أعلى',
  'settings.localization.moveDown': 'نقل الصف {index} إلى أسفل',
  'settings.localization.remove': 'إزالة الصف {index}',
  'settings.localization.reload': 'إعادة تحميل موارد مساحة العمل',
  'settings.localization.reloading': 'جارٍ إعادة التحميل…',
  'settings.localization.reloaded': 'تمت إعادة تحميل موارد مساحة العمل.',
  'settings.localization.saving': 'جارٍ الحفظ…',
  'settings.localization.conflict':
    'تغيّرت موارد مساحة العمل هذه في مكان آخر. أعد تحميلها قبل الحفظ مجددًا.',
  'settings.localization.conflictTitle': 'تغيّر مورد {resource} في مكان آخر',
  'settings.localization.conflictReloadRequired':
    'تم الاحتفاظ بالمسودة غير المحفوظة. أعد تحميل أحدث إصدار من مساحة العمل قبل تسويتها.',
  'settings.localization.conflictReview':
    'تغيّر إصدار مساحة العمل بعد بدء هذه المسودة. اختر إصدار مساحة العمل، أو احتفظ بالمسودة مقابل الإصدار المعاد تحميله لمراجعتها صراحةً قبل الحفظ.',
  'settings.localization.conflictVersions': 'تجزئتا أساس المسودة ومساحة العمل:',
  'settings.localization.conflictCompareVersions': 'مقارنة أساس المسودة بإصدار مساحة العمل',
  'settings.localization.conflictDraftBase': 'أساس المسودة ({count} من الإدخالات)',
  'settings.localization.conflictWorkspaceVersion': 'إصدار مساحة العمل ({count} من الإدخالات)',
  'settings.localization.conflictPreviewEmpty': 'لا توجد إدخالات.',
  'settings.localization.conflictPreviewOmitted': 'لا تظهر {count} من الإدخالات الإضافية.',
  'settings.localization.useWorkspaceVersion': 'استخدام إصدار مساحة العمل من {resource}',
  'settings.localization.keepDraftForReview': 'الاحتفاظ بمسودة {resource} للمراجعة',
  'settings.localization.reloadedDraftsPreserved':
    'أُعيد تحميل موارد مساحة العمل. تم الاحتفاظ بالمسودات غير المحفوظة لمراجعة التعارض.',
  'settings.localization.workspaceVersionSelected': 'يُستخدم إصدار مساحة العمل من {resource}.',
  'settings.localization.draftKeptForReview':
    'تم الاحتفاظ بمسودة {resource} مقابل إصدار مساحة العمل المعاد تحميله. راجعها قبل الحفظ.',
  'settings.localization.saveFailed': 'تعذر حفظ موارد الترجمة: {error}',
  'settings.localization.loadFailed': 'تعذر تحميل موارد الترجمة لمساحة العمل: {error}',
  'settings.localization.loadFailedHint':
    'يظل التحرير معطلاً حتى تنجح إعادة تحميل الملفين. أصلح الملف المُبلّغ عنه خارجيًا ثم أعد المحاولة. قد يبقى تحديث مكتمل للتهيئة الأولى أو للتنسيق القديم إذا فشلت عملية تخزين لاحقة.',
  'settings.localization.failure.invalidPath': 'مسار أحد موارد الترجمة غير صالح.',
  'settings.localization.failure.invalidEncoding':
    'أحد موارد الترجمة ليس نصًا صالحًا بترميز UTF-8.',
  'settings.localization.failure.notFound': 'لم يُعثر على مورد ترجمة مطلوب.',
  'settings.localization.failure.alreadyExists':
    'يوجد مورد ترجمة مسبقًا حيث كان متوقعًا إنشاء ملف جديد.',
  'settings.localization.failure.wrongKind':
    'يشير مسار مورد الترجمة إلى نوع غير صحيح من عناصر مساحة العمل.',
  'settings.localization.failure.permission': 'فُقد إذن الوصول إلى ملفات مساحة العمل.',
  'settings.localization.failure.cancelled': 'أُلغيت عملية مساحة العمل.',
  'settings.localization.failure.staleWorkspace': 'تغيّرت مساحة العمل المحددة قبل اكتمال العملية.',
  'settings.localization.failure.unsupported':
    'لا تستطيع مساحة العمل هذه تخزين موارد ترجمة محمولة.',
  'settings.localization.failure.quotaExceeded': 'لا تتوفر مساحة تخزين كافية في مساحة العمل.',
  'settings.localization.failure.integrity': 'لم يجتز مورد الترجمة المحفوظ فحص سلامة البيانات.',
  'settings.localization.failure.storage': 'فشلت عملية التخزين في مساحة العمل.',
  'settings.localization.failure.resourceLimit':
    'يتجاوز أحد موارد الترجمة حد الحجم أو التعقيد المدعوم.',
  'settings.localization.failure.partialLoad':
    'تم تحديث أحد ملفات الترجمة قبل فشل عملية لاحقة على مورد آخر.',
  'settings.localization.failure.unknown': 'حدث خطأ غير متوقع في تخزين مساحة العمل.',
  'settings.localization.technicalDetails': 'التفاصيل التقنية',
  'settings.localization.technicalDetail': 'تفصيل تقني لموارد ترجمة مساحة العمل',
  'settings.localization.validation.englishRequired': 'أدخل القيمة الإنجليزية.',
  'settings.localization.validation.arabicRequired': 'أدخل القيمة العربية.',
  'settings.localization.validation.englishScript':
    'استخدم نصًا ذا معنى بحروف إنجليزية، أو أنشئ مصطلحًا محايدًا صريحًا في المسرد.',
  'settings.localization.validation.arabicScript': 'استخدم نصًا ذا معنى بحروف عربية.',
  'settings.localization.validation.neutralMismatch':
    'يجب أن يستخدم المصطلح المحايد القيمة نفسها بالإنجليزية والعربية.',
  'settings.localization.validation.acceptedOnly':
    'لا يجوز أن تحتوي ذاكرة الترجمة إلا على أزواج مقبولة صراحةً.',
  'settings.localization.validation.schema':
    'يحتوي هذا المورد على حقول أو نصوص أو بيانات قبول غير صالحة.',

  // --- AiPanelLite ---
  'ai.collapsedButton': '✨ إنشاء بالذكاء الاصطناعي',
  'ai.header': '✨ إنشاء بالذكاء الاصطناعي',
  'ai.hide.title': 'إخفاء لوحة الذكاء الاصطناعي',
  'ai.offlineWarning':
    'يبدو أنك غير متصل بالإنترنت. يتطلب التوليد بالذكاء الاصطناعي اتصالًا بالإنترنت؛ لا يزال الرسم والتنظيم يعملان.',
  'ai.noKeys.note': 'أضف مفتاح API من OpenRouter أو Anthropic أو Gemini لتوليد مخططات من وصف نصي.',
  'ai.noKeys.openSettings': 'فتح الإعدادات',
  'ai.description.label': 'الوصف',
  'ai.description.placeholder':
    'صف العملية بلغة بسيطة، مثال: "يقدّم العميل طلبًا؛ إذا كان صالحًا يُنفَّذ، وإلا يُرفض."',
  'ai.provider.label': 'المزوّد',
  'ai.provider.select': 'اختر مزوّدًا…',
  'ai.provider.selectHint': 'اختر المزوّد والنموذج صراحةً قبل السماح بإرسال أي طلب ذكاء اصطناعي.',
  'ai.model.label': 'النموذج',
  'ai.targetFolder.label': 'المجلد الهدف',
  'ai.name.label': 'الاسم',
  'ai.name.placeholder': 'عملية الطلب (اختياري)',
  'ai.generate': 'توليد',
  'ai.generating': 'جارٍ التوليد…',
  'ai.noKeyForProvider': 'لا يوجد مفتاح مخزّن لـ {providerLabel}.',
  'ai.addOneInSettings': 'أضف واحدًا في الإعدادات',
  'ai.errorTip.offline': 'تلميح: يبدو أن هذه مشكلة في الاتصال. تحقق من شبكتك.',
  'ai.created': 'تم الإنشاء: {resultLabel}',
  'ai.openedInMemory': 'تم فتح {label} في تبويب جديد (استخدم الحفظ للتنزيل).',
  'ai.placement.discarded.staleWorkspace':
    'تم تجاهل المخطط المُنشأ لأن مساحة العمل تغيّرت. لم يتم حفظه أو فتحه.',
  'ai.placement.discarded.cancelled':
    'تم تجاهل المخطط المُنشأ لأن وضعه أُلغي. لم يتم حفظه أو فتحه.',
  'ai.placement.recoveryHint': 'نزّل ملف BPMN المُنشأ نفسه لاستعادته.',
  'ai.placement.downloadRecovery': 'تنزيل ملف BPMN المُنشأ',
  'ai.folderOption.root': '/ (جذر مساحة العمل)',
  'ai.error.cors':
    'رفض المزوّد طلب المتصفح (CORS). استخدم أحد مزوّدي المتصفح المدعومين: OpenRouter أو Anthropic أو Gemini.',
  'ai.error.network':
    'تعذّر الوصول إلى مزوّد الذكاء الاصطناعي. تحقق من اتصالك بالإنترنت، ثم حاول مرة أخرى.',
  'ai.error.auth': 'رفض المزوّد الطلب (خطأ في المصادقة). تحقق من مفتاح API في الإعدادات.',
  'ai.error.rateLimit':
    'المزوّد يحدّ من المعدل أو محمّل بشكل زائد الآن. انتظر لحظة وحاول مرة أخرى.',
  'ai.error.provider': 'أعاد مزوّد الذكاء الاصطناعي خطأً. حاول مرة أخرى أو اختر مزوّدًا آخر.',
  'ai.error.invalidResponse':
    'أعاد مزوّد الذكاء الاصطناعي استجابة فارغة أو غير قابلة للقراءة. حاول مرة أخرى.',
  'ai.error.unknown': 'فشلت عملية الذكاء الاصطناعي على نحو غير متوقع.',
  'ai.error.technicalDetail': 'تفصيل تقني:',
  'ai.error.noApiKey': 'لا يوجد مفتاح API لهذا المزوّد. أضف واحدًا في الإعدادات.',
  'ai.error.selectProvider': 'اختر المزوّد والنموذج قبل الإنشاء.',
  'ai.pdf.label': 'أو ارفع ملف PDF',
  'ai.pdf.button': 'رفع PDF…',
  'ai.pdf.extracting': 'جارٍ استخراج النص…',
  'ai.pdf.error': 'تعذّرت قراءة ملف PDF: {error}',
  'ai.noKeysAtAll.note':
    'لا توجد مفاتيح API بعد. اختر مزوّدًا أدناه و{link} للتوليد — يمكنك أيضًا اختبار الاتصال بالمزوّد هناك دون مفتاح.',
  'ai.noKeysAtAll.link': 'أضف مفتاحًا في الإعدادات',
  'ai.tablist.aria': 'مصدر التوليد',
  'ai.tab.description': 'من وصف نصي',
  'ai.tab.pdf': 'من PDF / صورة',
  'ai.tab.pdf.title.supported': 'التوليد من مستند PDF أو صورة لرسم العملية',
  'ai.tab.pdf.title.unsupported':
    'إدخال PDF/الصور غير مدعوم من المزوّد والنموذج المحددين. اختر نموذجًا أو مزوّدًا متوافقًا.',
  'ai.pdfDocument.label': 'مستند PDF أو صورة',
  'ai.pdfHint.label': 'أي عملية؟',
  'ai.pdfHint.optional': '(اختياري)',
  'ai.pdfHint.placeholder': 'أي عملية من هذا المستند؟ / Which process from this document?',
  'ai.targetFolder.aria': 'المجلد الهدف',
  'ai.generateFromPdf': 'التوليد من المستند',
  'ai.addOneInSettings.period': '.',
  'ai.note.updated':
    'يمكن استدعاء {anthropic} و{gemini} و{openrouter} مباشرة من صفحة ويب. يمكن الوصول إلى GLM وKimi وDeepSeek عبر OpenRouter. لا تسمح واجهات المزوّدين المباشرة لـ {desktopOnlyProviders} بالوصول من المتصفح (CORS) — يمكن الوصول إلى تلك النماذج عبر OpenRouter هنا.',
  'ai.error.chooseNoPdf': 'اختر ملف PDF أو صورة أولًا.',
  'ai.pdf.sizeGate.overLimit':
    'حجم PDF هو {size} — يتجاوز الحد {limit} لهذا المزوّد. الرجاء {alt}.',
  'ai.pdf.sizeGate.alt.splitOnly': 'تقسيم الملف',
  'ai.pdf.sizeGate.alt.tryGeminiOrSplit': 'تجربة Gemini (حد أكبر) أو تقسيم الملف',
  'ai.attach.label': 'مستند الوصف',
  'ai.attach.hint':
    'أرفق ملف Word ‏(.docx) أو PDF يحتوي على وصف العملية — تتم قراءته مع النص أعلاه.',
  'ai.attach.extracted': '{name} · تم استخراج {chars} حرفًا من النص',
  'ai.attach.docxEmpty': 'لم يتم العثور على نص قابل للقراءة في {name} — هل هو مستند ممسوح ضوئيًا؟',
  'ai.attach.readFailed': 'تعذّرت قراءة {name}: {error}',
  'ai.attach.docxError.notZip': 'الملف {name} ليس مستند Word ‏(.docx) صالحًا.',
  'ai.attach.docxError.missingDocument': 'لا يحتوي الملف {name} على محتوى مستند Word الرئيسي.',
  'ai.attach.docxError.tooLarge':
    'يتجاوز الملف {name} حدود أمان أرشيف المستند. استخدم مستندًا أصغر.',
  'ai.attach.docxError.unsafe':
    'يحتوي الملف {name} على مسارات أرشيف غير آمنة أو متعارضة، لذلك تم رفضه.',
  'ai.attach.docxError.encrypted':
    'الملف {name} مشفّر أو محمي بكلمة مرور. احفظ نسخة غير محمية ثم حاول مرة أخرى.',
  'ai.attach.docxError.unsupported':
    'يستخدم الملف {name} تنسيق أرشيف Word أو طريقة ضغط غير مدعومة.',
  'ai.attach.docxError.malformed': 'الملف {name} تالف أو ليس مستند Word قابلًا للقراءة.',
  'ai.attach.docxError.cancelled': 'تم إلغاء قراءة الملف {name}.',
  'ai.attach.docxError.unknown': 'تعذّرت قراءة مستند Word ‏{name}.',
  'ai.attach.remove': 'إزالة المرفق',
  'ai.attach.unsupportedProvider':
    'نوع المرفق هذا غير مدعوم من المزوّد والنموذج المحددين. اختر نموذجًا أو مزوّدًا متوافقًا.',
  'ai.image.sizeGate.overLimit':
    'حجم الصورة {size} — يتجاوز الحد {limit} لهذا المزوّد. اضغط الصورة أو قصّها ثم أعد المحاولة.',
  'ai.image.unsupportedType': 'نوع الصورة غير مدعوم. استخدم PNG أو JPEG أو WebP أو GIF.',
  'import.notBpmnXml': '{name} ملف XML لكنه ليس مخطط BPMN — تم تخطيه.',
  'editor.langToggle.missing':
    'لا يمكن عرض أي تسمية بلغة المخطط المطلوبة، لذلك لم تتغير لغة المخطط.',
  'canvas.inputs': 'المدخلات',
  'canvas.cc': 'نسخة إلى',
  'canvas.responsible': 'المسؤولون',
  'canvas.basis': 'الأساس',
  'org.nameEn.label': 'الاسم (بالإنجليزية)',
  'org.nameAr.label': 'الاسم (بالعربية)',
  'org.inputs.label': 'المدخلات / المعلومات الأساسية',
  'org.inputs.hint':
    'واحد في كل سطر — البيانات أو المستندات أو المعلومات الأساسية التي تحتاجها هذه الخطوة.',
  'org.ccList.label': 'نسخة إلى (أطراف مُطلَعة)',
  'org.ccList.hint':
    'واحد في كل سطر — أضف الغرض بعد شرطة، مثال: "المالية — التدقيق المالي". يظهر كقائمة بجانب الخطوة.',
  'org.respList.label': 'الأشخاص المسؤولون',
  'org.respList.hint': 'واحد في كل سطر، مثال: "سارة المري — معتمِد".',
  'org.decisionBasis.label': 'أساس القرار',
  'org.decisionBasis.hint': 'القاعدة أو السياسة أو المعايير التي يستند إليها هذا القرار.',
  'org.outputs.label': 'المخرجات',
  'org.system.label': 'النظام الداعم',
  'apc.convertedMany': 'تم تحويل {count} نموذج عمليات من {name}.',
  'apc.reason.noModels': 'لم يتم العثور على نماذج عمليات في ملف ARIS المُصدَّر.',
  'translate.noKey': 'لا يوجد مفتاح ذكاء اصطناعي — أضف واحدًا في الإعدادات للترجمة.',
  'translate.nothing': 'لا توجد تسمية ذات نص مصدر كافٍ لإنشاء المقابل الإنجليزي أو العربي الناقص.',
  'translate.nothing.switched': 'لا حاجة إلى ترجمة — يعرض المخطط الآن اللغة الأخرى.',
  'translate.nothing.alreadyArabic':
    'لا حاجة إلى ترجمة، وتعذّر استبدال العرض الحالي باللغة المطلوبة.',
  'translate.nothing.omitted':
    'لا توجد تسميات مؤهلة تحتاج إلى ترجمة. تُعرض {switched} تسمية باللغة المطلوبة وتبقى {missing} بلا تغيير. تفتقر {omitted} تسمية إلى نص مصدر صالح أو معرّف.',
  'translate.running': 'جارٍ ترجمة {count} تسمية…',
  'translate.done': 'تمت ترجمة {count} تسمية وتبديل لغة المخطط. احفظ الملف للاحتفاظ بالتغييرات.',
  'translate.partial':
    'تمت ترجمة {done} من أصل {total} تسمية مؤهلة. تُعرض {switched} تسمية باللغة المطلوبة وتبقى {missing} بلا تغيير. احفظ الملف للاحتفاظ بالتغييرات.',
  'translate.failed':
    'فشلت الترجمة. ما زالت الحقول غير المحلولة متاحة لإعادة المحاولة أو المراجعة اليدوية.',
  'settings.completeness.label': 'إبراز المعلومات الناقصة في الخطوات',
  'settings.completeness.hint':
    'يميّز الخطوات التي تفتقد الجهة المسؤولة أو المدخلات أو المخرجات — والقرارات بلا أساس، وأحداث البداية بلا مشغّل.',
  'missing.title': 'ناقص: {list}',
  'missing.owner': 'الجهة المسؤولة',
  'missing.inputs': 'المدخلات',
  'missing.outputs': 'المخرجات',
  'missing.basis': 'أساس القرار',
  'missing.trigger': 'المشغّل',
  'missing.tooltip.action': 'انقر لإكمال هذه التفاصيل',
  'missing.highlight.hint': 'هذه المعلومات ما تزال ناقصة.',
  'canvas.subprocess.tooltip': 'يحتوي على عملية فرعية مرتبطة — انقر نقرًا مزدوجًا لفتحها',
  'canvas.subprocess.tooltip.generic': 'يحتوي على عملية فرعية',
  'canvas.subchip': 'فرعي',
  'assist.tab.library': 'اسأل المكتبة',
  'assist.tab.interview': 'أكمل هذه العملية',
  'assist.interview.start':
    'أنشأتُ مسودة من وصفك. سأطرح بضعة أسئلة لسد النواقص — أجب بأي لغة، أو اضغط إنهاء في أي وقت.',
  'assist.interview.finish': 'إنهاء',
  'assist.interview.applying': 'جارٍ تحديث المخطط…',
  'assist.interview.applied': 'تم تحديث المخطط.',
  'assist.interview.done': 'اكتملت المعلومات الأساسية. يمكنك متابعة التحسين أو إغلاق المحادثة.',
  'assist.interview.noModeler': 'افتح العملية المولَّدة أولًا ثم ابدأ المقابلة.',
  'assist.interview.editWarning':
    'الإجابات تعيد توليد المخطط — أكمل تعديلاتك اليدوية على اللوحة بعد المقابلة.',
  'assist.error.redaction':
    'تعذّر إعداد الطلب بأمان بعد حجب الأسماء. راجع السياق المضمّن ثم حاول مرة أخرى.',
  'assist.error.emptyResponse':
    'لم يُرجع المزوّد أي أسئلة قابلة للاستخدام في المقابلة. حاول مرة أخرى.',
  'assist.model.line': 'النموذج: {model} ({provider})',
  'ai.continueInChat': '💬 أكمل النواقص في المحادثة',
  'ai.continueInChat.title': 'افتح المساعد وأجب عن أسئلته لإكمال معلومات الخطوات الناقصة',

  // --- Diagram toolbar (legacy BPMN editor removed; keys retained where still used) ---
  'editor.zoomOut.title': 'تصغير',
  'editor.zoomIn.title': 'تكبير',
  'editor.zoomFit': 'ملاءمة التكبير',
  'editor.propsToggle': 'اللوحة',
  'editor.propsToggle.title': 'إظهار/إخفاء لوحة الخصائص',
  'editor.dirtyFlag.dirty': '● تغييرات غير محفوظة',
  'editor.dirtyFlag.dirty.title': 'يحتوي هذا المخطط على تغييرات لم تُحفظ بعد',
  'editor.print.title':
    'طباعة أو حفظ كـ PDF — يفتح مربع حوار الطباعة بعرض كامل الصفحة أفقي لهذا المخطط',
  'editor.print': 'طباعة / PDF',

  // --- Link picker ---
  'link.changeProcess': 'تغيير ارتباط العملية…',
  'link.linkToProcess': 'ربط بعملية…',
  'link.button.title.linked': 'مرتبط بـ {calledElementId}',
  'link.button.title.unlinked': 'اربط نشاط الاستدعاء هذا بعملية',

  // --- AI link verification (LinkVerifyDialog) ---
  'ai.linkVerify.title': 'مراجعة روابط العمليات',
  'ai.linkVerify.intro':
    'اقترح الذكاء الاصطناعي روابط لعمليات موجودة. أكّد الروابط غير المؤكدة أدناه؛ تبقى الروابط غير المحددة بدون ربط.',
  'ai.linkVerify.uncertain': '(غير مؤكد)',
  'ai.linkVerify.noMatch': '(لا توجد عملية مطابقة — تبقى بدون ربط)',
  'ai.linkVerify.confirm': 'تأكيد الروابط',
  'ai.linkVerify.cancel': 'إلغاء',
  'ai.linked.summary': 'تم الربط ({count}): {list}',

  // --- AI credits / usage (CreditsLine) ---
  'ai.credits.remaining': 'الرصيد المتبقي: ${amount}',
  'ai.credits.refresh': 'تحديث رصيد الاعتمادات',
  'ai.credits.loading': 'جارٍ التحقق من الرصيد…',
  'ai.credits.refreshHint': 'لا يتم التحقق من الرصيد تلقائيًا.',
  'ai.credits.error.auth': 'فشل التحقق من الرصيد — مفتاح غير صالح.',
  'ai.credits.error.network': 'فشل التحقق من الرصيد — خطأ في الشبكة.',
  'ai.credits.error.timeout': 'انتهت مهلة التحقق من الرصيد.',
  'ai.credits.error.unexpected': 'فشل التحقق من الرصيد.',
  'ai.usage.session': 'هذه الجلسة: {requests} طلبات · {tokens} رمز · {cost}',
  'ai.usage.sessionDetailed':
    'الجلسة: {requests} طلبات · {tokens} رمز إدخال/إخراج · {reasoning} رمز تفكير · {cost}',
  'ai.usage.allTimeDetailed':
    'الإجمالي: {requests} طلبات · {tokens} رمز إدخال/إخراج · {reasoning} رمز تفكير · {cost}',
  'ai.usage.priceAsOf':
    'آخر مراجعة لتقدير السعر المحلي في {date}؛ وتُستخدم تكلفة المزوّد عند توفرها.',
  'ai.usage.incomplete':
    'بيانات الاستخدام غير مكتملة؛ القيم المعلّمة بالرمز ≥ هي حدود دنيا استنادًا إلى البيانات المتبقية في هذا المتصفح.',
  'ai.usage.costNa': 'التكلفة غير متاحة',
  'ai.usage.reset': 'إعادة تعيين',
  'settings.credits.noBalanceApi':
    'لا يوفر هذا المزوّد واجهة لعرض الرصيد — يتم عرض الاستخدام المتتبَّع محليًا بدلًا من ذلك.',
  'linkPicker.title': 'ربط بعملية…',
  'linkPicker.close.aria': 'إغلاق',
  'linkPicker.searchPlaceholder': 'ابحث بالمعرّف أو الاسم أو المسار…',
  'linkPicker.empty.noProcesses': 'لا توجد عمليات في مساحة العمل هذه بعد.',
  'linkPicker.empty.noMatches': 'لا توجد عمليات مطابقة لبحثك.',

  // --- Shared modal defaults ---
  'modal.cancel': 'إلغاء',
  'modal.ok': 'موافق',
  'modal.close.aria': 'إغلاق',

  // --- Catalog (home view) ---
  'catalog.title': 'فهرس العمليات',
  'catalog.empty': 'لم يتم العثور على عمليات.',
  'catalog.column.name': 'الاسم',
  'catalog.column.folder': 'المجلد',
  'catalog.column.modified': 'آخر تعديل',
  'catalog.column.status': 'الحالة',
  'catalog.status.unresolved': 'روابط غير محلولة',
  'catalog.status.ok': 'سليمة',
  'catalog.everyProcessIn': 'كل عملية في {rootName}.',
  'catalog.showingMatching': 'عرض {shown} من {total} مطابقة لـ "{query}".',
  'catalog.process.one': 'عملية واحدة.',
  'catalog.process.other': '{total} عمليات.',
  'catalog.withUnresolvedLinks': '{count} بها روابط غير محلولة',
  'catalog.noMatch': 'لا توجد عمليات مطابقة لـ "{query}".',
  'catalog.emptyBody': 'لا توجد عمليات بعد. انقر {newProcess} لإنشاء الأولى.',
  'catalog.column.links': 'الروابط',
  'catalog.openRow.aria': 'فتح {name}',
  'catalog.folderTitle': '{folder}',
  'catalog.unresolvedTooltip.one': 'رابط استدعاء واحد غير محلول',
  'catalog.unresolvedTooltip.other': '{count} روابط استدعاء غير محلولة',
  'catalog.ok': 'سليم',

  // --- Search ---
  'search.results.title': 'نتائج البحث',
  'search.noResults': 'لا توجد عمليات مطابقة لـ "{query}".',
  'search.matches.one': 'نتيجة بحث واحدة',
  'search.matches.other': '{count} نتائج بحث',
  'search.resultCount.one': 'نتيجة واحدة لـ "{query}"',
  'search.resultCount.other': '{count} نتائج لـ "{query}"',
  'search.close.aria': 'إغلاق نتائج البحث',
  'search.noResults.full': 'لا توجد عمليات أو ملفات أو معرّفات أو نصوص مخطط مطابقة.',
  'search.field.name': 'الاسم',
  'search.field.file': 'الملف',
  'search.field.id': 'المعرّف',
  'search.field.content': 'في المخطط',

  // --- Unresolved links panel ---
  'unresolved.title': 'الروابط غير المحلولة',
  'unresolved.empty': 'جميع أنشطة الاستدعاء مرتبطة بعملية موجودة في مساحة العمل هذه.',
  'unresolved.createNow': 'إنشاء الآن',
  'unresolved.openSource': 'فتح المصدر',
  'unresolved.badge.title': 'روابط غير محلولة — انقر للعرض',
  'unresolved.title.count': 'الروابط غير المحلولة ({count})',
  'unresolved.close': 'إغلاق',
  'unresolved.empty.full':
    'لا توجد روابط غير محلولة — كل نشاط استدعاء يشير إلى عملية موجودة في مساحة العمل هذه.',
  'unresolved.intro': 'كل صف هو نشاط استدعاء لا توجد العملية المستهدفة له في مساحة العمل هذه. ',
  'unresolved.intro.canCreate':
    'أنشئ العملية المفقودة (معرّفها ثابت بحيث يُحل الرابط)، أو افتح المصدر لإصلاحه.',
  'unresolved.intro.cannotCreate':
    'افتح مجلدًا لإنشاء العمليات المفقودة؛ هنا يمكنك الانتقال إلى كل مصدر.',
  'unresolved.createNow.title': 'إنشاء عملية بالمعرّف "{calledElement}"',
  'unresolved.openSource.title': 'فتح الملف الذي يحتوي على نشاط الاستدعاء هذا',

  // --- Navigation ---
  'nav.back': 'رجوع',
  'nav.back.title': 'رجوع (Alt+Left)',
  'nav.forward': 'التالي',
  'nav.forward.title': 'التالي (Alt+Right)',
  'breadcrumb.root': 'مساحة العمل',
  'breadcrumb.aria': 'مسار التنقل',

  // --- Import ---
  'import.dropHint': 'أفلت ملفات أو مجلدات ARIS AML/XML هنا للاستيراد',
  'import.toast.imported': 'تم استيراد {name}',
  'import.toast.renamed': 'تم الاستيراد باسم {name} (الاسم موجود مسبقًا)',

  // --- Confirm dialog ---
  'confirmDialog.deleteFolder.title': 'حذف المجلد',
  'confirmDialog.deleteFile.title': 'حذف العملية',
  'confirmDialog.cancel': 'إلغاء',
  'confirmDialog.confirm': 'حذف',
  'confirmDialog.confirm.default': 'تأكيد',
  'confirmDialog.typeToConfirm': 'اكتب {name} للتأكيد:',

  // --- Print ---
  'print.button': 'طباعة / PDF',
  'print.title.prefix': 'العملية: ',
  'print.ownerLine': 'مالك العملية: {name} ({type})',
  // Owner types — canonical keys reused by every owner-facing surface.
  'owner.type.individual': 'فرد',
  'owner.type.department': 'إدارة',
  'owner.type.division': 'قطاع',

  // --- Toasts ---
  'toast.dismiss.aria': 'إغلاق',
  'toast.deleted': 'تم حذف "{name}".',
  'toast.moved': 'تم نقل "{name}" إلى {dest}.',
  'toast.imported.count': 'تم استيراد {count} ملف{plural}',
  'toast.imported.renamed': ' (تمت إعادة تسمية {renamed} لتجنب تعارض الأسماء)',
  'toast.import.openFolderFirst': 'افتح مجلدًا أولًا لاستيراد الملفات إلى مساحة عملك.',
  'toast.import.arisOnly': 'هذا الإصدار المقتصر على ARIS يقبل فقط صادرات ARIS AML/XML.',
  'toast.import.noBpmnFound':
    'لم يتم العثور على مصادر ARIS AML/XML قابلة للاستيراد (.aml أو .apc أو .xml) فيما تم إفلاته.',
  'toast.print.loading': 'المخطط لا يزال قيد التحميل — حاول الطباعة مرة أخرى بعد لحظة.',
  'toast.print.failed': 'فشلت الطباعة: {error}',

  // --- FX1: workspace & data-safety fixes (KEEP BOTH sides on rebase conflict) ---
  'tree.refresh': '↻',
  'tree.refresh.title': 'إعادة فحص هذا المجلد بحثًا عن تغييرات تمت خارج التطبيق',
  'tree.refresh.aria': 'تحديث مساحة العمل',
  'toast.refreshed': 'تم تحديث مساحة العمل.',
  'toast.moved.withCount': 'تم نقل "{name}" إلى {dest} — {count} ملفات (منها {nonBpmn} غير BPMN).',
  'toast.renamed': 'تمت إعادة التسمية إلى "{name}".',
  'toast.renamed.withCount': 'تمت إعادة تسمية "{name}" — {count} ملفات (منها {nonBpmn} غير BPMN).',
  'alert.rename.invalidChars': 'لا يمكن أن يحتوي الاسم على "/" أو "\\".',
  'alert.import.failed': 'فشل الاستيراد: {error}',
  'alert.open.failed': 'تعذّر فتح الملف: {error}',
  'alert.staleWrite': 'ينتمي هذا المخطط إلى مجلد لم يعد مفتوحًا — تم تخطّي حفظه.',
  'alert.staleGeneration':
    'تغيّر مجلد مساحة العمل أثناء التوليد — لم يُحفظ المخطط. افتح المجلد من جديد ثم أعد التوليد.',
  'alert.saveAll.failed': 'تعذّر حفظ جميع التغييرات: {error}. سيبقى المجلد الحالي مفتوحًا.',
  'confirm.switch.title': 'تغييرات غير محفوظة',
  'confirm.switch.body':
    'لديك تغييرات غير محفوظة في {count} مخطط مفتوح. هل تريد حفظها قبل تبديل المجلد؟',
  'confirm.switch.saveAll': 'حفظ الكل والتبديل',
  'confirm.switch.discard': 'تجاهل والتبديل',
  'confirm.switch.cancel': 'إلغاء',
  'confirm.switch.downloadedTitle': 'المسودات المنزّلة ما زالت غير محفوظة',
  'confirm.switch.downloadedBody':
    'جُهّز تنزيل {count} مسودة، لكن التنزيلات ليست حفظًا دائمًا في مساحة العمل. تابع التبديل مع الاحتفاظ بمسودات الاسترداد، أو ألغِ للعودة إلى المستندات المفتوحة.',
  'confirm.switch.continue': 'متابعة التبديل',

  // --- FX2 lane: AI/provider/CSP/naming/i18n fixes (F1 + Codex M4/5/6/9/10) ---
  'ai.provider.openrouter.desc':
    'مفتاح واحد، نماذج متعددة (GLM-5.2 وKimi K3 وDeepSeek V4 وClaude وGemini). قابل للاستدعاء من المتصفح؛ يدعم PDF.',
  'ai.provider.anthropic.desc':
    'نماذج Claude، تُستدعى مباشرة من المتصفح بمفتاحك. فهم أصلي لملفات PDF.',
  'ai.provider.gemini.desc': 'Gemini عبر generateContent المباشر. فهم أصلي لملفات PDF.',
  'settings.verdict.reachableOk': 'يمكن الوصول — تم قبول الطلب (HTTP {status}). مفتاحك يعمل.',
  'settings.verdict.reachableAuth':
    'يمكن الوصول (CORS يعمل) — رفض المزوّد المفتاح (HTTP {status}). متوقّع لاختبار بدون مفتاح؛ أدخل مفتاحًا صالحًا لاستخدامه.',
  'settings.verdict.reachableOther':
    'يمكن الوصول (CORS يعمل) — HTTP {status}. النقطة قابلة للاستدعاء من المتصفح.',
  'settings.verdict.blocked':
    'محجوب أو غير قابل للوصول (CORS أو عدم اتصال أو DNS) — تعذّر على المتصفح قراءة أي استجابة. تحقّق من الشبكة وأعد المحاولة، أو اختر مزوّدًا قابلًا للاستدعاء من المتصفح مثل OpenRouter أو Anthropic أو Gemini.',
  'settings.verdict.timeout': 'انتهت مهلة الاتصال. تحقق من شبكتك وحاول مرة أخرى.',
  'ai.error.timeout':
    'استغرق الطلب وقتًا طويلًا وانتهت مهلته. حاول مرة أخرى، أو استخدم مدخلًا أصغر.',
  'ai.error.cancelled': 'تم إلغاء الطلب.',
  'ai.cancel': 'إلغاء الطلب',
  'ai.retry.attempt': 'محاولة الطلب {attempt} من {max}.',
  'ai.retry.waiting': 'فشلت المحاولة {attempt} من {max}؛ ستتم إعادة المحاولة خلال {seconds} ث.',
  'ai.privacy.preview.title': 'معاينة الطلب الخارجي',
  'ai.privacy.providerModel': 'المزوّد/النموذج: {provider} / {model}',
  'ai.privacy.description': 'الوصف الذي سيتم إرساله',
  'ai.privacy.attachment': 'المرفق الذي سيتم إرساله: {name} ({bytes} بايت)',
  'ai.privacy.includeWorkspace': 'تضمين سياق عمليات مساحة العمل ذات الصلة',
  'ai.privacy.redactNames': 'حجب أسماء العمليات (تبقى معرّفات العمليات الثابتة لأغراض الربط)',
  'ai.privacy.workspaceCount':
    'سياق مساحة العمل: {included} مضمنة، و{relevant} ذات صلة، من أصل {total}. لا تُرسل المطابقات عديمة الثقة.',
  'ai.privacy.sensitivity': 'يتضمن أسماء: {names}. بيانات حساسة واضحة: {sensitive}.',
  'ai.privacy.requestCount': 'الحد الأقصى التقديري لطلبات الاستدلال لهذا الإجراء: {count}.',
  'ai.privacy.consent': 'راجعت هذا الطلب وأوافق على إرسال البيانات المذكورة.',
  'common.yes': 'نعم',
  'common.no': 'لا',
  'ai.pdf.engineNote': 'محرّك تحليل PDF يديره المزوّد.',
  'ai.pdf.memoryNote':
    'الحد الأقصى لحجم PDF هو 20 ميغابايت. يقوم الإرسال بترميز الملف بنظام base64 (‏+33% تقريبًا) ونسخه داخل طلب JSON، لذا يستهلك الملف الكبير مؤقتًا عدة أضعاف حجمه في الذاكرة — قسّم المستندات الممسوحة ضوئيًا أو الكبيرة جدًا.',
  'ai.pdf.sizeGate.softWarn':
    'حجم هذا الملف {size} — قد تكون الملفات الكبيرة بطيئة أو تقترب من حدود المزوّد. قسّمه إذا فشل التوليد.',

  // --- حزمة التنظيم: نافذة تفاصيل الخطوة + مُنتقي المالك + التنسيق (B4) ---
  'org.dialog.title.element': 'تفاصيل الخطوة',
  'org.dialog.title.process': 'تفاصيل العملية',
  'org.apply': 'تطبيق',
  'org.cancel': 'إلغاء',
  'org.applied': 'تم تطبيق التفاصيل.',
  'org.applyFailed': 'تعذّر تطبيق التفاصيل: {error}',
  'org.export.owners': 'تصدير المالكين (CSV)',

  'org.section.owner': 'المالك',
  'org.section.note': 'ملاحظة',
  'org.section.channel': 'القناة',
  'org.section.cc': 'نسخة كربونية (CC)',
  'org.section.trigger': 'المُشغِّل',

  'org.ownerRole.label': 'دور RACI',
  'org.ownerRole.R': 'مسؤول التنفيذ',
  'org.ownerRole.A': 'المُساءَل',
  'org.ownerRole.C': 'مُستشار',
  'org.ownerRole.I': 'مُطّلِع',

  'org.channel.none': 'بلا',
  'org.channel.dmthub': 'منصة DMT',
  'org.channel.email': 'بريد إلكتروني',
  'org.channel.data': 'بيانات',
  'org.channel.detail.label': 'تفاصيل القناة',
  'org.channel.detail.placeholder': 'مثال: المستلِم أو قائمة الانتظار أو مرجع',
  'org.channel.dmthub.placeholder': 'اسم خدمة منصة DMT',

  'org.cc.label': 'نسخ مالك آخر في هذه الخطوة',
  'org.cc.to.label': 'مستلِم النسخة',
  'org.cc.to.placeholder': 'الاسم أو الدور المراد نسخه',

  'org.trigger.label': 'المُشغِّل',
  'org.trigger.none': 'بلا',
  'org.trigger.email': 'بريد إلكتروني',
  'org.trigger.dmthub': 'منصة DMT',
  'org.trigger.manual': 'يدوي',
  'org.trigger.schedule': 'مُجدوَل',
  'org.trigger.other': 'أخرى',
  'org.trigger.service.label': 'خدمة منصة DMT',
  'org.trigger.service.placeholder': 'خدمة المنصة التي تُطلق حدث البداية',
  'org.trigger.detail.label': 'تفاصيل المُشغِّل',
  'org.trigger.detail.placeholder': 'مثال: الجدول أو المُرسِل أو مرجع',
  'org.trigger.serviceRequired': 'اسم خدمة منصة DMT مطلوب.',
  'org.trigger.add': '＋ إضافة مشغّل',
  'org.trigger.remove.aria': 'إزالة هذا المشغّل',
  'org.trigger.rowLabel': 'المشغّل {n}',

  'org.note.label': 'ملاحظة',
  'org.note.placeholder': 'أضف ملاحظة تظهر بجوار هذه الخطوة…',

  // ملصقات مُنتقي المالك (يُعاد استخدام owner.type.individual/department/division أعلاه).
  'owner.name.label': 'المالك',
  'owner.name.placeholder': 'اسم المالك…',
  'owner.type.label': 'النوع',
  'owner.type.none': '—',
  'owner.suggestions.aria': 'اقتراحات المالكين',

  // --- الإعدادات: تنسيق المخطط (B4) ---
  'settings.diagram.title': 'المخطط',
  'settings.orgStyling.label': 'ترميز ألوان DMT وتفاصيل الخطوات',
  'settings.orgStyling.desc':
    'إظهار شارات المالك وأدوار RACI وعلامات القناة والمُشغِّل وتنسيق الملاحظات على اللوحة وفي التصدير.',

  // --- مساعد العمليات (لوحة الدردشة، B5) ---
  'assist.open': 'اسأل مساعد العمليات',
  'assist.title': 'مساعد العمليات',
  'assist.close': 'إغلاق المساعد',
  'assist.placeholder': 'اسأل عمّا يحدث بعد خطوة، أو مَن المسؤول عنها…',
  'assist.send': 'إرسال',
  'assist.thinking': 'جارٍ التفكير…',
  'assist.empty':
    'اسأل عن عملياتك الموثّقة — ماذا يحدث بعد خطوة معيّنة، ومَن المسؤول عنها، وأي عملية تتبع.',
  'assist.sources': 'استنادًا إلى',
  'assist.poweredBy': 'إجابات الذكاء الاصطناعي عبر {provider}',
  'assist.localMode': 'إجابات مباشرة من ملفات عملياتك',
  'assist.fellBack':
    'تعذّر الوصول إلى مزوّد الذكاء الاصطناعي، وإليك إجابة مباشرة من ملفات عملياتك:',
  'assist.local.next': 'في «{process}»، بعد «{step}» تكون الخطوة التالية:',
  'assist.local.complete': 'في «{process}»، «{step}» هي الخطوة الأخيرة — اكتملت العملية.',
  'assist.local.candidates': 'قد يشير هذا إلى عدة عمليات — أيها تقصد؟',
  'assist.local.none': 'لم أتمكّن من العثور على ذلك في عملياتك الموثّقة.',

  // --- تصدير/استيراد المكتبة كاملةً (‎.zip‎، B5) ---
  'library.export': 'تصدير المكتبة',
  'library.export.title': 'تنزيل مساحة العمل بأكملها كمكتبة ‎.zip‎',
  'library.import': 'استيراد مكتبة',
  'library.import.title': 'استيراد مكتبة عمليات ‎.zip‎',
  'library.import.confirmTitle': 'استيراد مكتبة العمليات',
  'library.import.summary': 'استيراد {count} ملف عملية من هذه المكتبة إلى مساحة عملك؟',
  'library.import.skippedNote': 'سيتم تخطّي {skipped} عنصرًا في الأرشيف:',
  'library.import.confirm': 'استيراد',
  'library.exported': 'تم تصدير {count} ملف عملية كمكتبة ‎.zip‎.',
  'library.import.empty': 'لم يتم العثور على أي ملفات عمليات في هذه المكتبة.',
  'library.skip.not-bpmn': 'ليس ملف ‎.bpmn‎',
  'library.skip.unsafe-path': 'مسار غير آمن',
  'library.skip.too-large': 'الملف كبير جدًا',
  'library.skip.decode-failed': 'تعذّر فك الترميز',

  // --- استيراد ARIS التجريبي (‎.apc‎، B5) ---
  'apc.converted': 'تم استيراد «{name}» من ARIS — تحويل تجريبي، يُرجى مراجعته.',
  'apc.failed': 'تعذّر تحويل ملف ARIS ‎(.apc)‎: {reason}',
  'apc.reason.notAml': 'ليس تصدير AML من ARIS معروفًا',
  'apc.reason.noObjects': 'لم يتم العثور على أي كائنات عمليات',
  'apc.convertedInto': 'تم استيراد {count} عملية إلى المجلد «{folder}».',

  // --- بطاقة التفاصيل / منتقي المالك / تغيير عرض اللوحات / الترجمة المجانية / تداخل الشجرة ---
  'details.card.title': 'التفاصيل',
  'details.card.processScope': 'العملية',
  'details.card.elementScope': 'الخطوة المحددة',
  'details.card.noSelection': 'لم يتم تحديد خطوة — تُعرض تفاصيل العملية.',
  'details.card.owner': 'المالك',
  'details.card.inputs': 'المدخلات',
  'details.card.outputs': 'المخرجات',
  'details.card.empty': '—',
  'details.card.missingTitle': 'معلومات ناقصة',
  'details.card.complete': 'جميع المعلومات الأساسية مكتملة.',
  'details.card.open': 'فتح التفاصيل…',
  'details.card.open.title': 'تحرير كامل تفاصيل الخطوة/العملية',
  'details.card.more': '+{count} أخرى',
  'owner.browse.aria': 'استعراض جميع المالكين',
  'owner.empty': 'لا يوجد مالكون بعد — اكتب اسمًا لإضافته.',
  'pane.resize.sidebar.aria': 'تغيير عرض لوحة المستكشف',
  'pane.resize.props.aria': 'تغيير عرض لوحة الخصائص',
  'pane.resize.hint': 'اسحب لتغيير العرض — انقر نقرًا مزدوجًا لإعادة الضبط',
  'translate.free.using':
    'لا يوجد مفتاح ذكاء اصطناعي — جارٍ ترجمة {count} تسمية عبر خدمة ترجمة مجانية…',
  'translate.free.rate':
    'بلغت خدمة الترجمة المجانية حدّها اليومي. حاول لاحقًا أو أضف مفتاح ذكاء اصطناعي في الإعدادات.',
  'translate.free.offline': 'يبدو أنك غير متصل بالإنترنت — تتطلب الترجمة اتصالًا بالشبكة.',
  'translate.free.down':
    'تعذّر الوصول إلى خدمة الترجمة المجانية. حاول لاحقًا أو أضف مفتاح ذكاء اصطناعي في الإعدادات.',
  'translationReview.retry.service.google': 'ترجمة Google',
  'translationReview.retry.service.mymemory': 'MyMemory',
  'translationReview.retry.attempt':
    '{service}: العنصر {item} من {items}، محاولة الطلب {attempt} من {max}.',
  'translationReview.retry.waiting':
    '{service}: العنصر {item} من {items}، محاولة الطلب {attempt} من {max}؛ ستُعاد المحاولة خلال {seconds} ث.',
  'tree.linkedChildren': 'العمليات الفرعية المرتبطة',
  'tree.linkDepthCapped': 'مستويات إضافية غير معروضة',
  'library.manifestInfo': 'بيان المكتبة: {files} ملف/ملفات، {links} رابط/روابط.',
  'library.ownersCsvInfo': 'تم رصد ملف المالكين (process-owners.csv) — للاطلاع فقط.',

  // --- مراجع التسلسل الهرمي للعمليات (إضافة في النهاية فقط) ---
  'tree.reference.canonicalPath': 'الملف الأساسي: {path}',
  'tree.shared': 'مشتركة',
  'tree.shared.title': 'تتم الإشارة إليها من {count} عمليات أصلية',
  'tree.owned': 'مملوكة',
  'tree.owned.title': 'عملية فرعية مملوكة — ملفها الأساسي متداخل هنا',
  'tree.reused': 'معاد استخدامها',
  'tree.reused.title': 'مرجع لعملية فرعية معاد استخدامها — يفتح الملف الأساسي',
  'tree.cycle.title': 'حلقة — تظهر هذه العملية بالفعل في هذا الفرع',

  // --- تفاعلات العارض: لوحة التفاصيل ودليل الأشكال والتلميحات الدلالية (إضافة في النهاية فقط) ---
  'pane.details.toggle': 'التفاصيل',
  'pane.details.toggle.title': 'إظهار لوحة التفاصيل أو إخفاؤها',
  'pane.details.aria': 'تفاصيل الخطوة والخصائص',
  'legend.toggle': 'دليل الأشكال',
  'legend.toggle.title': 'إظهار دليل أشكال المخطط',
  'legend.title': 'دليل أشكال المخطط',
  'legend.close.aria': 'إغلاق دليل الأشكال',
  'legend.event': 'حدث',
  'legend.event.start': 'حدث بداية',
  'legend.event.intermediate': 'حدث وسيط',
  'legend.event.end': 'حدث نهاية',
  'legend.step': 'خطوة / وظيفة',
  'legend.subprocess': 'عملية فرعية',
  'legend.gateway': 'بوابة',
  'legend.gateway.eventBased': 'بوابة مبنية على حدث',
  'legend.gateway.complex': 'بوابة معقدة',
  'legend.participant': 'حوض / مشارك',
  'legend.lane': 'مسار مسؤولية',
  'legend.annotation': 'ملاحظة نصية',
  'legend.dataObject': 'كائن بيانات',
  'legend.dataStore': 'مخزن بيانات',
  'legend.owner': 'المالك / المسؤول',
  'legend.input': 'مدخل',
  'legend.output': 'مخرج',
  'legend.cc': 'نسخة / مُطّلع',
  'legend.basis': 'أساس القرار',
  'legend.subprocessChip': 'رابط عملية فرعية',
  'semantic.event.tooltip': 'يحدد موضع بدء العملية أو انتهائها أو انتظارها لشيء ما.',
  'semantic.event.start.tooltip': 'يبدأ العملية عند وقوع المُحفّز.',
  'semantic.event.intermediate.tooltip': 'ينتظر حدثًا أو يطلقه أثناء سير العملية.',
  'semantic.event.end.tooltip': 'ينهي هذا المسار ضمن العملية.',
  'semantic.step.tooltip': 'ينفذ وحدة عمل واحدة ضمن العملية.',
  'semantic.subprocess.tooltip': 'يجمع تدفقًا تفصيليًا داخل عملية أكبر.',
  'semantic.gateway.eventBased.tooltip': 'يختار المسار وفق الحدث الذي يقع أولًا.',
  'semantic.gateway.complex.tooltip': 'يستخدم قاعدة مخصصة لفتح المسارات أو ضمّها.',
  'semantic.participant.tooltip': 'يمثل جهة أو دورًا أو نظامًا مشاركًا ويحتوي عمليته.',
  'semantic.lane.tooltip': 'يجمع العمل المسند إلى دور أو فريق أو مسؤولية داخل الحوض.',
  'semantic.annotation.tooltip': 'يضيف شرحًا نصيًا من دون تغيير تدفق العملية.',
  'semantic.dataObject.tooltip': 'يمثل معلومات أو مستندًا تستخدمه العملية أو تنتجه.',
  'semantic.dataStore.tooltip': 'يمثل معلومات محفوظة في مخزن دائم.',
  'semantic.owner.tooltip': 'يوضح مَن يملك الخطوة أو المسؤول عن تنفيذها.',
  'semantic.input.tooltip': 'المعلومات المطلوبة قبل إمكان تنفيذ هذه الخطوة.',
  'semantic.output.tooltip': 'المعلومات التي تنتجها هذه الخطوة.',
  'semantic.cc.tooltip': 'الأشخاص أو الأدوار الذين يتم إبقاؤهم على اطلاع بهذه الخطوة.',
  'semantic.basis.tooltip': 'القاعدة أو السياسة أو المعايير المستخدمة لاتخاذ هذا القرار.',
  'semantic.subprocessChip.tooltip': 'يشير إلى عملية فرعية مطوية أو مرتبطة يمكن فتحها.',

  // --- مراجعة الترجمة المدققة / الموافقة على الطلب الخارجي ---
  'translationReview.title': 'مراجعة الترجمة',
  'translationReview.direction.enAr': 'الإنجليزية ← العربية',
  'translationReview.direction.arEn': 'العربية ← الإنجليزية',
  'translationReview.document': 'المستند الهدف:',
  'translationReview.summary':
    'تم فحص {fields} حقلًا ثنائي اللغة · {missing} ناقص · {invalid} بنص مختلط/غير صحيح · {failed} فشل لدى المزوّد',
  'translationReview.fields.title': 'الحقول التي تتطلب مراجعة',
  'translationReview.fields.issue': '{issue}',
  'translationReview.fields.paginationLabel': 'صفحات الحقول التي تتطلب مراجعة',
  'translationReview.issue.missing': 'الترجمة مفقودة',
  'translationReview.issue.wrongScript': 'نظام الكتابة غير صحيح',
  'translationReview.issue.duplicateCounterpart': 'القيمة المقابلة مكررة',
  'translationReview.issue.mixed': 'أنظمة كتابة مختلطة',
  'translationReview.issue.providerFailed': 'فشل مزوّد الترجمة',
  'translationReview.provider': 'مزوّد الترجمة',
  'translationReview.provider.choose': 'اختر مزوّدًا…',
  'translationReview.provider.ai':
    'ستُرسل النصوص المطابقة أدناه إلى مزوّد ونموذج الذكاء الاصطناعي المحددين.',
  'translationReview.provider.free':
    'سيُرسل كل نص مطابق إلى Google Translate، وقد تُرسل العناصر الفاشلة إلى MyMemory.',
  'translationReview.outbound.title': 'النص المطابق الذي سيغادر هذا المتصفح',
  'translationReview.outbound.paginationLabel': 'صفحات مراجعة النص الصادر',
  'translationReview.outbound.disclosure':
    'سيستلم {provider} عدد {count} من عناصر النص ضمن نحو {min}–{max} طلبات خارجية. لن يُرسل شيء حتى تضغط «ترجم الآن» أو تؤكد صراحةً إعادة محاولة حقل واحد.',
  'translationReview.outbound.chooseProvider':
    'اختر مزوّدًا لعرض الإفصاح النهائي وتقدير الطلبات. لم يُرسل أي شيء.',
  'translationReview.pagination.status': 'عرض {start}–{end} من {total}. الصفحة {page} من {pages}.',
  'translationReview.pagination.previous': 'الصفحة السابقة',
  'translationReview.pagination.next': 'الصفحة التالية',
  'translationReview.sensitive':
    'هناك {count} عنصرًا من حقول المالك/المسؤولية وقد تتضمن أسماء أشخاص.',
  'translationReview.mixedManual':
    'ستبقى عناصر المصدر مختلطة النص مدرجة للتقسيم أو المراجعة اليدوية ولن تُرسل تلقائيًا.',
  'translationReview.translateNow': 'ترجم الآن',
  'translationReview.partialPreview': 'معاينة الحقول المترجمة فقط',
  'translationReview.applyCompleted': 'تطبيق عرض اللغة المكتمل',
  'translationReview.postpone': 'تأجيل',
  'translationReview.cancel': 'إلغاء الترجمة',
  'translationReview.running': 'جارٍ تنفيذ الترجمة…',
  'translationReview.memorySaving':
    'طُبّقت الترجمة. جارٍ حفظ الأزواج المقبولة في ذاكرة ترجمة مساحة العمل…',
  'translationReview.cancelled': 'أُلغيت الترجمة. ما زالت جميع الحقول غير المحلولة مدرجة.',
  'translationReview.partialStatus':
    'ما زالت بعض الحقول غير محلولة. بقيت مدرجة ولم يُعلن اكتمال لغة المخطط.',
  'translationReview.proposalStatus':
    'تتطلب {count} اقتراحات ترجمة من المزوّد قبولك أو تعديلك أو رفضك قبل تطبيق أي شيء.',
  'translationReview.stagedStatus':
    'تم تجهيز {count} قيمة مراجَعة. لن يتغير شيء حتى التطبيق النهائي.',
  'translationReview.applying': 'جارٍ تطبيق جميع القيم المراجَعة كتغيير واحد قابل للتراجع…',
  'translationReview.progress.partial':
    '{resolved} محلول · {unresolved} غير محلول · {failed} فشل لدى المزوّد. لم تكتمل لغة المخطط.',
  'translationReview.progress.ready':
    'تجتاز جميع الحقول الهدف الآن تدقيق اللغتين. طبّق عرض اللغة المكتمل للإنهاء.',
  'translationReview.field.source': 'النص المصدر',
  'translationReview.field.target': 'النص الهدف',
  'translationReview.field.proposed': 'اقتراح المزوّد',
  'translationReview.field.staged': 'مقبول للتطبيق النهائي',
  'translationReview.field.acceptProposal': 'قبول هذا الاقتراح',
  'translationReview.field.rejectProposal': 'رفض هذا الاقتراح',
  'translationReview.field.unavailable':
    'لم يعد لهذا التشخيص هدف تخزين BPMN آمن. حدّث المراجعة بعد تصحيح حقل المصدر.',
  'translationReview.field.retry': 'إعادة محاولة هذا الحقل',
  'translationReview.field.retrying': 'جارٍ إعادة محاولة هذا الحقل…',
  'translationReview.field.retryDisclosureTitle': 'تأكيد طلب هذا الحقل الواحد',
  'translationReview.field.retryDisclosure':
    'سيُرسل الحقل المطابق أدناه فقط ضمن نحو {min}–{max} طلبات خارجية. لن يُضمّن أي حقل آخر من الحقول المراجعة.',
  'translationReview.field.retryProvider': 'المزوّد والنموذج',
  'translationReview.field.retryContext': 'سياق الحقل',
  'translationReview.field.retryFingerprint': 'بصمة الموافقة',
  'translationReview.field.retrySensitivity.sensitive':
    'قد يحتوي حقل المالك/المسؤولية هذا على اسم شخص.',
  'translationReview.field.retrySensitivity.standard': 'هذا الحقل غير مصنّف كحقل مالك/مسؤولية.',
  'translationReview.field.retryCancel': 'إلغاء إعادة محاولة الحقل الواحد',
  'translationReview.field.retryConfirm': 'تأكيد وإعادة محاولة هذا الحقل',
  'translationReview.field.consentRequired':
    'راجع إفصاح الحقل الواحد الحالي وأكّده قبل إعادة المحاولة.',
  'translationReview.memorySaveFailed':
    'طُبّقت الترجمة، لكن تعذّر حفظ أزواج الترجمة المقبولة في ذاكرة ترجمة مساحة العمل.',
  'translationReview.memoryRecoveryRequired':
    'اختر إعادة محاولة الحفظ للاحتفاظ بالأزواج المقبولة، أو المتابعة دون حفظ. سيبقى مربع الحوار مفتوحًا حتى تختار أحد إجراءَي الاسترداد.',
  'translationReview.memoryRetry': 'إعادة محاولة حفظ الترجمات المقبولة',
  'translationReview.memoryContinue': 'المتابعة دون حفظ هذه الأزواج',
  'translationReview.memorySkipped':
    'ستبقى الترجمة مطبّقة. تابع OrbitPM دون محاولة أخرى لحفظ هذه الأزواج في ذاكرة ترجمة مساحة العمل.',
  'translationReview.field.manual': 'تعديل هذا الحقل يدويًا',
  'translationReview.field.manualCancel': 'إغلاق المحرر اليدوي',
  'translationReview.field.manualSave': 'حفظ القيمة المراجعة',
  'translationReview.field.manualSaving': 'جارٍ حفظ القيمة المراجعة…',
  'translationReview.field.manualPlaceholder': 'أدخل الترجمة المراجعة',
  'translationReview.field.manualEmpty': 'أدخل ترجمة مراجعة غير فارغة.',
  'translationReview.field.manualFailed': 'تعذّر حفظ القيمة المراجعة.',
  'translationReview.field.retryFailed': 'تعذّرت إعادة ترجمة هذا الحقل.',
  'translationReview.error.technicalDetails': 'التفاصيل التقنية',
  'translationReview.error.technicalDetail': 'تفصيل تقني لمراجعة الترجمة',
  'translationReview.stale': 'تغيّر المخطط بعد المراجعة. راجع النص الحالي الصادر قبل الترجمة.',
  'translationReview.noProvider': 'اختر مزوّد ترجمة أولًا.',

  // --- المراجعة اليدوية لإدخال XML ---
  'reviewedXmlReview.title': 'إكمال مراجعة XML ثنائية اللغة',
  'reviewedXmlReview.close': 'إغلاق مراجعة XML ثنائية اللغة',
  'reviewedXmlReview.summary':
    'عالج {count} من أهداف الحقول الثنائية اللغة الفريدة. لن يتغير مصدر BPMN حتى تصبح جميع الصفوف صالحة وتُكمل المراجعة صراحةً.',
  'reviewedXmlReview.pending': 'ما زال {count} من الصفوف يتطلب قيمة مراجعة صالحة.',
  'reviewedXmlReview.ready': 'جميع الصفوف صالحة. يمكنك إكمال المراجعة صراحةً.',
  'reviewedXmlReview.row.title': '{process} / {element} / {field} / {target}',
  'reviewedXmlReview.target.en': 'الإنجليزية',
  'reviewedXmlReview.target.ar': 'العربية',
  'reviewedXmlReview.source': 'النص المصدر المطابق ({language})',
  'reviewedXmlReview.current': 'القيمة الحالية للهدف ({language})',
  'reviewedXmlReview.counterpart': 'القيمة الحالية للنظير ({language})',
  'reviewedXmlReview.empty': '(غير متوفر)',
  'reviewedXmlReview.issues': 'المشكلات المكتشفة',
  'reviewedXmlReview.issue.missing': 'قيمة اللغة الهدف غير متوفرة.',
  'reviewedXmlReview.issue.wrongScript': 'تستخدم القيمة نظام كتابة غير صحيح.',
  'reviewedXmlReview.issue.duplicateCounterpart': 'تكرر القيمة نظيرها غير المحايد.',
  'reviewedXmlReview.issue.mixed': 'تحتوي القيمة على نص مختلط غير معتمد.',
  'reviewedXmlReview.issue.providerFailed': 'لم تنتج الترجمة الآلية قيمة.',
  'reviewedXmlReview.targetValue': 'قيمة الهدف المراجعة ({language})',
  'reviewedXmlReview.rowValid': 'القيمة صالحة لهذه اللغة الهدف.',
  'reviewedXmlReview.approval': 'اعتماد مطابق للحقل',
  'reviewedXmlReview.approval.none': 'من دون استثناء',
  'reviewedXmlReview.approval.neutral': 'اعتماد كمصطلح محايد أو رمز',
  'reviewedXmlReview.approval.englishBilingual': 'اعتماد كاسم علم ثنائي اللغة بالإنجليزية',
  'reviewedXmlReview.approval.help':
    'يرتبط الاعتماد بهذا الحقل وهذه القيمة المطابقة. يؤدي تعديل القيمة إلى مسح الاعتماد.',
  'reviewedXmlReview.cancel': 'إلغاء المراجعة',
  'reviewedXmlReview.complete': 'إكمال المراجعة',

  // --- مراجعة معاملة استيراد مساحة العمل ---
  'workspaceImportReview.title': 'مراجعة استيراد مساحة العمل',
  'workspaceImportReview.close': 'إغلاق مراجعة استيراد مساحة العمل',
  'workspaceImportReview.intro':
    'راجع الخطة المختومة المطابقة وكل الأدلة والتعارضات قبل التأكيد الصريح. يؤدي إغلاق مربع الحوار إلى الإلغاء من دون تغيير ملفات مساحة العمل.',
  'workspaceImportReview.plan': 'الخطة المختومة',
  'workspaceImportReview.status': 'حالة الخطة',
  'workspaceImportReview.status.ready': 'جاهزة',
  'workspaceImportReview.status.blocked': 'محظورة',
  'workspaceImportReview.reviewDigest': 'بصمة المراجعة (SHA-256)',
  'workspaceImportReview.planId': 'معرّف الخطة',
  'workspaceImportReview.createdAt': 'وقت الإنشاء',
  'workspaceImportReview.workspaceId': 'معرّف مساحة العمل',
  'workspaceImportReview.workspaceMode': 'وضع مساحة العمل',
  'workspaceImportReview.targetFolder': 'المجلد الهدف',
  'workspaceImportReview.root': '(جذر مساحة العمل)',
  'workspaceImportReview.summary': 'ملخص الخطة',
  'workspaceImportReview.summary.sources': 'المصادر',
  'workspaceImportReview.summary.artifacts': 'المخرجات',
  'workspaceImportReview.summary.collisions': 'التعارضات',
  'workspaceImportReview.summary.skipped': 'المتخطاة',
  'workspaceImportReview.summary.repairs': 'الإصلاحات',
  'workspaceImportReview.summary.warnings': 'التحذيرات',
  'workspaceImportReview.summary.arisReports': 'تقارير ARIS',
  'workspaceImportReview.summary.creates': 'الملفات الجديدة',
  'workspaceImportReview.summary.identical': 'التعارضات المتطابقة',
  'workspaceImportReview.artifacts': 'المخرجات المجهزة',
  'workspaceImportReview.artifact': 'المخرج {index}: {name}',
  'workspaceImportReview.artifactId': 'معرّف المخرج',
  'workspaceImportReview.sourceName': 'اسم المصدر',
  'workspaceImportReview.sourceId': 'معرّف المصدر',
  'workspaceImportReview.sourceKind': 'نوع المصدر',
  'workspaceImportReview.sourcePath': 'مسار المصدر',
  'workspaceImportReview.destinationPath': 'مسار الوجهة',
  'workspaceImportReview.utf8Bytes': 'حجم UTF-8 المطابق بالبايت',
  'workspaceImportReview.sha256': 'بصمة SHA-256 للمخرج',
  'workspaceImportReview.processIds': 'معرّفات العمليات',
  'workspaceImportReview.replacesProcessIds': 'معرّفات العمليات المستبدلة',
  'workspaceImportReview.localizationMode': 'وضع مراجعة الترجمة',
  'workspaceImportReview.localizationMode.automatic': 'مكتملة تلقائيًا',
  'workspaceImportReview.localizationMode.explicit': 'مراجعة صريحة',
  'workspaceImportReview.localizationDigest': 'بصمة مراجعة الترجمة',
  'workspaceImportReview.none': 'لا يوجد',
  'workspaceImportReview.pagination.navigation': 'صفحات {section}',
  'workspaceImportReview.pagination.status':
    'عرض {start}–{end} من {total}. الصفحة {page} من {pages}.',
  'workspaceImportReview.pagination.previous': 'الصفحة السابقة',
  'workspaceImportReview.pagination.next': 'الصفحة التالية',
  'workspaceImportReview.pagination.previousFor': 'صفحة {section} السابقة',
  'workspaceImportReview.pagination.nextFor': 'صفحة {section} التالية',
  'workspaceImportReview.technicalEvidence': 'الدليل التقني',
  'workspaceImportReview.technicalEvidenceTruncated':
    'تم اقتطاع الدليل التقني إلى {limit} حرف Unicode.',
  'workspaceImportReview.autoLayoutPreview.title': 'معاينات مخططات التخطيط التلقائي',
  'workspaceImportReview.autoLayoutPreview.intro':
    'للحفاظ على استجابة المراجعات الكبيرة، لا يبدأ عرض المخطط إلا عند اختيار مخرج مراجع. يؤدي فتح معاينة أخرى إلى إغلاق المعاينة الحالية.',
  'workspaceImportReview.autoLayoutPreview.open': 'معاينة المخطط',
  'workspaceImportReview.autoLayoutPreview.close': 'إغلاق معاينة المخطط',
  'workspaceImportReview.autoLayoutPreview.openFor': 'معاينة مخطط {path}',
  'workspaceImportReview.autoLayoutPreview.closeFor': 'إغلاق معاينة مخطط {path}',
  'workspaceImportReview.autoLayoutPreview.pagination': 'صفحات معاينات التخطيط التلقائي',
  'workspaceImportReview.autoLayoutPreview.failed': 'تعذّر عرض معاينة المخطط المراجع.',
  'workspaceImportReview.autoLayoutPreview.ready': 'معاينة المخطط المراجع جاهزة.',
  'workspaceImportReview.autoLayoutPreview.warnings':
    'معاينة المخطط المراجع جاهزة مع {count} من تحذيرات العرض.',
  'workspaceImportReview.autoLayoutAcceptance.label':
    'أوافق على جميع إصلاحات التخطيط التلقائي المدرجة وعددها {count}.',
  'workspaceImportReview.autoLayoutAcceptance.hint':
    'تتوفر معاينات المخططات عند الطلب أعلاه. يؤدي تأكيد الاستيراد إلى تطبيق XML المُصلح والمختوم بدقة لكل مخرج مدرج.',
  'workspaceImportReview.autoLayoutAcceptance.required':
    'وافق على جميع إصلاحات التخطيط التلقائي المدرجة قبل تأكيد هذا الاستيراد.',
  'workspaceImportReview.skipped': 'المدخلات المتخطاة',
  'workspaceImportReview.skippedItem': 'المدخل المتخطى {index}',
  'workspaceImportReview.path': 'المسار',
  'workspaceImportReview.reason': 'السبب',
  'workspaceImportReview.reason.unsupportedContent': 'محتوى غير مدعوم',
  'workspaceImportReview.reason.bpmnNotSupported': 'إدخال BPMN غير مدعوم في هذا الإصدار',
  'workspaceImportReview.reason.unsafePath': 'مسار غير آمن',
  'workspaceImportReview.reason.invalidBpmn': 'ملف BPMN غير صالح',
  'workspaceImportReview.reason.amlConversionFailed': 'فشل تحويل AML من ARIS',
  'workspaceImportReview.reason.processIdCollision': 'تعارض في معرّف العملية',
  'workspaceImportReview.reason.processIdentityChanged': 'تغيّرت هوية العملية أثناء المراجعة',
  'workspaceImportReview.reason.localizationReviewRequired': 'تلزم مراجعة الترجمة',
  'workspaceImportReview.reason.localizationReviewCancelled': 'أُلغيت مراجعة الترجمة',
  'workspaceImportReview.reason.localizationInvalid': 'فشل التحقق من الترجمة',
  'workspaceImportReview.reason.destinationParentFile': 'المجلد الأصل للوجهة هو ملف',
  'workspaceImportReview.reason.libraryNotBpmn': 'إدخال ZIP ليس BPMN',
  'workspaceImportReview.reason.libraryUnsafePath': 'مسار إدخال ZIP غير آمن',
  'workspaceImportReview.reason.libraryTooLarge': 'إدخال ZIP كبير جدًا',
  'workspaceImportReview.reason.libraryDecodeFailed': 'تعذّر فك ترميز إدخال ZIP',
  'workspaceImportReview.reason.unknown': 'سبب تخطٍ غير معروف',
  'workspaceImportReview.skip.unsupportedContent':
    'تم تخطي المدخل لأنه ليس محتوى ARIS AML/XML معروفًا.',
  'workspaceImportReview.skip.bpmnNotSupported':
    'تم تخطي المدخل لأن هذا الإصدار المقتصر على ARIS يقبل فقط صادرات ARIS AML/XML.',
  'workspaceImportReview.skip.unsafePath':
    'تم تخطي المدخل لأن مساره لا يمكن احتواؤه بأمان داخل مساحة العمل.',
  'workspaceImportReview.skip.invalidBpmn': 'تم تخطي المدخل لأن التحقق من BPMN لم يكتمل بنجاح.',
  'workspaceImportReview.skip.amlConversionFailed': 'تعذّر تحويل مدخل ARIS AML إلى ملف BPMN مراجع.',
  'workspaceImportReview.skip.processIdCollision':
    'كان المدخل سينشئ هوية عملية أو ينقلها خارج ارتباطها المراجع بمساحة العمل.',
  'workspaceImportReview.skip.processIdentityChanged':
    'تغيّرت هوية العملية بعد المراجعة، لذلك لم تعد الخطة المختومة قادرة على تطبيقها.',
  'workspaceImportReview.skip.localizationReviewRequired':
    'يحتاج المدخل إلى مراجعة ثنائية اللغة صريحة قبل تجهيزه.',
  'workspaceImportReview.skip.localizationReviewCancelled':
    'لم يتم تجهيز المدخل لأن مراجعته ثنائية اللغة أُلغيت.',
  'workspaceImportReview.skip.localizationInvalid':
    'لم يجتز المحتوى ثنائي اللغة المراجع عملية التحقق.',
  'workspaceImportReview.skip.destinationParentFile':
    'لا يمكن إنشاء الوجهة لأن أحد المسارات الأصلية لها ملف.',
  'workspaceImportReview.skip.libraryNotBpmn': 'تم تخطي إدخال ZIP لأنه ليس ملف BPMN.',
  'workspaceImportReview.skip.libraryUnsafePath': 'تم تخطي إدخال ZIP لأن مساره غير آمن.',
  'workspaceImportReview.skip.libraryTooLarge': 'تم تخطي إدخال ZIP لأنه يتجاوز حد الحجم الآمن.',
  'workspaceImportReview.skip.libraryDecodeFailed':
    'تم تخطي إدخال ZIP لأنه تعذّر فك ترميز نصه بأمان.',
  'workspaceImportReview.skip.unknown': 'تم تخطي المدخل لسبب لا يتعرف عليه هذا الإصدار.',
  'workspaceImportReview.guidance.chooseSupportedContent':
    'قدّم محتوى ARIS AML/XML معروفًا ثم راجعه مرة أخرى.',
  'workspaceImportReview.guidance.chooseArisOnlyContent':
    'صدّر ARIS AML/XML من النظام المصدر ثم أعد مراجعة هذا الاستيراد.',
  'workspaceImportReview.guidance.useSafePath':
    'اختر وجهة نسبية آمنة تكون مجلداتها الأصلية داخل مساحة العمل.',
  'workspaceImportReview.guidance.repairBpmn':
    'صحح نتائج تحقق BPMN، ثم أنشئ خطة الاستيراد وراجعها من جديد.',
  'workspaceImportReview.guidance.reviewArisExport':
    'تحقق من تصدير ARIS وتقرير التحويل، ثم صدّر النموذج أو حوّله مرة أخرى.',
  'workspaceImportReview.guidance.resolveProcessIdentity':
    'حل تعارض معرّف العملية ومسار مساحة العمل، ثم أنشئ خطة مراجعة جديدة.',
  'workspaceImportReview.guidance.repeatReview':
    'حدّث مساحة العمل وكرر مراجعة الاستيراد وفق هويات العمليات الحالية.',
  'workspaceImportReview.guidance.completeLocalization':
    'أكمل المراجعة ثنائية اللغة وعالج كل نتائج الترجمة قبل الاستيراد.',
  'workspaceImportReview.guidance.reduceLibraryEntry':
    'قلّل ملف BPMN أو قسّمه ليبقى إدخال الأرشيف ضمن حد الحجم الآمن.',
  'workspaceImportReview.guidance.decodeUtf8':
    'أعد ترميز ملف BPMN بصيغة UTF-8 صالحة ثم أعد إنشاء مكتبة ZIP.',
  'workspaceImportReview.guidance.reviewArisReport':
    'راجع تقرير تحويل ARIS القابل للتنزيل وتحقق من النموذج المحوّل.',
  'workspaceImportReview.guidance.reviewReplacement':
    'تأكد من وجوب استبدال كل عملية مدرجة في مسار مساحة العمل المراجع فقط.',
  'workspaceImportReview.guidance.unknown':
    'راجع الدليل التقني المسمّى وصحح المصدر ثم أنشئ خطة استيراد جديدة.',
  'workspaceImportReview.message': 'الرسالة',
  'workspaceImportReview.suggestedRepair': 'الإصلاح المقترح',
  'workspaceImportReview.technicalCode': 'الرمز التقني',
  'workspaceImportReview.technicalDiagnostic': 'التشخيص التقني',
  'workspaceImportReview.validationSeverity': 'خطورة نتيجة التحقق',
  'workspaceImportReview.validationSource': 'مصدر التحقق',
  'workspaceImportReview.validationSeverityUnknown': 'خطورة تحقق غير معروفة',
  'workspaceImportReview.validationSourceUnknown': 'مصدر تحقق غير معروف',
  'workspaceImportReview.validationCode': 'رمز التحقق',
  'workspaceImportReview.validationRuleId': 'معرّف قاعدة التحقق',
  'workspaceImportReview.validationDiagnostic': 'تشخيص التحقق',
  'workspaceImportReview.warnings': 'التحذيرات',
  'workspaceImportReview.warningItem': 'التحذير {index}',
  'workspaceImportReview.warning.amlDowngraded': 'بسّط تحويل ARIS عدد {count} من قرارات المصدر.',
  'workspaceImportReview.warning.amlIgnored': 'تجاهل تحويل ARIS عدد {count} من قرارات المصدر.',
  'workspaceImportReview.warning.amlAmbiguous':
    'وجد تحويل ARIS عدد {count} من قرارات المصدر الملتبسة.',
  'workspaceImportReview.warning.amlUnmapped':
    'تعذّر على تحويل ARIS تعيين {count} من قرارات المصدر.',
  'workspaceImportReview.warning.samePathProcessReplacement':
    'سيتم استبدال {count} من معرّفات العمليات الموجودة في مسار مساحة العمل المراجع نفسه.',
  'workspaceImportReview.warning.unknown':
    'أبلغ مخطط الاستيراد عن تحذير لا يتعرف عليه هذا الإصدار.',
  'workspaceImportReview.code': 'الرمز',
  'workspaceImportReview.count': 'العدد',
  'workspaceImportReview.validationIssue': 'مشكلة التحقق',
  'workspaceImportReview.repairs': 'الإصلاحات التلقائية',
  'workspaceImportReview.repairItem': 'الإصلاح {index}',
  'workspaceImportReview.appliedRepair.amlConverted': 'تم تحويل ARIS AML إلى مخرج BPMN 2.0 مراجع.',
  'workspaceImportReview.appliedRepair.autoLayout':
    'تم إنشاء معلومات رسم BPMN الناقصة وإعادة التحقق من المخرج المطابق.',
  'workspaceImportReview.appliedRepair.destinationNormalized':
    'تم توحيد الوجهة إلى مسار BPMN قابل للنقل داخل مساحة العمل.',
  'workspaceImportReview.appliedRepair.destinationDeduplicated':
    'تم تغيير الوجهة لتجنب مخرج آخر في هذه الخطة.',
  'workspaceImportReview.appliedRepair.destinationCaseNormalized':
    'تم توحيد حالة أحرف الوجهة مع مسار مساحة العمل الموجود.',
  'workspaceImportReview.appliedRepair.unknown':
    'طبّق المخطط إصلاحًا تلقائيًا لا يتعرف عليه هذا الإصدار.',
  'workspaceImportReview.before': 'قبل',
  'workspaceImportReview.after': 'بعد',
  'workspaceImportReview.aris': 'تقارير تحويل ARIS',
  'workspaceImportReview.arisItem': 'تقرير ARIS رقم {index}: {name}',
  'workspaceImportReview.aris.converted': 'المحوّلة',
  'workspaceImportReview.aris.downgraded': 'المبسّطة',
  'workspaceImportReview.aris.ignored': 'المتجاهلة',
  'workspaceImportReview.aris.ambiguous': 'الملتبسة',
  'workspaceImportReview.aris.unmapped': 'غير المعيّنة',
  'workspaceImportReview.reportFile': 'ملف التقرير',
  'workspaceImportReview.arisDownload': 'تنزيل تقرير ARIS',
  'workspaceImportReview.arisDownloadUnavailable': 'تنزيل التقرير غير متاح.',
  'workspaceImportReview.collisions': 'تعارضات الوجهة',
  'workspaceImportReview.collisionItem': 'التعارض {index}: {path}',
  'workspaceImportReview.incomingHash': 'بصمة SHA-256 الواردة',
  'workspaceImportReview.existingHash': 'بصمة SHA-256 الموجودة',
  'workspaceImportReview.suggestedKeepBoth': 'وجهة الاحتفاظ بكليهما المقترحة',
  'workspaceImportReview.identical': 'الملف مطابق — الإجراء الافتراضي والوحيد هو التخطي.',
  'workspaceImportReview.decision': 'قرار التعارض',
  'workspaceImportReview.decision.choose': 'اختر إجراءً…',
  'workspaceImportReview.decision.replace': 'استبدال الملف الموجود',
  'workspaceImportReview.decision.skip': 'تخطي هذا الملف',
  'workspaceImportReview.decision.keepBoth': 'الاحتفاظ بالملفين',
  'workspaceImportReview.keepBothDestination': 'وجهة الاحتفاظ بكليهما',
  'workspaceImportReview.keepBoth.adapterDisabled':
    'الاحتفاظ بكليهما غير متاح لأن محوّل مساحة العمل لا يمكنه إنشاء عدة ملفات.',
  'workspaceImportReview.keepBoth.identityDisabled':
    'الاحتفاظ بكليهما غير متاح لأن هذا المخرج يستبدل هويات عمليات موجودة.',
  'workspaceImportReview.keepBoth.invalid': 'أدخل مسار ملف نسبيًا صالحًا في مساحة العمل.',
  'workspaceImportReview.keepBoth.reserved':
    'لا يمكن استخدام نطاق مساحة العمل المحجوز .orbitpm وجهةً للاستيراد.',
  'workspaceImportReview.keepBoth.occupied': 'هذه الوجهة مشغولة مسبقًا بمخرج في الخطة المراجعة.',
  'workspaceImportReview.keepBoth.duplicate': 'لا يمكن لقراري احتفاظ بكليهما استخدام الوجهة نفسها.',
  'workspaceImportReview.reservedPlanDestination':
    'التأكيد محظور لأن الخطة تحتوي على وجهة محجوزة ضمن .orbitpm.',
  'workspaceImportReview.blocked': 'خطة الاستيراد هذه محظورة ولا يمكن تأكيدها.',
  'workspaceImportReview.unresolved':
    'ما زال {count} من قرارات التعارض غير المتطابقة يتطلب اختيارًا صريحًا.',
  'workspaceImportReview.invalidDecision':
    'أصلح كل وجهات الاحتفاظ بكليهما غير الصالحة قبل التأكيد.',
  'workspaceImportReview.ready': 'الخطة المراجعة جاهزة للتأكيد الصريح.',
  'workspaceImportReview.error': 'خطأ في الاستيراد',
  'workspaceImportReview.errorSummary':
    'تعذّر إكمال استيراد مساحة العمل. راجع الدليل التقني، ثم أعد المحاولة أو ألغِ العملية.',
  'workspaceImportReview.busy': 'جارٍ تطبيق استيراد مساحة العمل…',
  'workspaceImportReview.cancel': 'إلغاء الاستيراد',
  'workspaceImportReview.confirm': 'تأكيد الاستيراد',
  'workspaceImportReview.confirming': 'جارٍ التأكيد…',

  // --- أوضاع تخزين مساحة العمل والاسترداد ---
  'workspace.storage.current': 'التخزين: {mode}',
  'workspace.storage.mode.directory': 'مساحة عمل في مجلد',
  'workspace.storage.mode.opfs': 'مساحة عمل في المتصفح',
  'workspace.storage.mode.singleFile': 'ملف واحد',
  'workspace.storage.persistence.directory': 'تُحفظ الملفات في المجلد الذي اخترته.',
  'workspace.storage.persistence.opfsDurable': 'تخزين المتصفح دائم على هذا الجهاز.',
  'workspace.storage.persistence.opfsBestEffort':
    'تخزين المتصفح بأفضل جهد؛ صدّر نسخًا احتياطية بانتظام.',
  'workspace.storage.persistence.singleFile':
    'يؤدي الحفظ إلى تنزيل ملف BPMN ولا تُحتفظ بمساحة عمل.',
  'workspace.storage.chooseDirectory': 'اختيار مساحة عمل في مجلد',
  'workspace.storage.openOpfs': 'فتح مساحة عمل المتصفح',
  'workspace.storage.opfsOpenFailed':
    'تعذّر فتح مساحة عمل المتصفح. حاول مرة أخرى أو اختر خيار تخزين آخر.',
  'workspace.storage.opfsOpenTechnicalEvidence': 'دليل تقني — فتح مساحة عمل المتصفح: {error}',
  'workspace.storage.openSingleFile': 'فتح ملف ARIS AML/XML واحد',
  'workspace.storage.backupExport': 'تصدير نسخة احتياطية لمساحة العمل',
  'workspace.storage.backupImport': 'استيراد نسخة احتياطية لمساحة العمل',
  'workspace.storage.collisionReview': 'مراجعة تعارضات ملفات النسخة الاحتياطية',
  'workspace.storage.collisionReplace': 'استبدال الملف الموجود',
  'workspace.storage.collisionSkip': 'تخطي هذا الملف',
  'workspace.storage.collisionKeepBoth': 'الاحتفاظ بالملفين',
  'workspace.storage.collisionIdentical': 'ملف مطابق — لا حاجة إلى تغيير',
  'workspace.storage.backupApply': 'تطبيق استيراد النسخة الاحتياطية',
  'workspace.storage.backupReview.intro':
    'راجع خطة النسخة الاحتياطية المختومة المطابقة وأدلة ترجمة ملفات BPMN النشطة قبل التطبيق. لا يؤدي إغلاق مربع الحوار إلى تغيير ملفات مساحة العمل.',
  'workspace.storage.backupReview.summary': '{files} ملف · {size}',
  'workspace.storage.backupReview.sealedPlan': 'خطة النسخة الاحتياطية المختومة',
  'workspace.storage.backupReview.planReviewDigest': 'بصمة مراجعة الخطة (SHA-256)',
  'workspace.storage.backupReview.localizationTitle': 'أدلة ترجمة ملفات BPMN النشطة',
  'workspace.storage.backupReview.localizationIntro':
    'أكمل كل ملف BPMN نشط أدناه مراجعة الترجمة. تبقى ملفات BPMN الداخلية في سجل الاسترداد أدلة مطابقة ولا تُراجع إلا عند استعادتها.',
  'workspace.storage.backupReview.localizationNone': 'لا توجد ملفات BPMN نشطة تتطلب أدلة ترجمة.',
  'workspace.storage.backupReview.file': 'ملف BPMN مُراجع {index}',
  'workspace.storage.backupReview.path': 'المسار في مساحة العمل',
  'workspace.storage.backupReview.mode': 'وضع المراجعة',
  'workspace.storage.backupReview.mode.automatic': 'مكتملة تلقائيًا',
  'workspace.storage.backupReview.mode.explicit': 'مراجعة صريحة',
  'workspace.storage.backupReview.target': 'اللغة الهدف',
  'workspace.storage.backupReview.target.en': 'الإنجليزية',
  'workspace.storage.backupReview.target.ar': 'العربية',
  'workspace.storage.backupReview.localizationReviewDigest': 'بصمة مراجعة الترجمة',
  'workspace.storage.backupReview.outputDigest': 'بصمة المخرج المُراجع',
  'workspace.storage.backupReview.processIds': 'معرّفات العمليات',
  'workspace.storage.backupReview.replacesProcessIds': 'معرّفات العمليات المستبدلة',
  'workspace.storage.backupReview.audit': 'تدقيق الترجمة',
  'workspace.storage.backupReview.auditSummary':
    'المشكلات قبل المراجعة: {initial} · بعدها: {final}',
  'workspace.storage.backupReview.patches': 'تغييرات الترجمة المطبقة',
  'workspace.storage.backupReview.verified':
    'تم التحقق من اللغة الهدف الظاهرة والحفاظ على الامتدادات غير المعروفة.',
  'workspace.storage.backupReview.none': 'لا شيء',
  'workspace.storage.backupReview.collisions': 'تعارضات الملفات',
  'workspace.storage.backupReview.collisionDecision': 'قرار التعارض',
  'workspace.storage.backupReview.keepBothIdentityDisabled':
    'يتعذر الاحتفاظ بالملفين لأن ملف BPMN هذا يستبدل معرّفات عمليات موجودة.',
  'workspace.storage.history': 'سجل الاسترداد',
  'workspace.storage.switchWarning':
    'يؤدي تبديل التخزين إلى إغلاق مساحة العمل الحالية. احفظ أو صدّر نسخة احتياطية أولًا.',
  'workspace.duplicate.title': 'يظهر معرّف العملية {id} في عدة ملفات: {paths}',
  'workspace.duplicate.repair': 'إصلاح معرّفات العمليات المكررة',
  'workspace.history.preview': 'معاينة النسخة',
  'workspace.history.diff': 'المقارنة مع الملف الحالي',
  'workspace.history.restore': 'استعادة النسخة',
  'workspace.history.restoreCopy': 'الاستعادة كنسخة',
  'workspace.history.empty': 'لا توجد نسخ استرداد متاحة لهذا الملف.',
  'workspace.history.pageEmpty': 'لا توجد نسخ استرداد متاحة في هذه الصفحة.',
  'workspace.history.pagination.label': 'صفحات سجل الاسترداد',
  'workspace.history.pagination.status': 'صفحة السجل {page}. يتم عرض {count} إدخالًا.',
  'workspace.history.pagination.previous': 'الصفحة السابقة',
  'workspace.history.pagination.next': 'الصفحة التالية',
  'workspace.history.reason.overwrite': 'قبل الاستبدال',
  'workspace.history.reason.delete': 'قبل الحذف',
  'workspace.history.reason.restore': 'قبل الاستعادة',
  'workspace.history.reason.manual': 'نسخة يدوية',
  'workspace.history.reason.backupImport': 'قبل استيراد النسخة الاحتياطية',
  'workspace.history.reason.unknown': 'سبب نسخة غير معروف',
  'workspace.history.copyPrompt': 'اسم ملف النسخة المستعادة',
  'workspace.history.copyDestinationRequired': 'أدخل مسارًا للنسخة المستعادة.',
  'workspace.history.copyDestinationInvalid':
    '«{destination}» ليس مسارًا نسبيًا صالحًا لملف BPMN. استخدم اسم ملف ينتهي بـ .bpmn.',
  'workspace.history.copyFailed': 'لم تكتمل الاستعادة كنسخة ({outcome}).',
  'workspace.history.restoreFailed': 'فشلت استعادة السجل: {error}',
  'workspace.history.restoreNotComplete': 'لم تكتمل الاستعادة ({outcome}).',
  'workspace.history.action.listFailed': 'تعذّر تحميل سجل الاسترداد.',
  'workspace.history.action.previewFailed': 'تعذّرت معاينة نسخة السجل هذه.',
  'workspace.history.action.diffFailed': 'تعذّرت مقارنة نسخة السجل هذه.',
  'workspace.history.action.restoreFailed': 'تعذّرت استعادة نسخة السجل هذه.',
  'workspace.history.action.restoreCopyFailed': 'تعذّرت استعادة نسخة السجل هذه كنسخة.',
  'workspace.history.action.workspaceRefreshAfterRestoreFailed':
    'تمت استعادة النسخة في التخزين، لكن تعذّر تحديث مساحة العمل.',
  'workspace.history.action.sessionRefreshAfterRestoreFailed':
    'تمت استعادة النسخة في التخزين، لكن تعذّر تحديث الجلسة المفتوحة.',
  'workspace.history.action.technicalDetails': 'التفاصيل التقنية:',
  'workspace.history.restoreCancelled': 'تم إلغاء استعادة السجل.',
  'workspace.history.applyEditorChangedBefore': 'تغيّر المحرّر المفتوح قبل تطبيق XML من السجل.',
  'workspace.history.applyEditorSynchronizationUnavailable': 'أمر مزامنة المحرّر غير جاهز.',
  'workspace.history.applyTargetSessionChanged': 'تغيّرت جلسة السجل المستهدفة أثناء تطبيق XML.',
  'workspace.history.applyLiveEditorUnverified':
    'تم تطبيق XML من السجل، لكن تعذّر التحقق من المحرّر المباشر: {error}',
  'workspace.history.applyEditorChangedDuring': 'تغيّر المحرّر المفتوح أثناء تطبيق XML من السجل.',
  'workspace.history.restoreReason.cancelled': 'أُلغيت الاستعادة',
  'workspace.history.restoreReason.reviewRequired': 'تلزم مراجعة إضافية',
  'workspace.history.restoreReason.stale': 'تغيّرت مساحة العمل قبل الاستعادة',
  'workspace.history.restoreReason.unknown': 'تعذّر إعداد الاستعادة',
  'workspace.history.saveOutcome.permissionLoss': 'فُقد إذن الوصول إلى مساحة العمل',
  'workspace.history.saveOutcome.externalConflict': 'تغيّرت الوجهة ({reason})',
  'workspace.history.saveOutcome.staleWorkspace': 'تغيّرت مساحة العمل النشطة',
  'workspace.history.saveOutcome.cancelled': 'أُلغيت الكتابة إلى التخزين',
  'workspace.history.saveOutcome.storageFailure': 'فشلت الكتابة إلى التخزين',
  'workspace.history.saveOutcome.unknown': 'أُعيدت نتيجة تخزين غير معروفة',
  'workspace.history.conflictReason.hashMismatch': 'تغيّر محتوى الملف',
  'workspace.history.conflictReason.missing': 'الملف غير موجود',
  'workspace.history.conflictReason.alreadyExists': 'الملف موجود مسبقًا',
  'workspace.history.conflictReason.unknown': 'حدث تعارض غير معروف',
  'workspace.history.issue.unreadable': 'تعذّرت قراءة بيانات تعريف السجل للمسار «{path}».',
  'workspace.history.issue.invalidMetadata': 'بيانات تعريف السجل للمسار «{path}» غير صالحة.',
  'workspace.history.issue.missingContent':
    'تشير بيانات تعريف السجل للمسار «{path}» إلى محتوى نسخة مفقود.',
  'workspace.history.issue.checksumMismatch':
    'فشل التحقق من المجموع الاختباري للنسخة المحفوظة للمسار «{path}».',
  'workspace.history.issue.orphanContent':
    'تم العثور على محتوى استرداد غير مرتبط في المسار «{path}».',
  'workspace.history.issue.retentionLimit':
    'بلغ سجل الاسترداد حد التخزين؛ تم الاحتفاظ بأحدث نسخة لكل عملية.',
  'workspace.history.issue.unknown': 'تعذّر تحميل إدخال السجل للمسار «{path}».',
  'workspace.history.restoreWorkspaceRefreshFailed':
    'تمت استعادة النسخة في التخزين، لكن تعذّر تحديث مساحة العمل: {error}',
  'workspace.history.restoreSessionRefreshFailed':
    'تمت استعادة النسخة في التخزين، لكن تعذّر تحديث الجلسة المفتوحة: {error}',
  'workspace.history.unknownError': 'لم تتوفر تفاصيل إضافية عن الخطأ.',
  'workspace.history.unavailable': 'استعادة السجل غير متاحة لأن جلسة مساحة العمل لم تعد نشطة.',
  'workspace.history.current': 'الملف الحالي',
  'workspace.history.previewTruncated':
    'تقتصر معاينة النسخة على أول {shown} حرفًا للسلامة؛ ولا يُعرض {omitted} حرفًا. ما زالت الاستعادة تستخدم النسخة الكاملة.',
  'workspace.history.diffBounded':
    'تظهر كتلة استبدال محدودة لأن محاذاة الأسطر التفصيلية تجاوزت حد العمل الآمن.',
  'workspace.history.diffTruncated':
    'معاينة المقارنة هذه غير مكتملة وقد تم تقييدها للسلامة. المحتوى غير المعروض: {rows} صفًا و{characters} حرفًا و{hunks} مقاطع فروقات و{operations} عمليات محاذاة.',
  'workspace.history.diffInputTruncated':
    'تجاوز الإدخال حد التفاصيل بمقدار {oldCharacters} حرفًا من النسخة و{newCharacters} حرفًا من الملف الحالي، إضافة إلى {oldLines} سطرًا من النسخة و{newLines} سطرًا من الملف الحالي.',
  'workspace.history.liveEditorUnverifiedAfterRestore':
    'تمت استعادة التخزين من السجل، لكن تعذّر التحقق من المحرّر المباشر.',
  'workspace.history.newerRevisionBeforeCleanup':
    'وصلت نسخة أحدث من المحرّر قبل اكتمال تنظيف السجل.',
  'workspace.history.liveEditorUnverifiedAfterCleanup':
    'اكتمل تنظيف السجل، لكن تعذّر التحقق من المحرّر المباشر.',
  'workspace.history.newerRevisionDuringCleanup': 'وصلت نسخة أحدث من المحرّر أثناء تنظيف السجل.',
  'workspace.history.editorRefreshIncompleteAfterRestore':
    'تمت استعادة التخزين من السجل، لكن لم يكتمل تحديث المحرّر.',
  'workspace.diagnostic.none': 'لا شيء',
  'workspace.diagnostic.complete': 'مكتمل',
  'workspace.diagnostic.unknown': 'غير معروف',
  'workspace.import.rollbackEvidence':
    '{error}؛ المراجعة: {review}؛ المطبّق: {applied}؛ التراجع: {rollback}',
  'workspace.import.postCommitReconciliationFailed':
    'تم تنفيذ تخزين استيراد مساحة العمل، لكن تعذّرت مطابقة مساحة العمل المفتوحة. راجع الدليل التقني قبل المتابعة.',
  'workspace.import.postCommitWarning':
    'اكتمل استيراد مساحة العمل، لكن تنظيف سجل الاسترداد يحتاج إلى مراجعة.',
  'workspace.import.postCommitTechnicalEvidence':
    'دليل تقني — استيراد مساحة العمل بعد التنفيذ: {error}',
  'workspace.backup.rollbackEvidence': '{error}؛ المطبّق: {applied}؛ التراجع: {rollback}',
  'workspace.backup.historyRetentionFailed':
    'اكتمل استيراد النسخة الاحتياطية، لكن فشل تنظيف سجل الاسترداد.',
  'workspace.backup.historyRetentionTechnicalEvidence':
    'دليل تقني — الاحتفاظ بسجل النسخة الاحتياطية: {error}',
  'workspace.backup.postCommitReconciliationFailed':
    'تم تنفيذ تخزين النسخة الاحتياطية، لكن تعذّرت مطابقة مساحة العمل المفتوحة. راجع الدليل التقني قبل المتابعة.',
  'workspace.backup.postCommitTechnicalEvidence':
    'دليل تقني — استيراد النسخة الاحتياطية بعد التنفيذ: {error}',
  'workspace.localization.workspaceImportRollbackUncertain':
    'أدى التراجع عن استيراد مساحة العمل إلى حالة غير مؤكدة لموارد الترجمة.',
  'workspace.localization.backupRollbackUncertain':
    'أدى التراجع عن النسخة الاحتياطية إلى حالة غير مؤكدة لموارد الترجمة.',
  'workspace.localization.backupCommittedReloadFailed':
    'تعذّر إعادة تحميل موارد الترجمة بعد تنفيذ النسخة الاحتياطية.',
  'workspace.sync.reviewedImportEditorChanged':
    'تغيّر المحرّر المفتوح أثناء تنفيذ الاستيراد الذي تمت مراجعته.',
  'workspace.sync.reviewedImportLocalRetained':
    'تغيّر المحرّر المفتوح أثناء تنفيذ الاستيراد الذي تمت مراجعته؛ احتُفظ بملف XML المحلي كمسودة استرداد.',
  'workspace.sync.committedReloadEditorChanged':
    'تغيّر المحرّر المفتوح أثناء إعادة تحميل XML المنفّذ.',
  'workspace.sync.committedReloadLocalRetained':
    'تغيّر المحرّر المفتوح أثناء إعادة تحميل XML المنفّذ؛ احتُفظ بملف XML المحلي الأحدث كمسودة استرداد.',
  'workspace.sync.postCommitCleanupLocalRetained':
    'تغيّر المحرّر المفتوح أثناء التنظيف بعد التنفيذ؛ احتُفظ بملف XML المحلي الأحدث كمسودة استرداد.',
  'workspace.manifest.warning': 'تحذير في بيان مساحة العمل عند «{path}»: {error}',
  'workspace.manifest.postCommitError': 'حُفظ التغيير، لكن تعذّر تحديث بيان مساحة العمل: {error}',
  'workspace.manifest.repaired': 'تم إصلاح بيان مساحة العمل.',
  'workspace.manifest.retryFailed': 'تعذّر إصلاح بيان مساحة العمل: {error}',
  'workspace.manifest.retryTitle': 'هل تريد إصلاح بيان مساحة العمل؟',
  'workspace.manifest.retryMessage':
    'ملفاتك محفوظة، لكن البيانات الوصفية لمساحة العمل غير محدّثة: {error}',
  'workspace.manifest.retryAction': 'إعادة محاولة الإصلاح',
  'workspace.path.finalizeWarning':
    'تم تنفيذ التغيير على «{path}»، لكن تعذّر إكمال التنظيف. احتُفظ ببيانات الاسترداد: {error}',
  'workspace.path.dirtyTitle': 'تغييرات غير محفوظة في المستندات المتأثرة',
  'workspace.path.dirtyMessage':
    'تؤثر عملية {operation} على «{path}» في {count} مستندات غير محفوظة. احفظها قبل المتابعة أو تابع دون حفظ أو ألغِ العملية.',
  'workspace.path.operation.rename': 'إعادة التسمية',
  'workspace.path.operation.move': 'النقل',
  'workspace.path.operation.delete': 'الحذف',
  'workspace.path.operation.history': 'استعادة السجل',
  'workspace.path.saveContinue': 'الحفظ والمتابعة',
  'workspace.path.continueWithoutSaving': 'المتابعة دون حفظ',
  'workspace.path.cancel': 'إلغاء',
  'workspace.path.recoveryTitle': 'إكمال تنظيف التغيير المنفّذ',
  'workspace.path.recoveryMessage':
    'تم تنفيذ التغيير على «{path}»، لكن لم يكتمل تنظيف بيانات الاسترداد: {error}',
  'workspace.path.recoveryRetry': 'إعادة محاولة التنظيف',
  'workspace.path.recoveryLater': 'الاحتفاظ ببيانات الاسترداد لوقت لاحق',
  'workspace.path.recoverySuccess': 'اكتمل تنظيف بيانات الاسترداد.',
  'workspace.path.recoveryFailed': 'تعذّر تنظيف بيانات الاسترداد: {error}',
  'workspace.path.unavailable': 'لم تعد عملية مساحة العمل هذه متاحة لأن مساحة العمل تغيّرت.',
  'workspace.path.saveFailed': 'تعذّر حفظ أحد المستندات المتأثرة: {error}',
  'workspace.path.failed': 'فشلت عملية مساحة العمل: {error}',
  'workspace.create.stale': 'تغيّرت مساحة العمل قبل إنشاء العنصر. أعد المحاولة.',
  'workspace.create.failed': 'تعذّر إنشاء العنصر ({status}).',
  'workspace.create.noAvailableName': 'لا يتوفر اسم ملف خالٍ من التعارض.',
  'draftRecovery.title': 'مراجعة مسودة الاسترداد',
  'draftRecovery.summary':
    'عُثر على مسودة غير محفوظة للملف «{title}» من {timestamp}. الحالة: {relation}. لن يُستبدل أي محتوى قبل اختيارك.',
  'draftRecovery.saved': 'النسخة المحفوظة',
  'draftRecovery.draft': 'المسودة المستردة',
  'draftRecovery.download': 'تنزيل المسودة',
  'draftRecovery.discard': 'الاحتفاظ بالمحفوظ وحذف المسودة',
  'draftRecovery.restore': 'استعادة المسودة',
  'draftRecovery.relation.same-content': 'المحتوى مطابق',
  'draftRecovery.relation.same-base': 'المسودة مبنية على النسخة المحفوظة الحالية',
  'draftRecovery.relation.base-diverged': 'تغيّرت النسخة المحفوظة بعد إنشاء المسودة',
  'draftRecovery.relation.unknown-base': 'تعذّر تأكيد النسخة الأساسية',
  'draftRecovery.error': 'فشل استرداد المسودة: {error}',
  'draftRecovery.degraded':
    'الاسترداد الدائم للمسودات غير متاح في جلسة المتصفح هذه. يمكن تنزيل المسودات غير المحفوظة، لكنها لن تبقى بعد إعادة التحميل.',
  'workspace.coordination.error': 'فشل تنسيق مساحة العمل: {error}',
  'workspace.coordination.changed':
    'تغيّر «{path}» في علامة تبويب OrbitPM أخرى. احتُفظ بمسودتك المحلية؛ راجعها قبل الحفظ.',
  'session.save.externalConflict':
    'تغيّر «{path}» خارج علامة التبويب هذه ({reason}). أُوقف الحفظ واحتُفظ بمسودتك المحلية.',
  'session.save.reloadEditorFailed':
    'تم اختيار نسخة القرص، لكن تعذّر تحديث المحرّر المفتوح. قد تظل الجلسة تعرض تعديلاتك السابقة؛ راجعها قبل المتابعة: {error}',
  'session.save.liveXmlCaptureDetail': '{error}؛ التقاط XML المباشر: {captureError}',
  'session.save.localCanvasRecoveryDetail': '{error}؛ استرداد لوحة الرسم المحلية: {recoveryError}',
  'session.save.retainedEditorCaptureFailed':
    '{reason} فشل التقاط XML المباشر، لذا تُركت لوحة الرسم دون تغيير ووُسمت بأنها معدّلة: {error}',
  'session.save.retainedEditorChangedDuringRecovery':
    '{reason} استمر المحرّر في التغيّر أثناء الاسترداد؛ تُركت لوحة الرسم دون تغيير وما زالت معدّلة.',
  'session.save.locked':
    'تحفظ علامة تبويب OrbitPM أخرى هذا الملف. انتظر قليلًا ثم أعد المحاولة؛ احتُفظ بمسودتك المحلية.',
  'session.save.failed': 'لم يكتمل الحفظ ({status}). احتُفظ بمسودتك المحلية.',
  'session.save.preservationBlocked':
    'تم حظر الحفظ لأن بيانات امتداد BPMN المحمية قد تغيّرت. احتُفظ بمسودتك المحلية.',
  'session.save.preservationTechnicalEvidence':
    'دليل تقني — رموز مشكلات الحفاظ على الامتدادات: {codes}',
  'session.save.permissionLoss':
    'تعذّرت متابعة الحفظ بسبب فقدان إذن الوصول إلى مساحة العمل. احتُفظ بمسودتك المحلية.',
  'session.save.storageFailure': 'تعذّرت كتابة الحفظ في تخزين مساحة العمل. احتُفظ بمسودتك المحلية.',
  'session.save.storageTechnicalEvidence': 'دليل تقني — تخزين الحفظ ({code}): {error}',
  'session.save.newerEdits': 'حُفظت النسخة الملتقطة، لكن ما زالت هناك تعديلات أحدث غير محفوظة.',
  'session.download.draftRetained':
    'جُهّز تنزيل BPMN. ما زالت الجلسة غير محفوظة واحتُفظ بمسودة الاسترداد حتى حفظ دائم أو تجاهل صريح.',
  'session.conflict.title': 'تغيّر «{path}» على القرص',
  'session.conflict.message':
    'تغيّر هذا الملف خارج علامة التبويب. ما زالت تعديلاتك المحلية محفوظة. اختر كيفية حل التعارض.',
  'session.conflict.compare': 'مقارنة النسختين',
  'session.conflict.local': 'تعديلاتك',
  'session.conflict.external': 'نسخة القرص',
  'session.conflict.externalMissing': 'لم يعد الملف موجودًا على القرص.',
  'session.conflict.reload': 'تحميل نسخة القرص',
  'session.conflict.overwrite': 'الكتابة فوق نسخة القرص',
  'session.conflict.saveAs': 'الحفظ كملف جديد',
  'session.conflict.saveAsLabel': 'مسار .bpmn نسبي جديد',
  'session.conflict.invalidDestination': 'أدخل مسار .bpmn نسبيًا صالحًا للحفظ باسم جديد.',
  'session.conflict.cancel': 'متابعة التحرير',

  // --- استيراد جداول البيانات ---
  'spreadsheet.tab': 'Excel / CSV',
  'spreadsheet.title': 'استيراد Excel أو CSV',
  'spreadsheet.intro':
    'أنشئ عمليات BPMN متحققًا منها محليًا من ملف ‎.xlsx‎ أو ‎.csv‎ بترميز UTF-8. لا تغادر بيانات الجدول هذا المتصفح.',
  'spreadsheet.template.blank': 'تنزيل قالب فارغ',
  'spreadsheet.template.example': 'تنزيل قالب مثال',
  'spreadsheet.upload': 'اختر ‎.xlsx‎ أو ‎.csv‎',
  'spreadsheet.uploadHint': 'Excel ‏(.xlsx فقط) أو CSV بترميز UTF-8',
  'spreadsheet.parsing': 'جارٍ قراءة الجدول…',
  'spreadsheet.cancel': 'إلغاء',
  'spreadsheet.cancelling': 'جارٍ الإلغاء…',
  'spreadsheet.cancelled': 'أُلغيت العملية.',
  'spreadsheet.progress': '{phase}: {percent}%',
  'spreadsheet.reset': 'البدء من جديد',
  'spreadsheet.officialDetected':
    'تم اكتشاف قالب OrbitPM الرسمي ({version}). طُبّق الربط تلقائيًا.',
  'spreadsheet.ordinaryDetected': 'تم اكتشاف جدول عادي. راجع ورقة العمل وربط الأعمدة.',
  'spreadsheet.mapping.title': 'ربط أعمدة الجدول',
  'spreadsheet.mapping.presetName': 'اسم الإعداد المسبق',
  'spreadsheet.mapping.sheet': 'ورقة العمل',
  'spreadsheet.mapping.noSheet': 'غير مستخدم',
  'spreadsheet.mapping.headerRow': 'صف العناوين',
  'spreadsheet.mapping.required': 'مطلوب',
  'spreadsheet.mapping.oneLanguageRequired': 'مطلوب بلغة واحدة على الأقل',
  'spreadsheet.mapping.confidence': 'ثقة {percent}%',
  'spreadsheet.mapping.confirm': 'أؤكد هذا الربط المطلوب منخفض الثقة',
  'spreadsheet.mapping.delimiters': 'فواصل القوائم',
  'spreadsheet.mapping.flowMode': 'استنتاج التدفق',
  'spreadsheet.mapping.flow.auto': 'تلقائي',
  'spreadsheet.mapping.flow.explicit': 'مصدر/هدف صريح',
  'spreadsheet.mapping.flow.next': 'أعمدة الخطوة التالية',
  'spreadsheet.mapping.flow.order': 'ترتيب رقمي',
  'spreadsheet.mapping.role.processes': 'العمليات والوجهة',
  'spreadsheet.mapping.role.participants': 'الأحواض والمسارات',
  'spreadsheet.mapping.role.steps': 'الخطوات والمعرفات والترتيب والنوع والتفاصيل الثنائية',
  'spreadsheet.mapping.role.flows': 'تدفقات المصدر/الهدف والشروط',
  'spreadsheet.mapping.role.glossary': 'المسرد',
  'spreadsheet.mapping.defaultProcessId': 'معرّف العملية الافتراضي',
  'spreadsheet.mapping.defaultNameEn': 'اسم العملية الافتراضي (بالإنجليزية)',
  'spreadsheet.mapping.defaultNameAr': 'اسم العملية الافتراضي (بالعربية)',
  'spreadsheet.mapping.saveDraft': 'حفظ المسودة',
  'spreadsheet.mapping.draftSaved': 'حُفظت مسودة الربط محليًا.',
  'spreadsheet.mapping.exportPreset': 'تصدير الإعداد المسبق',
  'spreadsheet.mapping.importPreset': 'استيراد إعداد مسبق',
  'spreadsheet.mapping.presetLoaded': 'تم تحميل إعداد الربط المسبق.',
  'spreadsheet.destination.title': 'الوجهة',
  'spreadsheet.destination.folder': 'مجلد الوجهة',
  'spreadsheet.destination.collision': 'إذا كان الملف موجودًا',
  'spreadsheet.destination.error': 'إيقاف وإصدار تقرير',
  'spreadsheet.destination.overwrite': 'استبدال بعد إنشاء نسخة استرداد',
  'spreadsheet.destination.rename': 'إنشاء اسم مرقّم',
  'spreadsheet.review': 'التحقق والمعاينة',
  'spreadsheet.reviewing': 'جارٍ التحقق من المصنف…',
  'spreadsheet.validation.title': 'التحقق من المصنف',
  'spreadsheet.validation.summary': '{errors} أخطاء · {reviews} مراجعات · {warnings} تحذيرات',
  'spreadsheet.validation.location': '{sheet} {cell}',
  'spreadsheet.validation.worksheet': 'ورقة العمل',
  'spreadsheet.validation.cell': 'الخلية',
  'spreadsheet.validation.rawValue': 'القيمة الخام',
  'spreadsheet.validation.normalizedValue': 'القيمة الموحّدة',
  'spreadsheet.validation.guidance': 'إرشادات الإصلاح',
  'spreadsheet.validation.issueFallback': 'راجع هذه المشكلة في المصنف.',
  'spreadsheet.validation.guidanceFallback': 'صحح قيمة المصدر أو الربط، ثم أعد التحقق.',
  'spreadsheet.validation.bilingual-audit-failed': 'تعذر على تدقيق اللغتين التحقق من هذه العملية.',
  'spreadsheet.validation.branch-topology-requires-explicit-conditions':
    'يحتاج هذا التفرع إلى أهداف وشروط صريحة.',
  'spreadsheet.validation.cached-formula-value':
    'تم استيراد نتيجة صيغة مخزنة مؤقتًا؛ تحقق من حداثتها.',
  'spreadsheet.validation.called-process-on-non-call-activity':
    'تم إسناد عملية مستدعاة إلى عنصر ليس نشاط استدعاء.',
  'spreadsheet.validation.called-process-reviewed-unlinked':
    'تمت مراجعة العملية المستدعاة المفقودة صراحةً باعتبارها غير مرتبطة.',
  'spreadsheet.validation.called-process-unresolved':
    'العملية المستدعاة غير موجودة في هذا الاستيراد أو مساحة العمل.',
  'spreadsheet.validation.data-connections-ignored':
    'تم تجاهل اتصالات بيانات المصنف حفاظًا على الأمان.',
  'spreadsheet.validation.default-flow-has-condition':
    'يجب ألا يحتوي التدفق الافتراضي على شرط أيضًا.',
  'spreadsheet.validation.default-flow-source-invalid':
    'لا يمكن لهذا النوع من العناصر امتلاك تدفق افتراضي.',
  'spreadsheet.validation.destination-folder-unsafe': 'مجلد الوجهة ليس مسارًا نسبيًا آمنًا.',
  'spreadsheet.validation.destination-hash-missing':
    'لا يملك هدف الاستبدال بصمة محتوى قابلة للتحقق.',
  'spreadsheet.validation.destination-inspection-failed': 'تعذر فحص الوجهة بأمان.',
  'spreadsheet.validation.destination-path-collision': 'تؤدي أكثر من عملية إلى مسار الوجهة نفسه.',
  'spreadsheet.validation.destination-process-id-collision':
    'معرّف العملية هذا موجود مسبقًا في مساحة العمل الوجهة.',
  'spreadsheet.validation.diagram-readability':
    'قد تصعب قراءة هذه العملية لأنها تحتوي على عقد كثيرة.',
  'spreadsheet.validation.duplicate-numeric-order':
    'يجب أن تكون قيم ترتيب الخطوات الرقمية فريدة داخل العملية.',
  'spreadsheet.validation.end-event-missing': 'لا تحتوي العملية على حدث نهاية.',
  'spreadsheet.validation.end-event-outgoing': 'لا يمكن أن يكون لحدث النهاية تدفقات صادرة.',
  'spreadsheet.validation.event-definition-on-non-event': 'تم إسناد تعريف حدث إلى عنصر ليس حدثًا.',
  'spreadsheet.validation.explicit-flows-required':
    'يتطلب وضع التدفقات الصريحة ورقة تدفقات بقيم المصدر والهدف.',
  'spreadsheet.validation.external-links-ignored':
    'تم تجاهل روابط المصنف الخارجية حفاظًا على الأمان.',
  'spreadsheet.validation.flow-duplicate-edge':
    'تم تعريف التدفق نفسه من المصدر إلى الهدف أكثر من مرة.',
  'spreadsheet.validation.flow-id-duplicate': 'معرّف التدفق هذا مكرر داخل العملية.',
  'spreadsheet.validation.flow-id-invalid': 'معرّف التدفق ليس معرّف BPMN صالحًا.',
  'spreadsheet.validation.flow-id-missing': 'يوجد تدفق بلا معرّف مطلوب.',
  'spreadsheet.validation.flow-self-loop-review':
    'يعود هذا التدفق إلى العنصر نفسه ويحتاج إلى مراجعة.',
  'spreadsheet.validation.flow-source-missing': 'مصدر التدفق غير موجود في هذه العملية.',
  'spreadsheet.validation.flow-target-missing': 'هدف التدفق غير موجود في هذه العملية.',
  'spreadsheet.validation.formula-without-cache':
    'لا تحتوي الصيغة على قيمة معروضة مخزنة مؤقتًا ولا يمكن استيرادها.',
  'spreadsheet.validation.gateway-branch-count':
    'يجب أن تحتوي البوابة على عدد كافٍ من الفروع الصادرة.',
  'spreadsheet.validation.gateway-condition-not-allowed':
    'هذا النوع من البوابات لا يسمح بتدفقات صادرة مشروطة.',
  'spreadsheet.validation.gateway-condition-required':
    'يحتاج كل فرع غير افتراضي من هذه البوابة إلى شرط.',
  'spreadsheet.validation.gateway-default-not-allowed':
    'هذا النوع من البوابات لا يسمح بتدفق افتراضي.',
  'spreadsheet.validation.gateway-topology-not-inferred':
    'لا يمكن استنتاج بنية البوابة بأمان من الترتيب الرقمي.',
  'spreadsheet.validation.glossary-entry-duplicate': 'تم تعريف مصطلح المسرد هذا أكثر من مرة.',
  'spreadsheet.validation.glossary-entry-incomplete': 'يحتاج إدخال المسرد إلى نص إنجليزي وعربي.',
  'spreadsheet.validation.invalid-boolean': 'هذه القيمة ليست قيمة صواب أو خطأ معروفة.',
  'spreadsheet.validation.low-confidence-mapping':
    'ربط العمود المطلوب منخفض الثقة ويحتاج إلى تأكيد.',
  'spreadsheet.validation.mapped-header-duplicate':
    'يتكرر العنوان المرتبط أكثر من مرة في ورقة العمل.',
  'spreadsheet.validation.mapped-header-missing': 'لم يعد العنوان المرتبط موجودًا في ورقة العمل.',
  'spreadsheet.validation.mapped-header-row-missing': 'صف العناوين المحدد غير موجود.',
  'spreadsheet.validation.mapped-next-step-required':
    'يتطلب وضع الخطوة التالية قيمًا مرتبطة للخطوة التالية.',
  'spreadsheet.validation.mapped-sheet-missing': 'لم تعد ورقة العمل المحددة موجودة.',
  'spreadsheet.validation.missing-required-mapping': 'لم يتم ربط حقل أساسي مطلوب بعمود.',
  'spreadsheet.validation.missing-steps-sheet': 'حدد ورقة عمل تحتوي على خطوات العملية.',
  'spreadsheet.validation.model-version-unsupported': 'إصدار نموذج المصنف هذا غير مدعوم.',
  'spreadsheet.validation.multiple-default-flows':
    'يمكن أن يكون للعنصر تدفق صادر افتراضي واحد فقط.',
  'spreadsheet.validation.multiple-lane-assignments': 'لا يمكن إسناد الخطوة إلى أكثر من مسار واحد.',
  'spreadsheet.validation.node-id-duplicate': 'معرّف الخطوة هذا مكرر داخل العملية.',
  'spreadsheet.validation.node-id-invalid': 'معرّف الخطوة ليس معرّف BPMN صالحًا.',
  'spreadsheet.validation.node-id-missing': 'توجد خطوة بلا معرّف مطلوب.',
  'spreadsheet.validation.node-id-workbook-duplicate':
    'معرّف الخطوة هذا مكرر في موضع آخر من المصنف.',
  'spreadsheet.validation.node-name-missing': 'تحتاج الخطوة إلى اسم إنجليزي أو عربي.',
  'spreadsheet.validation.node-order-invalid': 'يجب أن يكون ترتيب الخطوة قيمة رقمية محدودة.',
  'spreadsheet.validation.node-participant-kind-mismatch':
    'المشارك المشار إليه ليس من نوع الحوض أو المسار المطلوب.',
  'spreadsheet.validation.node-participant-missing': 'تشير الخطوة إلى مشارك غير موجود.',
  'spreadsheet.validation.node-process-limit': 'تتجاوز هذه العملية الحد الأقصى لعدد العقد.',
  'spreadsheet.validation.node-process-missing': 'تشير الخطوة إلى عملية غير موجودة.',
  'spreadsheet.validation.node-transaction-limit':
    'يتجاوز هذا الاستيراد الحد الأقصى لإجمالي العقد.',
  'spreadsheet.validation.node-unreachable': 'لا يمكن الوصول إلى هذه الخطوة من حدث بداية.',
  'spreadsheet.validation.numeric-order-required':
    'يتطلب استنتاج الترتيب الرقمي قيمة ترتيب لكل خطوة.',
  'spreadsheet.validation.official-template-header-mismatch':
    'تحتوي ورقة من القالب الرسمي على عناوين غير متوقعة.',
  'spreadsheet.validation.official-template-sheet-missing':
    'توجد ورقة عمل مفقودة من القالب الرسمي.',
  'spreadsheet.validation.official-template-version-unsupported':
    'إصدار القالب الرسمي هذا غير مدعوم.',
  'spreadsheet.validation.participant-id-duplicate': 'معرّف المشارك هذا مكرر داخل العملية.',
  'spreadsheet.validation.participant-id-invalid': 'معرّف المشارك ليس معرّف BPMN صالحًا.',
  'spreadsheet.validation.participant-id-missing': 'يوجد مشارك بلا معرّف مطلوب.',
  'spreadsheet.validation.participant-name-missing': 'يحتاج المشارك إلى اسم إنجليزي أو عربي.',
  'spreadsheet.validation.participant-parent-cycle': 'تكوّن مراجع المشارك الأصلية دورة.',
  'spreadsheet.validation.participant-parent-missing': 'المشارك الأصل المشار إليه غير موجود.',
  'spreadsheet.validation.participant-process-missing': 'يشير المشارك إلى عملية غير موجودة.',
  'spreadsheet.validation.pipeline-diagnostic': 'أبلغ مسار إنشاء BPMN عن نتيجة تحقق.',
  'spreadsheet.validation.pipeline-generation-failed': 'فشل إنشاء BPMN قبل إنتاج ملف صالح.',
  'spreadsheet.validation.pool-parent-not-allowed': 'لا يمكن أن يكون للحوض مشارك أصل.',
  'spreadsheet.validation.process-id-duplicate': 'معرّف العملية هذا مكرر.',
  'spreadsheet.validation.process-id-invalid': 'معرّف العملية ليس معرّف BPMN صالحًا.',
  'spreadsheet.validation.process-id-missing': 'توجد عملية بلا معرّف مطلوب.',
  'spreadsheet.validation.process-name-missing': 'تحتاج العملية إلى اسم إنجليزي أو عربي.',
  'spreadsheet.validation.processes-empty': 'لا يعرّف المصنف أي عمليات.',
  'spreadsheet.validation.raci-invalid': 'تحتوي قيمة RACI على رموز مسؤولية غير مدعومة.',
  'spreadsheet.validation.start-event-incoming': 'لا يمكن أن يكون لحدث البداية تدفقات واردة.',
  'spreadsheet.validation.start-event-missing': 'لا تحتوي العملية على حدث بداية.',
  'spreadsheet.validation.synthetic-boundary-confirmation-required':
    'أكد أحداث البداية والنهاية المقترحة قبل الإنشاء.',
  'spreadsheet.validation.synthetic-end-ambiguous':
    'لا يمكن إضافة حدث نهاية لأن الخطوة الأخيرة ملتبسة.',
  'spreadsheet.validation.synthetic-start-ambiguous':
    'لا يمكن إضافة حدث بداية لأن الخطوة الأولى ملتبسة.',
  'spreadsheet.validation.translation-review-required':
    'يجب مراجعة محتوى العملية بالإنجليزية والعربية قبل الاستيراد.',
  'spreadsheet.validation.unknown-participant-type':
    'نوع المشارك هذا غير معروف ويحتاج إلى ربط صريح.',
  'spreadsheet.validation.unknown-step-type': 'نوع الخطوة هذا غير معروف ويحتاج إلى ربط BPMN صريح.',
  'spreadsheet.guidance.choose-collision-behavior':
    'اختر الإيقاف أو الاستبدال مع سجل استرداد أو إعادة تسمية الملف.',
  'spreadsheet.guidance.confirm-field-mapping': 'حدد العمود الصحيح وأكد ربط الحقل المطلوب صراحةً.',
  'spreadsheet.guidance.correct-source-and-revalidate':
    'صحح قيمة المصدر المشار إليها، ثم أعد التحقق من المصنف.',
  'spreadsheet.guidance.map-participant-type': 'اربط تسمية المشارك الخام بحوض أو مسار.',
  'spreadsheet.guidance.map-step-type': 'اربط تسمية الخطوة الخام بنوع عنصر BPMN مدعوم.',
  'spreadsheet.guidance.refresh-destination-state':
    'حدّث مساحة العمل وتحقق من الوجهة قبل إعادة المحاولة.',
  'spreadsheet.guidance.replace-formula-with-value': 'استبدل الصيغة بقيمة معروضة في المصنف المصدر.',
  'spreadsheet.guidance.retry-destination-inspection':
    'تحقق من الوصول إلى مساحة العمل، ثم افحص الوجهة مرة أخرى.',
  'spreadsheet.guidance.review-inference-inputs':
    'راجع وضع التدفق والترتيب وأهداف الخطوة التالية وشروط البوابة.',
  'spreadsheet.guidance.use-boolean': 'استخدم قيمة معروفة للصواب/الخطأ أو نعم/لا.',
  'spreadsheet.guidance.verify-cached-formula-value':
    'أعد حساب المصنف واحفظه، ثم تحقق من القيمة المعروضة.',
  'spreadsheet.validation.noIssues': 'لا توجد مشكلات في المصنف.',
  'spreadsheet.validation.mappingBlocked': 'أكد كل ربط مطلوب قبل المراجعة.',
  'spreadsheet.typeRepair.title': 'ربط أنواع الجدول غير المعروفة',
  'spreadsheet.typeRepair.guidance':
    'اختر معنى BPMN لكل تسمية نوع خام، ثم أعد التحقق. تُحفظ الربوط المراجعة في هذا الإعداد المسبق.',
  'spreadsheet.typeRepair.step': 'نوع الخطوة «{value}»',
  'spreadsheet.typeRepair.participant': 'نوع المشارك «{value}»',
  'spreadsheet.typeRepair.choose': 'اختر نوعًا…',
  'spreadsheet.type.task': 'مهمة',
  'spreadsheet.type.userTask': 'مهمة مستخدم',
  'spreadsheet.type.serviceTask': 'مهمة خدمة',
  'spreadsheet.type.sendTask': 'مهمة إرسال',
  'spreadsheet.type.receiveTask': 'مهمة استلام',
  'spreadsheet.type.businessRuleTask': 'مهمة قاعدة عمل',
  'spreadsheet.type.manualTask': 'مهمة يدوية',
  'spreadsheet.type.scriptTask': 'مهمة برنامج نصي',
  'spreadsheet.type.callActivity': 'نشاط استدعاء',
  'spreadsheet.type.subProcess': 'عملية فرعية',
  'spreadsheet.type.startEvent': 'حدث بداية',
  'spreadsheet.type.endEvent': 'حدث نهاية',
  'spreadsheet.type.intermediateCatchEvent': 'حدث وسيط ملتقط',
  'spreadsheet.type.intermediateThrowEvent': 'حدث وسيط مرسل',
  'spreadsheet.type.exclusiveGateway': 'بوابة حصرية',
  'spreadsheet.type.inclusiveGateway': 'بوابة شاملة',
  'spreadsheet.type.parallelGateway': 'بوابة متوازية',
  'spreadsheet.type.complexGateway': 'بوابة معقدة',
  'spreadsheet.type.eventBasedGateway': 'بوابة قائمة على الحدث',
  'spreadsheet.type.pool': 'حوض',
  'spreadsheet.type.lane': 'مسار',
  'spreadsheet.repair.generatedIds': 'سيتم إنشاء {count} معرّف ناقص بصورة حتمية.',
  'spreadsheet.repair.synthetic': 'تم اقتراح {count} حدود بداية/نهاية.',
  'spreadsheet.repair.confirmSynthetic': 'إضافة أحداث البداية/النهاية الثنائية المقترحة',
  'spreadsheet.repair.skippedRows': 'سيتم تخطي {count} صفوف فارغة.',
  'spreadsheet.preview.title': 'معاينة الرسم للقراءة فقط',
  'spreadsheet.preview.processes': '{count} عمليات',
  'spreadsheet.preview.nodes': '{count} عقد',
  'spreadsheet.preview.flows': '{count} تدفقات',
  'spreadsheet.preview.process': 'العملية',
  'spreadsheet.preview.node': 'العقدة',
  'spreadsheet.preview.type': 'النوع',
  'spreadsheet.preview.fromTo': 'التدفق',
  'spreadsheet.preview.participant': 'الحوض / المسار',
  'spreadsheet.preview.condition': 'الشرط',
  'spreadsheet.preview.defaultFlow': 'التدفق الافتراضي',
  'spreadsheet.preview.generated': 'معرّف مولّد',
  'spreadsheet.preview.origin.explicit': 'صريح',
  'spreadsheet.preview.origin.mapped': 'مربوط',
  'spreadsheet.preview.origin.inferred': 'مستنتج بالترتيب',
  'spreadsheet.preview.origin.synthetic': 'حد اصطناعي',
  'spreadsheet.preview.unassigned': 'غير مسند',
  'spreadsheet.translation.required':
    'مراجعة ثنائية اللغة مطلوبة: {missing} قيم ناقصة و{invalid} قيم غير صالحة.',
  'spreadsheet.translation.handoff': 'فتح المراجعة الثنائية',
  'spreadsheet.prepare': 'تجهيز ملفات BPMN',
  'spreadsheet.preparing': 'جارٍ إنشاء BPMN والتحقق منه…',
  'spreadsheet.plan.blocked': 'الاستيراد محظور حتى معالجة المشكلات المدرجة.',
  'spreadsheet.plan.ready': 'هناك {count} ملفات BPMN جاهزة. لم تتغير الوجهة بعد.',
  'spreadsheet.commit': 'تنفيذ الاستيراد',
  'spreadsheet.committing': 'جارٍ كتابة جميع الملفات ذريًا…',
  'spreadsheet.report.committed': 'تم تنفيذ الاستيراد بنجاح.',
  'spreadsheet.report.rolledBack': 'فشل الاستيراد؛ تم التراجع عن تغييرات الوجهة.',
  'spreadsheet.report.rollbackFailed':
    'فشل الاستيراد ويحتاج التراجع إلى الانتباه. تم الاحتفاظ بنسخ الاسترداد.',
  'spreadsheet.report.destination': 'الوجهة',
  'spreadsheet.report.checksum': 'SHA-256',
  'spreadsheet.report.download': 'تنزيل تقرير الاستيراد',
  'spreadsheet.error.parse': 'تعذّرت قراءة هذا الجدول.',
  'spreadsheet.error.preset': 'تعذّر استيراد إعداد الربط هذا.',
  'spreadsheet.error.draftSave': 'تعذّر حفظ مسودة الربط هذه.',
  'spreadsheet.error.review': 'تعذّر إنشاء نموذج المصنف.',
  'spreadsheet.error.prepare': 'تعذّر تجهيز ملفات BPMN.',
  'spreadsheet.error.bilingualReview': 'تعذّر إكمال التسليم إلى المراجعة الثنائية.',
  'spreadsheet.error.commit': 'تعذّر تنفيذ استيراد الجدول.',
  'spreadsheet.error.postCommit': 'تم تنفيذ الاستيراد، لكن متابعة مساحة العمل النهائية لم تكتمل.',
  'spreadsheet.error.technicalEvidence': 'أدلة تقنية',
  'spreadsheet.error.technicalCode': 'رمز الخطأ',
  'spreadsheet.error.technicalDetails': 'التفاصيل المنظمة',
  'spreadsheet.error.limitContext': 'القيمة المكتشفة {actual}؛ الحد الآمن {limit}.',
  'spreadsheet.error.rowContext': 'اكتُشفت المشكلة قرب الصف {row}.',
  'spreadsheet.error.unsupported-format':
    'تنسيق هذا الملف غير مدعوم. اختر ملف .xlsx أو ملف .csv بترميز UTF-8.',
  'spreadsheet.error.legacy-excel-format':
    'مصنفات .xls القديمة غير مدعومة. احفظ نسخة بتنسيق .xlsx أو CSV بترميز UTF-8.',
  'spreadsheet.error.macro-enabled-format':
    'ملفات Excel الممكّنة بوحدات الماكرو غير مقبولة. احفظ نسخة .xlsx أو CSV خالية من وحدات الماكرو.',
  'spreadsheet.error.encrypted-workbook':
    'لا يمكن استيراد المصنفات المشفّرة أو المحمية بكلمة مرور.',
  'spreadsheet.error.malformed-csv':
    'بنية ملف CSV غير صالحة. تحقق من علامات الاقتباس والفواصل وحدود الصفوف.',
  'spreadsheet.error.invalid-utf8': 'ملف CSV هذا ليس بترميز UTF-8 صالح. أعد حفظه بترميز UTF-8.',
  'spreadsheet.error.malformed-zip': 'حاوية XLSX تالفة أو غير صالحة.',
  'spreadsheet.error.zip64-unsupported': 'مصنفات ZIP64 غير مدعومة. صدّر ملف .xlsx قياسيًا.',
  'spreadsheet.error.multi-disk-zip': 'مصنفات ZIP متعددة الأقراص غير مدعومة.',
  'spreadsheet.error.unsupported-compression': 'يستخدم المصنف طريقة ضغط ZIP غير مدعومة.',
  'spreadsheet.error.unsafe-zip-path': 'يحتوي المصنف على مسار داخلي غير آمن، ولذلك رُفض.',
  'spreadsheet.error.duplicate-zip-entry': 'يحتوي المصنف على إدخالات داخلية مكررة، ولذلك رُفض.',
  'spreadsheet.error.macro-content':
    'يحتوي المصنف على وحدات ماكرو أو محتوى قابل للتنفيذ، ولذلك رُفض.',
  'spreadsheet.error.missing-xlsx-part': 'يفتقد المصنف مكوّن XLSX مطلوبًا.',
  'spreadsheet.error.compressed-size-limit': 'يتجاوز الجدول حد الحجم المضغوط الآمن.',
  'spreadsheet.error.uncompressed-size-limit': 'يتجاوز المصنف حد الحجم الآمن بعد فك الضغط.',
  'spreadsheet.error.worksheet-limit': 'يحتوي المصنف على عدد كبير جدًا من أوراق العمل.',
  'spreadsheet.error.row-limit': 'يحتوي الجدول على عدد كبير جدًا من الصفوف.',
  'spreadsheet.error.column-limit': 'يحتوي أحد صفوف الجدول على عدد كبير جدًا من الأعمدة.',
  'spreadsheet.error.cell-count-limit': 'يحتوي الجدول على عدد كبير جدًا من الخلايا غير الفارغة.',
  'spreadsheet.error.cell-length-limit': 'تتجاوز إحدى خلايا الجدول حد طول النص الآمن.',
  'spreadsheet.error.node-process-limit': 'تحتوي إحدى العمليات على عدد كبير جدًا من عقد BPMN.',
  'spreadsheet.error.node-transaction-limit':
    'يحتوي هذا الاستيراد إجمالًا على عدد كبير جدًا من عقد BPMN.',
  'spreadsheet.error.formula-without-cache':
    'لا تحتوي إحدى الصيغ على قيمة عرض محفوظة. أعد حساب المصنف واحفظه أولًا.',
  'spreadsheet.error.parse-cancelled': 'أُلغيت معالجة الجدول.',
  'spreadsheet.error.adapter-contract-violation':
    'أعادت إحدى حدود معالجة الجدول الداخلية نتيجة غير صالحة. لم تُجرَ أي تغييرات على الوجهة.',
  'spreadsheet.error.invalid-mapping-preset':
    'إعداد الربط أو المسودة المحفوظة غير صالح للجدول المحدد.',
  'spreadsheet.error.blocking-validation': 'وجد التحقق من المصنف مشكلات مانعة يجب حلها.',
  'spreadsheet.error.transaction-failed':
    'فشلت معاملة استيراد الجدول. راجع حالة التراجع قبل إعادة المحاولة.',
  'spreadsheet.phase.preflight': 'الفحص الأمني المسبق',
  'spreadsheet.phase.parse': 'التحليل',
  'spreadsheet.phase.validate': 'التحقق',
  'spreadsheet.phase.buildModel': 'إنشاء نموذج المصنف',
  'spreadsheet.phase.applyDestination': 'تطبيق الوجهات',
  'spreadsheet.phase.inferGraph': 'استنتاج رسم العملية',
  'spreadsheet.phase.applyInference': 'تطبيق الاستنتاج المراجع',
  'spreadsheet.phase.validateModel': 'التحقق من نموذج العملية',
  'spreadsheet.phase.generate': 'إنشاء ملفات BPMN',
  'spreadsheet.phase.stage': 'تجهيز الملفات',
  'spreadsheet.phase.commit': 'تنفيذ كتابة الملفات',
  'spreadsheet.phase.rollback': 'التراجع عن التغييرات',

  // --- مركز التحقق / محرر المصدر ---
  'validation.open': 'تحقق',
  'validation.open.title': 'فتح مركز التحقق',
  'validation.title': 'مركز التحقق',
  'validation.close': 'إغلاق',
  'validation.running': 'جارٍ التحقق…',
  'validation.summary': '{errors} أخطاء · {warnings} تحذيرات · {infos} معلومات',
  'validation.errors': 'الأخطاء',
  'validation.warnings': 'التحذيرات',
  'validation.infos': 'المعلومات',
  'validation.valid': 'مستند BPMN صالح.',
  'validation.invalid': 'يحتوي مستند BPMN على نتائج تحقق.',
  'validation.empty': 'لا توجد نتائج تحقق.',
  'validation.issues': 'نتائج التحقق',
  'validation.pagination.label': 'صفحات نتائج التحقق',
  'validation.pagination.status':
    'عرض نتائج التحقق {start}–{end} من {total}. الصفحة {page} من {pages}.',
  'validation.pagination.previous': 'الصفحة السابقة',
  'validation.pagination.next': 'الصفحة التالية',
  'validation.source': 'المصدر',
  'validation.element': 'العنصر',
  'validation.location': 'الموقع',
  'validation.lineColumn': 'السطر {line}، العمود {column}',
  'validation.focus': 'الانتقال إلى العنصر',
  'validation.repair': 'إصلاح',
  'validation.export': 'تصدير التقرير',
  'validation.export.title': 'تنزيل تقرير التحقق',
  'validation.severity.error': 'خطأ',
  'validation.severity.review': 'مراجعة',
  'validation.severity.warning': 'تحذير',
  'validation.severity.info': 'معلومة',
  'validation.stage.xsd': 'مخطط BPMN',
  'validation.stage.xml': 'صياغة XML',
  'validation.stage.moddle': 'نموذج BPMN',
  'validation.stage.preservation': 'الحفاظ على البيانات',
  'validation.stage.bpmnlint': 'قواعد BPMN',
  'validation.stage.structure': 'البنية',
  'validation.stage.semantic': 'الدلالة',
  'validation.stage.di': 'تبادل الرسم',
  'validation.stage.orbitpm': 'بيانات OrbitPM',
  'validation.suggestedRepair': 'الإصلاح المقترح',
  'validation.technicalEvidence': 'الدليل التقني',
  'validation.technical.code': 'الرمز',
  'validation.technical.ruleId': 'معرّف القاعدة',
  'validation.technical.diagnostic': 'التشخيص الخام',
  'validation.technical.truncated':
    'تم اختصار هذا التشخيص في العرض. صدّر التقرير للاطلاع على التفاصيل الكاملة.',
  'validation.issue.xml.empty': 'مستند XML فارغ.',
  'validation.issue.xml.size-limit': 'يتجاوز مستند XML حد حجم الإدخال الآمن.',
  'validation.issue.xml.illegal-character': 'يحتوي المستند على محرف لا تسمح به مواصفة XML 1.0.',
  'validation.issue.xml.unsupported-encoding': 'ترميز المحارف المعلن غير مدعوم بعد فك ترميز النص.',
  'validation.issue.xml.doctype': 'يحتوي المستند على إعلان DOCTYPE محظور.',
  'validation.issue.xml.entity-declaration': 'يحتوي المستند على إعلان كيان محظور.',
  'validation.issue.xml.external-include': 'يحتوي المستند على تضمين XML خارجي محظور.',
  'validation.issue.xml.processing-instruction': 'يحتوي المستند على تعليمة معالجة غير مسموح بها.',
  'validation.issue.xml.declaration-position': 'إعلان XML ليس أول عنصر في المستند.',
  'validation.issue.xml.text-limit': 'تتجاوز عقدة نص أو CDATA حد الطول الآمن.',
  'validation.issue.xml.attribute-count-limit': 'يحتوي عنصر XML على سمات أكثر من الحد الآمن.',
  'validation.issue.xml.attribute-value-limit': 'تتجاوز قيمة سمة XML حد الطول الآمن.',
  'validation.issue.xml.element-count-limit': 'يحتوي المستند على عناصر XML أكثر من الحد الآمن.',
  'validation.issue.xml.depth-limit': 'يتجاوز عمق تداخل XML الحد الآمن.',
  'validation.issue.moddle.unresolved-reference': 'يحتوي نموذج BPMN على مرجع تعذّر حله.',
  'validation.issue.moddle.duplicate-id': 'وجد محلل BPMN معرّف عنصر مكررًا.',
  'validation.issue.moddle.unparsable-content': 'تعذّر تحليل جزء من مستند BPMN.',
  'validation.issue.moddle.warning': 'أبلغ محلل BPMN عن تحذير في النموذج.',
  'validation.issue.moddle.parse-error': 'تعذّر تحليل BPMN XML إلى نموذج.',
  'validation.issue.moddle.root-missing': 'لم يُرجع محلل BPMN جذر المستند.',
  'validation.issue.structure.definitions-root': 'جذر المستند ليس عنصر تعريفات BPMN 2.0.',
  'validation.issue.structure.definitions-id': 'يفتقد عنصر تعريفات BPMN معرّفه المطلوب.',
  'validation.issue.structure.target-namespace': 'يفتقد عنصر تعريفات BPMN نطاق الاسم الهدف.',
  'validation.issue.structure.target-namespace-uri':
    'نطاق اسم BPMN الهدف ليس عنوان URI مطلقًا صالحًا.',
  'validation.issue.structure.process-missing': 'لا يحتوي مستند BPMN على عملية.',
  'validation.issue.structure.duplicate-id': 'يستخدم أكثر من عنصر BPMN أو رسم المعرّف نفسه.',
  'validation.issue.structure.invalid-id': 'معرّف عنصر BPMN أو الرسم ليس اسم XML صالحًا.',
  'validation.issue.structure.sequence-ref-missing': 'يحتوي تدفق تسلسلي على مصدر أو هدف تعذّر حله.',
  'validation.issue.structure.sequence-ref-container':
    'يعبر تدفق تسلسلي حدود عملية أو عملية فرعية.',
  'validation.issue.structure.incoming-mismatch':
    'لا تطابق مراجع العقدة الواردة تدفقاتها التسلسلية.',
  'validation.issue.structure.outgoing-mismatch':
    'لا تطابق مراجع العقدة الصادرة تدفقاتها التسلسلية.',
  'validation.issue.structure.lane-node-ref': 'يشير مسار مسؤولية إلى عقدة تدفق خارج عمليته.',
  'validation.issue.structure.participant-process-ref': 'يشير مشارك إلى عملية خارج مستند BPMN هذا.',
  'validation.issue.structure.message-flow-ref': 'يحتوي تدفق رسالة على طرف تعذّر حله.',
  'validation.issue.structure.process-id': 'تفتقد عملية BPMN معرّفها المطلوب.',
  'validation.issue.semantic.start-incoming': 'يحتوي حدث بداية على تدفق تسلسلي وارد.',
  'validation.issue.semantic.end-outgoing': 'يحتوي حدث نهاية على تدفق تسلسلي صادر.',
  'validation.issue.semantic.default-source':
    'لا يمكن لهذا النوع من عناصر BPMN إعلان تدفق افتراضي.',
  'validation.issue.semantic.default-not-outgoing':
    'التدفق الافتراضي المعلن ليس تدفقًا صادرًا من مصدره.',
  'validation.issue.semantic.default-has-condition':
    'يجب ألا يحتوي التدفق التسلسلي الافتراضي على شرط.',
  'validation.issue.semantic.branch-condition-missing': 'يفتقد فرع بوابة غير افتراضي شرطه المطلوب.',
  'validation.issue.semantic.condition-source':
    'يبدأ تدفق تسلسلي مشروط من نوع عنصر لا يمكنه امتلاك شروط.',
  'validation.issue.semantic.boundary-attachment': 'حدث الحدود غير مرتبط بنشاط صالح.',
  'validation.issue.semantic.disconnected-node':
    'لا يمكن الوصول إلى عقدة تدفق من مسار دخول العملية.',
  'validation.issue.di.plane-missing': 'لا يحتوي رسم BPMN على مستوى رسم.',
  'validation.issue.di.plane-target': 'لا يشير مستوى رسم BPMN إلى عملية أو تعاون.',
  'validation.issue.di.element-ref': 'لا يشير عنصر الرسم إلى عنصر BPMN الذي يمثله.',
  'validation.issue.di.element-plane-mismatch': 'يمثل عنصر الرسم عنصرًا خارج مستواه.',
  'validation.issue.di.shape-bounds': 'لا يملك شكل BPMN حدودًا منتهية وموجبة.',
  'validation.issue.di.edge-waypoints': 'لا تملك حافة BPMN نقطتي مسار منتهيتين على الأقل.',
  'validation.issue.di.process-missing': 'لا تملك العملية مستوى رسم BPMN.',
  'validation.issue.orbitpm.active-language': 'تعلن العملية لغة نشطة غير مدعومة.',
  'validation.issue.orbitpm.active-projection-mismatch':
    'لا يطابق نص BPMN الظاهر قيمة اللغة النشطة للعملية.',
  'validation.issue.orbitpm.bilingual-missing-en': 'يفتقد حقل BPMN ثنائي اللغة قيمته الإنجليزية.',
  'validation.issue.orbitpm.bilingual-missing-ar': 'يفتقد حقل BPMN ثنائي اللغة قيمته العربية.',
  'validation.issue.orbitpm.bilingual-wrong-script-en':
    'يحتوي حقل BPMN إنجليزي على نص عربي غير معتمد.',
  'validation.issue.orbitpm.bilingual-wrong-script-ar':
    'لا يحتوي حقل BPMN عربي على نص عربي ذي معنى.',
  'validation.issue.orbitpm.bilingual-duplicate-counterpart':
    'القيمتان الإنجليزية والعربية متطابقتان دون استثناء محايد معتمد.',
  'validation.issue.orbitpm.bilingual-mixed-en':
    'يخلط حقل BPMN إنجليزي بين النصين العربي واللاتيني.',
  'validation.issue.orbitpm.bilingual-mixed-ar': 'يخلط حقل BPMN عربي بين النصين العربي واللاتيني.',
  'validation.issue.orbitpm.bilingual-provider-failed':
    'تعذّر على المزوّد المحدد إنتاج قيمة BPMN ثنائية اللغة.',
  'validation.issue.orbitpm.call-unlinked': 'نشاط الاستدعاء غير مرتبط بعملية.',
  'validation.issue.orbitpm.call-unresolved': 'يشير نشاط الاستدعاء إلى عملية غير متاحة.',
  'validation.issue.preservation.snapshot-failed':
    'تعذّر فحص الحفاظ على بيانات الامتدادات غير المعروفة.',
  'validation.issue.preservation.extension-element-changed':
    'تمت إزالة عنصر امتداد غير معروف أو تغييره أو نقله.',
  'validation.issue.preservation.extension-attribute-changed':
    'تمت إزالة سمة امتداد غير معروفة أو تغييرها أو نقلها.',
  'validation.issue.adapterFailure': 'تعذّر تشغيل محرك تحقق مطلوب.',
  'validation.issue.xsd': 'لا يطابق BPMN XML مخطط BPMN 2.0.',
  'validation.issue.bpmnlint': 'أبلغت قاعدة نمذجة BPMN عن مشكلة.',
  'validation.issue.fallback': 'أبلغ التحقق عن نتيجة لا يتعرف عليها هذا الإصدار.',
  'validation.repair.xml.provideDocument': 'قدّم مستند BPMN XML غير فارغ.',
  'validation.repair.xml.reduceDocument': 'قلّل المستند أو قسّمه ليبقى ضمن حدود XML الآمنة.',
  'validation.repair.xml.removeInvalidContent': 'أزل المحرف أو المحتوى غير الصالح ثم أعد التحقق.',
  'validation.repair.xml.convertUtf8': 'حوّل المصدر إلى UTF-8 صالح ثم أعد التحقق.',
  'validation.repair.xml.removeUnsafeConstruct':
    'أزل بنية XML غير الآمنة واحتفظ بمحتوى BPMN المطلوب مضمّنًا.',
  'validation.repair.xml.moveDeclaration': 'انقل إعلان XML إلى بداية المستند.',
  'validation.repair.xml.repairSyntax': 'صحح صياغة XML ثم أعد التحقق.',
  'validation.repair.references': 'أعد ربط عناصر BPMN المشار إليها داخل نطاق العملية الصحيح.',
  'validation.repair.uniqueIds': 'امنح كل عنصر BPMN ورسم معرّفًا فريدًا.',
  'validation.repair.reviewModel': 'راجع عنصر النموذج المتأثر وصحح بيانات BPMN.',
  'validation.repair.restoreRoot': 'استعد جذر مستند تعريفات BPMN 2.0 صالحًا.',
  'validation.repair.wrapDefinitions': 'ضع محتوى BPMN داخل عنصر تعريفات BPMN 2.0 صالح.',
  'validation.repair.addId': 'أضف معرّفًا ثابتًا وفريدًا ومتوافقًا مع XML.',
  'validation.repair.targetNamespace': 'عيّن عنوان URI مطلقًا وثابتًا كنطاق اسم BPMN الهدف.',
  'validation.repair.addProcess': 'أضف عملية BPMN إلى مستند التعريفات.',
  'validation.repair.validId': 'استخدم اسم XML صالحًا يبدأ بحرف أو شرطة سفلية.',
  'validation.repair.flowDirection': 'أزل التدفق غير الصالح وأعد ربطه في الاتجاه المسموح.',
  'validation.repair.defaultFlow': 'اختر تدفقًا افتراضيًا صادرًا صالحًا وأزل أي شرط منه.',
  'validation.repair.conditions': 'أضف شروط الفروع أو أزلها لتلبية قواعد البوابة.',
  'validation.repair.boundaryAttachment': 'اربط حدث الحدود بنشاط في نطاق العملية نفسه.',
  'validation.repair.reconnectFlow': 'اربط العقدة بمسار عملية يمكن الوصول إليه.',
  'validation.repair.regenerateDi': 'أصلح معلومات الرسم أو عاين التخطيط التلقائي واعتمده.',
  'validation.repair.localization': 'راجع القيم الإنجليزية والعربية والنصوص وإسقاط اللغة النشطة.',
  'validation.repair.linkProcess': 'اربط نشاط الاستدعاء بعملية واحدة واضحة ومتاحة.',
  'validation.repair.preserveExtensions':
    'احتفظ بملف XML الأصلي حتى يمكن الحفاظ على بيانات الامتداد غير المعروفة بدقة.',
  'validation.repair.restoreValidator': 'استعد محرك التحقق وشغّل التحقق من جديد.',
  'validation.repair.xsd': 'أصلح البنية التي حددها تشخيص المخطط ثم أعد التحقق.',
  'validation.repair.bpmnlint': 'راجع العنصر المشار إليه وفق قاعدة BPMN المسمّاة وصحح النموذج.',
  'validation.repair.fallback': 'راجع الدليل التقني المسمّى وصحح المصدر قبل المتابعة.',
  'sourceEditor.title': 'مصدر BPMN XML',
  'sourceEditor.close': 'إغلاق',
  'sourceEditor.preview': 'معاينة التغييرات',
  'sourceEditor.previewing': 'جارٍ فحص التغييرات…',
  'sourceEditor.apply': 'تطبيق المصدر',
  'sourceEditor.applying': 'جارٍ التطبيق…',
  'sourceEditor.rollback': 'تراجع',
  'sourceEditor.diff': 'معاينة التغييرات',
  'sourceEditor.diffBounded':
    'يستخدم هذا المصدر الكبير محاذاة محدودة. تظهر جميع الأسطر المتغيرة ضمن كتلة الاستبدال.',
  'sourceEditor.diffTruncated':
    'يتجاوز تغيير المصدر هذا حد المراجعة الآمنة. تم حذف جزء من محتوى الفروقات، لذلك تم تعطيل التطبيق. قلّل حجم التغيير ثم حاول مرة أخرى.',
  'sourceEditor.diffHunk':
    'التغيير {index} من {total}، السطر الأصلي {original}، سطر المرشح {candidate}',
  'sourceEditor.diffLine.added': 'سطر المرشح المضاف {line}',
  'sourceEditor.diffLine.removed': 'السطر الأصلي المحذوف {line}',
  'sourceEditor.diffLine.context': 'السطر الأصلي غير المتغير {original}، سطر المرشح {candidate}',
  'sourceEditor.changedLines':
    '{changed} متغير · {added} مضاف · {removed} محذوف · أول تغيير في السطر {line}',
  'sourceEditor.noChanges': 'لا توجد تغييرات في المصدر.',
  'sourceEditor.invalidBlocked': 'التطبيق محظور لأن XML المعدّل غير صالح.',
  'sourceEditor.preservationBlocked': 'التطبيق محظور لأن بيانات المخطط المطلوبة ستُفقد.',
  'sourceEditor.layoutPreview': 'معاينة التخطيط المُنشأ',
  'sourceEditor.layoutAccept': 'اعتماد التخطيط المُنشأ',
  'sourceEditor.layoutReady': 'يتوفر تخطيط مخطط مُنشأ للمراجعة.',
  'sourceEditor.layoutDiff': 'تغييرات مصدر التخطيط المُنشأ',
  'sourceEditor.layoutDiagramTitle': 'معاينة المخطط المُنشأ',
  'sourceEditor.layoutDiagramAria': 'معاينة للقراءة فقط لمخطط BPMN المُنشأ',
  'sourceEditor.diagramPreview.loading': 'جارٍ عرض معاينة المخطط للقراءة فقط…',
  'sourceEditor.diagramPreview.ready': 'معاينة المخطط للقراءة فقط جاهزة.',
  'sourceEditor.diagramPreview.warnings': 'عُرض المخطط مع {count} من تحذيرات العارض.',
  'sourceEditor.diagramPreview.failed': 'تعذّر عرض المخطط للقراءة فقط.',
  'sourceEditor.layoutFailed': 'تعذّر إنشاء تخطيط المخطط: {error}',
  'sourceEditor.action.previewFailed': 'تعذّرت معاينة تغييرات المصدر.',
  'sourceEditor.action.layoutFailed': 'تعذّر إنشاء تخطيط المخطط.',
  'sourceEditor.action.applyFailed': 'تعذّر تطبيق تغييرات المصدر.',
  'sourceEditor.action.technicalDetails': 'التفاصيل التقنية:',
  'sourceEditor.missingDi': 'لا يحتوي XML على تخطيط صالح لمخطط BPMN.',
  'sourceEditor.applied': 'تم تطبيق تغييرات المصدر.',
  'save.validationRunning': 'انتظر انتهاء التحقق قبل الحفظ.',
  'save.blocked': 'الحفظ محظور بسبب أخطاء التحقق.',
  'save.draftPrompt': 'يحتوي هذا المستند على أخطاء تحقق. هل تريد حفظه صراحةً كمسودة؟',
  'save.draftAction': 'حفظ مسودة مع الأخطاء',
  'save.cancel': 'إلغاء',

  // --- تسميات سجل رموز ARIS (src/aris/symbols) ---
  'aris.symbol.and': 'و',
  'aris.symbol.applicationSystem': 'نظام تطبيقي',
  'aris.symbol.businessRule': 'قاعدة عمل',
  'aris.symbol.document': 'مستند',
  'aris.symbol.eDocument': 'مستند إلكتروني',
  'aris.symbol.email': 'بريد إلكتروني',
  'aris.symbol.entityType': 'نوع الكيان',
  'aris.symbol.event': 'حدث',
  'aris.symbol.externalPerson': 'شخص خارجي',
  'aris.symbol.function': 'وظيفة',
  'aris.symbol.mobile': 'جهاز محمول',
  'aris.symbol.or': 'أو',
  'aris.symbol.performance': 'مؤشر أداء',
  'aris.symbol.person': 'شخص',
  'aris.symbol.personType': 'نوع الشخص',
  'aris.symbol.policy': 'سياسة',
  'aris.symbol.processInterface': 'واجهة عملية',
  'aris.symbol.requirement': 'متطلب',
  'aris.symbol.systemFunction': 'وظيفة نظام',
  'aris.symbol.unknown': 'رمز غير معروف',
  'aris.symbol.valueAddedChain': 'سلسلة القيمة المضافة',
  'aris.symbol.xor': 'أو حصري',

  // --- نتائج مطابقة رموز ARIS (src/aris/symbols/fidelity.ts, registry.ts) ---
  'aris.fidelity.substitutedVisualResource':
    'لم يُعثر على رمز ARIS المطلوب؛ تم استبداله برمز آخر من نوع الكائن نفسه.',
  'aris.fidelity.unknownCustomSymbol':
    'الرمز المطلوب رمز مخصص لا يدعم هذا الإصدار رسمه؛ تم استبداله بعنصر نائب عام.',
  'aris.fidelity.missingTemplate':
    'لا يوجد قالب رسم مسجَّل للرمز المطلوب؛ تم استبداله بعنصر نائب عام.',

  // --- نتائج رفض محرك التخطيط النظيف لـ ARIS (src/aris/layout/types.ts) ---
  'aris.layout.rejection.shape-overlap': 'يتداخل شكلان في المخطط.',
  'aris.layout.rejection.label-satellite-overlap':
    'يتداخل مربع تسمية محجوز أو عنصر تابع مع عنصر آخر في المخطط.',
  'aris.layout.rejection.edge-through-unrelated-shape': 'يمر مسار أحد الروابط عبر شكل غير متصل به.',
  'aris.layout.rejection.detached-endpoint': 'لا تلتصق نهاية أحد الروابط بحدود الشكل الذي تتصل به.',
  'aris.layout.rejection.missing-edge': 'يفتقد المخطط الناتج رابطًا بين عقدتين مرتبطتين.',
  'aris.layout.rejection.duplicate-edge':
    'يحتوي المخطط الناتج على أكثر من رابط متطابق بين العقدتين نفسيهما.',
  'aris.layout.rejection.zero-length-edge': 'طول أحد الروابط في المخطط الناتج يساوي صفرًا.',
  'aris.layout.rejection.extreme-whitespace':
    'يحتوي المخطط الناتج على نطاق فارغ كبير جدًا يتجاوز حد توازن اللوحة.',

  // --- مشكلات خط معالجة مصنفات إكسل لـ ARIS (src/aris/excel/issues.ts) ---
  'aris.excel.issue.unsupported-file-extension':
    'رُفض الملف لأن امتداده ليس من صيغ مصنفات ARIS المدعومة.',
  'aris.excel.issue.unsupported-mime-type':
    'رُفض الملف لأن نوع MIME الخاص به لا يطابق صيغة مصنف ARIS مدعومة.',
  'aris.excel.issue.compressed-size-limit': 'رُفض المصنف لأن حجمه المضغوط يتجاوز الحد الآمن للرفع.',
  'aris.excel.issue.uncompressed-size-limit':
    'رُفض المصنف لأن حجمه غير المضغوط يتجاوز الحد الآمن للمعالجة.',
  'aris.excel.issue.zip-entry-limit':
    'رُفض المصنف لأنه يحتوي على عناصر ZIP أكثر من الحد الآمن للمعالجة.',
  'aris.excel.issue.sheet-limit': 'رُفض المصنف لأنه يحتوي على أوراق أكثر من الحد الآمن للمعالجة.',
  'aris.excel.issue.malformed-zip': 'رُفض المصنف لأن حاوية ZIP الخاصة به تالفة ولا يمكن تحليلها.',
  'aris.excel.issue.zip64-unsupported':
    'رُفض المصنف لأنه يستخدم صيغة ZIP64 التي لا يدعمها هذا الإصدار.',
  'aris.excel.issue.multi-disk-zip':
    'رُفض المصنف لأنه أرشيف ZIP متعدد الأقراص، وهو غير مدعوم في هذا الإصدار.',
  'aris.excel.issue.unsupported-compression':
    'رُفض المصنف لأن أحد عناصر ZIP يستخدم طريقة ضغط غير مدعومة.',
  'aris.excel.issue.unsafe-zip-path': 'رُفض المصنف لأن مسار أحد عناصر ZIP غير آمن.',
  'aris.excel.issue.duplicate-zip-entry':
    'رُفض المصنف لأن حاوية ZIP تحتوي على أكثر من عنصر بالمسار نفسه.',
  'aris.excel.issue.encrypted-workbook': 'رُفض المصنف لأنه محمي بكلمة مرور أو مشفّر.',
  'aris.excel.issue.macro-content':
    'رُفض المصنف لأنه يحتوي على محتوى وحدات ماكرو، وهو غير مقبول في هذا الإصدار.',
  'aris.excel.issue.executable-content': 'رُفض المصنف لأنه يحتوي على محتوى تنفيذي مضمّن.',
  'aris.excel.issue.missing-xlsx-part': 'رُفض المصنف لأن جزءًا مطلوبًا من بنية XLSX مفقود.',
  'aris.excel.issue.expanded-size-mismatch':
    'رُفض المصنف لأن الحجم الموسّع لأحد العناصر لا يطابق الحجم المعلن في ترويسة ZIP.',
  'aris.excel.issue.external-links-ignored':
    'يحتوي المصنف على روابط لمصنفات خارجية؛ تم تجاهلها أثناء الاستيراد.',
  'aris.excel.issue.data-connections-ignored':
    'يحتوي المصنف على اتصالات بيانات خارجية؛ تم تجاهلها أثناء الاستيراد.',
  'aris.excel.issue.template-version-missing': 'رُفض المصنف لأنه لا يعلن إصدار قالب مصنف ARIS.',
  'aris.excel.issue.template-version-unsupported':
    'رُفض المصنف لأن إصدار القالب المعلن غير مدعوم في هذا الإصدار.',
  'aris.excel.issue.legacy-bpmn-workbook':
    'رُفض المصنف لأنه مصنف BPMN قديم، وهذا الإصدار المقتصر على ARIS لا يقبله.',
  'aris.excel.issue.sheet-missing': 'رُفض المصنف لأن ورقة مطلوبة مفقودة.',
  'aris.excel.issue.sheet-unknown': 'يحتوي المصنف على ورقة ليست جزءًا من قالب مصنف ARIS الرسمي.',
  'aris.excel.issue.column-missing': 'رُفض المصنف لأن عمودًا مطلوبًا مفقود من إحدى الأوراق.',
  'aris.excel.issue.column-unknown': 'يحتوي المصنف على عمود ليس جزءًا من قالب مصنف ARIS الرسمي.',
  'aris.excel.issue.header-row-missing': 'رُفض المصنف لأن إحدى الأوراق تفتقد صف العناوين.',
  'aris.excel.issue.row-limit':
    'رُفض المصنف لأن إحدى الأوراق تحتوي على صفوف أكثر من الحد الآمن للمعالجة.',
  'aris.excel.issue.column-limit':
    'رُفض المصنف لأن إحدى الأوراق تحتوي على أعمدة أكثر من الحد الآمن للمعالجة.',
  'aris.excel.issue.cell-count-limit':
    'رُفض المصنف لأن إحدى الأوراق تحتوي على خلايا أكثر من الحد الآمن للمعالجة.',
  'aris.excel.issue.cell-length-limit': 'رُفض المصنف لأن نص إحدى الخلايا يتجاوز الحد الآمن للطول.',
  'aris.excel.issue.formula-without-cached-value':
    'رُفض المصنف لأن خلية معادلة لا تحتوي على قيمة مخزنة مؤقتًا يمكن قراءتها.',
  'aris.excel.issue.cached-formula-value':
    'تمت قراءة خلية معادلة باستخدام قيمتها المخزنة مؤقتًا بدلًا من حساب المعادلة.',
  'aris.excel.issue.value-required': 'رُفض المصنف لأن قيمة خلية مطلوبة فارغة.',
  'aris.excel.issue.value-not-a-number': 'رُفض المصنف لأن خلية يجب أن تحتوي على رقم لا تحتوي عليه.',
  'aris.excel.issue.value-not-an-integer':
    'رُفض المصنف لأن خلية يجب أن تحتوي على عدد صحيح لا تحتوي عليه.',
  'aris.excel.issue.value-not-a-boolean':
    'رُفض المصنف لأن خلية يجب أن تحتوي على قيمة منطقية لا تحتوي عليها.',
  'aris.excel.issue.value-not-allowed':
    'رُفض المصنف لأن قيمة إحدى الخلايا ليست من القيم المسموح بها لعمودها.',
  'aris.excel.issue.unknown-object-type':
    'رُفض المصنف لأن أحد الصفوف يشير إلى نوع كائن لا يتعرف عليه هذا الإصدار.',
  'aris.excel.issue.unknown-symbol-type':
    'رُفض المصنف لأن أحد الصفوف يشير إلى نوع رمز لا يتعرف عليه هذا الإصدار.',
  'aris.excel.issue.invalid-symbol-type':
    'رُفض المصنف لأن نوع الرمز في أحد الصفوف لا يطابق نوع الكائن الخاص به.',
  'aris.excel.issue.invalid-connection-type':
    'رُفض المصنف لأن أحد الصفوف يشير إلى نوع رابط لا يتعرف عليه هذا الإصدار.',
  'aris.excel.issue.invalid-attribute-type':
    'رُفض المصنف لأن أحد الصفوف يشير إلى نوع سمة لا يتعرف عليه هذا الإصدار.',
  'aris.excel.issue.invalid-color': 'رُفض المصنف لأن قيمة اللون في إحدى الخلايا ليست لونًا صالحًا.',
  'aris.excel.issue.invalid-route-points':
    'رُفض المصنف لأن نقاط مسار أحد الروابط ليست إحداثيات صالحة.',
  'aris.excel.issue.duplicate-id': 'رُفض المصنف لأن أكثر من صف يعلن المعرّف نفسه.',
  'aris.excel.issue.missing-reference':
    'رُفض المصنف لأن أحد الصفوف يشير إلى معرّف غير موجود في المصنف.',
  'aris.excel.issue.object-definition-conflict':
    'رُفض المصنف لأن صفين يعرّفان الكائن نفسه ببيانات متعارضة.',
  'aris.excel.issue.connection-endpoint-cycle':
    'رُفض المصنف لأن طرفي أحد الروابط يشكلان حلقة ذاتية غير مدعومة.',
  'aris.excel.issue.control-flow-object-limit':
    'رُفض المصنف لأن أحد النماذج يحتوي على كائنات تدفق تحكم أكثر من الحد الآمن للمعالجة.',
  'aris.excel.issue.control-flow-object-warning':
    'يقترب أحد النماذج من الحد الآمن لعدد كائنات تدفق التحكم.',
  'aris.excel.issue.object-transaction-limit':
    'رُفض المصنف لأنه يحتوي على كائنات أكثر من الحد الآمن لعملية استيراد واحدة.',
  'aris.excel.issue.empty-workbook': 'رُفض المصنف لأنه لا يحتوي على محتوى قابل للاستيراد.',
  'aris.excel.issue.internal-error': 'تعذّرت معالجة المصنف بسبب خطأ داخلي غير متوقع.',
  'aris.excel.guidance.legacy-bpmn-workbook':
    'صدّر العملية من ARIS كمصنف ARIS وليس كمصنف BPMN قديم، ثم استورده مرة أخرى.',
  'aris.excel.guidance.template-version-missing':
    'أعد إنشاء المصنف من قالب مصنف ARIS الرسمي ثم استورده مرة أخرى.',
  'aris.excel.guidance.template-version-unsupported':
    'رقِّ المصنف إلى إصدار قالب يدعمه هذا الإصدار، ثم استورده مرة أخرى.',
  'aris.excel.guidance.formula-without-cached-value':
    'افتح المصنف في برنامج جداول بيانات، واسمح له بإعادة الحساب، ثم احفظه واستورده مرة أخرى.',
  'aris.excel.guidance.cached-formula-value':
    'تحقق من صحة القيم المخزنة مؤقتًا للمعادلات قبل الاعتماد على البيانات المستوردة.',
  'aris.excel.guidance.missing-reference':
    'أضف الصف المرجعي المفقود إلى المصنف، أو احذف الإشارة إليه، ثم استورده مرة أخرى.',
  'aris.excel.guidance.duplicate-id': 'اجعل كل معرّف في المصنف فريدًا، ثم استورده مرة أخرى.',
  'aris.excel.guidance.unknown-object-type':
    'صحّح نوع الكائن إلى قيمة من قالب مصنف ARIS الرسمي، ثم استورده مرة أخرى.',
  'aris.excel.guidance.invalid-route-points':
    'صحّح نقاط مسار الرابط إلى إحداثيات صالحة، ثم استورده مرة أخرى.',
  'aris.excel.guidance.control-flow-object-limit':
    'قسّم النموذج إلى نماذج أصغر تبقى ضمن الحد الآمن لعدد كائنات تدفق التحكم.',
  'aris.excel.guidance.control-flow-object-warning':
    'ضع في اعتبارك تقسيم النموذج قبل أن يبلغ الحد الآمن لعدد كائنات تدفق التحكم.',
  'aris.excel.guidance.object-transaction-limit':
    'قسّم المصنف إلى دفعات أصغر تبقى ضمن الحد الآمن لعملية استيراد واحدة.',

  // --- نتائج التحقق الدلالي لمخططات EPC في ARIS (src/aris/epc/index.ts, validate.ts) ---
  'aris.epc.finding.alternationViolation':
    'يشترك ظهوران متصلان مباشرة في النوع {objectType}؛ يجب أن تتناوب الأحداث والوظائف، مع وجود قاعدة بينهما.',
  'aris.epc.finding.missingStartEvent': 'لا يحتوي هذا النموذج على حدث بداية.',
  'aris.epc.finding.missingEndEvent': 'لا يحتوي هذا النموذج على حدث نهاية.',
  'aris.epc.finding.ruleSplitMergeConflict':
    'تجمع هذه القاعدة بين عدة فروع واردة وتتفرّع في الوقت نفسه إلى عدة فروع صادرة؛ يجب تمثيل التجميع والتفريع بقاعدتين منفصلتين.',
  'aris.epc.finding.eventPrecedesDecisionSplit':
    'يعقب الحدث مباشرة قاعدة {ruleKind} متفرّعة؛ اتخاذ القرار من اختصاص القاعدة وليس الحدث.',
  'aris.epc.finding.orphanNode': 'هذا الكائن منفصل عن مسار التحكم الرئيسي للنموذج.',
  'aris.epc.finding.unrecognizedRuleSymbol':
    'تستخدم هذه القاعدة رمز موصل غير معروف هو «{symbolType}»؛ المدعوم فقط AND وOR وXOR.',
  'aris.epc.finding.missingConnectionType': 'لا تحمل هذه العلاقة نوعًا محددًا.',
  'aris.epc.finding.danglingLinkedModel':
    'يرتبط هذا الكائن بالنموذج «{modelId}»، وهو غير موجود في هذا المستند.',

  // --- نتائج ماسح الثغرات في محادثة ARIS (src/aris/chat/messageKeys.ts, gapScanner.ts؛
  // ARIS_CHAT_OWN_MESSAGE_KEYS هي قائمة المفاتيح الصادرة الرسمية — تعيد هذه الوحدة أيضًا
  // استخدام مفاتيح aris.epc.finding.* أعلاه كما هي دون تكرار) ---
  'aris.chat.gap.missingEnglishName': 'لا يوجد اسم إنجليزي مسجَّل.',
  'aris.chat.gap.missingArabicName': 'لا يوجد اسم عربي مسجَّل.',
  'aris.chat.gap.missingProcessCode': 'لا يوجد رمز عملية مسجَّل لهذه الوظيفة.',
  'aris.chat.gap.missingOwner': 'لا يوجد مالك أو جهة مسؤولة مسجَّلة لهذه الوظيفة.',
  'aris.chat.gap.missingInputsOutputsSystems':
    'لا توجد مدخلات أو مخرجات أو أنظمة داعمة مسجَّلة لهذه الوظيفة.',
  'aris.chat.gap.missingDecisionBasis': 'لا يوجد أساس قرار مسجَّل لهذه القاعدة المتفرّعة.',
  'aris.chat.gap.missingXorOutcomes':
    'تفتقد الفروع الصادرة من قاعدة القرار هذه إلى تسميات، أو تتشارك تسمية مكررة.',
  'aris.chat.gap.missingReturnTarget': 'لم يُعثر على وجهة عودة لفرع الرجوع هذا.',
  'aris.chat.gap.missingReturnTarget.ambiguous':
    'تم العثور على أكثر من وجهة عودة محتملة لفرع الرجوع هذا؛ يلزم اختيار يدوي.',
  'aris.chat.gap.dangling.occurrenceDefinition': 'يشير هذا الظهور إلى تعريف كائن غير موجود.',
  'aris.chat.gap.dangling.connectionEndpoint': 'تشير هذه العلاقة إلى تعريف أو طرف غير موجود.',
  'aris.chat.gap.missingLinkedModel': 'لا يوجد نموذج مرتبط مُسنَد لواجهة العملية هذه.',
  'aris.chat.gap.missingAttachment': 'لا يوجد مرفق مسجَّل لهذا الكائن.',
  'aris.chat.gap.unusedDefinition': 'لا يستخدم أي ظهور في المستند هذا التعريف.',
  'aris.chat.gap.unaccountedSourceContent': 'تعذّر حصر بعض محتوى المصدر الأصلي في هذا المستند.',

  // --- نتائج دقة محرك رسم ARIS المطابق للمصدر (src/aris/renderer/fidelity.ts, font.ts,
  // color.ts, textWrap.ts — راجع ARIS_RENDER_FIDELITY_KINDS في types.ts؛ أنواع القالب
  // المفقود والرمز المخصص غير المعروف والمورد البصري المستبدل مملوكة لسجل الرموز أعلاه) ---
  'aris.fidelity.missingFont':
    'الخط المطلوب «{faceName}» غير مدرَج في قائمة الخطوط الآمنة؛ تم استبداله بخط بديل.',
  'aris.fidelity.unsupportedOleRendering':
    'يُعرض كائن OLE المضمّن «{attachmentId}» كأيقونة نائبة فقط؛ لا يُفكّ محتواه ولا تتم معاينته.',
  'aris.fidelity.missingReferenceExport':
    'لا يحتوي المرفق «{attachmentId}» على محتوى مُصدَّر؛ لذا يتعذّر عرض أي شيء له.',
  'aris.fidelity.unsupportedPenEffect': 'نمط الخط «{style}» غير مدعوم؛ تم استبداله بخط متصل.',
  'aris.fidelity.unsupportedBrushEffect':
    'نمط التعبئة «{brushType}» غير مدعوم؛ تم استبداله بتعبئة صلبة.',
  'aris.fidelity.textWrapDifference':
    'احتاج هذا النص إلى التفاف الأسطر؛ قد يختلف تخطيطه المعروض عن رسم ARIS الأصلي.',

  // --- حالة توافق التصدير المشتق في ARIS (src/aris/writer/compatibility.ts،
  // القسم 9.5 من الخطة — النص الإنجليزي أدناه ثابت حرفيًا بموجب الخطة) ---
  'aris.export.experimentalLabel': 'تصدير ARIS AML تجريبي',
  'aris.export.experimentalNotice':
    'لم يُتحقق من هذا الملف المُصدَّر باستيراده إلى ARIS؛ يُعامل بوصفه تجريبيًا إلى أن ينجح استيراد وإعادة تصدير فعليان في ARIS دون أي إصلاح.',

  // --- غلاف ARIS (src/aris/shell/shellI18n.ts — ARIS_SHELL_MESSAGE_KEYS) ---
  'aris.canvas.aria': 'لوحة رسم ARIS لِـ {model}',
  'aris.canvas.noModels':
    'لا يحمل هذا المصدر أي سجلات نماذج ARIS، فلا يوجد ما يُرسم. ما تزال أشرطة المصدر والمحاسبة والتفاصيل تصف كل سجل مستورد.',
  'aris.canvas.unsupportedModelType':
    'نوع النموذج {type} خارج نطاق لوحة الرسم المدعوم، لذلك يُدرَج في القائمة دون رسمه.',
  'aris.canvas.bootFailed': 'تعذّر فتح لوحة رسم ARIS: {error}',
  'aris.palette.hand': 'أداة اليد (تحريك)',
  'aris.palette.lasso': 'تحديد بالحبل',
  'aris.palette.freeText': 'ملاحظة نصية حرة',
  'aris.palette.func': 'وظيفة',
  'aris.palette.evt': 'حدث',
  'aris.palette.rule.and': 'قاعدة "و"',
  'aris.palette.rule.or': 'قاعدة "أو"',
  'aris.palette.rule.xor': 'قاعدة "أو الحصرية"',
  'aris.palette.entType': 'نوع كيان',
  'aris.palette.infoCarr': 'حامل معلومات',
  'aris.palette.businessRule': 'قاعدة عمل',
  'aris.palette.perf': 'مؤشر أداء',
  'aris.palette.applSys': 'نظام تطبيقي',
  'aris.palette.pers': 'شخص',
  'aris.palette.requirement': 'متطلب',
  'aris.palette.policy': 'سياسة',
  'aris.palette.persType': 'دور (نوع شخص)',
  'aris.palette.createTitle': 'إنشاء {name}',
  'aris.palette.grip.title': 'اسحب لتحريك لوحة الأدوات. انقر نقرًا مزدوجًا لإعادة موضعها.',
  'aris.canvas.emptyModelHint':
    'هذا النموذج فارغ — اسحب شكلًا من لوحة الأدوات، أو انقر على عنصر في اللوحة ثم انقر على اللوحة القماشية لبدء الرسم.',
  'aris.canvas.emptyModelHint.dismiss': 'حسنًا',
  'aris.contextPad.connect': 'وصّل من هنا',
  'aris.contextPad.appendFunction': 'إلحاق وظيفة',
  'aris.contextPad.appendEvent': 'إلحاق حدث',
  'aris.contextPad.delete': 'حذف من هذا النموذج',
  'aris.explorer.models': 'النماذج',
  'aris.explorer.modelSummary': '{objects} كائنات · {connections} علاقات',
  'aris.explorer.modelListAria': 'نماذج ARIS في {source}',
  'aris.explorer.actionUnavailable': 'لا تدعم مساحة العمل هذه هذا الإجراء.',
  'aris.explorer.invalidName': 'لا يمكن أن يحتوي الاسم على شرطة مائلة.',
  'aris.explorer.reservedPath': 'لا يمكن استخدام النطاق المحجوز .orbitpm هنا.',
  'aris.toolbar.aria': 'أدوات تحكم لوحة رسم ARIS',
  'aris.toolbar.undo': 'تراجع',
  'aris.toolbar.redo': 'إعادة',
  'aris.toolbar.cleanLayout': 'تخطيط نظيف',
  'aris.toolbar.resetLayout': 'إعادة الضبط إلى تخطيط المصدر',
  'aris.toolbar.layoutMode.source': 'تخطيط المصدر',
  'aris.toolbar.layoutMode.clean': 'تخطيط نظيف',
  'aris.toolbar.importPackage': 'استيراد إلى مساحة العمل…',
  'aris.toolbar.contentLang': 'التسميات: {language}',
  'aris.toolbar.contentLang.title':
    'تبديل تسميات المخطط بين الإنجليزية والعربية (عرض فقط دون تعديل)',
  'aris.toolbar.translate': 'ترجمة…',
  'aris.toolbar.translate.missing': '{count} بدون ترجمة',
  'aris.translate.nothingMissing': 'كل التسميات تحمل اللغتين بالفعل.',
  'aris.translate.applied': 'تم تطبيق {count} ترجمة كخطوة واحدة قابلة للتراجع.',
  'aris.translate.autoDone':
    'تمت ترجمة {count} تسمية تلقائيًا — تراجع واحد يستعيدها، ويمكن المراجعة من شريط الأدوات.',
  'aris.translate.stale': 'تغيّر النموذج أثناء المراجعة — تم تحديث القائمة.',
  'aris.translate.gestureLabel': 'ترجمة التسميات',
  'aris.translate.failed': 'تعذّر إكمال الترجمة: {error}',
  'aris.translate.memoryFailed': 'تعذّر حفظ الترجمة في الذاكرة: {error}',
  'aris.fix.badge': '{count} ملاحظة — إصلاح…',
  'aris.fix.title': 'إصلاح المكوّنات الناقصة',
  'aris.fix.autoSection': 'تعبئة تلقائية (آمنة)',
  'aris.fix.confirmSection': 'تغييرات مقترحة تتطلب تأكيدًا',
  'aris.fix.interviewSection': 'تتطلب إجاباتك',
  'aris.fix.openInterview': 'الإجابة عن الأسئلة…',
  'aris.fix.applied': 'تم تطبيق {count} إصلاحًا كخطوة واحدة قابلة للتراجع.',
  'aris.fix.gestureLabel': 'إصلاح المكوّنات الناقصة',
  'aris.fix.cleanLayoutHint': 'تُوضع العناصر الجديدة تلقائيًا — شغّل التخطيط النظيف بعد ذلك.',
  'aris.fix.startEvent.name': 'بدأت العملية',
  'aris.fix.endEvent.name': 'اكتملت العملية',
  'aris.layout.cleanApplied': 'طُبِّق التخطيط النظيف كخطوة واحدة قابلة للتراجع.',
  'aris.layout.resetApplied': 'أُعيد الضبط إلى تخطيط المصدر المستورد.',
  'aris.layout.rejected': 'رُفِض التخطيط النظيف: {reason}',
  'aris.layout.failed': 'فشل التخطيط النظيف: {error}',
  'aris.rail.details': 'التفاصيل',
  'aris.rail.metadata': 'البيانات الوصفية',
  'aris.details.attachment.download': 'تنزيل {name}',
  'aris.rail.accounting': 'المحاسبة',
  'aris.rail.fidelity': 'الدقة',
  'aris.rail.aria': 'أشرطة تفاصيل ARIS والمحاسبة',
  'aris.details.noSelection': 'اختر عنصرًا على لوحة الرسم لفحصه.',
  'aris.details.selectionAria': 'تفاصيل {element}',
  'aris.details.emptyTab': 'لا توجد قيم لهذا التبويب.',
  'aris.details.missing': 'غير محدَّد',
  'aris.accounting.summary':
    '{accounted} من {total} سجلًا من سجلات المصدر مُحتسَبة؛ {unaccounted} غير مُحتسَبة.',
  'aris.accounting.summary.derived':
    'إضافة إلى ذلك، {derived} إدخالات مشتقة مُسجَّلة بشكل منفصل (لا تُحتسب ضمن إجمالي سجلات المصدر).',
  'aris.accounting.filter': 'تصفية صفوف المحاسبة',
  'aris.accounting.showing': 'يُعرض {shown} من {matched} صفًا مطابقًا.',
  'aris.accounting.showMore': 'عرض المزيد من الصفوف',
  'aris.accounting.rowAria': 'اختيار {id} على لوحة الرسم',
  'aris.accounting.notOnCanvas': 'لا يملك هذا السجل عنصرًا في النموذج الحالي.',
  'aris.accounting.column.path': 'مسار المصدر',
  'aris.accounting.column.kind': 'النوع',
  'aris.accounting.column.disposition': 'الحالة',
  'aris.accounting.column.id': 'معرّف المصدر',
  'aris.accounting.issues': 'المشكلات',
  'aris.accounting.noIssues': 'لا توجد مشكلات مطابقة.',
  'aris.fidelity.none': 'لم يُبلَّغ عن أي بدائل بصرية لهذا المصدر.',
  'aris.fidelity.count': '{count} نتائج',
  'aris.import.review.title': 'مراجعة هذا الاستيراد',
  'aris.import.review.source': 'المصدر',
  'aris.import.review.digest': 'بصمة المراجعة',
  'aris.import.review.duplicate': 'توجد بالفعل بصمة مصدر مطابقة؛ سيؤدي التنفيذ إلى إزالة التكرار.',
  'aris.import.review.counts':
    '{models} نماذج · {writes} عناصر حزمة · {bytes} بايت · {attachments} مرفقات',
  'aris.import.review.fidelity':
    '{accounted} من {total} سجلًا مُحتسَبة، {unaccounted} غير مُحتسَبة.',
  'aris.import.review.writes': 'عناصر الحزمة المُراد كتابتها',
  'aris.import.review.confirm': 'تنفيذ الاستيراد',
  'aris.import.review.cancel': 'إلغاء',
  'aris.import.committed': 'تم استيراد {name} إلى مخزن حزم مساحة العمل.',
  'aris.import.downloaded':
    'تم استيراد {name}؛ وجرى تنزيل حاوية مساحة العمل المحمولة بدلاً من كتابتها في مكانها.',
  'aris.import.deduplicated': 'هذا المصدر مخزَّن بالفعل؛ لم تُكتب أي بيانات.',
  'aris.import.rolledBack': 'فشل الاستيراد وتم التراجع عنه: {error}',
  'aris.import.flushFailed': 'كُتبت حزمة مساحة العمل لكن فشل حفظ الملف: {error}',
  'aris.import.failed': 'تعذّر تجهيز الاستيراد: {error}',
  'aris.ai.cancelled': 'أُلغي الطلب؛ لم يُنشأ أي شيء.',
  'aris.ai.created':
    'أُنشئ {models} نماذج و{objects} كائنات و{relations} علاقات؛ وأُبلغ عن {uncertainties} حالات عدم يقين.',
  'aris.ai.failed': 'فشل الطلب: {error}',
  'aris.ai.notJson': 'لم يُرجع المزوّد JSON صارمًا: {error}',
  'aris.ai.rejected': 'رُفضت المسودة ولم يُنشأ أي شيء.',
  'aris.assistant.ai.answeredBy': 'أجاب {provider} · {model}',
  'aris.assistant.ai.asking': 'جارٍ السؤال…',
  'aris.assistant.ai.body':
    'يرسل سؤالك إلى مزوّد الذكاء الاصطناعي المُهيأ، بالاستناد فقط إلى محتوى العمليات الموضح أدناه. لا يُرسل شيء حتى تراجع الطلب الدقيق وتوافق عليه.',
  'aris.assistant.ai.cancel': 'إلغاء',
  'aris.assistant.ai.cancelled': 'تم إلغاء طلب الذكاء الاصطناعي.',
  'aris.assistant.ai.consent': 'راجعتُ الطلب الدقيق أعلاه وأوافق على إرساله',
  'aris.assistant.ai.contextCount': 'تطابقت {count} عملية ذات صلة وستُضمّن',
  'aris.assistant.ai.contextNone':
    'لم تُطابق أي عملية هذا السؤال، لذا لن يُرسل أي محتوى من مساحة العمل.',
  'aris.assistant.ai.fallback':
    'فشل طلب الذكاء الاصطناعي، لذا يُعرض بدلاً منه الإجابة المحلية أعلاه.',
  'aris.assistant.ai.heading': 'اسأل الذكاء الاصطناعي (بالاستناد إلى هذه العمليات)',
  'aris.assistant.ai.includeContext': 'تضمين سياق العمليات ذات الصلة',
  'aris.assistant.ai.preview': 'الطلب الصادر بالضبط',
  'aris.assistant.ai.previewSystem': 'تعليمات النظام',
  'aris.assistant.ai.previewUser': 'رسالة المستخدم',
  'aris.assistant.ai.redactNames': 'إخفاء الأسماء في سياق العمليات',
  'aris.assistant.ai.submit': 'اسأل الذكاء الاصطناعي',
  'aris.assistant.ask.body':
    'تُجاب الأسئلة محليًا من النماذج المفهرَسة. لا يُستخدم أي مزوّد ولا أي مفتاح API.',
  'aris.assistant.ask.heading': 'اسأل مكتبة العمليات',
  'aris.assistant.ask.indexed': '{count} نماذج مفهرَسة',
  'aris.assistant.ask.label': 'السؤال',
  'aris.assistant.ask.submit': 'اسأل',
  'aris.assistant.chip.unavailable': 'هذا العنصر غير مفتوح على لوحة رسم قابلة للعرض.',
  'aris.assistant.suggest.missing': 'ما المعلومات الناقصة؟',
  'aris.assistant.suggest.processes': 'ما العمليات المتاحة؟',
  'aris.chat.apply': 'تطبيق الإجابات',
  'aris.chat.commitFailed': 'رفضت لوحة الرسم التغيير؛ لم يُطبَّق أي شيء.',
  'aris.chat.confirmApply': 'تطبيق التغييرات المحدَّدة',
  'aris.chat.confirmHeading': 'هذه التغييرات تحتاج إلى تأكيد',
  'aris.chat.finished': 'انتهت المقابلة: {status}',
  'aris.chat.gapCount': 'عُثر على {count} ثغرات',
  'aris.chat.noProposal': 'لا تقابل هذه الإجابات تغييرًا يمكن لهذا الإصدار تنفيذه بشكل حتمي.',
  'aris.chat.nothingSelected': 'اختر تغييرًا واحدًا على الأقل لتطبيقه.',
  'aris.chat.preview.after': 'بعد',
  'aris.chat.preview.before': 'قبل',
  'aris.chat.proposeRemoval': 'اقترح إزالته',
  'aris.chat.provenanceRejected': 'حُجب إيصال تغيير عن السجل.',
  'aris.chat.rejected': 'رُفض التعديل: {error}',
  'aris.chat.round': 'الجولة {round} من 5 · {status}',
  'aris.chat.start': 'بدء مقابلة الإكمال',
  'aris.chat.undo': 'تراجع عن آخر تغيير مُطبَّق',
  'aris.chatDrawer.interview.intro':
    'فحصت {name} ووجدت {count} فجوة. أجب عن ثلاثة أسئلة كحدّ أقصى في كل جولة؛ وتُطبَّق التغييرات الآمنة كخطوة واحدة قابلة للتراجع.',
  'aris.chatDrawer.interview.noTarget': 'افتح نموذج ARIS أولًا، ثم ابدأ مقابلة الإكمال.',
  'aris.chatDrawer.interview.clean': 'لا توجد فجوات — يبدو هذا النموذج مكتملًا.',
  'aris.chatDrawer.interview.applied': 'تم تطبيق {count} من التغييرات كخطوة واحدة قابلة للتراجع.',
  'aris.chatDrawer.interview.roundLimit':
    'تم بلوغ حدّ الجولات (5 من 5). تبقى الفجوات المتبقية مدرجة لمقابلة جديدة.',
  'aris.create.attachment.blocked': 'لم يُرسَل شيء: {reason}',
  'aris.create.attachment.gifUnsupported':
    'صيغة GIF مقبولة فقط على مسارات المزوّد والنموذج المتحقَّق منها. و{model} على {provider} ليس منها؛ حوِّل الصورة إلى PNG أو JPEG أو WebP.',
  'aris.create.attachment.imageUnsupported':
    'لا يستطيع {model} على {provider} قبول الصور. اختر نموذجًا قادرًا على قراءة الصور.',
  'aris.create.attachment.modelUnverified':
    '{model} ليس نموذجًا مراجَعًا للمرفقات على {provider}. اختر نموذجًا مراجَعًا قبل إرفاق أي ملف.',
  'aris.create.attachment.outbound':
    'يُرفَق مع الطلب الأول فقط: {name} ({size}، {type}). وجولات الإصلاح نصّية فقط.',
  'aris.create.attachment.pdfUnsupported':
    'لا يستطيع {model} على {provider} قبول ملف PDF. اختر نموذجًا يقرأ المستندات، أو صِف العملية نصًّا بدلًا من ذلك.',
  'aris.create.attachment.remove': 'إزالة المرفق',
  'aris.create.attachment.selected': 'أُرفِق {name} ({size}، {type}).',
  'aris.create.attachment.tooLarge': 'حجم {name} أكبر من أن يُرفَق لدى {provider}.',
  'aris.create.attachment.unsupportedType': 'يمكن إرفاق ملفات PDF وPNG وJPEG وWebP وGIF فقط.',
  'aris.create.attachments.label':
    'مرفق اختياري — يُقرأ ملف DOCX على هذا الجهاز، ويُرسَل ملف PDF إلى المزوّد',
  'aris.create.consent': 'راجعتُ الطلب أعلاه وأوافق على إرساله',
  'aris.create.document.body':
    'أرفِق ملف PDF أو صورة لرسم عملية (PNG أو JPEG أو WebP؛ وGIF على المسارات المتحقَّق منها فقط). ولا يُرسَل الملف إلى المزوّد المحدَّد إلا بعد مراجعتك للطلب وموافقتك عليه.',
  'aris.create.document.choose': 'اختر ملف PDF أو صورة…',
  'aris.create.document.create': 'إنشاء من المستند',
  'aris.create.document.hint':
    'تلميح اختياري — اسم النموذج أو الاتجاه أو الحدود أو الرموز غير الواضحة',
  'aris.create.document.hintPlaceholder':
    'مثال: انمذج مسار تجديد التصريح؛ الرسم يُقرأ من اليمين إلى اليسار؛ المربع المتقطّع ملاحظة وليس خطوة.',
  'aris.create.document.none': 'لم يُرفَق أي مستند بعد.',
  'aris.create.docx.attached':
    'أُرفِق {name}: استُخرج {chars} حرفًا على هذا الجهاز. ولا يُرفَع الملف نفسه إطلاقًا.',
  'aris.create.docx.choose': 'إرفاق ملف DOCX…',
  'aris.create.docx.failed': 'تعذّرت قراءة ملف DOCX: {error}',
  'aris.create.docx.notDocx': 'هذا ليس ملف ‎.docx؛ لم يُرفَق شيء.',
  'aris.create.model': 'النموذج',
  'aris.create.modelType': 'نوع النموذج',
  'aris.create.noKey': 'لا يوجد مفتاح API مخزَّن لهذا المزوّد. افتح الإعدادات لإضافة واحد.',
  'aris.create.pdf.choose': 'إرفاق ملف PDF…',
  'aris.create.pdf.onlyPdf':
    'تقبل تبويبة الوصف مرفق PDF فقط. استخدم تبويبة PDF/الصورة لرسوم العمليات.',
  'aris.create.placement.cancelled':
    'أُلغي الطلب قبل الإيداع، فلم يُكتب شيء. وما يزال بالإمكان تنزيل ملف AML المولَّد أدناه.',
  'aris.create.placement.stale':
    'تغيّرت مساحة العمل أثناء توليد النموذج، فلم يُكتب فيها شيء. نزِّل ملف AML المولَّد أدناه للاحتفاظ به.',
  'aris.create.preview': 'الطلب الصادر الدقيق',
  'aris.create.provider': 'المزوّد',
  'aris.create.recovery.discard': 'تجاهل ملف AML المولَّد',
  'aris.create.recovery.download': 'تنزيل ملف AML المولَّد ({name})',
  'aris.create.redactNames': 'إخفاء الأسماء في سياق مساحة العمل',
  'aris.create.repairing':
    'كانت المسوّدة غير صالحة؛ يجري إرسال جولة إصلاح نصّية {attempt} من {max}. ولا يُعاد إرسال المرفق.',
  'aris.create.requestEstimate': 'حتى {count} طلبات',
  'aris.create.semanticExhausted':
    'ما زال المزوّد يُعيد مسوّدة غير صالحة بعد {attempts} من جولات الإصلاح؛ لم يُنشأ شيء.',
  'aris.create.sensitivity': 'الأسماء المكتشَفة: {names} · البيانات الوصفية الحساسة: {meta}',
  'aris.create.tab.description': 'الوصف',
  'aris.create.tab.document': 'PDF/صورة',
  'aris.create.tab.excel': 'Excel',
  'aris.create.tabsAria': 'مصدر إدخال الإنشاء',
  'aris.create.transportFailed':
    'فشل طلب المزوّد قبل عودة أي مسوّدة، فلم تُستهلك أي محاولة إصلاح: {error}',
  'aris.epc.findingAria': 'اختيار {id} على لوحة الرسم',
  'aris.epc.none': 'لم تُوجد أي مخالفات لقواعد EPC في هذا المصدر.',
  'aris.epc.notOnCanvas': 'لا تملك هذه النتيجة عنصرًا في نموذج قابل للعرض.',
  'aris.epc.severity.error': 'خطأ',
  'aris.epc.severity.warning': 'تحذير',
  'aris.epc.showMore': 'عرض المزيد من النتائج',
  'aris.epc.summary': '{errors} أخطاء · {warnings} تحذيرات',
  'aris.excel.body': 'املأ قالب ARIS الرسمي وأنشئ نماذج أصلية دون أي ذكاء اصطناعي على الإطلاق.',
  'aris.excel.create': 'إنشاء من ملف العمل…',
  'aris.excel.created': 'أُنشئ {models} نماذج و{objects} كائنات و{connections} علاقات.',
  'aris.excel.downloadBlank': 'تنزيل قالب فارغ',
  'aris.excel.downloadExample': 'تنزيل قالب مثال',
  'aris.excel.failed': 'تعذّرت قراءة ملف العمل: {error}',
  'aris.excel.legacy':
    'هذا ملف عمل BPMN 0.4.5 القديم المتوقف. نزّل قالب ARIS أدناه وأعد إدخال العملية فيه.',
  'aris.excel.rejected': 'رُفض ملف العمل: {errors} أخطاء، {warnings} تحذيرات.',
  'aris.export.done': 'صُدِّر AML المشتق: {edits} تعديلات، {bytes} بايت.',
  'aris.export.refused': 'رُفض التصدير المشتق: {error}',
  'aris.export.unmapped': 'تعذّر تحديد موضع {count} تعديلات في الملف الأصلي فاستُبعدت من التصدير.',
  'aris.export.unmapped.newModel':
    'أُنشئ النموذج {id} بعد استيراد الملف. مكانه في تصدير جديد لا في تعديل على هذا الملف، لذا استُبعد من هذا التصدير.',
  'aris.export.unmapped.removedModel':
    'حُذف النموذج {id} من مساحة العمل. لا يمكن لتعديل على الملف الأصلي حذف نموذج كامل، لذا استُبعد هذا التغيير من التصدير.',
  'aris.export.unmapped.defaultLocale':
    'لا تحمل القيمة الموجودة على {id} لغة مُحدَّدة، فلا يوجد موضع في الملف الأصلي لوضعها فيه. حدِّد لها لغة أولًا.',
  'aris.export.unmapped.clearedAttribute':
    'مُسحت قيمة "{attribute}" على {id}. تبدو السمة المُمسوحة مطابقة لسمة لم تحمل قيمة قط، فتعذّر تمييز هذا التغيير واستُبعد من التصدير.',
  'aris.export.unmapped.missingAnchor': 'تعذّر وضع {id} في الملف الأصلي: {anchor} غير موجود فيه.',
  'aris.export.unmapped.movedConnectionSource':
    'أُعيد ربط العلاقة {id} بنقطة بداية مختلفة. يتطلب تصدير هذا التغيير إعادة بناء العلاقة من الصفر وفقدان تنسيق الخط والتسمية الأصليين، لذا استُبعد هذا التغيير.',
  'aris.export.unmapped.linkedModelsOnNewDefinition':
    'رُبط الكائن الجديد {id} بنماذج أخرى، لكن بما أن {id} غير موجود بعد في الملف الأصلي، فلا موضع تُلحَق به هذه الروابط، لذا استُبعدت.',
  'aris.export.unmapped.unknownRecord': 'لا يقابل {id} أي عنصر في الملف الأصلي، فتعذّر تصديره.',
  'aris.rail.epc': 'تحقق EPC',
  'aris.rail.improve': 'تحسين هذه العملية',

  // --- شريط تفاصيل ARIS القابل للتحرير (src/aris/shell/ArisDetailsRail.tsx،
  // ArisDetailsEditors.tsx — ARIS_SHELL_MESSAGE_KEYS) ---
  'aris.details.edit.name': 'الاسم ثنائي اللغة',
  'aris.details.edit.nameEn': 'الاسم (اللغة الإنجليزية)',
  'aris.details.edit.nameAr': 'الاسم (اللغة العربية)',
  'aris.details.edit.scope.definition':
    'التعريف — تنتمي هذه القيمة إلى كائن ARIS نفسه، ولذلك يبلغ التغييرُ جميعَ تجلياته البالغة {count} عبر {models} من النماذج.',
  'aris.details.edit.scope.occurrence':
    'التجلي — تنتمي هذه القيمة إلى هذا الشكل وحده، وتبقى بقية تجليات كائن ARIS نفسه ({count} في المجموع) دون تغيير.',
  'aris.details.edit.scope.model': 'النموذج — تنتمي هذه القيمة إلى سجل النموذج نفسه.',
  'aris.details.edit.badge.definition': 'تعريف',
  'aris.details.edit.badge.occurrence': 'هذا الشكل فقط',
  'aris.details.edit.badge.model': 'نموذج',
  'aris.details.edit.localeStored': 'مخزَّنة تحت معرّف اللغة {locale}.',
  'aris.details.edit.localeNew': 'غير محددة بعد؛ ستُخزَّن تحت معرّف اللغة {locale}.',
  'aris.details.edit.scriptMismatch':
    'النص المخزَّن مكتوب بِـ{script} رغم أن معرّف اللغة يشير إلى {tag}. ويُحتفظ بمعرّف اللغة تمامًا كما أودعه المصدر.',
  'aris.details.edit.lang.en': 'الإنجليزية',
  'aris.details.edit.lang.ar': 'العربية',
  'aris.details.edit.attributes': 'سمات ARIS',
  'aris.details.edit.attributes.none':
    'لا يحمل تعريف الكائن هذا أي سمات ARIS، فلا توجد قيمة لتحريرها.',
  'aris.details.edit.valueEn': 'القيمة (اللغة الإنجليزية)',
  'aris.details.edit.valueAr': 'القيمة (اللغة العربية)',
  'aris.details.edit.valueOther': 'القيمة (اللغة {locale})',
  'aris.details.edit.noLocale': 'بلا معرّف لغة',
  'aris.details.edit.addLocale': 'إضافة قيمة بلغة أخرى',
  'aris.details.edit.addLocale.id': 'معرّف اللغة للقيمة الجديدة',
  'aris.details.edit.addLocale.text': 'قيمة اللغة الجديدة',
  'aris.details.edit.addLocale.submit': 'إضافة القيمة',
  'aris.details.edit.cancel': 'إلغاء',
  'aris.details.edit.remove': 'إزالة',
  'aris.details.edit.download': 'تنزيل',
  'aris.details.edit.failed': 'رُفض التغيير: {error}',
  'aris.details.edit.assignments': 'النماذج المرتبطة',
  'aris.details.edit.assignments.none': 'لا يرتبط بهذا الكائن أي نموذج بعد.',
  'aris.details.edit.assignments.remove': 'إلغاء ارتباط {model}',
  'aris.details.edit.assignments.exhausted': 'كل نموذج في هذا المصدر مرتبط بالفعل بهذا الكائن.',
  'aris.details.edit.assignments.choose': 'النموذج المراد ربطه',
  'aris.details.edit.assignments.add': 'ربط هذا النموذج',
  'aris.details.edit.attachments': 'مرفقات هذا الكائن',
  'aris.details.edit.attachments.none': 'لا يوجد ملف مرفق بهذا الكائن.',
  'aris.details.edit.attachments.meta': '{size} بايت · {type}',
  'aris.details.edit.attachments.download': 'تنزيل {name}',
  'aris.details.edit.attachments.remove': 'إزالة {name}',
  'aris.details.edit.attachments.confirmAria': 'تأكيد إزالة {name}',
  'aris.details.edit.attachments.confirmBody':
    'هل تُزال {name} من هذا الكائن؟ يستعيدها التراجع في خطوة واحدة.',
  'aris.details.edit.attachments.confirm': 'إزالة المرفق',
  'aris.details.edit.attachments.keep': 'الإبقاء عليه',
  'aris.details.edit.attachments.add': 'إرفاق ملف بهذا الكائن',
  'aris.details.edit.attachments.tooLarge':
    'حجم {name} يبلغ {size} بايت؛ والحد الأقصى للمرفق المخزَّن داخل النموذج هو {limit} بايت.',
  'aris.details.edit.style': 'نمط التجلي',
  'aris.details.edit.style.fillColor': 'لون التعبئة',
  'aris.details.edit.style.strokeColor': 'لون الحد',
  'aris.details.edit.style.strokeWidth': 'سُمك الحد',
  'aris.details.edit.style.lineStyle': 'نمط خط الحد',
  'aris.details.edit.style.solid': 'متصل',
  'aris.details.edit.style.dashed': 'متقطع',
  'aris.details.edit.style.dotted': 'منقّط',
  'aris.details.edit.style.inherit': 'من رمز ARIS',
  'aris.details.edit.style.appliesToCanvas':
    'يُرسَم النمط على لوحة الرسم ويُرافق التصدير، ويظلّ رمز ARIS مصدر الشكل.',

  // --- لوحة تفاصيل ARIS الجانبية (src/aris/details/metadata.ts, tabs.ts) ---
  'aris.details.tab.general': 'عام',
  'aris.details.tab.names': 'الأسماء',
  'aris.details.tab.attributes': 'السمات',
  'aris.details.tab.ids': 'المعرّفات',
  'aris.details.tab.relations': 'العلاقات',
  'aris.details.tab.assignments': 'الإسنادات',
  'aris.details.tab.attachments': 'المرفقات',
  'aris.details.tab.accounting': 'المحاسبة',
  'aris.details.tab.fidelity': 'الدقة',
  'aris.details.tab.history': 'السجل',
  'aris.details.category.owner': 'المالك',
  'aris.details.category.responsible': 'المسؤول',
  'aris.details.category.consulted': 'مُستشار',
  'aris.details.category.informed': 'مُطّلِع',
  'aris.details.category.input': 'المدخل',
  'aris.details.category.output': 'المخرج',
  'aris.details.category.system': 'النظام',
  'aris.details.category.businessRule': 'قاعدة عمل',
  'aris.details.category.policy': 'سياسة',
  'aris.details.category.requirement': 'متطلب',
  'aris.details.category.processCode': 'رمز العملية',
  'aris.details.category.arisId': 'معرّف ARIS',
  'aris.details.category.modelAssignment': 'إسناد النموذج',
  'aris.details.category.other': 'أخرى',
  'aris.details.general.type': 'النوع',
  'aris.details.general.defaultSymbol': 'الرمز الافتراضي',
  'aris.details.general.linkedModels': 'النماذج المرتبطة',
  'aris.details.general.symbol': 'الرمز',
  'aris.details.general.position': 'الموضع',
  'aris.details.general.size': 'الحجم',
  'aris.details.general.modelType': 'نوع النموذج',
  'aris.details.general.occurrences': 'الظهورات',
  'aris.details.general.connections': 'العلاقات',
  'aris.details.general.satellites': 'الكائنات التابعة',
  'aris.details.general.displayName': 'اسم العرض',
  'aris.details.general.blobs': 'عناصر Blob',
  'aris.details.names.definition': 'اسم التعريف',
  'aris.details.names.inherited': 'الاسم الموروث',
  'aris.details.names.model': 'اسم النموذج',
  'aris.details.attributes.attr': 'السمة',
  'aris.details.attributes.occurrence': 'ظهور السمة',
  'aris.details.ids.definitionId': 'معرّف التعريف',
  'aris.details.ids.occurrenceId': 'معرّف الظهور',
  'aris.details.ids.modelId': 'معرّف النموذج',
  'aris.details.ids.oleDefinitionId': 'معرّف تعريف OLE',
  'aris.details.ids.oleOccurrenceId': 'معرّف ظهور OLE',
  'aris.details.relations.category': 'فئة العلاقة',
  'aris.details.relations.connectionType': 'نوع العلاقة',
  'aris.details.relations.owner': 'الظهور المالك',
  'aris.details.assignments.model': 'النموذج المُسنَد',
  'aris.details.assignments.none': 'لا يوجد نموذج مُسنَد',
  'aris.details.attachments.item': 'مرفق',
  'aris.details.attachments.none': 'لا توجد مرفقات',
  'aris.details.attachments.blobs': 'عدد عناصر Blob',
  'aris.details.accounting.occurrences': 'الظهورات',
  'aris.details.accounting.connections': 'العلاقات',
  'aris.details.accounting.satellites': 'الكائنات التابعة',
  'aris.details.accounting.attachments': 'المرفقات',
  'aris.details.accounting.unsupported': 'محتوى غير مدعوم',
  'aris.details.fidelity.symbolFallbacks': 'بدائل الرموز',
  'aris.details.fidelity.oleUnsupported': 'كائنات OLE غير مدعومة',
  'aris.details.history.revision': 'النسخة',
  'aris.details.history.definitionId': 'معرّف التعريف'
}

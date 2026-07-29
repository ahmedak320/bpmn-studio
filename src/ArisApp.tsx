import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ArisAssistantDrawer } from './ArisAssistantDrawer'
import { ArisGenerationPanel } from './ArisGenerationPanel'
import { ICON_DATA_URI } from './branding/icon'
import { ProcessTabList, processTabId, processTabPanelId } from './common/ProcessTabList'
import { PaneResizer, usePaneWidth } from './common/PaneResizer'
import {
  classifyPickerError,
  directoryPickerSupported,
  ensurePermission,
  loadRememberedWorkspace,
  pickWorkspace,
  rememberWorkspace
} from './fs/workspaceHandle'
import { t } from './i18n'
import { setLang, useLang } from './i18n/useLang'
import { SettingsDialogLite } from './settings/SettingsDialogLite'
import { ResponsiveDrawer, ResponsiveShell, useResponsiveShellMode } from './shell'
import { Toaster, type ToastMsg, type ToastTone } from './workspace/Toaster'
import { WorkspacePickerLite, type PickerMode } from './workspace/WorkspacePickerLite'
import {
  type FileSnapshot,
  type WorkspaceAdapter,
  type WorkspaceEntry,
  type WorkspaceMode
} from './workspace/adapters/types'
import { DirectoryWorkspaceAdapter } from './workspace/adapters/directory'
import { sha256Hex } from './workspace/adapters/hash'
import { OpfsWorkspaceAdapter, opfsSupported } from './workspace/adapters/opfs'
import { SingleFileWorkspaceAdapter } from './workspace/adapters/singleFile'
import { classifyImportBoundarySource } from './workspace/importDrop'
import { createArisXmlSourcePackage, type ArisXmlSourcePackage } from './aris/source/sourcePackage'
import {
  ArisImportReviewDialog,
  ArisModelExplorer,
  ArisStudioTab,
  AssistantIndexCache,
  buildArisAssistantDigests,
  buildArisStudioDocument,
  commitArisWorkspaceImport,
  prepareArisWorkspaceImport,
  tk,
  type ArisPreparedImport,
  type ArisSelectionRequest,
  type ArisSourceFact,
  type ArisStudioDocument
} from './aris/shell'
import type { ArisAnswerChip } from './aris/assistant/answer'

type Phase = 'loading' | 'need-open' | 'need-reconnect' | 'ready'

type ArisSourceKind = 'aml' | 'apc' | 'xml' | 'generated'

interface ArisTab {
  key: string
  title: string
  relPath: string | null
  sourceKind: ArisSourceKind
  content: string
  bytes: Uint8Array
  sha256: string
  mimeType?: string
  rootElementName?: string | null
  xmlTokenCount?: number
  xmlNodeCount?: number
  doctypeExternalId?: string | null
  modelCount?: number
  objectDefinitionCount?: number
  objectOccurrenceCount?: number
  connectionDefinitionCount?: number
  connectionOccurrenceCount?: number
  attributeCount?: number
  diagnosticCount?: number
  unknownRecordCount?: number
  /**
   * The lossless source package this tab was opened from. Kept so an import
   * into the workspace package store re-uses the exact imported bytes and the
   * exact semantic index that produced the on-canvas document — §7.3 refuses to
   * stage a source that was not parsed and indexed.
   */
  pkg?: ArisXmlSourcePackage
  /**
   * Everything the mounted shell renders: working document, render/fidelity
   * report, details projection and complete source accounting. `undefined` for
   * a source with no ARIS records (an empty AML shell or a generated draft).
   */
  studio?: ArisStudioDocument
}

function pushSortedSources(entries: readonly WorkspaceEntry[]): WorkspaceEntry[] {
  return [...entries].sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

function isVisibleWorkspaceSource(entry: WorkspaceEntry): boolean {
  return (
    entry.kind === 'file' &&
    /\.(?:aml|apc|xml|bpmn)$/iu.test(entry.name) &&
    !entry.path.startsWith('.orbitpm/')
  )
}

function inferSourceKind(name: string, generated = false): ArisSourceKind {
  if (generated) return 'generated'
  if (/\.aml$/iu.test(name)) return 'aml'
  if (/\.apc$/iu.test(name)) return 'apc'
  return 'xml'
}

function sourceKindLabel(kind: ArisSourceKind): string {
  return t(`aris.sourceKind.${kind}`)
}

function rootLabel(mode: WorkspaceMode, adapter: WorkspaceAdapter | null): string {
  if (mode === 'directory') return adapter?.id.replace(/^directory:/u, '') ?? t('breadcrumb.root')
  if (mode === 'opfs') return t('workspace.storage.mode.opfs')
  return t('workspace.storage.mode.singleFile')
}

export function downloadBytes(
  fileName: string,
  bytes: Uint8Array,
  mimeType = 'application/xml'
): void {
  // `bytes` is typed `Uint8Array` without a pinned buffer type parameter, so
  // TS 5.7's stricter `BlobPart` (which requires an `ArrayBuffer`-backed
  // view, not the wider `ArrayBufferLike` that also covers
  // `SharedArrayBuffer`) rejects it directly. `.slice()` with no arguments
  // copies the full byte range into a fresh, always-`ArrayBuffer`-backed
  // `Uint8Array` — same bytes, same length, and a type Blob accepts without
  // a cast.
  const blob = new Blob([bytes.slice()], { type: mimeType })
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.style.display = 'none'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}

function snapshotToTab(snapshot: FileSnapshot, text: string): ArisTab {
  return {
    key: `source:${snapshot.path}`,
    title: snapshot.path.split('/').pop() ?? snapshot.path,
    relPath: snapshot.path,
    sourceKind: inferSourceKind(snapshot.path),
    content: text,
    bytes: snapshot.bytes,
    sha256: snapshot.hash,
    mimeType: snapshot.mimeType,
    rootElementName: null,
    xmlTokenCount: undefined,
    xmlNodeCount: undefined,
    doctypeExternalId: null,
    modelCount: undefined,
    objectDefinitionCount: undefined,
    objectOccurrenceCount: undefined,
    connectionDefinitionCount: undefined,
    connectionOccurrenceCount: undefined,
    attributeCount: undefined,
    diagnosticCount: undefined,
    unknownRecordCount: undefined
  }
}

function generatedToTab(name: string, xml: string, bytes: Uint8Array, sha256: string): ArisTab {
  return {
    key: `generated:${sha256}`,
    title: name.trim() || t('aris.generated.fallbackName'),
    relPath: null,
    sourceKind: 'generated',
    content: xml,
    bytes,
    sha256,
    mimeType: 'application/xml'
  }
}

function upsertTab(current: readonly ArisTab[], next: ArisTab): ArisTab[] {
  const index = current.findIndex((candidate) => candidate.key === next.key)
  if (index === -1) return [...current, next]
  const copy = [...current]
  copy[index] = next
  return copy
}

function pickerErrorMessage(code: ReturnType<typeof classifyPickerError>): string {
  switch (code) {
    case 'security':
      return t('alert.picker.security')
    case 'not-allowed':
      return t('alert.picker.notAllowed')
    default:
      return t('alert.picker.unknown')
  }
}

/**
 * The imported-source facts the details rail shows above the accounting rail.
 * These are the counts the Phase 2 shell already surfaced; they stay because
 * they describe the *source*, which the canvas deliberately does not.
 */
function sourceFactsFor(tab: ArisTab): readonly ArisSourceFact[] {
  const unknown = t('aris.assistant.none')
  return [
    { labelKey: 'aris.placeholder.sourceKind', value: sourceKindLabel(tab.sourceKind) },
    { labelKey: 'aris.placeholder.sourcePath', value: tab.relPath ?? t('aris.source.virtual') },
    { labelKey: 'aris.placeholder.sourceBytes', value: tab.bytes.byteLength },
    { labelKey: 'aris.placeholder.rootElement', value: tab.rootElementName ?? unknown },
    { labelKey: 'aris.placeholder.sourceTokens', value: tab.xmlTokenCount ?? unknown },
    { labelKey: 'aris.placeholder.sourceNodes', value: tab.xmlNodeCount ?? unknown },
    { labelKey: 'aris.placeholder.sourceDoctype', value: tab.doctypeExternalId ?? unknown },
    { labelKey: 'aris.placeholder.modelCount', value: tab.modelCount ?? unknown },
    {
      labelKey: 'aris.placeholder.objectDefinitionCount',
      value: tab.objectDefinitionCount ?? unknown
    },
    {
      labelKey: 'aris.placeholder.objectOccurrenceCount',
      value: tab.objectOccurrenceCount ?? unknown
    },
    {
      labelKey: 'aris.placeholder.connectionDefinitionCount',
      value: tab.connectionDefinitionCount ?? unknown
    },
    {
      labelKey: 'aris.placeholder.connectionOccurrenceCount',
      value: tab.connectionOccurrenceCount ?? unknown
    },
    { labelKey: 'aris.placeholder.attributeCount', value: tab.attributeCount ?? unknown },
    { labelKey: 'aris.placeholder.semanticDiagnostics', value: tab.diagnosticCount ?? unknown },
    { labelKey: 'aris.placeholder.unknownRecordCount', value: tab.unknownRecordCount ?? unknown },
    { labelKey: 'aris.placeholder.sourceDigest', value: tab.sha256 }
  ]
}

export default function ArisApp(): JSX.Element {
  const lang = useLang()
  const dir: 'ltr' | 'rtl' = lang === 'ar' ? 'rtl' : 'ltr'
  const responsiveMode = useResponsiveShellMode()
  const [sidebarWidth, setSidebarWidth, resetSidebarWidth] = usePaneWidth(
    'orbitpm-aris-shell.sidebar-width',
    { min: 240, max: 520 }
  )
  const [phase, setPhase] = useState<Phase>('loading')
  const [mode, setMode] = useState<WorkspaceMode>('single-file')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [explorerOpen, setExplorerOpen] = useState(true)
  // Neither ARIS-shell AI surface (ArisGenerationPanel, ArisAssistantDrawer)
  // takes a `keysVersion` prop yet — unlike their legacy App.tsx counterparts
  // (AiPanelLite, AssistantDrawer), which remount on it to re-check provider
  // credentials after Settings changes. The setter is still wired below so
  // that behavior is a one-line prop addition once those Phase-2 placeholder
  // surfaces grow real provider-dependent rendering; the read side has no
  // consumer today, hence the leading underscore.
  const [_keysVersion, setKeysVersion] = useState(0)
  const [workspaceAdapter, setWorkspaceAdapter] = useState<WorkspaceAdapter | null>(null)
  const [workspaceSources, setWorkspaceSources] = useState<WorkspaceEntry[]>([])
  const [tabs, setTabs] = useState<ArisTab[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [rememberedName, setRememberedName] = useState<string | undefined>(undefined)
  const [toasts, setToasts] = useState<ToastMsg<string>[]>([])
  /** Which model each open source is showing. Keyed by tab key. */
  const [activeModelByTab, setActiveModelByTab] = useState<Record<string, string>>({})
  const [preparedImport, setPreparedImport] = useState<ArisPreparedImport | null>(null)
  /** The §17.6 chip request the active tab must honour, if any. */
  const [selectionRequest, setSelectionRequest] = useState<ArisSelectionRequest | null>(null)
  const selectionTokenRef = useRef(0)
  // §17.2: one cache for the session, so an unchanged model keeps its digest.
  const assistantIndexRef = useRef(new AssistantIndexCache())
  const [importBusy, setImportBusy] = useState(false)
  const openFileInputRef = useRef<HTMLInputElement | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const rememberedHandleRef = useRef<FileSystemDirectoryHandle | null>(null)

  const directoryAvailable = directoryPickerSupported()
  const opfsAvailable = opfsSupported()
  const pickerMode: PickerMode =
    phase === 'need-reconnect' ? 'reconnect' : directoryAvailable ? 'open' : 'fallback'

  const activeTab = useMemo(
    () => tabs.find((candidate) => candidate.key === activeKey) ?? null,
    [activeKey, tabs]
  )

  /**
   * The model a tab shows: the user's explicit pick when it is still valid,
   * otherwise the first model the canvas can actually render.
   */
  const activeModelIdForTab = useCallback(
    (tab: ArisTab): string | null => {
      const chosen = activeModelByTab[tab.key]
      if (chosen && tab.studio?.models.some((model) => model.id === chosen)) return chosen
      return (
        tab.studio?.models.find((model) => model.renderable)?.id ??
        tab.studio?.models[0]?.id ??
        null
      )
    },
    [activeModelByTab]
  )

  const pushToast = useCallback((message: string, tone: ToastTone = 'info') => {
    const id =
      typeof crypto?.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setToasts((current) => [...current, { id, text: message, tone }])
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const refreshWorkspaceSources = useCallback(async (adapter: WorkspaceAdapter) => {
    if (!adapter.storage.capabilities.multipleFiles) {
      setWorkspaceSources(await adapter.list())
      return
    }
    const listed = await adapter.list('', { maxEntries: 2_500, maxDepth: 32 })
    setWorkspaceSources(pushSortedSources(listed.filter(isVisibleWorkspaceSource)))
  }, [])

  const activateAdapter = useCallback(
    async (adapter: WorkspaceAdapter) => {
      setWorkspaceAdapter(adapter)
      setMode(adapter.mode)
      await refreshWorkspaceSources(adapter)
      setPhase('ready')
      setError(null)
      setExplorerOpen(true)
    },
    [refreshWorkspaceSources]
  )

  const openTab = useCallback((tab: ArisTab) => {
    setTabs((current) => upsertTab(current, tab))
    setActiveKey(tab.key)
  }, [])

  const openImportedBytes = useCallback(
    async (name: string, relPath: string | null, bytes: Uint8Array, mimeType?: string) => {
      const sourcePackage = await createArisXmlSourcePackage({
        name,
        relPath,
        bytes,
        mimeType
      })
      const text = sourcePackage.text
      if (classifyImportBoundarySource(name, text) === 'reject-bpmn') {
        pushToast(t('toast.import.arisOnly'))
        return false
      }
      // Only past the BPMN boundary do we build the working document, render
      // model, details projection and accounting report: a rejected file must
      // cost the workspace nothing at all.
      const studio = buildArisStudioDocument(sourcePackage)
      const shellFields = { pkg: sourcePackage, studio }
      openTab(
        relPath
          ? {
              ...shellFields,
              ...snapshotToTab(
                {
                  path: relPath,
                  bytes,
                  hash: sourcePackage.sha256,
                  size: bytes.byteLength,
                  modifiedAt: 0,
                  mimeType
                },
                text
              ),
              rootElementName: sourcePackage.document.rootElementName,
              xmlTokenCount: sourcePackage.document.tokens.length,
              xmlNodeCount: sourcePackage.document.nodeCount,
              doctypeExternalId: sourcePackage.document.doctype?.externalIdLiteral ?? null,
              modelCount: sourcePackage.index.models.size,
              objectDefinitionCount: sourcePackage.index.objectDefinitions.size,
              objectOccurrenceCount: sourcePackage.index.objectOccurrences.size,
              connectionDefinitionCount: sourcePackage.index.connectionDefinitions.size,
              connectionOccurrenceCount: sourcePackage.index.connectionOccurrences.size,
              attributeCount: sourcePackage.index.attributes.length,
              diagnosticCount: sourcePackage.diagnostics.length,
              unknownRecordCount: sourcePackage.index.unknownRecords.length
            }
          : {
              ...shellFields,
              key: `source:${name}:${sourcePackage.sha256}`,
              title: name,
              relPath: null,
              sourceKind: inferSourceKind(name),
              content: text,
              bytes,
              sha256: sourcePackage.sha256,
              mimeType,
              rootElementName: sourcePackage.document.rootElementName,
              xmlTokenCount: sourcePackage.document.tokens.length,
              xmlNodeCount: sourcePackage.document.nodeCount,
              doctypeExternalId: sourcePackage.document.doctype?.externalIdLiteral ?? null,
              modelCount: sourcePackage.index.models.size,
              objectDefinitionCount: sourcePackage.index.objectDefinitions.size,
              objectOccurrenceCount: sourcePackage.index.objectOccurrences.size,
              connectionDefinitionCount: sourcePackage.index.connectionDefinitions.size,
              connectionOccurrenceCount: sourcePackage.index.connectionOccurrences.size,
              attributeCount: sourcePackage.index.attributes.length,
              diagnosticCount: sourcePackage.diagnostics.length,
              unknownRecordCount: sourcePackage.index.unknownRecords.length
            }
      )
      return true
    },
    [openTab, pushToast]
  )

  const handleOpenWorkspaceFile = useCallback(
    async (path: string) => {
      const adapter = workspaceAdapter
      if (!adapter) return
      try {
        const snapshot = await adapter.read(path)
        await openImportedBytes(
          path.split('/').pop() ?? path,
          path,
          snapshot.bytes,
          snapshot.mimeType
        )
      } catch (openError) {
        pushToast(String(openError), 'error')
      }
    },
    [openImportedBytes, pushToast, workspaceAdapter]
  )

  const handleOpenFolder = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const handle =
        phase === 'need-reconnect' && rememberedHandleRef.current
          ? rememberedHandleRef.current
          : await pickWorkspace()
      if (!handle) return
      const permission = await ensurePermission(handle, true)
      if (permission !== 'granted') {
        setError(t('alert.permissionNotGranted.open'))
        return
      }
      await rememberWorkspace(handle)
      rememberedHandleRef.current = handle
      setRememberedName(handle.name)
      await activateAdapter(
        new DirectoryWorkspaceAdapter(handle, {
          workspaceId: `directory:${encodeURIComponent(handle.name)}`
        })
      )
    } catch (openError) {
      setError(
        openError instanceof Error
          ? pickerErrorMessage(classifyPickerError(openError))
          : t('alert.picker.unknown')
      )
    } finally {
      setBusy(false)
    }
  }, [activateAdapter, phase])

  const handleOpenDifferent = useCallback(async () => {
    rememberedHandleRef.current = null
    setRememberedName(undefined)
    await handleOpenFolder()
  }, [handleOpenFolder])

  const handleOpenOpfs = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const adapter = await OpfsWorkspaceAdapter.open({ requestPersistence: true })
      await activateAdapter(adapter)
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : t('alert.picker.unknown'))
    } finally {
      setBusy(false)
    }
  }, [activateAdapter])

  const handleOpenPickedFile = useCallback(
    async (file: File) => {
      const adapter = await SingleFileWorkspaceAdapter.fromFile(file)
      await activateAdapter(adapter)
      const bytes = new Uint8Array(await file.arrayBuffer())
      await openImportedBytes(file.name, file.name, bytes, file.type || undefined)
    },
    [activateAdapter, openImportedBytes]
  )

  const handleOpenFileInput = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const [file] = Array.from(event.target.files ?? [])
      event.target.value = ''
      if (!file) return
      setBusy(true)
      setError(null)
      try {
        if (phase === 'ready') {
          const bytes = new Uint8Array(await file.arrayBuffer())
          await openImportedBytes(file.name, null, bytes, file.type || undefined)
        } else {
          await handleOpenPickedFile(file)
        }
      } catch (openError) {
        setError(openError instanceof Error ? openError.message : String(openError))
      } finally {
        setBusy(false)
      }
    },
    [handleOpenPickedFile, openImportedBytes, phase]
  )

  const handleImportInput = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? [])
      event.target.value = ''
      if (files.length === 0) return
      setBusy(true)
      try {
        for (const file of files) {
          const bytes = new Uint8Array(await file.arrayBuffer())
          await openImportedBytes(file.name, null, bytes, file.type || undefined)
        }
      } finally {
        setBusy(false)
      }
    },
    [openImportedBytes]
  )

  /**
   * Open a generated AML document (AI draft or workbook) as a real source tab.
   *
   * The bytes go through the SAME lossless pipeline an imported file does, so a
   * created model gets the same canvas, the same details rail and the same
   * complete source accounting — there is no second, weaker path for generated
   * content.
   */
  const handleCreateModel = useCallback(
    async ({ name, xml }: { name: string; xml: string }) => {
      const bytes = new TextEncoder().encode(xml)
      const hash = await sha256Hex(bytes)
      const sourcePackage = await createArisXmlSourcePackage({
        name: `${name || 'draft'}.aml`,
        relPath: null,
        bytes
      })
      openTab({
        ...generatedToTab(name, xml, bytes, hash),
        pkg: sourcePackage,
        studio: buildArisStudioDocument(sourcePackage)
      })
    },
    [openTab]
  )

  const handleSelectModel = useCallback((tabKey: string, modelId: string) => {
    setActiveModelByTab((current) =>
      current[tabKey] === modelId ? current : { ...current, [tabKey]: modelId }
    )
  }, [])

  /**
   * The §17.2 assistant index over every open source.
   *
   * Only opened sources are indexed: a workspace listing gives a path, not the
   * parsed models a digest needs, and re-reading every file on every render is
   * not something a folder assistant may do silently. Opening a source adds it.
   */
  const assistantDigests = useMemo(
    () =>
      buildArisAssistantDigests(
        tabs
          .filter(
            (tab): tab is ArisTab & { studio: ArisStudioDocument } => tab.studio !== undefined
          )
          .map((tab) => ({
            // A source with no workspace path still needs an indexable name:
            // directory mode filters on the AML/XML extension.
            relPath: tab.relPath ?? `${tab.title}.aml`,
            document: tab.studio.source,
            sourceDigest: tab.sha256
          })),
        assistantIndexRef.current,
        mode === 'directory' ? 'directory' : mode === 'opfs' ? 'portable' : 'single-file'
      ),
    [mode, tabs]
  )

  /** §17.6: a chip selects the exact ARIS element it names. */
  const handleOpenChip = useCallback(
    (chip: ArisAnswerChip): boolean => {
      const owner = tabs.find(
        (tab) => (tab.relPath ?? `${tab.title}.aml`) === chip.relPath && tab.studio?.models.length
      )
      if (!owner) return false
      setActiveKey(owner.key)
      if (chip.modelId) handleSelectModel(owner.key, chip.modelId)
      const elementId = chip.occurrenceId ?? chip.modelId
      if (!elementId) return false
      selectionTokenRef.current += 1
      setSelectionRequest({
        token: selectionTokenRef.current,
        modelId: chip.modelId,
        elementId
      })
      setAssistantOpen(false)
      return true
    },
    [handleSelectModel, tabs]
  )

  /** §7.3 phase one: stage every write in memory and open the review gate. */
  const handlePrepareImport = useCallback(
    async (tab: ArisTab) => {
      const adapter = workspaceAdapter
      if (!adapter || !tab.pkg || !tab.studio) return
      setImportBusy(true)
      try {
        setPreparedImport(await prepareArisWorkspaceImport(adapter, tab.pkg, tab.studio))
      } catch (importError) {
        pushToast(
          tk('aris.import.failed', 'The import could not be prepared: {error}', {
            error: importError instanceof Error ? importError.message : String(importError)
          }),
          'error'
        )
      } finally {
        setImportBusy(false)
      }
    },
    [pushToast, workspaceAdapter]
  )

  /** §7.3 phase two: echo the reviewed digest, commit atomically, then flush. */
  const handleConfirmImport = useCallback(async () => {
    const prepared = preparedImport
    if (!prepared) return
    setImportBusy(true)
    try {
      const { outcome, flush } = await commitArisWorkspaceImport(prepared)
      if (outcome.status === 'rolled-back' || outcome.status === 'rollback-failed') {
        pushToast(
          tk('aris.import.rolledBack', 'The import failed and was rolled back: {error}', {
            error: outcome.error.message
          }),
          'error'
        )
        return
      }
      // A committed package that could not be flushed is NOT a successful
      // import: in portable mode the container file still holds its old bytes.
      if (flush.status === 'failed') {
        pushToast(
          tk(
            'aris.import.flushFailed',
            'The workspace package was written but the file save failed: {error}',
            { error: flush.message }
          ),
          'error'
        )
        return
      }
      const sourceName = prepared.plan.review.sourceName
      pushToast(
        outcome.status === 'deduplicated'
          ? tk(
              'aris.import.deduplicated',
              'That exact source is already stored; nothing was written.'
            )
          : flush.status === 'flushed' && flush.disposition === 'download'
            ? tk(
                'aris.import.downloaded',
                'Imported {name}; the portable workspace container was downloaded rather than written in place.',
                { name: sourceName }
              )
            : tk('aris.import.committed', 'Imported {name} into the workspace package store.', {
                name: sourceName
              }),
        'success'
      )
      if (workspaceAdapter) await refreshWorkspaceSources(workspaceAdapter)
    } catch (commitError) {
      pushToast(
        tk('aris.import.failed', 'The import could not be prepared: {error}', {
          error: commitError instanceof Error ? commitError.message : String(commitError)
        }),
        'error'
      )
    } finally {
      setImportBusy(false)
      setPreparedImport(null)
    }
  }, [preparedImport, pushToast, refreshWorkspaceSources, workspaceAdapter])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const remembered = directoryAvailable ? await loadRememberedWorkspace() : undefined
        if (!active) return
        if (remembered) {
          rememberedHandleRef.current = remembered
          setRememberedName(remembered.name)
          const permission = await ensurePermission(remembered, false)
          if (!active) return
          if (permission === 'granted') {
            await activateAdapter(
              new DirectoryWorkspaceAdapter(remembered, {
                workspaceId: `directory:${encodeURIComponent(remembered.name)}`
              })
            )
            return
          }
          setPhase('need-reconnect')
          return
        }
        setPhase('need-open')
      } catch {
        if (!active) return
        setPhase('need-open')
      }
    })()
    return () => {
      active = false
    }
  }, [activateAdapter, directoryAvailable])

  if (phase !== 'ready') {
    return (
      <>
        <input
          ref={openFileInputRef}
          type="file"
          hidden
          accept=".bpmn,.aml,.apc,.xml,application/xml,text/xml"
          onChange={handleOpenFileInput}
        />
        <WorkspacePickerLite
          mode={pickerMode}
          rememberedName={rememberedName}
          busy={busy}
          error={error}
          directoryAvailable={directoryAvailable}
          opfsAvailable={opfsAvailable}
          onOpenFolder={() => void handleOpenFolder()}
          onOpenDifferent={() => void handleOpenDifferent()}
          onOpenOpfs={() => void handleOpenOpfs()}
          onOpenFile={() => openFileInputRef.current?.click()}
          onNewDiagram={() => pushToast(t('aris.placeholder.newDiagramUnavailable'))}
          onNewProcess={() => pushToast(t('aris.placeholder.newProcessUnavailable'))}
        />
        <SettingsDialogLite
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onKeysChanged={() => setKeysVersion((current) => current + 1)}
        />
        <ArisAssistantDrawer
          open={assistantOpen}
          onClose={() => setAssistantOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
          workspaceLabel={rememberedName ?? rootLabel(mode, workspaceAdapter)}
          sourceCount={workspaceSources.length}
          openTabCount={tabs.length}
          activeTabTitle={activeTab?.title ?? null}
          activeSourceKindLabel={activeTab ? sourceKindLabel(activeTab.sourceKind) : null}
          digests={assistantDigests}
          onOpenChip={handleOpenChip}
        />
        <Toaster toasts={toasts} onDismiss={dismissToast} />
      </>
    )
  }

  const storageModeLabel = t(
    mode === 'directory'
      ? 'workspace.storage.mode.directory'
      : mode === 'opfs'
        ? 'workspace.storage.mode.opfs'
        : 'workspace.storage.mode.singleFile'
  )

  return (
    <>
      <input
        ref={openFileInputRef}
        type="file"
        hidden
        accept=".bpmn,.aml,.apc,.xml,application/xml,text/xml"
        onChange={handleOpenFileInput}
      />
      <input
        ref={importInputRef}
        type="file"
        hidden
        multiple
        accept=".bpmn,.aml,.apc,.xml,application/xml,text/xml"
        onChange={handleImportInput}
      />
      <ResponsiveShell direction={dir} mode={responsiveMode} className="orbitpm-workspace-shell">
        <header className="orbitpm-workspace-header">
          <span className="orbitpm-workspace-header__identity">
            <img src={ICON_DATA_URI} width={20} height={20} alt="" style={{ borderRadius: 5 }} />
            <strong style={{ fontSize: 13 }}>{t('app.title')}</strong>
            <span style={{ fontSize: 11, opacity: 0.65 }}>{storageModeLabel}</span>
          </span>
          <div className="orbitpm-workspace-header__actions">
            {responsiveMode !== 'docked' && (
              <button
                type="button"
                className="orbitpm-lite-chrome-btn orbitpm-workspace-header__explorer"
                onClick={() => setExplorerOpen((current) => !current)}
                aria-label={t('sidebar.toggle.aria')}
                aria-expanded={explorerOpen}
                aria-controls="orbitpm-aris-explorer"
              >
                <span aria-hidden="true">☰</span>
              </button>
            )}
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              onClick={() => setAssistantOpen(true)}
            >
              {t('aris.header.assistant')}
            </button>
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              onClick={() => setSettingsOpen(true)}
            >
              {t('app.settings')}
            </button>
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              onClick={() => {
                setLang(lang === 'en' ? 'ar' : 'en')
              }}
            >
              {t('app.lang.control', {
                language: lang === 'en' ? t('app.lang.ar') : t('app.lang.en')
              })}
            </button>
          </div>
        </header>

        <div className="orbitpm-workspace-body">
          <ResponsiveDrawer
            id="orbitpm-aris-explorer"
            className="orbitpm-workspace-explorer"
            open={explorerOpen}
            mode={responsiveMode}
            side="inline-start"
            label={t('aris.explorer.aria')}
            direction={dir}
            onClose={() => setExplorerOpen(false)}
            inlineSize={sidebarWidth ?? 'clamp(240px, 24vw, 320px)'}
            keepMounted
          >
            <div className="orbitpm-workspace-explorer__content">
              <div
                style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '0.5rem 0' }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    padding: '0 0.6rem 0.5rem',
                    marginBottom: 6,
                    borderBottom: '1px solid var(--orbitpm-border)',
                    flexWrap: 'wrap'
                  }}
                >
                  <button
                    type="button"
                    className="orbitpm-lite-chrome-btn"
                    onClick={() => importInputRef.current?.click()}
                  >
                    {t('app.import')}
                  </button>
                  <button
                    type="button"
                    className="orbitpm-lite-chrome-btn"
                    onClick={() => openFileInputRef.current?.click()}
                  >
                    {t('aris.header.openFile')}
                  </button>
                  {directoryAvailable && (
                    <button
                      type="button"
                      className="orbitpm-lite-chrome-btn"
                      onClick={() => void handleOpenDifferent()}
                    >
                      {t('app.changeFolder')}
                    </button>
                  )}
                </div>

                {activeTab?.studio && (
                  <ArisModelExplorer
                    sourceTitle={activeTab.title}
                    models={activeTab.studio.models}
                    activeModelId={activeModelIdForTab(activeTab)}
                    lang={lang}
                    onSelect={(modelId) => handleSelectModel(activeTab.key, modelId)}
                  />
                )}

                {workspaceSources.length === 0 ? (
                  <div
                    style={{
                      padding: '0.8rem',
                      color: 'var(--orbitpm-muted)',
                      fontSize: 13,
                      lineHeight: 1.5
                    }}
                  >
                    {t('aris.explorer.empty')}
                  </div>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: '0 0.4rem 0.8rem' }}>
                    {workspaceSources.map((entry) => {
                      const unsupported = /\.bpmn$/iu.test(entry.name)
                      const isActive = tabs.some((tab) => tab.relPath === entry.path)
                      return (
                        <li key={entry.path}>
                          <button
                            type="button"
                            className="orbitpm-lite-chrome-btn"
                            style={{
                              width: '100%',
                              justifyContent: 'space-between',
                              textAlign: 'start',
                              marginBottom: 6,
                              opacity: unsupported ? 0.7 : 1,
                              borderColor: isActive
                                ? 'var(--orbitpm-primary-bg)'
                                : 'var(--orbitpm-border)'
                            }}
                            onClick={() =>
                              unsupported
                                ? pushToast(t('toast.import.arisOnly'))
                                : void handleOpenWorkspaceFile(entry.path)
                            }
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {entry.path}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--orbitpm-muted)' }}>
                              {unsupported
                                ? t('aris.explorer.unsupportedBpmn')
                                : sourceKindLabel(inferSourceKind(entry.name))}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              <button
                type="button"
                onClick={() => setAssistantOpen(true)}
                aria-expanded={assistantOpen}
                title={t('ai.header')}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.8rem',
                  borderTop: '1px solid var(--orbitpm-border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'transparent',
                  color: 'inherit',
                  font: 'inherit',
                  cursor: 'pointer'
                }}
              >
                <strong>{t('ai.header')}</strong>
                <span aria-hidden>{assistantOpen ? '▾' : dir === 'rtl' ? '◂' : '▸'}</span>
              </button>
              <div style={{ flex: '0 1 auto', maxHeight: '55%', overflowY: 'auto' }}>
                <ArisGenerationPanel
                  embedded
                  onCreateModel={handleCreateModel}
                  onDownloadFile={(fileName, bytes, mimeType) =>
                    downloadBytes(fileName, bytes, mimeType)
                  }
                  onOpenAssistant={() => setAssistantOpen(true)}
                  onOpenSettings={() => setSettingsOpen(true)}
                />
              </div>
            </div>
          </ResponsiveDrawer>

          {explorerOpen && responsiveMode === 'docked' && (
            <PaneResizer
              edge="inline-end"
              dir={dir}
              width={sidebarWidth ?? 320}
              min={240}
              max={560}
              onWidthChange={setSidebarWidth}
              onReset={resetSidebarWidth}
              ariaLabel={t('aris.pane.resize.sidebar.aria')}
            />
          )}

          <button
            type="button"
            className="orbitpm-lite-rail"
            onClick={() => setExplorerOpen((current) => !current)}
            aria-label={t('sidebar.toggle.aria')}
            aria-expanded={explorerOpen}
            aria-controls="orbitpm-aris-explorer"
          >
            <span aria-hidden>
              {lang === 'ar' ? (explorerOpen ? '⟩' : '⟨') : explorerOpen ? '⟨' : '⟩'}
            </span>
          </button>

          <main
            id="orbitpm-process-workspace"
            aria-label={t('aris.main.aria')}
            className="orbitpm-workspace-main"
            style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}
          >
            <ProcessTabList
              tabs={tabs.map((tab) => ({
                key: tab.key,
                title: tab.title
              }))}
              activeKey={activeKey}
              dirtyKeys={new Set()}
              dir={dir}
              ariaLabel={t('aris.tab.list.aria')}
              closeTitle={t('aris.tab.closeTitle')}
              dirtyLabel={t('tab.dirty.aria')}
              onActivate={setActiveKey}
              onClose={(key) => {
                let nextActiveKey: string | null = null
                setTabs((current) => {
                  const closingIndex = current.findIndex((tab) => tab.key === key)
                  const remaining = current.filter((tab) => tab.key !== key)
                  if (remaining.length === 0) {
                    nextActiveKey = null
                  } else if (closingIndex === -1) {
                    nextActiveKey = remaining[0]?.key ?? null
                  } else {
                    nextActiveKey =
                      remaining[Math.min(closingIndex, remaining.length - 1)]?.key ??
                      remaining[0]?.key ??
                      null
                  }
                  return remaining
                })
                setActiveKey((current) => (current === key ? nextActiveKey : current))
                return true
              }}
              onEmptyFocus={() => undefined}
            />

            <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
              {tabs.length === 0 ? (
                <div style={{ padding: '1.5rem', opacity: 0.7, lineHeight: 1.6 }}>
                  {t('aris.emptyMain')}
                </div>
              ) : (
                tabs.map((tab) => {
                  const isActive = activeKey === tab.key
                  return (
                    <div
                      key={tab.key}
                      id={processTabPanelId(tab.key)}
                      role="tabpanel"
                      aria-labelledby={processTabId(tab.key)}
                      tabIndex={isActive ? 0 : -1}
                      hidden={!isActive}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: isActive ? 'block' : 'none',
                        minHeight: 0
                      }}
                    >
                      {tab.studio ? (
                        <ArisStudioTab
                          title={tab.title}
                          studio={tab.studio}
                          modelId={activeModelIdForTab(tab)}
                          active={isActive}
                          lang={lang}
                          sourceFacts={sourceFactsFor(tab)}
                          sourceText={tab.content}
                          canImport={workspaceAdapter !== null && tab.pkg !== undefined}
                          onModelChange={(modelId) => handleSelectModel(tab.key, modelId)}
                          onDownloadSource={() =>
                            downloadBytes(
                              tab.relPath?.split('/').pop() ?? `${tab.title}.xml`,
                              tab.bytes
                            )
                          }
                          onDownloadAttachment={(filename, bytes, mimeType) =>
                            downloadBytes(filename, bytes, mimeType)
                          }
                          onOpenAssistant={() => setAssistantOpen(true)}
                          onImportPackage={() => void handlePrepareImport(tab)}
                          onToast={(message, tone) => pushToast(message, tone ?? 'info')}
                          sourceFileName={tab.relPath?.split('/').pop() ?? `${tab.title}.aml`}
                          selectionRequest={isActive ? selectionRequest : null}
                          onSelectionResolved={(_token, revealed) => {
                            if (!revealed) pushToast(t('aris.assistant.none'))
                            setSelectionRequest(null)
                          }}
                        />
                      ) : (
                        <div style={{ padding: '1.5rem', opacity: 0.7, lineHeight: 1.6 }}>
                          {t('aris.emptyMain')}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </main>
        </div>

        <footer
          className="orbitpm-workspace-footer"
          style={{
            borderTop: '1px solid var(--orbitpm-border)',
            padding: '0.3rem 0.8rem',
            fontSize: 12,
            color: 'var(--orbitpm-muted)',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap'
          }}
        >
          <span>{rootLabel(mode, workspaceAdapter)}</span>
          <span>
            {t('aris.footer.summary', {
              files: workspaceSources.length,
              tabs: tabs.length
            })}
          </span>
        </footer>
      </ResponsiveShell>

      <SettingsDialogLite
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onKeysChanged={() => setKeysVersion((current) => current + 1)}
      />
      <ArisAssistantDrawer
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        onOpenSettings={() => setSettingsOpen(true)}
        onChangeWorkspace={directoryAvailable ? () => void handleOpenDifferent() : undefined}
        workspaceLabel={rootLabel(mode, workspaceAdapter)}
        sourceCount={workspaceSources.length}
        openTabCount={tabs.length}
        activeTabTitle={activeTab?.title ?? null}
        activeSourceKindLabel={activeTab ? sourceKindLabel(activeTab.sourceKind) : null}
        digests={assistantDigests}
        onOpenChip={handleOpenChip}
      />
      <ArisImportReviewDialog
        open={preparedImport !== null}
        plan={preparedImport?.plan ?? null}
        busy={importBusy}
        dir={dir}
        onConfirm={() => void handleConfirmImport()}
        onCancel={() => setPreparedImport(null)}
      />
      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </>
  )
}

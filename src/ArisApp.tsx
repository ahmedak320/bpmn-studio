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
  DirectoryWorkspaceAdapter,
  OpfsWorkspaceAdapter,
  SingleFileWorkspaceAdapter,
  opfsSupported,
  sha256Hex,
  type FileSnapshot,
  type WorkspaceAdapter,
  type WorkspaceEntry,
  type WorkspaceMode
} from './workspace/adapters'
import { classifyImportBoundarySource } from './workspace/importDrop'
import { decodeUtf8Strict } from './workspace/utf8'

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

function downloadBytes(fileName: string, bytes: Uint8Array, mimeType = 'application/xml'): void {
  const blob = new Blob([bytes], { type: mimeType })
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
    mimeType: snapshot.mimeType
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

function escapeXmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function buildGeneratedArisPlaceholderXml(name: string, description: string, lang: 'en' | 'ar'): string {
  const safeName = escapeXmlText(name.trim() || t('aris.generated.fallbackName'))
  const safeDescription = escapeXmlText(description.trim())
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<AML>',
    '  <Header-Info DatabaseName="OrbitPM" UserName="local-user" ArisExeVersion="100" />',
    `  <OrbitPM-Placeholder Type="GeneratedDraft" Lang="${lang}">`,
    `    <ModelName>${safeName}</ModelName>`,
    `    <Description>${safeDescription}</Description>`,
    '  </OrbitPM-Placeholder>',
    '</AML>'
  ].join('\n')
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

function ArisPlaceholderTab({
  tab,
  onDownloadSource,
  onOpenAssistant
}: {
  tab: ArisTab
  onDownloadSource: () => void
  onOpenAssistant: () => void
}): JSX.Element {
  return (
    <section
      aria-label={t('aris.placeholder.mainAria', { name: tab.title })}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 340px)',
        gap: 16,
        padding: '1rem',
        minHeight: 0,
        height: '100%'
      }}
    >
      <div
        style={{
          minWidth: 0,
          minHeight: 0,
          display: 'grid',
          gridTemplateRows: 'auto minmax(0, 1fr) auto',
          gap: 12
        }}
      >
        <header
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8
          }}
        >
          <strong style={{ fontSize: 16 }}>{tab.title}</strong>
          <span
            style={{
              padding: '0.2rem 0.55rem',
              borderRadius: 999,
              border: '1px solid var(--orbitpm-border)',
              fontSize: 12,
              color: 'var(--orbitpm-muted)'
            }}
          >
            {sourceKindLabel(tab.sourceKind)}
          </span>
          <span
            style={{
              padding: '0.2rem 0.55rem',
              borderRadius: 999,
              border: '1px solid var(--orbitpm-border)',
              fontSize: 12,
              color: 'var(--orbitpm-muted)'
            }}
          >
            {t('aris.placeholder.zoom')}
          </span>
          <span
            style={{
              padding: '0.2rem 0.55rem',
              borderRadius: 999,
              border: '1px solid var(--orbitpm-border)',
              fontSize: 12,
              color: 'var(--orbitpm-muted)'
            }}
          >
            {t('aris.placeholder.layout')}
          </span>
        </header>

        <div
          style={{
            minHeight: 0,
            border: '1px solid var(--orbitpm-border)',
            borderRadius: 14,
            background: 'var(--orbitpm-panel-bg, var(--orbitpm-bg))',
            display: 'grid',
            placeItems: 'center',
            padding: '1.25rem',
            textAlign: 'center'
          }}
        >
          <div style={{ maxWidth: 720 }}>
            <div style={{ fontSize: 42, lineHeight: 1, marginBottom: 10 }} aria-hidden>
              🧭
            </div>
            <h2 style={{ margin: '0 0 10px', fontSize: 20 }}>{t('aris.placeholder.heading')}</h2>
            <p style={{ margin: '0 0 10px', color: 'var(--orbitpm-muted)', lineHeight: 1.55 }}>
              {t('aris.placeholder.body')}
            </p>
            <p style={{ margin: 0, color: 'var(--orbitpm-muted)', fontSize: 13, lineHeight: 1.5 }}>
              {t('aris.placeholder.readOnly')}
            </p>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap'
          }}
        >
          <button type="button" className="orbitpm-lite-chrome-btn" onClick={onDownloadSource}>
            {t('aris.placeholder.downloadSource')}
          </button>
          <button type="button" className="orbitpm-lite-chrome-btn" onClick={onOpenAssistant}>
            {t('aris.placeholder.openAssistant')}
          </button>
        </div>
      </div>

      <aside
        style={{
          minWidth: 0,
          minHeight: 0,
          overflow: 'auto',
          display: 'grid',
          gap: 12,
          alignContent: 'start'
        }}
      >
        <section
          style={{
            border: '1px solid var(--orbitpm-border)',
            borderRadius: 12,
            padding: '0.9rem 1rem',
            background: 'var(--orbitpm-panel-bg, var(--orbitpm-bg))'
          }}
        >
          <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>
            {t('aris.placeholder.detailsHeading')}
          </h3>
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(110px, 0.7fr) minmax(0, 1fr)',
              gap: '6px 10px',
              margin: 0,
              fontSize: 13
            }}
          >
            <dt style={{ color: 'var(--orbitpm-muted)' }}>{t('aris.placeholder.sourceKind')}</dt>
            <dd style={{ margin: 0 }}>{sourceKindLabel(tab.sourceKind)}</dd>
            <dt style={{ color: 'var(--orbitpm-muted)' }}>{t('aris.placeholder.sourcePath')}</dt>
            <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{tab.relPath ?? t('aris.source.virtual')}</dd>
            <dt style={{ color: 'var(--orbitpm-muted)' }}>{t('aris.placeholder.sourceBytes')}</dt>
            <dd style={{ margin: 0 }}>{tab.bytes.byteLength}</dd>
            <dt style={{ color: 'var(--orbitpm-muted)' }}>{t('aris.placeholder.sourceDigest')}</dt>
            <dd style={{ margin: 0, overflowWrap: 'anywhere', fontFamily: 'monospace' }}>
              {tab.sha256}
            </dd>
          </dl>
        </section>

        <section
          style={{
            border: '1px solid var(--orbitpm-border)',
            borderRadius: 12,
            padding: '0.9rem 1rem',
            background: 'var(--orbitpm-panel-bg, var(--orbitpm-bg))'
          }}
        >
          <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>
            {t('aris.placeholder.accountingHeading')}
          </h3>
          <p style={{ margin: 0, color: 'var(--orbitpm-muted)', fontSize: 13, lineHeight: 1.5 }}>
            {t('aris.placeholder.accountingBody')}
          </p>
        </section>

        <section
          style={{
            border: '1px solid var(--orbitpm-border)',
            borderRadius: 12,
            padding: '0.9rem 1rem',
            background: 'var(--orbitpm-panel-bg, var(--orbitpm-bg))'
          }}
        >
          <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>
            {t('aris.placeholder.sourceHeading')}
          </h3>
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              fontSize: 12,
              lineHeight: 1.5,
              maxHeight: 320,
              overflow: 'auto'
            }}
          >
            {tab.content}
          </pre>
        </section>
      </aside>
    </section>
  )
}

export default function ArisApp(): JSX.Element {
  const lang = useLang()
  const dir: 'ltr' | 'rtl' = lang === 'ar' ? 'rtl' : 'ltr'
  const responsiveMode = useResponsiveShellMode()
  const [sidebarWidth, setSidebarWidth, resetSidebarWidth] = usePaneWidth(
    'orbitpm-aris-shell.sidebar-width',
    {
      defaultWidth: 320,
      minWidth: 240,
      maxWidth: 520
    }
  )
  const [phase, setPhase] = useState<Phase>('loading')
  const [mode, setMode] = useState<WorkspaceMode>('single-file')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [explorerOpen, setExplorerOpen] = useState(true)
  const [keysVersion, setKeysVersion] = useState(0)
  const [workspaceAdapter, setWorkspaceAdapter] = useState<WorkspaceAdapter | null>(null)
  const [workspaceSources, setWorkspaceSources] = useState<WorkspaceEntry[]>([])
  const [tabs, setTabs] = useState<ArisTab[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [rememberedName, setRememberedName] = useState<string | undefined>(undefined)
  const [toasts, setToasts] = useState<ToastMsg[]>([])
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
      const text = decodeUtf8Strict(bytes, {
        operation: 'read',
        ...(relPath ? { path: relPath } : {})
      })
      if (classifyImportBoundarySource(name, text) === 'reject-bpmn') {
        pushToast(t('toast.import.arisOnly'))
        return false
      }
      const hash = await sha256Hex(bytes)
      openTab(
        relPath
          ? snapshotToTab(
              {
                path: relPath,
                bytes,
                hash,
                size: bytes.byteLength,
                modifiedAt: 0,
                mimeType
              },
              text
            )
          : {
              key: `source:${name}:${hash}`,
              title: name,
              relPath: null,
              sourceKind: inferSourceKind(name),
              content: text,
              bytes,
              sha256: hash,
              mimeType
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
        await openImportedBytes(path.split('/').pop() ?? path, path, snapshot.bytes, snapshot.mimeType)
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

  const handleOpenPickedFile = useCallback(async (file: File) => {
    const adapter = await SingleFileWorkspaceAdapter.fromFile(file)
    await activateAdapter(adapter)
    const bytes = new Uint8Array(await file.arrayBuffer())
    await openImportedBytes(file.name, file.name, bytes, file.type || undefined)
  }, [activateAdapter, openImportedBytes])

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

  const handleCreateGeneratedPlaceholder = useCallback(
    async ({ name, description }: { name: string; description: string }) => {
      const xml = buildGeneratedArisPlaceholderXml(name, description, lang)
      const bytes = new TextEncoder().encode(xml)
      const hash = await sha256Hex(bytes)
      openTab(generatedToTab(name, xml, bytes, hash))
      setAssistantOpen(true)
    },
    [lang, openTab]
  )

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
                  onCreatePlaceholder={handleCreateGeneratedPlaceholder}
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
                      <ArisPlaceholderTab
                        tab={tab}
                        onDownloadSource={() =>
                          downloadBytes(tab.relPath?.split('/').pop() ?? `${tab.title}.xml`, tab.bytes)
                        }
                        onOpenAssistant={() => setAssistantOpen(true)}
                      />
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
      />
      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </>
  )
}

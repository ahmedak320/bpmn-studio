import { useState } from 'react'

import { ArisGenerationPanel } from '../../ArisGenerationPanel'
import { usePromptText } from '../../common/prompt'
import type { LiteTreeNode } from '../../fs/fsAccess'
import { t } from '../../i18n'
import type { ToastTone } from '../../workspace/Toaster'
import type { WorkspaceAdapter, WorkspaceEntry } from '../../workspace/adapters/types'
import { EmptyWorkspaceCard } from '../../workspace/EmptyWorkspaceCard'
import { FolderTreeLite, type TreeRevealRequest } from '../../workspace/FolderTreeLite'
import { countTreeFiles } from '../../workspace/liteTreeFromEntries'
import type { HierarchyNavigation, ProcessHierarchy } from '../../workspace/processHierarchy'
import { ArisModelExplorer } from './ArisModelExplorer'
import { useArisExplorerActions, type ArisExplorerTabsController } from './arisExplorerActions'
import type { ArisStudioModelSummary } from './arisStudioDocument'

export interface ArisExplorerActiveTab {
  readonly key: string
  readonly title: string
  readonly models: readonly ArisStudioModelSummary[]
}

export interface ArisExplorerPaneProps {
  readonly lang: 'en' | 'ar'
  readonly dir: 'ltr' | 'rtl'
  readonly directoryAvailable: boolean
  readonly onImportClick: () => void
  readonly onOpenFileClick: () => void
  readonly onChangeFolder: () => void
  readonly activeTab: ArisExplorerActiveTab | null
  readonly activeModelId: string | null
  readonly onSelectModel: (tabKey: string, modelId: string) => void
  readonly workspaceSources: readonly WorkspaceEntry[]
  readonly openPaths: ReadonlySet<string>
  readonly onOpenWorkspaceFile: (path: string) => void
  readonly onRejectUnsupported: () => void
  readonly onOpenAssistant: () => void
  /** Opens the chat drawer's completion interview for the active model. */
  readonly onContinueInChat: () => void
  readonly workspaceId: string | null
  readonly onCreateModel: React.ComponentProps<typeof ArisGenerationPanel>['onCreateModel']
  readonly onDownloadFile: (fileName: string, bytes: Uint8Array, mimeType?: string) => void
  readonly onOpenSettings: () => void
  /** True in directory/OPFS workspaces, where the folder tree replaces the flat list. */
  readonly multiFile: boolean
  readonly adapter: WorkspaceAdapter | null
  readonly tree: LiteTreeNode | null
  readonly hierarchy: ProcessHierarchy | null
  /** Token-driven request to scroll to and focus one canonical tree row. */
  readonly revealRequest: TreeRevealRequest | null
  /** Navigate a read-only reference row through stable process identity. */
  readonly onOpenProcess: (navigation: HierarchyNavigation) => void
  readonly activePath: string | null
  readonly rootName: string
  readonly tabsController: ArisExplorerTabsController
  readonly onRefreshWorkspace: () => Promise<void>
  readonly onOpenFileFocus: (relPath: string) => void
  /** Blank-model stub; Lane L2d replaces only its body. `folderRel` is '' for root. */
  readonly onNewModel: (folderRel: string) => void
  readonly onToast: (message: string, tone?: ToastTone) => void
}

type ArisSourceKind = 'aml' | 'apc' | 'xml' | 'generated'

function inferSourceKind(name: string, generated = false): ArisSourceKind {
  if (generated) return 'generated'
  if (/\.aml$/iu.test(name)) return 'aml'
  if (/\.apc$/iu.test(name)) return 'apc'
  return 'xml'
}

function sourceKindLabel(kind: ArisSourceKind): string {
  return t(`aris.sourceKind.${kind}`)
}

export function ArisExplorerPane(props: ArisExplorerPaneProps): JSX.Element {
  const {
    lang,
    dir,
    directoryAvailable,
    onImportClick,
    onOpenFileClick,
    onChangeFolder,
    activeTab,
    activeModelId,
    onSelectModel,
    workspaceSources,
    openPaths,
    onOpenWorkspaceFile,
    onRejectUnsupported,
    onOpenAssistant,
    onContinueInChat,
    workspaceId,
    onCreateModel,
    onDownloadFile,
    onOpenSettings,
    multiFile,
    adapter,
    tree,
    hierarchy,
    revealRequest,
    onOpenProcess,
    activePath,
    rootName,
    tabsController,
    onRefreshWorkspace,
    onOpenFileFocus,
    onNewModel,
    onToast
  } = props

  const promptText = usePromptText()
  const actions = useArisExplorerActions({
    adapter,
    tree,
    rootName,
    promptText,
    refresh: onRefreshWorkspace,
    toast: onToast,
    tabs: tabsController
  })

  const [aiCollapsed, setAiCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('orbitpm.lite.sidebarAiCollapsed') === '1'
    } catch {
      return false
    }
  })

  const handleToggleAi = () => {
    setAiCollapsed((current) => {
      const next = !current
      try {
        localStorage.setItem('orbitpm.lite.sidebarAiCollapsed', next ? '1' : '0')
      } catch {
        // ignore storage errors
      }
      return next
    })
  }

  return (
    <div className="orbitpm-workspace-explorer__content">
      <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '0.5rem 0' }}>
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
          {multiFile && (
            <>
              <button
                type="button"
                className="orbitpm-lite-primary"
                title={t('aris.explorer.newModel.title')}
                onClick={() => onNewModel('')}
              >
                {t('aris.explorer.newModel')}
              </button>
              <button
                type="button"
                className="orbitpm-lite-chrome-btn"
                aria-label={t('tree.newFolder.aria')}
                title={t('tree.newFolder.title')}
                onClick={() => actions.onNewFolder('')}
              >
                📁＋
              </button>
              <button
                type="button"
                className="orbitpm-lite-chrome-btn"
                aria-label={t('tree.refresh.aria')}
                title={t('tree.refresh.title')}
                onClick={() => void onRefreshWorkspace()}
              >
                ↻
              </button>
            </>
          )}
          <button type="button" className="orbitpm-lite-chrome-btn" onClick={onImportClick}>
            {t('app.import')}
          </button>
          <button type="button" className="orbitpm-lite-chrome-btn" onClick={onOpenFileClick}>
            {t('aris.header.openFile')}
          </button>
          {directoryAvailable && (
            <button type="button" className="orbitpm-lite-chrome-btn" onClick={onChangeFolder}>
              {t('app.changeFolder')}
            </button>
          )}
        </div>

        {activeTab && activeTab.models.length > 1 && (
          <ArisModelExplorer
            sourceTitle={activeTab.title}
            models={activeTab.models}
            activeModelId={activeModelId}
            lang={lang}
            onSelect={(modelId) => onSelectModel(activeTab.key, modelId)}
          />
        )}

        {multiFile && tree && hierarchy ? (
          countTreeFiles(tree) === 0 ? (
            <EmptyWorkspaceCard folderName={rootName} onCreateFirst={() => onNewModel('')} />
          ) : (
            <FolderTreeLite
              hierarchy={hierarchy}
              activePath={activePath}
              revealRequest={revealRequest}
              onOpenFile={(rel) => {
                if (/\.bpmn$/iu.test(rel)) onRejectUnsupported()
                else onOpenWorkspaceFile(rel)
              }}
              onOpenFileFocus={onOpenFileFocus}
              onOpenProcess={onOpenProcess}
              onNewProcess={onNewModel}
              onNewFolder={actions.onNewFolder}
              onRename={actions.onRename}
              onDelete={actions.onDelete}
              onMove={actions.onMove}
              onMoveDrop={actions.onMoveDrop}
              onImportDrop={actions.onImportDrop}
            />
          )
        ) : workspaceSources.length === 0 ? (
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
              const isActive = openPaths.has(entry.path)
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
                      borderColor: isActive ? 'var(--orbitpm-primary-bg)' : 'var(--orbitpm-border)'
                    }}
                    onClick={() =>
                      unsupported ? onRejectUnsupported() : void onOpenWorkspaceFile(entry.path)
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
        onClick={handleToggleAi}
        aria-expanded={!aiCollapsed}
        aria-controls="orbitpm-aris-create-section"
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
        <span aria-hidden>{aiCollapsed ? (dir === 'rtl' ? '◂' : '▸') : '▾'}</span>
      </button>
      <div
        id="orbitpm-aris-create-section"
        hidden={aiCollapsed}
        style={{ flex: '0 1 auto', maxHeight: '55%', overflowY: 'auto' }}
      >
        <ArisGenerationPanel
          embedded
          workspaceId={workspaceId}
          onCreateModel={onCreateModel}
          onDownloadFile={(fileName, bytes, mimeType) =>
            onDownloadFile(fileName, bytes, mimeType ?? 'application/xml')
          }
          onOpenAssistant={onOpenAssistant}
          onOpenSettings={onOpenSettings}
          onContinueInChat={onContinueInChat}
        />
      </div>
      {actions.dialogs}
    </div>
  )
}

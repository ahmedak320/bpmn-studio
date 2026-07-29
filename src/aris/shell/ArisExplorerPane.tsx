import { useState } from 'react'

import { ArisGenerationPanel } from '../../ArisGenerationPanel'
import { t } from '../../i18n'
import type { WorkspaceEntry } from '../../workspace/adapters/types'
import { ArisModelExplorer } from './ArisModelExplorer'
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
  readonly workspaceId: string | null
  readonly digests: React.ComponentProps<typeof ArisGenerationPanel>['digests']
  readonly onCreateModel: React.ComponentProps<typeof ArisGenerationPanel>['onCreateModel']
  readonly onDownloadFile: (fileName: string, bytes: Uint8Array, mimeType?: string) => void
  readonly onOpenSettings: () => void
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
    workspaceId,
    digests,
    onCreateModel,
    onDownloadFile,
    onOpenSettings
  } = props

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

        {activeTab && (
          <ArisModelExplorer
            sourceTitle={activeTab.title}
            models={activeTab.models}
            activeModelId={activeModelId}
            lang={lang}
            onSelect={(modelId) => onSelectModel(activeTab.key, modelId)}
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
          digests={digests}
          onCreateModel={onCreateModel}
          onDownloadFile={(fileName, bytes, mimeType) =>
            onDownloadFile(fileName, bytes, mimeType ?? 'application/xml')
          }
          onOpenAssistant={onOpenAssistant}
          onOpenSettings={onOpenSettings}
        />
      </div>
    </div>
  )
}

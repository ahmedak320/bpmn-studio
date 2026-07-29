import { useCallback, useState } from 'react'

import type { LiteTreeNode } from '../../fs/fsAccess'
import { t } from '../../i18n'
import type { PromptText } from '../../common/prompt'
import { ConfirmDialog } from '../../workspace/ConfirmDialog'
import { MoveDialog } from '../../workspace/MoveDialog'
import type { WorkspaceAdapter } from '../../workspace/adapters/types'
import { classifyImportBoundarySource, collectDroppedBpmn } from '../../workspace/importDrop'
import { collectFolderOptions, uniquePathIn } from '../../workspace/liteTreeFromEntries'
import { tk } from './shellI18n'

/**
 * The subset of the ArisApp tab machinery the CRUD handlers drive. A file or
 * folder that is renamed/moved must keep its open tab pointing at the new path
 * (`remap`, which NEVER changes `tab.key` — a key change would remount the
 * canvas and destroy undo history), and a deleted file or folder must close any
 * tab at or under it (`closeUnder`).
 */
export interface ArisExplorerTabsController {
  closeUnder(path: string, kind: 'file' | 'directory'): void
  remap(from: string, to: string, kind: 'file' | 'directory'): void
}

export interface UseArisExplorerActionsOptions {
  readonly adapter: WorkspaceAdapter | null
  readonly tree: LiteTreeNode | null
  readonly rootName: string
  readonly promptText: PromptText
  readonly refresh: () => Promise<void>
  readonly toast: (message: string, tone?: 'info' | 'error' | 'success') => void
  readonly tabs: ArisExplorerTabsController
}

export interface ArisExplorerActions {
  readonly onNewFolder: (folderRel: string) => void
  readonly onRename: (node: LiteTreeNode) => void
  readonly onDelete: (node: LiteTreeNode) => void
  readonly onMove: (node: LiteTreeNode) => void
  readonly onMoveDrop: (
    fromRel: string,
    fromType: 'file' | 'directory',
    toFolderRel: string
  ) => void
  readonly onImportDrop: (dataTransfer: DataTransfer, toFolderRel: string) => void
  readonly dialogs: JSX.Element | null
}

/** ARIS source extensions a file name is allowed to keep or must retain. */
const ARIS_EXTENSION_RE = /\.(?:aml|apc|xml|bpmn)$/iu

function firstSegment(path: string): string {
  const index = path.indexOf('/')
  return index === -1 ? path : path.slice(0, index)
}

function parentOf(relPath: string): string {
  const index = relPath.lastIndexOf('/')
  return index === -1 ? '' : relPath.slice(0, index)
}

function baseName(relPath: string): string {
  return relPath.split('/').pop() ?? relPath
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot) : ''
}

/** Defense-in-depth: the tree never shows `.orbitpm`, but no CRUD may touch it. */
function isReservedPath(path: string): boolean {
  return firstSegment(path) === '.orbitpm'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Every physical relPath currently in the tree (files and directories). */
function collectPaths(node: LiteTreeNode | null, into: Set<string> = new Set()): Set<string> {
  if (!node) return into
  if (node.relPath) into.add(node.relPath)
  for (const child of node.children ?? []) collectPaths(child, into)
  return into
}

/**
 * Owns every explorer CRUD flow against the {@link WorkspaceAdapter}: new
 * folder, rename, delete, move (dialog and drag-drop) and external import-drop.
 * All user-visible copy is routed through the dictionaries; the dialog host is
 * returned as `dialogs` for the caller to render once.
 */
export function useArisExplorerActions(
  options: UseArisExplorerActionsOptions
): ArisExplorerActions {
  const { adapter, tree, rootName, promptText, refresh, toast, tabs } = options

  const [moveNode, setMoveNode] = useState<LiteTreeNode | null>(null)
  const [deleteNode, setDeleteNode] = useState<LiteTreeNode | null>(null)

  const unavailableReason = (): string =>
    tk('aris.explorer.actionUnavailable', 'This workspace does not support that action.')
  const reservedReason = (): string =>
    tk('aris.explorer.reservedPath', 'The reserved .orbitpm namespace cannot be used here.')

  const onNewFolder = useCallback(
    (folderRel: string) => {
      void (async () => {
        if (!adapter || !adapter.storage.capabilities.directories) {
          toast(t('alert.createFolderFailed', { error: unavailableReason() }), 'error')
          return
        }
        if (isReservedPath(folderRel)) {
          toast(t('alert.createFolderFailed', { error: reservedReason() }), 'error')
          return
        }
        const name = await promptText({
          title: t('dialog.newFolder.title'),
          label: t('dialog.newFolder.label'),
          initialValue: t('dialog.newFolder.initialValue'),
          okLabel: t('dialog.newFolder.okLabel')
        })
        if (name === null) return
        if (!name || /[/\\]/u.test(name)) {
          toast(
            t('alert.createFolderFailed', {
              error: tk('aris.explorer.invalidName', 'A name cannot contain a slash.')
            }),
            'error'
          )
          return
        }
        const dest = folderRel ? `${folderRel}/${name}` : name
        if (isReservedPath(dest)) {
          toast(t('alert.createFolderFailed', { error: reservedReason() }), 'error')
          return
        }
        try {
          await adapter.createFolder(dest)
          await refresh()
        } catch (error) {
          toast(t('alert.createFolderFailed', { error: errorMessage(error) }), 'error')
        }
      })()
    },
    [adapter, promptText, refresh, toast]
  )

  const onRename = useCallback(
    (node: LiteTreeNode) => {
      void (async () => {
        if (!adapter || !adapter.storage.capabilities.rename) {
          toast(t('alert.renameFailed', { error: unavailableReason() }), 'error')
          return
        }
        if (isReservedPath(node.relPath)) {
          toast(t('alert.renameFailed', { error: reservedReason() }), 'error')
          return
        }
        const entered = await promptText({
          title: t('dialog.rename.title'),
          label: t('dialog.rename.label'),
          initialValue: node.name,
          okLabel: t('dialog.rename.okLabel')
        })
        if (entered === null) return
        if (!entered || /[/\\]/u.test(entered)) {
          toast(
            t('alert.renameFailed', {
              error: tk('aris.explorer.invalidName', 'A name cannot contain a slash.')
            }),
            'error'
          )
          return
        }
        let finalName = entered
        if (node.type === 'file' && !ARIS_EXTENSION_RE.test(finalName)) {
          finalName += extensionOf(node.name)
        }
        const parent = parentOf(node.relPath)
        const dest = parent ? `${parent}/${finalName}` : finalName
        if (dest === node.relPath) return
        if (isReservedPath(dest)) {
          toast(t('alert.renameFailed', { error: reservedReason() }), 'error')
          return
        }
        try {
          await adapter.rename(node.relPath, dest)
          tabs.remap(node.relPath, dest, node.type)
          await refresh()
        } catch (error) {
          toast(t('alert.renameFailed', { error: errorMessage(error) }), 'error')
        }
      })()
    },
    [adapter, promptText, refresh, tabs, toast]
  )

  const onDelete = useCallback(
    (node: LiteTreeNode) => {
      if (!adapter || !adapter.storage.capabilities.remove) {
        toast(t('alert.deleteFailed', { error: unavailableReason() }), 'error')
        return
      }
      if (isReservedPath(node.relPath)) {
        toast(t('alert.deleteFailed', { error: reservedReason() }), 'error')
        return
      }
      setDeleteNode(node)
    },
    [adapter, toast]
  )

  const confirmDelete = useCallback(() => {
    const node = deleteNode
    setDeleteNode(null)
    if (!node || !adapter) return
    void (async () => {
      try {
        await adapter.remove(node.relPath)
        tabs.closeUnder(node.relPath, node.type)
        await refresh()
      } catch (error) {
        toast(t('alert.deleteFailed', { error: errorMessage(error) }), 'error')
      }
    })()
  }, [adapter, deleteNode, refresh, tabs, toast])

  const onMove = useCallback(
    (node: LiteTreeNode) => {
      if (!adapter || !adapter.storage.capabilities.move) {
        toast(t('alert.moveFailed', { error: unavailableReason() }), 'error')
        return
      }
      if (isReservedPath(node.relPath)) {
        toast(t('alert.moveFailed', { error: reservedReason() }), 'error')
        return
      }
      setMoveNode(node)
    },
    [adapter, toast]
  )

  const performMove = useCallback(
    (node: LiteTreeNode, destFolderRel: string, fromType: 'file' | 'directory') => {
      void (async () => {
        if (!adapter || !adapter.storage.capabilities.move) {
          toast(t('alert.moveFailed', { error: unavailableReason() }), 'error')
          return
        }
        if (isReservedPath(node.relPath) || isReservedPath(destFolderRel)) {
          toast(t('alert.moveFailed', { error: reservedReason() }), 'error')
          return
        }
        const name = baseName(node.relPath)
        if (parentOf(node.relPath) === destFolderRel) return
        const dest = destFolderRel ? `${destFolderRel}/${name}` : name
        if (dest === node.relPath) return
        try {
          await adapter.move(node.relPath, dest)
          tabs.remap(node.relPath, dest, fromType)
          await refresh()
        } catch (error) {
          toast(t('alert.moveFailed', { error: errorMessage(error) }), 'error')
        }
      })()
    },
    [adapter, refresh, tabs, toast]
  )

  const confirmMove = useCallback(
    (destFolderRel: string) => {
      const node = moveNode
      setMoveNode(null)
      if (node) performMove(node, destFolderRel, node.type)
    },
    [moveNode, performMove]
  )

  const onMoveDrop = useCallback(
    (fromRel: string, fromType: 'file' | 'directory', toFolderRel: string) => {
      performMove(
        { name: baseName(fromRel), relPath: fromRel, type: fromType },
        toFolderRel,
        fromType
      )
    },
    [performMove]
  )

  const onImportDrop = useCallback(
    (dataTransfer: DataTransfer, toFolderRel: string) => {
      void (async () => {
        if (!adapter) {
          toast(t('alert.createFolderFailed', { error: unavailableReason() }), 'error')
          return
        }
        if (isReservedPath(toFolderRel)) {
          toast(t('alert.createFolderFailed', { error: reservedReason() }), 'error')
          return
        }
        const dropped = await collectDroppedBpmn(dataTransfer)
        const taken = collectPaths(tree)
        let count = 0
        for (const item of dropped) {
          let text: string
          try {
            text = await item.getText()
          } catch (error) {
            toast(String(errorMessage(error)), 'error')
            continue
          }
          if (classifyImportBoundarySource(item.name, text) === 'reject-bpmn') {
            toast(t('toast.import.arisOnly'))
            continue
          }
          const bytes = new TextEncoder().encode(text)
          let path = uniquePathIn(taken, toFolderRel, item.name)
          let outcome = await adapter.writeAtomic(path, bytes, undefined, { expectedMissing: true })
          let attempts = 0
          while (
            outcome.ok === false &&
            outcome.status === 'external-conflict' &&
            outcome.reason === 'already-exists' &&
            attempts < 50
          ) {
            taken.add(path)
            path = uniquePathIn(taken, toFolderRel, item.name)
            outcome = await adapter.writeAtomic(path, bytes, undefined, { expectedMissing: true })
            attempts += 1
          }
          if (outcome.ok) {
            taken.add(path)
            count += 1
          } else {
            const detail = 'error' in outcome ? outcome.error.message : outcome.status
            toast(t('alert.createFolderFailed', { error: detail }), 'error')
          }
        }
        await refresh()
        if (count > 0) toast(t('aris.explorer.imported', { count }), 'success')
      })()
    },
    [adapter, refresh, toast, tree]
  )

  const dialogs =
    moveNode || deleteNode ? (
      <>
        {moveNode && tree && (
          <MoveDialog
            node={moveNode}
            folders={collectFolderOptions(tree, rootName)}
            onMove={confirmMove}
            onCancel={() => setMoveNode(null)}
          />
        )}
        {deleteNode &&
          (() => {
            const isFolder = deleteNode.type === 'directory'
            const notEmpty = isFolder && (deleteNode.children?.length ?? 0) > 0
            return (
              <ConfirmDialog
                title={t('contextMenu.delete')}
                message={
                  notEmpty ? (
                    <>
                      {t('confirm.deleteNode', { name: deleteNode.name })}{' '}
                      {t('confirm.deleteFolder.notEmptyBody')}
                    </>
                  ) : (
                    t('confirm.deleteNode', { name: deleteNode.name })
                  )
                }
                danger
                role="alertdialog"
                requireTyped={notEmpty ? deleteNode.name : undefined}
                onConfirm={confirmDelete}
                onCancel={() => setDeleteNode(null)}
              />
            )
          })()}
      </>
    ) : null

  return {
    onNewFolder,
    onRename,
    onDelete,
    onMove,
    onMoveDrop,
    onImportDrop,
    dialogs
  }
}

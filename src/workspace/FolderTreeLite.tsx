import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LiteTreeNode } from '../fs/fsAccess'
import { t } from '../i18n'
import { useLang } from '../i18n/useLang'
import { INTERNAL_DND_MIME, isInternalDrag } from './importDrop'
import type {
  HierarchyDepthCapRow,
  HierarchyNavigation,
  HierarchyPhysicalRow,
  HierarchyReferenceChild,
  HierarchyReferenceRow,
  ProcessHierarchy
} from './processHierarchy'

export interface TreeRevealRequest {
  token: number
  processId?: string
  relPath?: string
}

export interface FolderTreeLiteProps {
  hierarchy: ProcessHierarchy
  activePath?: string | null
  dirtyPaths?: ReadonlySet<string>
  revealRequest?: TreeRevealRequest | null
  onOpenFile: (relPath: string) => void
  /** Double-click on a physical file row opens it and takes the full window. */
  onOpenFileFocus?: (relPath: string) => void
  /** Read-only references navigate through stable process identity. */
  onOpenProcess: (navigation: HierarchyNavigation) => void
  /** folderRelPath is '' for the workspace root. */
  onNewProcess: (folderRelPath: string) => void
  onNewFolder: (folderRelPath: string) => void
  onRename: (node: LiteTreeNode) => void
  onDelete: (node: LiteTreeNode) => void
  onMove: (node: LiteTreeNode) => void
  onMoveDrop: (fromRel: string, fromType: 'file' | 'directory', toFolderRel: string) => void
  onImportDrop?: (dataTransfer: DataTransfer, toFolderRel: string) => void
}

interface MenuState {
  x: number
  y: number
  node: LiteTreeNode
}

interface MenuItem {
  label: string
  onClick: () => void
  danger?: boolean
}

interface RowActions {
  activePath: string | null
  dirtyPaths: ReadonlySet<string>
  expanded: ReadonlySet<string>
  dropTargetRel: string | null
  onToggle: (key: string) => void
  onOpenFile: (relPath: string) => void
  onOpenFileFocus?: (relPath: string) => void
  onOpenProcess: (navigation: HierarchyNavigation) => void
  onContextMenu: (event: React.MouseEvent, node: LiteTreeNode) => void
  onRename: (node: LiteTreeNode) => void
  onDelete: (node: LiteTreeNode) => void
  onMove: (node: LiteTreeNode) => void
  onNewProcess: (folderRel: string) => void
  onDragStartNode: (event: React.DragEvent, node: LiteTreeNode) => void
  onDragOverFolder: (event: React.DragEvent, folderRel: string) => void
  onDragLeaveFolder: (event: React.DragEvent, folderRel: string) => void
  onDropFolder: (event: React.DragEvent, folderRel: string) => void
  registerCanonicalRow: (key: string, element: HTMLDivElement | null) => void
}

function parentOf(relPath: string): string {
  const idx = relPath.lastIndexOf('/')
  return idx === -1 ? '' : relPath.slice(0, idx)
}

function dropFolderOf(node: LiteTreeNode): string {
  return node.type === 'directory' ? node.relPath : parentOf(node.relPath)
}

function directoryKey(relPath: string): string {
  return `directory:${relPath}`
}

/**
 * Physical files/folders remain the only actionable rows. Owned subprocess
 * files are visually re-parented (their real relPath is unchanged); reused
 * references remain read-only navigation views.
 */
export function FolderTreeLite({
  hierarchy,
  activePath,
  dirtyPaths,
  revealRequest,
  onOpenFile,
  onOpenFileFocus,
  onOpenProcess,
  onNewProcess,
  onNewFolder,
  onRename,
  onDelete,
  onMove,
  onMoveDrop,
  onImportDrop
}: FolderTreeLiteProps): JSX.Element {
  useLang()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([directoryKey('')]))
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dropTargetRel, setDropTargetRel] = useState<string | null>(null)
  const canonicalRowsRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const handledRevealTokenRef = useRef<number | null>(null)

  const toggle = useCallback((key: string) => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const registerCanonicalRow = useCallback((key: string, element: HTMLDivElement | null) => {
    if (element) canonicalRowsRef.current.set(key, element)
    else canonicalRowsRef.current.delete(key)
  }, [])

  // A stable-id navigation asks the tree to reveal and focus the one physical
  // canonical occurrence. The token makes repeated opens focus it again.
  useEffect(() => {
    if (!revealRequest) return
    if (handledRevealTokenRef.current === revealRequest.token) return
    const canonical =
      (revealRequest.processId
        ? hierarchy.canonicalByProcessId.get(revealRequest.processId)
        : undefined) ??
      (revealRequest.relPath ? hierarchy.canonicalByRelPath.get(revealRequest.relPath) : undefined)
    if (!canonical) return

    setExpanded((previous) => {
      const next = new Set(previous)
      for (const path of canonical.ancestorDirectoryPaths) {
        next.add(directoryKey(path))
      }
      for (const key of canonical.ancestorRowKeys) next.add(key)
      return next
    })

    let frame = 0
    let settleTimer = 0
    let attempts = 0
    const focusCanonical = (): void => {
      frame = requestAnimationFrame(() => {
        const row = canonicalRowsRef.current.get(canonical.key)
        if (!row) {
          attempts += 1
          if (attempts < 8) focusCanonical()
          return
        }
        row.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        row.focus({ preventScroll: true })
        // Opening the file can repaint the tree/canvas a moment later. A
        // second focus prevents that render from stealing keyboard location.
        settleTimer = window.setTimeout(() => {
          const settled = canonicalRowsRef.current.get(canonical.key)
          settled?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
          settled?.focus({ preventScroll: true })
        }, 180)
        // Mark the request only after focus succeeds. React StrictMode
        // intentionally cancels the first mount effect; marking earlier would
        // make its second setup skip the focus work entirely.
        handledRevealTokenRef.current = revealRequest.token
      })
    }
    focusCanonical()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      if (settleTimer) window.clearTimeout(settleTimer)
    }
  }, [hierarchy, revealRequest])

  const openMenu = useCallback((event: React.MouseEvent, node: LiteTreeNode) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, node })
  }, [])

  const onDragStartNode = useCallback((event: React.DragEvent, node: LiteTreeNode) => {
    if (node.relPath === '') return
    event.dataTransfer.setData(
      INTERNAL_DND_MIME,
      JSON.stringify({ relPath: node.relPath, type: node.type })
    )
    event.dataTransfer.setData('text/plain', node.name)
    event.dataTransfer.effectAllowed = 'move'
  }, [])

  const onDragOverFolder = useCallback((event: React.DragEvent, folderRel: string) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = isInternalDrag(event.dataTransfer) ? 'move' : 'copy'
    setDropTargetRel(folderRel)
  }, [])

  const onDragLeaveFolder = useCallback((_event: React.DragEvent, folderRel: string) => {
    setDropTargetRel((current) => (current === folderRel ? null : current))
  }, [])

  const onDropFolder = useCallback(
    (event: React.DragEvent, folderRel: string) => {
      event.preventDefault()
      event.stopPropagation()
      setDropTargetRel(null)
      const transfer = event.dataTransfer
      if (isInternalDrag(transfer)) {
        try {
          const raw = transfer.getData(INTERNAL_DND_MIME)
          if (!raw) return
          const parsed = JSON.parse(raw) as {
            relPath: string
            type: 'file' | 'directory'
          }
          onMoveDrop(parsed.relPath, parsed.type, folderRel)
        } catch {
          /* malformed internal payload — ignore */
        }
      } else {
        onImportDrop?.(transfer, folderRel)
      }
    },
    [onMoveDrop, onImportDrop]
  )

  const actions: RowActions = useMemo(
    () => ({
      activePath: activePath ?? null,
      dirtyPaths: dirtyPaths ?? new Set<string>(),
      expanded,
      dropTargetRel,
      onToggle: toggle,
      onOpenFile,
      onOpenFileFocus,
      onOpenProcess,
      onContextMenu: openMenu,
      onRename,
      onDelete,
      onMove,
      onNewProcess,
      onDragStartNode,
      onDragOverFolder,
      onDragLeaveFolder,
      onDropFolder,
      registerCanonicalRow
    }),
    [
      activePath,
      dirtyPaths,
      expanded,
      dropTargetRel,
      toggle,
      onOpenFile,
      onOpenFileFocus,
      onOpenProcess,
      openMenu,
      onRename,
      onDelete,
      onMove,
      onNewProcess,
      onDragStartNode,
      onDragOverFolder,
      onDragLeaveFolder,
      onDropFolder,
      registerCanonicalRow
    ]
  )

  const buildMenuItems = useCallback(
    (node: LiteTreeNode): MenuItem[] => {
      const folderRel = dropFolderOf(node)
      const items: MenuItem[] = [
        {
          label: t('contextMenu.newProcess'),
          onClick: () => onNewProcess(folderRel)
        },
        {
          label: t('contextMenu.newFolder'),
          onClick: () => onNewFolder(folderRel)
        }
      ]
      if (node.relPath !== '') {
        items.push({
          label: t('contextMenu.rename'),
          onClick: () => onRename(node)
        })
        items.push({
          label: t('contextMenu.moveTo'),
          onClick: () => onMove(node)
        })
        items.push({
          label: t('contextMenu.delete'),
          onClick: () => onDelete(node),
          danger: true
        })
      }
      return items
    },
    [onNewProcess, onNewFolder, onRename, onMove, onDelete]
  )

  const root = hierarchy.root
  const rootIsDropTarget = dropTargetRel === ''

  return (
    <div
      style={{ userSelect: 'none' }}
      onContextMenu={(event) => root && openMenu(event, root.node)}
      onDragOver={(event) => onDragOverFolder(event, '')}
      onDragLeave={(event) => onDragLeaveFolder(event, '')}
      onDrop={(event) => onDropFolder(event, '')}
    >
      <div
        style={{
          outline: rootIsDropTarget ? '2px dashed var(--orbitpm-accent)' : 'none',
          outlineOffset: -2,
          borderRadius: 6,
          minHeight: 40
        }}
      >
        {root && <PhysicalLevel row={root} depth={0} actions={actions} />}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenuItems(menu.node)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

function PhysicalLevel({
  row,
  depth,
  actions
}: {
  row: HierarchyPhysicalRow
  depth: number
  actions: RowActions
}): JSX.Element {
  const isRoot = depth === 0
  const isDirectory = row.kind === 'directory'
  const isOpen = isRoot || actions.expanded.has(row.key)
  const isActive = row.kind === 'file' && row.relPath === actions.activePath
  const isDirty = row.kind === 'file' && actions.dirtyPaths.has(row.relPath)
  const folderRel = dropFolderOf(row.node)
  const isDropTarget = !isRoot && isDirectory && actions.dropTargetRel === folderRel
  const references = row.kind === 'file' ? row.references : []
  const ownedChildren = row.kind === 'file' ? row.ownedChildren : []
  const hasChildren = references.length > 0 || ownedChildren.length > 0
  const childrenOpen = hasChildren && actions.expanded.has(row.key)

  const activate = (): void => {
    if (row.kind === 'directory') actions.onToggle(row.key)
    else actions.onOpenFile(row.relPath)
  }

  return (
    <div>
      {!isRoot && (
        <div
          ref={
            row.kind === 'file'
              ? (element) => actions.registerCanonicalRow(row.key, element)
              : undefined
          }
          className="orbitpm-tree-row"
          data-rel-path={row.relPath}
          data-canonical={row.kind === 'file' ? 'true' : undefined}
          data-owned-subprocess={row.kind === 'file' && row.owned ? 'true' : undefined}
          data-owner-process-id={
            row.kind === 'file' ? (row.ownerParentProcessId ?? undefined) : undefined
          }
          data-process-id={row.kind === 'file' ? row.processIds[0] : undefined}
          data-process-ids={
            row.kind === 'file' && row.processIds.length > 0 ? row.processIds.join(' ') : undefined
          }
          draggable
          tabIndex={row.kind === 'file' ? -1 : 0}
          onDragStart={(event) => actions.onDragStartNode(event, row.node)}
          onDragOver={(event) => actions.onDragOverFolder(event, folderRel)}
          onDragLeave={(event) => actions.onDragLeaveFolder(event, folderRel)}
          onDrop={(event) => actions.onDropFolder(event, folderRel)}
          onClick={activate}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              activate()
            }
          }}
          onDoubleClick={() => {
            if (row.kind === 'file') {
              actions.onOpenFileFocus?.(row.relPath)
            }
          }}
          onContextMenu={(event) => actions.onContextMenu(event, row.node)}
          style={{
            display: 'flex',
            contentVisibility: 'auto',
            containIntrinsicSize: '28px',
            alignItems: 'center',
            gap: 6,
            padding: '3px 6px',
            paddingInlineStart: 8 + depth * 14,
            cursor: 'pointer',
            fontSize: 13,
            borderRadius: 4,
            whiteSpace: 'nowrap',
            background: isDropTarget || isActive ? 'var(--orbitpm-hover)' : 'transparent',
            outline: isDropTarget ? '2px dashed var(--orbitpm-accent)' : 'none',
            outlineOffset: -2
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = 'var(--orbitpm-hover)'
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background =
              isDropTarget || isActive ? 'var(--orbitpm-hover)' : 'transparent'
          }}
          title={row.relPath}
        >
          <span
            style={{
              opacity: 0.6,
              width: 12,
              display: 'inline-block',
              flex: '0 0 auto',
              cursor: hasChildren ? 'pointer' : undefined
            }}
            role={hasChildren ? 'button' : undefined}
            aria-label={hasChildren ? t('tree.linkedChildren') : undefined}
            aria-expanded={hasChildren ? childrenOpen : undefined}
            onClick={
              hasChildren
                ? (event) => {
                    event.stopPropagation()
                    actions.onToggle(row.key)
                  }
                : undefined
            }
            onDoubleClick={hasChildren ? (event) => event.stopPropagation() : undefined}
          >
            {row.kind === 'directory'
              ? isOpen
                ? '▾'
                : '▸'
              : hasChildren
                ? childrenOpen
                  ? '▾'
                  : '▸'
                : ''}
          </span>
          <span style={{ flex: '0 0 auto' }}>
            {row.kind === 'directory' ? '📁' : row.owned ? '↳📄' : '📄'}
          </span>
          <span
            style={{
              flex: '1 1 auto',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {row.name}
          </span>
          {row.kind === 'file' && isDirty && (
            <span
              aria-label={t('editor.dirtyFlag.dirty')}
              title={t('editor.dirtyFlag.dirty.title')}
              style={{ color: 'var(--orbitpm-accent)', flex: '0 0 auto' }}
            >
              ●
            </span>
          )}
          {row.kind === 'file' && row.shared && <SharedPill count={row.distinctParentCount} />}
          {row.kind === 'file' && row.owned && <OwnedPill />}
          {row.kind === 'file' && row.ownerCallCount > 1 && (
            <span
              data-call-count={row.ownerCallCount}
              title={String(row.ownerCallCount)}
              style={{
                flex: '0 0 auto',
                color: 'var(--orbitpm-muted)',
                fontSize: 10.5
              }}
            >
              ×{row.ownerCallCount}
            </span>
          )}
          <span
            className="orbitpm-tree-actions"
            style={{ display: 'flex', gap: 2, flex: '0 0 auto' }}
          >
            {row.kind === 'directory' && (
              <ActionIcon
                label={t('treeAction.newProcessIn', { name: row.name })}
                glyph="＋"
                onClick={() => actions.onNewProcess(row.relPath)}
              />
            )}
            <ActionIcon
              label={t('treeAction.rename', { name: row.name })}
              glyph="✎"
              onClick={() => actions.onRename(row.node)}
            />
            <ActionIcon
              label={t('treeAction.move', { name: row.name })}
              glyph="⤴"
              onClick={() => actions.onMove(row.node)}
            />
            <ActionIcon
              label={t('treeAction.delete', { name: row.name })}
              glyph="🗑"
              danger
              onClick={() => actions.onDelete(row.node)}
            />
          </span>
        </div>
      )}

      {row.kind === 'directory' && isOpen && (
        <div>
          {row.children.map((child) => (
            <PhysicalLevel key={child.key} row={child} depth={depth + 1} actions={actions} />
          ))}
        </div>
      )}

      {row.kind === 'file' && childrenOpen && (
        <div>
          {row.ownedChildren.map((child) => (
            <PhysicalLevel key={child.key} row={child} depth={depth + 1} actions={actions} />
          ))}
          <ReferenceLevel rows={row.references} depth={depth + 1} actions={actions} />
        </div>
      )}
    </div>
  )
}

function ReferenceLevel({
  rows,
  depth,
  actions
}: {
  rows: readonly HierarchyReferenceChild[]
  depth: number
  actions: RowActions
}): JSX.Element {
  return (
    <div>
      {rows.map((row) =>
        row.kind === 'depth-cap' ? (
          <DepthCapRow key={row.key} row={row} depth={depth} />
        ) : (
          <ReferenceRow key={row.key} row={row} depth={depth} actions={actions} />
        )
      )}
    </div>
  )
}

function ReferenceRow({
  row,
  depth,
  actions
}: {
  row: HierarchyReferenceRow
  depth: number
  actions: RowActions
}): JSX.Element {
  const isOpen = row.expandable && actions.expanded.has(row.key)
  const isActive = row.canonicalPath === actions.activePath
  const cycleTitle = row.cycle ? t('tree.cycle.title') : undefined

  return (
    <div>
      <div
        className={`orbitpm-tree-row orbitpm-tree-reference-row${
          row.cycle ? ' orbitpm-tree-reference-row--cycle' : ''
        }`}
        data-process-id={row.processId}
        data-reference-count={row.count}
        data-reference-kind="reused"
        data-cycle={row.cycle ?? undefined}
        data-read-only="true"
        role="button"
        tabIndex={0}
        aria-label={row.label}
        onClick={() => actions.onOpenProcess(row.navigation)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            actions.onOpenProcess(row.navigation)
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        style={{
          display: 'flex',
          contentVisibility: 'auto',
          containIntrinsicSize: '28px',
          alignItems: 'center',
          gap: 6,
          padding: '3px 6px',
          paddingInlineStart: 8 + depth * 14,
          cursor: 'pointer',
          fontSize: 13,
          borderRadius: 4,
          background: isActive ? 'var(--orbitpm-hover)' : 'transparent'
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = 'var(--orbitpm-hover)'
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = isActive ? 'var(--orbitpm-hover)' : 'transparent'
        }}
        title={row.canonicalPath}
      >
        <span
          style={{
            opacity: 0.6,
            width: 12,
            display: 'inline-block',
            flex: '0 0 auto',
            cursor: row.expandable ? 'pointer' : undefined
          }}
          role={row.expandable ? 'button' : undefined}
          aria-label={row.expandable ? t('tree.linkedChildren') : undefined}
          aria-expanded={row.expandable ? isOpen : undefined}
          onClick={
            row.expandable
              ? (event) => {
                  event.stopPropagation()
                  actions.onToggle(row.key)
                }
              : undefined
          }
        >
          {row.expandable ? (isOpen ? '▾' : '▸') : ''}
        </span>
        <span aria-hidden style={{ flex: '0 0 auto' }}>
          🔗
        </span>
        <span
          style={{
            minWidth: 0,
            flex: '1 1 auto',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {row.label}
          </span>
          <span
            className="orbitpm-tree-reference-path"
            title={t('tree.reference.canonicalPath', {
              path: row.canonicalPath
            })}
            style={{ fontSize: 10.5 }}
          >
            {t('tree.reference.canonicalPath', {
              path: row.canonicalPath
            })}
          </span>
        </span>
        {row.count > 1 && (
          <span
            data-call-count={row.count}
            title={String(row.count)}
            style={{
              flex: '0 0 auto',
              color: 'var(--orbitpm-muted)',
              fontSize: 10.5
            }}
          >
            ×{row.count}
          </span>
        )}
        {row.shared && <SharedPill count={row.distinctParentCount} />}
        {!row.cycle && <ReusedPill />}
        {row.cycle && (
          <span className="orbitpm-tree-cycle-indicator" title={cycleTitle} aria-label={cycleTitle}>
            ↻
          </span>
        )}
      </div>
      {isOpen && <ReferenceLevel rows={row.children} depth={depth + 1} actions={actions} />}
    </div>
  )
}

function DepthCapRow({ row, depth }: { row: HierarchyDepthCapRow; depth: number }): JSX.Element {
  return (
    <div
      data-depth-cap="true"
      data-omitted-reference-count={row.omittedReferenceCount}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      style={{
        padding: '3px 6px',
        paddingInlineStart: 8 + depth * 14,
        fontSize: 12,
        opacity: 0.55,
        whiteSpace: 'nowrap'
      }}
      title={t('tree.linkDepthCapped')}
    >
      … {t('tree.linkDepthCapped')}
    </div>
  )
}

function SharedPill({ count }: { count: number }): JSX.Element {
  const title = t('tree.shared.title', { count })
  return (
    <span
      className="orbitpm-tree-shared-pill"
      title={title}
      aria-label={title}
      data-distinct-parent-count={count}
    >
      {t('tree.shared')}
    </span>
  )
}

function OwnedPill(): JSX.Element {
  const title = t('tree.owned.title')
  return (
    <span
      className="orbitpm-tree-owned-pill"
      title={title}
      aria-label={title}
      data-subprocess-ownership="owned"
    >
      {t('tree.owned')}
    </span>
  )
}

function ReusedPill(): JSX.Element {
  const title = t('tree.reused.title')
  return (
    <span
      className="orbitpm-tree-reused-pill"
      title={title}
      aria-label={title}
      data-subprocess-ownership="reused"
    >
      {t('tree.reused')}
    </span>
  )
}

function ActionIcon({
  label,
  glyph,
  onClick,
  danger
}: {
  label: string
  glyph: string
  onClick: () => void
  danger?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      style={{
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        fontSize: 12,
        lineHeight: 1,
        padding: '2px 3px',
        borderRadius: 4,
        color: danger ? '#d0473f' : 'inherit',
        opacity: 0.75
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.opacity = '1'
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.opacity = '0.75'
      }}
    >
      {glyph}
    </button>
  )
}

function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}): JSX.Element {
  useEffect(() => {
    const close = (): void => onClose()
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('resize', close)
    }
  }, [onClose])

  return (
    <div
      role="menu"
      style={{
        position: 'fixed',
        top: y,
        left: x,
        zIndex: 2000,
        minWidth: 160,
        background: 'var(--orbitpm-panel-bg)',
        border: '1px solid var(--orbitpm-border)',
        borderRadius: 6,
        boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
        padding: 4
      }}
      onClick={(event) => event.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={() => {
            item.onClick()
            onClose()
          }}
          style={{
            display: 'block',
            width: '100%',
            border: 'none',
            background: 'transparent',
            color: item.danger ? '#d0473f' : 'inherit',
            textAlign: 'start',
            padding: '6px 10px',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 13
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = 'var(--orbitpm-hover)'
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = 'transparent'
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export default FolderTreeLite

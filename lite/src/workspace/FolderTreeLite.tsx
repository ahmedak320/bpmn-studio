import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LiteTreeNode } from '../fs/fsAccess'
import { INTERNAL_DND_MIME, isInternalDrag } from './importDrop'
import { t } from '../i18n'
import { useLang } from '../i18n/useLang'

export interface FolderTreeLiteProps {
  root: LiteTreeNode | null
  activePath?: string | null
  onOpenFile: (relPath: string) => void
  /** Double-click on a file row: open it AND take the full window (App
   *  collapses the sidebar). Single click stays a plain open via onOpenFile so
   *  browsing the tree never steals the explorer (see App's `collapse` opt). */
  onOpenFileFocus?: (relPath: string) => void
  /** folderRelPath is '' for the workspace root. */
  onNewProcess: (folderRelPath: string) => void
  onNewFolder: (folderRelPath: string) => void
  onRename: (node: LiteTreeNode) => void
  onDelete: (node: LiteTreeNode) => void
  /** Open the "Move to…" dialog for a node (drag-and-drop fallback). */
  onMove: (node: LiteTreeNode) => void
  /** A node was drag-dropped onto a folder within the tree. */
  onMoveDrop: (fromRel: string, fromType: 'file' | 'directory', toFolderRel: string) => void
  /** Files/folders were dragged in from OUTSIDE the browser (Explorer import). */
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

function parentOf(relPath: string): string {
  const idx = relPath.lastIndexOf('/')
  return idx === -1 ? '' : relPath.slice(0, idx)
}

/** The folder a drop onto this node targets: the folder itself, or a file's
 *  containing folder. */
function dropFolderOf(node: LiteTreeNode): string {
  return node.type === 'directory' ? node.relPath : parentOf(node.relPath)
}

interface RowActions {
  activePath: string | null
  expanded: Set<string>
  dropTargetRel: string | null
  onToggle: (relPath: string) => void
  onOpenFile: (relPath: string) => void
  onOpenFileFocus?: (relPath: string) => void
  onContextMenu: (event: React.MouseEvent, node: LiteTreeNode) => void
  onRename: (node: LiteTreeNode) => void
  onDelete: (node: LiteTreeNode) => void
  onMove: (node: LiteTreeNode) => void
  onNewProcess: (folderRel: string) => void
  onDragStartNode: (event: React.DragEvent, node: LiteTreeNode) => void
  onDragOverFolder: (event: React.DragEvent, folderRel: string) => void
  onDragLeaveFolder: (event: React.DragEvent, folderRel: string) => void
  onDropFolder: (event: React.DragEvent, folderRel: string) => void
}

/**
 * Folder tree over a File-System-Access-backed workspace. Adds three ways to
 * manage files/folders: hover action icons, a right-click context menu (both
 * offering rename / move / delete / new), and drag-and-drop move within the
 * tree. It is also the primary drop zone for importing `.bpmn` files dragged in
 * from Explorer (routed to the folder they land on). App wires each callback to
 * the fsAccess adapter.
 */
export function FolderTreeLite({
  root,
  activePath,
  onOpenFile,
  onOpenFileFocus,
  onNewProcess,
  onNewFolder,
  onRename,
  onDelete,
  onMove,
  onMoveDrop,
  onImportDrop
}: FolderTreeLiteProps): JSX.Element {
  useLang()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']))
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dropTargetRel, setDropTargetRel] = useState<string | null>(null)

  const toggle = useCallback((relPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(relPath)) next.delete(relPath)
      else next.add(relPath)
      return next
    })
  }, [])

  const openMenu = useCallback((event: React.MouseEvent, node: LiteTreeNode) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, node })
  }, [])

  // --- drag and drop ------------------------------------------------------

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
    // Accept both internal moves and external imports so a drop can fire.
    event.preventDefault()
    event.dataTransfer.dropEffect = isInternalDrag(event.dataTransfer) ? 'move' : 'copy'
    setDropTargetRel(folderRel)
  }, [])

  const onDragLeaveFolder = useCallback((_event: React.DragEvent, folderRel: string) => {
    setDropTargetRel((cur) => (cur === folderRel ? null : cur))
  }, [])

  const onDropFolder = useCallback(
    (event: React.DragEvent, folderRel: string) => {
      event.preventDefault()
      event.stopPropagation()
      setDropTargetRel(null)
      const dt = event.dataTransfer
      if (isInternalDrag(dt)) {
        try {
          const raw = dt.getData(INTERNAL_DND_MIME)
          if (!raw) return
          const parsed = JSON.parse(raw) as { relPath: string; type: 'file' | 'directory' }
          onMoveDrop(parsed.relPath, parsed.type, folderRel)
        } catch {
          /* malformed payload — ignore */
        }
      } else {
        onImportDrop?.(dt, folderRel)
      }
    },
    [onMoveDrop, onImportDrop]
  )

  const actions: RowActions = useMemo(
    () => ({
      activePath: activePath ?? null,
      expanded,
      dropTargetRel,
      onToggle: toggle,
      onOpenFile,
      onOpenFileFocus,
      onContextMenu: openMenu,
      onRename,
      onDelete,
      onMove,
      onNewProcess,
      onDragStartNode,
      onDragOverFolder,
      onDragLeaveFolder,
      onDropFolder
    }),
    [
      activePath,
      expanded,
      dropTargetRel,
      toggle,
      onOpenFile,
      onOpenFileFocus,
      openMenu,
      onRename,
      onDelete,
      onMove,
      onNewProcess,
      onDragStartNode,
      onDragOverFolder,
      onDragLeaveFolder,
      onDropFolder
    ]
  )

  const buildMenuItems = useCallback(
    (node: LiteTreeNode): MenuItem[] => {
      const folderRel = dropFolderOf(node)
      const items: MenuItem[] = [
        { label: t('contextMenu.newProcess'), onClick: () => onNewProcess(folderRel) },
        { label: t('contextMenu.newFolder'), onClick: () => onNewFolder(folderRel) }
      ]
      if (node.relPath !== '') {
        items.push({ label: t('contextMenu.rename'), onClick: () => onRename(node) })
        items.push({ label: t('contextMenu.moveTo'), onClick: () => onMove(node) })
        items.push({ label: t('contextMenu.delete'), onClick: () => onDelete(node), danger: true })
      }
      return items
    },
    [onNewProcess, onNewFolder, onRename, onMove, onDelete]
  )

  const rows = useMemo(() => {
    if (!root) return null
    return <TreeLevel node={root} depth={0} actions={actions} />
  }, [root, actions])

  const rootIsDropTarget = dropTargetRel === ''

  return (
    <div
      style={{ userSelect: 'none' }}
      onContextMenu={(e) => root && openMenu(e, root)}
      // The empty tree area is a drop zone for the workspace root (import here,
      // or move a node up to the root). Folder rows stopPropagation so a drop
      // onto a specific folder targets that folder instead.
      onDragOver={(e) => onDragOverFolder(e, '')}
      onDragLeave={(e) => onDragLeaveFolder(e, '')}
      onDrop={(e) => onDropFolder(e, '')}
    >
      <div
        style={{
          outline: rootIsDropTarget ? '2px dashed var(--orbitpm-accent)' : 'none',
          outlineOffset: -2,
          borderRadius: 6,
          minHeight: 40
        }}
      >
        {rows}
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

interface TreeLevelProps {
  node: LiteTreeNode
  depth: number
  actions: RowActions
}

function TreeLevel({ node, depth, actions }: TreeLevelProps): JSX.Element {
  const isRoot = depth === 0
  const isOpen = isRoot || actions.expanded.has(node.relPath)
  const isActive = node.type === 'file' && node.relPath === actions.activePath
  const folderRel = dropFolderOf(node)
  const isDropTarget = !isRoot && actions.dropTargetRel === folderRel && node.type === 'directory'

  return (
    <div>
      {!isRoot && (
        <div
          className="orbitpm-tree-row"
          draggable
          onDragStart={(e) => actions.onDragStartNode(e, node)}
          onDragOver={(e) => actions.onDragOverFolder(e, folderRel)}
          onDragLeave={(e) => actions.onDragLeaveFolder(e, folderRel)}
          onDrop={(e) => actions.onDropFolder(e, folderRel)}
          onClick={() => {
            if (node.type === 'directory') actions.onToggle(node.relPath)
            else actions.onOpenFile(node.relPath)
          }}
          onDoubleClick={() => {
            // Files only: the pair of clicks above already opened the tab, so
            // this just re-activates it with the sidebar-collapsing variant.
            // Folders keep their click-toggle (a double click nets out to the
            // original expanded state, matching the pre-existing behavior).
            if (node.type === 'file') actions.onOpenFileFocus?.(node.relPath)
          }}
          onContextMenu={(e) => actions.onContextMenu(e, node)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 6px',
            paddingInlineStart: 8 + depth * 14,
            cursor: 'pointer',
            fontSize: 13,
            borderRadius: 4,
            whiteSpace: 'nowrap',
            background: isDropTarget
              ? 'var(--orbitpm-hover)'
              : isActive
                ? 'var(--orbitpm-hover)'
                : 'transparent',
            outline: isDropTarget ? '2px dashed var(--orbitpm-accent)' : 'none',
            outlineOffset: -2
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--orbitpm-hover)')}
          onMouseLeave={(e) =>
            (e.currentTarget.style.background =
              isDropTarget || isActive ? 'var(--orbitpm-hover)' : 'transparent')
          }
          title={node.relPath}
        >
          <span style={{ opacity: 0.6, width: 12, display: 'inline-block', flex: '0 0 auto' }}>
            {node.type === 'directory' ? (isOpen ? '▾' : '▸') : ''}
          </span>
          <span style={{ flex: '0 0 auto' }}>{node.type === 'directory' ? '📁' : '📄'}</span>
          <span style={{ flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {node.name}
          </span>
          {/* Hover action icons (revealed via CSS on row hover). */}
          <span className="orbitpm-tree-actions" style={{ display: 'flex', gap: 2, flex: '0 0 auto' }}>
            {node.type === 'directory' && (
              <ActionIcon
                label={t('treeAction.newProcessIn', { name: node.name })}
                glyph="＋"
                onClick={() => actions.onNewProcess(node.relPath)}
              />
            )}
            <ActionIcon
              label={t('treeAction.rename', { name: node.name })}
              glyph="✎"
              onClick={() => actions.onRename(node)}
            />
            <ActionIcon
              label={t('treeAction.move', { name: node.name })}
              glyph="⤴"
              onClick={() => actions.onMove(node)}
            />
            <ActionIcon
              label={t('treeAction.delete', { name: node.name })}
              glyph="🗑"
              danger
              onClick={() => actions.onDelete(node)}
            />
          </span>
        </div>
      )}
      {node.type === 'directory' && isOpen && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeLevel key={child.relPath} node={child} depth={depth + 1} actions={actions} />
          ))}
        </div>
      )}
    </div>
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
      onClick={(e) => {
        e.stopPropagation()
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
      onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
      onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.75')}
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
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose()
            item.onClick()
          }}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'start',
            padding: '6px 10px',
            border: 'none',
            background: 'transparent',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 13,
            color: item.danger ? '#d0473f' : 'inherit'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--orbitpm-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export default FolderTreeLite

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
  keyboardTrigger: HTMLElement | null
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
  onContextMenu: (event: React.MouseEvent<HTMLElement>, node: LiteTreeNode) => void
  onRename: (node: LiteTreeNode) => void
  onDelete: (node: LiteTreeNode) => void
  onMove: (node: LiteTreeNode) => void
  onNewProcess: (folderRel: string) => void
  onDragStartNode: (event: React.DragEvent, node: LiteTreeNode) => void
  onDragOverFolder: (event: React.DragEvent, folderRel: string) => void
  onDragLeaveFolder: (event: React.DragEvent, folderRel: string) => void
  onDropFolder: (event: React.DragEvent, folderRel: string) => void
  registerCanonicalRow: (key: string, element: HTMLDivElement | null) => void
  focusedKey: string | null
  onRowFocus: (key: string) => void
  onKeyboardMenu: (node: LiteTreeNode, trigger: HTMLElement) => void
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
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const treeRef = useRef<HTMLDivElement | null>(null)
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

  const openMenu = useCallback((event: React.MouseEvent<HTMLElement>, node: LiteTreeNode) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({
      x: event.clientX,
      y: event.clientY,
      node,
      keyboardTrigger: null
    })
  }, [])

  const openKeyboardMenu = useCallback((node: LiteTreeNode, trigger: HTMLElement) => {
    const bounds = trigger.getBoundingClientRect()
    setMenu({
      x: bounds.left + Math.min(24, bounds.width),
      y: bounds.bottom,
      node,
      keyboardTrigger: trigger
    })
  }, [])

  const handleTreeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const current = target.closest<HTMLElement>('[role="treeitem"]')
      if (!current || target !== current || !treeRef.current?.contains(current)) return

      const items = [...treeRef.current.querySelectorAll<HTMLElement>('[role="treeitem"]')]
      const currentIndex = items.indexOf(current)
      if (currentIndex < 0) return

      const focusAt = (index: number): void => {
        const next = items[index]
        if (!next) return
        setFocusedKey(next.dataset.treeKey ?? null)
        next.focus()
      }

      const level = Number(current.getAttribute('aria-level') ?? '1')
      const expandable = current.dataset.treeExpandable === 'true'
      const expanded = current.getAttribute('aria-expanded') === 'true'
      const key = current.dataset.treeKey

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          focusAt(Math.min(items.length - 1, currentIndex + 1))
          break
        case 'ArrowUp':
          event.preventDefault()
          focusAt(Math.max(0, currentIndex - 1))
          break
        case 'Home':
          event.preventDefault()
          focusAt(0)
          break
        case 'End':
          event.preventDefault()
          focusAt(items.length - 1)
          break
        case 'ArrowRight': {
          event.preventDefault()
          if (expandable && !expanded && key) {
            toggle(key)
            return
          }
          const next = items[currentIndex + 1]
          if (
            expandable &&
            expanded &&
            next &&
            Number(next.getAttribute('aria-level') ?? '1') > level
          ) {
            focusAt(currentIndex + 1)
          }
          break
        }
        case 'ArrowLeft': {
          event.preventDefault()
          if (expandable && expanded && key) {
            toggle(key)
            return
          }
          for (let index = currentIndex - 1; index >= 0; index -= 1) {
            const candidateLevel = Number(items[index]?.getAttribute('aria-level') ?? '1')
            if (candidateLevel < level) {
              focusAt(index)
              break
            }
          }
          break
        }
      }
    },
    [toggle]
  )

  const defaultFocusedKey = useMemo(() => {
    const activeCanonical = activePath ? hierarchy.canonicalByRelPath.get(activePath) : undefined
    const activeIsVisible =
      activeCanonical !== undefined &&
      activeCanonical.ancestorDirectoryPaths.every(
        (path) => path === '' || expanded.has(directoryKey(path))
      ) &&
      activeCanonical.ancestorRowKeys.every((key) => expanded.has(key))
    if (activeCanonical && activeIsVisible) return activeCanonical.key
    return hierarchy.root?.kind === 'directory' ? (hierarchy.root.children[0]?.key ?? null) : null
  }, [activePath, expanded, hierarchy])

  const effectiveFocusedKey = focusedKey ?? defaultFocusedKey

  useEffect(() => {
    const tree = treeRef.current
    if (!tree) return
    const visibleItems = [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')]
    if (visibleItems.length === 0) return
    if (
      effectiveFocusedKey &&
      visibleItems.some((item) => item.dataset.treeKey === effectiveFocusedKey)
    ) {
      return
    }
    setFocusedKey(visibleItems[0]?.dataset.treeKey ?? null)
  }, [effectiveFocusedKey, expanded, hierarchy])

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
      registerCanonicalRow,
      focusedKey: effectiveFocusedKey,
      onRowFocus: setFocusedKey,
      onKeyboardMenu: openKeyboardMenu
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
      registerCanonicalRow,
      effectiveFocusedKey,
      openKeyboardMenu
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
      ref={treeRef}
      role="tree"
      aria-label={t('tree.search.aria')}
      tabIndex={root ? undefined : 0}
      style={{ userSelect: 'none' }}
      onContextMenu={(event) => root && openMenu(event, root.node)}
      onDragOver={(event) => onDragOverFolder(event, '')}
      onDragLeave={(event) => onDragLeaveFolder(event, '')}
      onDrop={(event) => onDropFolder(event, '')}
      onKeyDown={handleTreeKeyDown}
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
          keyboardTrigger={menu.keyboardTrigger}
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
  const treeExpandable = row.kind === 'directory' ? row.children.length > 0 : hasChildren
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
          data-tree-key={row.key}
          data-tree-expandable={treeExpandable ? 'true' : 'false'}
          draggable
          role="treeitem"
          aria-level={depth}
          aria-label={isDirty ? `${row.name} — ${t('editor.dirtyFlag.dirty')}` : row.name}
          aria-expanded={treeExpandable ? (isDirectory ? isOpen : childrenOpen) : undefined}
          aria-current={isActive ? 'page' : undefined}
          tabIndex={actions.focusedKey === row.key ? 0 : -1}
          onFocus={() => actions.onRowFocus(row.key)}
          onDragStart={(event) => actions.onDragStartNode(event, row.node)}
          onDragOver={(event) => actions.onDragOverFolder(event, folderRel)}
          onDragLeave={(event) => actions.onDragLeaveFolder(event, folderRel)}
          onDrop={(event) => actions.onDropFolder(event, folderRel)}
          onClick={activate}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
              event.preventDefault()
              actions.onKeyboardMenu(row.node, event.currentTarget)
              return
            }
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
            aria-hidden="true"
            title={hasChildren ? t('tree.linkedChildren') : undefined}
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
        <div role="group">
          {row.children.map((child) => (
            <PhysicalLevel key={child.key} row={child} depth={depth + 1} actions={actions} />
          ))}
        </div>
      )}

      {row.kind === 'file' && childrenOpen && (
        <div role="group">
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
        data-tree-key={row.key}
        data-tree-expandable={row.expandable ? 'true' : 'false'}
        role="treeitem"
        aria-level={depth}
        aria-expanded={row.expandable ? isOpen : undefined}
        aria-current={isActive ? 'page' : undefined}
        tabIndex={actions.focusedKey === row.key ? 0 : -1}
        onFocus={() => actions.onRowFocus(row.key)}
        aria-label={row.label}
        onClick={() => actions.onOpenProcess(row.navigation)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
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
          aria-hidden="true"
          title={row.expandable ? t('tree.linkedChildren') : undefined}
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
      {isOpen && (
        <div role="group">
          <ReferenceLevel rows={row.children} depth={depth + 1} actions={actions} />
        </div>
      )}
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
        minWidth: 24,
        minHeight: 24,
        padding: 2,
        borderRadius: 4,
        color: danger ? 'var(--orbitpm-fg)' : 'inherit',
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
  onClose,
  keyboardTrigger
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
  keyboardTrigger: HTMLElement | null
}): JSX.Element {
  const menuRef = useRef<HTMLDivElement | null>(null)

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

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [])

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-orientation="vertical"
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
      onKeyDown={(event) => {
        const target = event.target
        if (!(target instanceof HTMLButtonElement)) return
        const menuItems = [
          ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
        ]
        const index = menuItems.indexOf(target)
        const focusAt = (nextIndex: number): void => {
          menuItems[nextIndex]?.focus()
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          focusAt((index + 1) % menuItems.length)
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          focusAt((index - 1 + menuItems.length) % menuItems.length)
        } else if (event.key === 'Home') {
          event.preventDefault()
          focusAt(0)
        } else if (event.key === 'End') {
          event.preventDefault()
          focusAt(menuItems.length - 1)
        } else if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault()
          onClose()
          requestAnimationFrame(() => keyboardTrigger?.focus())
        }
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            item.onClick()
            onClose()
          }}
          style={{
            display: 'block',
            width: '100%',
            border: 'none',
            background: 'transparent',
            color: item.danger ? 'var(--orbitpm-fg)' : 'inherit',
            textAlign: 'start',
            minHeight: 32,
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

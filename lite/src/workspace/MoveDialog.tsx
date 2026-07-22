import { useMemo, useState } from 'react'
import { Modal } from './Modal'
import type { LiteTreeNode } from '../fs/fsAccess'

export interface MoveFolderOption {
  relPath: string
  label: string
}

export interface MoveDialogProps {
  /** The file or folder being moved. */
  node: LiteTreeNode
  /** All folders in the workspace (root first), as label/relPath pairs. */
  folders: MoveFolderOption[]
  onMove: (destFolderRelPath: string) => void
  onCancel: () => void
}

function parentOf(relPath: string): string {
  const idx = relPath.lastIndexOf('/')
  return idx === -1 ? '' : relPath.slice(0, idx)
}

/**
 * "Move to…" dialog — the keyboard/click fallback for tree drag-and-drop.
 * Lists every folder as a destination except invalid ones: the node's current
 * parent (a no-op) and, when moving a folder, itself and its own descendants
 * (which would recurse). Confirm calls back with the chosen destination folder.
 */
export function MoveDialog({ node, folders, onMove, onCancel }: MoveDialogProps): JSX.Element {
  const currentParent = parentOf(node.relPath)
  const options = useMemo(() => {
    return folders.filter((f) => {
      if (f.relPath === currentParent) return false // already there
      if (node.type === 'directory') {
        if (f.relPath === node.relPath) return false // into itself
        if (f.relPath.startsWith(node.relPath + '/')) return false // into a descendant
      }
      return true
    })
  }, [folders, currentParent, node])

  const [dest, setDest] = useState<string>(() => options[0]?.relPath ?? '')

  const footer = (
    <>
      <button type="button" className="orbitpm-lite-chrome-btn" onClick={onCancel}>
        Cancel
      </button>
      <button
        type="button"
        className="orbitpm-lite-chrome-btn"
        disabled={options.length === 0}
        onClick={() => options.length > 0 && onMove(dest)}
        style={{
          fontWeight: 600,
          background: 'var(--orbitpm-accent)',
          color: '#fff',
          borderColor: 'var(--orbitpm-accent)',
          opacity: options.length === 0 ? 0.5 : 1,
          cursor: options.length === 0 ? 'not-allowed' : 'pointer'
        }}
      >
        Move here
      </button>
    </>
  )

  return (
    <Modal title={`Move "${node.name}"`} onClose={onCancel} maxWidth={420} footer={footer}>
      {options.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--orbitpm-muted)' }}>
          There is no other folder to move this into. Create a folder first.
        </p>
      ) : (
        <label style={{ display: 'block', fontSize: 13 }}>
          <span style={{ display: 'block', marginBottom: 6, color: 'var(--orbitpm-muted)' }}>
            Destination folder
          </span>
          <select
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            style={{
              width: '100%',
              padding: '0.45rem 0.5rem',
              borderRadius: 6,
              border: '1px solid rgba(127,127,127,0.4)',
              background: 'transparent',
              color: 'inherit',
              font: 'inherit',
              fontSize: 13
            }}
          >
            {options.map((f) => (
              <option key={f.relPath} value={f.relPath}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </Modal>
  )
}

export default MoveDialog

import { useEffect, useMemo, useState } from 'react'
import type { ProcessEntry, ProcessIndex } from '../../../shared/processIndex'

export interface LinkPickerProps {
  open: boolean
  index: ProcessIndex
  /** The processId currently assigned (if any) — highlighted in the list. */
  currentProcessId?: string
  onPick: (processId: string) => void
  onClose: () => void
}

function matches(entry: ProcessEntry, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return (
    entry.processId.toLowerCase().includes(q) ||
    (entry.processName ?? '').toLowerCase().includes(q) ||
    entry.relPath.toLowerCase().includes(q)
  )
}

/**
 * Modal listing every process found in the workspace's process index,
 * searchable by id/name/path, for assigning a call activity's
 * `calledElement`. The properties panel already allows typing an id by
 * hand — this is the friendlier alternative.
 */
export function LinkPicker({
  open,
  index,
  currentProcessId,
  onPick,
  onClose
}: LinkPickerProps): JSX.Element | null {
  const [query, setQuery] = useState('')

  const entries = useMemo(() => {
    const all = Array.from(index.values()).sort((a, b) => a.processId.localeCompare(b.processId))
    return all.filter((entry) => matches(entry, query))
  }, [index, query])

  // Escape closes the picker (matches the app's other modals). Bound to the
  // window so it fires regardless of which element inside the dialog has focus.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="orbitpm-link-picker-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Link to process"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
      onClick={onClose}
    >
      <div
        className="orbitpm-link-picker"
        style={{
          background: 'var(--orbitpm-panel-bg, #fff)',
          color: 'inherit',
          borderRadius: 8,
          width: 420,
          maxWidth: '90vw',
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 30px rgba(0,0,0,0.3)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          style={{
            padding: '0.75rem 1rem',
            borderBottom: '1px solid rgba(127,127,127,0.25)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <strong>Link to process…</strong>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div style={{ padding: '0.5rem 1rem' }}>
          <input
            autoFocus
            type="text"
            placeholder="Search by id, name, or path…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', padding: '0.4rem 0.5rem' }}
          />
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '0 0.5rem 0.5rem' }}>
          {entries.length === 0 ? (
            <p style={{ opacity: 0.6, padding: '0.5rem 0.5rem' }}>
              {index.size === 0
                ? 'No processes found in this workspace yet.'
                : 'No processes match your search.'}
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {entries.map((entry) => (
                <li key={entry.processId}>
                  <button
                    type="button"
                    onClick={() => onPick(entry.processId)}
                    style={{
                      width: '100%',
                      textAlign: 'start',
                      padding: '0.5rem',
                      borderRadius: 6,
                      border: 'none',
                      background:
                        entry.processId === currentProcessId
                          ? 'rgba(37,99,235,0.15)'
                          : 'transparent',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {entry.processName || entry.processId}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.65 }}>
                      {entry.processId} · {entry.relPath}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

export default LinkPicker

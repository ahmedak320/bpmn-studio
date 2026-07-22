import type { SearchGroup, MatchField } from './searchIndex'
import { countHits } from './searchIndex'

export interface SearchResultsProps {
  groups: SearchGroup[]
  query: string
  rootName: string
  onOpen: (relPath: string, processId?: string) => void
  onClose: () => void
}

const FIELD_LABEL: Record<MatchField, string> = {
  name: 'name',
  file: 'file',
  id: 'id',
  content: 'in diagram'
}

/**
 * Instant-search results dropdown, grouped by folder. Rendered by App directly
 * under the header search box; clicking a hit opens its file (drilling to the
 * matched process id). App wires Enter-in-the-box to open the first hit and
 * click-outside / Escape to close. Presentational + controlled.
 */
export function SearchResults({
  groups,
  query,
  rootName,
  onOpen,
  onClose
}: SearchResultsProps): JSX.Element {
  const total = countHits(groups)
  return (
    <div
      role="listbox"
      aria-label="Search results"
      style={{
        position: 'absolute',
        top: 'calc(100% + 4px)',
        left: 0,
        right: 0,
        zIndex: 2500,
        maxHeight: '60vh',
        overflowY: 'auto',
        background: 'var(--orbitpm-panel-bg)',
        border: '1px solid var(--orbitpm-border)',
        borderRadius: 10,
        boxShadow: '0 14px 40px rgba(0,0,0,0.3)'
      }}
    >
      <div
        style={{
          padding: '0.4rem 0.7rem',
          fontSize: 11.5,
          color: 'var(--orbitpm-muted)',
          borderBottom: '1px solid var(--orbitpm-border)',
          display: 'flex',
          justifyContent: 'space-between'
        }}
      >
        <span>
          {total} result{total === 1 ? '' : 's'} for “{query.trim()}”
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search results"
          style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer' }}
        >
          ×
        </button>
      </div>

      {total === 0 ? (
        <div style={{ padding: '0.9rem 0.7rem', fontSize: 13, color: 'var(--orbitpm-muted)' }}>
          No processes, files, ids or diagram text match.
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.folder || '(root)'}>
            <div
              style={{
                padding: '0.35rem 0.7rem',
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                color: 'var(--orbitpm-muted)',
                background: 'var(--orbitpm-hover)'
              }}
            >
              📁 {group.folder || rootName}
            </div>
            {group.hits.map((hit, i) => (
              <button
                key={`${hit.relPath}::${hit.processId ?? i}`}
                type="button"
                role="option"
                onClick={() => onOpen(hit.relPath, hit.processId)}
                style={{
                  display: 'flex',
                  width: '100%',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '0.5rem 0.7rem',
                  border: 'none',
                  borderTop: '1px solid var(--orbitpm-border)',
                  background: 'transparent',
                  color: 'inherit',
                  font: 'inherit',
                  fontSize: 13,
                  textAlign: 'left',
                  cursor: 'pointer'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--orbitpm-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span
                    style={{
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {hit.processName?.trim() || hit.fileName.replace(/\.bpmn$/i, '')}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--orbitpm-muted)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {hit.fileName}
                    {hit.processId ? ` · ${hit.processId}` : ''}
                  </span>
                </span>
                <span
                  style={{
                    flex: '0 0 auto',
                    fontSize: 10.5,
                    color: 'var(--orbitpm-muted)',
                    border: '1px solid var(--orbitpm-border)',
                    borderRadius: 999,
                    padding: '0.05rem 0.4rem'
                  }}
                >
                  {FIELD_LABEL[hit.matchedOn]}
                </span>
              </button>
            ))}
          </div>
        ))
      )}
    </div>
  )
}

export default SearchResults

import type { CatalogRow, CatalogSortKey, SortDir } from './catalog'
import { rowLabel } from './catalog'

export interface CatalogViewProps {
  /** Rows already filtered (by the search query) and sorted by App. */
  rows: CatalogRow[]
  sortKey: CatalogSortKey
  sortDir: SortDir
  onSort: (key: CatalogSortKey) => void
  onOpen: (relPath: string, processId?: string) => void
  /** Active search query (drives the "showing X of N" line + empty copy). */
  query: string
  /** Total number of processes before the query filter. */
  totalCount: number
  rootName: string
  onNewProcess: () => void
  onOpenUnresolved: () => void
}

function formatModified(ms?: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '—'
  const now = Date.now()
  const diff = now - ms
  const day = 86_400_000
  if (diff >= 0 && diff < day && d.getDate() === new Date(now).getDate()) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const GRID = '1fr 0.9fr 0.6fr 0.5fr'

/**
 * The catalog / home view: a card-table hybrid listing every process in the
 * workspace so a user can browse "all of the company's processes" without
 * hunting the tree. Sortable by name / folder / modified, honors the active
 * search query, and each row opens its file (drilling to the matched process
 * id when present). Presentational + controlled — App owns the data, sort
 * state and open/new handlers — so it renders to static markup in unit tests.
 */
export function CatalogView({
  rows,
  sortKey,
  sortDir,
  onSort,
  onOpen,
  query,
  totalCount,
  rootName,
  onNewProcess,
  onOpenUnresolved
}: CatalogViewProps): JSX.Element {
  const arrow = (key: CatalogSortKey): string =>
    sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
  const unresolvedTotal = rows.reduce((s, r) => s + (r.unresolvedCount > 0 ? 1 : 0), 0)

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflowY: 'auto',
        background: 'var(--orbitpm-bg)',
        padding: '1.1rem 1.3rem'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 4
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18 }}>Process catalog</h2>
        <button
          type="button"
          className="orbitpm-lite-chrome-btn"
          onClick={onNewProcess}
          style={{
            background: 'var(--orbitpm-accent)',
            color: '#fff',
            borderColor: 'var(--orbitpm-accent)',
            fontWeight: 600
          }}
        >
          ＋ New process
        </button>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--orbitpm-muted)' }}>
        Every process in <strong>{rootName}</strong>.{' '}
        {query.trim()
          ? `Showing ${rows.length} of ${totalCount} matching “${query.trim()}”.`
          : `${totalCount} process${totalCount === 1 ? '' : 'es'}.`}
        {unresolvedTotal > 0 && (
          <>
            {' '}
            <button
              type="button"
              onClick={onOpenUnresolved}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#d97706',
                fontWeight: 600,
                cursor: 'pointer',
                font: 'inherit',
                padding: 0,
                textDecoration: 'underline'
              }}
            >
              {unresolvedTotal} with unresolved links
            </button>
          </>
        )}
      </p>

      {rows.length === 0 ? (
        <div
          style={{
            marginTop: 24,
            padding: '1.4rem',
            borderRadius: 10,
            border: '1px dashed var(--orbitpm-border)',
            textAlign: 'center',
            color: 'var(--orbitpm-muted)',
            fontSize: 13.5
          }}
        >
          {query.trim() ? (
            <>No processes match “{query.trim()}”.</>
          ) : (
            <>
              No processes yet. Click <strong>＋ New process</strong> to create the first one.
            </>
          )}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--orbitpm-border)', borderRadius: 10, overflow: 'hidden' }}>
          {/* Column header (sortable) */}
          <div
            role="row"
            style={{
              display: 'grid',
              gridTemplateColumns: GRID,
              gap: 8,
              padding: '0.5rem 0.8rem',
              borderBottom: '1px solid var(--orbitpm-border)',
              background: 'var(--orbitpm-hover)',
              fontSize: 11.5,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              color: 'var(--orbitpm-muted)'
            }}
          >
            <HeaderButton label={`Process${arrow('name')}`} onClick={() => onSort('name')} />
            <HeaderButton label={`Folder${arrow('folder')}`} onClick={() => onSort('folder')} />
            <HeaderButton label={`Modified${arrow('modified')}`} onClick={() => onSort('modified')} />
            <span>Links</span>
          </div>
          {rows.map((row, i) => (
            <div
              key={`${row.relPath}::${row.processId ?? i}`}
              role="button"
              tabIndex={0}
              aria-label={`Open ${rowLabel(row)}`}
              onClick={() => onOpen(row.relPath, row.processId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOpen(row.relPath, row.processId)
                }
              }}
              style={{
                display: 'grid',
                gridTemplateColumns: GRID,
                gap: 8,
                alignItems: 'center',
                padding: '0.6rem 0.8rem',
                borderTop: i === 0 ? 'none' : '1px solid var(--orbitpm-border)',
                cursor: 'pointer',
                fontSize: 13
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--orbitpm-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span
                  style={{
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                >
                  {rowLabel(row)}
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
                  {row.fileName}
                </span>
              </span>
              <span
                style={{
                  color: 'var(--orbitpm-muted)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
                title={row.folder || rootName}
              >
                {row.folder ? `📁 ${row.folder}` : `📁 ${rootName}`}
              </span>
              <span style={{ color: 'var(--orbitpm-muted)', fontSize: 12 }}>
                {formatModified(row.lastModified)}
              </span>
              <span>
                {row.unresolvedCount > 0 ? (
                  <span
                    title={`${row.unresolvedCount} unresolved call-activity link${
                      row.unresolvedCount === 1 ? '' : 's'
                    }`}
                    style={{
                      padding: '0.05rem 0.4rem',
                      borderRadius: 999,
                      background: 'rgba(217,119,6,0.18)',
                      color: '#d97706',
                      fontSize: 11,
                      fontWeight: 600
                    }}
                  >
                    ⚠ {row.unresolvedCount}
                  </span>
                ) : (
                  <span style={{ color: 'var(--orbitpm-muted)', fontSize: 12 }}>ok</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function HeaderButton({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        textTransform: 'inherit',
        letterSpacing: 'inherit',
        cursor: 'pointer',
        textAlign: 'left',
        padding: 0
      }}
    >
      {label}
    </button>
  )
}

export default CatalogView

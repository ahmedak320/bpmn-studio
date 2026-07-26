import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CatalogView } from './CatalogView'
import type { CatalogRow } from './catalog'

function rows(count: number): CatalogRow[] {
  return Array.from({ length: count }, (_, index) => ({
    relPath: `area/process-${index}.bpmn`,
    fileName: `process-${index}.bpmn`,
    folder: 'area',
    processId: `Process_${index}`,
    processName: `Process ${index}`,
    lastModified: index + 1,
    unresolvedCount: 0
  }))
}

describe('CatalogView virtualization', () => {
  it('keeps a 1,000-process catalog keyboard-accessible without mounting 1,000 rows', () => {
    const onOpen = vi.fn()
    const markup = renderToStaticMarkup(
      <CatalogView
        rows={rows(1_000)}
        sortKey="name"
        sortDir="asc"
        onSort={vi.fn()}
        onOpen={onOpen}
        query=""
        totalCount={1_000}
        rootName="Workspace"
        onNewProcess={vi.fn()}
        onOpenUnresolved={vi.fn()}
      />
    )

    const renderedRows = markup.match(/aria-label="Open Process/g) ?? []
    expect(renderedRows.length).toBeGreaterThan(0)
    expect(renderedRows.length).toBeLessThan(80)
    expect(markup).toContain('tabindex="0"')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('renders every row for ordinary small workspaces', () => {
    const markup = renderToStaticMarkup(
      <CatalogView
        rows={rows(12)}
        sortKey="name"
        sortDir="asc"
        onSort={vi.fn()}
        onOpen={vi.fn()}
        query=""
        totalCount={12}
        rootName="Workspace"
        onNewProcess={vi.fn()}
        onOpenUnresolved={vi.fn()}
      />
    )
    expect(markup.match(/aria-label="Open Process/g)).toHaveLength(12)
  })
})

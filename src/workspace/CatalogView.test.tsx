import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../i18n'
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

afterEach(() => {
  setLang('en')
  vi.restoreAllMocks()
})

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

  it('formats modified dates with the selected application locale', () => {
    setLang('ar')
    const localeDate = vi
      .spyOn(Date.prototype, 'toLocaleDateString')
      .mockReturnValue('ARABIC-LOCALE-DATE')

    const markup = renderToStaticMarkup(
      <CatalogView
        rows={rows(1)}
        sortKey="modified"
        sortDir="asc"
        onSort={vi.fn()}
        onOpen={vi.fn()}
        query=""
        totalCount={1}
        rootName="Workspace"
        onNewProcess={vi.fn()}
        onOpenUnresolved={vi.fn()}
      />
    )

    expect(markup).toContain('ARABIC-LOCALE-DATE')
    expect(localeDate).toHaveBeenCalledWith('ar', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  })
})

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CatalogView } from '../workspace/CatalogView'
import { SearchResults } from '../workspace/SearchResults'
import { UnresolvedLinksPanel } from '../workspace/UnresolvedLinksPanel'
import { MoveDialog } from '../workspace/MoveDialog'
import { ConfirmDialog } from '../workspace/ConfirmDialog'
import { PrintView } from '../workspace/PrintView'
import type { CatalogRow } from '../workspace/catalog'
import type { SearchGroup } from '../workspace/searchIndex'
import type { LiteTreeNode } from '../fs/fsAccess'

const noop = (): void => {}

describe('CatalogView (static render)', () => {
  const rows: CatalogRow[] = [
    {
      relPath: 'Sales/order.bpmn',
      fileName: 'order.bpmn',
      folder: 'Sales',
      processId: 'Process_order',
      processName: 'Order',
      lastModified: Date.now(),
      unresolvedCount: 1
    }
  ]
  it('renders the catalog with a process row and unresolved badge', () => {
    const html = renderToStaticMarkup(
      <CatalogView
        rows={rows}
        sortKey="name"
        sortDir="asc"
        onSort={noop}
        onOpen={noop}
        query=""
        totalCount={1}
        rootName="WS"
        onNewProcess={noop}
        onOpenUnresolved={noop}
      />
    )
    expect(html).toContain('Process catalog')
    expect(html).toContain('Order')
    expect(html).toContain('order.bpmn')
    expect(html).toContain('with unresolved links')
  })
  it('shows an empty state with the query when nothing matches', () => {
    const html = renderToStaticMarkup(
      <CatalogView
        rows={[]}
        sortKey="name"
        sortDir="asc"
        onSort={noop}
        onOpen={noop}
        query="zzz"
        totalCount={3}
        rootName="WS"
        onNewProcess={noop}
        onOpenUnresolved={noop}
      />
    )
    expect(html).toContain('zzz')
  })
})

describe('SearchResults (static render)', () => {
  const groups: SearchGroup[] = [
    {
      folder: 'Sales',
      hits: [
        {
          relPath: 'Sales/order.bpmn',
          fileName: 'order.bpmn',
          folder: 'Sales',
          processId: 'Process_order',
          processName: 'Order',
          matchedOn: 'name'
        }
      ]
    }
  ]
  it('renders grouped hits with the folder header', () => {
    const html = renderToStaticMarkup(
      <SearchResults groups={groups} query="order" rootName="WS" onOpen={noop} onClose={noop} />
    )
    expect(html).toContain('result')
    expect(html).toContain('Sales')
    expect(html).toContain('Order')
  })
})

describe('UnresolvedLinksPanel (static render)', () => {
  it('lists each dangling link with Create now / Open source', () => {
    const html = renderToStaticMarkup(
      <UnresolvedLinksPanel
        links={[
          {
            sourceRelPath: 'a/order.bpmn',
            sourceFileName: 'order.bpmn',
            sourceProcessName: 'Order',
            elementId: 'ca2',
            calledElement: 'Process_missing'
          }
        ]}
        canCreate
        onCreate={noop}
        onOpenSource={noop}
        onClose={noop}
      />
    )
    expect(html).toContain('Process_missing')
    expect(html).toContain('Create now')
    expect(html).toContain('Open source')
  })
})

describe('MoveDialog (static render)', () => {
  it('offers other folders as destinations', () => {
    const node: LiteTreeNode = { name: 'order.bpmn', relPath: 'order.bpmn', type: 'file' }
    const html = renderToStaticMarkup(
      <MoveDialog
        node={node}
        folders={[
          { relPath: '', label: 'root' },
          { relPath: 'Archive', label: 'Archive' }
        ]}
        onMove={noop}
        onCancel={noop}
      />
    )
    expect(html).toContain('Move')
    expect(html).toContain('Archive')
  })
})

describe('ConfirmDialog (static render)', () => {
  it('renders a type-the-name guard for non-empty folders', () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        title="Delete folder"
        danger
        confirmLabel="Delete"
        requireTyped="Sales"
        message="Sales is not empty."
        onConfirm={noop}
        onCancel={noop}
      />
    )
    expect(html).toContain('Delete')
    expect(html).toContain('to confirm')
    expect(html).toContain('Sales')
  })
})

describe('PrintView (static render)', () => {
  it('renders the title, folder and inlined SVG when a legacy job is set', () => {
    const html = renderToStaticMarkup(
      <PrintView job={{ svg: '<svg><rect /></svg>', title: 'Order', folder: 'Sales' }} />
    )
    expect(html).toContain('Order')
    expect(html).toContain('Sales')
    expect(html).toContain('<svg>')
    expect(html).toContain('orbitpm-print-root')
    // No viewBox + no shapes → single legacy SVG container, no band wrapping.
    expect(html).toContain('orbitpm-print-svg')
    expect(html).not.toContain('orbitpm-print-band')
  })
  it('prefers processName and shows the owner line only when present', () => {
    const html = renderToStaticMarkup(
      <PrintView
        job={{
          svg: '<svg><rect /></svg>',
          title: 'order',
          folder: 'Sales',
          processName: 'Order Process',
          ownerLine: 'Owner: Jane'
        }}
      />
    )
    expect(html).toContain('Order Process')
    expect(html).toContain('orbitpm-print-owner')
    expect(html).toContain('Owner: Jane')
  })
  it('slices an enriched wide job into two or more snake-order bands', () => {
    const shapes = Array.from({ length: 10 }, (_, i) => ({
      x: i * 300,
      y: 100,
      width: 200,
      height: 100
    }))
    const html = renderToStaticMarkup(
      <PrintView
        job={{
          svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3000 300"><g><rect /></g></svg>',
          title: 'Wide',
          folder: 'Sales',
          shapes
        }}
      />
    )
    const bandCount = (html.match(/class="orbitpm-print-band"/g) ?? []).length
    expect(bandCount).toBeGreaterThanOrEqual(2)
    // Snake reading marker between bands.
    expect(html).toContain('orbitpm-print-band-marker')
  })
  it('renders nothing when no job is active', () => {
    expect(renderToStaticMarkup(<PrintView job={null} />)).toBe('')
  })
})

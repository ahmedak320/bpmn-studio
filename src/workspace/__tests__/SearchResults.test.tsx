// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchResults, searchResultOptionId } from '../SearchResults'
import type { SearchGroup } from '../searchIndex'

afterEach(cleanup)

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
      },
      {
        relPath: 'Sales/quote.bpmn',
        fileName: 'quote.bpmn',
        folder: 'Sales',
        processId: 'Process_quote',
        processName: 'Quote',
        matchedOn: 'content'
      }
    ]
  }
]

describe('SearchResults combobox popup', () => {
  it('exposes labelled groups and deterministic selectable options', () => {
    const onOpen = vi.fn()
    const onActiveIndexChange = vi.fn()
    render(
      <SearchResults
        id="workspace-search"
        groups={groups}
        query="order"
        rootName="Workspace"
        activeIndex={1}
        onActiveIndexChange={onActiveIndexChange}
        onOpen={onOpen}
        onClose={vi.fn()}
      />
    )

    const listbox = screen.getByRole('listbox', { name: 'Search results' })
    const options = within(listbox).getAllByRole('option')
    expect(options.map((option) => option.id)).toEqual([
      searchResultOptionId(0, 'workspace-search'),
      searchResultOptionId(1, 'workspace-search')
    ])
    expect(options[0]?.getAttribute('aria-selected')).toBe('false')
    expect(options[1]?.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('group', { name: 'Sales' })).toBeTruthy()

    fireEvent.mouseMove(options[0]!)
    expect(onActiveIndexChange).toHaveBeenCalledWith(0)
    fireEvent.click(options[0]!)
    expect(onOpen).toHaveBeenCalledWith('Sales/order.bpmn', 'Process_order')
  })

  it('keeps the empty state inside the controlled listbox', () => {
    render(
      <SearchResults
        groups={[]}
        query="missing"
        rootName="Workspace"
        onOpen={vi.fn()}
        onClose={vi.fn()}
      />
    )
    const option = screen.getByRole('option')
    expect(option.getAttribute('aria-disabled')).toBe('true')
    expect(option.textContent).toContain('No processes')
  })
})

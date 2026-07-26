// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProcessIndex } from '@/core/processIndex'
import type { LiteTreeNode } from '../../fs/fsAccess'
import { FolderTreeLite } from '../FolderTreeLite'
import { buildProcessHierarchy } from '../processHierarchy'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function file(relPath: string): LiteTreeNode {
  return {
    name: relPath.split('/').at(-1) ?? relPath,
    relPath,
    type: 'file'
  }
}

function hierarchy() {
  const root: LiteTreeNode = {
    name: 'Workspace',
    relPath: '',
    type: 'directory',
    children: [
      {
        name: 'Sales',
        relPath: 'Sales',
        type: 'directory',
        children: [file('Sales/order.bpmn')]
      },
      file('overview.bpmn')
    ]
  }
  const index: ProcessIndex = new Map([
    [
      'Process_order',
      {
        processId: 'Process_order',
        processName: 'Order',
        relPath: 'Sales/order.bpmn'
      }
    ],
    [
      'Process_overview',
      {
        processId: 'Process_overview',
        processName: 'Overview',
        relPath: 'overview.bpmn'
      }
    ]
  ])
  return buildProcessHierarchy(root, index, {
    links: [],
    ambiguousProcessIds: new Set()
  })
}

function renderTree(overrides: Partial<React.ComponentProps<typeof FolderTreeLite>> = {}) {
  const onOpenFile = vi.fn()
  const result = render(
    <FolderTreeLite
      hierarchy={hierarchy()}
      onOpenFile={onOpenFile}
      onOpenProcess={vi.fn()}
      onNewProcess={vi.fn()}
      onNewFolder={vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      onMove={vi.fn()}
      onMoveDrop={vi.fn()}
      {...overrides}
    />
  )
  return { ...result, onOpenFile }
}

describe('FolderTreeLite keyboard tree', () => {
  it('uses one roving tab stop and supports Arrow, Home, End, and activation keys', async () => {
    const { onOpenFile } = renderTree()
    const tree = screen.getByRole('tree', { name: 'Search processes' })
    const sales = screen.getByRole('treeitem', { name: 'Sales' })
    const overview = screen.getByRole('treeitem', { name: 'overview.bpmn' })

    expect(
      within(tree)
        .getAllByRole('treeitem')
        .filter((item) => item.tabIndex === 0)
    ).toEqual([sales])

    sales.focus()
    fireEvent.keyDown(sales, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(overview)

    fireEvent.keyDown(overview, { key: 'Home' })
    expect(document.activeElement).toBe(sales)
    fireEvent.keyDown(sales, { key: 'End' })
    expect(document.activeElement).toBe(overview)

    fireEvent.keyDown(overview, { key: 'Enter' })
    fireEvent.keyDown(overview, { key: ' ' })
    expect(onOpenFile).toHaveBeenNthCalledWith(1, 'overview.bpmn')
    expect(onOpenFile).toHaveBeenNthCalledWith(2, 'overview.bpmn')
  })

  it('expands, enters, and leaves nested groups with logical arrow keys', async () => {
    renderTree()
    const sales = screen.getByRole('treeitem', { name: 'Sales' })
    sales.focus()

    expect(sales.getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(sales, { key: 'ArrowRight' })
    await waitFor(() => expect(sales.getAttribute('aria-expanded')).toBe('true'))

    fireEvent.keyDown(sales, { key: 'ArrowRight' })
    const order = screen.getByRole('treeitem', { name: 'order.bpmn' })
    expect(document.activeElement).toBe(order)
    expect(order.getAttribute('aria-level')).toBe('2')

    fireEvent.keyDown(order, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(sales)
    fireEvent.keyDown(sales, { key: 'ArrowLeft' })
    await waitFor(() => expect(sales.getAttribute('aria-expanded')).toBe('false'))
  })

  it('opens the action menu with Shift+F10 and restores focus on Escape', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    renderTree()
    const overview = screen.getByRole('treeitem', { name: 'overview.bpmn' })
    overview.focus()
    fireEvent.keyDown(overview, { key: 'F10', shiftKey: true })

    const menu = await screen.findByRole('menu')
    const items = within(menu).getAllByRole('menuitem')
    await waitFor(() => expect(document.activeElement).toBe(items[0]))
    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])

    fireEvent.keyDown(items[1]!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(overview)
  })
})

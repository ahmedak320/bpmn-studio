// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ProcessTabList,
  processTabId,
  processTabPanelId,
  type ProcessTabItem
} from '../ProcessTabList'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const tabs: ProcessTabItem[] = [
  { key: 'a/one.bpmn', title: 'One' },
  { key: 'b two.bpmn', title: 'Two' },
  { key: 'c.bpmn', title: 'Three' }
]

function installAnimationFrame(): void {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  Element.prototype.scrollIntoView = vi.fn()
}

describe('ProcessTabList', () => {
  it('exposes one selected tab, deterministic panel relationships, and dirty state', () => {
    render(
      <ProcessTabList
        tabs={tabs}
        activeKey={tabs[1]!.key}
        dirtyKeys={new Set([tabs[1]!.key])}
        dir="ltr"
        ariaLabel="Open process tabs"
        closeTitle="Close"
        dirtyLabel="Unsaved changes"
        onActivate={vi.fn()}
        onClose={() => true}
      />
    )
    const tablist = screen.getByRole('tablist', { name: 'Open process tabs' })
    const renderedTabs = screen.getAllByRole('tab')
    expect(tablist).toBeTruthy()
    expect(renderedTabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1])
    expect(renderedTabs[1]?.getAttribute('aria-selected')).toBe('true')
    expect(renderedTabs[1]?.getAttribute('aria-label')).toBe('Two — Unsaved changes')
    expect(renderedTabs[1]?.id).toBe(processTabId(tabs[1]!.key))
    expect(renderedTabs[1]?.getAttribute('aria-controls')).toBe(processTabPanelId(tabs[1]!.key))
  })

  it('automatically activates Arrow/Home/End targets in LTR and RTL order', () => {
    installAnimationFrame()
    const onActivate = vi.fn()
    const { rerender } = render(
      <ProcessTabList
        tabs={tabs}
        activeKey={tabs[1]!.key}
        dirtyKeys={new Set()}
        dir="ltr"
        ariaLabel="Tabs"
        closeTitle="Close"
        dirtyLabel="Dirty"
        onActivate={onActivate}
        onClose={() => true}
      />
    )
    let renderedTabs = screen.getAllByRole('tab')
    fireEvent.keyDown(renderedTabs[1]!, { key: 'ArrowRight' })
    expect(onActivate).toHaveBeenLastCalledWith(tabs[2]!.key)
    expect(document.activeElement).toBe(renderedTabs[2])
    fireEvent.keyDown(renderedTabs[1]!, { key: 'Home' })
    expect(onActivate).toHaveBeenLastCalledWith(tabs[0]!.key)
    fireEvent.keyDown(renderedTabs[1]!, { key: 'End' })
    expect(onActivate).toHaveBeenLastCalledWith(tabs[2]!.key)

    rerender(
      <ProcessTabList
        tabs={tabs}
        activeKey={tabs[1]!.key}
        dirtyKeys={new Set()}
        dir="rtl"
        ariaLabel="Tabs"
        closeTitle="Close"
        dirtyLabel="Dirty"
        onActivate={onActivate}
        onClose={() => true}
      />
    )
    renderedTabs = screen.getAllByRole('tab')
    fireEvent.keyDown(renderedTabs[1]!, { key: 'ArrowRight' })
    expect(onActivate).toHaveBeenLastCalledWith(tabs[0]!.key)
    fireEvent.keyDown(renderedTabs[1]!, { key: 'ArrowLeft' })
    expect(onActivate).toHaveBeenLastCalledWith(tabs[2]!.key)
  })

  it('keeps focus when close is cancelled and restores it after Delete or pointer close', () => {
    installAnimationFrame()
    const onActivate = vi.fn()
    const onClose = vi.fn(() => false)
    const onEmptyFocus = vi.fn()
    const { rerender } = render(
      <ProcessTabList
        tabs={tabs}
        activeKey={tabs[1]!.key}
        dirtyKeys={new Set()}
        dir="ltr"
        ariaLabel="Tabs"
        closeTitle="Close"
        dirtyLabel="Dirty"
        onActivate={onActivate}
        onClose={onClose}
        onEmptyFocus={onEmptyFocus}
      />
    )
    const selected = screen.getAllByRole('tab')[1]!
    selected.focus()
    fireEvent.keyDown(selected, { key: 'Delete' })
    expect(onClose).toHaveBeenCalledWith(tabs[1]!.key)
    expect(document.activeElement).toBe(selected)

    onClose.mockReturnValue(true)
    fireEvent.keyDown(selected, { key: 'Delete' })
    expect(onActivate).toHaveBeenLastCalledWith(tabs[2]!.key)
    rerender(
      <ProcessTabList
        tabs={[tabs[0]!, tabs[2]!]}
        activeKey={tabs[2]!.key}
        dirtyKeys={new Set()}
        dir="ltr"
        ariaLabel="Tabs"
        closeTitle="Close"
        dirtyLabel="Dirty"
        onActivate={onActivate}
        onClose={onClose}
        onEmptyFocus={onEmptyFocus}
      />
    )
    expect(document.activeElement).toBe(screen.getAllByRole('tab')[1])

    fireEvent.click(screen.getAllByTitle('Close')[1]!)
    rerender(
      <ProcessTabList
        tabs={[tabs[0]!]}
        activeKey={tabs[0]!.key}
        dirtyKeys={new Set()}
        dir="ltr"
        ariaLabel="Tabs"
        closeTitle="Close"
        dirtyLabel="Dirty"
        onActivate={onActivate}
        onClose={onClose}
        onEmptyFocus={onEmptyFocus}
      />
    )
    expect(document.activeElement).toBe(screen.getByRole('tab'))
  })
})

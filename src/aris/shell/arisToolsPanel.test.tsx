// @vitest-environment jsdom

import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setLang } from '../../i18n'
import { dmtLibraryItems } from '../canvas/dmtLibrary'
import { bootCanvas, type Harness } from '../canvas/testing/harness'
import { ArisToolsPanel } from './ArisToolsPanel'

let harness: Harness | null = null

beforeEach(() => {
  setLang('en')
  harness = bootCanvas()
})

afterEach(() => {
  cleanup()
  harness?.destroy()
  harness = null
  setLang('en')
})

function mount(): ReturnType<typeof render> {
  if (!harness) throw new Error('Canvas harness is not ready.')
  return render(<ArisToolsPanel canvas={harness.canvas} modelType="MT_EEPC" />)
}

function symbolButton(catalogId: string): HTMLButtonElement {
  const button = toolsPanel().querySelector<HTMLButtonElement>(
    `button[data-aris-catalog-id="${catalogId}"]`
  )
  if (!button) throw new Error(`Missing symbol button ${catalogId}.`)
  return button
}

function toolsPanel(): HTMLElement {
  const panel = document.querySelector<HTMLElement>('[data-orbitpm-aris-tools]')
  if (!panel) throw new Error('Missing tools panel.')
  return panel
}

describe('ArisToolsPanel', () => {
  it('renders one friendly, descriptor-backed button per model item', () => {
    mount()
    const buttons = document.querySelectorAll(
      '[data-orbitpm-aris-tools] button[data-aris-catalog-id]'
    )
    expect(buttons).toHaveLength(dmtLibraryItems('MT_EEPC').length)

    const entity = symbolButton('data.entity-type')
    expect(entity.title).toBe('Entity type')
    expect(entity.title).not.toContain('OT_')
    expect(entity.querySelector('svg')).not.toBeNull()
  })

  it('filters with the DMT search aliases and reports no matches', () => {
    mount()
    const search = within(toolsPanel()).getByRole('searchbox')
    fireEvent.change(search, { target: { value: 'sms' } })

    expect(symbolButton('information.sms')).not.toBeNull()
    expect(toolsPanel().querySelector('button[data-aris-catalog-id="epc.event"]')).toBeNull()

    fireEvent.change(search, { target: { value: 'nothing-matches-this' } })
    expect(within(toolsPanel()).getByRole('status').textContent).toBe(
      'No DMT objects match this search.'
    )
  })

  it('collapses and expands a library group', () => {
    mount()
    const group = toolsPanel().querySelector<HTMLElement>(
      '[data-aris-library-group="flow-decisions"]'
    )
    if (!group) throw new Error('Missing Flow & Decisions group.')
    expect(group.querySelectorAll('button[data-aris-catalog-id]').length).toBeGreaterThan(0)

    fireEvent.click(within(toolsPanel()).getByRole('button', { name: 'Collapse Flow & Decisions' }))
    expect(group.querySelectorAll('button[data-aris-catalog-id]')).toHaveLength(0)
    expect(
      within(toolsPanel())
        .getByRole('button', { name: 'Expand Flow & Decisions' })
        .getAttribute('aria-expanded')
    ).toBe('false')
  })

  it('moves entry focus with ArrowRight, Home, and End', () => {
    mount()
    const entries = [...toolsPanel().querySelectorAll<HTMLButtonElement>('[data-action]')]
    expect(entries.length).toBeGreaterThan(3)

    entries[0]!.focus()
    fireEvent.keyDown(entries[0]!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(entries[1])

    fireEvent.keyDown(entries[1]!, { key: 'End' })
    expect(document.activeElement).toBe(entries.at(-1))

    fireEvent.keyDown(entries.at(-1)!, { key: 'Home' })
    expect(document.activeElement).toBe(entries[0])
  })

  it('starts placement on click and dragstart', () => {
    if (!harness) throw new Error('Canvas harness is not ready.')
    const startPlacement = vi.spyOn(harness.canvas.palette, 'startPlacement')
    mount()
    const button = symbolButton('information.sms')

    fireEvent.click(button)
    fireEvent.dragStart(button)

    expect(startPlacement).toHaveBeenCalledTimes(2)
    expect(startPlacement.mock.calls.map((call) => call[1].catalogId)).toEqual([
      'information.sms',
      'information.sms'
    ])
  })

  it('routes utility actions through the provider facades', () => {
    if (!harness) throw new Error('Canvas harness is not ready.')
    const hand = vi.spyOn(harness.canvas.palette, 'activateHandTool').mockImplementation(() => {})
    const lasso = vi.spyOn(harness.canvas.palette, 'activateLassoTool').mockImplementation(() => {})
    const freeText = vi.spyOn(harness.canvas.palette, 'createFreeText').mockImplementation(() => {})
    mount()

    fireEvent.click(toolsPanel().querySelector('[data-action="hand-tool"]')!)
    fireEvent.click(toolsPanel().querySelector('[data-action="lasso-tool"]')!)
    fireEvent.click(toolsPanel().querySelector('[data-action="create.free-text"]')!)

    expect(hand).toHaveBeenCalledOnce()
    expect(lasso).toHaveBeenCalledOnce()
    expect(freeText).toHaveBeenCalledWith('Free text note')
  })
})

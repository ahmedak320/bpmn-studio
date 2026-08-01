// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

import { bootCanvas, shape, type Harness } from './testing/harness'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
  vi.useRealTimers()
})

describe('ArisHoverTooltip', () => {
  it('shows a delayed friendly type tooltip and clears or suppresses it with canvas state', () => {
    vi.useFakeTimers()
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_INFO_CARR',
      symbolNum: 'ST_LOG',
      name: 'Audit trail',
      position: { x: 40, y: 60 }
    })
    const element = shape(canvas, created.occurrenceId)
    const tooltip = (): HTMLElement | null =>
      document.querySelector<HTMLElement>('[data-orbitpm-aris-type-tip]')

    canvas.eventBus.fire('element.hover', { element })
    expect(tooltip()).toBeNull()
    vi.advanceTimersByTime(299)
    expect(tooltip()).toBeNull()
    vi.advanceTimersByTime(1)
    expect(tooltip()?.textContent).toContain('Audit trail')
    expect(tooltip()?.textContent).toContain('Log block')

    canvas.eventBus.fire('element.out', { element })
    expect(tooltip()).toBeNull()

    canvas.eventBus.fire('element.hover', { element })
    canvas.eventBus.fire('drag.start')
    vi.advanceTimersByTime(300)
    expect(tooltip()).toBeNull()
    canvas.eventBus.fire('drag.end')

    canvas.select(element)
    canvas.eventBus.fire('element.hover', { element })
    vi.advanceTimersByTime(300)
    expect(tooltip()).toBeNull()

    canvas.select(null)
    canvas.eventBus.fire('element.hover', { element })
    vi.advanceTimersByTime(300)
    expect(tooltip()).not.toBeNull()

    harness.destroy()
    harness = null
    expect(tooltip()).toBeNull()
  })
})

// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import EventBus from 'diagram-js/lib/core/EventBus'
import type { Shape } from 'diagram-js/lib/model/Types'

import { getArisSymbolDescriptors } from '../symbols'
import { ArisRenderer } from './renderer'
import { bootCanvas, type Harness } from './testing/harness'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

function create(
  objectType: string,
  symbolNum: string,
  size: { readonly width: number; readonly height: number },
  name = 'Caption'
): Element {
  const created = harness!.canvas.authoring.createObject({
    objectType,
    symbolNum,
    name,
    position: { x: 0, y: 0 },
    size
  })
  const gfx = harness!.canvas.elementRegistry.getGraphics(created.occurrenceId)
  const group = gfx.querySelector('[data-aris-kind="occurrence"]')
  if (!group) throw new Error(`No occurrence SVG for ${objectType}:${symbolNum}.`)
  return group
}

describe('DMT descriptor-driven canvas rendering', () => {
  it('renders the complete 36-presentation shared-preview gallery from catalogId', () => {
    const renderer = new ArisRenderer(new EventBus())
    const fingerprints = new Set<string>()

    for (const descriptor of getArisSymbolDescriptors()) {
      const parent = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      const shape = {
        width: 140,
        height: 90,
        businessObject: {
          kind: 'occurrence',
          modelId: 'Model.gallery',
          modelType: descriptor.modelType,
          occurrenceId: `preview:${descriptor.catalogId}`,
          definitionId: `preview:${descriptor.catalogId}`,
          objectType: descriptor.objectType,
          symbolNum: descriptor.symbolNum,
          catalogId: descriptor.catalogId,
          name: descriptor.accessibleLabel,
          style: {
            fillColor: null,
            strokeColor: null,
            strokeWidth: null,
            lineStyle: null
          }
        }
      } as unknown as Shape

      const group = renderer.drawShape(parent, shape)
      expect(group.getAttribute('data-aris-catalog-id')).toBe(descriptor.catalogId)
      expect(group.getAttribute('data-aris-icon')).toBe(descriptor.icon)
      expect(group.getAttribute('data-aris-silhouette')).toBe(descriptor.silhouette)
      expect(group.getAttribute('data-aris-operator')).toBe(descriptor.operator ?? 'none')
      expect(group.querySelectorAll(':scope > [data-aris-part]').length).toBeGreaterThanOrEqual(
        descriptor.drawing.elements.length
      )
      expect(group.getAttribute('aria-label')).toContain(descriptor.accessibleLabel)
      fingerprints.add(
        [
          group.getAttribute('data-aris-catalog-id'),
          group.getAttribute('data-aris-silhouette'),
          group.getAttribute('data-aris-icon'),
          group.getAttribute('data-aris-operator')
        ].join('|')
      )
    }

    expect(fingerprints).toHaveLength(36)
  })

  it('renders the 454×202 event as a chevron with a flag and stable metadata', () => {
    harness = bootCanvas()
    const group = create('OT_EVT', 'ST_EV', { width: 454, height: 202 }, 'Started')

    expect(group.getAttribute('data-aris-catalog-id')).toBe('epc.event')
    expect(group.getAttribute('data-aris-icon')).toBe('flag')
    expect(group.getAttribute('data-aris-silhouette')).toBe('event-chevron')
    expect(group.getAttribute('data-aris-operator')).toBe('none')
    expect(group.getAttribute('role')).toBe('img')
    expect(group.getAttribute('aria-label')).toBe('Event: Started')

    const surface = group.querySelector<SVGPolygonElement>('polygon[data-aris-part="surface"]')
    expect(surface).not.toBeNull()
    const points = surface!.getAttribute('points')!.split(' ')
    expect(points).toHaveLength(6)
    // The sixth point is the inward tail of the horizontal chevron.
    expect(Number(points[5]!.split(',')[0])).toBeGreaterThan(0)
    expect(group.querySelectorAll('[data-aris-part="icon"]').length).toBeGreaterThan(1)
  })

  it('keeps a 670×240 function icon uniform and centers its caption in the content box', () => {
    harness = bootCanvas()
    const group = create('OT_FUNC', 'ST_FUNC', { width: 670, height: 240 }, 'Register')

    const surface = group.querySelector<SVGRectElement>('rect[data-aris-part="surface"]')
    expect(surface?.getAttribute('fill')).toBe('#ffffff')
    expect(group.querySelectorAll('polygon[data-aris-part="icon"]')).toHaveLength(2)
    for (const icon of group.querySelectorAll('[data-aris-part="icon"]')) {
      expect(icon.getAttribute('fill')).toBe('#ffffff')
      expect(icon.getAttribute('vector-effect')).toBe('non-scaling-stroke')
    }

    const caption = group.querySelector<SVGTextElement>('[data-aris-part="content"]')
    expect(Number(caption?.getAttribute('x'))).toBeGreaterThan(670 / 2)
    expect(Number(caption?.getAttribute('x'))).toBeLessThan(670)
  })

  it('uses an application window rather than a monitor and does not stretch it at 530×150', () => {
    harness = bootCanvas()
    const group = create('OT_APPL_SYS', 'ST_APPL_SYS', { width: 530, height: 150 })

    expect(group.getAttribute('data-aris-icon')).toBe('application-window')
    const window = group.querySelector<SVGRectElement>('rect[data-aris-part="icon"]')
    expect(window).not.toBeNull()
    const width = Number(window!.getAttribute('width'))
    const height = Number(window!.getAttribute('height'))
    expect(width / height).toBeCloseTo(16 / 23, 3)
    // No desktop-monitor stand is authored; every line stays inside the icon tile.
    expect(
      [...group.querySelectorAll<SVGLineElement>('line[data-aris-part="icon"]')].every(
        (line) => Number(line.getAttribute('y2')) < 150
      )
    ).toBe(true)
  })

  it('keeps the person glyph contained in a 554×151 role card', () => {
    harness = bootCanvas()
    const group = create('OT_PERS_TYPE', 'ST_EMPL_TYPE', { width: 554, height: 151 })
    const head = group.querySelector<SVGCircleElement>('circle[data-aris-part="icon"]')

    expect(group.getAttribute('data-aris-icon')).toBe('person')
    expect(Number(head?.getAttribute('r'))).toBeLessThan(151 / 10)
  })

  it('renders a 140×140 rule as only the circular operator without a caption', () => {
    harness = bootCanvas()
    const group = create('OT_RULE', 'ST_OPR_XOR_1', { width: 140, height: 140 }, 'Do not draw')

    expect(group.getAttribute('data-aris-catalog-id')).toBe('decision.xor')
    expect(group.getAttribute('data-aris-silhouette')).toBe('operator-circle')
    expect(group.getAttribute('data-aris-operator')).toBe('XOR')
    expect(group.querySelector('[data-aris-caption]')).toBeNull()
    expect(group.querySelectorAll('[data-aris-part="operator"]')).toHaveLength(2)
  })

  it('renders an explicit unknown imported symbol as a visible question-mark fallback', () => {
    harness = bootCanvas()
    const group = create('OT_FUNC', 'ST_VENDOR_CUSTOM', { width: 140, height: 90 })

    expect(group.getAttribute('data-aris-fidelity')).toBe('unknown-custom-symbol')
    expect(group.getAttribute('data-aris-catalog-id')).toBe('orbitpm.unknown-symbol')
    expect(group.getAttribute('data-aris-icon')).toBe('unknown')
    expect(group.getAttribute('data-aris-silhouette')).toBe('unknown')
    expect(
      [...group.querySelectorAll('path')].some((node) =>
        node.getAttribute('d')?.startsWith('M 42 28')
      )
    ).toBe(true)
  })
})

// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import EventBus from 'diagram-js/lib/core/EventBus'
import type { Shape } from 'diagram-js/lib/model/Types'

import { getArisSymbolDescriptors } from '../symbols'
import type { DmtSymbolDescriptor } from '../symbols'
import { ArisRenderer } from './renderer'

/**
 * Lane L-P5: descriptor strokes must scale with zoom like connection pens
 * (no `vector-effect: non-scaling-stroke`), while the `path` branch — whose
 * geometry is scaled by a group `transform: scale(sx,sy)` — divides its
 * emitted width by that transform scale so the painted width still equals the
 * authored user-unit width. Operator marks additionally carry round line caps.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

function descriptorFor(catalogId: string): DmtSymbolDescriptor {
  const descriptor = getArisSymbolDescriptors().find((entry) => entry.catalogId === catalogId)
  if (!descriptor) throw new Error(`No descriptor for ${catalogId}.`)
  return descriptor
}

function draw(catalogId: string, width: number, height: number): SVGElement {
  const descriptor = descriptorFor(catalogId)
  const renderer = new ArisRenderer(new EventBus())
  const parent = document.createElementNS(SVG_NS, 'g')
  const shape = {
    width,
    height,
    businessObject: {
      kind: 'occurrence',
      modelId: 'Model.stroke',
      modelType: descriptor.modelType,
      occurrenceId: `stroke:${catalogId}`,
      definitionId: `stroke:${catalogId}`,
      objectType: descriptor.objectType,
      symbolNum: descriptor.symbolNum,
      catalogId,
      name: '',
      style: {
        fillColor: null,
        strokeColor: null,
        strokeWidth: null,
        lineStyle: null
      }
    }
  } as unknown as Shape
  return renderer.drawShape(parent, shape)
}

/** The `(sx + sy) / 2` transform scale parsed back off a rendered `path`. */
function pathTransformScale(pathEl: Element): number {
  const transform = pathEl.getAttribute('transform') ?? ''
  const match = /scale\(([-0-9.]+),([-0-9.]+)\)/.exec(transform)
  if (!match) throw new Error(`No scale in transform: ${transform}`)
  return (Math.abs(Number(match[1])) + Math.abs(Number(match[2]))) / 2
}

describe('drawPrimitive — strokes scale with zoom (no non-scaling-stroke)', () => {
  it('emits no vector-effect on any element of an XOR rule occurrence', () => {
    const group = draw('decision.xor', 80, 80)
    expect(group.querySelectorAll('[vector-effect]')).toHaveLength(0)
  })

  it('keeps the XOR X arms at their authored stroke-width 11 (line branch)', () => {
    const group = draw('decision.xor', 80, 80)
    const lines = [...group.querySelectorAll('line')]
    expect(lines.length).toBeGreaterThanOrEqual(2)
    for (const line of lines) {
      expect(line.getAttribute('stroke-width')).toBe('11')
    }
  })

  it('divides a scaled icon path width by its group transform so painted width equals authored', () => {
    const descriptor = descriptorFor('epc.system-function')
    const authoredWidths = descriptor.drawing.elements
      .filter((element) => element.kind === 'path' && (element.strokeWidth ?? 0) > 0)
      .map((element) => element.strokeWidth as number)
    expect(authoredWidths.length).toBeGreaterThan(0)

    const group = draw('epc.system-function', 670, 240)
    const iconPaths = [...group.querySelectorAll('path[data-aris-part="icon"]')].filter(
      (path) => Number(path.getAttribute('stroke-width')) > 0
    )
    expect(iconPaths).toHaveLength(authoredWidths.length)

    iconPaths.forEach((path, index) => {
      const emitted = Number(path.getAttribute('stroke-width'))
      const scale = pathTransformScale(path)
      // The transform up-scales the icon (> 1×), so a non-compensated width
      // would paint far too thick; the compensation shrinks the attribute.
      expect(scale).toBeGreaterThan(1)
      expect(emitted).toBeLessThan(authoredWidths[index])
      expect(Math.abs(emitted * scale - authoredWidths[index])).toBeLessThanOrEqual(1e-3)
    })
  })
})

describe('operator marks — round line caps', () => {
  it('gives the XOR X arms round caps', () => {
    const group = draw('decision.xor', 80, 80)
    const lines = [...group.querySelectorAll('line')]
    for (const line of lines) {
      expect(line.getAttribute('stroke-linecap')).toBe('round')
    }
  })

  it('gives the AND operator mark path a round cap', () => {
    const group = draw('decision.and', 80, 80)
    const marks = [...group.querySelectorAll('path[data-aris-part="operator"]')]
    expect(marks.length).toBeGreaterThan(0)
    for (const mark of marks) {
      expect(mark.getAttribute('stroke-linecap')).toBe('round')
    }
  })

  it('does not add a line cap to ordinary icon lines', () => {
    const group = draw('epc.system-function', 670, 240)
    const iconLines = [...group.querySelectorAll('line[data-aris-part="icon"]')]
    expect(iconLines.length).toBeGreaterThan(0)
    for (const line of iconLines) {
      expect(line.getAttribute('stroke-linecap')).toBeNull()
    }
  })
})

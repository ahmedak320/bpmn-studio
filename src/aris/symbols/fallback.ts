import type { ArisPortName, ArisSymbolDescriptor } from './types'

function port(name: ArisPortName, nx: number, ny: number) {
  return Object.freeze({ name, nx, ny })
}

function freezeDescriptor(descriptor: ArisSymbolDescriptor): ArisSymbolDescriptor {
  return Object.freeze(descriptor)
}

/**
 * Visible fallback symbol for unknown/custom ARIS symbols.
 *
 * The fallback is deliberately generic: a rounded rectangle containing a question mark
 * and diagonal hatching.  It is never a silent blank or a silent substitution of a
 * different real symbol, and every use is reported as a fidelity finding.
 */
export const UNKNOWN_SYMBOL_DESCRIPTOR: ArisSymbolDescriptor = freezeDescriptor({
  key: 'orbitpm:unknown-symbol',
  objectType: 'OT_UNKNOWN',
  symbolNum: 'ST_UNKNOWN',
  labelKey: 'aris.symbol.unknown',
  defaultBounds: { width: 100, height: 80 },
  ports: [
    port('NW', 0, 0),
    port('N', 0.5, 0),
    port('NE', 1, 0),
    port('E', 1, 0.5),
    port('SE', 1, 1),
    port('S', 0.5, 1),
    port('SW', 0, 1),
    port('W', 0, 0.5),
    port('CENTER', 0.5, 0.5)
  ],
  drawing: {
    viewBox: { minX: 0, minY: 0, width: 100, height: 80 },
    elements: [
      { kind: 'rect', x: 5, y: 5, width: 90, height: 70, rx: 8, ry: 8, fill: '#f3f4f6', stroke: '#dc2626', strokeWidth: 2 },
      { kind: 'line', x1: 15, y1: 15, x2: 85, y2: 65, stroke: '#fca5a5', strokeWidth: 2 },
      { kind: 'line', x1: 85, y1: 15, x2: 15, y2: 65, stroke: '#fca5a5', strokeWidth: 2 },
      {
        kind: 'path',
        d: 'M 42 28 C 42 20, 58 20, 58 28 C 58 34, 50 36, 50 44 M 50 52 L 50 56',
        fill: 'none',
        stroke: '#dc2626',
        strokeWidth: 3
      }
    ]
  }
})

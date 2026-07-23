import { describe, it, expect } from 'vitest'
import { clampPalettePos, parsePalettePos } from '../editor/paletteDrag'

// paletteDrag.ts also exports installPaletteDrag, which wires pointer/
// MutationObserver/ResizeObserver DOM behavior — this suite runs with
// environment: 'node' (no jsdom, per vitest.config.ts), so only the pure,
// DOM-free geometry/parsing helpers below are exercised here.

describe('clampPalettePos', () => {
  // A palette comfortably smaller than its container on both axes, used as
  // the shared baseline for the "normal" (non-edge) cases below.
  const bounds = { cw: 800, ch: 600, pw: 48, ph: 300 }

  it('leaves an already-inside position untouched', () => {
    expect(clampPalettePos({ left: 100, top: 100 }, bounds)).toEqual({ left: 100, top: 100 })
  })

  it('leaves the top-left corner (0,0) untouched', () => {
    expect(clampPalettePos({ left: 0, top: 0 }, bounds)).toEqual({ left: 0, top: 0 })
  })

  it('allows the exact bottom-right resting position (container size minus palette size)', () => {
    // max left = 800 - 48 = 752, max top = 600 - 300 = 300 — the boundary
    // itself must stay in bounds, not get nudged inward by an off-by-one.
    expect(clampPalettePos({ left: 752, top: 300 }, bounds)).toEqual({ left: 752, top: 300 })
  })

  it('clamps negative coordinates up to 0 on both axes', () => {
    expect(clampPalettePos({ left: -50, top: -20 }, bounds)).toEqual({ left: 0, top: 0 })
  })

  it('clamps an overflowing position back to the max in-bounds left/top', () => {
    expect(clampPalettePos({ left: 10_000, top: 10_000 }, bounds)).toEqual({ left: 752, top: 300 })
  })

  it('clamps each axis independently', () => {
    expect(clampPalettePos({ left: -10, top: 10_000 }, bounds)).toEqual({ left: 0, top: 300 })
  })

  it('pins left to 0 when the container is narrower than the palette', () => {
    const tight = { cw: 30, ch: 600, pw: 48, ph: 300 }
    expect(clampPalettePos({ left: 100, top: 100 }, tight)).toEqual({ left: 0, top: 100 })
  })

  it('pins top to 0 when the container is shorter than the palette', () => {
    const tight = { cw: 800, ch: 200, pw: 48, ph: 300 }
    expect(clampPalettePos({ left: 100, top: 100 }, tight)).toEqual({ left: 100, top: 0 })
  })

  it('pins both axes to 0 when the container is smaller than the palette on both dimensions', () => {
    const tiny = { cw: 20, ch: 20, pw: 48, ph: 300 }
    expect(clampPalettePos({ left: -5, top: 9000 }, tiny)).toEqual({ left: 0, top: 0 })
  })

  it('treats an exact size match (container === palette) as a single valid point at 0', () => {
    const exact = { cw: 48, ch: 300, pw: 48, ph: 300 }
    expect(clampPalettePos({ left: 5, top: 5 }, exact)).toEqual({ left: 0, top: 0 })
  })
})

describe('parsePalettePos', () => {
  it('parses a well-formed {left, top} JSON payload', () => {
    expect(parsePalettePos('{"left":120,"top":45}')).toEqual({ left: 120, top: 45 })
  })

  it('accepts 0 and negative numbers as valid coordinates (clamping is a separate step)', () => {
    expect(parsePalettePos('{"left":-5,"top":0}')).toEqual({ left: -5, top: 0 })
  })

  it('ignores extra unknown fields', () => {
    expect(parsePalettePos('{"left":1,"top":2,"extra":"field"}')).toEqual({ left: 1, top: 2 })
  })

  it('returns null for null input (nothing stored yet)', () => {
    expect(parsePalettePos(null)).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parsePalettePos('')).toBeNull()
  })

  it('returns null for syntactically invalid JSON', () => {
    expect(parsePalettePos('{left: 1, top: 2')).toBeNull()
  })

  it('returns null for JSON null', () => {
    // typeof null === 'object' is the classic JS quirk this guards against.
    expect(parsePalettePos('null')).toBeNull()
  })

  it('returns null for valid JSON that is not an object (a bare number)', () => {
    expect(parsePalettePos('42')).toBeNull()
  })

  it('returns null for valid JSON that is not an object (a bare string)', () => {
    expect(parsePalettePos('"hello"')).toBeNull()
  })

  it('returns null for valid JSON that is not an object (an array)', () => {
    expect(parsePalettePos('[1,2]')).toBeNull()
  })

  it('returns null when a field is missing', () => {
    expect(parsePalettePos('{"left":10}')).toBeNull()
  })

  it('returns null when a field has the wrong type', () => {
    expect(parsePalettePos('{"left":"10","top":5}')).toBeNull()
  })

  it('returns null for non-finite numbers', () => {
    // JSON has no Infinity literal, but JSON.parse legitimately produces the
    // number Infinity for an exponent this large — Number.isFinite catches
    // it so an out-of-range payload can't send the palette off to
    // undefined/unrenderable coordinates.
    expect(parsePalettePos('{"left":1e400,"top":5}')).toBeNull()
  })
})

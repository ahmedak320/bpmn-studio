import { expect, type Page } from '@playwright/test'

/**
 * Shared helpers for the authorized DMT-symbol-library palette rework
 * (`src/aris/canvas/dmtLibrary.css`): the palette is now a ~360px rail that
 * floats over the leading edge of the canvas, and the minimap floats top-right.
 * After Zoom Fit a real occurrence — or the fraction-based "empty canvas" point
 * older specs used — can land underneath one of those overlays, where a pointer
 * event is intercepted by the overlay instead of the diagram. A person pans the
 * canvas to bring the target into the clear; these helpers do the same with
 * ZoomScroll wheel pans (which never grab a shape), then hand back a viewport
 * point that is verified clear of both overlays.
 */

interface OverlayMeasurement {
  readonly canvas: { x: number; y: number; w: number; h: number; right: number; bottom: number }
  readonly cx: number
  readonly cy: number
  readonly overPalette: boolean
  readonly overMinimap: boolean
  readonly inside: boolean
  /** A point on the shape's OWN hit area, clear of every overlay — null if none. */
  readonly clickPoint: { x: number; y: number } | null
}

async function measureOccurrence(
  page: Page,
  occurrenceId: string
): Promise<OverlayMeasurement | null> {
  return page.evaluate((id) => {
    // Several tabs keep their canvas mounted at once (state-preserving), so
    // target whichever `[data-orbitpm-aris-canvas]` is actually laid out.
    const canvas =
      [...document.querySelectorAll<HTMLElement>('[data-orbitpm-aris-canvas]')].find((node) => {
        const rect = node.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      }) ?? document.querySelector('[data-orbitpm-aris-canvas]')
    const gfx = canvas?.querySelector(`g.djs-element[data-element-id="${id}"]`)
    if (!canvas || !gfx) return null
    const cr = canvas.getBoundingClientRect()
    const r = gfx.getBoundingClientRect()
    const cx = r.x + r.width / 2
    const cy = r.y + r.height / 2
    const centre = document.elementFromPoint(cx, cy)

    // A point where the shape's own gfx is the topmost element — i.e. not covered
    // by the palette, the minimap, or an attached connection's hit-stroke that
    // crosses the shape's centre. Scanned over the bbox so a shape whose centre a
    // connection runs through still yields a clickable corner.
    let clickPoint: { x: number; y: number } | null = null
    for (const fy of [0.5, 0.35, 0.65, 0.25, 0.75]) {
      for (const fx of [0.5, 0.3, 0.7, 0.22, 0.78]) {
        const px = r.x + r.width * fx
        const py = r.y + r.height * fy
        if (px < cr.x + 2 || px > cr.right - 2 || py < cr.y + 2 || py > cr.bottom - 2) continue
        const hit = document.elementFromPoint(px, py)
        if (!hit || hit.closest('.djs-palette') || hit.closest('.djs-minimap')) continue
        const owner = hit.closest('g.djs-element')
        if (owner && owner.getAttribute('data-element-id') === id) {
          clickPoint = { x: px, y: py }
          break
        }
      }
      if (clickPoint) break
    }

    return {
      canvas: { x: cr.x, y: cr.y, w: cr.width, h: cr.height, right: cr.right, bottom: cr.bottom },
      cx,
      cy,
      overPalette: !!(centre && centre.closest('.djs-palette')),
      overMinimap: !!(centre && centre.closest('.djs-minimap')),
      inside: cx > cr.x + 2 && cx < cr.right - 2 && cy > cr.y + 2 && cy < cr.bottom - 2,
      clickPoint
    }
  }, occurrenceId)
}

/**
 * Fits the active model, then wheel-pans until the occurrence's centre is inside
 * the canvas and clear of the palette and minimap, and returns that point. The
 * caller must have made the occurrence's owning model active first (a canvas
 * click does not switch models).
 */
export async function revealOccurrencePoint(
  page: Page,
  occurrenceId: string,
  options: { fitLabel?: string; fit?: boolean } = {}
): Promise<{ x: number; y: number }> {
  const { fitLabel = 'Zoom Fit', fit = true } = options
  if (fit) {
    await page.getByRole('button', { name: fitLabel, exact: true }).click()
  }
  await page
    .locator(`[data-orbitpm-aris-canvas]:visible g.djs-element[data-element-id="${occurrenceId}"]`)
    .waitFor({ state: 'attached', timeout: 30_000 })

  let state = await measureOccurrence(page, occurrenceId)
  if (!state) throw new Error(`occurrence ${occurrenceId} is not on the canvas`)

  for (let step = 0; step < 28; step += 1) {
    state = await measureOccurrence(page, occurrenceId)
    if (!state) throw new Error(`occurrence ${occurrenceId} left the canvas while panning`)
    if (state.inside && state.clickPoint !== null) break

    // Park the pointer on a guaranteed-clear point (right of the leading-edge
    // palette, below the top-right minimap) so ZoomScroll — which is bound to
    // the diagram, not the palette — receives the wheel.
    await page.mouse.move(state.canvas.right - 30, state.canvas.y + state.canvas.h * 0.5)

    // Palette floats at the leading (left) edge; push content right off it (with
    // margin so the shape's whole width clears), and pull back if it drifts off
    // the trailing edge.
    let dx = 0
    if (state.overPalette || state.cx < state.canvas.x + 460) dx = -140
    else if (state.cx > state.canvas.right - 60) dx = 140

    // Minimap floats top-right; lift the shape off the top band, and off the
    // very bottom where the tall palette can also reach.
    let dy = 0
    if (state.overMinimap || state.cy < state.canvas.y + state.canvas.h * 0.18) dy = -140
    else if (state.cy > state.canvas.bottom - state.canvas.h * 0.15) dy = 140

    if (dx === 0 && dy === 0) dx = -140
    await page.mouse.wheel(dx, dy)
    await page.waitForTimeout(120)
  }

  expect(
    state.clickPoint,
    `no clear pointer target on occurrence ${occurrenceId} after panning`
  ).not.toBeNull()
  return state.clickPoint as { x: number; y: number }
}

/** Fits, pans clear of the palette/minimap, then clicks the occurrence to select it. */
export async function selectOccurrenceOnCanvas(
  page: Page,
  occurrenceId: string,
  options: { fitLabel?: string } = {}
): Promise<void> {
  const point = await revealOccurrencePoint(page, occurrenceId, options)
  await page.mouse.click(point.x, point.y)
}

/**
 * A viewport point on empty canvas that is clear of the palette (leading edge)
 * and the minimap (top-right) — for gestures older specs aimed at a fixed
 * fraction of the canvas box that the ~360px palette now covers. Scans the
 * trailing side of the canvas for a background point and returns it.
 */
export async function clearCanvasPoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(() => {
    const canvas =
      [...document.querySelectorAll<HTMLElement>('[data-orbitpm-aris-canvas]')].find((node) => {
        const rect = node.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      }) ?? document.querySelector('[data-orbitpm-aris-canvas]')
    if (!canvas) return null
    const cr = canvas.getBoundingClientRect()
    // Prefer a centre-right point that leaves room to the trailing edge for a
    // small drag, while staying clear of the leading-edge palette.
    for (const fx of [0.68, 0.62, 0.74, 0.58, 0.8]) {
      for (const fy of [0.5, 0.4, 0.6, 0.35, 0.55]) {
        const x = cr.x + cr.width * fx
        const y = cr.y + cr.height * fy
        const el = document.elementFromPoint(x, y)
        if (!el) continue
        if (el.closest('.djs-palette') || el.closest('.djs-minimap')) continue
        if (el.closest('g.djs-element')) continue
        return { x, y }
      }
    }
    return null
  })
  if (!point) throw new Error('no empty canvas point clear of the palette/minimap was found')
  return point
}

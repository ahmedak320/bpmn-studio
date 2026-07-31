/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest'

import {
  arisExportRasterSize,
  arisPdfFileName,
  arisPdfPageGeometry,
  arisSvgToPngDataUrl,
  buildArisExportSvgMarkup,
  createArisDiagramPdf,
  deterministicArisPdfFileId,
  findArisCanvasSvg,
  type ArisCanvasLike
} from './exportArisPdf'

/**
 * Ported from the main branch's `src/editor/__tests__/exportPdf.test.ts`
 * (deterministic geometry/file-id/byte tests) and extended for the ARIS-side
 * live-DOM SVG capture (viewport-transform neutralization, interaction-node
 * stripping, bounds-driven viewBox). `measureArisCanvasSvgBounds` needs a real
 * layout engine (`getBBox`), so it is covered by the Sequence-1 browser test
 * instead of jsdom.
 */

const ONE_PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

const SVG_NS = 'http://www.w3.org/2000/svg'

/** A minimal diagram-js-shaped SVG: root svg > g.viewport(transform) > content + furniture. */
function fakeCanvasSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', '100%')
  svg.setAttribute('tabindex', '0')
  const viewport = document.createElementNS(SVG_NS, 'g')
  viewport.setAttribute('class', 'viewport')
  viewport.setAttribute('transform', 'matrix(0.5 0 0 0.5 -100 -200)')
  const layer = document.createElementNS(SVG_NS, 'g')
  layer.setAttribute('class', 'layer-aris-print-frame')
  const rect = document.createElementNS(SVG_NS, 'rect')
  rect.setAttribute('x', '10')
  rect.setAttribute('y', '20')
  rect.setAttribute('width', '300')
  rect.setAttribute('height', '150')
  rect.setAttribute('fill', '#c8e6c9')
  layer.appendChild(rect)
  const outline = document.createElementNS(SVG_NS, 'rect')
  outline.setAttribute('class', 'djs-outline no-fill')
  layer.appendChild(outline)
  const dragger = document.createElementNS(SVG_NS, 'g')
  dragger.setAttribute('class', 'djs-bendpoint')
  layer.appendChild(dragger)
  viewport.appendChild(layer)
  svg.appendChild(viewport)
  return svg
}

describe('arisPdfPageGeometry', () => {
  it('bounds oversized diagrams while retaining their aspect ratio', () => {
    const geometry = arisPdfPageGeometry({ width: 8_000, height: 4_000 })
    expect(geometry.pageWidth).toBe(2_000)
    expect(geometry.imageWidth / geometry.imageHeight).toBeCloseTo(2)
    expect(geometry.imageX).toBe(18)
    expect(geometry.imageY).toBe(18)
  })

  it('falls back for non-positive sizes', () => {
    const geometry = arisPdfPageGeometry({ width: 0, height: Number.NaN })
    expect(geometry.pageWidth).toBe(800 + 36)
    expect(geometry.pageHeight).toBe(600 + 36)
  })
})

describe('deterministicArisPdfFileId', () => {
  it('derives a stable, valid jsPDF file ID', () => {
    const id = deterministicArisPdfFileId('diagram')
    expect(id).toMatch(/^[A-F0-9]{32}$/)
    expect(deterministicArisPdfFileId('diagram')).toBe(id)
    expect(deterministicArisPdfFileId('different')).not.toBe(id)
  })
})

describe('createArisDiagramPdf', () => {
  it('produces byte-identical PDFs for identical inputs', () => {
    const first = new Uint8Array(
      createArisDiagramPdf(ONE_PIXEL_PNG, { width: 100, height: 100 }, 'A')
    )
    const second = new Uint8Array(
      createArisDiagramPdf(ONE_PIXEL_PNG, { width: 100, height: 100 }, 'A')
    )

    // Realm-agnostic byte compares: TextEncoder's Uint8Array comes from a
    // different realm than the test file's in the jsdom environment, and
    // cross-realm typed-array toEqual fails even with identical bytes.
    expect(new TextDecoder().decode(first.slice(0, 8))).toBe('%PDF-1.3')
    expect(Array.from(second)).toEqual(Array.from(first))
  })
})

describe('buildArisExportSvgMarkup', () => {
  it('neutralizes the view transform and sets the padded bounds as the viewBox', () => {
    const markup = buildArisExportSvgMarkup(fakeCanvasSvg(), {
      x: 10,
      y: 20,
      width: 300,
      height: 150
    })
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml')
    const svg = parsed.documentElement

    expect(svg.tagName).toBe('svg')
    expect(svg.getAttribute('width')).toBe(String(300 + 48))
    expect(svg.getAttribute('height')).toBe(String(150 + 48))
    expect(svg.getAttribute('viewBox')).toBe(`${10 - 24} ${20 - 24} ${300 + 48} ${150 + 48}`)
    expect(svg.getAttribute('tabindex')).toBeNull()

    const viewport = svg.querySelector('g.viewport')
    expect(viewport).not.toBeNull()
    expect(viewport!.getAttribute('transform')).toBeNull()
  })

  it('strips interaction-only nodes but keeps the rendered content', () => {
    const markup = buildArisExportSvgMarkup(fakeCanvasSvg(), {
      x: 0,
      y: 0,
      width: 100,
      height: 100
    })
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml')

    expect(parsed.querySelector('.djs-outline')).toBeNull()
    expect(parsed.querySelector('.djs-bendpoint')).toBeNull()
    const content = parsed.querySelector('rect[fill="#c8e6c9"]')
    expect(content).not.toBeNull()
    expect(content!.getAttribute('width')).toBe('300')
  })

  it('serializes Arabic caption text without loss', () => {
    const svg = fakeCanvasSvg()
    const text = document.createElementNS(SVG_NS, 'text')
    text.textContent = 'تسجيل ملف مالك حيوان'
    svg.querySelector('g.viewport')!.appendChild(text)
    const markup = buildArisExportSvgMarkup(svg, { x: 0, y: 0, width: 50, height: 50 })
    expect(markup).toContain('تسجيل ملف مالك حيوان')
  })
})

describe('findArisCanvasSvg', () => {
  it('returns the container’s direct-child svg, not a nested one', () => {
    const container = document.createElement('div')
    const wrapper = document.createElement('div')
    wrapper.appendChild(document.createElementNS(SVG_NS, 'svg'))
    container.appendChild(wrapper)
    const main = document.createElementNS(SVG_NS, 'svg')
    container.appendChild(main)
    expect(findArisCanvasSvg(container)).toBe(main)
  })

  it('throws when the container has no canvas svg', () => {
    expect(() => findArisCanvasSvg(document.createElement('div'))).toThrow(/No rendered ARIS/)
  })
})

describe('arisExportRasterSize', () => {
  it('keeps sizes under the cap 1:1 and bounds larger ones uniformly', () => {
    expect(arisExportRasterSize({ width: 7_000, height: 4_500 })).toEqual({
      width: 7_000,
      height: 4_500
    })
    const bounded = arisExportRasterSize({ width: 20_000, height: 10_000 })
    expect(bounded.width).toBe(8_192)
    expect(bounded.width / bounded.height).toBeCloseTo(2)
  })
})

describe('arisSvgToPngDataUrl', () => {
  function fakeDeps(drawn: string[]): {
    createCanvas: (width: number, height: number) => ArisCanvasLike
    loadImage: (svgDataUrl: string) => Promise<unknown>
  } {
    return {
      createCanvas: (width, height) => ({
        width,
        height,
        getContext: () => ({
          fillStyle: '',
          fillRect: () => drawn.push('fill'),
          drawImage: () => drawn.push('draw')
        }),
        toDataURL: () => ONE_PIXEL_PNG
      }),
      loadImage: (svgDataUrl) => {
        drawn.push(svgDataUrl.startsWith('data:image/svg+xml') ? 'svg-load' : 'bad-load')
        return Promise.resolve({})
      }
    }
  }

  it('fills the background, draws the decoded SVG and returns the PNG data URL', async () => {
    const drawn: string[] = []
    const result = await arisSvgToPngDataUrl('<svg/>', { width: 10, height: 10 }, fakeDeps(drawn))
    expect(result).toBe(ONE_PIXEL_PNG)
    expect(drawn).toEqual(['fill', 'svg-load', 'draw'])
  })

  it('rejects non-positive export sizes', async () => {
    await expect(
      arisSvgToPngDataUrl('<svg/>', { width: 0, height: 10 }, fakeDeps([]))
    ).rejects.toThrow(/Invalid export size/)
  })
})

describe('arisPdfFileName', () => {
  it('combines the source base name with a sanitized model name', () => {
    expect(arisPdfFileName('ARISAMLExport.xml', 'Register Animal/Owner: Profile')).toBe(
      'ARISAMLExport-Register-Animal-Owner-Profile.pdf'
    )
    expect(arisPdfFileName('export', '')).toBe('export.pdf')
    expect(arisPdfFileName('  ', 'Model')).toBe('export-Model.pdf')
  })
})

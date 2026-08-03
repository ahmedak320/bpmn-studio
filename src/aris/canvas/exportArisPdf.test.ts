/**
 * @vitest-environment jsdom
 */

import { inflateSync } from 'node:zlib'

import { describe, expect, it, vi } from 'vitest'

import {
  arisExportRasterSize,
  arisPdfFileName,
  arisPdfPageGeometry,
  arisSvgToPngDataUrl,
  arisTextRunsContainArabic,
  buildArisExportSvgMarkup,
  captureArisCanvasSvg,
  createArisDiagramPdf,
  deterministicArisPdfFileId,
  findArisCanvasSvg,
  type ArisCanvasLike,
  type ArisPdfTextRun
} from './exportArisPdf'
import { arisArabicOverlayFont } from './exportArisPdfArabicFont'

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

  it('leaves the raster path byte-identical when the overlay is empty', () => {
    const withoutOption = new Uint8Array(
      createArisDiagramPdf(ONE_PIXEL_PNG, { width: 100, height: 100 }, 'A')
    )
    const withEmptyRuns = new Uint8Array(
      createArisDiagramPdf(ONE_PIXEL_PNG, { width: 100, height: 100 }, 'A', { textRuns: [] })
    )
    // An empty text layer is additive-nothing: identical bytes to the no-option call.
    expect(Array.from(withEmptyRuns)).toEqual(Array.from(withoutOption))
  })

  it('lays down an invisible text layer deterministically and only when runs exist', () => {
    const runs = [
      { text: 'Register', x: 40, y: 30, fontSize: 12, anchor: 'middle', baseline: 'middle' },
      { text: '01', x: 10, y: 60, fontSize: 8, anchor: 'start', baseline: 'alphabetic' }
    ] as const
    const withText = () =>
      new Uint8Array(
        createArisDiagramPdf(ONE_PIXEL_PNG, { width: 100, height: 100 }, 'A', {
          textRuns: runs,
          contentSize: { width: 100, height: 100 }
        })
      )
    const first = withText()
    const second = withText()
    const withoutText = new Uint8Array(
      createArisDiagramPdf(ONE_PIXEL_PNG, { width: 100, height: 100 }, 'A')
    )
    // Deterministic across runs, and materially different from the raster-only PDF.
    expect(Array.from(second)).toEqual(Array.from(first))
    expect(first.length).toBeGreaterThan(withoutText.length)
  })
})

describe('Arabic selectable-text overlay', () => {
  const HEADER_AR = 'رمز العملية'
  const LAW_ROW_AR = 'قرار (46) سنة2021 بشأن تعديل بعض احكام للائحة الرقابة على الحيوانات'
  const latinRuns: readonly ArisPdfTextRun[] = [
    { text: 'Register', x: 40, y: 30, fontSize: 12, anchor: 'middle', baseline: 'middle' },
    { text: '01', x: 10, y: 60, fontSize: 8, anchor: 'start', baseline: 'alphabetic' }
  ] as const
  const arabicRuns: readonly ArisPdfTextRun[] = [
    { text: HEADER_AR, x: 40, y: 30, fontSize: 12, anchor: 'end', baseline: 'middle' },
    { text: LAW_ROW_AR, x: 40, y: 60, fontSize: 8, anchor: 'end', baseline: 'middle' },
    { text: '01', x: 10, y: 90, fontSize: 8, anchor: 'start', baseline: 'alphabetic' }
  ] as const
  const bytes = (options: Parameters<typeof createArisDiagramPdf>[3]): Uint8Array =>
    new Uint8Array(createArisDiagramPdf(ONE_PIXEL_PNG, { width: 100, height: 100 }, 'A', options))
  const asLatin1 = (u: Uint8Array): string => new TextDecoder('latin1').decode(u)

  it('detects Arabic script in the run set', () => {
    expect(arisTextRunsContainArabic(latinRuns)).toBe(false)
    expect(arisTextRunsContainArabic(arabicRuns)).toBe(true)
    expect(arisTextRunsContainArabic(undefined)).toBe(false)
    expect(arisTextRunsContainArabic([])).toBe(false)
  })

  it('stays BYTE-IDENTICAL to the Latin-only path when no run is Arabic (font never loaded)', () => {
    const latinOnly = bytes({ textRuns: latinRuns, contentSize: { width: 100, height: 100 } })
    // Passing the font makes no difference when there is no Arabic to render:
    // the Arabic path never activates, so the bytes match the font-less output.
    const withFontButNoArabic = bytes({
      textRuns: latinRuns,
      contentSize: { width: 100, height: 100 },
      arabicFont: arisArabicOverlayFont
    })
    expect(Array.from(withFontButNoArabic)).toEqual(Array.from(latinOnly))
    // And the font is genuinely absent — no embedded CID font object.
    expect(asLatin1(latinOnly)).not.toContain('CIDFontType2')
    expect(asLatin1(latinOnly)).not.toContain(arisArabicOverlayFont.fontName)
  })

  it('embeds the subset only when it is supplied (font-only-loaded-when-needed)', () => {
    // Arabic runs but NO font supplied (module not imported): the export must not
    // embed any font — proving the font is inert until the caller lazy-loads it.
    const arabicNoFont = bytes({
      textRuns: arabicRuns,
      contentSize: { width: 100, height: 100 }
    })
    expect(asLatin1(arabicNoFont)).not.toContain('CIDFontType2')
    // Same runs WITH the font supplied: the subset is embedded and selected.
    const arabicWithFont = bytes({
      textRuns: arabicRuns,
      contentSize: { width: 100, height: 100 },
      arabicFont: arisArabicOverlayFont
    })
    const text = asLatin1(arabicWithFont)
    expect(text).toContain('CIDFontType2')
    expect(text).toContain(arisArabicOverlayFont.fontName)
    // Embedding the font necessarily changes the bytes vs the font-less variant.
    expect(arabicWithFont.length).toBeGreaterThan(arabicNoFont.length)
  })

  it('is deterministic for identical Arabic input (fixed font bytes + font-marked file id)', () => {
    const options = {
      textRuns: arabicRuns,
      contentSize: { width: 100, height: 100 },
      arabicFont: arisArabicOverlayFont
    }
    const first = bytes(options)
    const second = bytes(options)
    expect(Array.from(second)).toEqual(Array.from(first))
    expect(new TextDecoder().decode(first.slice(0, 8))).toBe('%PDF-1.3')
  })

  it('extracts the Arabic runs verbatim in logical order via the embedded ToUnicode map', () => {
    // Decode the CID glyph stream back through the font's ToUnicode CMap and
    // confirm every Arabic run round-trips to its exact source string — the
    // guarantee that copy/paste and search return clean logical-order Unicode.
    // The content and CMap streams are Flate-compressed, so inflate them first.
    const raw = Buffer.from(
      createArisDiagramPdf(ONE_PIXEL_PNG, { width: 100, height: 100 }, 'A', {
        textRuns: arabicRuns,
        contentSize: { width: 100, height: 100 },
        arabicFont: arisArabicOverlayFont
      })
    )
    let inflated = ''
    let cursor = 0
    while (true) {
      const start = raw.indexOf('stream', cursor)
      if (start === -1) break
      let dataStart = start + 'stream'.length
      if (raw[dataStart] === 0x0d) dataStart += 1
      if (raw[dataStart] === 0x0a) dataStart += 1
      const end = raw.indexOf('endstream', dataStart)
      if (end === -1) break
      const slice = raw.subarray(dataStart, end)
      try {
        inflated += inflateSync(slice).toString('latin1')
      } catch {
        // Not a Flate stream (e.g. the raster image) — skip it.
      }
      cursor = end + 'endstream'.length
    }

    const gidToUnicode = new Map<number, string>()
    const hexToStr = (hex: string): string => {
      let s = ''
      for (let i = 0; i < hex.length; i += 4) {
        s += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16))
      }
      return s
    }
    for (const r of inflated.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      gidToUnicode.set(Number.parseInt(r[1], 16), hexToStr(r[2]))
    }
    const decodeRun = (hex: string): string => {
      let s = ''
      for (let i = 0; i < hex.length; i += 4) {
        s += gidToUnicode.get(Number.parseInt(hex.slice(i, i + 4), 16)) ?? '�'
      }
      return s
    }
    const decoded = Array.from(inflated.matchAll(/<([0-9a-fA-F]+)>\s*Tj/g)).map((r) =>
      decodeRun(r[1])
    )
    // The two Arabic runs survive verbatim; order is logical (not reversed).
    expect(decoded).toContain(HEADER_AR)
    expect(decoded).toContain(LAW_ROW_AR)
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

describe('captureArisCanvasSvg options (headless render seam)', () => {
  const containerWith = (svg: SVGSVGElement): HTMLElement => {
    const container = document.createElement('div')
    container.appendChild(svg)
    return container
  }

  it('uses provided bounds and skips the getBBox measurement entirely', () => {
    const svg = fakeCanvasSvg()
    // Prove `measureArisCanvasSvgBounds` is not consulted: if it were, this
    // throwing `getBBox` on the viewport would surface.
    const viewport = svg.querySelector('g.viewport') as unknown as SVGGraphicsElement
    viewport.getBBox = () => {
      throw new Error('getBBox must not be called when bounds are provided')
    }
    const capture = captureArisCanvasSvg(containerWith(svg), {
      bounds: { x: 10, y: 20, width: 300, height: 150 },
      includeTextRuns: false
    })

    // Exactly the viewBox `buildArisExportSvgMarkup` implies for these bounds
    // at the default 24-unit padding, and the matching padded pixel size.
    const parsed = new DOMParser().parseFromString(capture.markup, 'image/svg+xml')
    expect(parsed.documentElement.getAttribute('viewBox')).toBe(
      `${10 - 24} ${20 - 24} ${300 + 48} ${150 + 48}`
    )
    expect(capture.size).toEqual({ width: 300 + 48, height: 150 + 48 })
  })

  it('returns no text runs and never enters the getScreenCTM chain when includeTextRuns is false', () => {
    const svg = fakeCanvasSvg()
    const text = document.createElementNS(SVG_NS, 'text')
    text.textContent = 'Register'
    svg.querySelector('g.viewport')!.appendChild(text)
    const viewport = svg.querySelector('g.viewport') as unknown as SVGGraphicsElement
    const spy = vi.fn(() => null)
    viewport.getScreenCTM = spy as unknown as SVGGraphicsElement['getScreenCTM']

    const capture = captureArisCanvasSvg(containerWith(svg), {
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      includeTextRuns: false
    })

    expect(capture.textRuns).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })

  it('enters the getScreenCTM chain to collect text runs by default', () => {
    const svg = fakeCanvasSvg()
    const text = document.createElementNS(SVG_NS, 'text')
    text.textContent = 'Register'
    svg.querySelector('g.viewport')!.appendChild(text)
    const viewport = svg.querySelector('g.viewport') as unknown as SVGGraphicsElement
    const spy = vi.fn(() => null)
    viewport.getScreenCTM = spy as unknown as SVGGraphicsElement['getScreenCTM']

    captureArisCanvasSvg(containerWith(svg), { bounds: { x: 0, y: 0, width: 100, height: 100 } })

    expect(spy).toHaveBeenCalled()
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

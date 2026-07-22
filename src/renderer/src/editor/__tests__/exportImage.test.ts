import { describe, expect, it, vi } from 'vitest'
import {
  computeExportSize,
  svgToDataUrl,
  svgToPngDataUrl,
  triggerDownload,
  type CanvasLike,
  type CanvasRenderingContext2DLike
} from '../exportImage'

function makeFakeCanvas(): { canvas: CanvasLike; ctx: CanvasRenderingContext2DLike } {
  const ctx: CanvasRenderingContext2DLike = {
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn()
  }
  const canvas: CanvasLike = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL: () => 'data:image/png;base64,FAKE'
  }
  return { canvas, ctx }
}

describe('svgToPngDataUrl', () => {
  it('draws a filled background then the loaded image, returning a PNG data URL', async () => {
    const { canvas, ctx } = makeFakeCanvas()
    const loadImage = vi.fn().mockResolvedValue({ fake: 'image' })

    const result = await svgToPngDataUrl(
      '<svg></svg>',
      { width: 200, height: 100 },
      { createCanvas: () => canvas, loadImage }
    )

    expect(result).toBe('data:image/png;base64,FAKE')
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 200, 100)
    expect(ctx.fillStyle).toBe('#ffffff')
    expect(loadImage).toHaveBeenCalledWith(expect.stringContaining('data:image/svg+xml'))
    expect(ctx.drawImage).toHaveBeenCalledWith({ fake: 'image' }, 0, 0, 200, 100)
  })

  it('honors a custom background color', async () => {
    const { canvas, ctx } = makeFakeCanvas()
    await svgToPngDataUrl(
      '<svg></svg>',
      { width: 10, height: 10 },
      { createCanvas: () => canvas, loadImage: async () => ({}), backgroundColor: '#123456' }
    )
    expect(ctx.fillStyle).toBe('#123456')
  })

  it('rejects a non-positive size before touching the canvas', async () => {
    const createCanvas = vi.fn()
    await expect(
      svgToPngDataUrl(
        '<svg></svg>',
        { width: 0, height: 10 },
        { createCanvas, loadImage: async () => ({}) }
      )
    ).rejects.toThrow(/Invalid export size/)
    expect(createCanvas).not.toHaveBeenCalled()
  })

  it('surfaces a missing 2D context as an error', async () => {
    const canvas: CanvasLike = {
      width: 0,
      height: 0,
      getContext: () => null,
      toDataURL: () => ''
    }
    await expect(
      svgToPngDataUrl(
        '<svg></svg>',
        { width: 10, height: 10 },
        { createCanvas: () => canvas, loadImage: async () => ({}) }
      )
    ).rejects.toThrow(/2D canvas context/)
  })
})

describe('computeExportSize', () => {
  it('pads the viewbox size', () => {
    expect(computeExportSize({ width: 400, height: 200 }, 20)).toEqual({
      width: 440,
      height: 240
    })
  })

  it('floors tiny/empty viewboxes at minSize', () => {
    expect(computeExportSize({ width: 0, height: 0 }, 20, 100)).toEqual({
      width: 100,
      height: 100
    })
  })
})

describe('svgToDataUrl', () => {
  it('encodes SVG markup as a data URL', () => {
    const url = svgToDataUrl('<svg><rect/></svg>')
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
    expect(decodeURIComponent(url.split(',')[1])).toBe('<svg><rect/></svg>')
  })
})

describe('triggerDownload', () => {
  it('creates a download anchor, clicks it, and cleans it up', () => {
    const clicked: string[] = []
    const anchor = {
      href: '',
      download: '',
      click: () => clicked.push('clicked')
    }
    const doc = {
      createElement: vi.fn().mockReturnValue(anchor),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn()
      }
    } as unknown as Document

    triggerDownload('diagram.svg', 'data:image/svg+xml,abc', doc)

    expect(anchor.href).toBe('data:image/svg+xml,abc')
    expect(anchor.download).toBe('diagram.svg')
    expect(clicked).toEqual(['clicked'])
    expect(doc.body.appendChild).toHaveBeenCalledWith(anchor)
    expect(doc.body.removeChild).toHaveBeenCalledWith(anchor)
  })
})

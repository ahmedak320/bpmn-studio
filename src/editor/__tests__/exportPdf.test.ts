import { describe, expect, it } from 'vitest'
import {
  createDeterministicDiagramPdf,
  deterministicPdfFileId,
  pdfPageGeometry
} from '../exportPdf'

const ONE_PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('direct PDF export', () => {
  it('derives a stable, valid jsPDF file ID', () => {
    const id = deterministicPdfFileId('diagram')
    expect(id).toMatch(/^[A-F0-9]{32}$/)
    expect(deterministicPdfFileId('diagram')).toBe(id)
    expect(deterministicPdfFileId('different')).not.toBe(id)
  })

  it('bounds oversized diagrams while retaining their aspect ratio', () => {
    const geometry = pdfPageGeometry({ width: 8_000, height: 4_000 })
    expect(geometry.pageWidth).toBe(2_000)
    expect(geometry.imageWidth / geometry.imageHeight).toBeCloseTo(2)
    expect(geometry.imageX).toBe(18)
    expect(geometry.imageY).toBe(18)
  })

  it('produces byte-identical PDFs for identical inputs', () => {
    const first = new Uint8Array(
      createDeterministicDiagramPdf(ONE_PIXEL_PNG, { width: 100, height: 100 }, 'A')
    )
    const second = new Uint8Array(
      createDeterministicDiagramPdf(ONE_PIXEL_PNG, { width: 100, height: 100 }, 'A')
    )

    expect(first.slice(0, 8)).toEqual(new TextEncoder().encode('%PDF-1.3'))
    expect(second).toEqual(first)
  })
})

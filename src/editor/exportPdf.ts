import { jsPDF } from 'jspdf'

export interface PdfImageSize {
  width: number
  height: number
}

export interface PdfPageGeometry {
  pageWidth: number
  pageHeight: number
  imageX: number
  imageY: number
  imageWidth: number
  imageHeight: number
}

const PDF_MARGIN_PT = 18
const PDF_MAX_SIDE_PT = 2_000
const FIXED_PDF_DATE = "D:20000101000000+00'00'"

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export function pdfPageGeometry(size: PdfImageSize): PdfPageGeometry {
  const width = finitePositive(size.width, 800)
  const height = finitePositive(size.height, 600)
  const available = PDF_MAX_SIDE_PT - PDF_MARGIN_PT * 2
  const scale = Math.min(1, available / Math.max(width, height))
  const imageWidth = Math.max(1, width * scale)
  const imageHeight = Math.max(1, height * scale)
  return {
    pageWidth: imageWidth + PDF_MARGIN_PT * 2,
    pageHeight: imageHeight + PDF_MARGIN_PT * 2,
    imageX: PDF_MARGIN_PT,
    imageY: PDF_MARGIN_PT,
    imageWidth,
    imageHeight
  }
}

function fnv1a(value: string, seed: number): number {
  let hash = seed >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** jsPDF requires an exact 32-hex-character document file ID. */
export function deterministicPdfFileId(value: string): string {
  return [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
    .map((seed) => fnv1a(value, seed).toString(16).padStart(8, '0'))
    .join('')
    .toUpperCase()
}

/**
 * Wrap the editor's faithful PNG rasterization in a direct, deterministic PDF.
 *
 * Rasterizing first is deliberate: it preserves Arabic/bidi labels, BPMN icon
 * fonts, and OrbitPM SVG decorations without requiring a second PDF font stack.
 */
export function createDeterministicDiagramPdf(
  pngDataUrl: string,
  size: PdfImageSize,
  title: string
): ArrayBuffer {
  const geometry = pdfPageGeometry(size)
  const normalizedTitle = title.trim() || 'diagram'
  const document = new jsPDF({
    orientation: geometry.pageWidth >= geometry.pageHeight ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [geometry.pageWidth, geometry.pageHeight],
    compress: true,
    precision: 6,
    floatPrecision: 16,
    putOnlyUsedFonts: true
  })
  document.setCreationDate(FIXED_PDF_DATE)
  document.setFileId(deterministicPdfFileId(`${normalizedTitle}\n${pngDataUrl}`))
  document.setProperties({
    title: normalizedTitle,
    subject: 'BPMN 2.0 process diagram',
    author: 'OrbitPM',
    creator: 'OrbitPM Process Studio Lite',
    keywords: 'BPMN 2.0, OrbitPM'
  })
  document.addImage(
    pngDataUrl,
    'PNG',
    geometry.imageX,
    geometry.imageY,
    geometry.imageWidth,
    geometry.imageHeight,
    'orbitpm-diagram',
    'FAST'
  )
  return document.output('arraybuffer')
}

// SVG -> PNG rasterization + generic "trigger a browser download" helpers.
//
// The rasterization core (`svgToPngDataUrl`) takes its canvas/image-loading
// primitives as injected dependencies so it can be unit-tested under plain
// Node (no jsdom/real <canvas> needed) by passing lightweight fakes.

export interface CanvasRenderingContext2DLike {
  fillStyle: string
  fillRect(x: number, y: number, w: number, h: number): void
  drawImage(image: unknown, x: number, y: number, w: number, h: number): void
}

export interface CanvasLike {
  width: number
  height: number
  getContext(contextId: '2d'): CanvasRenderingContext2DLike | null
  toDataURL(type?: string): string
}

export interface SvgToPngDeps {
  createCanvas: (width: number, height: number) => CanvasLike
  /** Resolves to anything `CanvasRenderingContext2D#drawImage` accepts. */
  loadImage: (svgDataUrl: string) => Promise<unknown>
  /** PNG has no transparency-by-default like SVG on a dark host page might imply; default white. */
  backgroundColor?: string
}

export interface ExportSize {
  width: number
  height: number
}

/** Turns raw SVG markup into a data: URL PNG via an offscreen canvas draw. */
export async function svgToPngDataUrl(
  svgMarkup: string,
  size: ExportSize,
  deps: SvgToPngDeps
): Promise<string> {
  const { width, height } = size
  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid export size ${width}x${height}`)
  }

  const canvas = deps.createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('2D canvas context unavailable')
  }

  ctx.fillStyle = deps.backgroundColor ?? '#ffffff'
  ctx.fillRect(0, 0, width, height)

  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`
  const image = await deps.loadImage(svgDataUrl)
  ctx.drawImage(image, 0, 0, width, height)

  return canvas.toDataURL('image/png')
}

/**
 * Computes an export pixel size from a bpmn-js canvas viewbox, with padding
 * and a floor so pathologically tiny/empty diagrams still export something.
 */
export function computeExportSize(
  viewbox: { width: number; height: number },
  padding = 20,
  minSize = 100
): ExportSize {
  const width = Math.max(minSize, Math.ceil(viewbox.width) + padding * 2)
  const height = Math.max(minSize, Math.ceil(viewbox.height) + padding * 2)
  return { width, height }
}

/** Browser-side "Save As" via a transient anchor click — no main-process IPC needed. */
export function triggerDownload(filename: string, href: string, doc: Document = document): void {
  const anchor = doc.createElement('a')
  anchor.href = href
  anchor.download = filename
  doc.body.appendChild(anchor)
  anchor.click()
  doc.body.removeChild(anchor)
}

export function svgToDataUrl(svgMarkup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`
}

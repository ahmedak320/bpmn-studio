/**
 * PDF rasterization + tolerance-based visual comparison for the Sequence-1
 * round-trip gate (`../aris-sequence-1.spec.ts`).
 *
 * - `rasterizePdfToPng` shells out to poppler's `pdftoppm` (a system tool, not
 *   an npm dependency) so the produced PDF is rendered by a real PDF engine —
 *   the same engine family that produced the reference rasters from ARIS's own
 *   exports.
 * - `decodePng` is a small dependency-free PNG decoder (8-bit gray/RGB/RGBA,
 *   non-interlaced — exactly what `pdftoppm -png` and the reference rasters
 *   carry). The repo has no pngjs/pixelmatch dependency and must not grow one
 *   for a test helper.
 * - `inkStructureSimilarity` compares two pages by their *ink structure*, not
 *   their pixels: each page is cropped to its ink bounding box, stretched onto
 *   a common coarse grid, and compared by per-cell ink coverage. See the
 *   function's comment for why a pixel diff is the wrong tool here.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

export interface RasterImage {
  readonly width: number
  readonly height: number
  /** RGB triplets, row-major, `width * height * 3` bytes. */
  readonly data: Uint8Array
}

/** Rasterize page 1 of `pdfPath` to `<outPrefix>-1.png` at `dpi`; returns the PNG path. */
export function rasterizePdfToPng(pdfPath: string, outPrefix: string, dpi = 150): string {
  execFileSync('pdftoppm', ['-png', '-r', String(dpi), '-f', '1', '-l', '1', pdfPath, outPrefix])
  return `${outPrefix}-1.png`
}

export function readPng(path: string): RasterImage {
  return decodePng(readFileSync(path))
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Bytes per pixel for the supported color types (bit depth 8 only). */
const COLOR_TYPE_CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 4: 2, 6: 4 }

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/**
 * Decode an 8-bit, non-interlaced PNG (gray, RGB, gray+alpha or RGBA) to RGB.
 * Throws — loudly, never a silent wrong answer — on anything outside that
 * envelope (the test fixtures never are).
 */
export function decodePng(bytes: Buffer): RasterImage {
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) throw new Error('Not a PNG file')
  }

  let width = 0
  let height = 0
  let channels = 0
  const idat: Buffer[] = []
  let offset = PNG_SIGNATURE.length
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('latin1', offset + 4, offset + 8)
    const body = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      const bitDepth = body[8]
      const colorType = body[9]
      const interlace = body[12]
      if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}`)
      if (interlace !== 0) throw new Error('Interlaced PNGs are not supported')
      channels = COLOR_TYPE_CHANNELS[colorType] ?? 0
      if (channels === 0) throw new Error(`Unsupported PNG color type ${colorType}`)
    } else if (type === 'IDAT') {
      idat.push(body)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (width <= 0 || height <= 0 || idat.length === 0) {
    throw new Error('Malformed PNG: missing IHDR or IDAT')
  }

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(stride * height)
  let read = 0
  for (let row = 0; row < height; row += 1) {
    const filter = raw[read]
    read += 1
    const line = raw.subarray(read, read + stride)
    const out = pixels.subarray(row * stride, (row + 1) * stride)
    const up = row > 0 ? pixels.subarray((row - 1) * stride, row * stride) : null
    read += stride
    for (let column = 0; column < stride; column += 1) {
      const left = column >= channels ? out[column - channels] : 0
      const above = up ? up[column] : 0
      const upperLeft = up && column >= channels ? up[column - channels] : 0
      let value = line[column]
      if (filter === 1) value += left
      else if (filter === 2) value += above
      else if (filter === 3) value += (left + above) >> 1
      else if (filter === 4) value += paethPredictor(left, above, upperLeft)
      else if (filter !== 0) throw new Error(`Unknown PNG filter ${filter}`)
      out[column] = value & 0xff
    }
  }

  const rgb = new Uint8Array(width * height * 3)
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * channels
    const target = pixel * 3
    if (channels >= 3) {
      rgb[target] = pixels[source]
      rgb[target + 1] = pixels[source + 1]
      rgb[target + 2] = pixels[source + 2]
    } else {
      rgb[target] = rgb[target + 1] = rgb[target + 2] = pixels[source]
    }
  }
  return { width, height, data: rgb }
}

export interface InkStructureReport {
  /** 1 = identical ink distribution; 0 = no shared structure. */
  readonly score: number
  /** Ink-bbox aspect ratios (width / height) of each page, before stretching. */
  readonly aspectA: number
  readonly aspectB: number
  /** Total ink fraction of each page, so a blank export fails loudly. */
  readonly inkFractionA: number
  readonly inkFractionB: number
}

/** Grid resolution of the ink-coverage maps: 32×32 = 1024 structural cells. */
const INK_GRID = 32
/** A pixel counts as ink when any channel drops below this near-white floor. */
const INK_CHANNEL_FLOOR = 240

function inkCoverageMap(image: RasterImage): {
  cells: Float64Array
  aspect: number
  inkFraction: number
} {
  const { width, height, data } = image
  // Summed-area table of the ink mask: cell sums are then O(1) lookups.
  const sat = new Float64Array((width + 1) * (height + 1))
  let inkTotal = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    let rowInk = 0
    for (let x = 0; x < width; x += 1) {
      const base = (y * width + x) * 3
      const ink =
        data[base] < INK_CHANNEL_FLOOR ||
        data[base + 1] < INK_CHANNEL_FLOOR ||
        data[base + 2] < INK_CHANNEL_FLOOR
          ? 1
          : 0
      rowInk += ink
      sat[(y + 1) * (width + 1) + x + 1] = sat[y * (width + 1) + x + 1] + rowInk
      if (ink === 1) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    inkTotal += rowInk
  }
  if (maxX < 0) {
    // A blank page has no structure to compare; report zeros and let the
    // caller's ink-fraction guard fail the assertion.
    return { cells: new Float64Array(INK_GRID * INK_GRID), aspect: 0, inkFraction: 0 }
  }

  const cropX = minX
  const cropY = minY
  const cropWidth = maxX - minX + 1
  const cropHeight = maxY - minY + 1
  const regionSum = (x0: number, y0: number, x1: number, y1: number): number =>
    sat[y1 * (width + 1) + x1] -
    sat[y0 * (width + 1) + x1] -
    sat[y1 * (width + 1) + x0] +
    sat[y0 * (width + 1) + x0]

  const cells = new Float64Array(INK_GRID * INK_GRID)
  for (let cellY = 0; cellY < INK_GRID; cellY += 1) {
    // Cell boundaries in source pixels, rounding outward so cells tile the crop.
    const y0 = cropY + Math.floor((cellY * cropHeight) / INK_GRID)
    const y1 = cropY + Math.floor(((cellY + 1) * cropHeight) / INK_GRID)
    for (let cellX = 0; cellX < INK_GRID; cellX += 1) {
      const x0 = cropX + Math.floor((cellX * cropWidth) / INK_GRID)
      const x1 = cropX + Math.floor(((cellX + 1) * cropWidth) / INK_GRID)
      const area = Math.max(1, (x1 - x0) * (y1 - y0))
      cells[cellY * INK_GRID + cellX] = regionSum(x0, y0, x1, y1) / area
    }
  }
  return { cells, aspect: cropWidth / cropHeight, inkFraction: inkTotal / (width * height) }
}

/**
 * Compare two page rasters by coarse ink structure and return a similarity in
 * [0, 1].
 *
 * A pixel-level diff is the wrong tool for this gate: the reference page is
 * ARIS's own A4 export while the candidate is OrbitPM's content-fitted page —
 * different page sizes and DPIs, a decoded OLE logo on one side and a framed
 * placeholder on the other, and different PDF font rasterizers. What must
 * match is the *structure*: the print-frame bands, the lane columns, the
 * gates and the connection web land in the same places at the same density.
 *
 * So each page is cropped to its ink bounding box (removing page-size and
 * margin differences), the crop is stretched onto a common 32×32 grid
 * (removing scale), and the per-cell ink coverage is compared:
 * `score = 1 − mean(|coverageA − coverageB|)`. Identical layouts score ≈ 1;
 * a missing lane, a shifted band or a collapsed diagram moves whole cells and
 * drops the score fast.
 */
export function inkStructureSimilarity(a: RasterImage, b: RasterImage): InkStructureReport {
  const mapA = inkCoverageMap(a)
  const mapB = inkCoverageMap(b)
  let difference = 0
  for (let index = 0; index < mapA.cells.length; index += 1) {
    difference += Math.abs(mapA.cells[index] - mapB.cells[index])
  }
  return {
    score: 1 - difference / mapA.cells.length,
    aspectA: mapA.aspect,
    aspectB: mapB.aspect,
    inkFractionA: mapA.inkFraction,
    inkFractionB: mapB.inkFraction
  }
}

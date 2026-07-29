/**
 * jsdom SVG geometry shim — test support only.
 *
 * jsdom implements the SVG *DOM* but none of the SVG *geometry* interfaces:
 * there is no `SVGMatrix`, no `SVGTransformList`, no `getBBox`, no
 * `createSVGPoint`. diagram-js's `Canvas` needs all of them for `viewbox()`,
 * `zoom()` and `scroll()`, and `tiny-svg` needs `node.transform.baseVal`.
 *
 * Rather than avoid the code paths that touch them — which would mean testing a
 * canvas with zoom/pan/fit switched off — this installs a small, exact
 * implementation. The single source of truth is the element's `transform`
 * attribute, serialized as `matrix(a,b,c,d,e,f)`, so reads and writes agree no
 * matter which API produced them.
 *
 * This file is never imported by production code.
 */

interface MatrixLike {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

const IDENTITY: MatrixLike = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

class StubMatrix implements MatrixLike {
  a = 1
  b = 0
  c = 0
  d = 1
  e = 0
  f = 0

  static from(values: MatrixLike): StubMatrix {
    const matrix = new StubMatrix()
    Object.assign(matrix, values)
    return matrix
  }

  multiply(other: MatrixLike): StubMatrix {
    return StubMatrix.from({
      a: this.a * other.a + this.c * other.b,
      b: this.b * other.a + this.d * other.b,
      c: this.a * other.c + this.c * other.d,
      d: this.b * other.c + this.d * other.d,
      e: this.a * other.e + this.c * other.f + this.e,
      f: this.b * other.e + this.d * other.f + this.f
    })
  }

  translate(tx: number, ty: number): StubMatrix {
    return this.multiply({ ...IDENTITY, e: tx, f: ty })
  }

  scale(sx: number, sy = sx): StubMatrix {
    return this.multiply({ ...IDENTITY, a: sx, d: sy })
  }

  scaleNonUniform(sx: number, sy: number): StubMatrix {
    return this.scale(sx, sy)
  }

  inverse(): StubMatrix {
    const determinant = this.a * this.d - this.b * this.c
    if (determinant === 0) throw new Error('Matrix is not invertible.')
    return StubMatrix.from({
      a: this.d / determinant,
      b: -this.b / determinant,
      c: -this.c / determinant,
      d: this.a / determinant,
      e: (this.c * this.f - this.d * this.e) / determinant,
      f: (this.b * this.e - this.a * this.f) / determinant
    })
  }
}

class StubTransform {
  matrix: StubMatrix

  constructor(matrix: StubMatrix = new StubMatrix()) {
    this.matrix = matrix
  }

  setTranslate(tx: number, ty: number): void {
    this.matrix = StubMatrix.from({ ...IDENTITY, e: tx, f: ty })
  }

  setScale(sx: number, sy: number): void {
    this.matrix = StubMatrix.from({ ...IDENTITY, a: sx, d: sy })
  }

  setRotate(angle: number, cx: number, cy: number): void {
    const radians = (angle * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    this.matrix = StubMatrix.from({
      a: cos,
      b: sin,
      c: -sin,
      d: cos,
      e: cx - cos * cx + sin * cy,
      f: cy - sin * cx - cos * cy
    })
  }

  setMatrix(matrix: MatrixLike): void {
    this.matrix = StubMatrix.from(matrix)
  }
}

const MATRIX_PATTERN =
  /matrix\(\s*([-\d.eE+]+)[,\s]+([-\d.eE+]+)[,\s]+([-\d.eE+]+)[,\s]+([-\d.eE+]+)[,\s]+([-\d.eE+]+)[,\s]+([-\d.eE+]+)\s*\)/u

function parseTransformAttribute(value: string | null): StubMatrix | null {
  if (!value) return null
  const match = MATRIX_PATTERN.exec(value)
  if (!match) return null
  return StubMatrix.from({
    a: Number(match[1]),
    b: Number(match[2]),
    c: Number(match[3]),
    d: Number(match[4]),
    e: Number(match[5]),
    f: Number(match[6])
  })
}

function serialize(matrix: MatrixLike): string {
  return `matrix(${matrix.a},${matrix.b},${matrix.c},${matrix.d},${matrix.e},${matrix.f})`
}

class StubTransformList {
  private items: StubTransform[] = []

  constructor(private readonly node: Element) {}

  get numberOfItems(): number {
    return this.items.length
  }

  clear(): void {
    this.items = []
    this.node.removeAttribute('transform')
  }

  appendItem(transform: StubTransform): StubTransform {
    this.items.push(transform)
    this.write()
    return transform
  }

  getItem(index: number): StubTransform {
    return this.items[index]
  }

  createSVGTransformFromMatrix(matrix: MatrixLike): StubTransform {
    return new StubTransform(StubMatrix.from(matrix))
  }

  /** Read back the *attribute*, so `setCTM`-style writes are visible too. */
  consolidate(): StubTransform | null {
    const parsed = parseTransformAttribute(this.node.getAttribute('transform'))
    return parsed === null ? null : new StubTransform(parsed)
  }

  private write(): void {
    let product = new StubMatrix()
    for (const item of this.items) product = product.multiply(item.matrix)
    this.node.setAttribute('transform', serialize(product))
  }
}

interface BoxLike {
  x: number
  y: number
  width: number
  height: number
}

function numbersIn(value: string | null): number[] {
  if (!value) return []
  const found = value.match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g)
  return found ? found.map(Number) : []
}

function boxOfPoints(points: readonly { x: number; y: number }[]): BoxLike | null {
  if (points.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function pairsIn(value: string | null): { x: number; y: number }[] {
  const flat = numbersIn(value)
  const points: { x: number; y: number }[] = []
  for (let index = 0; index + 1 < flat.length; index += 2) {
    points.push({ x: flat[index] as number, y: flat[index + 1] as number })
  }
  return points
}

/** The node's own drawn extent, ignoring its children and its own transform. */
function ownBox(node: Element): BoxLike | null {
  const attr = (name: string): number => Number(node.getAttribute(name) ?? Number.NaN)
  switch (node.tagName.toLowerCase()) {
    case 'rect':
    case 'image':
    case 'foreignobject': {
      const width = attr('width')
      const height = attr('height')
      if (!Number.isFinite(width) || !Number.isFinite(height)) return null
      const x = Number.isFinite(attr('x')) ? attr('x') : 0
      const y = Number.isFinite(attr('y')) ? attr('y') : 0
      return { x, y, width, height }
    }
    case 'circle': {
      const r = attr('r')
      if (!Number.isFinite(r)) return null
      return { x: attr('cx') - r, y: attr('cy') - r, width: 2 * r, height: 2 * r }
    }
    case 'ellipse': {
      const rx = attr('rx')
      const ry = attr('ry')
      if (!Number.isFinite(rx) || !Number.isFinite(ry)) return null
      return { x: attr('cx') - rx, y: attr('cy') - ry, width: 2 * rx, height: 2 * ry }
    }
    case 'line':
      return boxOfPoints([
        { x: attr('x1'), y: attr('y1') },
        { x: attr('x2'), y: attr('y2') }
      ])
    case 'polyline':
    case 'polygon':
      return boxOfPoints(pairsIn(node.getAttribute('points')))
    case 'path':
      // Good enough for the polyline-ish paths diagram-js draws: every
      // coordinate pair in `d` is treated as a point on the outline.
      return boxOfPoints(pairsIn(node.getAttribute('d')))
    default:
      // `text` has no measurable metrics without layout, so it contributes
      // nothing rather than a made-up rectangle.
      return null
  }
}

function unionBox(left: BoxLike | null, right: BoxLike | null): BoxLike | null {
  if (!left) return right
  if (!right) return left
  const x = Math.min(left.x, right.x)
  const y = Math.min(left.y, right.y)
  const maxX = Math.max(left.x + left.width, right.x + right.width)
  const maxY = Math.max(left.y + left.height, right.y + right.height)
  return { x, y, width: maxX - x, height: maxY - y }
}

function applyMatrix(matrix: MatrixLike, box: BoxLike): BoxLike {
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x, y: box.y + box.height },
    { x: box.x + box.width, y: box.y + box.height }
  ].map((corner) => ({
    x: matrix.a * corner.x + matrix.c * corner.y + matrix.e,
    y: matrix.b * corner.x + matrix.d * corner.y + matrix.f
  }))
  return boxOfPoints(corners) as BoxLike
}

/**
 * A real bounding box, in the node's own user space.
 *
 * jsdom does no layout, so this walks the tree and unions the geometry the
 * attributes actually declare. Returning a constant here — which this shim used
 * to do — silently makes every `canvas.zoom('fit-viewport')` assertion vacuous,
 * which is precisely how a product that fitted the viewport to a 50000-unit
 * lane frame kept a green unit suite.
 */
function measureBBox(node: Element): BoxLike | null {
  let box = ownBox(node)
  for (const child of Array.from(node.children)) {
    const childBox = measureBBox(child)
    if (!childBox) continue
    const transform = parseTransformAttribute(child.getAttribute('transform'))
    box = unionBox(box, transform ? applyMatrix(transform, childBox) : childBox)
  }
  return box
}

/**
 * Test containers with a declared size, so the elements diagram-js creates
 * *inside* them can inherit one.
 *
 * jsdom reports `clientWidth`/`clientHeight` as 0 for everything, and
 * `Canvas.getSize()` measures diagram-js's own inner container rather than the
 * node the test created. Stubbing only the outer node therefore left the canvas
 * believing its viewport was 0x0 — which silently turns every
 * "is this readable at 1600x1000?" assertion into a no-op.
 */
const containerSizes = new WeakMap<Element, { width: number; height: number }>()

function inheritedSize(node: Element | null): { width: number; height: number } | null {
  let current: Element | null = node
  while (current) {
    const size = containerSizes.get(current)
    if (size) return size
    current = current.parentElement
  }
  return null
}

let installed = false

/**
 * Install the shim. Idempotent, so every test file may call it.
 */
export function installJsdomSvgSupport(): void {
  if (installed) return
  installed = true

  const scope = globalThis as unknown as Record<string, unknown>
  scope.SVGMatrix = StubMatrix
  scope.SVGTransform = StubTransform

  for (const property of ['clientWidth', 'clientHeight'] as const) {
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get(this: HTMLElement) {
        const size = inheritedSize(this)
        if (!size) return 0
        return property === 'clientWidth' ? size.width : size.height
      }
    })
  }

  // jsdom has no `CSS` object; diagram-js's palette escapes entry ids with it.
  const css = scope.CSS as { escape?: (value: string) => string } | undefined
  if (!css) {
    scope.CSS = { escape: (value: string) => value.replace(/([^\w-])/gu, '\\$1') }
  } else if (typeof css.escape !== 'function') {
    css.escape = (value: string) => value.replace(/([^\w-])/gu, '\\$1')
  }

  // jsdom does no layout, so hit-testing is unavailable. diagram-js's
  // `hover-fix` uses it only to re-derive a hover target mid-drag; returning
  // `null` makes it keep the target the drag already has.
  const documentWithHitTest = document as Document & {
    elementFromPoint?: (x: number, y: number) => Element | null
  }
  if (typeof documentWithHitTest.elementFromPoint !== 'function') {
    documentWithHitTest.elementFromPoint = () => null
  }

  const svgElementProto = (scope.SVGElement as { prototype: Record<string, unknown> }).prototype
  const transformLists = new WeakMap<Element, StubTransformList>()

  Object.defineProperty(svgElementProto, 'transform', {
    configurable: true,
    get(this: Element) {
      let list = transformLists.get(this)
      if (!list) {
        list = new StubTransformList(this)
        transformLists.set(this, list)
      }
      return { baseVal: list, animVal: list }
    }
  })

  svgElementProto.getBBox = function getBBox(this: Element): BoxLike {
    return measureBBox(this) ?? { x: 0, y: 0, width: 0, height: 0 }
  }

  svgElementProto.getCTM = function getCTM(this: Element): StubMatrix {
    return parseTransformAttribute(this.getAttribute('transform')) ?? new StubMatrix()
  }

  svgElementProto.getScreenCTM = svgElementProto.getCTM

  const svgSvgProto = (scope.SVGSVGElement as { prototype: Record<string, unknown> }).prototype
  svgSvgProto.createSVGMatrix = function createSVGMatrix(): StubMatrix {
    return new StubMatrix()
  }
  svgSvgProto.createSVGTransform = function createSVGTransform(): StubTransform {
    return new StubTransform()
  }
  svgSvgProto.createSVGTransformFromMatrix = function createSVGTransformFromMatrix(
    matrix: MatrixLike
  ): StubTransform {
    return new StubTransform(StubMatrix.from(matrix))
  }
  svgSvgProto.createSVGPoint = function createSVGPoint(): {
    x: number
    y: number
    matrixTransform: (matrix: MatrixLike) => { x: number; y: number }
  } {
    return {
      x: 0,
      y: 0,
      matrixTransform(matrix: MatrixLike) {
        return {
          x: matrix.a * this.x + matrix.c * this.y + matrix.e,
          y: matrix.b * this.x + matrix.d * this.y + matrix.f
        }
      }
    }
  }
}

/**
 * A container with a non-zero size.
 *
 * jsdom reports `0×0` for every element, which makes `canvas.zoom('fit-viewport')`
 * divide by zero. Stubbing `getBoundingClientRect` gives the canvas a viewport.
 */
export function createCanvasContainer(width = 1200, height = 800): HTMLElement {
  installJsdomSvgSupport()
  const container = document.createElement('div')
  containerSizes.set(container, { width, height })
  container.getBoundingClientRect = () =>
    ({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({})
    }) as DOMRect
  document.body.appendChild(container)
  return container
}

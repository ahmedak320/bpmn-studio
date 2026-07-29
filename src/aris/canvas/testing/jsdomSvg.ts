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

  svgElementProto.getBBox = function getBBox(): {
    x: number
    y: number
    width: number
    height: number
  } {
    return { x: 0, y: 0, width: 1000, height: 1000 }
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
  const container = document.createElement('div')
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
  Object.defineProperty(container, 'clientWidth', { value: width, configurable: true })
  Object.defineProperty(container, 'clientHeight', { value: height, configurable: true })
  document.body.appendChild(container)
  return container
}

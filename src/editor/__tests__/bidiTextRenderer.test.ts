import { afterEach, describe, expect, it, vi } from 'vitest'

import { BidiTextRenderer, BidiTextRendererModule } from '../bidiTextRenderer'

interface FakeCanvasContext {
  font: string
  measureText(text: string): {
    width: number
    actualBoundingBoxAscent: number
    actualBoundingBoxDescent: number
  }
}

interface FakeDocument {
  createElement(name: string): {
    getContext(type: string): FakeCanvasContext | null
  }
  createElementNS(namespace: string, name: string): FakeSvgNode
  importNode(node: FakeSvgNode): FakeSvgNode
}

class FakeSvgNode {
  readonly nodeType = 1
  readonly style: Record<string, unknown> = {}
  readonly attributes = new Map<string, string>()
  readonly children: FakeSvgNode[] = []
  textContent = ''

  constructor(
    readonly ownerDocument: FakeDocument,
    readonly tagName: string
  ) {}

  appendChild(child: FakeSvgNode): FakeSvgNode {
    this.children.push(child)
    return child
  }

  setAttribute(name: string, value: unknown): void {
    this.attributes.set(name, String(value))
  }

  setAttributeNS(_namespace: string | null, name: string, value: unknown): void {
    this.setAttribute(name, value)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  getAttributeNS(_namespace: string | null, name: string): string | null {
    return this.getAttribute(name)
  }

  querySelectorAll(selector: string): FakeSvgNode[] {
    const descendants = this.children.flatMap((child) => [
      child,
      ...child.querySelectorAll(selector)
    ])

    return descendants.filter((child) => child.tagName === selector)
  }
}

const ARABIC_ATTRIBUTES = {
  direction: 'rtl',
  'unicode-bidi': 'plaintext',
  lang: 'ar',
  'xml:lang': 'ar'
} as const

function installFakeDocument(): void {
  const canvasContext: FakeCanvasContext = {
    font: '',
    measureText: (text) => ({
      width: text.length * 8,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2
    })
  }

  const fakeDocument: FakeDocument = {
    createElement: () => ({
      getContext: (type) => (type === '2d' ? canvasContext : null)
    }),
    createElementNS: (_namespace, name) => new FakeSvgNode(fakeDocument, name),
    importNode: (node) => node
  }

  vi.stubGlobal('document', fakeDocument)
}

function renderText(
  text: string,
  options?: Parameters<BidiTextRenderer['createText']>[1]
): FakeSvgNode {
  installFakeDocument()

  return new BidiTextRenderer().createText(text, options) as unknown as FakeSvgNode
}

function expectArabicAttributes(node: FakeSvgNode): void {
  for (const [name, value] of Object.entries(ARABIC_ATTRIBUTES)) {
    expect(node.getAttribute(name)).toBe(value)
  }
}

function expectNoArabicAttributes(node: FakeSvgNode): void {
  for (const name of Object.keys(ARABIC_ATTRIBUTES)) {
    expect(node.getAttribute(name)).toBeNull()
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BidiTextRenderer', () => {
  it('uses the stock text-renderer config injection', () => {
    expect(BidiTextRenderer.$inject).toEqual(['config.textRenderer'])
    expect(BidiTextRendererModule.textRenderer).toEqual(['type', BidiTextRenderer])
  })

  it('leaves English text and its tspans untouched', () => {
    const text = renderText('Review request')

    expect(text.tagName).toBe('text')
    expect(text.children).toHaveLength(1)
    expectNoArabicAttributes(text)
    text.children.forEach(expectNoArabicAttributes)
  })

  it('marks Arabic text and its tspan as RTL Arabic', () => {
    const text = renderText('مراجعة الطلب')

    expectArabicAttributes(text)
    expect(text.children).toHaveLength(1)
    text.children.forEach(expectArabicAttributes)
  })

  it('marks mixed Arabic and numeric text as RTL Arabic', () => {
    const text = renderText('الطلب 123')

    expectArabicAttributes(text)
    text.children.forEach(expectArabicAttributes)
  })

  it('marks every tspan produced by wrapped Arabic text', () => {
    const text = renderText('مراجعة الطلب النهائي', {
      box: { width: 48, height: 50 }
    })

    expect(text.children.length).toBeGreaterThan(1)
    expectArabicAttributes(text)
    text.children.forEach(expectArabicAttributes)
  })
})

import { describe, expect, it } from 'vitest'
import { buildBlankArisAml, deriveArisSourceFileName } from './arisBlankModel'
import { createArisXmlSourcePackage } from '../source/sourcePackage'
import { arisText, buildArisStudioDocument } from './arisStudioDocument'
import { installJsdomSvgSupport } from '../canvas/testing/jsdomSvg'
import { ArisCanvas } from '../canvas/ArisCanvas'

describe('buildBlankArisAml', () => {
  it('emits a Model.Type and AT_NAME for an English name', () => {
    const { xml } = buildBlankArisAml({ names: { en: 'Order intake' }, modelType: 'MT_EEPC' })
    expect(xml).toContain('Model.Type="MT_EEPC"')
    expect(xml).toContain('<AttrValue LocaleId="1033">')
    expect(xml).toContain('<PlainText TextValue="Order intake"/>')
  })

  it('round-trips through the studio pipeline as one renderable empty model', async () => {
    const { xml, modelId } = buildBlankArisAml({
      names: { en: 'Order intake' },
      modelType: 'MT_EEPC'
    })
    const pkg = await createArisXmlSourcePackage({
      name: 'x.aml',
      relPath: null,
      bytes: new TextEncoder().encode(xml)
    })
    const studio = buildArisStudioDocument(pkg)

    expect(studio.models).toHaveLength(1)
    const model = studio.models[0]
    expect(model.id).toBe(modelId)
    expect(model.objectCount).toBe(0)
    expect(model.connectionCount).toBe(0)
    expect(model.renderable).toBe(true)
    expect(arisText(model.names, 'en')).toBe('Order intake')
    expect(studio.accounting.unaccountedCount).toBe(0)
  })
})

describe('deriveArisSourceFileName', () => {
  it('slugifies ASCII names and appends .aml', () => {
    expect(deriveArisSourceFileName('Order intake')).toBe('order-intake.aml')
  })

  it('preserves non-ASCII scripts after stripping Windows-illegal characters', () => {
    expect(deriveArisSourceFileName('استقبال الطلبات')).toBe('استقبال-الطلبات.aml')
  })

  it('falls back to a safe name for empty input', () => {
    expect(deriveArisSourceFileName('   ')).toBe('process.aml')
  })
})

// @vitest-environment jsdom
describe('blank model canvas boot', () => {
  it('creates and destroys an ArisCanvas for the blank model', async () => {
    installJsdomSvgSupport()
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 1200
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 800
    })
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
      return {
        width: 1200,
        height: 800,
        top: 0,
        left: 0,
        right: 1200,
        bottom: 800,
        x: 0,
        y: 0,
        toJSON: () => ({})
      } as DOMRect
    }

    const { xml, modelId } = buildBlankArisAml({
      names: { en: 'Order intake' },
      modelType: 'MT_EEPC'
    })
    const pkg = await createArisXmlSourcePackage({
      name: 'x.aml',
      relPath: null,
      bytes: new TextEncoder().encode(xml)
    })
    const studio = buildArisStudioDocument(pkg)

    const container = document.createElement('div')
    document.body.appendChild(container)

    const canvas = ArisCanvas.create({ container, document: studio.source, modelId })
    expect(canvas).toBeDefined()
    canvas.destroy()
    container.remove()
  })
})

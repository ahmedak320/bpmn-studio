import TextRenderer, {
  type TextRendererConfig
} from 'bpmn-js/lib/draw/TextRenderer'

const ARABIC_SCRIPT = /\p{Script=Arabic}/u
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'

function markArabicText(node: SVGElement): void {
  node.setAttribute('direction', 'rtl')
  node.setAttribute('unicode-bidi', 'plaintext')
  node.setAttribute('lang', 'ar')
  node.setAttributeNS(XML_NAMESPACE, 'xml:lang', 'ar')
}

function decorateArabicText(textElement: SVGElement, text: string): SVGElement {
  if (!ARABIC_SCRIPT.test(text)) return textElement

  markArabicText(textElement)
  for (const tspan of Array.from(textElement.querySelectorAll('tspan'))) {
    markArabicText(tspan)
  }

  return textElement
}

/**
 * TextRenderer creates `createText` as an instance-owned closure, so capture
 * and delegate to that stock implementation before decorating its SVG output.
 */
export class BidiTextRenderer extends TextRenderer {
  static $inject = ['config.textRenderer']

  constructor(config?: TextRendererConfig) {
    super(config)

    const stockCreateText = this.createText

    this.createText = (text, options) =>
      decorateArabicText(stockCreateText(text, options), text)
  }
}

export const BidiTextRendererModule = {
  textRenderer: ['type', BidiTextRenderer]
}

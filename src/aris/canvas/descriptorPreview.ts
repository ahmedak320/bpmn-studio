import EventBus from 'diagram-js/lib/core/EventBus'
import type { Shape } from 'diagram-js/lib/model/Types'

import { DMT_SYMBOL_FINGERPRINTS } from '../symbols/shapes'
import { resolveArisCatalogSymbol } from '../symbols'
import { ArisRenderer } from './renderer'

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Render the same descriptor through the canvas renderer used for live
 * occurrences. The wrapper SVG is decorative; its named button supplies the
 * accessible label.
 */
export function createDescriptorPreview(catalogId: string): SVGSVGElement {
  const descriptor = resolveArisCatalogSymbol(catalogId)
  if (descriptor === null) throw new Error(`Unknown DMT descriptor ${catalogId}.`)

  const width = descriptor.defaultBounds.width
  const height = descriptor.defaultBounds.height
  const parent = document.createElementNS(SVG_NS, 'g')
  const renderer = new ArisRenderer(new EventBus())
  const group = renderer.drawShape(parent, {
    width,
    height,
    businessObject: {
      kind: 'occurrence',
      modelId: 'DMT.library',
      modelType: descriptor.modelType,
      occurrenceId: `library:${catalogId}`,
      definitionId: `library:${catalogId}`,
      objectType: descriptor.objectType,
      symbolNum: descriptor.symbolNum,
      catalogId,
      name: '',
      style: {
        fillColor: null,
        strokeColor: null,
        strokeWidth: null,
        lineStyle: null
      }
    }
  } as unknown as Shape)
  group.removeAttribute('aria-label')
  group.removeAttribute('role')
  group.setAttribute('aria-hidden', 'true')

  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  svg.setAttribute('data-aris-catalog-id', catalogId)
  svg.setAttribute('data-aris-descriptor-fingerprint', DMT_SYMBOL_FINGERPRINTS[catalogId] ?? '')
  svg.appendChild(group)
  return svg
}

export function descriptorPreviewMarkup(catalogId: string): string {
  return createDescriptorPreview(catalogId).outerHTML
}

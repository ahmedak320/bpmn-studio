/**
 * Search/select — Plan Section 11.1.
 *
 * Uses diagram-js's own `search` module (its tokenizing matcher) over the ARIS
 * captions and types, and selects/centres the hit through `selection` and
 * `canvas`.
 */

import type Canvas from 'diagram-js/lib/core/Canvas'
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry'
import type Selection from 'diagram-js/lib/features/selection/Selection'
import type { Element } from 'diagram-js/lib/model/Types'

import { arisBusinessObject } from './elements'

type SearchFn = <T extends Record<string, string | string[]>>(
  items: T[],
  pattern: string,
  options: { keys: string[] }
) => { item: T }[]

interface SearchItem extends Record<string, string | string[]> {
  readonly id: string
  readonly name: string
  readonly type: string
}

export interface ArisSearchResult {
  readonly elementId: string
  readonly name: string
  readonly type: string
}

export class ArisSearchProvider {
  static $inject = ['elementRegistry', 'selection', 'canvas', 'search']

  constructor(
    private readonly elementRegistry: ElementRegistry,
    private readonly selection: Selection,
    private readonly canvas: Canvas,
    private readonly searchFn: SearchFn
  ) {}

  /** Every searchable element on the active canvas. */
  items(): readonly SearchItem[] {
    const items: SearchItem[] = []
    for (const element of this.elementRegistry.getAll()) {
      const businessObject = arisBusinessObject(element)
      if (!businessObject) continue
      if (businessObject.kind === 'occurrence') {
        items.push({ id: element.id, name: businessObject.name, type: businessObject.objectType })
      } else if (businessObject.kind === 'connection') {
        items.push({
          id: element.id,
          name: businessObject.name,
          type: businessObject.connectionType
        })
      } else if (businessObject.kind === 'freeText') {
        items.push({ id: element.id, name: businessObject.text, type: 'FREE_TEXT' })
      } else if (businessObject.kind === 'lane') {
        items.push({ id: element.id, name: businessObject.name, type: 'LANE' })
      }
    }
    return items
  }

  find(pattern: string): readonly ArisSearchResult[] {
    const trimmed = pattern.trim()
    if (trimmed.length === 0) return Object.freeze([])
    const results = this.searchFn(this.items() as SearchItem[], trimmed, { keys: ['name', 'type'] })
    return Object.freeze(
      results.map((result) =>
        Object.freeze({ elementId: result.item.id, name: result.item.name, type: result.item.type })
      )
    )
  }

  /** Select the first hit and scroll it into view. */
  findAndSelect(pattern: string): ArisSearchResult | null {
    const [first] = this.find(pattern)
    if (!first) return null
    const element = this.elementRegistry.get(first.elementId) as Element | undefined
    if (!element) return null
    this.selection.select(element)
    this.canvas.scrollToElement(element)
    return first
  }
}

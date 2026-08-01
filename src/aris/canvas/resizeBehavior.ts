/**
 * `ArisResizeBehavior` — floors interactive resize at the descriptor's default
 * bounds, so a small function/system-function block's icon can never be
 * squished into an illegible sliver (user issue 8).
 *
 * ## Why here
 *
 * diagram-js's `resize` feature (`diagram-js/lib/features/resize/Resize.js`)
 * does NOT read the `shape.resize` rule's return value for a minimum size — a
 * rule only answers "is resizing this shape allowed at all?"
 * (`ArisRules.shape.resize`, `arisRules.ts:43-46`). The minimum size is a
 * separate, documented extension point: whatever `context.minDimensions` holds
 * when `resize.start` fires (`Resize.js:57-61`) is the only thing
 * `computeMinResizeBox` (`Resize.js:228-244`) consults to build the TRBL
 * `resizeConstraints` that every `resize.move` then enforces
 * (`Resize.js:118-131`). Absent a value, diagram-js falls back to its own
 * `DEFAULT_MIN_WIDTH = 10` — a bare 10×10 floor with no relationship to any
 * ARIS symbol.
 *
 * This behavior listens at priority 1500 — above `Resize`'s own
 * default-priority (1000) `resize.start` handler — so `context.minDimensions`
 * is populated before `computeMinResizeBox` reads it. Only `occurrence`
 * shapes get a floor; `freeText` is also resizable (`arisRules.ts:45`) but has
 * no symbol, so it is intentionally left at diagram-js's own default.
 *
 * ## Why the floor is NOT also in `commandFactory`/`authoring`
 *
 * `resizeOccurrenceCommand` (`commandFactory.ts:266`) and
 * `ArisAuthoring.resizeOccurrence` (`authoring.ts:258`) are the seam AML
 * import (`buildFromSource`), AI-driven creation, and command-bridge
 * undo/redo replay all share. Every one of those callers must be able to set
 * the *exact* persisted or requested size — including sizes below a symbol's
 * default, because a real AnimalWF import legitimately carries occurrences
 * smaller than their descriptor's default. Flooring there would silently
 * corrupt re-imported or programmatically authored geometry. The floor
 * therefore lives at exactly the two seams unique to *interactive* dragging:
 * this behavior (the live drag preview/constraint) and `ArisModeling.resizeShape`
 * (`arisModeling.ts`) — the `modeling` service diagram-js's own `resize`
 * feature calls at `resize.end` — which is a defence-in-depth backstop for any
 * caller reaching `modeling.resizeShape` directly, interactive or not.
 */

import type EventBus from 'diagram-js/lib/core/EventBus'
import type { Element } from 'diagram-js/lib/model/Types'

import { resolveArisCatalogSymbol, resolveArisSymbol } from '../symbols'
import { arisBusinessObject } from './elements'

interface ArisResizeStartEvent {
  readonly context: {
    shape?: Element
    minDimensions?: { width: number; height: number }
  }
}

export class ArisResizeBehavior {
  static $inject = ['eventBus']

  constructor(eventBus: EventBus) {
    eventBus.on('resize.start', 1500, (event: ArisResizeStartEvent) => {
      const businessObject = arisBusinessObject(event.context.shape)
      if (businessObject?.kind !== 'occurrence') return

      // Exact DMT presentation identity first (renderer.ts:1007-1019 uses the
      // same catalogId-first order); the model-type/object-type/SymbolNum
      // triple is the fallback imports and untagged occurrences resolve through.
      const catalogDescriptor =
        businessObject.catalogId === undefined
          ? null
          : resolveArisCatalogSymbol(businessObject.catalogId)
      const descriptor =
        catalogDescriptor ??
        resolveArisSymbol({
          modelType: businessObject.modelType,
          objectType: businessObject.objectType,
          symbolNum: businessObject.symbolNum
        }).descriptor

      event.context.minDimensions = { ...descriptor.defaultBounds }
    })
  }
}

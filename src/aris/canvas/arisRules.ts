/**
 * Modelling rules for the ARIS canvas.
 *
 * The rules only answer "is this gesture structurally meaningful?"; whether the
 * resulting document is *valid* is the ARIS command system's job (it validates
 * pre- and postconditions on every apply) and the EPC lane's job (semantic
 * findings). Keeping the rules thin avoids a third place where ARIS semantics
 * could drift.
 */

import RuleProvider from 'diagram-js/lib/features/rules/RuleProvider'
import type EventBus from 'diagram-js/lib/core/EventBus'
import type { Element } from 'diagram-js/lib/model/Types'

import { arisBusinessObject } from './elements'

function isOccurrence(element: Element | null | undefined): boolean {
  return arisBusinessObject(element)?.kind === 'occurrence'
}

export class ArisRules extends RuleProvider {
  static $inject = ['eventBus']

  constructor(eventBus: EventBus) {
    super(eventBus)
  }

  init(): void {
    this.addRule('shape.move', (context: { shape?: Element }) => {
      const kind = arisBusinessObject(context.shape)?.kind
      return kind === 'occurrence' || kind === 'freeText' || kind === 'label' || kind === 'lane'
    })

    this.addRule('elements.move', (context: { shapes?: Element[] }) => {
      const shapes = context.shapes ?? []
      if (shapes.length === 0) return false
      return shapes.every((shape) => {
        const kind = arisBusinessObject(shape)?.kind
        return kind === 'occurrence' || kind === 'freeText' || kind === 'label' || kind === 'lane'
      })
    })

    this.addRule('shape.resize', (context: { shape?: Element }) => {
      const kind = arisBusinessObject(context.shape)?.kind
      return kind === 'occurrence' || kind === 'freeText'
    })

    // Self-loops are explicitly allowed: Section 11.5 requires the highlight
    // overlay to deduplicate them, which presupposes they can be authored.
    this.addRule(
      'connection.create',
      (context: { source?: Element; target?: Element }) =>
        isOccurrence(context.source) && isOccurrence(context.target)
    )

    this.addRule(
      'connection.reconnect',
      (context: { source?: Element; target?: Element }) =>
        isOccurrence(context.source) && isOccurrence(context.target)
    )

    this.addRule('connection.updateWaypoints', () => true)

    this.addRule('elements.delete', (context: { elements?: Element[] }) =>
      (context.elements ?? []).filter((element) => {
        const kind = arisBusinessObject(element)?.kind
        // Labels are projections of an attribute placement, never deletable.
        return (
          kind === 'occurrence' || kind === 'connection' || kind === 'freeText' || kind === 'lane'
        )
      })
    )

    this.addRule('elements.align', (context: { elements?: Element[] }) =>
      (context.elements ?? []).filter((element) => isOccurrence(element))
    )

    this.addRule('elements.distribute', (context: { elements?: Element[] }) =>
      (context.elements ?? []).filter((element) => isOccurrence(element))
    )

    this.addRule(
      'shape.create',
      (context: { shape?: Element }) =>
        arisBusinessObject(context.shape) === null || isOccurrence(context.shape)
    )
  }
}

/**
 * Context pad entries for the selected ARIS element.
 *
 * Delete routes through `ArisModeling.removeElements`, which never touches
 * object *definitions* — Section 11.4 requires a separate confirmation for
 * those, provided by `ArisAuthoring.requestDeleteDefinition`.
 */

import type Connect from 'diagram-js/lib/features/connect/Connect'
import type ContextPad from 'diagram-js/lib/features/context-pad/ContextPad'
import type { Element } from 'diagram-js/lib/model/Types'

import { t } from '../../i18n'
import type { ArisModeling } from './arisModeling'
import { arisBusinessObject } from './elements'
import type { ArisPaletteProvider } from './paletteProvider'

export interface ArisContextPadEntry {
  readonly group: string
  readonly className: string
  readonly title: string
  readonly action: {
    readonly click?: (event: Event, element: Element) => void
    readonly dragstart?: (event: Event, element: Element) => void
  }
}

export class ArisContextPadProvider {
  static $inject = ['contextPad', 'connect', 'modeling', 'arisPaletteProvider']

  constructor(
    contextPad: ContextPad,
    private readonly connect: Connect,
    private readonly modeling: ArisModeling,
    private readonly palette: ArisPaletteProvider
  ) {
    // `ContextPad`'s provider type is generic over the element type; our
    // provider accepts every ARIS element, which the declaration cannot express.
    contextPad.registerProvider(
      1000,
      this as unknown as Parameters<ContextPad['registerProvider']>[1]
    )
  }

  getContextPadEntries(element: Element): Record<string, ArisContextPadEntry> {
    const businessObject = arisBusinessObject(element)
    if (!businessObject) return {}

    const entries: Record<string, ArisContextPadEntry> = {}

    if (businessObject.kind === 'occurrence') {
      entries['connect'] = {
        group: 'connect',
        className: 'aris-context-pad-connect',
        title: t('aris.contextPad.connect'),
        action: {
          click: (event, target) => this.connect.start(event as unknown as MouseEvent, target),
          dragstart: (event, target) => this.connect.start(event as unknown as MouseEvent, target)
        }
      }
      entries['append.function'] = {
        group: 'append',
        className: 'aris-context-pad-append-function',
        title: t('aris.contextPad.appendFunction'),
        action: {
          click: (_event, target) => {
            this.modeling.appendShape(
              target,
              this.palette.draftShape({ objectType: 'OT_FUNC', symbolNum: 'ST_FUNC' }),
              { x: target.x + target.width + 120, y: target.y + target.height / 2 }
            )
          }
        }
      }
      entries['append.event'] = {
        group: 'append',
        className: 'aris-context-pad-append-event',
        title: t('aris.contextPad.appendEvent'),
        action: {
          click: (_event, target) => {
            this.modeling.appendShape(
              target,
              this.palette.draftShape({ objectType: 'OT_EVT', symbolNum: 'ST_EV' }),
              { x: target.x + target.width + 120, y: target.y + target.height / 2 }
            )
          }
        }
      }
    }

    // Captions are not independently deletable: an external caption is deleted
    // by deleting its occurrence, and a connection label by deleting its
    // connection.
    if (
      businessObject.kind !== 'label' &&
      businessObject.kind !== 'connectionLabel' &&
      businessObject.kind !== 'model'
    ) {
      entries['delete'] = {
        group: 'edit',
        className: 'aris-context-pad-delete',
        title: t('aris.contextPad.delete'),
        action: {
          click: (_event, target) => this.modeling.removeElements([target])
        }
      }
    }

    return entries
  }
}

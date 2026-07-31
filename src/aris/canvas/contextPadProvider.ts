/**
 * Context pad entries for the selected ARIS element.
 *
 * Delete routes through `ArisModeling.removeElements`, which never touches
 * object *definitions* — Section 11.4 requires a separate confirmation for
 * those, provided by `ArisAuthoring.requestDeleteDefinition`.
 */

import type ContextPad from 'diagram-js/lib/features/context-pad/ContextPad'
import type { Element, Shape } from 'diagram-js/lib/model/Types'

import { t, type Key } from '../../i18n'
import { dmtLibraryText } from '../shell/dmtLibraryI18n'
import type { ArisModeling } from './arisModeling'
import { descriptorPreviewMarkup } from './descriptorPreview'
import { dmtConnectionHelpers, dmtLibraryItem, type DmtConnectionHelper } from './dmtLibrary'
import { arisBusinessObject } from './elements'
import type { ArisPaletteProvider } from './paletteProvider'
import type { ArisQuickPick } from './quickPick'

export interface ArisContextPadEntry {
  readonly group: string
  readonly className: string
  readonly title: string
  readonly html?: string
  readonly arisConnectionType?: string
  readonly arisPeerCatalogId?: string
  readonly arisDirection?: DmtConnectionHelper['direction']
  readonly action: {
    readonly click?: (event: Event, element: Element) => void
    readonly dragstart?: (event: Event, element: Element) => void
  }
}

export class ArisContextPadProvider {
  static $inject = ['contextPad', 'modeling', 'arisPaletteProvider', 'arisQuickPick']

  constructor(
    contextPad: ContextPad,
    private readonly modeling: ArisModeling,
    private readonly palette: ArisPaletteProvider,
    private readonly quickPick: ArisQuickPick
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
      for (const helper of this.helpersFor(element)) {
        const peer = dmtLibraryItem(helper.peerCatalogId)
        if (peer === null) continue
        const relation = t(helper.labelKey as Key)
        const peerLabel = t(peer.labelKey as Key)
        const direction = dmtLibraryText(
          helper.direction === 'outgoing'
            ? 'aris.library.direction.after'
            : 'aris.library.direction.before'
        )
        const title = dmtLibraryText('aris.library.quickConnect', {
          relation,
          peer: peerLabel,
          direction
        })
        entries[helper.id] = {
          group: 'quick-connect',
          className: `aris-context-pad-quick-connect aris-context-pad-quick-connect--${helper.direction}`,
          title,
          html:
            `<button type="button" class="entry aris-context-pad-quick-connect__button" ` +
            `draggable="true" aria-label="${escapeHtml(title)}">` +
            descriptorPreviewMarkup(peer.catalogId) +
            `</button>`,
          arisConnectionType: helper.connectionType,
          arisPeerCatalogId: helper.peerCatalogId,
          arisDirection: helper.direction,
          action: {
            click: (_event, target) => this.appendConnected(target, helper)
          }
        }
      }

      // Re-open the post-placement quick-pick for an existing shape whose symbol
      // has variant alternatives to swap between.
      if (this.quickPick.membersFor(element.id).length > 1) {
        entries['swap-symbol'] = {
          group: 'edit',
          className: 'aris-context-pad-swap-symbol',
          title: t('aris.contextPad.swapSymbol'),
          action: {
            click: (_event, target) => this.quickPick.open(target.id, true)
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

  /**
   * Compact helper manifest: one affordance per legal direction, peer object
   * type, connection type and canonical label. Variant choice is delegated to
   * the shared quick-pick after the peer is placed.
   */
  helpersFor(element: Element): readonly DmtConnectionHelper[] {
    const businessObject = arisBusinessObject(element)
    if (businessObject?.kind !== 'occurrence') return Object.freeze([])
    const seen = new Set<string>()
    return Object.freeze(
      dmtConnectionHelpers(businessObject.modelType, businessObject.objectType).filter((helper) => {
        const key = [
          helper.direction,
          helper.peerObjectType,
          helper.connectionType,
          helper.labelKey
        ].join(':')
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    )
  }

  private appendConnected(target: Element, helper: DmtConnectionHelper): void {
    const peer = dmtLibraryItem(helper.peerCatalogId)
    if (peer === null) return
    const draft = this.palette.draftShape({
      catalogId: peer.catalogId,
      objectType: peer.objectType,
      symbolNum: peer.symbolNum
    })
    const center =
      helper.direction === 'outgoing'
        ? {
            x: target.x + target.width + 120 + (draft.width ?? 0) / 2,
            y: target.y + target.height / 2
          }
        : {
            x: target.x - 120 - (draft.width ?? 0) / 2,
            y: target.y + target.height / 2
          }
    const created = this.modeling.createShape(draft, center) as Shape
    this.palette.rememberCatalogPresentation(created.id, peer.catalogId)
    if (helper.direction === 'outgoing') {
      this.modeling.connect(target, created, { connectionType: helper.connectionType })
    } else {
      this.modeling.connect(created, target, { connectionType: helper.connectionType })
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

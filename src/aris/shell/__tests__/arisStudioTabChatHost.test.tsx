// @vitest-environment jsdom

/**
 * The chat drawer needs a host surface from every open ARIS studio tab.
 * Mounting `ArisStudioTab` with `chatHostKey` + `onChatHostChange` must
 * register a host that can read the live canvas document, apply chat commands,
 * undo, and report undo availability. Unmounting must unregister it.
 */

import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { installJsdomSvgSupport } from '../../canvas/testing/jsdomSvg'
import { createArisXmlSourcePackage } from '../../source/sourcePackage'
import { ArisStudioTab } from '../ArisStudioTab'
import { buildBlankArisAml } from '../arisBlankModel'
import { buildArisStudioDocument } from '../arisStudioDocument'
import type { ArisTabChatHost } from '../arisChatDrawerTypes'

function installGeometryShims(): void {
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
}

async function buildStudio() {
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
  return { studio, modelId }
}

afterEach(() => {
  cleanup()
})

describe('ArisStudioTab chat host registration', () => {
  it('registers a host whose getDocument returns the canvas document after ready, and unregisters on unmount', async () => {
    installJsdomSvgSupport()
    installGeometryShims()

    const { studio, modelId } = await buildStudio()
    const hostChanges: Array<{ key: string; host: ArisTabChatHost | null }> = []
    const onChatHostChange = vi.fn((key: string, host: ArisTabChatHost | null) => {
      hostChanges.push({ key, host })
    })

    const view = render(
      <ArisStudioTab
        title="Order intake"
        studio={studio}
        modelId={modelId}
        active
        lang="en"
        sourceText={'<xml/>'}
        canImport={false}
        onModelChange={() => undefined}
        onDownloadSource={() => undefined}
        onDownloadAttachment={() => undefined}
        onOpenAssistant={() => undefined}
        onImportPackage={() => undefined}
        onToast={() => undefined}
        chatHostKey="tab-1"
        onChatHostChange={onChatHostChange}
      />
    )

    await waitFor(
      () => {
        expect(hostChanges.length).toBeGreaterThanOrEqual(1)
        const last = hostChanges[hostChanges.length - 1]
        expect(last?.key).toBe('tab-1')
        expect(last?.host).not.toBeNull()
      },
      { timeout: 3000 }
    )

    const host = hostChanges[hostChanges.length - 1]!.host!
    await waitFor(
      () => {
        expect(host.getDocument()).not.toBeNull()
      },
      { timeout: 3000 }
    )

    const document = host.getDocument()!
    expect(document.models.has(modelId)).toBe(true)
    expect(typeof host.getCanUndo()).toBe('boolean')
    expect(() => host.undo()).not.toThrow()

    view.unmount()

    expect(onChatHostChange).toHaveBeenLastCalledWith('tab-1', null)
  })
})

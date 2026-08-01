// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setLang } from '../../i18n'
import { ArisCanvasCommandError } from '../canvas/commandBridge'
import { bootCanvas, type Harness } from '../canvas/testing/harness'
import { installJsdomSvgSupport } from '../canvas/testing/jsdomSvg'
import { createArisXmlSourcePackage } from '../source/sourcePackage'
import { ArisCanvasContextMenu } from './ArisCanvasContextMenu'
import { ArisStudioTab } from './ArisStudioTab'
import { buildArisStudioDocument } from './arisStudioDocument'

let harness: Harness | null = null

beforeEach(() => {
  setLang('en')
})

afterEach(() => {
  cleanup()
  harness?.destroy()
  harness = null
  vi.restoreAllMocks()
  setLang('en')
})

function mountMenu(
  options: {
    readonly onToast?: ReturnType<typeof vi.fn>
    readonly throwOnChange?: boolean
  } = {}
) {
  harness = bootCanvas()
  const created = harness.canvas.authoring.createObject({
    objectType: 'OT_INFO_CARR',
    symbolNum: 'ST_LOG',
    name: 'Audit trail',
    position: { x: 40, y: 60 }
  })
  const changeObjectType = vi
    .spyOn(harness.canvas.authoring, 'changeObjectType')
    .mockImplementation(() => {
      if (options.throwOnChange) {
        throw new ArisCanvasCommandError('unsupported-object-type', 'Unsupported target')
      }
    })
  const rememberCatalogPresentation = vi.spyOn(
    harness.canvas.palette,
    'rememberCatalogPresentation'
  )
  const onToast = options.onToast ?? vi.fn()
  const onClose = vi.fn()
  const view = render(
    <ArisCanvasContextMenu
      canvas={harness.canvas}
      elementId={created.occurrenceId}
      x={24}
      y={36}
      onClose={onClose}
      onToast={onToast}
    />
  )
  return { ...view, changeObjectType, rememberCatalogPresentation, onToast, onClose }
}

describe('ArisCanvasContextMenu', () => {
  it('renders element actions and changes type through the grouped EEPC symbol picker', () => {
    const { changeObjectType, rememberCatalogPresentation } = mountMenu()
    const menu = within(document.body).getByRole('menu', { name: 'Element actions' })
    expect(within(menu).getByRole('menuitem', { name: 'Change object type…' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Swap symbol' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Delete from this model' })).toBeTruthy()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Change object type…' }))
    const dialog = within(document.body).getByRole('dialog', { name: 'Change object type' })
    expect(dialog.querySelectorAll('[data-aris-library-group]').length).toBeGreaterThan(1)
    expect(
      dialog.querySelector('[data-aris-catalog-id="information.log"]')?.getAttribute('aria-checked')
    ).toBe('true')

    fireEvent.click(dialog.querySelector('[data-aris-catalog-id="epc.function"]')!)
    expect(changeObjectType).toHaveBeenCalledWith(expect.any(String), {
      objectType: 'OT_FUNC',
      symbolNum: 'ST_FUNC',
      catalogId: 'epc.function'
    })
    expect(rememberCatalogPresentation).toHaveBeenCalledWith(expect.any(String), 'epc.function')
  })

  it('reports a refused type change through the error toast', () => {
    const onToast = vi.fn()
    mountMenu({ onToast, throwOnChange: true })
    fireEvent.click(within(document.body).getByRole('menuitem', { name: 'Change object type…' }))
    const dialog = within(document.body).getByRole('dialog', { name: 'Change object type' })
    fireEvent.click(dialog.querySelector('[data-aris-catalog-id="epc.function"]')!)

    expect(onToast).toHaveBeenCalledWith('The type change was refused: Unsupported target', 'error')
  })
})

const CONTEXT_MENU_AML = `<?xml version="1.0" encoding="UTF-8"?>
<AML>
  <Header-Info DatabaseName="Test" UserName="tester" ArisExeVersion="10"/>
  <Group Group.ID="Group.Root">
    <ObjDef ObjDef.ID="ObjDef.One" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">Review request</AttrValue>
        <AttrValue LocaleId="1025">مراجعة الطلب</AttrValue>
      </AttrDef>
    </ObjDef>
    <Model Model.ID="Model.One" Model.Type="MT_EEPC">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">Review</AttrValue>
        <AttrValue LocaleId="1025">مراجعة</AttrValue>
      </AttrDef>
      <ObjOcc ObjOcc.ID="ObjOcc.One" ObjDef.IdRef="ObjDef.One" SymbolNum="ST_FUNC">
        <Position Pos.X="100" Pos.Y="100"/>
        <Size Size.dX="100" Size.dY="70"/>
      </ObjOcc>
    </Model>
  </Group>
</AML>`

const noop = (): void => undefined

describe('ArisStudioTab context-menu wiring', () => {
  it('prevents the browser menu and opens the portal at the pointer coordinates', async () => {
    installJsdomSvgSupport()
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 1200
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 800
    })
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({
        width: 1200,
        height: 800,
        top: 0,
        left: 0,
        right: 1200,
        bottom: 800,
        x: 0,
        y: 0,
        toJSON: () => ({})
      }) as DOMRect
    const pkg = await createArisXmlSourcePackage({
      name: 'context-menu.aml',
      relPath: null,
      bytes: new TextEncoder().encode(CONTEXT_MENU_AML)
    })
    const studio = buildArisStudioDocument(pkg)
    const view = render(
      <ArisStudioTab
        title="Context menu"
        studio={studio}
        modelId="Model.One"
        active
        lang="en"
        sourceText={CONTEXT_MENU_AML}
        canImport={false}
        onModelChange={noop}
        onDownloadSource={noop}
        onDownloadAttachment={noop}
        onOpenAssistant={noop}
        onImportPackage={noop}
        onToast={noop}
      />
    )

    let element: Element | null = null
    await waitFor(() => {
      element = view.container.querySelector('[data-element-id="ObjOcc.One"]')
      expect(element).not.toBeNull()
    })
    const contextMenuEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 123,
      clientY: 234
    })
    let dispatched = true
    act(() => {
      dispatched = (element as Element).dispatchEvent(contextMenuEvent)
    })

    expect(dispatched).toBe(false)
    expect(contextMenuEvent.defaultPrevented).toBe(true)
    const menu = await within(document.body).findByRole('menu', { name: 'Element actions' })
    expect(menu.style.left).toBe('123px')
    expect(menu.style.top).toBe('234px')
    expect(view.container.contains(menu)).toBe(false)
  })
})

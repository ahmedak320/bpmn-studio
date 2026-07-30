// @vitest-environment jsdom

/**
 * Canvas assignment UX (Lane T6): the ⊞ marker + double-click drill-down.
 *
 * These are integration tests over the real `ArisStudioTab` + a booted ARIS
 * canvas (the same jsdom SVG + geometry shims `arisValidationOverlays.test.tsx`
 * uses), so the marker installer runs against a real diagram-js `overlays`
 * service and element registry, and the priority-2000 double-click handler runs
 * against the real event bus alongside C3's direct-editing handler at 1500.
 *
 * They prove: a ⊞ marker appears only on occurrences whose definition carries a
 * `LinkedModels.IdRefs` assignment; clicking the marker (or double-clicking the
 * shape) drills into an in-document target (switching the canvas + calling
 * `onModelChange`); a foreign target is delegated to `onOpenAssignedModel` with
 * the exact id list; removing the assignment removes the marker; the Link-model
 * toolbar button is gated to a single OT_FUNC occurrence; picking in the
 * `LinkPicker` adds the assignment (and undo removes it); and a cross-file
 * assignment id supplied through `externallyKnownModelIds` is not flagged
 * `epc.linkedModel.danglingReference`.
 */

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ArisStudioTab } from './ArisStudioTab'
import { buildArisEpcFindings } from './arisEpcFindings'
import { buildArisStudioDocument, type ArisStudioDocument } from './arisStudioDocument'
import { createArisXmlSourcePackage } from '../source/sourcePackage'
import { installJsdomSvgSupport } from '../canvas/testing/jsdomSvg'
import type { ProcessIndex } from '../../core/processIndex'

// Two-model AML. `ObjDef.Check` (a function) is assigned to the in-document
// `Model.Review`; `ObjDef.Foreign` (a function) is assigned to `Model.External`,
// which is NOT in this source; `ObjDef.Plain` is an unlinked function; the two
// events carry no assignment.
const TWO_MODEL_AML = `<?xml version="1.0" encoding="UTF-8"?>
<AML>
  <Header-Info DatabaseName="AnimalWF" UserName="tester" ArisExeVersion="10"/>
  <Group Group.ID="Group.Root">
    <ObjDef ObjDef.ID="ObjDef.Start" TypeNum="OT_EVT" SymbolNum="ST_EV">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Request received</AttrValue></AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Check" TypeNum="OT_FUNC" SymbolNum="ST_FUNC" LinkedModels.IdRefs="Model.Review">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Check request</AttrValue></AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Plain" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Plain function</AttrValue></AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Foreign" TypeNum="OT_FUNC" SymbolNum="ST_FUNC" LinkedModels.IdRefs="Model.External">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Foreign function</AttrValue></AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Done" TypeNum="OT_EVT" SymbolNum="ST_EV">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Request checked</AttrValue></AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Review" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Review outcome</AttrValue></AttrDef>
    </ObjDef>
    <Model Model.ID="Model.Intake" Model.Type="MT_EEPC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Intake process</AttrValue></AttrDef>
      <ObjOcc ObjOcc.ID="ObjOcc.Start" ObjDef.IdRef="ObjDef.Start" SymbolNum="ST_EV" Zorder="1">
        <Position Pos.X="200" Pos.Y="100"/>
        <Size Size.dX="180" Size.dY="60"/>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Check" ObjDef.IdRef="ObjDef.Check" SymbolNum="ST_FUNC" Zorder="2">
        <Position Pos.X="200" Pos.Y="260"/>
        <Size Size.dX="180" Size.dY="80"/>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Plain" ObjDef.IdRef="ObjDef.Plain" SymbolNum="ST_FUNC" Zorder="3">
        <Position Pos.X="200" Pos.Y="420"/>
        <Size Size.dX="180" Size.dY="80"/>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Foreign" ObjDef.IdRef="ObjDef.Foreign" SymbolNum="ST_FUNC" Zorder="4">
        <Position Pos.X="200" Pos.Y="580"/>
        <Size Size.dX="180" Size.dY="80"/>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Done" ObjDef.IdRef="ObjDef.Done" SymbolNum="ST_EV" Zorder="5">
        <Position Pos.X="200" Pos.Y="740"/>
        <Size Size.dX="180" Size.dY="60"/>
      </ObjOcc>
    </Model>
    <Model Model.ID="Model.Review" Model.Type="MT_EEPC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Review process</AttrValue></AttrDef>
      <ObjOcc ObjOcc.ID="ObjOcc.Review" ObjDef.IdRef="ObjDef.Review" SymbolNum="ST_FUNC" Zorder="1">
        <Position Pos.X="640" Pos.Y="120"/>
        <Size Size.dX="200" Size.dY="90"/>
      </ObjOcc>
    </Model>
  </Group>
</AML>
`

/** jsdom performs no layout — give every element a fixed box + the SVG shim. */
function installCanvasGeometry(): void {
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
}

async function buildStudio(): Promise<ArisStudioDocument> {
  const pkg = await createArisXmlSourcePackage({
    name: 'two-model.aml',
    relPath: null,
    bytes: new TextEncoder().encode(TWO_MODEL_AML)
  })
  return buildArisStudioDocument(pkg)
}

const noop = (): void => undefined

interface MountOptions {
  readonly onModelChange?: (modelId: string) => void
  readonly onOpenAssignedModel?: (request: {
    linkedModelIds: readonly string[]
    definitionId: string
    definitionName: string
  }) => void
  readonly workspaceModelIndex?: ProcessIndex
}

interface Mounted {
  readonly container: HTMLElement
  readonly unmount: () => void
}

function mountStudio(
  studio: ArisStudioDocument,
  modelId: string,
  options: MountOptions = {}
): Mounted {
  const utils = render(
    <ArisStudioTab
      title="Two-model source"
      studio={studio}
      modelId={modelId}
      active
      lang="en"
      sourceText={TWO_MODEL_AML}
      canImport={false}
      onModelChange={options.onModelChange ?? noop}
      onDownloadSource={noop}
      onDownloadAttachment={noop}
      onOpenAssistant={noop}
      onImportPackage={noop}
      onToast={noop}
      workspaceModelIndex={options.workspaceModelIndex}
      onOpenAssignedModel={options.onOpenAssignedModel}
    />
  )
  return { container: utils.container, unmount: utils.unmount }
}

function gfx(container: HTMLElement, id: string): SVGElement {
  const node = container.querySelector<SVGElement>(`[data-element-id="${id}"]`)
  expect(node, `no canvas gfx for ${id}`).not.toBeNull()
  return node as SVGElement
}

afterEach(() => {
  cleanup()
})

describe('canvas assignment marker (⊞)', () => {
  it('marks only occurrences whose definition carries a LinkedModels.IdRefs assignment', async () => {
    installCanvasGeometry()
    const studio = await buildStudio()
    const { container } = mountStudio(studio, 'Model.Intake')

    await waitFor(() => {
      expect(
        container.querySelector('[data-orbitpm-aris-assignment="ObjOcc.Check"]')
      ).not.toBeNull()
    })
    // Foreign-linked function is marked too (it has an assignment, just off-file).
    expect(
      container.querySelector('[data-orbitpm-aris-assignment="ObjOcc.Foreign"]')
    ).not.toBeNull()
    // Events and the unlinked function carry no marker.
    expect(container.querySelector('[data-orbitpm-aris-assignment="ObjOcc.Start"]')).toBeNull()
    expect(container.querySelector('[data-orbitpm-aris-assignment="ObjOcc.Done"]')).toBeNull()
    expect(container.querySelector('[data-orbitpm-aris-assignment="ObjOcc.Plain"]')).toBeNull()
  })

  it('clicking the marker of an in-document target switches the canvas and calls onModelChange', async () => {
    installCanvasGeometry()
    const studio = await buildStudio()
    const onModelChange = vi.fn()
    const { container } = mountStudio(studio, 'Model.Intake', { onModelChange })

    let marker: HTMLButtonElement | null = null
    await waitFor(() => {
      marker = container.querySelector<HTMLButtonElement>(
        '[data-orbitpm-aris-assignment="ObjOcc.Check"]'
      )
      expect(marker).not.toBeNull()
    })

    act(() => {
      ;(marker as unknown as HTMLButtonElement).click()
    })

    expect(onModelChange).toHaveBeenCalledWith('Model.Review')
    // The canvas switched in place: the target model's occurrence is now drawn.
    await waitFor(() => {
      expect(container.querySelector('[data-element-id="ObjOcc.Review"]')).not.toBeNull()
    })
  })

  it('double-clicking the shape gfx drills down exactly like the marker (priority 2000)', async () => {
    installCanvasGeometry()
    const studio = await buildStudio()
    const onModelChange = vi.fn()
    const { container } = mountStudio(studio, 'Model.Intake', { onModelChange })

    await waitFor(() => {
      expect(container.querySelector('[data-element-id="ObjOcc.Check"]')).not.toBeNull()
    })

    act(() => {
      fireEvent.dblClick(gfx(container, 'ObjOcc.Check'))
    })

    expect(onModelChange).toHaveBeenCalledWith('Model.Review')
    await waitFor(() => {
      expect(container.querySelector('[data-element-id="ObjOcc.Review"]')).not.toBeNull()
    })
  })

  it('lets the label editor open when a double-clicked assignment has no in-document target (#10)', async () => {
    installCanvasGeometry()
    const studio = await buildStudio()
    const onOpenAssignedModel = vi.fn()
    const { container } = mountStudio(studio, 'Model.Intake', { onOpenAssignedModel })

    await waitFor(() => {
      expect(container.querySelector('[data-element-id="ObjOcc.Foreign"]')).not.toBeNull()
    })

    act(() => {
      fireEvent.dblClick(gfx(container, 'ObjOcc.Foreign'))
    })

    // Model.External is off-file, so no canonical model opened: the priority-2000
    // handler returns undefined and the direct-edit label editor at 1500 runs.
    await waitFor(() => {
      expect(container.querySelector('.djs-direct-editing-content')).not.toBeNull()
    })
  })

  it('suppresses the label editor when a double-click opens an in-document model (#10)', async () => {
    installCanvasGeometry()
    const studio = await buildStudio()
    const onModelChange = vi.fn()
    const { container } = mountStudio(studio, 'Model.Intake', { onModelChange })

    await waitFor(() => {
      expect(container.querySelector('[data-element-id="ObjOcc.Check"]')).not.toBeNull()
    })

    act(() => {
      fireEvent.dblClick(gfx(container, 'ObjOcc.Check'))
    })

    // A canonical model opened, so the handler halted propagation before 1500 —
    // the label editor never opened for this gesture.
    expect(onModelChange).toHaveBeenCalledWith('Model.Review')
    await waitFor(() => {
      expect(container.querySelector('[data-element-id="ObjOcc.Review"]')).not.toBeNull()
    })
    expect(container.querySelector('.djs-direct-editing-content')).toBeNull()
  })

  it('delegates a foreign target to onOpenAssignedModel with the exact id list', async () => {
    installCanvasGeometry()
    const studio = await buildStudio()
    const onOpenAssignedModel = vi.fn()
    const onModelChange = vi.fn()
    const { container } = mountStudio(studio, 'Model.Intake', {
      onOpenAssignedModel,
      onModelChange
    })

    let marker: HTMLButtonElement | null = null
    await waitFor(() => {
      marker = container.querySelector<HTMLButtonElement>(
        '[data-orbitpm-aris-assignment="ObjOcc.Foreign"]'
      )
      expect(marker).not.toBeNull()
    })

    act(() => {
      ;(marker as unknown as HTMLButtonElement).click()
    })

    expect(onModelChange).not.toHaveBeenCalled()
    expect(onOpenAssignedModel).toHaveBeenCalledTimes(1)
    const request = onOpenAssignedModel.mock.calls[0][0]
    expect(request.linkedModelIds).toEqual(['Model.External'])
    expect(request.definitionId).toBe('ObjDef.Foreign')
  })

  it('removing the assignment through the rail removes the marker', async () => {
    installCanvasGeometry()
    const studio = await buildStudio()
    const { container } = mountStudio(studio, 'Model.Intake')

    await waitFor(() => {
      expect(
        container.querySelector('[data-orbitpm-aris-assignment="ObjOcc.Check"]')
      ).not.toBeNull()
    })

    act(() => {
      fireEvent.click(gfx(container, 'ObjOcc.Check'))
    })
    act(() => {
      fireEvent.click(
        container.querySelector('[data-orbitpm-aris-details-tab="assignments"]') as HTMLElement
      )
    })

    let removeBtn: HTMLButtonElement | null = null
    await waitFor(() => {
      removeBtn = container.querySelector<HTMLButtonElement>(
        '[data-orbitpm-aris-assignment-remove="Model.Review"]'
      )
      expect(removeBtn).not.toBeNull()
    })

    act(() => {
      ;(removeBtn as unknown as HTMLButtonElement).click()
    })

    await waitFor(() => {
      expect(container.querySelector('[data-orbitpm-aris-assignment="ObjOcc.Check"]')).toBeNull()
    })
  })
})

describe('Link-model toolbar button', () => {
  it('is disabled for an event and enabled for a function', async () => {
    installCanvasGeometry()
    const studio = await buildStudio()
    const { container } = mountStudio(studio, 'Model.Intake')

    const linkButton = (): HTMLButtonElement =>
      container.querySelector<HTMLButtonElement>(
        '[data-orbitpm-aris-link-model]'
      ) as HTMLButtonElement

    await waitFor(() => {
      expect(container.querySelector('[data-element-id="ObjOcc.Start"]')).not.toBeNull()
    })
    // Nothing selected ⇒ disabled.
    expect(linkButton().disabled).toBe(true)

    act(() => {
      fireEvent.click(gfx(container, 'ObjOcc.Start'))
    })
    await waitFor(() => expect(linkButton().disabled).toBe(true))

    act(() => {
      fireEvent.click(gfx(container, 'ObjOcc.Plain'))
    })
    await waitFor(() => expect(linkButton().disabled).toBe(false))
  })

  it('picking a model in the LinkPicker adds the assignment; undo removes it', async () => {
    installCanvasGeometry()
    const studio = await buildStudio()
    const { container } = mountStudio(studio, 'Model.Intake')

    await waitFor(() => {
      expect(container.querySelector('[data-element-id="ObjOcc.Plain"]')).not.toBeNull()
    })
    // The unlinked function starts with no marker.
    expect(container.querySelector('[data-orbitpm-aris-assignment="ObjOcc.Plain"]')).toBeNull()

    act(() => {
      fireEvent.click(gfx(container, 'ObjOcc.Plain'))
    })
    await waitFor(() =>
      expect(
        (container.querySelector('[data-orbitpm-aris-link-model]') as HTMLButtonElement).disabled
      ).toBe(false)
    )
    act(() => {
      fireEvent.click(container.querySelector('[data-orbitpm-aris-link-model]') as HTMLElement)
    })

    // The picker (no workspace index) lists the models in this source; pick Review.
    let pick: HTMLButtonElement | null = null
    await waitFor(() => {
      const buttons = Array.from(
        document.querySelectorAll<HTMLButtonElement>('.orbitpm-link-picker button')
      )
      pick = buttons.find((button) => button.textContent?.includes('Model.Review')) ?? null
      expect(pick).not.toBeNull()
    })
    act(() => {
      ;(pick as unknown as HTMLButtonElement).click()
    })

    await waitFor(() => {
      expect(
        container.querySelector('[data-orbitpm-aris-assignment="ObjOcc.Plain"]')
      ).not.toBeNull()
    })

    // Undo the assignment: the marker toggles back off.
    act(() => {
      fireEvent.click(container.querySelector('[data-orbitpm-aris-undo]') as HTMLElement)
    })
    await waitFor(() => {
      expect(container.querySelector('[data-orbitpm-aris-assignment="ObjOcc.Plain"]')).toBeNull()
    })
  })
})

describe('cross-file dangling-assignment suppression (buildArisEpcFindings)', () => {
  it('flags a dangling in-document assignment, but not when the id is externally known', async () => {
    const studio = await buildStudio()
    const document = studio.source

    const withoutExternal = buildArisEpcFindings(document)
    expect(
      withoutExternal.some((finding) => finding.ruleId === 'epc.linkedModel.danglingReference')
    ).toBe(true)

    const withExternal = buildArisEpcFindings(document, undefined, new Set(['Model.External']))
    expect(
      withExternal.some((finding) => finding.ruleId === 'epc.linkedModel.danglingReference')
    ).toBe(false)
  })
})

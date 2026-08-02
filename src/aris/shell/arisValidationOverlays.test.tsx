// @vitest-environment jsdom

/**
 * Per-element canvas warning markers (issue 6).
 *
 * These are integration tests: they mount the real `ArisStudioTab` over a booted
 * ARIS canvas (the same jsdom SVG + geometry shims `ArisApp.test.tsx` uses) so the
 * overlay installer runs against a real diagram-js `overlays` service and element
 * registry. They prove markers appear per element with findings, the native
 * `title` is localized, marker-click reuses the shared reveal-and-highlight path,
 * the marker set re-syncs on a fix, model switches keep markers scoped to the
 * active model, and unmount removes every overlay.
 */

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ArisStudioTab } from './ArisStudioTab'
import { buildArisStudioDocument, type ArisStudioDocument } from './arisStudioDocument'
import { createArisXmlSourcePackage } from '../source/sourcePackage'
import { installJsdomSvgSupport } from '../canvas/testing/jsdomSvg'

// English-only, two-model AML: every definition misses an Arabic name. ObjDef.Review
// records AT_PROC_CODE + AT_PERS_RESP so that deployment vocabulary is in use (the
// DMT-aware scanner gates both attribute checks on that); ObjDef.Check records neither
// but has its AT_ID Identifier and an executor person wired with an R connection, so it
// carries exactly the three advisory warnings — Arabic name, process code, owner, all
// severity `warning` per the DMT manual — while each event carries one (the Arabic name).
const TWO_MODEL_AML = `<?xml version="1.0" encoding="UTF-8"?>
<AML>
  <Header-Info DatabaseName="AnimalWF" UserName="tester" ArisExeVersion="10"/>
  <Group Group.ID="Group.Root">
    <ObjDef ObjDef.ID="ObjDef.Start" TypeNum="OT_EVT" SymbolNum="ST_EV">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Request received</AttrValue></AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Check" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Check request</AttrValue></AttrDef>
      <AttrDef AttrDef.Type="AT_ID"><AttrValue LocaleId="1033">AWF.01.01</AttrValue></AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Done" TypeNum="OT_EVT" SymbolNum="ST_EV">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Request checked</AttrValue></AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Review" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Review outcome</AttrValue></AttrDef>
      <AttrDef AttrDef.Type="AT_ID"><AttrValue LocaleId="1033">AWF.02.01</AttrValue></AttrDef>
      <AttrDef AttrDef.Type="AT_PROC_CODE"><AttrValue LocaleId="1033">P-002</AttrValue></AttrDef>
      <AttrDef AttrDef.Type="AT_PERS_RESP"><AttrValue LocaleId="1033">Review team</AttrValue></AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Person" TypeNum="OT_PERS" SymbolNum="ST_PERS">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Intake officer</AttrValue></AttrDef>
    </ObjDef>
    <CxnDef CxnDef.ID="CxnDef.1" CxnDef.Type="CT_ACTIV_1" ToObjDef.IdRef="ObjDef.Check"/>
    <CxnDef CxnDef.ID="CxnDef.2" CxnDef.Type="CT_CRT_1" ToObjDef.IdRef="ObjDef.Done"/>
    <CxnDef CxnDef.ID="CxnDef.3" CxnDef.Type="CT_EXEC_1" ToObjDef.IdRef="ObjDef.Check"/>
    <Model Model.ID="Model.Intake" Model.Type="MT_EEPC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Intake process</AttrValue></AttrDef>
      <ObjOcc ObjOcc.ID="ObjOcc.Start" ObjDef.IdRef="ObjDef.Start" SymbolNum="ST_EV" Zorder="1">
        <Position Pos.X="200" Pos.Y="100"/>
        <Size Size.dX="180" Size.dY="60"/>
        <CxnOcc CxnOcc.ID="CxnOcc.1" CxnDef.IdRef="CxnDef.1" ToObjOcc.IdRef="ObjOcc.Check" Zorder="5">
          <Position Pos.X="290" Pos.Y="160"/>
          <Position Pos.X="290" Pos.Y="260"/>
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Check" ObjDef.IdRef="ObjDef.Check" SymbolNum="ST_FUNC" Zorder="2">
        <Position Pos.X="200" Pos.Y="260"/>
        <Size Size.dX="180" Size.dY="80"/>
        <CxnOcc CxnOcc.ID="CxnOcc.2" CxnDef.IdRef="CxnDef.2" ToObjOcc.IdRef="ObjOcc.Done" Zorder="6">
          <Position Pos.X="290" Pos.Y="340"/>
          <Position Pos.X="290" Pos.Y="440"/>
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Person" ObjDef.IdRef="ObjDef.Person" SymbolNum="ST_PERS" Zorder="4">
        <Position Pos.X="520" Pos.Y="270"/>
        <Size Size.dX="160" Size.dY="60"/>
        <CxnOcc CxnOcc.ID="CxnOcc.3" CxnDef.IdRef="CxnDef.3" ToObjOcc.IdRef="ObjOcc.Check" Zorder="7">
          <Position Pos.X="520" Pos.Y="300"/>
          <Position Pos.X="380" Pos.Y="300"/>
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Done" ObjDef.IdRef="ObjDef.Done" SymbolNum="ST_EV" Zorder="3">
        <Position Pos.X="200" Pos.Y="440"/>
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

/**
 * jsdom performs no layout, so diagram-js would measure a 0×0 viewport. Give
 * every element a fixed box plus the canvas lane's SVG-geometry shim so the
 * production canvas + overlays code paths run rather than being skipped.
 */
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

interface Mounted {
  readonly container: HTMLElement
  readonly rerender: (modelId: string) => void
  readonly unmount: () => void
}

function mountStudio(studio: ArisStudioDocument, modelId: string): Mounted {
  const view = (id: string): JSX.Element => (
    <ArisStudioTab
      title="Two-model source"
      studio={studio}
      modelId={id}
      active
      lang="en"
      sourceText={TWO_MODEL_AML}
      canImport={false}
      onModelChange={noop}
      onDownloadSource={noop}
      onDownloadAttachment={noop}
      workspaceId={null}
      onCreateModel={noop}
      onDownloadFile={noop}
      onOpenAssistant={noop}
      onOpenSettings={noop}
      onContinueInChat={noop}
      onImportPackage={noop}
      onToast={noop}
    />
  )
  const utils = render(view(modelId))
  return {
    container: utils.container,
    rerender: (id: string) => utils.rerender(view(id)),
    unmount: utils.unmount
  }
}

afterEach(() => {
  cleanup()
})

describe('per-element canvas warning markers', () => {
  it('marks every element that has a finding with a localized tooltip', async () => {
    installCanvasGeometry()
    const studio = await buildStudio()
    const { container } = mountStudio(studio, 'Model.Intake')

    let marker: HTMLElement | null = null
    await waitFor(() => {
      marker = container.querySelector<HTMLElement>('[data-orbitpm-aris-warning="ObjOcc.Check"]')
      expect(marker).not.toBeNull()
    })

    const found = marker as unknown as HTMLElement
    expect(Number(found.getAttribute('data-orbitpm-aris-warning-count'))).toBeGreaterThanOrEqual(1)
    // The DMT manual treats names/optional attributes as advisory, so every finding on
    // this element is a warning; `error` is reserved for structural violations.
    expect(found.getAttribute('data-orbitpm-aris-warning-severity')).toBe('warning')
    // Proves `t()` resolution against the real dictionary (no hardcoded prose).
    expect(found.getAttribute('title')).toContain('No Arabic name is recorded.')

    // An event with a single finding is also marked.
    expect(container.querySelector('[data-orbitpm-aris-warning="ObjOcc.Start"]')).not.toBeNull()
  })

  it('clicking a marker reveals the element and opens the details field to fix', async () => {
    installCanvasGeometry()
    const studio = await buildStudio()
    const { container } = mountStudio(studio, 'Model.Intake')

    let marker: HTMLButtonElement | null = null
    await waitFor(() => {
      marker = container.querySelector<HTMLButtonElement>(
        '[data-orbitpm-aris-warning="ObjOcc.Check"]'
      )
      expect(marker).not.toBeNull()
    })

    act(() => {
      ;(marker as unknown as HTMLButtonElement).click()
    })

    await waitFor(() => {
      const namesTab = container.querySelector('[data-orbitpm-aris-details-tab="names"]')
      expect(namesTab?.getAttribute('aria-selected')).toBe('true')
      const panel = container.querySelector('[data-orbitpm-aris-highlight-field="name:ar"]')
      expect(panel).not.toBeNull()
      const input = container.querySelector('[data-orbitpm-aris-name-input="definition:ar"]')
      expect(input?.classList.contains('orbitpm-aris-field-flash')).toBe(true)
    })
  })

  it('re-syncs markers when a finding is fixed through the rail', async () => {
    installCanvasGeometry()
    const studio = await buildStudio()
    const { container } = mountStudio(studio, 'Model.Intake')

    let before = 0
    let marker: HTMLButtonElement | null = null
    await waitFor(() => {
      marker = container.querySelector<HTMLButtonElement>(
        '[data-orbitpm-aris-warning="ObjOcc.Check"]'
      )
      expect(marker).not.toBeNull()
      before = Number(marker?.getAttribute('data-orbitpm-aris-warning-count'))
      expect(before).toBeGreaterThanOrEqual(2)
    })

    // Marker click opens the names tab focused on the Arabic name input.
    act(() => {
      ;(marker as unknown as HTMLButtonElement).click()
    })
    let input: HTMLInputElement | null = null
    await waitFor(() => {
      input = container.querySelector<HTMLInputElement>(
        '[data-orbitpm-aris-name-input="definition:ar"]'
      )
      expect(input).not.toBeNull()
    })

    // Recording an Arabic name clears the missingArabicName finding; the live
    // document re-scan drives an ARIS_DOCUMENT_CHANGED → overlay resync.
    const arInput = input as unknown as HTMLInputElement
    fireEvent.change(arInput, { target: { value: 'فحص الطلب' } })
    fireEvent.blur(arInput)

    await waitFor(() => {
      const updated = container.querySelector<HTMLElement>(
        '[data-orbitpm-aris-warning="ObjOcc.Check"]'
      )
      expect(updated).not.toBeNull()
      const after = Number(updated?.getAttribute('data-orbitpm-aris-warning-count'))
      expect(after).toBe(before - 1)
    })
  })

  it('scopes markers to the active model and re-scopes on a model switch', async () => {
    installCanvasGeometry()
    const studio = await buildStudio()
    const { container, rerender } = mountStudio(studio, 'Model.Intake')

    await waitFor(() => {
      expect(container.querySelector('[data-orbitpm-aris-warning="ObjOcc.Check"]')).not.toBeNull()
    })
    expect(container.querySelector('[data-orbitpm-aris-warning="ObjOcc.Review"]')).toBeNull()

    act(() => {
      rerender('Model.Review')
    })

    await waitFor(() => {
      expect(container.querySelector('[data-orbitpm-aris-warning="ObjOcc.Review"]')).not.toBeNull()
      expect(container.querySelector('[data-orbitpm-aris-warning="ObjOcc.Check"]')).toBeNull()
    })
  })

  it('removes every overlay on unmount', async () => {
    installCanvasGeometry()
    const studio = await buildStudio()
    const { container, unmount } = mountStudio(studio, 'Model.Intake')

    await waitFor(() => {
      expect(container.querySelector('[data-orbitpm-aris-warning="ObjOcc.Check"]')).not.toBeNull()
    })

    unmount()

    expect(document.querySelectorAll('[data-orbitpm-aris-warning]').length).toBe(0)
  })
})

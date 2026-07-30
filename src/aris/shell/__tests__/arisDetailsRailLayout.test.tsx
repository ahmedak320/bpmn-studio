// @vitest-environment jsdom

/**
 * Details-rail layout chrome: collapse/expand toggle, draggable width handle,
 * persistence, and RTL-correct keyboard/pointer resize.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ArisStudioTab } from '../ArisStudioTab'
import { buildArisStudioDocument } from '../arisStudioDocument'
import { createArisXmlSourcePackage } from '../../source/sourcePackage'
import { SYNTHETIC_AML } from '../../model/testFixture'
import { readArisRailCollapsed } from '../arisRailLayout'

async function buildPopulatedStudio() {
  const pkg = await createArisXmlSourcePackage({
    name: 'populated.aml',
    relPath: null,
    bytes: new TextEncoder().encode(SYNTHETIC_AML)
  })
  const studio = buildArisStudioDocument(pkg)
  return { studio, modelId: 'm1' }
}

const noop = () => undefined

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('ARIS details rail layout', () => {
  it('renders expanded with the default width and a labelled resizer', async () => {
    const { studio, modelId } = await buildPopulatedStudio()
    const { container } = render(
      <ArisStudioTab
        title="Populated model"
        studio={studio}
        modelId={modelId}
        active={false}
        lang="en"
        sourceText={'<xml/>'}
        canImport={false}
        onModelChange={noop}
        onDownloadSource={noop}
        onDownloadAttachment={noop}
        onOpenAssistant={noop}
        onImportPackage={noop}
        onToast={noop}
      />
    )

    const toggle = container.querySelector('[data-orbitpm-aris-rail-collapse]')
    expect(toggle).not.toBeNull()
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')

    const rail = container.querySelector('[data-orbitpm-aris-rail]')
    expect(rail).not.toBeNull()
    const railStyle = rail?.getAttribute('style') ?? ''
    expect(railStyle).not.toContain('display: none')
    expect(railStyle).toContain('inline-size: 340px')

    const separator = screen.getByRole('separator', { name: 'Resize the details rail' })
    expect(separator.getAttribute('aria-valuenow')).toBe('340')
    expect(separator.getAttribute('aria-valuemin')).toBe('260')
    expect(separator.getAttribute('aria-valuemax')).toBe('560')
    expect(separator.getAttribute('tabindex')).toBe('0')
  })

  it('collapse toggles, keeps the aside mounted, and persists', async () => {
    const { studio, modelId } = await buildPopulatedStudio()
    const { container } = render(
      <ArisStudioTab
        title="Populated model"
        studio={studio}
        modelId={modelId}
        active={false}
        lang="en"
        sourceText={'<xml/>'}
        canImport={false}
        onModelChange={noop}
        onDownloadSource={noop}
        onDownloadAttachment={noop}
        onOpenAssistant={noop}
        onImportPackage={noop}
        onToast={noop}
      />
    )

    const toggle = container.querySelector('[data-orbitpm-aris-rail-collapse]') as HTMLElement
    fireEvent.click(toggle)

    const rail = container.querySelector('[data-orbitpm-aris-rail]') as HTMLElement
    expect(rail.style.display).toBe('none')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('separator', { name: 'Resize the details rail' })).toBeNull()
    expect(localStorage.getItem('orbitpm.aris.detailsRailCollapsed')).toBe('1')

    fireEvent.click(toggle)
    expect(rail.style.display).toBe('')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(localStorage.getItem('orbitpm.aris.detailsRailCollapsed')).toBe('0')
  })

  it('restores collapsed state on mount', async () => {
    localStorage.setItem('orbitpm.aris.detailsRailCollapsed', '1')
    const { studio, modelId } = await buildPopulatedStudio()
    const { container } = render(
      <ArisStudioTab
        title="Populated model"
        studio={studio}
        modelId={modelId}
        active={false}
        lang="en"
        sourceText={'<xml/>'}
        canImport={false}
        onModelChange={noop}
        onDownloadSource={noop}
        onDownloadAttachment={noop}
        onOpenAssistant={noop}
        onImportPackage={noop}
        onToast={noop}
      />
    )

    const toggle = container.querySelector('[data-orbitpm-aris-rail-collapse]')
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    const rail = container.querySelector('[data-orbitpm-aris-rail]') as HTMLElement
    expect(rail.style.display).toBe('none')
  })

  it('keyboard resize is direction-aware and clamps in LTR', async () => {
    const { studio, modelId } = await buildPopulatedStudio()
    const { container } = render(
      <ArisStudioTab
        title="Populated model"
        studio={studio}
        modelId={modelId}
        active={false}
        lang="en"
        sourceText={'<xml/>'}
        canImport={false}
        onModelChange={noop}
        onDownloadSource={noop}
        onDownloadAttachment={noop}
        onOpenAssistant={noop}
        onImportPackage={noop}
        onToast={noop}
      />
    )

    const separator = screen.getByRole('separator', { name: 'Resize the details rail' })
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(separator.getAttribute('aria-valuenow')).toBe('356')
    expect(localStorage.getItem('orbitpm.aris.detailsRailWidth')).toBe('356')
    expect(
      (container.querySelector('[data-orbitpm-aris-rail]') as HTMLElement).style.inlineSize
    ).toBe('356px')

    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(separator.getAttribute('aria-valuenow')).toBe('340')

    fireEvent.keyDown(separator, { key: 'Home' })
    expect(separator.getAttribute('aria-valuenow')).toBe('260')

    fireEvent.keyDown(separator, { key: 'End' })
    expect(separator.getAttribute('aria-valuenow')).toBe('560')
  })

  it('flips the resize axis in RTL', async () => {
    const { studio, modelId } = await buildPopulatedStudio()
    const { container } = render(
      <ArisStudioTab
        title="Populated model"
        studio={studio}
        modelId={modelId}
        active={false}
        lang="ar"
        sourceText={'<xml/>'}
        canImport={false}
        onModelChange={noop}
        onDownloadSource={noop}
        onDownloadAttachment={noop}
        onOpenAssistant={noop}
        onImportPackage={noop}
        onToast={noop}
      />
    )

    const separator = screen.getByRole('separator', { name: 'Resize the details rail' })
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(separator.getAttribute('aria-valuenow')).toBe('324')
    expect(
      (container.querySelector('[data-orbitpm-aris-rail]') as HTMLElement).style.inlineSize
    ).toBe('324px')
  })

  it('pointer drag persists and clamps', async () => {
    const { studio, modelId } = await buildPopulatedStudio()
    const { container } = render(
      <ArisStudioTab
        title="Populated model"
        studio={studio}
        modelId={modelId}
        active={false}
        lang="en"
        sourceText={'<xml/>'}
        canImport={false}
        onModelChange={noop}
        onDownloadSource={noop}
        onDownloadAttachment={noop}
        onOpenAssistant={noop}
        onImportPackage={noop}
        onToast={noop}
      />
    )

    const separator = screen.getByRole('separator', { name: 'Resize the details rail' })
    fireEvent.pointerDown(separator, { button: 0, clientX: 400, pointerId: 1 })
    fireEvent.pointerMove(separator, { clientX: 340, pointerId: 1 })

    expect(separator.getAttribute('aria-valuenow')).toBe('400')
    expect(localStorage.getItem('orbitpm.aris.detailsRailWidth')).toBe('400')
    expect(
      (container.querySelector('[data-orbitpm-aris-rail]') as HTMLElement).style.inlineSize
    ).toBe('400px')

    fireEvent.pointerMove(separator, { clientX: -5000, pointerId: 1 })
    expect(separator.getAttribute('aria-valuenow')).toBe('560')
    expect(localStorage.getItem('orbitpm.aris.detailsRailWidth')).toBe('560')
  })

  it('restores stored width and falls back to default on garbage', async () => {
    localStorage.setItem('orbitpm.aris.detailsRailWidth', '480')
    const { studio, modelId } = await buildPopulatedStudio()
    const { container: firstContainer } = render(
      <ArisStudioTab
        title="Populated model"
        studio={studio}
        modelId={modelId}
        active={false}
        lang="en"
        sourceText={'<xml/>'}
        canImport={false}
        onModelChange={noop}
        onDownloadSource={noop}
        onDownloadAttachment={noop}
        onOpenAssistant={noop}
        onImportPackage={noop}
        onToast={noop}
      />
    )

    const separator = screen.getByRole('separator', { name: 'Resize the details rail' })
    expect(separator.getAttribute('aria-valuenow')).toBe('480')
    expect(
      (firstContainer.querySelector('[data-orbitpm-aris-rail]') as HTMLElement).style.inlineSize
    ).toBe('480px')

    cleanup()
    localStorage.setItem('orbitpm.aris.detailsRailWidth', 'abc')
    const { container: secondContainer } = render(
      <ArisStudioTab
        title="Populated model"
        studio={studio}
        modelId={modelId}
        active={false}
        lang="en"
        sourceText={'<xml/>'}
        canImport={false}
        onModelChange={noop}
        onDownloadSource={noop}
        onDownloadAttachment={noop}
        onOpenAssistant={noop}
        onImportPackage={noop}
        onToast={noop}
      />
    )

    const secondSeparator = screen.getByRole('separator', { name: 'Resize the details rail' })
    expect(secondSeparator.getAttribute('aria-valuenow')).toBe('340')
    expect(
      (secondContainer.querySelector('[data-orbitpm-aris-rail]') as HTMLElement).style.inlineSize
    ).toBe('340px')

    fireEvent.doubleClick(secondSeparator)
    expect(localStorage.getItem('orbitpm.aris.detailsRailWidth')).toBeNull()
    expect(secondSeparator.getAttribute('aria-valuenow')).toBe('340')
  })

  it('readArisRailCollapsed handles stored, absent and unreadable values', () => {
    localStorage.setItem('orbitpm.aris.detailsRailCollapsed', '1')
    expect(readArisRailCollapsed()).toBe(true)

    localStorage.setItem('orbitpm.aris.detailsRailCollapsed', '0')
    expect(readArisRailCollapsed()).toBe(false)

    localStorage.removeItem('orbitpm.aris.detailsRailCollapsed')
    expect(readArisRailCollapsed()).toBe(false)

    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    expect(readArisRailCollapsed()).toBe(false)
    getItem.mockRestore()
  })
})

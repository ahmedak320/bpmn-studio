// @vitest-environment jsdom

/**
 * Empty-model hint: when the active ARIS model has no occurrences, the shell
 * shows a dismissible card above the canvas. It must disappear when the model
 * is populated.
 */

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ArisStudioTab } from '../ArisStudioTab'
import { buildBlankArisAml } from '../arisBlankModel'
import { buildArisStudioDocument } from '../arisStudioDocument'
import { createArisXmlSourcePackage } from '../../source/sourcePackage'
import { SYNTHETIC_AML } from '../../model/testFixture'

async function buildBlankStudio() {
  const { xml, modelId } = buildBlankArisAml({
    names: { en: 'Blank model' },
    modelType: 'MT_EEPC'
  })
  const pkg = await createArisXmlSourcePackage({
    name: 'blank.aml',
    relPath: null,
    bytes: new TextEncoder().encode(xml)
  })
  return { studio: buildArisStudioDocument(pkg), modelId }
}

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

afterEach(() => {
  cleanup()
})

describe('empty-model hint', () => {
  it('shows the hint for a blank model', async () => {
    const { studio, modelId } = await buildBlankStudio()

    const { container } = render(
      <ArisStudioTab
        title="Blank model"
        studio={studio}
        modelId={modelId}
        active={false}
        lang="en"
        sourceFacts={[]}
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

    expect(container.querySelector('[data-orbitpm-aris-empty-hint]')).not.toBeNull()
  })

  it('hides the hint for a populated model', async () => {
    const { studio, modelId } = await buildPopulatedStudio()

    const { container } = render(
      <ArisStudioTab
        title="Populated model"
        studio={studio}
        modelId={modelId}
        active={false}
        lang="en"
        sourceFacts={[]}
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

    expect(container.querySelector('[data-orbitpm-aris-empty-hint]')).toBeNull()
  })

  it('hides the hint after the user dismisses it', async () => {
    const { studio, modelId } = await buildBlankStudio()

    const { container, getByText } = render(
      <ArisStudioTab
        title="Blank model"
        studio={studio}
        modelId={modelId}
        active={false}
        lang="en"
        sourceFacts={[]}
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

    fireEvent.click(getByText('Got it'))

    expect(container.querySelector('[data-orbitpm-aris-empty-hint]')).toBeNull()
  })
})

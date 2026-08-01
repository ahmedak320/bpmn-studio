// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { listTranslationRecoveryFields } from '../../../localization/translationRecovery'
import { buildArisLocalizationReview, countArisMissingTranslations } from '../../localization'
import { makeDocument } from '../../localization/__tests__/support'
import { createArisXmlSourcePackage } from '../../source/sourcePackage'
import { ArisStudioTab } from '../ArisStudioTab'
import { buildBlankArisAml } from '../arisBlankModel'
import { buildArisStudioDocument, type ArisStudioDocument } from '../arisStudioDocument'

const controllerCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>)

vi.mock('../ArisTranslateController', async () => {
  const React = await import('react')
  return {
    ArisTranslateController: React.forwardRef<unknown, Record<string, unknown>>(
      function MockArisTranslateController(props, _ref) {
        controllerCalls.push(props)
        React.useEffect(() => {
          const onState = props.onAutoTranslateState as ((state: 'done') => void) | undefined
          onState?.('done')
        }, [props.onAutoTranslateState])
        return null
      }
    )
  }
})

async function unnamedStudio(): Promise<ArisStudioDocument> {
  const { xml } = buildBlankArisAml({
    names: { en: 'Placeholder' },
    modelType: 'MT_EEPC'
  })
  const pkg = await createArisXmlSourcePackage({
    name: 'unnamed.aml',
    relPath: null,
    bytes: new TextEncoder().encode(xml)
  })
  const base = buildArisStudioDocument(pkg)
  const source = makeDocument({ modelId: 'Model.unnamed' })
  const model = source.models.get('Model.unnamed')!
  return {
    ...base,
    source,
    models: [
      {
        ...base.models[0]!,
        id: model.id,
        names: model.names,
        objectCount: 0,
        connectionCount: 0
      }
    ]
  }
}

const noop = () => undefined

afterEach(() => {
  cleanup()
  controllerCalls.length = 0
})

describe('ArisStudioTab translation composition', () => {
  it('auto-translates AML tabs, exposes controller state, and badges exact recovery rows', async () => {
    const studio = await unnamedStudio()
    const { review } = buildArisLocalizationReview({
      document: studio.source,
      target: 'ar',
      active: 'en'
    })
    const expectedMissing = listTranslationRecoveryFields(review).length

    expect(expectedMissing).toBeGreaterThan(0)
    expect(countArisMissingTranslations(studio.source).ar).not.toBe(expectedMissing)

    const { container } = render(
      <ArisStudioTab
        title="Unnamed model"
        studio={studio}
        modelId="Model.unnamed"
        active={false}
        lang="en"
        sourceText="<xml/>"
        canImport={false}
        sourceKind="aml"
        onModelChange={noop}
        onDownloadSource={noop}
        onDownloadAttachment={noop}
        onOpenAssistant={noop}
        onImportPackage={noop}
        onToast={noop}
      />
    )

    await waitFor(() =>
      expect(container.querySelector('[data-orbitpm-aris-auto-translate="done"]')).not.toBeNull()
    )
    expect(controllerCalls.at(-1)?.autoTranslateEligible).toBe(true)
    expect(
      container
        .querySelector('[data-orbitpm-aris-translate-missing]')
        ?.getAttribute('data-orbitpm-aris-translate-missing')
    ).toBe(String(expectedMissing))
  })
})

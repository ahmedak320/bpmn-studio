// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ReadOnlyDiagramPreview,
  type ReadOnlyDiagramPreviewViewer,
  type ReadOnlyDiagramPreviewViewerFactory
} from '../ReadOnlyDiagramPreview'
import { VALIDATION_TECHNICAL_DETAIL_MAX_CODE_POINTS } from '../technicalEvidence'

vi.mock('../../i18n', () => ({
  t: (key: string, variables?: Record<string, string | number>): string =>
    variables?.error === undefined ? key : `${key}:${variables.error}`
}))

afterEach(cleanup)

function recordingFactory(
  importResult: Promise<{ warnings?: readonly unknown[] }> = Promise.resolve({})
): {
  createViewer: ReadOnlyDiagramPreviewViewerFactory
  viewers: Array<{
    importXML: ReturnType<typeof vi.fn>
    zoom: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }>
} {
  const viewers: Array<{
    importXML: ReturnType<typeof vi.fn>
    zoom: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }> = []
  const createViewer: ReadOnlyDiagramPreviewViewerFactory = () => {
    const zoom = vi.fn()
    const viewer = {
      importXML: vi.fn(() => importResult),
      zoom,
      destroy: vi.fn(),
      get: vi.fn(() => ({ zoom }))
    }
    viewers.push(viewer)
    return viewer as unknown as ReadOnlyDiagramPreviewViewer
  }
  return { createViewer, viewers }
}

describe('ReadOnlyDiagramPreview', () => {
  it('renders the exact XML with an editing-service-free viewer and fits the viewport', async () => {
    const factory = recordingFactory(Promise.resolve({ warnings: ['viewer warning'] }))
    const onStatusChange = vi.fn()
    const xml = '<definitions id="exact-layout"/>'

    render(
      <ReadOnlyDiagramPreview
        xml={xml}
        title="Generated diagram"
        ariaLabel="Exact read-only preview"
        createViewer={factory.createViewer}
        onStatusChange={onStatusChange}
      />
    )

    await waitFor(() => expect(factory.viewers).toHaveLength(1))
    await waitFor(() => expect(factory.viewers[0]?.zoom).toHaveBeenCalledWith('fit-viewport'))
    expect(factory.viewers[0]?.importXML).toHaveBeenCalledWith(xml)
    expect(
      screen.getByRole('img', { name: 'Exact read-only preview' }).getAttribute('aria-busy')
    ).toBe('false')
    expect(onStatusChange).toHaveBeenLastCalledWith({ status: 'ready', warningCount: 1 })
  })

  it('destroys a stale viewer on XML replacement and ignores its late result', async () => {
    let resolveFirst!: (value: { warnings?: readonly unknown[] }) => void
    const first = recordingFactory(
      new Promise((resolve) => {
        resolveFirst = resolve
      })
    )
    const second = recordingFactory()
    const view = render(
      <ReadOnlyDiagramPreview
        xml='<definitions id="first"/>'
        title="Preview"
        createViewer={first.createViewer}
      />
    )
    await waitFor(() => expect(first.viewers).toHaveLength(1))

    view.rerender(
      <ReadOnlyDiagramPreview
        xml='<definitions id="second"/>'
        title="Preview"
        createViewer={second.createViewer}
      />
    )

    await waitFor(() => expect(first.viewers[0]?.destroy).toHaveBeenCalledOnce())
    await waitFor(() => expect(second.viewers[0]?.zoom).toHaveBeenCalledOnce())
    resolveFirst({ warnings: [] })
    await Promise.resolve()
    expect(first.viewers[0]?.zoom).not.toHaveBeenCalled()

    view.unmount()
    expect(second.viewers[0]?.destroy).toHaveBeenCalledOnce()
  })

  it('reports render errors accessibly and releases the failed viewer', async () => {
    const factory = recordingFactory(Promise.reject(new Error('bad DI')))
    render(
      <ReadOnlyDiagramPreview
        xml="<definitions/>"
        title="Preview"
        createViewer={factory.createViewer}
      />
    )

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('sourceEditor.diagramPreview.failed')
    expect(alert.textContent).not.toContain('bad DI')
    const evidence = document.querySelector('[data-read-only-preview-error-technical]')
    expect(evidence?.querySelector('code')?.textContent).toBe('bad DI')
    expect(evidence?.querySelector('code')?.getAttribute('lang')).toBe('en')
    expect(evidence?.querySelector('code')?.getAttribute('dir')).toBe('ltr')
    expect(factory.viewers[0]?.destroy).toHaveBeenCalledOnce()
  })

  it('bounds a megabyte viewer diagnostic without splitting a Unicode code point', async () => {
    const detail = `${'x'.repeat(510)}😀TAIL${'z'.repeat(1_000_000)}`
    const expected = `${'x'.repeat(510)}😀…`
    const factory = recordingFactory(Promise.reject(new Error(detail)))
    const onStatusChange = vi.fn()
    render(
      <ReadOnlyDiagramPreview
        xml="<definitions/>"
        title="Preview"
        createViewer={factory.createViewer}
        onStatusChange={onStatusChange}
      />
    )

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('sourceEditor.diagramPreview.failed')
    const code = document.querySelector('[data-read-only-preview-error-technical] code')
    expect(code?.textContent).toBe(expected)
    expect(Array.from(code?.textContent ?? '')).toHaveLength(
      VALIDATION_TECHNICAL_DETAIL_MAX_CODE_POINTS
    )
    expect(code?.textContent).not.toContain('\uFFFD')
    expect(onStatusChange).toHaveBeenLastCalledWith({
      status: 'error',
      message: expected
    })
  })
})

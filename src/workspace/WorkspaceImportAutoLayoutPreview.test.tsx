// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../i18n'
import {
  WorkspaceImportAutoLayoutPreview,
  type WorkspaceImportAutoLayoutPreviewArtifact,
  type WorkspaceImportPreviewViewer,
  type WorkspaceImportPreviewViewerFactory
} from './WorkspaceImportAutoLayoutPreview'

afterEach(() => {
  cleanup()
  setLang('en')
})

const REVIEWED_XML =
  '<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Exact_reviewed_DI"/>'

function exactArtifact(
  overrides: Partial<WorkspaceImportAutoLayoutPreviewArtifact> = {}
): WorkspaceImportAutoLayoutPreviewArtifact {
  return {
    artifactId: 'artifact-layout-exact',
    sourceId: 'source-layout-exact',
    sourceName: 'طلبات الشراء.bpmn',
    sourcePath: 'incoming/طلبات الشراء.bpmn',
    destinationPath: 'operations/purchase-request.bpmn',
    reviewedXml: REVIEWED_XML,
    ...overrides
  }
}

function recordingFactory(options?: {
  importResult?: Promise<{ warnings?: readonly unknown[] }>
  createError?: Error
}): {
  createViewer: WorkspaceImportPreviewViewerFactory
  viewers: Array<{
    container: HTMLElement
    importXML: ReturnType<typeof vi.fn>
    zoom: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }>
} {
  const viewers: Array<{
    container: HTMLElement
    importXML: ReturnType<typeof vi.fn>
    zoom: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }> = []
  const createViewer: WorkspaceImportPreviewViewerFactory = ({ container }) => {
    if (options?.createError) throw options.createError
    const zoom = vi.fn()
    const viewer = {
      container,
      importXML: vi.fn(() => options?.importResult ?? Promise.resolve({ warnings: [] })),
      zoom,
      destroy: vi.fn(),
      get: vi.fn((service: 'canvas') => {
        expect(service).toBe('canvas')
        return { zoom }
      })
    }
    viewers.push(viewer)
    return viewer as unknown as WorkspaceImportPreviewViewer
  }
  return { createViewer, viewers }
}

describe('WorkspaceImportAutoLayoutPreview', () => {
  it('renders each exact reviewed artifact, fits its viewport, and exposes review evidence', async () => {
    const first = exactArtifact()
    const second = exactArtifact({
      artifactId: 'artifact-layout-second',
      sourceId: 'source-layout-second',
      sourceName: 'Second source.bpmn',
      sourcePath: undefined,
      destinationPath: 'operations/second.bpmn',
      reviewedXml: '<definitions id="Second_exact_reviewed_DI"/>'
    })
    const { createViewer, viewers } = recordingFactory()

    render(
      <WorkspaceImportAutoLayoutPreview artifacts={[first, second]} createViewer={createViewer} />
    )

    await waitFor(() => expect(viewers).toHaveLength(2))
    await waitFor(() => {
      expect(viewers[0]?.zoom).toHaveBeenCalledWith('fit-viewport')
      expect(viewers[1]?.zoom).toHaveBeenCalledWith('fit-viewport')
    })

    expect(viewers[0]?.importXML).toHaveBeenCalledWith(REVIEWED_XML)
    expect(viewers[1]?.importXML).toHaveBeenCalledWith(second.reviewedXml)
    expect(screen.getByText('source-layout-exact')).not.toBeNull()
    expect(screen.getByText('artifact-layout-exact')).not.toBeNull()
    expect(screen.getByText('incoming/طلبات الشراء.bpmn')).not.toBeNull()
    expect(screen.getByText('operations/purchase-request.bpmn')).not.toBeNull()
    expect(
      screen
        .getByRole('img', {
          name: 'Read-only graph preview: operations/purchase-request.bpmn'
        })
        .getAttribute('aria-busy')
    ).toBe('false')
  })

  it('destroys the viewer on XML replacement and unmount without using a stale import result', async () => {
    let resolveFirst!: (result: { warnings?: readonly unknown[] }) => void
    const firstImport = new Promise<{ warnings?: readonly unknown[] }>((resolve) => {
      resolveFirst = resolve
    })
    const firstFactory = recordingFactory({ importResult: firstImport })
    const secondFactory = recordingFactory()
    const artifact = exactArtifact()
    const view = render(
      <WorkspaceImportAutoLayoutPreview
        artifacts={[artifact]}
        createViewer={firstFactory.createViewer}
      />
    )

    await waitFor(() => expect(firstFactory.viewers).toHaveLength(1))
    view.rerender(
      <WorkspaceImportAutoLayoutPreview
        artifacts={[{ ...artifact, reviewedXml: '<definitions id="replacement"/>' }]}
        createViewer={secondFactory.createViewer}
      />
    )

    await waitFor(() => expect(firstFactory.viewers[0]?.destroy).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(secondFactory.viewers[0]?.zoom).toHaveBeenCalledWith('fit-viewport'))
    resolveFirst({ warnings: [] })
    await Promise.resolve()
    expect(firstFactory.viewers[0]?.zoom).not.toHaveBeenCalled()

    view.unmount()
    expect(secondFactory.viewers[0]?.destroy).toHaveBeenCalledTimes(1)
  })

  it('reports import and construction failures accessibly and releases failed viewers', async () => {
    const failedImport = recordingFactory({
      importResult: Promise.reject(new Error('Exact render failure'))
    })
    const first = render(
      <WorkspaceImportAutoLayoutPreview
        artifacts={[exactArtifact()]}
        createViewer={failedImport.createViewer}
      />
    )

    expect((await screen.findByRole('alert')).textContent).toContain('Exact render failure')
    expect(failedImport.viewers[0]?.destroy).toHaveBeenCalledTimes(1)
    first.unmount()
    expect(failedImport.viewers[0]?.destroy).toHaveBeenCalledTimes(1)

    const failedConstruction = recordingFactory({
      createError: new Error('Viewer construction failure')
    })
    render(
      <WorkspaceImportAutoLayoutPreview
        artifacts={[exactArtifact()]}
        createViewer={failedConstruction.createViewer}
      />
    )
    expect((await screen.findByRole('alert')).textContent).toContain('Viewer construction failure')
  })

  it('never mutates the sealed artifact list or exact reviewed XML', async () => {
    const artifact = Object.freeze(exactArtifact())
    const artifacts = Object.freeze([artifact])
    const before = JSON.stringify(artifacts)
    const { createViewer, viewers } = recordingFactory({
      importResult: Promise.resolve({ warnings: ['viewer warning'] })
    })

    render(<WorkspaceImportAutoLayoutPreview artifacts={artifacts} createViewer={createViewer} />)

    await waitFor(() => expect(viewers[0]?.zoom).toHaveBeenCalledWith('fit-viewport'))
    expect(viewers[0]?.importXML).toHaveBeenCalledWith(REVIEWED_XML)
    expect(JSON.stringify(artifacts)).toBe(before)
    expect(artifact.reviewedXml).toBe(REVIEWED_XML)
    expect(screen.getByRole('status').textContent).toContain('Warnings: 1')
  })
})

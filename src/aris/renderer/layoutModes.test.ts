import { describe, expect, it } from 'vitest'

import { buildArisRenderModel } from './buildRenderModel'
import { ArisLayoutController, extractSourceGeometry } from './layoutModes'
import { buildHappyPathInput } from './testFixtures'

function buildDoc() {
  return buildArisRenderModel(buildHappyPathInput()).models[0]
}

describe('Section 12.4 layout modes', () => {
  it('Source Layout reproduces the imported element bounds and connection routes exactly', () => {
    const doc = buildDoc()
    const geometry = extractSourceGeometry(doc)

    for (const element of doc.elements) {
      expect(geometry.elements.get(element.id)?.bounds).toEqual(element.sourceBounds)
    }
    for (const connection of doc.connections) {
      expect(geometry.connections.get(connection.id)?.routePoints).toEqual(
        connection.sourceRoutePoints
      )
    }
  })

  it('starts in Source mode with the active geometry equal to the source snapshot', () => {
    const controller = new ArisLayoutController(buildDoc())
    expect(controller.getMode()).toBe('source')
    expect(controller.getActiveGeometry()).toEqual(controller.getSourceGeometry())
  })

  it('Clean Layout changes the working geometry but never the source snapshot', () => {
    const doc = buildDoc()
    const controller = new ArisLayoutController(doc)
    const sourceBefore = JSON.stringify(mapToObject(controller.getSourceGeometry()))

    controller.runCleanLayout()
    expect(controller.getMode()).toBe('clean')

    const cleanGeometry = controller.getActiveGeometry()
    const sourceGeometry = controller.getSourceGeometry()
    // The default stand-in grid algorithm produces different coordinates than the source.
    expect(mapToObject(cleanGeometry)).not.toEqual(mapToObject(sourceGeometry))
    // The source snapshot itself is untouched.
    expect(JSON.stringify(mapToObject(controller.getSourceGeometry()))).toBe(sourceBefore)
  })

  it('Reset to Source Layout restores geometry numerically identical to the imported values, after Clean Layout ran', () => {
    const doc = buildDoc()
    const controller = new ArisLayoutController(doc)
    const originalSource = mapToObject(controller.getSourceGeometry())

    controller.runCleanLayout()
    expect(mapToObject(controller.getActiveGeometry())).not.toEqual(originalSource)

    controller.resetToSourceLayout()
    expect(controller.getMode()).toBe('source')
    expect(mapToObject(controller.getActiveGeometry())).toEqual(originalSource)
    // And the canonical source snapshot is still exactly what it always was.
    expect(mapToObject(controller.getSourceGeometry())).toEqual(originalSource)
  })

  it('supports undo/redo across Source -> Clean -> Source (reset) transitions', () => {
    const doc = buildDoc()
    const controller = new ArisLayoutController(doc)
    const originalSource = mapToObject(controller.getSourceGeometry())

    controller.runCleanLayout()
    const cleanGeometry = mapToObject(controller.getActiveGeometry())
    controller.resetToSourceLayout()
    expect(mapToObject(controller.getActiveGeometry())).toEqual(originalSource)

    expect(controller.undo()).toBe(true)
    expect(controller.getMode()).toBe('clean')
    expect(mapToObject(controller.getActiveGeometry())).toEqual(cleanGeometry)

    expect(controller.undo()).toBe(true)
    expect(controller.getMode()).toBe('source')
    expect(mapToObject(controller.getActiveGeometry())).toEqual(originalSource)

    expect(controller.undo()).toBe(false) // nothing before the initial source revision

    expect(controller.redo()).toBe(true)
    expect(controller.getMode()).toBe('clean')
    expect(controller.redo()).toBe(true)
    expect(controller.getMode()).toBe('source')
    expect(controller.redo()).toBe(false)
  })

  it('a new action after undo discards the stale redo branch', () => {
    const doc = buildDoc()
    const controller = new ArisLayoutController(doc)
    controller.runCleanLayout()
    controller.resetToSourceLayout()
    controller.undo() // back to clean
    controller.runCleanLayout() // new branch: should drop the old "source (reset)" redo entry
    expect(controller.redo()).toBe(false)
  })
})

// Maps aren't structurally comparable with toEqual directly across independent instances in a
// way that's easy to read on failure, so tests compare plain-object projections instead.
function mapToObject(geometry: ReturnType<typeof extractSourceGeometry>): unknown {
  return {
    elements: Object.fromEntries(geometry.elements),
    connections: Object.fromEntries(geometry.connections)
  }
}

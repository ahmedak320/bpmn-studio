// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import { isLegalConnection } from '../conventions/connectionRules'
import { findConnectionOccurrence } from './commandFactory'
import type { ArisContextPadProvider } from './contextPadProvider'
import { arisBusinessObject } from './elements'
import { bootCanvas, shape, type Harness } from './testing/harness'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

function provider(): ArisContextPadProvider {
  return harness!.canvas.get<ArisContextPadProvider>('arisContextPadProvider')
}

describe('legal DMT context-pad helpers', () => {
  it('does not expose an unrestricted generic connector', () => {
    harness = bootCanvas()
    const created = harness.canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      position: { x: 100, y: 100 }
    })
    const entries = provider().getContextPadEntries(shape(harness.canvas, created.occurrenceId))
    expect(entries.connect).toBeUndefined()
    expect(Object.values(entries).some((entry) => entry.arisConnectionType !== undefined)).toBe(
      true
    )
  })

  it('offers only connection-rule-backed tuples in the correct direction', () => {
    harness = bootCanvas()
    const created = harness.canvas.authoring.createObject({
      objectType: 'OT_PERS_TYPE',
      position: { x: 100, y: 100 }
    })
    const element = shape(harness.canvas, created.occurrenceId)
    const helpers = provider().helpersFor(element)
    expect(
      new Set(
        helpers
          .map((helper) => helper.raci)
          .filter((raci): raci is 'R' | 'A' | 'C' | 'I' => raci !== null)
      )
    ).toEqual(new Set(['R', 'A', 'C', 'I']))
    for (const helper of helpers) {
      const from = helper.direction === 'outgoing' ? 'OT_PERS_TYPE' : helper.peerObjectType
      const to = helper.direction === 'outgoing' ? helper.peerObjectType : 'OT_PERS_TYPE'
      expect(isLegalConnection('MT_EEPC', from, to, helper.connectionType), helper.id).toBe(true)
    }
  })

  it('quick-connects a descriptor-backed peer using the selected legal type', () => {
    harness = bootCanvas()
    const created = harness.canvas.authoring.createObject({
      objectType: 'OT_PERS_TYPE',
      position: { x: 100, y: 100 }
    })
    const selected = shape(harness.canvas, created.occurrenceId)
    const entries = provider().getContextPadEntries(selected)
    const responsible = Object.values(entries).find(
      (entry) => entry.arisDirection === 'outgoing' && entry.arisConnectionType === 'CT_EXEC_2'
    )
    expect(responsible).toBeTruthy()
    responsible?.action.click?.(new Event('click'), selected)

    const model = harness.canvas.document.models.get(harness.canvas.activeModelId)
    expect(model?.occurrences).toHaveLength(2)
    expect(model?.connectionOccurrences).toHaveLength(1)
    const connection = findConnectionOccurrence(
      harness.canvas.document,
      model?.connectionOccurrences[0]?.id ?? ''
    )
    expect(
      harness.canvas.document.connectionDefinitions.get(connection?.definitionId ?? '')?.type
    ).toBe('CT_EXEC_2')

    const peer = model?.occurrences.find((occurrence) => occurrence.id !== created.occurrenceId)
    expect(arisBusinessObject(harness.canvas.elementRegistry.get(peer?.id ?? ''))).toMatchObject({
      kind: 'occurrence',
      objectType: 'OT_FUNC',
      catalogId: 'epc.function'
    })
  })
})

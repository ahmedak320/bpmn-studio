// @vitest-environment jsdom

/**
 * Apply-stage tests drive the REAL `ArisCanvas` command bridge headlessly (same
 * harness the chat-undo suite uses), so "one gesture / one undo" and idempotence
 * are proved on the product's own history, not a stand-in.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { bootCanvas, type Harness } from '../../canvas/testing/harness'
import type { LocalizationPatch } from '../../../localization/types'
import type { ArisWorkingDocument } from '../../model/types'
import {
  applyArisTranslations,
  toArisTranslationUpdates,
  type ArisTranslationUpdate
} from '../apply'
import type { ArisTranslationOwner } from '../fields'
import { buildArisLocalizationReview } from '../review'
import { makeDocument, objectDefinition, occurrence } from './support'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

function arNameOf(document: ArisWorkingDocument, definitionId: string): string | undefined {
  return document.objectDefinitions.get(definitionId)?.names.values['1025']
}

/**
 * A document whose model is already bilingual and whose two definitions are each
 * fully resolvable to Arabic (one via a neutral glossary term, one via TM), so
 * applying the local updates makes the whole review complete.
 */
function resolvableDocument(): ArisWorkingDocument {
  return makeDocument({
    modelId: 'Model.1',
    modelName: { 'en-US': 'Process', '1025': 'عملية' },
    objectDefinitions: [
      objectDefinition('ObjDef.api', 'OT_FUNC', { 'en-US': 'API' }),
      objectDefinition('ObjDef.approve', 'OT_FUNC', { 'en-US': 'Approve' })
    ],
    occurrences: [
      occurrence('ObjOcc.api', 'ObjDef.api', 'Model.1'),
      occurrence('ObjOcc.approve', 'ObjDef.approve', 'Model.1')
    ]
  })
}

const RESOURCES = {
  glossary: [{ en: 'API', ar: 'API', neutral: true } as const],
  translationMemory: [{ en: 'Approve', ar: 'يعتمد', accepted: true } as const]
}

describe('toArisTranslationUpdates', () => {
  const owners = new Map<string, ArisTranslationOwner>([
    ['ObjDef.1', { kind: 'objectDefinition', id: 'ObjDef.1', modelId: '' }]
  ])
  const patch = (over: Partial<LocalizationPatch>): LocalizationPatch => ({
    source: 'aris',
    processId: 'document',
    elementId: 'ObjDef.1',
    field: 'name',
    property: '1025',
    value: 'يعتمد',
    reason: 'glossary',
    ...over
  })

  it('maps a metadata patch to an owner update keyed by its write locale', () => {
    expect(toArisTranslationUpdates([patch({})], owners)).toEqual([
      {
        owner: { kind: 'objectDefinition', id: 'ObjDef.1', modelId: '' },
        localeId: '1025',
        value: 'يعتمد'
      }
    ])
  })

  it('drops fallback-property projection patches', () => {
    expect(toArisTranslationUpdates([patch({ property: 'fallback' })], owners)).toEqual([])
  })

  it('drops patches with an unknown owner or an empty value', () => {
    expect(toArisTranslationUpdates([patch({ elementId: 'ObjDef.unknown' })], owners)).toEqual([])
    expect(toArisTranslationUpdates([patch({ value: '' })], owners)).toEqual([])
  })
})

describe('applyArisTranslations', () => {
  it('commits every update as ONE undoable gesture and restores them all with one undo', () => {
    harness = bootCanvas({ document: resolvableDocument(), modelId: 'Model.1' })
    const { canvas } = harness

    const { review, owners } = buildArisLocalizationReview({
      document: canvas.document,
      target: 'ar',
      active: 'en',
      resources: RESOURCES
    })
    const updates = toArisTranslationUpdates(review.localUpdates, owners)
    expect(updates.length).toBe(2)
    expect(updates.every((update) => update.value.trim() !== '')).toBe(true)

    expect(arNameOf(canvas.document, 'ObjDef.api')).toBeUndefined()
    expect(arNameOf(canvas.document, 'ObjDef.approve')).toBeUndefined()
    const commandsBefore = canvas.commandLog.length

    const applied = applyArisTranslations(canvas, updates, 'aris.localization.apply')
    expect(applied).toBe(2)
    expect(arNameOf(canvas.document, 'ObjDef.api')).toBe('API')
    expect(arNameOf(canvas.document, 'ObjDef.approve')).toBe('يعتمد')
    expect(canvas.canUndo).toBe(true)

    // ONE undo reverts the whole batch. The pre-existing snapshot of an absent
    // ar locale is the empty string, so undo restores it to blank (⇒ no name).
    canvas.undo()
    expect(arNameOf(canvas.document, 'ObjDef.api') ?? '').toBe('')
    expect(arNameOf(canvas.document, 'ObjDef.approve') ?? '').toBe('')
    expect(canvas.commandLog).toHaveLength(commandsBefore)
    expect(canvas.canRedo).toBe(true)
  })

  it('writes an entity-reference locale id under that exact key', () => {
    harness = bootCanvas({ document: resolvableDocument(), modelId: 'Model.1' })
    const { canvas } = harness
    const updates: ArisTranslationUpdate[] = [
      {
        owner: { kind: 'objectDefinition', id: 'ObjDef.approve', modelId: 'Model.1' },
        localeId: '&LocaleId.AEar;',
        value: 'يعتمد'
      }
    ]

    expect(applyArisTranslations(canvas, updates, 'aris.localization.apply')).toBe(1)
    expect(canvas.document.objectDefinitions.get('ObjDef.approve')?.names.values).toMatchObject({
      '&LocaleId.AEar;': 'يعتمد'
    })
  })

  it('is idempotent: re-reviewing after apply yields a complete review and empty queue', () => {
    harness = bootCanvas({ document: resolvableDocument(), modelId: 'Model.1' })
    const { canvas } = harness
    const first = buildArisLocalizationReview({
      document: canvas.document,
      target: 'ar',
      active: 'en',
      resources: RESOURCES
    })
    applyArisTranslations(
      canvas,
      toArisTranslationUpdates(first.review.localUpdates, first.owners),
      'aris.localization.apply'
    )

    const second = buildArisLocalizationReview({
      document: canvas.document,
      target: 'ar',
      active: 'en',
      resources: RESOURCES
    })
    expect(second.review.queue).toHaveLength(0)
    expect(second.review.complete).toBe(true)
    expect(toArisTranslationUpdates(second.review.localUpdates, second.owners)).toHaveLength(0)
  })

  it('applies nothing when the gesture is rejected (unknown owner)', () => {
    harness = bootCanvas({ document: resolvableDocument(), modelId: 'Model.1' })
    const { canvas } = harness
    const revisionBefore = canvas.document.revision
    const commandsBefore = canvas.commandLog.length

    const updates: ArisTranslationUpdate[] = [
      {
        owner: { kind: 'objectDefinition', id: 'ObjDef.api', modelId: '' },
        localeId: '1025',
        value: 'API'
      },
      {
        owner: { kind: 'objectDefinition', id: 'ObjDef.does-not-exist', modelId: '' },
        localeId: '1025',
        value: 'X'
      }
    ]

    expect(() => applyArisTranslations(canvas, updates, 'aris.localization.apply')).toThrow()
    expect(arNameOf(canvas.document, 'ObjDef.api')).toBeUndefined()
    expect(canvas.document.revision).toBe(revisionBefore)
    expect(canvas.commandLog).toHaveLength(commandsBefore)
  })

  it('applies nothing and returns 0 for an empty update list', () => {
    harness = bootCanvas({ document: resolvableDocument(), modelId: 'Model.1' })
    const { canvas } = harness
    const commandsBefore = canvas.commandLog.length
    expect(applyArisTranslations(canvas, [], 'aris.localization.apply')).toBe(0)
    expect(canvas.commandLog).toHaveLength(commandsBefore)
  })
})

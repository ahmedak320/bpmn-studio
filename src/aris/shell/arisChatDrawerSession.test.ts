import { describe, expect, it } from 'vitest'

import { buildCleanEepcDocument } from '../chat/testFixtures'
import type { ArisChatWorkingDocument } from '../chat/types'
import {
  createDefinitionCommand,
  createOccurrenceCommand,
  setLocalizedNameCommand
} from '../canvas/commandFactory'
import { createEmptyArisCanvasDocument } from '../canvas/emptyDocument'
import { applyCommand } from '../model/commands'
import type { ArisWorkingDocument } from '../model/types'
import { createArisChatApplyHost } from './arisChatHost'
import type { ArisTabChatHost } from './arisChatDrawerTypes'
import {
  beginDrawerInterview,
  confirmDrawerSelection,
  createDrawerInterviewHost,
  describeCommandTargets,
  drawerConfirmationPreview,
  submitDrawerAnswers
} from './arisChatDrawerSession'
import { ARIS_CHAT_REMOVE_ANSWER } from './arisChatProposal'

function asWorkingDocument(document: ArisChatWorkingDocument): ArisWorkingDocument {
  return document as unknown as ArisWorkingDocument
}

function buildRealEepcFixture(
  options: {
    missingEnglishDefinitionId?: string
  } = {}
): ArisWorkingDocument {
  const { document: empty, modelId } = createEmptyArisCanvasDocument({
    modelId: 'Model.1',
    modelName: 'Process',
    modelType: 'MT_EEPC'
  })

  const startDefId = 'ObjDef.START'
  const startOccId = 'ObjOcc.START'
  const funcDefId = 'ObjDef.FUNC'
  const funcOccId = 'ObjOcc.FUNC'
  const endDefId = 'ObjDef.END'
  const endOccId = 'ObjOcc.END'

  let document = empty

  // Start event: Arabic-only when we want a missingEnglishName gap, otherwise bilingual.
  document = applyCommand(
    document,
    createDefinitionCommand(
      { commandId: 'seed-start-def', baseRevision: document.revision, origin: 'user' },
      {
        definitionId: startDefId,
        objectType: 'OT_EVT',
        symbolNum: 'ST_EVT',
        name:
          options.missingEnglishDefinitionId === startDefId
            ? 'تم استلام الطلب'
            : 'Request received',
        localeId: options.missingEnglishDefinitionId === startDefId ? 'ar' : 'en-US'
      }
    )
  )
  document = applyCommand(
    document,
    createOccurrenceCommand(
      { commandId: 'seed-start-occ', baseRevision: document.revision, origin: 'user' },
      {
        occurrenceId: startOccId,
        definitionId: startDefId,
        modelId,
        symbolNum: 'ST_EVT',
        bounds: { x: 100, y: 100, width: 100, height: 80 }
      }
    )
  )

  // Function with process code and owner so it does not generate extra gaps.
  document = applyCommand(
    document,
    createDefinitionCommand(
      { commandId: 'seed-func-def', baseRevision: document.revision, origin: 'user' },
      {
        definitionId: funcDefId,
        objectType: 'OT_FUNC',
        symbolNum: 'ST_FUNC',
        name: 'Review request',
        localeId: 'en-US',
        attributes: [
          { type: 'AT_PROC_CODE', values: [{ localeId: 'en-US', text: 'P-001' }] },
          { type: 'AT_PERS_RESP', values: [{ localeId: 'en-US', text: 'Reviewer' }] }
        ]
      }
    )
  )
  document = applyCommand(
    document,
    createOccurrenceCommand(
      { commandId: 'seed-func-occ', baseRevision: document.revision, origin: 'user' },
      {
        occurrenceId: funcOccId,
        definitionId: funcDefId,
        modelId,
        symbolNum: 'ST_FUNC',
        bounds: { x: 100, y: 300, width: 100, height: 80 }
      }
    )
  )

  // End event.
  document = applyCommand(
    document,
    createDefinitionCommand(
      { commandId: 'seed-end-def', baseRevision: document.revision, origin: 'user' },
      {
        definitionId: endDefId,
        objectType: 'OT_EVT',
        symbolNum: 'ST_EVT',
        name: 'Request approved',
        localeId: 'en-US'
      }
    )
  )
  document = applyCommand(
    document,
    createOccurrenceCommand(
      { commandId: 'seed-end-occ', baseRevision: document.revision, origin: 'user' },
      {
        occurrenceId: endOccId,
        definitionId: endDefId,
        modelId,
        symbolNum: 'ST_EVT',
        bounds: { x: 100, y: 500, width: 100, height: 80 }
      }
    )
  )

  return document
}

function buildRealDocumentWithUnusedDefinition(): ArisWorkingDocument {
  const { document: empty, modelId } = createEmptyArisCanvasDocument({
    modelId: 'Model.1',
    modelName: 'Process',
    modelType: 'MT_EEPC'
  })

  // Add an Arabic model name so missingArabicName does not push unusedDefinition out of the
  // first three questions.
  let document = applyCommand(
    empty,
    setLocalizedNameCommand(
      { commandId: 'seed-model-ar', baseRevision: empty.revision, origin: 'user' },
      empty,
      'model',
      modelId,
      'ar',
      'عملية'
    )
  )

  document = applyCommand(
    document,
    createDefinitionCommand(
      { commandId: 'seed-unused-def', baseRevision: document.revision, origin: 'user' },
      {
        definitionId: 'ObjDef.UNUSED',
        objectType: 'OT_APPL_SYS',
        symbolNum: 'ST_APPL_SYS',
        name: 'Unused satellite',
        localeId: 'en-US'
      }
    )
  )

  document = applyCommand(
    document,
    setLocalizedNameCommand(
      { commandId: 'seed-unused-ar', baseRevision: document.revision, origin: 'user' },
      document,
      'objectDefinition',
      'ObjDef.UNUSED',
      'ar',
      'قمر صناعي غير مستخدم'
    )
  )

  return document
}

function createStubChatHost(
  document: ArisWorkingDocument,
  options: { rejectNext?: boolean } = {}
): ArisTabChatHost {
  let current = document
  let rejectNext = options.rejectNext ?? false
  const applyHost = createArisChatApplyHost({ origin: 'ai-auto' })
  return {
    getDocument: () => current,
    applyCommands: (commands, _label) => {
      if (rejectNext) {
        rejectNext = false
        return null
      }
      try {
        let next = current
        for (const command of commands) {
          next = applyHost.applyCommand(next, command)
        }
        current = next
        return current
      } catch {
        return null
      }
    },
    undo: () => {},
    getCanUndo: () => false
  }
}

describe('beginDrawerInterview', () => {
  it('yields at most three questions when gaps are present', () => {
    const document = buildRealEepcFixture({ missingEnglishDefinitionId: 'ObjDef.START' })
    const host = createDrawerInterviewHost()
    const { interview, events } = beginDrawerInterview(host, document)

    expect(interview.state?.status).toBe('awaitingAnswers')
    if (interview.state?.status !== 'awaitingAnswers') return
    expect(interview.state.questions.length).toBeLessThanOrEqual(3)
    expect(events).toHaveLength(0)
  })

  it('emits a clean status when the document has no gaps', () => {
    const document = asWorkingDocument(buildCleanEepcDocument())
    const host = createDrawerInterviewHost()
    const { interview, events } = beginDrawerInterview(host, document)

    expect(interview.state?.status).toBe('clean')
    expect(events).toEqual([{ kind: 'status', messageKey: 'aris.chatDrawer.interview.clean' }])
  })
})

describe('submitDrawerAnswers', () => {
  it('applies exactly one command for a missingEnglishName answer and returns the folded doc', () => {
    const document = buildRealEepcFixture({ missingEnglishDefinitionId: 'ObjDef.START' })
    const host = createDrawerInterviewHost()
    const target = createStubChatHost(document)
    const { interview: started } = beginDrawerInterview(host, document)

    expect(started.state?.status).toBe('awaitingAnswers')
    if (started.state?.status !== 'awaitingAnswers') return
    const question = started.state.questions.find(
      (candidate) => candidate.gapKind === 'missingEnglishName'
    )
    expect(question).toBeDefined()
    if (!question) return

    const result = submitDrawerAnswers(host, started, target, {
      [question.id]: 'Request received'
    })

    expect(result.events).toContainEqual({ kind: 'applied', count: 1 })
    expect(result.interview.appliedCount).toBe(1)
    expect(result.interview.provenance).toHaveLength(1)
    expect(result.interview.provenance[0]?.kind).toBe('setLocalizedName')

    const startDef = result.interview.state?.document.objectDefinitions.get('ObjDef.START')
    expect(startDef?.names.values['en-US']).toBe('Request received')
  })

  it('emits aris.chat.noProposal and leaves the document untouched for unmappable answers', () => {
    const document = buildRealEepcFixture({ missingEnglishDefinitionId: 'ObjDef.START' })
    const host = createDrawerInterviewHost()
    const target = createStubChatHost(document)
    const { interview: started } = beginDrawerInterview(host, document)

    expect(started.state?.status).toBe('awaitingAnswers')
    if (started.state?.status !== 'awaitingAnswers') return
    const question = started.state.questions.find(
      (candidate) => candidate.gapKind === 'missingEnglishName'
    )
    expect(question).toBeDefined()
    if (!question) return

    const result = submitDrawerAnswers(host, started, target, {
      [question.id]: '   '
    })

    expect(result.events).toEqual([{ kind: 'status', messageKey: 'aris.chat.noProposal' }])
    expect(result.interview.state?.status).toBe('awaitingProposal')
    expect(result.interview.state?.document).toBe(document)
  })

  it('restarts from the live document and emits aris.chat.commitFailed when applyCommands returns null', () => {
    const document = buildRealEepcFixture({ missingEnglishDefinitionId: 'ObjDef.START' })
    const host = createDrawerInterviewHost()
    const target = createStubChatHost(document, { rejectNext: true })
    const { interview: started } = beginDrawerInterview(host, document)

    expect(started.state?.status).toBe('awaitingAnswers')
    if (started.state?.status !== 'awaitingAnswers') return
    const question = started.state.questions.find(
      (candidate) => candidate.gapKind === 'missingEnglishName'
    )
    expect(question).toBeDefined()
    if (!question) return

    const result = submitDrawerAnswers(host, started, target, {
      [question.id]: 'Request received'
    })

    expect(result.events).toEqual([{ kind: 'status', messageKey: 'aris.chat.commitFailed' }])
    expect(result.interview.appliedCount).toBe(0)
    expect(result.interview.provenance).toHaveLength(0)
    expect(result.interview.state?.document).toBe(document)
  })
})

describe('confirm-classified commands', () => {
  it('never reach applyCommands before confirmDrawerSelection', () => {
    const document = buildRealDocumentWithUnusedDefinition()
    const host = createDrawerInterviewHost()
    const appliedCommandIds: string[] = []
    const target: ArisTabChatHost = {
      getDocument: () => document,
      applyCommands: (commands, _label) => {
        appliedCommandIds.push(...commands.map((command) => command.commandId))
        const applyHost = createArisChatApplyHost({ origin: 'ai-auto' })
        let next = document
        for (const command of commands) {
          next = applyHost.applyCommand(next, command)
        }
        return next
      },
      undo: () => {},
      getCanUndo: () => false
    }

    const { interview: started } = beginDrawerInterview(host, document)
    expect(started.state?.status).toBe('awaitingAnswers')
    if (started.state?.status !== 'awaitingAnswers') return
    const question = started.state.questions.find(
      (candidate) => candidate.gapKind === 'unusedDefinition'
    )
    expect(question).toBeDefined()
    if (!question) return

    const afterSubmit = submitDrawerAnswers(host, started, target, {
      [question.id]: ARIS_CHAT_REMOVE_ANSWER
    })

    expect(afterSubmit.events).toHaveLength(0)
    expect(afterSubmit.interview.state?.status).toBe('awaitingConfirmation')
    if (afterSubmit.interview.state?.status !== 'awaitingConfirmation') return
    expect(appliedCommandIds).toHaveLength(0)

    const pendingCommandId = afterSubmit.interview.state.pendingConfirmCommands[0]?.commandId
    expect(pendingCommandId).toBeDefined()
    if (!pendingCommandId) return

    const preview = drawerConfirmationPreview(host, afterSubmit.interview, describeCommandTargets)
    expect(preview).not.toBeNull()
    expect(preview?.before).toEqual(
      expect.arrayContaining([expect.stringContaining('ObjDef.UNUSED')])
    )

    const afterConfirm = confirmDrawerSelection(
      host,
      afterSubmit.interview,
      target,
      new Set([pendingCommandId])
    )

    expect(afterConfirm.events).toContainEqual({ kind: 'applied', count: 1 })
    expect(appliedCommandIds).toEqual([pendingCommandId])
    expect(afterConfirm.interview.state?.document.objectDefinitions.has('ObjDef.UNUSED')).toBe(
      false
    )
  })

  it('emits aris.chat.nothingSelected for an empty selection', () => {
    const document = buildRealDocumentWithUnusedDefinition()
    const host = createDrawerInterviewHost()
    const target = createStubChatHost(document)
    const { interview: started } = beginDrawerInterview(host, document)
    expect(started.state?.status).toBe('awaitingAnswers')
    if (started.state?.status !== 'awaitingAnswers') return
    const question = started.state.questions.find(
      (candidate) => candidate.gapKind === 'unusedDefinition'
    )
    expect(question).toBeDefined()
    if (!question) return

    const afterSubmit = submitDrawerAnswers(host, started, target, {
      [question.id]: ARIS_CHAT_REMOVE_ANSWER
    })

    const afterConfirm = confirmDrawerSelection(host, afterSubmit.interview, target, new Set())

    expect(afterConfirm.events).toEqual([
      { kind: 'status', messageKey: 'aris.chat.nothingSelected' }
    ])
    expect(afterConfirm.interview.state?.document.objectDefinitions.has('ObjDef.UNUSED')).toBe(true)
  })
})

describe('terminal statuses', () => {
  it('surface terminal states and reject further advancement', () => {
    const document = asWorkingDocument(buildCleanEepcDocument())
    const host = createDrawerInterviewHost()
    const target = createStubChatHost(document)
    const { interview: started } = beginDrawerInterview(host, document)

    expect(started.state?.status).toBe('clean')
    // A clean state is terminal; submitting answers should be a no-op.
    const result = submitDrawerAnswers(host, started, target, {})
    expect(result.events).toHaveLength(0)
    expect(result.interview.state?.status).toBe('clean')
  })
})

describe('describeCommandTargets', () => {
  it('describes models, object definitions, connection definitions, and unknown ids', () => {
    const document = asWorkingDocument(buildCleanEepcDocument())
    const descriptions = describeCommandTargets(document, ['M1', 'OD_START', 'CD1', 'UNKNOWN'])
    expect(descriptions).toHaveLength(4)
    expect(descriptions[0]).toContain('M1')
    expect(descriptions[1]).toContain('OD_START')
    expect(descriptions[2]).toContain('CD1')
    expect(descriptions[3]).toBe('UNKNOWN')
  })
})

import { describe, expect, it } from 'vitest'
import {
  MAX_ROUNDS_PER_INTERVIEW,
  advanceArisChatInterview,
  startArisChatInterview,
  type ArisChatInterviewHost
} from './interviewLoop'
import { buildCleanEepcDocument, createTestApplyHost } from './testFixtures'
import type { ArisChatGap } from './gapScanner'
import type { ArisChatWorkingDocument } from './types'

const FIXED_GAPS: readonly ArisChatGap[] = Object.freeze([
  {
    kind: 'missingOwner',
    severity: 'error',
    targetIds: ['X'],
    messageKey: 'aris.chat.gap.missingOwner'
  }
])

/** A host whose gap list never resolves, so round-limit behavior is exercised deterministically. */
function buildNeverCleanHost(): ArisChatInterviewHost<ArisChatWorkingDocument> {
  const applyHost = createTestApplyHost()
  return { ...applyHost, scanGaps: () => FIXED_GAPS, verifyProposalTargets: () => 'ok' }
}

function noopProposal(round: number, baseRevision: number) {
  return {
    version: 1,
    baseRevision,
    commands: [
      {
        commandId: `noop-${round}`,
        kind: 'setLocalizedName',
        targetIds: ['OD_START'],
        payload: {
          ownerKind: 'objectDefinition',
          ownerId: 'OD_START',
          localeId: 'en',
          value: `Request received v${round}`
        }
      }
    ]
  }
}

describe('interview round limit (plan 18.2 step 13 / MAX_ROUNDS_PER_INTERVIEW)', () => {
  it('stops at roundLimitReached after 5 rounds when gaps never resolve, never starting a 6th round', () => {
    const document = buildCleanEepcDocument()
    const host = buildNeverCleanHost()

    let state = startArisChatInterview(document, host)
    expect(state.status).toBe('awaitingAnswers')
    expect(state.round).toBe(1)

    for (let round = 1; round <= MAX_ROUNDS_PER_INTERVIEW; round += 1) {
      expect(state.status).toBe('awaitingAnswers')
      state = advanceArisChatInterview(
        state,
        { type: 'answersSubmitted', answers: { [`q${round}`]: 'answer' } },
        host
      )
      expect(state.status).toBe('awaitingProposal')

      state = advanceArisChatInterview(
        state,
        { type: 'proposalReceived', raw: noopProposal(round, state.document.revision) },
        host
      )

      if (round < MAX_ROUNDS_PER_INTERVIEW) {
        expect(state.status).toBe('awaitingAnswers')
        expect(state.round).toBe(round + 1)
      }
    }

    expect(state.status).toBe('roundLimitReached')
    expect(state.round).toBe(MAX_ROUNDS_PER_INTERVIEW)
    // Preserved for the whole session, across all 5 rounds.
    expect(Object.keys(state.answers)).toHaveLength(5)
  })

  it('stops at clean as soon as scanGaps reports no gaps, without waiting for the round limit', () => {
    const document = buildCleanEepcDocument()
    const applyHost = createTestApplyHost()
    let resolved = false
    const host: ArisChatInterviewHost<ArisChatWorkingDocument> = {
      ...applyHost,
      scanGaps: () => (resolved ? [] : FIXED_GAPS),
      verifyProposalTargets: () => 'ok'
    }

    let state = startArisChatInterview(document, host)
    expect(state.status).toBe('awaitingAnswers')
    state = advanceArisChatInterview(state, { type: 'answersSubmitted', answers: {} }, host)
    resolved = true
    state = advanceArisChatInterview(
      state,
      { type: 'proposalReceived', raw: noopProposal(1, state.document.revision) },
      host
    )

    expect(state.status).toBe('clean')
    expect(state.round).toBe(1)
  })
})

describe('target removed mid-session aborts cleanly (plan 18.2 step 13)', () => {
  it('transitions to aborted/targetRemoved without applying any command', () => {
    const document = buildCleanEepcDocument()
    const applyHost = createTestApplyHost()
    const host: ArisChatInterviewHost<ArisChatWorkingDocument> = {
      ...applyHost,
      scanGaps: () => FIXED_GAPS,
      verifyProposalTargets: () => 'target-removed'
    }

    let state = startArisChatInterview(document, host)
    state = advanceArisChatInterview(state, { type: 'answersSubmitted', answers: {} }, host)
    state = advanceArisChatInterview(
      state,
      { type: 'proposalReceived', raw: noopProposal(1, state.document.revision) },
      host
    )

    expect(state.status).toBe('aborted')
    if (state.status !== 'aborted') return
    expect(state.reason).toBe('targetRemoved')
    expect(state.document).toBe(document)
  })
})

describe('cancellation mid-round leaves no partial changes (plan 18.2)', () => {
  it('canceling while a confirm batch is pending never applies that batch', () => {
    const document = buildCleanEepcDocument()
    const appliedCommandIds: string[] = []
    const applyHost = createTestApplyHost({
      beforeApply: (_doc, command) => {
        appliedCommandIds.push(command.commandId)
      }
    })
    const host: ArisChatInterviewHost<ArisChatWorkingDocument> = {
      ...applyHost,
      scanGaps: () => FIXED_GAPS,
      verifyProposalTargets: () => 'ok'
    }

    let state = startArisChatInterview(document, host)
    state = advanceArisChatInterview(state, { type: 'answersSubmitted', answers: {} }, host)

    const proposal = {
      version: 1,
      baseRevision: state.document.revision,
      commands: [
        {
          commandId: 'auto-1',
          kind: 'setLocalizedName',
          targetIds: ['OD_START'],
          payload: {
            ownerKind: 'objectDefinition',
            ownerId: 'OD_START',
            localeId: 'en',
            value: 'Updated'
          }
        },
        {
          commandId: 'confirm-1',
          kind: 'deleteOccurrence',
          targetIds: ['OC_END_A'],
          payload: { occurrenceId: 'OC_END_A' }
        }
      ]
    }
    state = advanceArisChatInterview(state, { type: 'proposalReceived', raw: proposal }, host)

    expect(state.status).toBe('awaitingConfirmation')
    if (state.status !== 'awaitingConfirmation') return
    expect(state.pendingConfirmCommands.map((c) => c.commandId)).toEqual(['confirm-1'])
    // The automatic half of the round has already committed.
    expect(appliedCommandIds).toEqual(['auto-1'])
    const documentBeforeCancel = state.document

    state = advanceArisChatInterview(state, { type: 'cancel' }, host)

    expect(state.status).toBe('canceled')
    // The pending confirm command was never handed to the host.
    expect(appliedCommandIds).toEqual(['auto-1'])
    // The document is exactly what it was the instant before cancel — no partial confirm effect.
    expect(state.document).toBe(documentBeforeCancel)
    expect(state.document.models.get('M1')?.occurrences.some((o) => o.id === 'OC_END_A')).toBe(true)
  })

  it('cancel is valid from awaitingAnswers too, and preserves already-applied prior-round changes', () => {
    const document = buildCleanEepcDocument()
    const host = buildNeverCleanHost()
    let state = startArisChatInterview(document, host)
    state = advanceArisChatInterview(state, { type: 'cancel' }, host)
    expect(state.status).toBe('canceled')
    expect(state.document).toBe(document)
  })
})

describe('invalid AI patches make no changes (exit gate item 4, at the interview level)', () => {
  it('a structurally invalid proposal keeps the document untouched and stays in awaitingProposal', () => {
    const document = buildCleanEepcDocument()
    const host = buildNeverCleanHost()
    let state = startArisChatInterview(document, host)
    state = advanceArisChatInterview(state, { type: 'answersSubmitted', answers: {} }, host)
    const before = state.document

    state = advanceArisChatInterview(
      state,
      {
        type: 'proposalReceived',
        raw: { version: 1, baseRevision: 0, commands: [{ kind: 'notARealCommand' }] }
      },
      host
    )

    expect(state.status).toBe('awaitingProposal')
    if (state.status !== 'awaitingProposal') return
    expect(state.lastError).toBeDefined()
    expect(state.document).toBe(before)
  })

  it('a proposal whose command payload fails to apply rolls back and reports the error', () => {
    const document = buildCleanEepcDocument()
    const host = buildNeverCleanHost()
    let state = startArisChatInterview(document, host)
    state = advanceArisChatInterview(state, { type: 'answersSubmitted', answers: {} }, host)
    const before = state.document

    const proposal = {
      version: 1,
      baseRevision: state.document.revision,
      commands: [
        {
          commandId: 'bad-1',
          kind: 'setLocalizedName',
          targetIds: ['NOPE'],
          payload: { ownerKind: 'objectDefinition', ownerId: 'NOPE', localeId: 'en', value: 'x' }
        }
      ]
    }
    state = advanceArisChatInterview(state, { type: 'proposalReceived', raw: proposal }, host)

    expect(state.status).toBe('awaitingProposal')
    if (state.status !== 'awaitingProposal') return
    expect(state.lastError).toContain('command-application-failed')
    expect(state.document).toBe(before)
  })
})

describe('finish', () => {
  it('is valid from any non-terminal state and stops the loop without discarding already-applied changes', () => {
    const document = buildCleanEepcDocument()
    const host = buildNeverCleanHost()
    let state = startArisChatInterview(document, host)
    state = advanceArisChatInterview(state, { type: 'finish' }, host)
    expect(state.status).toBe('finished')
    expect(state.document).toBe(document)
  })
})

describe('terminal states reject further events', () => {
  it('throws if advanced again after reaching a terminal status', () => {
    const document = buildCleanEepcDocument()
    const host = buildNeverCleanHost()
    let state = startArisChatInterview(document, host)
    state = advanceArisChatInterview(state, { type: 'cancel' }, host)
    expect(() => advanceArisChatInterview(state, { type: 'cancel' }, host)).toThrow()
  })
})

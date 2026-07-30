// @vitest-environment jsdom
//
// Lane L5d — deterministic fix planner + fix dialog.
//
// Covers, per the lane brief:
//  - the CLASSIFICATION INVARIANT: Tier-A fills map to an automatic command kind; every Tier-B
//    command kind is topology- or destructive-classified (imported from `classification.ts`, so
//    the tier policy can never drift silently);
//  - idempotence of the start/end proposal (apply -> rescan -> gap gone, second plan is empty);
//  - delete-proposal resolution of `unusedDefinition` and dangling gaps;
//  - translation-fill partition correctness (counterpart present vs absent);
//  - patch-schema validation of every proposed command;
//  - a jsdom dialog test (sections render, apply is a single gesture, zero network).

import { createElement } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AUTOMATIC_COMMAND_KINDS,
  DESTRUCTIVE_COMMAND_KINDS,
  TOPOLOGY_COMMAND_KINDS
} from './classification'
import { applySelectedConfirmedCommands, type ArisChatApplyOutcome } from './applyEngine'
import {
  ARIS_FIX_TRANSLATION_FILL_COMMAND_KIND,
  buildDeterministicFixPlan,
  type ArisDeterministicFixPlan
} from './deterministicFixes'
import { scanArisChatGaps } from './gapScanner'
import { parseArisChatCommand, type ArisChatCommand } from './patchSchema'
import {
  attribute,
  buildCleanEepcDocument,
  buildDocument,
  createTestApplyHost,
  names
} from './testFixtures'
import type {
  ArisChatModel,
  ArisChatObjectDefinition,
  ArisChatObjectOccurrence,
  ArisChatWorkingDocument
} from './types'
import { ArisFixMissingDialog, type ArisFixMissingDialogProps } from '../shell/ArisFixMissingDialog'

const LOCALES = { en: 'en', ar: 'ar' } as const

function planFor(document: ArisChatWorkingDocument): ArisDeterministicFixPlan {
  return buildDeterministicFixPlan(document, scanArisChatGaps(document), LOCALES)
}

function requireOk<T>(outcome: ArisChatApplyOutcome<T>): T {
  if (!outcome.ok) throw new Error(`expected apply to succeed, got ${outcome.reason}`)
  return outcome.document
}

function applyProposals(
  document: ArisChatWorkingDocument,
  plan: ArisDeterministicFixPlan
): ArisChatWorkingDocument {
  const commands = plan.confirmProposals.flatMap((proposal) => proposal.commands)
  const host = createTestApplyHost()
  const result = applySelectedConfirmedCommands(
    document,
    document.revision,
    commands,
    new Set(commands.map((command) => command.commandId)),
    host
  )
  return requireOk(result.outcome)
}

/** A model with one owned/coded function, an IO relation, and NO events (missing start + end). */
function eventlessFixture(): ArisChatWorkingDocument {
  const modelId = 'M1'
  const objectDefinitions: ArisChatObjectDefinition[] = [
    {
      id: 'OD_FUNC',
      type: 'OT_FUNC',
      names: names('Review', 'مراجعة'),
      attributes: [attribute('AT_PROC_CODE', 'P1'), attribute('AT_PERS_RESP', 'R')],
      linkedModelIds: []
    },
    {
      id: 'OD_SYS',
      type: 'OT_APPL_SYS',
      names: names('System', 'نظام'),
      attributes: [],
      linkedModelIds: []
    }
  ]
  const occurrences: ArisChatObjectOccurrence[] = [
    { id: 'OC_FUNC', definitionId: 'OD_FUNC', modelId, symbol: 'ST_FUNC' },
    { id: 'OC_SYS', definitionId: 'OD_SYS', modelId, symbol: 'ST_APPL_SYS' }
  ]
  const model: ArisChatModel = {
    id: modelId,
    names: names('Flow', 'تدفق'),
    occurrences,
    connectionOccurrences: [
      {
        id: 'C_IO',
        definitionId: 'CD_IO',
        modelId,
        sourceOccurrenceId: 'OC_SYS',
        targetOccurrenceId: 'OC_FUNC'
      }
    ]
  }
  return buildDocument({
    models: [model],
    objectDefinitions,
    connectionDefinitions: [
      {
        id: 'CD_IO',
        type: 'CT_SUPP_3',
        fromObjectDefinitionId: 'OD_SYS',
        toObjectDefinitionId: 'OD_FUNC',
        names: names(null),
        attributes: []
      }
    ]
  })
}

function withExtraDefinition(
  document: ArisChatWorkingDocument,
  definition: ArisChatObjectDefinition
): ArisChatWorkingDocument {
  const objectDefinitions = new Map(document.objectDefinitions)
  objectDefinitions.set(definition.id, definition)
  return Object.freeze({ ...document, objectDefinitions: Object.freeze(objectDefinitions) })
}

function withDanglingConnection(document: ArisChatWorkingDocument): ArisChatWorkingDocument {
  const model = document.models.get('M1')!
  const nextModel: ArisChatModel = {
    ...model,
    connectionOccurrences: [
      ...model.connectionOccurrences,
      {
        id: 'C_DANGLING',
        definitionId: 'CD_MISSING',
        modelId: 'M1',
        sourceOccurrenceId: 'OC_FUNC',
        targetOccurrenceId: 'OC_FUNC'
      }
    ]
  }
  const models = new Map(document.models)
  models.set('M1', nextModel)
  return Object.freeze({ ...document, models: Object.freeze(models) })
}

describe('buildDeterministicFixPlan — classification invariant', () => {
  it('every Tier-A translation fill maps to an automatic command kind', () => {
    expect(AUTOMATIC_COMMAND_KINDS.has(ARIS_FIX_TRANSLATION_FILL_COMMAND_KIND)).toBe(true)
  })

  it('every Tier-B command kind is topology- or destructive-classified, never automatic', () => {
    const allowed = new Set<ArisChatCommand['kind']>([
      ...TOPOLOGY_COMMAND_KINDS,
      ...DESTRUCTIVE_COMMAND_KINDS
    ])
    // A document exercising both structural (start/end) and destructive (delete) proposals.
    const withUnused = withExtraDefinition(eventlessFixture(), {
      id: 'OD_UNUSED',
      type: 'OT_ENT_TYPE',
      names: names('Orphan', 'يتيم'),
      attributes: [],
      linkedModelIds: []
    })
    const plan = planFor(withDanglingConnection(withUnused))
    const kinds = plan.confirmProposals.flatMap((proposal) =>
      proposal.commands.map((command) => command.kind)
    )
    expect(kinds.length).toBeGreaterThan(0)
    for (const kind of kinds) {
      expect(allowed.has(kind)).toBe(true)
      expect(AUTOMATIC_COMMAND_KINDS.has(kind)).toBe(false)
    }
  })
})

describe('buildDeterministicFixPlan — start/end event proposal', () => {
  it('proposes a Tier-B fix for both missing start and missing end', () => {
    const document = eventlessFixture()
    const gaps = scanArisChatGaps(document)
    expect(gaps.filter((gap) => gap.kind === 'missingStartOrEndEvent')).toHaveLength(2)

    const plan = planFor(document)
    expect(plan.confirmProposals).toHaveLength(2)
    for (const proposal of plan.confirmProposals) {
      expect(proposal.commands[0]?.kind).toBe('addCoreObject')
      expect(proposal.commands[1]?.kind).toBe('addCoreConnection')
    }
  })

  it('is idempotent: apply -> rescan removes the gap and a second plan proposes nothing', () => {
    const document = eventlessFixture()
    const plan = planFor(document)
    const next = applyProposals(document, plan)

    const rescan = scanArisChatGaps(next)
    expect(rescan.some((gap) => gap.kind === 'missingStartOrEndEvent')).toBe(false)
    expect(rescan).toHaveLength(0)

    const secondPlan = planFor(next)
    expect(secondPlan.confirmProposals).toHaveLength(0)
  })
})

describe('buildDeterministicFixPlan — delete proposals resolve their gaps', () => {
  it('deletes an unused object definition', () => {
    const document = withExtraDefinition(buildCleanEepcDocument(), {
      id: 'OD_UNUSED',
      type: 'OT_ENT_TYPE',
      names: names('Unused', 'غير مستخدم'),
      attributes: [],
      linkedModelIds: []
    })
    expect(
      scanArisChatGaps(document).some(
        (gap) => gap.kind === 'unusedDefinition' && gap.targetIds.includes('OD_UNUSED')
      )
    ).toBe(true)

    const plan = planFor(document)
    expect(plan.confirmProposals.some((p) => p.commands[0]?.kind === 'deleteDefinition')).toBe(true)

    const next = applyProposals(document, plan)
    expect(scanArisChatGaps(next).some((gap) => gap.kind === 'unusedDefinition')).toBe(false)
  })

  it('deletes a dangling connection occurrence', () => {
    const document = withDanglingConnection(buildCleanEepcDocument())
    expect(
      scanArisChatGaps(document).some((gap) => gap.kind === 'danglingObjectOrConnection')
    ).toBe(true)

    const plan = planFor(document)
    const deleteProposal = plan.confirmProposals.find(
      (p) => p.commands[0]?.kind === 'deleteConnection'
    )
    expect(deleteProposal).toBeDefined()

    const next = applyProposals(document, plan)
    expect(scanArisChatGaps(next).some((gap) => gap.kind === 'danglingObjectOrConnection')).toBe(
      false
    )
  })
})

describe('buildDeterministicFixPlan — translation-fill partition', () => {
  it('routes a name gap to Tier A when the counterpart language exists, else Tier C', () => {
    const document = buildDocument({
      objectDefinitions: [
        {
          id: 'D1',
          type: 'OT_ENT_TYPE',
          names: names(null, 'اسم'),
          attributes: [],
          linkedModelIds: []
        },
        {
          id: 'D2',
          type: 'OT_ENT_TYPE',
          names: names('Name', null),
          attributes: [],
          linkedModelIds: []
        },
        {
          id: 'D3',
          type: 'OT_ENT_TYPE',
          names: names(null, null),
          attributes: [],
          linkedModelIds: []
        }
      ]
    })
    const plan = planFor(document)

    const fillTargetIds = new Set(plan.translationFillTargets.flatMap((gap) => gap.targetIds))
    expect(fillTargetIds.has('D1')).toBe(true) // missing English, Arabic present
    expect(fillTargetIds.has('D2')).toBe(true) // missing Arabic, English present
    expect(fillTargetIds.has('D3')).toBe(false) // neither language present

    const interviewNameGaps = plan.interviewGaps.filter(
      (gap) => gap.kind === 'missingEnglishName' || gap.kind === 'missingArabicName'
    )
    expect(interviewNameGaps.every((gap) => gap.targetIds.includes('D3'))).toBe(true)
    expect(interviewNameGaps.length).toBeGreaterThanOrEqual(2)

    // Tier A fills only ever cover name gaps.
    for (const gap of plan.translationFillTargets) {
      expect(['missingEnglishName', 'missingArabicName']).toContain(gap.kind)
    }
  })
})

describe('buildDeterministicFixPlan — every proposal is schema-valid', () => {
  it('parses every proposed command through the strict patch schema', () => {
    const document = withDanglingConnection(
      withExtraDefinition(eventlessFixture(), {
        id: 'OD_UNUSED',
        type: 'OT_ENT_TYPE',
        names: names('Orphan', 'يتيم'),
        attributes: [],
        linkedModelIds: []
      })
    )
    const plan = planFor(document)
    const commands = plan.confirmProposals.flatMap((proposal) => proposal.commands)
    expect(commands.length).toBeGreaterThan(0)
    for (const command of commands) {
      expect(() => parseArisChatCommand(command)).not.toThrow()
    }
  })
})

/**
 * An orphan object occurrence with a RESOLVABLE definition plus one attached connection whose
 * connection definition it is the last user of — the full-cluster cascade case (an epc-derived
 * `orphanNode` finding, not the local missing-definition case).
 */
function orphanClusterFixture(): ArisChatWorkingDocument {
  const modelId = 'M1'
  return buildDocument({
    models: [
      {
        id: modelId,
        names: names('Flow', 'تدفق'),
        occurrences: [
          { id: 'OC_ORPHAN', definitionId: 'OD_ORPHAN', modelId, symbol: 'ST_FUNC' },
          { id: 'OC_KEEP', definitionId: 'OD_KEEP', modelId, symbol: 'ST_FUNC' }
        ],
        connectionOccurrences: [
          {
            id: 'C_ATTACHED',
            definitionId: 'CD_ATTACHED',
            modelId,
            sourceOccurrenceId: 'OC_ORPHAN',
            targetOccurrenceId: 'OC_KEEP'
          }
        ]
      }
    ],
    objectDefinitions: [
      {
        id: 'OD_ORPHAN',
        type: 'OT_FUNC',
        names: names('Orphan', 'يتيم'),
        attributes: [],
        linkedModelIds: []
      },
      {
        id: 'OD_KEEP',
        type: 'OT_FUNC',
        names: names('Keep', 'ابقاء'),
        attributes: [],
        linkedModelIds: []
      }
    ],
    connectionDefinitions: [
      {
        id: 'CD_ATTACHED',
        type: 'CT_ACTIV_1',
        fromObjectDefinitionId: 'OD_ORPHAN',
        toObjectDefinitionId: 'OD_KEEP',
        names: names(null),
        attributes: []
      }
    ]
  })
}

const ORPHAN_GAP = {
  kind: 'danglingObjectOrConnection',
  severity: 'error',
  targetIds: ['OC_ORPHAN'],
  messageKey: 'aris.epc.finding.orphanNode'
} as const

describe('buildDeterministicFixPlan — dangling orphan cluster cascade', () => {
  it('emits a full cluster (connection + occurrence + connection definition + object definition), all schema-valid', () => {
    const document = orphanClusterFixture()
    const plan = buildDeterministicFixPlan(document, [ORPHAN_GAP], LOCALES)
    expect(plan.confirmProposals).toHaveLength(1)
    const commands = plan.confirmProposals[0]!.commands
    // Order is load-bearing: connections first, then the occurrence, then the definitions left
    // with zero occurrences — a bare deleteOccurrence would strand a dangling connection endpoint.
    expect(commands.map((command) => command.kind)).toEqual([
      'deleteConnection',
      'deleteOccurrence',
      'deleteConnectionDefinition',
      'deleteDefinition'
    ])
    for (const command of commands) {
      expect(() => parseArisChatCommand(command)).not.toThrow()
    }
  })

  it('applies cleanly and is idempotent (a second pass over the crafted gap proposes nothing)', () => {
    const document = orphanClusterFixture()
    const plan = buildDeterministicFixPlan(document, [ORPHAN_GAP], LOCALES)
    const next = applyProposals(document, plan)

    const model = next.models.get('M1')!
    expect(model.occurrences.some((occurrence) => occurrence.id === 'OC_ORPHAN')).toBe(false)
    expect(model.connectionOccurrences.some((connection) => connection.id === 'C_ATTACHED')).toBe(
      false
    )
    expect(next.connectionDefinitions.has('CD_ATTACHED')).toBe(false)
    expect(next.objectDefinitions.has('OD_ORPHAN')).toBe(false)
    // The neighbour the orphan pointed at, and its definition, survive.
    expect(model.occurrences.some((occurrence) => occurrence.id === 'OC_KEEP')).toBe(true)
    expect(next.objectDefinitions.has('OD_KEEP')).toBe(true)

    const secondPlan = buildDeterministicFixPlan(next, [ORPHAN_GAP], LOCALES)
    expect(secondPlan.confirmProposals).toHaveLength(0)
  })

  it('de-dupes a connection shared by two orphan targets in one gap', () => {
    const document = orphanClusterFixture()
    // Both endpoints of C_ATTACHED are orphaned in the same finding: the connection must be
    // deleted exactly once, and both object definitions must be dropped.
    const plan = buildDeterministicFixPlan(
      document,
      [
        {
          kind: 'danglingObjectOrConnection',
          severity: 'error',
          targetIds: ['OC_ORPHAN', 'OC_KEEP'],
          messageKey: 'aris.epc.finding.orphanNode'
        }
      ],
      LOCALES
    )
    const commands = plan.confirmProposals[0]!.commands
    const connectionDeletes = commands.filter((command) => command.kind === 'deleteConnection')
    expect(connectionDeletes).toHaveLength(1)
    expect(
      commands.filter((command) => command.kind === 'deleteConnectionDefinition')
    ).toHaveLength(1)
    expect(commands.filter((command) => command.kind === 'deleteDefinition')).toHaveLength(2)
    // Every command id is unique within the proposal, so the dialog's id de-dupe is a no-op here.
    const ids = commands.map((command) => command.commandId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// --- jsdom dialog test ------------------------------------------------------------------------

function threeTierDocument(): ArisChatWorkingDocument {
  const modelId = 'M1'
  return buildDocument({
    models: [
      {
        id: modelId,
        names: names('Flow', 'تدفق'),
        occurrences: [{ id: 'OC_FUNC', definitionId: 'OD_FUNC', modelId, symbol: 'ST_FUNC' }],
        connectionOccurrences: []
      }
    ],
    objectDefinitions: [
      {
        id: 'OD_FUNC',
        type: 'OT_FUNC',
        names: names('Do', 'قم'),
        attributes: [],
        linkedModelIds: []
      },
      {
        id: 'OD_NAME',
        type: 'OT_ENT_TYPE',
        names: names(null, 'اسم'),
        attributes: [],
        linkedModelIds: []
      }
    ]
  })
}

function renderDialog(overrides: Partial<ArisFixMissingDialogProps> = {}) {
  const document = overrides.document ?? threeTierDocument()
  const plan = overrides.plan ?? planFor(document)
  const props: ArisFixMissingDialogProps = {
    open: true,
    document,
    plan,
    busy: false,
    onAutoFix: vi.fn(),
    onApplySelected: vi.fn(),
    onOpenInterview: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  }
  return { props, ...render(createElement(ArisFixMissingDialog, props)) }
}

describe('ArisFixMissingDialog', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders all three tier sections with their counts from the plan', () => {
    const document = threeTierDocument()
    const plan = planFor(document)
    expect(plan.translationFillTargets.length).toBeGreaterThan(0)
    expect(plan.confirmProposals.length).toBeGreaterThan(0)
    expect(plan.interviewGaps.length).toBeGreaterThan(0)

    const { container } = renderDialog({ document, plan })
    const auto = container.querySelector('[data-orbitpm-aris-fix-auto]')
    const interview = container.querySelector('[data-orbitpm-aris-fix-interview]')
    expect(auto?.getAttribute('data-orbitpm-aris-fix-auto')).toBe(
      String(plan.translationFillTargets.length)
    )
    expect(interview?.getAttribute('data-orbitpm-aris-fix-interview')).toBe(
      String(plan.interviewGaps.length)
    )
    expect(container.querySelectorAll('[data-orbitpm-aris-fix-confirm]')).toHaveLength(
      plan.confirmProposals.length
    )
  })

  it('applies every selected proposal as a SINGLE gesture, with zero network', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const document = threeTierDocument()
    const plan = planFor(document)
    const expectedCommandCount = plan.confirmProposals.reduce(
      (total, proposal) => total + proposal.commands.length,
      0
    )
    const onApplySelected = vi.fn()

    const { container } = renderDialog({ document, plan, onApplySelected })
    const applyButton = container.querySelector('[data-orbitpm-aris-fix-apply]')
    expect(applyButton).not.toBeNull()
    fireEvent.click(applyButton!)

    expect(onApplySelected).toHaveBeenCalledTimes(1)
    expect(onApplySelected.mock.calls[0]![0]).toHaveLength(expectedCommandCount)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('wires the Tier-A auto-fix and Tier-C interview buttons', () => {
    const onAutoFix = vi.fn()
    const onOpenInterview = vi.fn()
    const { container } = renderDialog({ onAutoFix, onOpenInterview })

    fireEvent.click(container.querySelector('[data-orbitpm-aris-fix-auto]')!)
    fireEvent.click(container.querySelector('[data-orbitpm-aris-fix-interview]')!)

    expect(onAutoFix).toHaveBeenCalledTimes(1)
    expect(onOpenInterview).toHaveBeenCalledTimes(1)
  })
})

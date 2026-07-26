import { describe, expect, it } from 'vitest'
import {
  canApplyXml,
  canCommitImport,
  canCreateGenerated,
  canSaveNormally,
  createValidationSummary,
  evaluateValidationPolicy,
  validationIssue
} from '..'

describe('blocking save/apply policy', () => {
  const semanticError = createValidationSummary([
    validationIssue({
      code: 'semantic.disconnected-node',
      severity: 'error',
      source: 'semantic',
      message: 'Disconnected'
    })
  ])

  it('allows well-formed semantic errors into the editor but not normal/generated/import saves', () => {
    expect(canApplyXml(semanticError)).toBe(true)
    expect(canSaveNormally(semanticError)).toBe(false)
    expect(canCreateGenerated(semanticError)).toBe(false)
    expect(canCommitImport(semanticError)).toBe(false)
  })

  it('requires explicit confirmation for draft-with-errors saves', () => {
    expect(evaluateValidationPolicy(semanticError, 'save-draft-with-errors')).toMatchObject({
      allowed: false,
      requiresExplicitDraftConfirmation: true,
      reason: 'draft-confirmation-required'
    })
    expect(
      evaluateValidationPolicy(semanticError, 'save-draft-with-errors', {
        explicitDraftConfirmation: true
      })
    ).toMatchObject({ allowed: true, reason: 'allowed' })
  })

  it('never waives malformed XML or extension data loss', () => {
    const malformed = createValidationSummary([
      validationIssue({
        code: 'moddle.parse-error',
        severity: 'error',
        source: 'moddle',
        message: 'Malformed'
      })
    ])
    expect(canApplyXml(malformed)).toBe(false)

    const droppedByModdle = createValidationSummary([
      validationIssue({
        code: 'moddle.unparsable-content',
        severity: 'error',
        source: 'moddle',
        message: 'Duplicate content was dropped'
      })
    ])
    expect(canApplyXml(droppedByModdle)).toBe(false)

    const loss = createValidationSummary([
      validationIssue({
        code: 'preservation.extension-element-changed',
        severity: 'error',
        source: 'preservation',
        message: 'Lost'
      })
    ])
    expect(
      evaluateValidationPolicy(loss, 'save-draft-with-errors', {
        explicitDraftConfirmation: true
      })
    ).toMatchObject({ allowed: false, reason: 'unsafe-preservation-loss' })
  })

  it('treats schema-invalid XML as unsafe for Apply and draft save', () => {
    const summary = createValidationSummary([
      validationIssue({
        code: 'xsd.schema-1',
        severity: 'error',
        source: 'xsd',
        message: 'Attribute is not allowed.'
      })
    ])

    expect(evaluateValidationPolicy(summary, 'apply-editor').reason).toBe('invalid-xml')
    expect(
      evaluateValidationPolicy(summary, 'save-draft-with-errors', {
        explicitDraftConfirmation: true
      }).allowed
    ).toBe(false)
  })
})

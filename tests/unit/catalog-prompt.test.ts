/**
 * composeCreateBpmn's optional workspace-process catalog.
 *
 * With no catalog (undefined OR empty) the render must stay byte-identical to
 * the golden jinja2 output (fixtures loaded exactly like prompts.test.ts). With
 * a non-empty catalog, a linking section is inserted before the message-history
 * framing, listing every process and teaching the callActivity linking rules.
 */
import { describe, it, expect } from 'vitest'
import { composeCreateBpmn } from '../../src/gen/prompts'
import { loadPromptFixture } from './helpers'

describe('composeCreateBpmn: no catalog is byte-identical to the golden render', () => {
  it('undefined catalog equals the golden', () => {
    const history = loadPromptFixture('history.txt')
    const golden = loadPromptFixture('create_bpmn.golden.txt')
    expect(composeCreateBpmn(history)).toBe(golden)
  })

  it('empty catalog equals the golden (treated as no catalog)', () => {
    const history = loadPromptFixture('history.txt')
    const golden = loadPromptFixture('create_bpmn.golden.txt')
    expect(composeCreateBpmn(history, [])).toBe(golden)
  })
})

describe('composeCreateBpmn: non-empty catalog injects the linking section', () => {
  const history = 'User: A customer submits an order.'
  const catalog = [
    { id: 'Process_Onboarding', name: 'Employee Onboarding' },
    { id: 'Process_Invoice', name: 'Invoice Approval' }
  ]

  it('lists both ids and both names', () => {
    const out = composeCreateBpmn(history, catalog)
    expect(out).toContain('Process_Onboarding')
    expect(out).toContain('Employee Onboarding')
    expect(out).toContain('Process_Invoice')
    expect(out).toContain('Invoice Approval')
    // rendered as bullet list entries "- <id> — <name>"
    expect(out).toContain('- Process_Onboarding — Employee Onboarding')
    expect(out).toContain('- Process_Invoice — Invoice Approval')
  })

  it('teaches the callActivity JSON shape and the confidence / never-invent rules', () => {
    const out = composeCreateBpmn(history, catalog)
    expect(out).toContain('"type": "callActivity"')
    expect(out).toContain('"calledProcess"')
    expect(out).toContain('confidence')
    expect(out).toContain('Never invent')
  })

  it('inserts the section between the examples block and the message-history framing', () => {
    const out = composeCreateBpmn(history, catalog)
    const sectionAt = out.indexOf('# Existing processes in this workspace')
    const framingAt = out.indexOf('The following is the message history')
    const examplesAt = out.indexOf('# Process examples')
    expect(sectionAt).toBeGreaterThan(-1)
    expect(framingAt).toBeGreaterThan(-1)
    expect(examplesAt).toBeGreaterThan(-1)
    expect(examplesAt).toBeLessThan(sectionAt)
    expect(sectionAt).toBeLessThan(framingAt)
    // the message history itself still lands in the framing
    expect(out).toContain('User: A customer submits an order.')
  })

  it('keeps the representation + examples preamble intact', () => {
    const out = composeCreateBpmn(history, catalog)
    expect(out).toContain('# Representation of various BPMN elements')
    expect(out).toContain('# Process examples')
  })
})

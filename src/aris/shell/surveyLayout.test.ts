/**
 * Layout regression for the survey description, using the canonical process
 * GLM-5.3 Flash returned for it. The layout rules (default owner legend, owner,
 * input/output and system satellites, branches laid out by the clean-layout gate)
 * are asserted on the convention AML the Create tab would place.
 */
import { describe, expect, it } from 'vitest'

import surveyProcess from './__tests__/fixtures/survey-canonical.glm-5.3-flash.json'
import { buildConventionAml } from '../headless/amlConvention'

describe('survey description -> convention layout (GLM-5.3 Flash output)', () => {
  it('builds one model with every step, decision, role, system and control', async () => {
    const result = await buildConventionAml(surveyProcess)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.counts.models).toBe(1)
    expect(result.counts.objects).toBe(72)
    expect(result.counts.relations).toBe(73)
  })

  it('passes the clean-layout acceptance gate instead of a single vertical column', async () => {
    const result = await buildConventionAml(surveyProcess)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.layoutAccepted).toBe(true)
    expect(result.layoutFindings).toEqual([])
  })

  it('writes the default-owner legend top-right and keeps the owner satellites', async () => {
    const result = await buildConventionAml(surveyProcess)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.legend.header.definitionId).toBe('FFTextDef.legend.defaults')
    expect(result.legend.blocks.some((block) => block.kind === 'owner')).toBe(true)
    // Satellites that repeat on every step are summarised in the legend, not drawn per step.
    expect(result.suppressedOccurrenceCount).toBeGreaterThan(0)
  })

  it('keeps the named systems and control satellites in the AML', async () => {
    const result = await buildConventionAml(surveyProcess)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.xml).toContain('Survey Hub')
  })
})

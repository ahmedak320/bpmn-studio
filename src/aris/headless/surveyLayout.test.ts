import { describe, expect, it } from 'vitest'
import { buildConventionAml } from './amlConvention'

/**
 * A survey-shaped process with a loop from its right-hand step back to an
 * earlier step, and risk and requirement controls on several steps. The loop
 * must leave from the outer side, the layout must be accepted, and the default
 * legend must stay beside the spine instead of drifting to the far right.
 */
const n = (id: string, kind: string, en: string) => ({
  id,
  kind,
  names: { en, ar: en },
  confidence: 'high'
})
const e = (id: string, source: string, target: string) => ({
  id,
  kind: 'sequence',
  sourceNodeId: source,
  targetNodeId: target,
  confidence: 'high'
})

const process = {
  version: 1,
  identity: { id: 'proc-survey', names: { en: 'Survey process', ar: 'Survey process' }, confidence: 'high' },
  nodes: [
    n('n-start', 'event', 'Survey request received'),
    n('n-plan', 'activity', 'Add survey to yearly plan'),
    n('n-dup', 'decision', 'Duplicate or close to another survey?'),
    n('n-reject', 'event', 'Request rejected'),
    n('n-q', 'activity', 'Request questions from sector'),
    n('n-review', 'activity', 'Review and modify questions with sector'),
    n('n-approve', 'decision', 'Sector approves questions?'),
    n('n-create', 'activity', 'Create survey on Survey Hub'),
    n('n-share', 'activity', 'Share link with sector for final check'),
    n('n-release', 'activity', 'Release survey'),
    n('n-part', 'decision', 'Specific participants?'),
    n('n-sector', 'activity', 'Sector shares link with participants'),
    n('n-dmt', 'activity', 'Operations sends link to whole DMT'),
    n('n-close', 'activity', 'Close survey when enough participants'),
    n('n-results', 'activity', 'Share results with sector'),
    n('n-neg', 'decision', 'Negative results?'),
    n('n-plan2', 'activity', 'Create improvement plan and follow up'),
    n('n-end', 'event', 'Survey closed')
  ],
  decisions: [
    { id: 'd-dup', nodeId: 'n-dup', criteria: { en: 'Duplicate?', ar: 'Duplicate?' }, outcomes: [
      { id: 'o-dup', names: { en: 'Yes', ar: 'Yes' }, targetNodeId: 'n-reject' },
      { id: 'o-new', names: { en: 'No', ar: 'No' }, targetNodeId: 'n-q' }], confidence: 'high' },
    { id: 'd-approve', nodeId: 'n-approve', criteria: { en: 'Approval', ar: 'Approval' }, outcomes: [
      { id: 'o-ok', names: { en: 'Approved', ar: 'Approved' }, targetNodeId: 'n-create' },
      { id: 'o-changes', names: { en: 'Changes', ar: 'Changes' }, targetNodeId: 'n-review' }], confidence: 'high' },
    { id: 'd-part', nodeId: 'n-part', criteria: { en: 'Participants', ar: 'Participants' }, outcomes: [
      { id: 'o-sector', names: { en: 'Sector', ar: 'Sector' }, targetNodeId: 'n-sector' },
      { id: 'o-all', names: { en: 'All', ar: 'All' }, targetNodeId: 'n-dmt' }], confidence: 'high' },
    { id: 'd-neg', nodeId: 'n-neg', criteria: { en: 'Results', ar: 'Results' }, outcomes: [
      { id: 'o-neg', names: { en: 'Negative', ar: 'Negative' }, targetNodeId: 'n-plan2' },
      { id: 'o-pos', names: { en: 'Positive', ar: 'Positive' }, targetNodeId: 'n-end' }], confidence: 'high' }
  ],
  edges: [
    e('e1', 'n-start', 'n-plan'), e('e2', 'n-plan', 'n-dup'), e('e3', 'n-q', 'n-review'),
    e('e4', 'n-review', 'n-approve'), e('e5', 'n-create', 'n-share'), e('e6', 'n-share', 'n-release'),
    e('e7', 'n-release', 'n-part'), e('e8', 'n-sector', 'n-close'), e('e9', 'n-dmt', 'n-close'),
    e('e10', 'n-close', 'n-results'), e('e11', 'n-results', 'n-neg'), e('e12', 'n-plan2', 'n-end')
  ],
  roles: [
    { id: 'r-ops', names: { en: 'Operations section', ar: 'Operations section' }, nodeIds: ['n-plan', 'n-create', 'n-dmt', 'n-close', 'n-results'], factIds: [], confidence: 'high', owner: true },
    { id: 'r-sector', names: { en: 'Sector', ar: 'Sector' }, nodeIds: ['n-q', 'n-review', 'n-share', 'n-sector', 'n-plan2'], factIds: [], confidence: 'high' }
  ],
  systems: [
    { id: 's-hub', names: { en: 'Survey Hub', ar: 'Survey Hub' }, nodeIds: ['n-create', 'n-release'], confidence: 'high' }
  ],
  informationObjects: [],
  controls: [
    { id: 'c-risk', names: { en: 'Survey risk', ar: 'Survey risk' }, kind: 'risk', nodeIds: ['n-q', 'n-approve', 'n-release', 'n-results'], factIds: [], confidence: 'high' },
    { id: 'c-req', names: { en: 'Survey requirement', ar: 'Survey requirement' }, kind: 'requirement', nodeIds: ['n-create', 'n-sector', 'n-part'], factIds: [], confidence: 'high' }
  ],
  facts: [],
  unknowns: []
}

describe('survey-shaped convention layout', () => {
  it('is accepted, and the legend stays near the flow', async () => {
    const result = await buildConventionAml(process)
    if (!result.ok) throw new Error('expected a valid convention model')
    expect(result.layoutAccepted).toBe(true)
    expect(result.layoutFindings).toEqual([])
    const legendX = result.legend.header.position.x
    // The spine and its satellites end near x=1330 in this layout. The legend must
    // sit beside the top of the spine, not at that far edge.
    expect(legendX).toBeLessThan(1000)
  })
})

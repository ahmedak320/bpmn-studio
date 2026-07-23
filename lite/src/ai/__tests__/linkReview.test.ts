import { describe, it, expect } from 'vitest'
import { partitionLinks, applyLinkDecisions } from '../linkReview'
import { collectProposedLinks, type ProposedLink } from '../browserAi'
import type { BpmnElement } from '@app/gen'

const link = (over: Partial<ProposedLink>): ProposedLink => ({
  elementId: 'CA_1',
  label: 'Do thing',
  calledProcess: 'Process_x',
  confidence: 'low',
  ...over
})

describe('partitionLinks', () => {
  it('routes high+known → confident, low+known → unsure, unknown → unmatched', () => {
    const known = new Set(['Process_a', 'Process_b'])
    const isKnown = (id: string): boolean => known.has(id)
    const links: ProposedLink[] = [
      link({ elementId: 'A', calledProcess: 'Process_a', confidence: 'high' }),
      link({ elementId: 'B', calledProcess: 'Process_b', confidence: 'low' }),
      link({ elementId: 'C', calledProcess: 'Process_missing', confidence: 'low' })
    ]
    const { confident, unsure, unmatched } = partitionLinks(links, isKnown)
    expect(confident.map((l) => l.elementId)).toEqual(['A'])
    expect(unsure.map((l) => l.elementId)).toEqual(['B'])
    expect(unmatched.map((l) => l.elementId)).toEqual(['C'])
  })

  it('unmatched wins over confidence: high but unknown → unmatched (never confident)', () => {
    const isKnown = (): boolean => false
    const { confident, unsure, unmatched } = partitionLinks(
      [link({ elementId: 'H', confidence: 'high' }), link({ elementId: 'L', confidence: 'low' })],
      isKnown
    )
    expect(confident).toEqual([])
    expect(unsure).toEqual([])
    expect(unmatched.map((l) => l.elementId)).toEqual(['H', 'L'])
  })

  it('empty input → three empty buckets', () => {
    expect(partitionLinks([], () => true)).toEqual({ confident: [], unsure: [], unmatched: [] })
  })
})

describe('applyLinkDecisions', () => {
  const xml =
    '<definitions><process id="P">' +
    '<callActivity id="CA_1" calledElement="Process_a" />' +
    '<callActivity id="CA_2" calledElement="Process_b" />' +
    '<callActivity id="CA_3" calledElement="Process_c" />' +
    '</process></definitions>'
  const links: ProposedLink[] = [
    link({ elementId: 'CA_1', calledProcess: 'Process_a' }),
    link({ elementId: 'CA_2', calledProcess: 'Process_b' }),
    link({ elementId: 'CA_3', calledProcess: 'Process_c' })
  ]

  it('strips calledElement for every link NOT in the accepted set', () => {
    const out = applyLinkDecisions(xml, links, new Set(['CA_2']))
    expect(out).toContain('<callActivity id="CA_1" />')
    expect(out).toContain('<callActivity id="CA_2" calledElement="Process_b" />')
    expect(out).toContain('<callActivity id="CA_3" />')
  })

  it('keeps all links when every id is accepted (xml unchanged)', () => {
    const out = applyLinkDecisions(xml, links, new Set(['CA_1', 'CA_2', 'CA_3']))
    expect(out).toBe(xml)
  })

  it('strips all links when the accepted set is empty', () => {
    const out = applyLinkDecisions(xml, links, new Set())
    expect(out).not.toContain('calledElement')
  })
})

describe('collectProposedLinks', () => {
  it('collects a top-level callActivity with a non-empty calledProcess', () => {
    const ir: BpmnElement[] = [
      { type: 'startEvent', id: 'S' },
      { type: 'callActivity', id: 'CA_1', label: 'Sub A', calledProcess: 'Process_a', confidence: 'high' },
      { type: 'endEvent', id: 'E' }
    ]
    expect(collectProposedLinks(ir)).toEqual([
      { elementId: 'CA_1', label: 'Sub A', calledProcess: 'Process_a', confidence: 'high' }
    ])
  })

  it('defaults confidence to "low" when the model omitted it', () => {
    const ir: BpmnElement[] = [
      { type: 'callActivity', id: 'CA_1', label: 'Sub', calledProcess: 'Process_a' }
    ]
    expect(collectProposedLinks(ir)[0].confidence).toBe('low')
  })

  it('skips callActivities with a missing/empty calledProcess', () => {
    const ir: BpmnElement[] = [
      { type: 'callActivity', id: 'CA_1', label: 'Unlinked' },
      { type: 'callActivity', id: 'CA_2', label: 'Blank', calledProcess: '' },
      { type: 'callActivity', id: 'CA_3', label: 'Spaces', calledProcess: '   ' }
    ]
    expect(collectProposedLinks(ir)).toEqual([])
  })

  it('walks callActivities nested in exclusive / inclusive branch paths', () => {
    const ir: BpmnElement[] = [
      {
        type: 'exclusiveGateway',
        id: 'X',
        label: 'valid?',
        has_join: false,
        branches: [
          {
            condition: 'yes',
            path: [
              { type: 'callActivity', id: 'CA_yes', label: 'Fulfil', calledProcess: 'Process_fulfil', confidence: 'high' }
            ]
          },
          {
            condition: 'no',
            path: [
              {
                type: 'inclusiveGateway',
                id: 'I',
                label: 'inner',
                has_join: false,
                branches: [
                  {
                    condition: 'a',
                    path: [
                      { type: 'callActivity', id: 'CA_deep', label: 'Notify', calledProcess: 'Process_notify' }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
    const ids = collectProposedLinks(ir).map((l) => l.elementId)
    expect(ids).toEqual(['CA_yes', 'CA_deep'])
  })

  it('walks callActivities nested in parallel gateway branch arrays', () => {
    const ir: BpmnElement[] = [
      {
        type: 'parallelGateway',
        id: 'P',
        branches: [
          [{ type: 'callActivity', id: 'CA_p1', label: 'Left', calledProcess: 'Process_l' }],
          [
            { type: 'task', id: 'T', label: 'plain' },
            { type: 'callActivity', id: 'CA_p2', label: 'Right', calledProcess: 'Process_r', confidence: 'high' }
          ]
        ]
      }
    ]
    const links = collectProposedLinks(ir)
    expect(links.map((l) => l.elementId)).toEqual(['CA_p1', 'CA_p2'])
    expect(links.find((l) => l.elementId === 'CA_p2')?.confidence).toBe('high')
  })
})

import { describe, it, expect } from 'vitest'
import { buildProcessIndex } from '@app/shared/processIndex'
import { buildLinkGraph, type LinkGraph } from '../linkGraph'

/** A minimal BPMN-ish file with one process and callActivities in order. */
function file(relPath: string, processId: string, calls: string[] = []): { relPath: string; xml: string } {
  const activities = calls
    .map((c, i) => `<bpmn:callActivity id="ca_${i}" calledElement="${c}" />`)
    .join('')
  return {
    relPath,
    xml:
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">' +
      `<bpmn:process id="${processId}" name="${processId} name">${activities}</bpmn:process>` +
      '</bpmn:definitions>'
  }
}

function graphOf(files: Array<{ relPath: string; xml: string }>): LinkGraph {
  return buildLinkGraph(files, buildProcessIndex(files))
}

describe('buildLinkGraph — resolution via the process index', () => {
  it('resolves calledElement to the file that declares the process', () => {
    const files = [file('parent.bpmn', 'P1', ['C1']), file('sub/child.bpmn', 'C1')]
    const graph = graphOf(files)

    expect(graph.childrenByFile.get('parent.bpmn')).toEqual([
      {
        parentRelPath: 'parent.bpmn',
        parentProcessId: 'P1',
        childRelPath: 'sub/child.bpmn',
        childProcessId: 'C1',
        calledElement: 'C1'
      }
    ])
    expect(graph.parentsByFile.get('sub/child.bpmn')).toEqual(
      graph.childrenByFile.get('parent.bpmn')
    )
    expect(graph.unresolvedByFile.size).toBe(0)
  })

  it('keeps document order and lists a child under every parent that calls it', () => {
    const files = [
      file('a.bpmn', 'A', ['C', 'B']),
      file('b.bpmn', 'B', ['C']),
      file('c.bpmn', 'C')
    ]
    const graph = graphOf(files)

    expect(graph.childrenByFile.get('a.bpmn')?.map((e) => e.childRelPath)).toEqual([
      'c.bpmn',
      'b.bpmn'
    ])
    // c.bpmn is a shared child: both parents appear, in file-scan order.
    expect(graph.parentsByFile.get('c.bpmn')?.map((e) => e.parentRelPath)).toEqual([
      'a.bpmn',
      'b.bpmn'
    ])
  })

  it('handles prefix-free tags, single quotes, self-closing or not, and XML entities', () => {
    const files = [
      {
        relPath: 'p.bpmn',
        xml:
          '<definitions><process id="P">' +
          "<callActivity id='x' calledElement='A&amp;B'></callActivity>" +
          '</process></definitions>'
      },
      { relPath: 'q.bpmn', xml: '<definitions><process id="A&amp;B" /></definitions>' }
    ]
    const graph = graphOf(files)
    const edges = graph.childrenByFile.get('p.bpmn')
    expect(edges).toHaveLength(1)
    expect(edges?.[0].calledElement).toBe('A&B')
    expect(edges?.[0].childRelPath).toBe('q.bpmn')
  })

  it('ignores callActivities without a calledElement, or with an empty one', () => {
    const files = [
      {
        relPath: 'p.bpmn',
        xml:
          '<definitions><process id="P">' +
          '<callActivity id="unlinked" />' +
          '<callActivity id="empty" calledElement="" />' +
          '</process></definitions>'
      }
    ]
    const graph = graphOf(files)
    expect(graph.childrenByFile.size).toBe(0)
    expect(graph.unresolvedByFile.size).toBe(0)
  })
})

describe('buildLinkGraph — dedup', () => {
  it('dedups by (parent, childRelPath): repeated calls collapse to one edge', () => {
    const files = [file('a.bpmn', 'A', ['B', 'B', 'B']), file('b.bpmn', 'B')]
    const graph = graphOf(files)
    expect(graph.childrenByFile.get('a.bpmn')).toHaveLength(1)
    expect(graph.parentsByFile.get('b.bpmn')).toHaveLength(1)
  })

  it('collapses two DIFFERENT process ids living in the same child file (first wins)', () => {
    const files = [
      file('a.bpmn', 'A', ['B1', 'B2']),
      {
        relPath: 'b.bpmn',
        xml: '<definitions><process id="B1" /><process id="B2" /></definitions>'
      }
    ]
    const graph = graphOf(files)
    const edges = graph.childrenByFile.get('a.bpmn')
    expect(edges).toHaveLength(1)
    expect(edges?.[0].calledElement).toBe('B1')
    expect(edges?.[0].childProcessId).toBe('B1')
  })
})

describe('buildLinkGraph — unresolved bucket', () => {
  it('records calledElements that resolve to no known process, deduped per file', () => {
    const files = [file('a.bpmn', 'A', ['Ghost', 'B', 'Ghost', 'Phantom']), file('b.bpmn', 'B')]
    const graph = graphOf(files)
    expect(graph.unresolvedByFile.get('a.bpmn')).toEqual(['Ghost', 'Phantom'])
    // The resolvable call still produced its edge.
    expect(graph.childrenByFile.get('a.bpmn')?.map((e) => e.childRelPath)).toEqual(['b.bpmn'])
  })

  it('leaves files without broken calls out of the map entirely', () => {
    const files = [file('a.bpmn', 'A', ['B']), file('b.bpmn', 'B')]
    expect(graphOf(files).unresolvedByFile.has('a.bpmn')).toBe(false)
  })
})

describe('buildLinkGraph — self references', () => {
  it('keeps a self-reference in the graph (tree consumers filter it)', () => {
    const files = [file('a.bpmn', 'A', ['A'])]
    const graph = graphOf(files)
    const edges = graph.childrenByFile.get('a.bpmn')
    expect(edges).toHaveLength(1)
    expect(edges?.[0].childRelPath).toBe('a.bpmn')
    expect(edges?.[0].parentRelPath).toBe('a.bpmn')
    expect(graph.parentsByFile.get('a.bpmn')).toEqual(edges)
  })

  it('keeps cycles between files (a→b→a)', () => {
    const files = [file('a.bpmn', 'A', ['B']), file('b.bpmn', 'B', ['A'])]
    const graph = graphOf(files)
    expect(graph.childrenByFile.get('a.bpmn')?.[0].childRelPath).toBe('b.bpmn')
    expect(graph.childrenByFile.get('b.bpmn')?.[0].childRelPath).toBe('a.bpmn')
  })
})

describe('buildLinkGraph — purity and determinism', () => {
  it('never mutates its inputs (deep-frozen files and index survive)', () => {
    const files = [file('a.bpmn', 'A', ['B', 'Ghost']), file('b.bpmn', 'B')]
    for (const f of files) Object.freeze(f)
    Object.freeze(files)
    const index = buildProcessIndex(files)

    expect(() => buildLinkGraph(files, index)).not.toThrow()
    expect(files[0].xml).toContain('calledElement="B"')
  })

  it('produces structurally identical graphs on repeated calls', () => {
    const files = [
      file('a.bpmn', 'A', ['B', 'C', 'Ghost']),
      file('b.bpmn', 'B', ['C']),
      file('c.bpmn', 'C', ['A'])
    ]
    const index = buildProcessIndex(files)
    const first = buildLinkGraph(files, index)
    const second = buildLinkGraph(files, index)
    expect(second).toEqual(first)
  })
})

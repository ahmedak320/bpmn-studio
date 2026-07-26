import { describe, expect, it } from 'vitest'
import { buildProcessIndex } from '@app/shared/processIndex'
import {
  buildLinkGraph,
  processLinkKey,
  type LinkGraph
} from '../linkGraph'

interface TestFile {
  relPath: string
  xml: string
}

/** A minimal BPMN-ish file with one process and callActivities in order. */
function file(relPath: string, processId: string, calls: string[] = []): TestFile {
  const activities = calls
    .map((calledElement, index) =>
      `<bpmn:callActivity id="ca_${index}" calledElement="${calledElement}" />`
    )
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

function graphOf(files: TestFile[]): LinkGraph {
  return buildLinkGraph(files, buildProcessIndex(files))
}

describe('buildLinkGraph — stable process-pair aggregation', () => {
  it('resolves a pair and retains the legacy file-keyed views', () => {
    const files = [file('parent.bpmn', 'P1', ['C1']), file('sub/child.bpmn', 'C1')]
    const graph = graphOf(files)

    expect(graph.links).toEqual([
      {
        key: processLinkKey('P1', 'C1'),
        parentRelPath: 'parent.bpmn',
        parentProcessId: 'P1',
        childRelPath: 'sub/child.bpmn',
        childProcessId: 'C1',
        calledElement: 'C1',
        callActivityIds: ['ca_0'],
        count: 1,
        distinctParentCount: 1
      }
    ])
    expect(graph.childrenByProcess.get('P1')).toEqual(graph.links)
    expect(graph.parentsByProcess.get('C1')).toEqual(graph.links)
    expect(graph.childrenByFile.get('parent.bpmn')).toEqual(graph.links)
    expect(graph.parentsByFile.get('sub/child.bpmn')).toEqual(graph.links)
    expect(graph.unresolvedByFile.size).toBe(0)
  })

  it('dedups by (parentProcessId, childProcessId), aggregates repeats, and sorts call ids', () => {
    const files: TestFile[] = [
      {
        relPath: 'parent.bpmn',
        xml:
          '<definitions><process id="Parent">' +
          '<callActivity id="call_z" calledElement="Child" />' +
          '<callActivity calledElement="Child" />' +
          '<callActivity id="call_a" calledElement="Child" />' +
          '</process></definitions>'
      },
      file('child.bpmn', 'Child')
    ]
    const graph = graphOf(files)
    const link = graph.links[0]

    expect(graph.links).toHaveLength(1)
    expect(link.key).toBe('["Parent","Child"]')
    expect(link.callActivityIds).toEqual(['call_a', 'call_z'])
    expect(link.count).toBe(3)
    expect(graph.childrenByFile.get('parent.bpmn')).toHaveLength(1)
    expect(graph.parentsByFile.get('child.bpmn')).toHaveLength(1)
  })

  it('keeps pair identity stable when either physical file is renamed', () => {
    const before = graphOf([file('old-parent.bpmn', 'Parent', ['Child']), file('old-child.bpmn', 'Child')])
    const after = graphOf([
      file('moved/new-parent.bpmn', 'Parent', ['Child']),
      file('renamed/new-child.bpmn', 'Child')
    ])

    expect(after.links[0].key).toBe(before.links[0].key)
    expect(after.links[0].parentRelPath).not.toBe(before.links[0].parentRelPath)
    expect(after.links[0].childRelPath).not.toBe(before.links[0].childRelPath)
  })

  it('keeps different child process ids distinct even when they share a file', () => {
    const files = [
      file('parent.bpmn', 'Parent', ['Child_2', 'Child_1']),
      {
        relPath: 'children.bpmn',
        xml:
          '<definitions><process id="Child_1"></process>' +
          '<process id="Child_2"></process></definitions>'
      }
    ]
    const graph = graphOf(files)

    expect(graph.links.map((link) => link.childProcessId)).toEqual(['Child_1', 'Child_2'])
    expect(graph.childrenByFile.get('parent.bpmn')).toHaveLength(2)
    expect(graph.parentsByFile.get('children.bpmn')).toHaveLength(2)
  })
})

describe('buildLinkGraph — distinct parents and process-scoped sources', () => {
  it('aggregates repeats from one parent without inflating distinct-parent metadata', () => {
    const graph = graphOf([
      file('a.bpmn', 'A', ['Child', 'Child']),
      file('b.bpmn', 'B', ['Child']),
      file('child.bpmn', 'Child', ['Child'])
    ])

    expect(graph.parentsByProcess.get('Child')?.map((link) => link.parentProcessId)).toEqual([
      'A',
      'B',
      'Child'
    ])
    expect(graph.parentsByProcess.get('Child')?.map((link) => link.count)).toEqual([2, 1, 1])
    // The self-reference is retained but is not a distinct external parent.
    expect(graph.distinctParentCountByProcess.get('Child')).toBe(2)
    expect(
      graph.parentsByProcess.get('Child')?.map((link) => link.distinctParentCount)
    ).toEqual([2, 2, 2])
  })

  it('attributes calls to the containing process when one file declares several processes', () => {
    const files: TestFile[] = [
      {
        relPath: 'parents.bpmn',
        xml:
          '<definitions>' +
          '<process id="Parent_2"><callActivity id="to_c2" calledElement="Child_2" /></process>' +
          '<process id="Parent_1"><callActivity id="to_c1" calledElement="Child_1" /></process>' +
          '</definitions>'
      },
      file('child-1.bpmn', 'Child_1'),
      file('child-2.bpmn', 'Child_2')
    ]
    const graph = graphOf(files)

    expect(
      graph.links.map(({ parentProcessId, childProcessId, parentRelPath }) => ({
        parentProcessId,
        childProcessId,
        parentRelPath
      }))
    ).toEqual([
      {
        parentProcessId: 'Parent_1',
        childProcessId: 'Child_1',
        parentRelPath: 'parents.bpmn'
      },
      {
        parentProcessId: 'Parent_2',
        childProcessId: 'Child_2',
        parentRelPath: 'parents.bpmn'
      }
    ])
  })

  it('sorts pair links by process identity rather than document or input-file order', () => {
    const graph = graphOf([
      file('z.bpmn', 'Z', ['C', 'B']),
      file('a.bpmn', 'A', ['C']),
      file('c.bpmn', 'C'),
      file('b.bpmn', 'B')
    ])

    expect(graph.links.map((link) => [link.parentProcessId, link.childProcessId])).toEqual([
      ['A', 'C'],
      ['Z', 'B'],
      ['Z', 'C']
    ])
    expect(graph.parentsByProcess.get('C')?.map((link) => link.parentProcessId)).toEqual([
      'A',
      'Z'
    ])
  })
})

describe('buildLinkGraph — ambiguity and unresolved attribution', () => {
  it('never resolves a duplicate child id through ProcessIndex last-wins lookup', () => {
    const files = [
      file('parent.bpmn', 'Parent', ['Duplicate']),
      file('generated/Duplicate.bpmn', 'Duplicate'),
      file('other-name.bpmn', 'Duplicate')
    ]
    const graph = graphOf(files)

    expect(buildProcessIndex(files).get('Duplicate')?.relPath).toBe('other-name.bpmn')
    expect(graph.links).toEqual([])
    expect(Array.from(graph.ambiguousProcessIds)).toEqual(['Duplicate'])
    expect(graph.unresolvedByFile.get('parent.bpmn')).toEqual(['Duplicate'])
    expect(graph.unresolvedLinks).toEqual([
      {
        parentRelPath: 'parent.bpmn',
        parentProcessId: 'Parent',
        callActivityId: 'ca_0',
        calledElement: 'Duplicate',
        reason: 'ambiguous-child-process',
        ambiguous: true,
        candidateRelPaths: ['generated/Duplicate.bpmn', 'other-name.bpmn']
      }
    ])
    expect(graph.ambiguousByFile.get('parent.bpmn')).toEqual(graph.unresolvedLinks)
    expect(graph.childrenByFile.has('parent.bpmn')).toBe(false)
  })

  it('also refuses to merge calls originating from a duplicate parent id', () => {
    const files = [
      file('parent-a.bpmn', 'Parent', ['Child']),
      file('parent-b.bpmn', 'Parent'),
      file('child.bpmn', 'Child')
    ]
    const graph = graphOf(files)

    expect(graph.links).toEqual([])
    expect(Array.from(graph.ambiguousProcessIds)).toEqual(['Parent'])
    expect(graph.unresolvedLinks[0]).toMatchObject({
      parentRelPath: 'parent-a.bpmn',
      parentProcessId: 'Parent',
      calledElement: 'Child',
      reason: 'ambiguous-parent-process',
      ambiguous: true,
      candidateRelPaths: ['parent-a.bpmn', 'parent-b.bpmn']
    })
  })

  it('flags duplicate child declarations that occur in the same physical file', () => {
    const files: TestFile[] = [
      {
        relPath: 'combined.bpmn',
        xml:
          '<definitions>' +
          '<process id="Parent"><callActivity id="call_dup" calledElement="Duplicate" /></process>' +
          '<process id="Duplicate"></process>' +
          '<process id="Duplicate"></process>' +
          '</definitions>'
      }
    ]
    const graph = graphOf(files)

    expect(graph.links).toEqual([])
    expect(Array.from(graph.ambiguousProcessIds)).toEqual(['Duplicate'])
    expect(graph.unresolvedLinks[0]).toMatchObject({
      parentProcessId: 'Parent',
      callActivityId: 'call_dup',
      calledElement: 'Duplicate',
      reason: 'ambiguous-child-process',
      candidateRelPaths: ['combined.bpmn', 'combined.bpmn']
    })
  })

  it('records missing targets once in the legacy bucket and per occurrence in process metadata', () => {
    const graph = graphOf([
      file('parent.bpmn', 'Parent', ['Ghost', 'Known', 'Ghost', 'Phantom']),
      file('known.bpmn', 'Known')
    ])

    expect(graph.unresolvedByFile.get('parent.bpmn')).toEqual(['Ghost', 'Phantom'])
    expect(graph.unresolvedByProcess.get('Parent')).toHaveLength(3)
    expect(
      graph.unresolvedByProcess.get('Parent')?.map((issue) => issue.callActivityId)
    ).toEqual(['ca_0', 'ca_2', 'ca_3'])
    expect(
      graph.unresolvedByProcess.get('Parent')?.every(
        (issue) => issue.reason === 'missing-child-process' && !issue.ambiguous
      )
    ).toBe(true)
    expect(graph.childrenByProcess.get('Parent')?.map((link) => link.childProcessId)).toEqual([
      'Known'
    ])
  })

  it('attributes unresolved calls separately for multiple processes in one file', () => {
    const files: TestFile[] = [
      {
        relPath: 'parents.bpmn',
        xml:
          '<definitions>' +
          '<process id="Parent_B"><callActivity id="missing_b" calledElement="Ghost_B" /></process>' +
          '<process id="Parent_A"><callActivity id="missing_a" calledElement="Ghost_A" /></process>' +
          '</definitions>'
      }
    ]
    const graph = graphOf(files)

    expect(Array.from(graph.unresolvedByProcess.keys())).toEqual(['Parent_A', 'Parent_B'])
    expect(graph.unresolvedByProcess.get('Parent_A')).toEqual([
      expect.objectContaining({
        parentRelPath: 'parents.bpmn',
        parentProcessId: 'Parent_A',
        callActivityId: 'missing_a',
        calledElement: 'Ghost_A'
      })
    ])
    expect(graph.unresolvedByProcess.get('Parent_B')).toEqual([
      expect.objectContaining({
        parentRelPath: 'parents.bpmn',
        parentProcessId: 'Parent_B',
        callActivityId: 'missing_b',
        calledElement: 'Ghost_B'
      })
    ])
  })

  it('marks a linked call outside any process as unresolved instead of guessing a file source', () => {
    const files: TestFile[] = [
      {
        relPath: 'invalid-parent.bpmn',
        xml:
          '<definitions><callActivity id="outside" calledElement="Child" />' +
          '<process id="Parent"></process></definitions>'
      },
      file('child.bpmn', 'Child')
    ]
    const graph = graphOf(files)

    expect(graph.links).toEqual([])
    expect(graph.unresolvedLinks[0]).toMatchObject({
      parentRelPath: 'invalid-parent.bpmn',
      parentProcessId: undefined,
      callActivityId: 'outside',
      calledElement: 'Child',
      reason: 'missing-parent-process'
    })
    expect(graph.unresolvedByProcess.size).toBe(0)
  })

  it('ignores callActivities without a calledElement, or with an empty one', () => {
    const files: TestFile[] = [
      {
        relPath: 'parent.bpmn',
        xml:
          '<definitions><process id="Parent">' +
          '<callActivity id="unlinked" />' +
          '<callActivity id="empty" calledElement="" />' +
          '</process></definitions>'
      }
    ]
    const graph = graphOf(files)
    expect(graph.links).toEqual([])
    expect(graph.unresolvedLinks).toEqual([])
    expect(graph.unresolvedByFile.size).toBe(0)
  })
})

describe('buildLinkGraph — XML syntax, self links, and cycles', () => {
  it('handles prefix-free tags, single quotes, paired tags, and XML entities', () => {
    const files = [
      {
        relPath: 'parent.bpmn',
        xml:
          '<definitions><process id="Parent">' +
          "<callActivity id='call_1' calledElement='A&amp;B'></callActivity>" +
          '</process></definitions>'
      },
      {
        relPath: 'child.bpmn',
        xml: '<definitions><process id="A&amp;B"></process></definitions>'
      }
    ]
    const link = graphOf(files).links[0]

    expect(link.calledElement).toBe('A&B')
    expect(link.childProcessId).toBe('A&B')
    expect(link.childRelPath).toBe('child.bpmn')
  })

  it('masks tag-shaped XML comments and CDATA without losing process offsets', () => {
    const files: TestFile[] = [
      {
        relPath: 'parent.bpmn',
        xml:
          '<definitions>' +
          '<!-- <process id="CommentProcess"><callActivity id="comment_call" calledElement="Ghost" /></process> -->' +
          '<![CDATA[<process id="CdataProcess"><callActivity id="cdata_call" calledElement="Ghost" /></process>]]>' +
          '<process id="Parent">' +
          '<!-- <callActivity id="nested_comment" calledElement="Ghost" /> -->' +
          '<![CDATA[<callActivity id="nested_cdata" calledElement="Ghost" />]]>' +
          '<callActivity id="real_call" calledElement="Child" />' +
          '</process></definitions>'
      },
      file('child.bpmn', 'Child')
    ]
    const graph = graphOf(files)

    expect(graph.links).toHaveLength(1)
    expect(graph.links[0]).toMatchObject({
      parentProcessId: 'Parent',
      childProcessId: 'Child',
      callActivityIds: ['real_call'],
      count: 1
    })
    expect(Array.from(graph.ambiguousProcessIds)).toEqual([])
    expect(graph.unresolvedLinks).toEqual([])
  })

  it('matches only unprefixed whole id and calledElement attribute names', () => {
    const files: TestFile[] = [
      {
        relPath: 'parent.bpmn',
        xml:
          '<definitions>' +
          '<process data-id="ShadowParent" ext:id="NamespacedParent" id="Parent">' +
          '<callActivity data-id="shadow_call" ext:id="namespaced_call" id="real_call" ' +
          'data-calledElement="Shadow" ext:calledElement="Namespaced" calledElement="Child" />' +
          '<callActivity id="ignored_ext" ext:calledElement="Ghost" />' +
          '<callActivity id="ignored_data" data-calledElement="Ghost" />' +
          '</process>' +
          '<process data-id="NotAProcessId"></process>' +
          '</definitions>'
      },
      {
        relPath: 'child.bpmn',
        xml:
          '<definitions><process data-id="ShadowChild" ext:id="NamespacedChild" ' +
          'id="Child"></process></definitions>'
      }
    ]
    const graph = graphOf(files)

    // The shared legacy index sees the leading shadow attributes; linkGraph's
    // exact declaration scan remains authoritative for safe resolution.
    expect(buildProcessIndex(files).has('Child')).toBe(false)
    expect(graph.links).toHaveLength(1)
    expect(graph.links[0]).toMatchObject({
      parentProcessId: 'Parent',
      childProcessId: 'Child',
      callActivityIds: ['real_call'],
      count: 1
    })
    expect(graph.unresolvedLinks).toEqual([])
    expect(Array.from(graph.ambiguousProcessIds)).toEqual([])
  })

  it('keeps a self-reference as a link but excludes it from external-parent count', () => {
    const graph = graphOf([file('self.bpmn', 'Self', ['Self'])])
    expect(graph.links).toHaveLength(1)
    expect(graph.links[0]).toMatchObject({
      parentProcessId: 'Self',
      childProcessId: 'Self',
      parentRelPath: 'self.bpmn',
      childRelPath: 'self.bpmn',
      distinctParentCount: 0
    })
    expect(graph.distinctParentCountByProcess.get('Self')).toBe(0)
  })

  it('keeps both directions of a process cycle', () => {
    const graph = graphOf([file('a.bpmn', 'A', ['B']), file('b.bpmn', 'B', ['A'])])
    expect(graph.links.map((link) => [link.parentProcessId, link.childProcessId])).toEqual([
      ['A', 'B'],
      ['B', 'A']
    ])
  })
})

describe('buildLinkGraph — purity and deterministic order', () => {
  it('does not mutate deeply frozen inputs', () => {
    const files = [file('a.bpmn', 'A', ['B', 'Ghost']), file('b.bpmn', 'B')]
    for (const input of files) Object.freeze(input)
    Object.freeze(files)
    const index = buildProcessIndex(files)

    expect(() => buildLinkGraph(files, index)).not.toThrow()
    expect(files[0].xml).toContain('calledElement="B"')
  })

  it('produces structurally identical graphs when file input order changes', () => {
    const files = [
      file('z-parent.bpmn', 'Z', ['B', 'C', 'Ghost']),
      file('b.bpmn', 'B', ['C']),
      file('c.bpmn', 'C', ['Z'])
    ]
    const shuffled = [files[2], files[0], files[1]]

    expect(graphOf(shuffled)).toEqual(graphOf(files))
  })
})

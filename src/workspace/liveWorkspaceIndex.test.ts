import { describe, expect, it } from 'vitest'
import {
  LiveWorkspaceIndex,
  uniqueFallbackProcessId,
  type LiveWorkspaceFile
} from './liveWorkspaceIndex'
import { validateBpmnXml } from '../validation'

const BPMN_NAMESPACES = [
  'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"',
  'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"',
  'xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"',
  'xmlns:di="http://www.omg.org/spec/DD/20100524/DI"',
  'xmlns:orbitpm="http://orbitpm.ae/schema/bpmn/1.0"'
].join(' ')

function processFragment(
  processId: string,
  suffix: string,
  options: { name?: string; calledElement?: string; owner?: string } = {}
): string {
  const call = options.calledElement
    ? `<bpmn:callActivity id="Call_${suffix}" calledElement="${options.calledElement}" />`
    : ''
  const owner = options.owner ? ` orbitpm:owner="${options.owner}"` : ''
  return [
    `<bpmn:process id="${processId}" name="${options.name ?? processId}"${owner}>`,
    `<bpmn:startEvent id="Start_${suffix}"><bpmn:outgoing>Flow_${suffix}</bpmn:outgoing></bpmn:startEvent>`,
    call,
    `<bpmn:endEvent id="End_${suffix}"><bpmn:incoming>Flow_${suffix}</bpmn:incoming></bpmn:endEvent>`,
    `<bpmn:sequenceFlow id="Flow_${suffix}" sourceRef="Start_${suffix}" targetRef="End_${suffix}" />`,
    '</bpmn:process>'
  ].join('')
}

function xml(
  processId: string,
  options: { name?: string; calledElement?: string; owner?: string } = {}
): string {
  return [
    `<bpmn:definitions ${BPMN_NAMESPACES} id="Definitions_${processId}" targetNamespace="urn:orbitpm:${processId}">`,
    processFragment(processId, processId, options),
    '</bpmn:definitions>'
  ].join('')
}

function diagram(processId: string, suffix: string): string {
  return [
    `<bpmndi:BPMNDiagram id="Diagram_${suffix}">`,
    `<bpmndi:BPMNPlane id="Plane_${suffix}" bpmnElement="${processId}">`,
    `<bpmndi:BPMNShape id="Shape_Start_${suffix}" bpmnElement="Start_${suffix}"><dc:Bounds x="100" y="100" width="36" height="36" /></bpmndi:BPMNShape>`,
    `<bpmndi:BPMNShape id="Shape_End_${suffix}" bpmnElement="End_${suffix}"><dc:Bounds x="300" y="100" width="36" height="36" /></bpmndi:BPMNShape>`,
    `<bpmndi:BPMNEdge id="Edge_${suffix}" bpmnElement="Flow_${suffix}"><di:waypoint x="136" y="118" /><di:waypoint x="300" y="118" /></bpmndi:BPMNEdge>`,
    '</bpmndi:BPMNPlane>',
    '</bpmndi:BPMNDiagram>'
  ].join('')
}

function collaborationMultiProcessXml(processId: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<bpmn:definitions ${BPMN_NAMESPACES} id="Definitions_collaboration" targetNamespace="urn:orbitpm:collaboration">`,
    processFragment(processId, 'Target', { name: 'Target process' }),
    processFragment('Stable_Process', 'Stable', { name: 'Stable process' }),
    '<bpmn:collaboration id="Collaboration_Main">',
    `<bpmn:participant id="Participant_Target" processRef="${processId}" />`,
    '<bpmn:participant id="Participant_Stable" processRef="Stable_Process" />',
    '</bpmn:collaboration>',
    diagram(processId, 'Target'),
    diagram('Stable_Process', 'Stable'),
    '</bpmn:definitions>'
  ].join('')
}

function idAttributes(value: string): string[] {
  return [...value.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map((match) => match[1])
}

function file(relPath: string, value: string, modified = 1): LiveWorkspaceFile {
  return {
    relPath,
    xml: value,
    lastModified: modified,
    size: new TextEncoder().encode(value).byteLength
  }
}

describe('LiveWorkspaceIndex', () => {
  it('overlays dirty XML for every downstream workspace consumer', () => {
    const index = new LiveWorkspaceIndex([
      file('sales/order.bpmn', xml('Order', { name: 'Old order' })),
      file('shared/risk.bpmn', xml('Risk'))
    ])

    index.updateDirty(
      'sales/order.bpmn',
      xml('Order_v2', {
        name: 'Live order',
        calledElement: 'Risk',
        owner: 'Operations'
      })
    )

    expect(index.files().find((item) => item.relPath === 'sales/order.bpmn')?.xml).toContain(
      'Live order'
    )
    expect(index.processIndex().has('Order')).toBe(false)
    expect(index.processIndex().get('Order_v2')).toMatchObject({
      relPath: 'sales/order.bpmn',
      processName: 'Live order'
    })
    expect(
      index.searchDocuments().find((item) => item.relPath === 'sales/order.bpmn')
    ).toMatchObject({
      namesText: 'live order',
      idsText: 'order_v2'
    })
  })

  it('updates only the changed file while preserving dirty overlays across refreshes', () => {
    const index = new LiveWorkspaceIndex([file('a.bpmn', xml('A')), file('b.bpmn', xml('B'))])
    index.updateDirty('a.bpmn', xml('A_live'))
    const before = index.searchDocuments().find((item) => item.relPath === 'a.bpmn')

    index.updateSaved(file('b.bpmn', xml('B_saved'), 2))
    expect(index.processIndex().has('A_live')).toBe(true)
    expect(index.searchDocuments().find((item) => item.relPath === 'a.bpmn')).toBe(before)

    index.replaceSavedFiles([
      file('a.bpmn', xml('A_external'), 3),
      file('b.bpmn', xml('B_saved'), 2)
    ])
    expect(index.processIndex().has('A_live')).toBe(true)
    index.clearDirty('a.bpmn')
    expect(index.processIndex().has('A_external')).toBe(true)

    index.updateDirty('b.bpmn', xml('B_live'))
    index.replaceSavedFiles([])
    expect(index.files().map((item) => item.relPath)).toEqual(['b.bpmn'])
    expect(index.processIndex().has('B_live')).toBe(true)
  })

  it('keeps an unsaved dirty file visible if its saved file disappears', () => {
    const index = new LiveWorkspaceIndex([file('draft.bpmn', xml('Draft'))])
    index.updateDirty('draft.bpmn', xml('Draft_live'))
    index.removeSaved('draft.bpmn')

    expect(index.files()).toHaveLength(1)
    expect(index.processIndex().has('Draft_live')).toBe(true)
    index.clearDirty('draft.bpmn')
    expect(index.files()).toEqual([])
  })

  it('moves indexed state atomically and rejects occupied destinations', () => {
    const index = new LiveWorkspaceIndex([
      file('one/a.bpmn', xml('A')),
      file('two/b.bpmn', xml('B'))
    ])
    index.updateDirty('one/a.bpmn', xml('A_live'))
    index.move('one/a.bpmn', 'archive/a.bpmn')

    expect(index.files().map((item) => item.relPath)).toEqual(['archive/a.bpmn', 'two/b.bpmn'])
    expect(index.processIndex().get('A_live')?.relPath).toBe('archive/a.bpmn')
    expect(() => index.move('archive/a.bpmn', 'two/b.bpmn')).toThrow(/already exists/)
  })

  it('excludes ambiguous ids, diagnoses every path, and repairs one occurrence', async () => {
    const index = new LiveWorkspaceIndex([
      file('a.bpmn', xml('Shared', { name: 'First' })),
      file('b.bpmn', xml('Shared', { name: 'Second' })),
      file('c.bpmn', xml('Shared', { name: 'Third' }))
    ])

    expect(index.processIndex().has('Shared')).toBe(false)
    expect(index.duplicateDiagnostics()).toEqual([
      {
        processId: 'Shared',
        paths: ['a.bpmn', 'b.bpmn', 'c.bpmn'],
        occurrences: [
          {
            processId: 'Shared',
            processName: 'First',
            relPath: 'a.bpmn',
            occurrence: 0
          },
          {
            processId: 'Shared',
            processName: 'Second',
            relPath: 'b.bpmn',
            occurrence: 0
          },
          {
            processId: 'Shared',
            processName: 'Third',
            relPath: 'c.bpmn',
            occurrence: 0
          }
        ]
      }
    ])

    const repaired = await index.repairDuplicateProcessId('c.bpmn', 'Shared', {
      processId: 'Shared_Third'
    })
    expect(repaired.xml).toContain('id="Shared_Third"')
    expect(index.processIndex().get('Shared_Third')?.relPath).toBe('c.bpmn')
    expect(index.duplicateDiagnostics()[0].occurrences).toHaveLength(2)
  })

  it('prepares without mutation and rejects a target changed during asynchronous validation', async () => {
    const original = xml('Shared', { name: 'Original target' })
    const changed = xml('Shared', { name: 'Edited while validation was pending' })
    const index = new LiveWorkspaceIndex([
      file('a.bpmn', xml('Shared', { name: 'Other declaration' })),
      file('target.bpmn', original)
    ])
    const initialVersion = index.version

    const prepared = await index.prepareDuplicateProcessIdRepair('target.bpmn', 'Shared', {
      processId: 'Shared_Prepared'
    })

    expect(index.version).toBe(initialVersion)
    expect(index.files().find((item) => item.relPath === 'target.bpmn')?.xml).toBe(original)
    expect(prepared.target).toMatchObject({
      relPath: 'target.bpmn',
      effectiveXml: original,
      dirtyXml: null,
      saved: file('target.bpmn', original)
    })

    index.updateDirty('target.bpmn', changed)
    expect(() => index.commitDuplicateProcessIdRepair(prepared)).toThrow(
      /changed after duplicate process-id repair preparation/
    )
    expect(index.files().find((item) => item.relPath === 'target.bpmn')?.xml).toBe(changed)

    index.clearDirty('target.bpmn')
    const pending = index.repairDuplicateProcessId('target.bpmn', 'Shared', {
      processId: 'Shared_Async'
    })
    index.updateDirty('target.bpmn', changed)

    await expect(pending).rejects.toThrow(/changed after duplicate process-id repair preparation/)
    expect(index.files().find((item) => item.relPath === 'target.bpmn')?.xml).toBe(changed)
    expect(index.processIndex().has('Shared_Async')).toBe(false)

    index.clearDirty('target.bpmn')
    const refreshPrepared = await index.prepareDuplicateProcessIdRepair('target.bpmn', 'Shared', {
      processId: 'Shared_After_Refresh'
    })
    index.replaceSavedFiles([
      file('a.bpmn', xml('Shared', { name: 'Other declaration' })),
      file('target.bpmn', original)
    ])
    expect(() => index.commitDuplicateProcessIdRepair(refreshPrepared)).toThrow(
      /changed after duplicate process-id repair preparation/
    )
  })

  it('allows only one of two concurrent repairs to claim the same process id', async () => {
    const sharedTarget = xml('Shared', { name: 'Shared target' })
    const otherTarget = xml('Other', { name: 'Other target' })
    const index = new LiveWorkspaceIndex([
      file('shared-a.bpmn', xml('Shared', { name: 'Shared declaration' })),
      file('shared-target.bpmn', sharedTarget),
      file('other-a.bpmn', xml('Other', { name: 'Other declaration' })),
      file('other-target.bpmn', otherTarget)
    ])
    const initialVersion = index.version

    const results = await Promise.allSettled([
      index.repairDuplicateProcessId('shared-target.bpmn', 'Shared', {
        processId: 'Concurrent_Repair'
      }),
      index.repairDuplicateProcessId('other-target.bpmn', 'Other', {
        processId: 'Concurrent_Repair'
      })
    ])
    const fulfilled = results.filter(
      (
        result
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof index.repairDuplicateProcessId>>
      > => result.status === 'fulfilled'
    )
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBeInstanceOf(Error)
    expect((rejected[0].reason as Error).message).toMatch(/already exists/)
    expect(index.version).toBe(initialVersion + 1)

    const winner = fulfilled[0].value
    const loserPath =
      winner.relPath === 'shared-target.bpmn' ? 'other-target.bpmn' : 'shared-target.bpmn'
    const loserSource = loserPath === 'shared-target.bpmn' ? sharedTarget : otherTarget
    expect(index.processIndex().get('Concurrent_Repair')?.relPath).toBe(winner.relPath)
    expect(index.files().find((item) => item.relPath === winner.relPath)?.xml).toBe(winner.xml)
    expect(index.files().find((item) => item.relPath === loserPath)?.xml).toBe(loserSource)
  })

  it('prevents a concurrent loser from overwriting a repair already committed to its target', async () => {
    const targetSource = xml('Shared', { name: 'Target' })
    const index = new LiveWorkspaceIndex([
      file('declaration.bpmn', xml('Shared', { name: 'Declaration' })),
      file('target.bpmn', targetSource)
    ])
    const initialVersion = index.version

    const results = await Promise.allSettled([
      index.repairDuplicateProcessId('target.bpmn', 'Shared', {
        processId: 'Shared_First'
      }),
      index.repairDuplicateProcessId('target.bpmn', 'Shared', {
        processId: 'Shared_Second'
      })
    ])
    const winner = results.find(
      (
        result
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof index.repairDuplicateProcessId>>
      > => result.status === 'fulfilled'
    )
    const loser = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )

    expect(winner).toBeDefined()
    expect(loser).toBeDefined()
    expect((loser?.reason as Error).message).toMatch(
      /changed after duplicate process-id repair preparation/
    )
    expect(index.version).toBe(initialVersion + 1)
    expect(index.files().find((item) => item.relPath === 'target.bpmn')?.xml).toBe(
      winner?.value.xml
    )
    expect(index.processIndex().get(winner?.value.processId ?? '')?.relPath).toBe('target.bpmn')
  })

  it('repairs collaboration and DI references without changing unrelated ids', async () => {
    const source = collaborationMultiProcessXml('Shared_Process')
    const index = new LiveWorkspaceIndex([
      file('target.bpmn', source),
      file('duplicate.bpmn', xml('Shared_Process'))
    ])

    expect((await validateBpmnXml(source, { requireDi: true })).summary.valid).toBe(true)
    const repaired = await index.repairDuplicateProcessId('target.bpmn', 'Shared_Process', {
      processId: 'Shared_Process_Repaired'
    })

    expect(repaired.xml).toContain(
      '<bpmn:participant id="Participant_Target" processRef="Shared_Process_Repaired"'
    )
    expect(repaired.xml).toContain(
      '<bpmndi:BPMNPlane id="Plane_Target" bpmnElement="Shared_Process_Repaired"'
    )
    expect(repaired.xml).toContain(
      '<bpmn:participant id="Participant_Stable" processRef="Stable_Process"'
    )
    expect(repaired.xml).toContain(
      '<bpmndi:BPMNPlane id="Plane_Stable" bpmnElement="Stable_Process"'
    )
    expect(repaired.xml).not.toMatch(/(?:processRef|bpmnElement)="Shared_Process"/)

    const expectedIds = idAttributes(source)
      .map((id) => (id === 'Shared_Process' ? 'Shared_Process_Repaired' : id))
      .sort()
    expect(idAttributes(repaired.xml).sort()).toEqual(expectedIds)

    const post = await validateBpmnXml(repaired.xml, { requireDi: true })
    expect(post.summary.valid).toBe(true)
    expect(post.summary.issues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'moddle.unresolved-reference' })])
    )
  })

  it('rejects ambiguous same-file and malformed targets without changing the index', async () => {
    const ambiguous = xml('Shared').replace(
      '</bpmn:definitions>',
      `${processFragment('Shared', 'Second')}</bpmn:definitions>`
    )
    const ambiguousIndex = new LiveWorkspaceIndex([
      file('ambiguous.bpmn', ambiguous),
      file('other.bpmn', xml('Shared'))
    ])
    const ambiguousVersion = ambiguousIndex.version
    await expect(
      ambiguousIndex.repairDuplicateProcessId('ambiguous.bpmn', 'Shared', {
        occurrence: 1,
        processId: 'Shared_Second'
      })
    ).rejects.toThrow(/ambiguous/)
    expect(ambiguousIndex.version).toBe(ambiguousVersion)
    expect(ambiguousIndex.files().find((item) => item.relPath === 'ambiguous.bpmn')?.xml).toBe(
      ambiguous
    )

    const malformed = xml('Broken').replace('</bpmn:process>', '')
    const malformedIndex = new LiveWorkspaceIndex([
      file('malformed.bpmn', malformed),
      file('valid.bpmn', xml('Broken'))
    ])
    const malformedVersion = malformedIndex.version
    await expect(
      malformedIndex.repairDuplicateProcessId('malformed.bpmn', 'Broken', {
        processId: 'Broken_Repaired'
      })
    ).rejects.toThrow(/secure BPMN validation/)
    expect(malformedIndex.version).toBe(malformedVersion)
    expect(malformedIndex.files().find((item) => item.relPath === 'malformed.bpmn')?.xml).toBe(
      malformed
    )
  })

  it('allocates valid globally unique fallback ids and rejects unsafe repairs', async () => {
    const index = new LiveWorkspaceIndex([
      file('a.bpmn', xml('Process')),
      file('b.bpmn', xml('Process_2')),
      file('c.bpmn', xml('Duplicate')),
      file('d.bpmn', xml('Duplicate'))
    ])
    expect(index.allocateProcessId('Process')).toBe('Process_3')
    expect(index.allocateProcessId('123 invalid')).toBe('_invalid')
    expect(uniqueFallbackProcessId(['Process', 'Process_2'])).toBe('Process_3')
    await expect(
      index.repairDuplicateProcessId('d.bpmn', 'Duplicate', {
        processId: 'not valid'
      })
    ).rejects.toThrow(/XML NCName/)
    await expect(
      index.repairDuplicateProcessId('d.bpmn', 'Duplicate', {
        processId: 'Process'
      })
    ).rejects.toThrow(/already exists/)
    await expect(index.repairDuplicateProcessId('d.bpmn', 'missing')).rejects.toThrow(
      /not duplicated/
    )
  })

  it('meets the 1,000-file initial and one-percent incremental performance gates', () => {
    const files = Array.from({ length: 1_000 }, (_, index) =>
      file(
        `area-${index % 20}/process-${index}.bpmn`,
        xml(`Process_${index}`, { name: `Process ${index}` })
      )
    )
    const buildStarted = performance.now()
    const index = new LiveWorkspaceIndex(files)
    const buildElapsed = performance.now() - buildStarted

    const refreshStarted = performance.now()
    for (let offset = 0; offset < 10; offset += 1) {
      index.updateDirty(
        files[offset].relPath,
        xml(`Process_${offset}_live`, { name: `Live ${offset}` })
      )
    }
    const refreshElapsed = performance.now() - refreshStarted

    expect(index.files()).toHaveLength(1_000)
    expect(index.processIndex()).toHaveLength(1_000)
    expect(buildElapsed).toBeLessThan(5_000)
    expect(refreshElapsed).toBeLessThan(1_000)
  })
})

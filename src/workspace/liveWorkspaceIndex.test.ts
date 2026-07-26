import { describe, expect, it } from 'vitest'
import {
  LiveWorkspaceIndex,
  uniqueFallbackProcessId,
  type LiveWorkspaceFile
} from './liveWorkspaceIndex'

function xml(
  processId: string,
  options: { name?: string; calledElement?: string; owner?: string } = {}
): string {
  const call = options.calledElement
    ? `<bpmn:callActivity id="Call_${processId}" calledElement="${options.calledElement}" />`
    : ''
  const owner = options.owner ? ` orbitpm:owner="${options.owner}"` : ''
  return [
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"',
    ' xmlns:orbitpm="https://orbitpm.example/schema">',
    `<bpmn:process id="${processId}" name="${options.name ?? processId}"${owner}>`,
    call,
    '</bpmn:process>',
    '</bpmn:definitions>'
  ].join('')
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

  it('excludes ambiguous ids, diagnoses every path, and repairs one occurrence', () => {
    const index = new LiveWorkspaceIndex([
      file('a.bpmn', xml('Shared', { name: 'First' })),
      file(
        'b.bpmn',
        xml('Shared', { name: 'Second' }).replace(
          '</bpmn:definitions>',
          '<bpmn:process id="Shared" name="Third" /></bpmn:definitions>'
        )
      )
    ])

    expect(index.processIndex().has('Shared')).toBe(false)
    expect(index.duplicateDiagnostics()).toEqual([
      {
        processId: 'Shared',
        paths: ['a.bpmn', 'b.bpmn'],
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
            relPath: 'b.bpmn',
            occurrence: 1
          }
        ]
      }
    ])

    const repaired = index.repairDuplicateProcessId('b.bpmn', 'Shared', {
      occurrence: 1,
      processId: 'Shared_Third'
    })
    expect(repaired.xml).toContain('id="Shared_Third"')
    expect(index.processIndex().get('Shared_Third')?.relPath).toBe('b.bpmn')
    expect(index.duplicateDiagnostics()[0].occurrences).toHaveLength(2)
  })

  it('allocates valid globally unique fallback ids and rejects unsafe repairs', () => {
    const index = new LiveWorkspaceIndex([
      file('a.bpmn', xml('Process')),
      file('b.bpmn', xml('Process_2')),
      file('c.bpmn', xml('Duplicate')),
      file('d.bpmn', xml('Duplicate'))
    ])
    expect(index.allocateProcessId('Process')).toBe('Process_3')
    expect(index.allocateProcessId('123 invalid')).toBe('_invalid')
    expect(uniqueFallbackProcessId(['Process', 'Process_2'])).toBe('Process_3')
    expect(() =>
      index.repairDuplicateProcessId('d.bpmn', 'Duplicate', {
        processId: 'not valid'
      })
    ).toThrow(/XML NCName/)
    expect(() =>
      index.repairDuplicateProcessId('d.bpmn', 'Duplicate', {
        processId: 'Process'
      })
    ).toThrow(/already exists/)
    expect(() => index.repairDuplicateProcessId('d.bpmn', 'missing')).toThrow(/not duplicated/)
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

import { describe, it, expect } from 'vitest'
import {
  deriveProcessId,
  humanizeProcessId,
  buildNewProcessDoc,
  buildMissingProcessDoc,
  deriveFileBaseName
} from '../editor/newProcessDoc'
import {
  buildProcessIndex,
  listUnresolvedCalledElements,
  parseProcessesFromXml
} from '@app/shared/processIndex'
import { createBpmnFileAt, listBpmnFiles } from '../fs/fsAccess'

// --- reuse the in-memory FS mock shape from fsAccess.test.ts (minimal copy) ---
class MockFileHandle {
  kind = 'file' as const
  constructor(
    public name: string,
    public content = ''
  ) {}
  async getFile(): Promise<{ text: () => Promise<string> }> {
    return { text: async () => this.content }
  }
  async createWritable(): Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> {
    let buf = ''
    return {
      write: async (data: string) => {
        buf += data
      },
      close: async () => {
        this.content = buf
      }
    }
  }
}
class MockDirectoryHandle {
  kind = 'directory' as const
  entriesMap = new Map<string, MockDirectoryHandle | MockFileHandle>()
  constructor(public name: string) {}
  async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<MockDirectoryHandle> {
    const existing = this.entriesMap.get(name)
    if (existing) {
      if (existing.kind !== 'directory') throw new Error(`${name} is a file`)
      return existing
    }
    if (!options.create) {
      const e = new Error(`NotFound: ${name}`)
      e.name = 'NotFoundError'
      throw e
    }
    const dir = new MockDirectoryHandle(name)
    this.entriesMap.set(name, dir)
    return dir
  }
  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<MockFileHandle> {
    const existing = this.entriesMap.get(name)
    if (existing) {
      if (existing.kind !== 'file') throw new Error(`${name} is a directory`)
      return existing
    }
    if (!options.create) {
      const e = new Error(`NotFound: ${name}`)
      e.name = 'NotFoundError'
      throw e
    }
    const file = new MockFileHandle(name)
    this.entriesMap.set(name, file)
    return file
  }
  async *entries(): AsyncIterableIterator<[string, MockDirectoryHandle | MockFileHandle]> {
    for (const [name, handle] of this.entriesMap) yield [name, handle]
  }
}
function newRoot(name = 'workspace'): FileSystemDirectoryHandle {
  return new MockDirectoryHandle(name) as unknown as FileSystemDirectoryHandle
}

describe('deriveProcessId', () => {
  it('prefixes and underscores a slug into a BPMN-legal id', () => {
    expect(deriveProcessId('order-refund')).toBe('Process_order_refund')
    expect(deriveProcessId('order')).toBe('Process_order')
    expect(deriveProcessId('order-2')).toBe('Process_order_2')
  })
  it('falls back to a valid id for an empty/garbage slug', () => {
    expect(deriveProcessId('')).toBe('Process_process')
    expect(deriveProcessId('***')).toBe('Process_process')
  })
})

describe('humanizeProcessId', () => {
  it('turns a Process_* id back into a title-cased name', () => {
    expect(humanizeProcessId('Process_customer_onboarding')).toBe('Customer Onboarding')
    expect(humanizeProcessId('Process_order')).toBe('Order')
    expect(humanizeProcessId('sub-flow')).toBe('Sub Flow')
  })
  it('returns the id itself when nothing is left to humanize', () => {
    expect(humanizeProcessId('Process_')).toBe('Process_')
  })
})

describe('buildNewProcessDoc (New process flow — used by BOTH modes)', () => {
  it('derives slug, stable process id and name from the entered name', () => {
    const doc = buildNewProcessDoc('Order Refund')
    expect(doc.fileBaseName).toBe('order-refund')
    expect(doc.processId).toBe('Process_order_refund')
    expect(doc.name).toBe('Order Refund')
    expect(doc.xml).toContain('id="Process_order_refund"')
    expect(doc.xml).toContain('name="Order Refund"')
    expect(doc.xml).toContain('<bpmn2:startEvent')
    expect(doc.xml).toContain('<bpmndi:BPMNPlane')
  })

  it('honours a de-duplicated slug override so the id tracks the file name', () => {
    const doc = buildNewProcessDoc('Order', 'order-2')
    expect(doc.fileBaseName).toBe('order-2')
    expect(doc.processId).toBe('Process_order_2')
    expect(doc.xml).toContain('bpmnElement="Process_order_2"')
  })

  it('escapes XML-special characters in the display name', () => {
    const doc = buildNewProcessDoc('A & B <ok>')
    expect(doc.xml).toContain('name="A &amp; B &lt;ok&gt;"')
    // and the name still round-trips out of the index (entities decoded).
    const [entry] = parseProcessesFromXml(doc.xml, 'x.bpmn')
    expect(entry.processName).toBe('A & B <ok>')
  })

  it('produces a file whose id is discoverable by the workspace process index', async () => {
    const root = newRoot()
    const doc = buildNewProcessDoc('Customer Onboarding')
    const rel = await createBpmnFileAt(root, '', doc.fileBaseName, doc.xml)
    expect(rel).toBe('customer-onboarding.bpmn')
    const index = buildProcessIndex(await listBpmnFiles(root))
    expect(index.has('Process_customer_onboarding')).toBe(true)
    expect(index.get('Process_customer_onboarding')?.relPath).toBe('customer-onboarding.bpmn')
  })
})

describe('deriveFileBaseName (Arabic / non-Latin name handling)', () => {
  it('defers to the existing ASCII slug behavior for a Latin name (byte-identical, no regression)', () => {
    expect(deriveFileBaseName('Order Refund')).toBe('order-refund')
    expect(deriveFileBaseName('  Customer Onboarding  ')).toBe('customer-onboarding')
  })

  it('preserves an Arabic name verbatim in the file base name (dashed for spaces)', () => {
    expect(deriveFileBaseName('طلب العميل')).toBe('طلب-العميل')
    expect(deriveFileBaseName('استقبال الموظف الجديد')).toBe('استقبال-الموظف-الجديد')
  })

  it('strips Windows-illegal characters from an Arabic name but keeps the script', () => {
    expect(deriveFileBaseName('طلب<>: "شراء"')).toBe('طلب-شراء')
  })

  it('falls back to the generic slug when an Arabic (or any) name is empty/whitespace', () => {
    expect(deriveFileBaseName('   ')).toBe('process')
    expect(deriveFileBaseName('')).toBe('process')
  })
})

describe('buildNewProcessDoc with an Arabic display name', () => {
  it('keeps the Arabic name as-is, derives an Arabic file name, but falls back the <process id> to a stable ASCII form', () => {
    const doc = buildNewProcessDoc('طلب العميل')
    expect(doc.name).toBe('طلب العميل')
    expect(doc.fileBaseName).toBe('طلب-العميل')
    // deriveProcessId() strips every non [A-Za-z0-9_] character; an
    // all-Arabic slug reduces to nothing, so it falls back to "process" —
    // still a valid, stable BPMN NCName, just not derived from the Arabic text.
    expect(doc.processId).toBe('Process_process')
    expect(doc.xml).toContain('id="Process_process"')
    expect(doc.xml).toContain('name="طلب العميل"')
  })

  it('a de-duplicated Arabic slug override still keeps the Arabic file name and yields a distinct, stable id', () => {
    // Mirrors how App.tsx dedupes: dedupeSlug(deriveFileBaseName(name), isTaken)
    // yields "طلب-العميل-2" on a second Arabic process with the same name.
    const doc = buildNewProcessDoc('طلب العميل', 'طلب-العميل-2')
    expect(doc.fileBaseName).toBe('طلب-العميل-2')
    // deriveProcessId() strips the Arabic characters but keeps the ASCII
    // dashes-turned-underscores around them, so the trailing "-2" counter
    // survives as a distinct (if not cosmetically clean) id — still a valid
    // XML NCName, and critically still DIFFERENT from the first process's
    // "Process_process", so the two files never collide on id.
    expect(doc.processId).toBe('Process___2')
    expect(doc.processId).not.toBe('Process_process')
  })
})

describe('Arabic file names through fsAccess (mock handles)', () => {
  it('creates, lists and re-reads a .bpmn file whose name is Arabic', async () => {
    const root = newRoot()
    const doc = buildNewProcessDoc('طلب العميل')
    const rel = await createBpmnFileAt(root, '', doc.fileBaseName, doc.xml)
    expect(rel).toBe('طلب-العميل.bpmn')

    // The mock directory handle's entriesMap key IS the Arabic file name —
    // proves the FS-adapter layer never transliterates or drops the script.
    const files = await listBpmnFiles(root)
    expect(files.map((f) => f.relPath)).toEqual(['طلب-العميل.bpmn'])

    const index = buildProcessIndex(files)
    expect(index.has('Process_process')).toBe(true)
    expect(index.get('Process_process')?.relPath).toBe('طلب-العميل.bpmn')
    expect(index.get('Process_process')?.processName).toBe('طلب العميل')
  })

  it('nests an Arabic-named process inside an Arabic-named folder', async () => {
    const root = newRoot()
    const doc = buildNewProcessDoc('استقبال الموظف')
    const rel = await createBpmnFileAt(root, 'الموارد-البشرية', doc.fileBaseName, doc.xml)
    expect(rel).toBe('الموارد-البشرية/استقبال-الموظف.bpmn')
    const files = await listBpmnFiles(root)
    expect(files.map((f) => f.relPath)).toEqual(['الموارد-البشرية/استقبال-الموظف.bpmn'])
  })
})

describe('buildMissingProcessDoc with an Arabic display name', () => {
  it('keeps the Arabic display name + file name, while the id stays fixed to the (ASCII) calledElement', () => {
    const doc = buildMissingProcessDoc('Process_billing', 'الفوترة')
    expect(doc.name).toBe('الفوترة')
    expect(doc.fileBaseName).toBe('الفوترة')
    expect(doc.processId).toBe('Process_billing')
    expect(doc.xml).toContain('name="الفوترة"')
    expect(doc.xml).toContain('id="Process_billing"')
  })
})

describe('buildMissingProcessDoc (create a process to resolve a dangling link)', () => {
  it('fixes the process id to the calledElement verbatim so the link resolves', () => {
    const doc = buildMissingProcessDoc('Process_offboarding')
    expect(doc.processId).toBe('Process_offboarding')
    expect(doc.name).toBe('Offboarding') // humanized default
    expect(doc.fileBaseName).toBe('offboarding')
    expect(doc.xml).toContain('id="Process_offboarding"')
  })

  it('keeps the id even when the display name (and file name) differ', () => {
    const doc = buildMissingProcessDoc('Process_offboarding', 'Leaver Journey', 'leaver-journey')
    expect(doc.processId).toBe('Process_offboarding')
    expect(doc.name).toBe('Leaver Journey')
    expect(doc.fileBaseName).toBe('leaver-journey')
    expect(doc.xml).toContain('id="Process_offboarding"')
    expect(doc.xml).toContain('name="Leaver Journey"')
  })

  it('end-to-end: an unresolved calledElement becomes resolved after creating the target', async () => {
    const root = newRoot()
    // Process A links to a not-yet-existing "Process_billing".
    const aXml = `<?xml version="1.0"?>
<bpmn2:definitions xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn2:process id="Process_a" name="A">
    <bpmn2:callActivity id="Call_1" calledElement="Process_billing" />
  </bpmn2:process>
</bpmn2:definitions>`
    await createBpmnFileAt(root, '', 'a', aXml)

    let index = buildProcessIndex(await listBpmnFiles(root))
    expect(listUnresolvedCalledElements(aXml, index).map((u) => u.calledElement)).toEqual([
      'Process_billing'
    ])

    // Now create the missing process from that calledElement.
    const doc = buildMissingProcessDoc('Process_billing', 'Billing')
    await createBpmnFileAt(root, '', doc.fileBaseName, doc.xml)

    index = buildProcessIndex(await listBpmnFiles(root))
    expect(index.has('Process_billing')).toBe(true)
    expect(listUnresolvedCalledElements(aXml, index)).toEqual([])
  })
})

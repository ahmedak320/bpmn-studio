import { describe, expect, it } from 'vitest'

import { MAPPING_PRESET_VERSION, type MappingDraft } from './contracts'
import { BrowserMappingDraftStore } from './browserDraftStore'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length(): number {
    return this.values.size
  }
  clear(): void {
    this.values.clear()
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }
  removeItem(key: string): void {
    this.values.delete(key)
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('browser spreadsheet draft store', () => {
  it('round-trips only the allowlisted mapping and destination choices', async () => {
    const storage = new MemoryStorage()
    const store = new BrowserMappingDraftStore(storage)
    const preset = {
      version: MAPPING_PRESET_VERSION,
      name: 'Ordinary workbook',
      headerSignatures: {},
      selectedSheets: {
        steps: { worksheet: 'Sheet1', headerRow: 1 }
      },
      fieldMappings: {
        steps: {
          process_id: 'Process ID',
          type: 'Type',
          name_en: 'Name EN',
          name_ar: 'Name AR'
        }
      },
      valueMappings: { stepTypes: {}, participantTypes: {} },
      delimiters: { list: [';', '|'] },
      inference: {
        flowMode: 'auto' as const,
        syntheticBoundaries: 'review' as const,
        requireGatewayConditions: true as const
      },
      locale: 'en' as const
    }
    const draft: MappingDraft = {
      ...preset,
      draftKey: 'workspace\u001fbook.xlsx',
      updatedAt: '2026-07-26T00:00:00.000Z',
      destinationFolder: 'HR',
      collisionBehavior: 'rename'
    }
    await store.save(draft)
    await expect(store.load(draft.draftKey)).resolves.toEqual(draft)
    expect([
      ...Array.from({ length: storage.length }, (_, index) => storage.key(index))
    ]).toHaveLength(1)
    expect(storage.getItem(storage.key(0)!)!).not.toContain('credentials')
  })
})

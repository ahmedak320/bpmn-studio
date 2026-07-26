import type { CollisionBehavior, MappingDraft, MappingDraftStore, MappingPreset } from './contracts'
import { SpreadsheetError } from './errors'
import { parseMappingPresetJson, serializeMappingPreset } from './mappingPreset'

const STORAGE_PREFIX = 'orbitpm.spreadsheet.mapping-draft.v1.'

interface StoredDraft {
  readonly version: 1
  readonly draftKey: string
  readonly updatedAt: string
  readonly destinationFolder?: string
  readonly collisionBehavior?: CollisionBehavior
  readonly preset: MappingPreset
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

function storageKey(draftKey: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(draftKey).slice(0, 512)}`
}

function parseStoredDraft(json: string, expectedKey: string): MappingDraft {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (cause) {
    throw new SpreadsheetError('invalid-mapping-preset', { location: 'draft.json' }, { cause })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SpreadsheetError('invalid-mapping-preset', {
      location: 'draft.root'
    })
  }
  const draft = value as Partial<StoredDraft>
  if (
    draft.version !== 1 ||
    draft.draftKey !== expectedKey ||
    typeof draft.updatedAt !== 'string' ||
    !draft.preset
  ) {
    throw new SpreadsheetError('invalid-mapping-preset', {
      location: 'draft.contract'
    })
  }
  const preset = parseMappingPresetJson(JSON.stringify(draft.preset))
  const collision = draft.collisionBehavior
  if (
    collision !== undefined &&
    collision !== 'error' &&
    collision !== 'overwrite' &&
    collision !== 'rename'
  ) {
    throw new SpreadsheetError('invalid-mapping-preset', {
      location: 'draft.collisionBehavior'
    })
  }
  if (
    draft.destinationFolder !== undefined &&
    (typeof draft.destinationFolder !== 'string' || draft.destinationFolder.length > 1_024)
  ) {
    throw new SpreadsheetError('invalid-mapping-preset', {
      location: 'draft.destinationFolder'
    })
  }
  return Object.freeze({
    ...preset,
    draftKey: expectedKey,
    updatedAt: draft.updatedAt,
    ...(draft.destinationFolder !== undefined
      ? { destinationFolder: draft.destinationFolder }
      : {}),
    ...(collision ? { collisionBehavior: collision } : {})
  })
}

/**
 * Browser-private draft persistence. The serialized preset is round-tripped
 * through the strict allowlist, so worksheet rows and credentials cannot enter
 * this store even through a widened runtime object.
 */
export class BrowserMappingDraftStore implements MappingDraftStore {
  constructor(private readonly storage: Storage | undefined = safeStorage()) {}

  async load(draftKey: string): Promise<MappingDraft | undefined> {
    if (!this.storage) return undefined
    const raw = this.storage.getItem(storageKey(draftKey))
    if (!raw) return undefined
    try {
      return parseStoredDraft(raw, draftKey)
    } catch {
      this.storage.removeItem(storageKey(draftKey))
      return undefined
    }
  }

  async save(draft: MappingDraft): Promise<void> {
    if (!this.storage) return
    const presetOnly: MappingPreset = {
      version: draft.version,
      name: draft.name,
      headerSignatures: draft.headerSignatures,
      selectedSheets: draft.selectedSheets,
      fieldMappings: draft.fieldMappings,
      delimiters: draft.delimiters,
      inference: draft.inference,
      locale: draft.locale
    }
    const preset = parseMappingPresetJson(serializeMappingPreset(presetOnly))
    const stored: StoredDraft = {
      version: 1,
      draftKey: draft.draftKey,
      updatedAt: draft.updatedAt,
      ...(draft.destinationFolder !== undefined
        ? { destinationFolder: draft.destinationFolder }
        : {}),
      ...(draft.collisionBehavior ? { collisionBehavior: draft.collisionBehavior } : {}),
      preset
    }
    try {
      this.storage.setItem(storageKey(draft.draftKey), JSON.stringify(stored))
    } catch (cause) {
      throw new SpreadsheetError('invalid-mapping-preset', { location: 'draft.storage' }, { cause })
    }
  }

  async remove(draftKey: string): Promise<void> {
    this.storage?.removeItem(storageKey(draftKey))
  }
}

export function mappingDraftKey(workspaceId: string, fileName: string): string {
  return `${workspaceId}\u001f${fileName.normalize('NFKC').toLocaleLowerCase('en-US')}`
}

export async function readMappingPresetFile(file: Pick<File, 'text'>): Promise<MappingPreset> {
  return parseMappingPresetJson(await file.text())
}

export function downloadMappingPreset(
  preset: MappingPreset,
  fileName = 'orbitpm-mapping-preset.json'
): void {
  const blob = new Blob([serializeMappingPreset(preset)], {
    type: 'application/json'
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

import { CANONICAL_FIELDS_BY_SHEET } from './aliases'
import type { CollisionBehavior, MappingDraft, MappingDraftStore, MappingPreset } from './contracts'
import { SpreadsheetError } from './errors'
import { parseMappingPresetJson, serializeMappingPreset } from './mappingPreset'

const STORAGE_PREFIX = 'orbitpm.spreadsheet.mapping-draft.v1.'

interface StoredDraftV1 {
  readonly version: 1
  readonly draftKey: string
  readonly updatedAt: string
  readonly destinationFolder?: string
  readonly collisionBehavior?: CollisionBehavior
  readonly preset: MappingPreset
}

interface StoredDraftV2 {
  readonly version: 2
  readonly draftKey: string
  readonly updatedAt: string
  readonly destinationFolder?: string
  readonly collisionBehavior?: CollisionBehavior
  readonly confirmedMappings?: readonly string[]
  readonly defaultProcessId?: string
  readonly defaultNameEn?: string
  readonly defaultNameAr?: string
  readonly syntheticBoundaryConfirmed?: boolean
  readonly sourceIdentity?: string
  readonly preset: MappingPreset
}

type StoredDraft = StoredDraftV1 | StoredDraftV2
type StoredDraftCandidate = Partial<Omit<StoredDraftV2, 'version'>> & {
  readonly version?: 1 | 2
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
  const draft = value as StoredDraftCandidate
  if (
    (draft.version !== 1 && draft.version !== 2) ||
    draft.draftKey !== expectedKey ||
    typeof draft.updatedAt !== 'string' ||
    draft.updatedAt.length > 64 ||
    !Number.isFinite(Date.parse(draft.updatedAt)) ||
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
    (typeof draft.destinationFolder !== 'string' ||
      draft.destinationFolder.length > 1_024 ||
      /[\u0000-\u001f\u007f]/.test(draft.destinationFolder))
  ) {
    throw new SpreadsheetError('invalid-mapping-preset', {
      location: 'draft.destinationFolder'
    })
  }
  const optionalText = (
    field: 'defaultProcessId' | 'defaultNameEn' | 'defaultNameAr',
    maximum: number
  ): string | undefined => {
    const entry = draft[field]
    if (entry === undefined) return undefined
    if (
      draft.version !== 2 ||
      typeof entry !== 'string' ||
      entry.length > maximum ||
      /[\u0000-\u001f\u007f]/.test(entry)
    ) {
      throw new SpreadsheetError('invalid-mapping-preset', {
        location: `draft.${field}`
      })
    }
    return entry
  }
  const defaultProcessId = optionalText('defaultProcessId', 256)
  const defaultNameEn = optionalText('defaultNameEn', 512)
  const defaultNameAr = optionalText('defaultNameAr', 512)

  if (
    draft.version === 1 &&
    (draft.confirmedMappings !== undefined ||
      draft.syntheticBoundaryConfirmed !== undefined ||
      draft.sourceIdentity !== undefined)
  ) {
    throw new SpreadsheetError('invalid-mapping-preset', {
      location: 'draft.version'
    })
  }

  let confirmedMappings: readonly string[] | undefined
  if (draft.version === 2 && draft.confirmedMappings !== undefined) {
    if (!Array.isArray(draft.confirmedMappings) || draft.confirmedMappings.length > 256) {
      throw new SpreadsheetError('invalid-mapping-preset', {
        location: 'draft.confirmedMappings'
      })
    }
    const allowed = new Set(
      Object.entries(preset.fieldMappings).flatMap(([role, mappings]) =>
        Object.keys(mappings ?? {})
          .filter((field) =>
            CANONICAL_FIELDS_BY_SHEET[role as keyof typeof CANONICAL_FIELDS_BY_SHEET].includes(
              field as never
            )
          )
          .map((field) => `${role}.${field}`)
      )
    )
    const unique = new Set<string>()
    for (const key of draft.confirmedMappings) {
      if (typeof key !== 'string' || !allowed.has(key) || unique.has(key)) {
        throw new SpreadsheetError('invalid-mapping-preset', {
          location: 'draft.confirmedMappings'
        })
      }
      unique.add(key)
    }
    confirmedMappings = Object.freeze([...unique].sort())
  }

  if (
    draft.version === 2 &&
    draft.syntheticBoundaryConfirmed !== undefined &&
    typeof draft.syntheticBoundaryConfirmed !== 'boolean'
  ) {
    throw new SpreadsheetError('invalid-mapping-preset', {
      location: 'draft.syntheticBoundaryConfirmed'
    })
  }
  if (
    draft.version === 2 &&
    draft.sourceIdentity !== undefined &&
    (typeof draft.sourceIdentity !== 'string' ||
      !/^[0-9]{1,12}:[0-9]{1,16}$/.test(draft.sourceIdentity))
  ) {
    throw new SpreadsheetError('invalid-mapping-preset', {
      location: 'draft.sourceIdentity'
    })
  }
  return Object.freeze({
    ...preset,
    draftKey: expectedKey,
    updatedAt: draft.updatedAt,
    ...(draft.destinationFolder !== undefined
      ? { destinationFolder: draft.destinationFolder }
      : {}),
    ...(collision ? { collisionBehavior: collision } : {}),
    ...(confirmedMappings ? { confirmedMappings } : {}),
    ...(defaultProcessId !== undefined ? { defaultProcessId } : {}),
    ...(defaultNameEn !== undefined ? { defaultNameEn } : {}),
    ...(defaultNameAr !== undefined ? { defaultNameAr } : {}),
    ...(draft.version === 2 && draft.syntheticBoundaryConfirmed !== undefined
      ? { syntheticBoundaryConfirmed: draft.syntheticBoundaryConfirmed }
      : {}),
    ...(draft.version === 2 && draft.sourceIdentity !== undefined
      ? { sourceIdentity: draft.sourceIdentity }
      : {})
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
      valueMappings: draft.valueMappings,
      delimiters: draft.delimiters,
      inference: draft.inference,
      locale: draft.locale
    }
    const preset = parseMappingPresetJson(serializeMappingPreset(presetOnly))
    const stored: StoredDraft = {
      version: 2,
      draftKey: draft.draftKey,
      updatedAt: draft.updatedAt,
      ...(draft.destinationFolder !== undefined
        ? { destinationFolder: draft.destinationFolder }
        : {}),
      ...(draft.collisionBehavior ? { collisionBehavior: draft.collisionBehavior } : {}),
      ...(draft.confirmedMappings
        ? { confirmedMappings: Object.freeze([...draft.confirmedMappings]) }
        : {}),
      ...(draft.defaultProcessId !== undefined ? { defaultProcessId: draft.defaultProcessId } : {}),
      ...(draft.defaultNameEn !== undefined ? { defaultNameEn: draft.defaultNameEn } : {}),
      ...(draft.defaultNameAr !== undefined ? { defaultNameAr: draft.defaultNameAr } : {}),
      ...(draft.syntheticBoundaryConfirmed !== undefined
        ? { syntheticBoundaryConfirmed: draft.syntheticBoundaryConfirmed }
        : {}),
      ...(draft.sourceIdentity !== undefined ? { sourceIdentity: draft.sourceIdentity } : {}),
      preset
    }
    // Validate the full allowlist and all size/type bounds before persistence.
    parseStoredDraft(JSON.stringify(stored), draft.draftKey)
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

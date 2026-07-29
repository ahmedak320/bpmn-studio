import { ArisWriterError } from './errors'

/**
 * Source-style ARIS id allocation (plan section 9.2, "Allocate collision-checked source-style
 * IDs").
 *
 * The format below was derived by inspecting the real AnimalWF ARIS 10.0 AML export. Only the
 * shape is recorded here — no id from that private export appears in this repository.
 *
 * ARIS writes two id shapes:
 *
 * 1. Definition-scope ids — `Group`, `FontSS`, `ObjDef`, `CxnDef`, `OLEDef`, `FFTextDef`,
 *    `Model`:
 *
 *        <Kind>.<key>-<typeChar>-L
 *        e.g. ObjDef.<key>-p-L, Model.<key>-u-L, CxnDef.<key>-q-L
 *
 * 2. Occurrence-scope ids — `ObjOcc`, `CxnOcc`, `OLEOcc`, `Lane` — which embed the owning
 *    model's id body and append a numeric type code:
 *
 *        <Kind>.<modelKey>-u-L-<key>-<typeChar>-L-<typeCode>-c
 *        e.g. ObjOcc.<modelKey>-u-L-<key>-x-L-33-c
 *
 * `<key>` is an 11-character token over the alphabet `[-_0-9A-Za-z]` (it reads as a signed
 * base-64 number: a leading `-` is common, which is why raw ids in the export vary between 21
 * and 23 characters for a definition). The writer reproduces that alphabet and length exactly
 * so a derived export is indistinguishable in shape from an ARIS-authored one.
 *
 * `Group.Root` is the one fixed id in the format and is never allocated.
 */

export type ArisDefinitionIdKind =
  'Group' | 'FontSS' | 'ObjDef' | 'CxnDef' | 'OLEDef' | 'FFTextDef' | 'Model'

export type ArisOccurrenceIdKind = 'ObjOcc' | 'CxnOcc' | 'OLEOcc' | 'Lane'

export type ArisIdKind = ArisDefinitionIdKind | ArisOccurrenceIdKind

interface DefinitionIdFormat {
  readonly scope: 'definition'
  readonly typeChar: string
}

interface OccurrenceIdFormat {
  readonly scope: 'occurrence'
  readonly typeChar: string
  readonly typeCode: number
}

type ArisIdFormat = DefinitionIdFormat | OccurrenceIdFormat

/** Type discriminators observed in the AnimalWF export, one per record kind. */
export const ARIS_ID_FORMATS: Readonly<Record<ArisIdKind, ArisIdFormat>> = Object.freeze({
  FontSS: { scope: 'definition', typeChar: 'c' },
  Group: { scope: 'definition', typeChar: 'k' },
  ObjDef: { scope: 'definition', typeChar: 'p' },
  CxnDef: { scope: 'definition', typeChar: 'q' },
  OLEDef: { scope: 'definition', typeChar: 'r' },
  FFTextDef: { scope: 'definition', typeChar: 's' },
  Model: { scope: 'definition', typeChar: 'u' },
  ObjOcc: { scope: 'occurrence', typeChar: 'x', typeCode: 33 },
  CxnOcc: { scope: 'occurrence', typeChar: 'y', typeCode: 34 },
  OLEOcc: { scope: 'occurrence', typeChar: 'z', typeCode: 35 },
  Lane: { scope: 'occurrence', typeChar: 'E', typeCode: 40 }
})

/** The base-64-flavoured alphabet ARIS uses for id keys. */
export const ARIS_ID_KEY_ALPHABET =
  '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz'

export const ARIS_ID_KEY_LENGTH = 11

export const ARIS_ROOT_GROUP_ID = 'Group.Root'

const KEY_PATTERN = `[-_0-9A-Za-z]{1,16}`

export interface ParsedArisId {
  readonly kind: ArisIdKind
  readonly scope: 'definition' | 'occurrence'
  /** For occurrence ids, the `<key>-u-L` body of the owning model id. */
  readonly modelBody: string | null
  readonly key: string
}

const DEFINITION_ID_RE = new RegExp(`^([A-Za-z]+)\\.(${KEY_PATTERN})-([A-Za-z])-L$`)
const OCCURRENCE_ID_RE = new RegExp(
  `^([A-Za-z]+)\\.(${KEY_PATTERN}-[A-Za-z]-L)-(${KEY_PATTERN})-([A-Za-z])-L-([0-9]+)-c$`
)

function kindFor(prefix: string): ArisIdKind | null {
  return prefix in ARIS_ID_FORMATS ? (prefix as ArisIdKind) : null
}

/** Parse an ARIS id into its parts, or return `null` when it does not match the source format. */
export function parseArisId(id: string): ParsedArisId | null {
  const occurrence = OCCURRENCE_ID_RE.exec(id)
  if (occurrence) {
    const kind = kindFor(occurrence[1]!)
    if (kind === null) return null
    const format = ARIS_ID_FORMATS[kind]
    if (format.scope !== 'occurrence') return null
    if (occurrence[4] !== format.typeChar) return null
    if (Number(occurrence[5]) !== format.typeCode) return null
    return Object.freeze({
      kind,
      scope: 'occurrence' as const,
      modelBody: occurrence[2]!,
      key: occurrence[3]!
    })
  }
  const definition = DEFINITION_ID_RE.exec(id)
  if (definition) {
    const kind = kindFor(definition[1]!)
    if (kind === null) return null
    const format = ARIS_ID_FORMATS[kind]
    if (format.scope !== 'definition') return null
    if (definition[3] !== format.typeChar) return null
    return Object.freeze({
      kind,
      scope: 'definition' as const,
      modelBody: null,
      key: definition[2]!
    })
  }
  return null
}

export function formatDefinitionId(kind: ArisDefinitionIdKind, key: string): string {
  const format = ARIS_ID_FORMATS[kind]
  return `${kind}.${key}-${format.typeChar}-L`
}

/** The `<key>-u-L` body a model id contributes to the occurrence ids it owns. */
export function modelIdBody(modelId: string): string {
  const parsed = parseArisId(modelId)
  if (parsed === null || parsed.kind !== 'Model') {
    throw new ArisWriterError(
      'invalid-id',
      `"${modelId}" is not a source-style ARIS model id (expected Model.<key>-u-L).`,
      { detail: { modelId } }
    )
  }
  return modelId.slice('Model.'.length)
}

export function formatOccurrenceId(
  kind: ArisOccurrenceIdKind,
  modelId: string,
  key: string
): string {
  const format = ARIS_ID_FORMATS[kind]
  if (format.scope !== 'occurrence') {
    throw new ArisWriterError('invalid-id', `${kind} does not use an occurrence-scope id.`)
  }
  return `${kind}.${modelIdBody(modelId)}-${key}-${format.typeChar}-L-${format.typeCode}-c`
}

/** Deterministic-injectable randomness so allocation is reproducible under test. */
export type RandomSource = () => number

function defaultRandom(): number {
  const globalCrypto = globalThis.crypto
  if (globalCrypto && typeof globalCrypto.getRandomValues === 'function') {
    const buffer = new Uint32Array(1)
    globalCrypto.getRandomValues(buffer)
    return buffer[0]! / 0x1_0000_0000
  }
  return Math.random()
}

function generateKey(random: RandomSource): string {
  let key = ''
  for (let index = 0; index < ARIS_ID_KEY_LENGTH; index += 1) {
    const position = Math.floor(random() * ARIS_ID_KEY_ALPHABET.length)
    const clamped = Math.min(Math.max(position, 0), ARIS_ID_KEY_ALPHABET.length - 1)
    key += ARIS_ID_KEY_ALPHABET[clamped]
  }
  return key
}

const MAX_ALLOCATION_ATTEMPTS = 64

export interface ArisIdAllocatorOptions {
  /** Every id already present in the source document (and in any pending edit set). */
  readonly existingIds: Iterable<string>
  readonly random?: RandomSource
}

export interface ArisIdAllocator {
  /** Allocate a definition-scope id, reserving it against further allocations. */
  allocateDefinitionId(kind: ArisDefinitionIdKind): string
  /** Allocate an occurrence-scope id inside `modelId`, reserving it. */
  allocateOccurrenceId(kind: ArisOccurrenceIdKind, modelId: string): string
  /** Reserve an externally chosen id; throws when it is already taken. */
  reserve(id: string): string
  has(id: string): boolean
  /** Snapshot of every reserved id, for validation and accounting. */
  reservedIds(): readonly string[]
}

/**
 * Create a collision-checked allocator.
 *
 * Collision checking is exhaustive rather than probabilistic: every candidate is tested against
 * the full set of ids already in the document *and* every id this allocator has already handed
 * out in the same session, so two new records in one edit batch can never share an id.
 */
export function createArisIdAllocator(options: ArisIdAllocatorOptions): ArisIdAllocator {
  const taken = new Set<string>(options.existingIds)
  taken.add(ARIS_ROOT_GROUP_ID)
  const issued = new Set<string>()
  const random = options.random ?? defaultRandom

  const claim = (id: string): string => {
    taken.add(id)
    issued.add(id)
    return id
  }

  const allocate = (build: (key: string) => string, kind: ArisIdKind): string => {
    for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
      const candidate = build(generateKey(random))
      if (!taken.has(candidate)) return claim(candidate)
    }
    throw new ArisWriterError(
      'id-exhausted',
      `Could not allocate a free ${kind} id after ${MAX_ALLOCATION_ATTEMPTS} attempts.`,
      { detail: { kind, attempts: MAX_ALLOCATION_ATTEMPTS } }
    )
  }

  return {
    allocateDefinitionId(kind) {
      return allocate((key) => formatDefinitionId(kind, key), kind)
    },
    allocateOccurrenceId(kind, modelId) {
      return allocate((key) => formatOccurrenceId(kind, modelId, key), kind)
    },
    reserve(id) {
      if (taken.has(id)) {
        throw new ArisWriterError('invalid-id', `The id "${id}" is already taken.`, {
          detail: { id }
        })
      }
      return claim(id)
    },
    has(id) {
      return taken.has(id)
    },
    reservedIds() {
      return [...issued]
    }
  }
}

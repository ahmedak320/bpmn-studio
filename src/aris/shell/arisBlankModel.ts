import { attrDefSpec, renderRecord } from '../writer'
import { createArisIdAllocator, RandomSource } from '../writer/ids'
import { slugify, FALLBACK_SLUG } from '@/core/slug'

export type ArisBlankModelType = 'MT_EEPC' | 'MT_VAL_ADD_CHN_DGM'

export interface ArisBlankModelSpec {
  /** Human-readable model names; at least one language must be non-empty. */
  readonly names: { readonly en?: string; readonly ar?: string }
  readonly modelType: ArisBlankModelType
  /** Source-style model id; defaults to a freshly allocated Model.<key>-u-L. */
  readonly modelId?: string
  /** Model GUID; defaults to a random UUID. */
  readonly guid?: string
  /** Deterministic randomness for id allocation; ignored when modelId is supplied. */
  readonly random?: RandomSource
}

export interface ArisBlankModelResult {
  readonly xml: string
  readonly modelId: string
}

function defaultGuid(): string {
  const globalCrypto = globalThis.crypto
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID()
  }
  return ''
}

/**
 * Build a deterministic, minimal AML document containing exactly one empty,
 * named model. This is the substrate for the New-model flow.
 */
export function buildBlankArisAml(spec: ArisBlankModelSpec): ArisBlankModelResult {
  const nameValues: { localeId: string; text: string }[] = []
  if (spec.names.en && spec.names.en.trim() !== '') {
    nameValues.push({ localeId: '1033', text: spec.names.en })
  }
  if (spec.names.ar && spec.names.ar.trim() !== '') {
    nameValues.push({ localeId: '1025', text: spec.names.ar })
  }

  const allocator = createArisIdAllocator({ existingIds: [], random: spec.random })
  const modelId = spec.modelId ?? allocator.allocateDefinitionId('Model')
  const guid = spec.guid ?? defaultGuid()

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    renderRecord({
      name: 'AML',
      children: [
        {
          name: 'Header-Info',
          attributes: [
            { name: 'DatabaseName', value: 'OrbitPM' },
            { name: 'UserName', value: 'local-user' },
            { name: 'ArisExeVersion', value: '10' }
          ]
        },
        {
          name: 'Group',
          attributes: [{ name: 'Group.ID', value: 'Group.Root' }],
          children: [
            {
              name: 'Model',
              attributes: [
                { name: 'Model.ID', value: modelId },
                { name: 'Model.Type', value: spec.modelType }
              ],
              children: [
                { name: 'GUID', text: guid },
                attrDefSpec({ type: 'AT_NAME', values: nameValues })
              ]
            }
          ]
        }
      ]
    }),
    ''
  ].join('\n')

  return Object.freeze({ xml, modelId })
}

/** Windows-safe '<slug>.aml' file name from a human model name. */
export function deriveArisSourceFileName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return `${FALLBACK_SLUG}.aml`
  const hasNonAscii = /[^\x00-\x7F]/.test(trimmed)
  if (!hasNonAscii) {
    const slug = slugify(trimmed)
    return `${slug}.aml`
  }
  // Strip characters illegal in a Windows file name and control characters,
  // collapse whitespace to a single dash, trim stray dashes.
  const safe = trimmed
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${safe || FALLBACK_SLUG}.aml`
}

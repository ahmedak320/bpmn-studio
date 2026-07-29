import { describe, expect, it } from 'vitest'
import {
  ArisChatCredentialMaterialError,
  ArisChatSessionTranscript,
  assertProvenanceSafeToStore,
  assertTranscriptSafeToExport,
  buildProvenanceEntry,
  exportTranscript
} from './transcript'

describe('ArisChatSessionTranscript', () => {
  it('stays session-local: getAll returns exactly what was appended, in order', () => {
    const transcript = new ArisChatSessionTranscript()
    transcript.append({ id: 'm1', role: 'user', text: 'hello', createdAt: '2026-01-01T00:00:00Z' })
    transcript.append({
      id: 'm2',
      role: 'assistant',
      text: 'hi',
      createdAt: '2026-01-01T00:00:01Z'
    })
    expect(transcript.getAll().map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  it('clear() empties the transcript', () => {
    const transcript = new ArisChatSessionTranscript()
    transcript.append({ id: 'm1', role: 'user', text: 'hello', createdAt: '2026-01-01T00:00:00Z' })
    transcript.clear()
    expect(transcript.getAll()).toEqual([])
  })
})

describe('buildProvenanceEntry', () => {
  it('carries only command metadata — never message text', () => {
    const entry = buildProvenanceEntry(
      { commandId: 'c1', kind: 'setAttribute', targetIds: ['D1'], origin: 'ai-auto' },
      ['missingOwner'],
      '2026-01-01T00:00:00Z'
    )
    expect(entry).toEqual({
      commandId: 'c1',
      kind: 'setAttribute',
      targetIds: ['D1'],
      origin: 'ai-auto',
      gapKinds: ['missingOwner'],
      appliedAt: '2026-01-01T00:00:00Z'
    })
    expect(Object.keys(entry).sort()).not.toContain('prompt')
    expect(Object.keys(entry).sort()).not.toContain('response')
  })
})

describe('credential-shaped content is rejected before it can leave the session', () => {
  const CREDENTIAL_SAMPLES = [
    'sk-ant-api03-abcdefghijklmnopqrstuvwxyzABCDEFGH',
    'sk-abcdefghijklmnopqrstuvwxyz1234567890',
    'AKIAABCDEFGHIJKLMNOP',
    'ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ',
    'AIzaSyAbcdefghijklmnopqrstuvwxyz1234567',
    'api_key: 1234567890abcdefghij'
  ]

  it.each(CREDENTIAL_SAMPLES)(
    'exportTranscript throws ArisChatCredentialMaterialError for %s',
    (secretLike) => {
      const transcript = new ArisChatSessionTranscript()
      transcript.append({
        id: 'm1',
        role: 'user',
        text: `Here is my key: ${secretLike}`,
        createdAt: '2026-01-01T00:00:00Z'
      })
      expect(() => exportTranscript(transcript)).toThrow(ArisChatCredentialMaterialError)
    }
  )

  it('exportTranscript succeeds and returns messages when nothing credential-shaped is present', () => {
    const transcript = new ArisChatSessionTranscript()
    transcript.append({
      id: 'm1',
      role: 'user',
      text: 'The process owner is Jane Doe.',
      createdAt: '2026-01-01T00:00:00Z'
    })
    expect(exportTranscript(transcript)).toHaveLength(1)
  })

  it('assertTranscriptSafeToExport scans every message and reports the finding without leaking the matched text', () => {
    const messages = [
      {
        id: 'm1',
        role: 'user' as const,
        text: 'token: ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ',
        createdAt: '2026-01-01T00:00:00Z'
      }
    ]
    try {
      assertTranscriptSafeToExport(messages)
      expect.unreachable('expected assertTranscriptSafeToExport to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(ArisChatCredentialMaterialError)
      const err = error as ArisChatCredentialMaterialError
      expect(err.findings.length).toBeGreaterThan(0)
      expect(err.message).not.toContain('ghp_')
    }
  })

  it('assertProvenanceSafeToStore rejects a revision-history payload carrying credential-shaped material', () => {
    const entries = [
      buildProvenanceEntry(
        {
          commandId: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyzABCDEFGH',
          kind: 'setAttribute',
          targetIds: ['D1'],
          origin: 'ai-auto'
        },
        [],
        '2026-01-01T00:00:00Z'
      )
    ]
    expect(() => assertProvenanceSafeToStore(entries)).toThrow(ArisChatCredentialMaterialError)
  })

  it('assertProvenanceSafeToStore accepts an ordinary provenance payload', () => {
    const entries = [
      buildProvenanceEntry(
        { commandId: 'c1', kind: 'setAttribute', targetIds: ['D1'], origin: 'ai-auto' },
        ['missingOwner'],
        '2026-01-01T00:00:00Z'
      )
    ]
    expect(() => assertProvenanceSafeToStore(entries)).not.toThrow()
  })
})

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  SOAK_LOCALES,
  SOAK_RETENTION_CHECKS,
  SOAK_SCENARIOS,
  automatedSoakRecordIssues,
  browserWorkloadBpmn,
  computeSoakJournalEntryHash,
  parseArguments,
  validateAutomatedSoakRecord,
  validateEvidenceOutputTargets,
  writeNewEvidenceFileCrashSafe,
  type AutomatedSoakRecord,
  type BrowserUiReceipt,
  type SoakJournalEntry
} from '../scripts/soak-gate'
import { validateBpmnXml } from './validation'

const HOUR_MS = 60 * 60 * 1_000
const DURATION_MS = 48 * HOUR_MS
const CANDIDATE_SHA = '1'.repeat(40)
const ARTIFACT_SHA256 = '2'.repeat(64)
const STARTED_AT_MS = Date.parse('2026-07-01T00:00:00.000Z')
const MAX_RSS_GROWTH_BYTES = 512 * 1024 * 1024
const MAX_STORAGE_GROWTH_BYTES = 576 * 1024 * 2
const ARTIFACT_SIZE_BYTES = 1_000_000
const GENESIS_HASH = '0'.repeat(64)

interface RecordFixture {
  record: AutomatedSoakRecord
  diagnosticBytes: Buffer
}

function receipt(
  locale: (typeof SOAK_LOCALES)[number],
  scenario: (typeof SOAK_SCENARIOS)[number]
): BrowserUiReceipt {
  return {
    receiptVersion: 1,
    evidenceSource: 'exact-bound-html-production-ui',
    contextId: `persistent-${locale}`,
    locale,
    scenario,
    artifactSha256: ARTIFACT_SHA256,
    artifactSizeBytes: ARTIFACT_SIZE_BYTES,
    documentUrl: 'file:///release/candidate.html',
    browserLocale: locale === 'ar' ? 'ar-AE' : 'en-US',
    direction: locale === 'ar' ? 'rtl' : 'ltr',
    interaction: `production-ui-${scenario}-interaction`,
    productionSelectors: ['role=button[name="Action"]', '[data-element-id="Task_1"]'],
    interactionCount: 3,
    beforeStateSha256: '3'.repeat(64),
    afterStateSha256: scenario === 'translation-cancellation' ? '3'.repeat(64) : '4'.repeat(64),
    assertions: [{ name: 'production-ui-assertion', passed: true, observed: 1 }]
  }
}

function appendJournal(
  journal: SoakJournalEntry[],
  entry: Omit<SoakJournalEntry, 'sequence' | 'previousHash' | 'entryHash'>
): SoakJournalEntry {
  const unsigned: Omit<SoakJournalEntry, 'entryHash'> = {
    sequence: journal.length,
    previousHash: journal.at(-1)?.entryHash ?? GENESIS_HASH,
    ...entry
  }
  const completed: SoakJournalEntry = {
    ...unsigned,
    entryHash: computeSoakJournalEntryHash(unsigned)
  }
  journal.push(completed)
  return completed
}

function validAutomatedRecord(): RecordFixture {
  const samples = Array.from({ length: 49 }, (_entry, sequence) => {
    const elapsedMs = sequence * HOUR_MS
    const scenario =
      SOAK_SCENARIOS[Math.floor(sequence / SOAK_LOCALES.length) % SOAK_SCENARIOS.length]!
    const locale = SOAK_LOCALES[sequence % SOAK_LOCALES.length]!
    return {
      capturedAt: new Date(STARTED_AT_MS + elapsedMs).toISOString(),
      elapsedMs,
      residentMemoryBytes: 128 * 1024 * 1024 + sequence * 1024 * 1024,
      storageBytes: 16 * 1024 + sequence * 1024,
      locale,
      scenario,
      healthy: true,
      sequence,
      completedOperations: sequence * 10,
      completedScenarioCycles: sequence === 0 ? 0 : 1
    }
  })
  const journal: SoakJournalEntry[] = []
  appendJournal(journal, {
    kind: 'checkpoint',
    capturedAt: samples[0]!.capturedAt,
    elapsedMs: 0,
    locale: null,
    scenario: null,
    artifactSha256: ARTIFACT_SHA256,
    browserReceipt: null,
    checkpoint: {
      sampleSequence: 0,
      completedOperations: 0,
      completedScenarioCycles: 0,
      residentMemoryBytes: samples[0]!.residentMemoryBytes,
      storageBytes: samples[0]!.storageBytes,
      healthy: true
    }
  })
  const scenarioSequences = new Map<string, number[]>()
  for (const [offset, cell] of SOAK_SCENARIOS.flatMap((scenario) =>
    SOAK_LOCALES.map((locale) => ({ locale, scenario }))
  ).entries()) {
    const elapsedMs = offset + 1
    const operation = appendJournal(journal, {
      kind: 'operation',
      capturedAt: new Date(STARTED_AT_MS + elapsedMs).toISOString(),
      elapsedMs,
      locale: cell.locale,
      scenario: cell.scenario,
      artifactSha256: ARTIFACT_SHA256,
      browserReceipt: receipt(cell.locale, cell.scenario),
      checkpoint: null
    })
    scenarioSequences.set(`${cell.locale}:${cell.scenario}`, [operation.sequence])
  }
  for (const sample of samples.slice(1)) {
    appendJournal(journal, {
      kind: 'checkpoint',
      capturedAt: sample.capturedAt,
      elapsedMs: sample.elapsedMs,
      locale: null,
      scenario: null,
      artifactSha256: ARTIFACT_SHA256,
      browserReceipt: null,
      checkpoint: {
        sampleSequence: sample.sequence,
        completedOperations: sample.completedOperations,
        completedScenarioCycles: sample.completedScenarioCycles,
        residentMemoryBytes: sample.residentMemoryBytes,
        storageBytes: sample.storageBytes,
        healthy: sample.healthy
      }
    })
  }
  const diagnostic = {
    candidate: {
      requiredSha: CANDIDATE_SHA,
      artifactAtStart: {
        sha256: ARTIFACT_SHA256,
        sizeBytes: ARTIFACT_SIZE_BYTES
      }
    },
    operationJournal: {
      schemaVersion: 1,
      hashAlgorithm: 'sha256-canonical-json-v1',
      entryCount: journal.length,
      rootSha256: journal.at(-1)!.entryHash,
      entries: journal
    }
  }
  const diagnosticBytes = Buffer.from(`${JSON.stringify(diagnostic, null, 2)}\n`, 'utf8')
  const record: AutomatedSoakRecord = {
    schemaVersion: 2,
    evidenceType: 'orbitpm-lite-soak-automation',
    candidateSha: CANDIDATE_SHA,
    artifactSha256: ARTIFACT_SHA256,
    diagnosticEvidenceUrl: './soak-results.json',
    diagnosticEvidenceSha256: createHash('sha256').update(diagnosticBytes).digest('hex'),
    diagnosticEvidenceSizeBytes: diagnosticBytes.byteLength,
    journalSchemaVersion: 1,
    journalHashAlgorithm: 'sha256-canonical-json-v1',
    journalEntryCount: journal.length,
    journalRootSha256: journal.at(-1)!.entryHash,
    journal,
    status: 'passed',
    harnessPassed: true,
    passed: true,
    releaseEligible: true,
    smoke: false,
    uninterrupted: true,
    restarts: 0,
    startedAt: new Date(STARTED_AT_MS).toISOString(),
    completedAt: new Date(STARTED_AT_MS + DURATION_MS).toISOString(),
    durationMs: DURATION_MS,
    durationRequirementMs: DURATION_MS,
    durationRequirementSatisfied: true,
    locales: SOAK_LOCALES,
    scenarios: SOAK_SCENARIOS,
    retentionChecks: SOAK_RETENTION_CHECKS,
    sampleIntervalMinutes: 60,
    samples,
    maxResidentMemoryGrowthBytes: MAX_RSS_GROWTH_BYTES,
    maxStorageGrowthBytes: MAX_STORAGE_GROWTH_BYTES,
    observedResidentMemoryGrowthBytes: 48 * 1024 * 1024,
    observedStorageGrowthBytes: 48 * 1024,
    scenarioResults: SOAK_SCENARIOS.flatMap((scenario) =>
      SOAK_LOCALES.map((locale) => {
        const sequences = scenarioSequences.get(`${locale}:${scenario}`)!
        return {
          locale,
          scenario,
          passed: true,
          completedCycles: sequences.length,
          uiReceiptCount: sequences.length,
          firstJournalSequence: sequences[0]!,
          lastJournalSequence: sequences.at(-1)!,
          findings:
            locale === 'ar'
              ? 'اكتمل تفاعل واجهة الإنتاج العربية مع إيصال متصفح مرتبط بالمخرجات المطابقة.'
              : `Completed exact-artifact production UI receipt for ${scenario} with assertions.`
        }
      })
    ),
    retentionResults: [
      {
        check: 'draft-recovery',
        passed: true,
        metrics: {
          uiRecoveryReceipts: 2,
          restoredDrafts: 2,
          pendingDraftsAtCompletion: 0
        },
        findings: 'Both localized production UI recovery receipts restored and cleared drafts.'
      },
      {
        check: 'history-retention',
        passed: true,
        metrics: {
          uiHistoryReceipts: 2,
          retentionLimit: 20,
          maximumVisibleRevisions: 20,
          retainedBpmnFiles: 40,
          retainedMetadataFiles: 40,
          oldestSeedPruned: true
        },
        findings: 'Both localized production UI history receipts proved exact retention metrics.'
      },
      {
        check: 'workspace-state',
        passed: true,
        metrics: {
          uiWorkspaceSwitchReceipts: 2,
          pickerCancellations: 2,
          workspacePreserved: true,
          uiImportReceipts: 2
        },
        findings:
          'Both localized production UI workspaces survived switching and committed imports.'
      }
    ],
    candidateEndpoints: {
      requiredSha: CANDIDATE_SHA,
      headShaAtStart: CANDIDATE_SHA,
      headShaAtEnd: CANDIDATE_SHA,
      cleanAtStart: true,
      cleanAtEnd: true,
      matchedAtStart: true,
      matchedAtEnd: true
    },
    artifactEndpoints: {
      sha256AtStart: ARTIFACT_SHA256,
      sha256AtEnd: ARTIFACT_SHA256,
      sizeBytesAtStart: ARTIFACT_SIZE_BYTES,
      sizeBytesAtEnd: ARTIFACT_SIZE_BYTES,
      matchedAtEnd: true
    },
    clock: {
      wallClock: 'UTC',
      elapsedClock: 'performance.now',
      timestampDerivation: 'startedAt-plus-monotonic-elapsed'
    },
    findings:
      'The exact artifact produced a complete hash-chained UI operation and checkpoint journal while memory and storage remained bounded.'
  }
  return { record, diagnosticBytes }
}

function cloneFixture(): RecordFixture {
  const fixture = validAutomatedRecord()
  return {
    record: structuredClone(fixture.record),
    diagnosticBytes: Buffer.from(fixture.diagnosticBytes)
  }
}

describe('automated soak record validation', () => {
  it('uses valid bilingual browser workload BPMN with required diagram interchange', async () => {
    for (const locale of SOAK_LOCALES) {
      const validation = await validateBpmnXml(browserWorkloadBpmn(locale), { requireDi: true })
      expect(validation.summary.valid, JSON.stringify(validation.summary.issues)).toBe(true)
    }
  })

  it('accepts compact exact 48-hour evidence only with bound full diagnostic bytes', () => {
    const { record, diagnosticBytes } = validAutomatedRecord()
    expect(() => validateAutomatedSoakRecord(record, diagnosticBytes)).not.toThrow()
    expect(Buffer.byteLength(JSON.stringify(record), 'utf8')).toBeLessThan(256 * 1024)
    expect(automatedSoakRecordIssues(record)).toContain('diagnosticEvidenceBytesRequired')
  })

  it('rejects changed diagnostic bytes, hash, size, or relative URL traversal', () => {
    const { record, diagnosticBytes } = cloneFixture()
    expect(
      automatedSoakRecordIssues(record, Buffer.concat([diagnosticBytes, Buffer.from(' ')]))
    ).toContain('diagnosticEvidenceBinding')
    record.diagnosticEvidenceUrl = './../diagnostic.json'
    record.diagnosticEvidenceSizeBytes += 1
    expect(automatedSoakRecordIssues(record, diagnosticBytes)).toEqual(
      expect.arrayContaining(['diagnosticEvidenceUrl', 'diagnosticEvidenceBinding'])
    )
  })

  it('rejects journal mutation, broken previous hash, root, and diagnostic divergence', () => {
    const { record, diagnosticBytes } = cloneFixture()
    record.journal[2]!.browserReceipt!.interactionCount += 1
    expect(automatedSoakRecordIssues(record, diagnosticBytes)).toEqual(
      expect.arrayContaining(['journal[2]', 'diagnosticJournalBinding'])
    )

    const broken = cloneFixture()
    broken.record.journal[3]!.previousHash = '9'.repeat(64)
    broken.record.journalRootSha256 = '8'.repeat(64)
    expect(automatedSoakRecordIssues(broken.record, broken.diagnosticBytes)).toEqual(
      expect.arrayContaining(['journal[3]', 'journalRootSha256', 'diagnosticJournalBinding'])
    )
  })

  it('rejects source-summary scenario credit without exact browser UI receipts', () => {
    const { record, diagnosticBytes } = cloneFixture()
    const operationIndex = record.scenarioResults.find(
      ({ locale, scenario }) => locale === 'ar' && scenario === 'imports'
    )!.firstJournalSequence!
    record.journal[operationIndex]!.browserReceipt!.evidenceSource =
      'source-module' as BrowserUiReceipt['evidenceSource']
    expect(automatedSoakRecordIssues(record, diagnosticBytes)).toContain(
      `journal[${operationIndex}].browserReceipt`
    )
  })

  it('rejects loose or contradictory scenario counters and retention metrics', () => {
    const { record, diagnosticBytes } = cloneFixture()
    const scenario = record.scenarioResults[0]!
    scenario.completedCycles = 99
    scenario.uiReceiptCount = 98
    ;(record.retentionResults[0]!.metrics as Record<string, unknown>).unexpected = 1
    record.retentionResults[1]!.metrics.retainedBpmnFiles = 39
    expect(automatedSoakRecordIssues(record, diagnosticBytes)).toEqual(
      expect.arrayContaining([
        'scenarioResults',
        'retentionResults:draft-recovery',
        'retentionResults:history-retention'
      ])
    )
  })

  it('requires equal positive artifact endpoint sizes', () => {
    const { record, diagnosticBytes } = cloneFixture()
    record.artifactEndpoints.sizeBytesAtEnd! += 1
    expect(automatedSoakRecordIssues(record, diagnosticBytes)).toContain('endpointBinding')
  })

  it('requires exact sample boundaries, operation continuity, and journal checkpoints', () => {
    const { record, diagnosticBytes } = cloneFixture()
    record.samples[0]!.completedOperations = 1
    record.samples[1]!.completedOperations = 0
    record.samples.at(-1)!.capturedAt = new Date(Date.parse(record.completedAt) - 1).toISOString()
    expect(automatedSoakRecordIssues(record, diagnosticBytes)).toEqual(
      expect.arrayContaining([
        'samples[0].boundary',
        'samples[0].checkpoint',
        'samples[1].continuity',
        'samples[1].checkpoint',
        'sampleBoundaries'
      ])
    )
  })

  it('rejects sampled peak-first RSS growth above 512 MiB', () => {
    const { record, diagnosticBytes } = cloneFixture()
    record.samples[20]!.residentMemoryBytes =
      record.samples[0]!.residentMemoryBytes + MAX_RSS_GROWTH_BYTES + 1
    record.observedResidentMemoryGrowthBytes = MAX_RSS_GROWTH_BYTES + 1
    expect(automatedSoakRecordIssues(record, diagnosticBytes)).toContain('sampledGrowth')
  })

  it('rejects inferred candidate identity and smoke release masquerading', () => {
    const inferred = cloneFixture()
    inferred.record.candidateEndpoints.requiredSha = null
    expect(automatedSoakRecordIssues(inferred.record, inferred.diagnosticBytes)).toContain(
      'endpointBinding'
    )

    const smoke = cloneFixture()
    smoke.record.smoke = true
    smoke.record.status = 'smoke-passed'
    expect(automatedSoakRecordIssues(smoke.record, smoke.diagnosticBytes)).toContain(
      'smokeEligibility'
    )
  })
})

describe('release evidence output boundaries', () => {
  function repositoryFixture() {
    const root = mkdtempSync(join(tmpdir(), 'soak-output-repo-'))
    execFileSync('git', ['init', '--quiet'], { cwd: root })
    const gitDir = resolve(root, '.git')
    const artifactPath = resolve(root, 'candidate.html')
    writeFileSync(artifactPath, '<html>OrbitPM release artifact</html>')
    const publication = mkdtempSync(join(tmpdir(), 'soak-output-publication-'))
    return { root, gitDir, artifactPath, publication }
  }

  it('accepts two new release targets in one real directory outside worktree and gitdir', () => {
    const fixture = repositoryFixture()
    expect(() =>
      validateEvidenceOutputTargets(
        {
          artifactPath: fixture.artifactPath,
          outputPath: resolve(fixture.publication, 'diagnostic.json'),
          supportOutputPath: resolve(fixture.publication, 'support.json'),
          smoke: false
        },
        { gitRoot: fixture.root, gitDir: fixture.gitDir }
      )
    ).not.toThrow()
  })

  it('rejects a deleted-but-tracked target before cleanliness can exclude it', () => {
    const fixture = repositoryFixture()
    const tracked = resolve(fixture.root, 'tracked-evidence.json')
    writeFileSync(tracked, '{}')
    execFileSync('git', ['add', 'tracked-evidence.json'], { cwd: fixture.root })
    unlinkSync(tracked)
    expect(() =>
      validateEvidenceOutputTargets(
        {
          artifactPath: fixture.artifactPath,
          outputPath: tracked,
          supportOutputPath: resolve(fixture.publication, 'support.json'),
          smoke: false
        },
        { gitRoot: fixture.root, gitDir: fixture.gitDir }
      )
    ).toThrow(/not a tracked Git path/)
  })

  it('rejects new targets inside the worktree or .git directory', () => {
    const fixture = repositoryFixture()
    expect(() =>
      validateEvidenceOutputTargets(
        {
          artifactPath: fixture.artifactPath,
          outputPath: resolve(fixture.root, 'diagnostic.json'),
          supportOutputPath: resolve(fixture.publication, 'support.json'),
          smoke: false
        },
        { gitRoot: fixture.root, gitDir: fixture.gitDir }
      )
    ).toThrow(/outside the Git worktree/)
    expect(() =>
      validateEvidenceOutputTargets(
        {
          artifactPath: fixture.artifactPath,
          outputPath: resolve(fixture.gitDir, 'diagnostic.json'),
          supportOutputPath: resolve(fixture.publication, 'support.json'),
          smoke: false
        },
        { gitRoot: fixture.root, gitDir: fixture.gitDir }
      )
    ).toThrow(/outside the Git directory/)
  })

  it('rejects existing, dangling-symlink, and symlink-parent targets by lstat/realpath', () => {
    const fixture = repositoryFixture()
    const existing = resolve(fixture.publication, 'existing.json')
    writeFileSync(existing, '{}')
    expect(() =>
      validateEvidenceOutputTargets(
        {
          artifactPath: fixture.artifactPath,
          outputPath: existing,
          supportOutputPath: resolve(fixture.publication, 'support.json'),
          smoke: false
        },
        { gitRoot: fixture.root, gitDir: fixture.gitDir }
      )
    ).toThrow(/new file/)

    const dangling = resolve(fixture.publication, 'dangling.json')
    symlinkSync(resolve(fixture.publication, 'missing.json'), dangling)
    expect(lstatSync(dangling).isSymbolicLink()).toBe(true)
    expect(() =>
      validateEvidenceOutputTargets(
        {
          artifactPath: fixture.artifactPath,
          outputPath: dangling,
          supportOutputPath: resolve(fixture.publication, 'support.json'),
          smoke: false
        },
        { gitRoot: fixture.root, gitDir: fixture.gitDir }
      )
    ).toThrow(/new file/)

    const realPublication = mkdtempSync(join(tmpdir(), 'soak-output-real-'))
    const parentAlias = resolve(fixture.publication, 'aliased-parent')
    symlinkSync(realPublication, parentAlias)
    expect(() =>
      validateEvidenceOutputTargets(
        {
          artifactPath: fixture.artifactPath,
          outputPath: resolve(parentAlias, 'diagnostic.json'),
          supportOutputPath: resolve(realPublication, 'support.json'),
          smoke: false
        },
        { gitRoot: fixture.root, gitDir: fixture.gitDir }
      )
    ).toThrow(/symlinked or aliased parent/)
  })

  it('publishes exact bytes once via a crash-safe exclusive link', () => {
    const publication = mkdtempSync(join(tmpdir(), 'soak-exclusive-write-'))
    const target = resolve(publication, 'evidence.json')
    const bytes = Buffer.from('{"exact":true}\n')
    writeNewEvidenceFileCrashSafe(target, bytes)
    expect(readFileSync(target)).toEqual(bytes)
    expect(() => writeNewEvidenceFileCrashSafe(target, Buffer.from('changed'))).toThrow()
    expect(readFileSync(target)).toEqual(bytes)
    expect(readdirSync(publication)).toEqual(['evidence.json'])
  })

  it('rejects a rename-to-symlink parent swap after release preflight', () => {
    const fixture = repositoryFixture()
    const outputPath = resolve(fixture.publication, 'diagnostic.json')
    const supportPath = resolve(fixture.publication, 'support.json')
    const targets = validateEvidenceOutputTargets(
      {
        artifactPath: fixture.artifactPath,
        outputPath,
        supportOutputPath: supportPath,
        smoke: false
      },
      { gitRoot: fixture.root, gitDir: fixture.gitDir }
    )
    const displacedParent = `${fixture.publication}-displaced`
    const attackerParent = mkdtempSync(join(tmpdir(), 'soak-output-attacker-'))
    renameSync(fixture.publication, displacedParent)
    symlinkSync(attackerParent, fixture.publication)

    expect(() =>
      writeNewEvidenceFileCrashSafe(outputPath, Buffer.from('diagnostic'), targets.output)
    ).toThrow(/parent identity is unchanged/)
    expect(readdirSync(attackerParent)).toEqual([])
    expect(readdirSync(displacedParent)).toEqual([])
  })
})

describe('soak evidence CLI boundaries', () => {
  it('accepts evidence sampling from 1 through 60 minutes', () => {
    expect(
      parseArguments(['--smoke', '--evidence-sample-minutes', '1']).config
        .supportSampleIntervalMinutes
    ).toBe(1)
    expect(
      parseArguments(['--smoke', '--evidence-sample-minutes=60']).config
        .supportSampleIntervalMinutes
    ).toBe(60)
  })

  it('rejects evidence sampling outside 1 through 60 minutes', () => {
    expect(() => parseArguments(['--smoke', '--evidence-sample-minutes', '0'])).toThrow(
      /integer >= 1/
    )
    expect(() => parseArguments(['--smoke', '--evidence-sample-minutes', '61'])).toThrow(
      /integer from 1 through 60/
    )
  })

  it('requires explicit release candidate and artifact identities', () => {
    expect(() => parseArguments(['--artifact', 'dist/index.html'])).toThrow(
      /--candidate-sha is required/
    )
    expect(() => parseArguments(['--candidate-sha', CANDIDATE_SHA])).toThrow(
      /--artifact is required/
    )
  })

  it('keeps outputs distinct and never permits artifact overwrite', () => {
    expect(() =>
      parseArguments(['--smoke', '--output', 'same.json', '--support-output', 'same.json'])
    ).toThrow(/must differ/)
    expect(() =>
      parseArguments([
        '--smoke',
        '--artifact',
        'candidate.html',
        '--support-output',
        'candidate.html'
      ])
    ).toThrow(/must not overwrite/)
  })
})

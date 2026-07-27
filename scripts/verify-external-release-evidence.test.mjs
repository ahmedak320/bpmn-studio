import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { main, verifyReleaseEvidence } from './verify-external-release-evidence.mjs'

const NOW = Date.parse('2026-07-27T12:00:00.000Z')
const CANDIDATE_SHA = '1234567890abcdef1234567890abcdef12345678'
const CANDIDATE_READY_AT = '2026-07-24T05:00:00.000Z'
const ARTIFACT_BYTES = Buffer.from('<!doctype html><title>OrbitPM Lite 0.4.5</title>')
const ARTIFACT_SHA256 = digest(ARTIFACT_BYTES)
const BASE_URL = 'https://release-evidence.orbitpm.app/v0.4.5'
const resolvePublicHostname = async () => [{ address: '93.184.216.34', family: 4 }]

const identities = {
  nvda: {
    name: 'Amina Rahman',
    organization: 'Inclusive Product Review',
    role: 'NVDA test operator',
    accountId: 'github:amina-rahman'
  },
  voiceOver: {
    name: 'Mateo Silva',
    organization: 'Inclusive Product Review',
    role: 'VoiceOver test operator',
    accountId: 'github:mateo-silva'
  },
  arabic: {
    name: 'Layla Haddad',
    organization: 'Arabic Accessibility Council',
    role: 'Arabic screen-reader operator',
    accountId: 'github:layla-haddad'
  },
  signatory: {
    name: 'Priya Nair',
    organization: 'Release Quality Partners',
    role: 'Defect-control signatory',
    accountId: 'github:priya-nair'
  },
  reviewer: {
    name: 'Thomas Becker',
    organization: 'Independent Assurance Group',
    role: 'Independent release-evidence reviewer',
    accountId: 'github:thomas-becker'
  }
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function jsonBytes(value) {
  return Buffer.from(JSON.stringify(value))
}

function clone(value) {
  return structuredClone(value)
}

function buildHappyFixture() {
  const soakStartedAt = '2026-07-24T06:00:00.000Z'
  const soakCompletedAt = '2026-07-26T06:00:00.000Z'
  const locales = ['en', 'ar']
  const soakScenarios = [
    'edits',
    'recovery',
    'workspace-switching',
    'imports',
    'translation-cancellation',
    'history-cleanup'
  ]
  const samples = Array.from({ length: 49 }, (_, index) => ({
    capturedAt: new Date(Date.parse(soakStartedAt) + index * 60 * 60 * 1000).toISOString(),
    residentMemoryBytes: 120_000_000 + index * 100_000,
    storageBytes: 8_000_000 + index * 5_000,
    locale: locales[index % locales.length],
    scenario: soakScenarios[Math.floor(index / locales.length) % soakScenarios.length],
    healthy: true,
    sequence: index,
    completedOperations: 3 + (index % 4)
  }))
  const soakRecord = {
    schemaVersion: 1,
    evidenceType: 'orbitpm-lite-soak',
    candidateSha: CANDIDATE_SHA,
    artifactSha256: ARTIFACT_SHA256,
    passed: true,
    uninterrupted: true,
    restarts: 0,
    startedAt: soakStartedAt,
    completedAt: soakCompletedAt,
    durationMs: 172_800_000,
    locales,
    scenarios: soakScenarios,
    sampleIntervalMinutes: 60,
    samples,
    maxResidentMemoryGrowthBytes: 5_000_000,
    maxStorageGrowthBytes: 500_000,
    scenarioResults: locales.flatMap((locale) =>
      soakScenarios.map((scenario) => ({
        locale,
        scenario,
        passed: true,
        findings:
          locale === 'ar'
            ? `اكتمل سيناريو ${scenario} بالعربية دون فقدان العمل أو تعطل التفاعل.`
            : `${locale} ${scenario} completed repeatedly without lost work or blocked interaction.`
      }))
    ),
    retentionResults: [
      {
        check: 'draft-recovery',
        passed: true,
        findings: 'Draft recovery retained the latest edit across the documented recovery cycle.'
      },
      {
        check: 'history-retention',
        passed: true,
        findings: 'History retention preserved and restored all sampled committed revisions.'
      },
      {
        check: 'workspace-state',
        passed: true,
        findings: 'Workspace state remained isolated and durable through repeated switching.'
      }
    ],
    findings:
      'All required English and Arabic scenarios remained usable throughout the uninterrupted 48-hour observation.'
  }

  const assistiveTechnology = {
    nvdaWindows: buildAssistiveTechnologyRecord({
      evidenceType: 'orbitpm-lite-nvda-windows',
      operator: clone(identities.nvda),
      operatingSystem: 'Windows 11 Enterprise 24H2',
      assistiveTechnologyVersion: 'NVDA 2026.1',
      browserName: 'Microsoft Edge',
      browserVersion: '138.0.3351.83',
      locale: 'en',
      startedAt: '2026-07-26T06:30:00.000Z',
      testedAt: '2026-07-26T07:00:00.000Z',
      scenarioIds: ['keyboard-authoring', 'focus-announcements', 'modal-dialog-navigation']
    }),
    voiceOverMacos: buildAssistiveTechnologyRecord({
      evidenceType: 'orbitpm-lite-voiceover-macos',
      operator: clone(identities.voiceOver),
      operatingSystem: 'macOS 15.5',
      assistiveTechnologyVersion: 'VoiceOver 15.5',
      browserName: 'Safari',
      browserVersion: '18.5',
      locale: 'en',
      startedAt: '2026-07-26T07:30:00.000Z',
      testedAt: '2026-07-26T08:00:00.000Z',
      scenarioIds: ['keyboard-authoring', 'focus-announcements', 'modal-dialog-navigation']
    }),
    arabicScreenReader: {
      ...buildAssistiveTechnologyRecord({
        evidenceType: 'orbitpm-lite-arabic-screen-reader',
        operator: clone(identities.arabic),
        operatingSystem: 'Windows 11 Enterprise 24H2 Arabic',
        assistiveTechnologyVersion: 'NVDA 2026.1 Arabic',
        browserName: 'Mozilla Firefox',
        browserVersion: '140.0.2',
        locale: 'ar',
        startedAt: '2026-07-26T08:30:00.000Z',
        testedAt: '2026-07-26T09:00:00.000Z',
        scenarioIds: ['language-change', 'mixed-language-pronunciation', 'rtl-navigation']
      }),
      textDirection: 'rtl',
      documentLanguage: 'ar'
    }
  }

  const reviewedSupportRecords = {
    soak: {
      url: `${BASE_URL}/soak.json`,
      record: soakRecord
    },
    nvdaWindows: {
      url: `${BASE_URL}/nvda-windows.json`,
      record: assistiveTechnology.nvdaWindows
    },
    voiceOverMacos: {
      url: `${BASE_URL}/voiceover-macos.json`,
      record: assistiveTechnology.voiceOverMacos
    },
    arabicScreenReader: {
      url: `${BASE_URL}/arabic-screen-reader.json`,
      record: assistiveTechnology.arabicScreenReader
    }
  }
  const defectRecord = {
    schemaVersion: 1,
    evidenceType: 'orbitpm-lite-defect-ledger',
    candidateSha: CANDIDATE_SHA,
    artifactSha256: ARTIFACT_SHA256,
    unresolvedP0: 0,
    unresolvedP1: 0,
    signedOffBy: clone(identities.signatory),
    signedOffAt: '2026-07-26T10:00:00.000Z',
    automatedGatesCandidateSha: CANDIDATE_SHA,
    reviewedEvidence: Object.entries(reviewedSupportRecords).map(([key, { record }]) => ({
      key,
      sha256: digest(jsonBytes(record))
    })),
    severitySummary: [
      {
        severity: 'P0',
        unresolved: 0,
        findings: 'No release-blocking data-loss or security defects remained unresolved.'
      },
      {
        severity: 'P1',
        unresolved: 0,
        findings: 'No high-impact workflow or accessibility defects remained unresolved.'
      }
    ],
    entries: [],
    findings:
      'The reviewed automated, soak, and assistive-technology records contained no unresolved P0 or P1 defects.'
  }

  const supportRecords = {
    ...Object.fromEntries(
      Object.values(reviewedSupportRecords).map(({ url, record }) => [url, record])
    ),
    [`${BASE_URL}/defect-ledger.json`]: defectRecord
  }
  const supportDigests = Object.fromEntries(
    Object.entries(supportRecords).map(([url, record]) => [url, digest(jsonBytes(record))])
  )
  const manifest = {
    schemaVersion: 2,
    candidateSha: CANDIDATE_SHA,
    candidateReadyAt: CANDIDATE_READY_AT,
    artifactSha256: ARTIFACT_SHA256,
    assembledAt: '2026-07-26T11:30:00.000Z',
    soak: {
      passed: true,
      uninterrupted: true,
      startedAt: soakStartedAt,
      completedAt: soakCompletedAt,
      durationMs: 172_800_000,
      locales,
      scenarios: soakScenarios,
      retentionChecks: ['draft-recovery', 'history-retention', 'workspace-state'],
      sampleIntervalMinutes: 60,
      memoryGrowth: 'bounded',
      storageGrowth: 'bounded',
      evidenceUrl: `${BASE_URL}/soak.json`,
      evidenceSha256: supportDigests[`${BASE_URL}/soak.json`]
    },
    assistiveTechnology: {
      nvdaWindows: buildAssistiveTechnologySummary(
        assistiveTechnology.nvdaWindows,
        `${BASE_URL}/nvda-windows.json`,
        supportDigests[`${BASE_URL}/nvda-windows.json`]
      ),
      voiceOverMacos: buildAssistiveTechnologySummary(
        assistiveTechnology.voiceOverMacos,
        `${BASE_URL}/voiceover-macos.json`,
        supportDigests[`${BASE_URL}/voiceover-macos.json`]
      ),
      arabicScreenReader: buildAssistiveTechnologySummary(
        assistiveTechnology.arabicScreenReader,
        `${BASE_URL}/arabic-screen-reader.json`,
        supportDigests[`${BASE_URL}/arabic-screen-reader.json`]
      )
    },
    defects: {
      unresolvedP0: 0,
      unresolvedP1: 0,
      signedOffBy: clone(identities.signatory),
      signedOffAt: defectRecord.signedOffAt,
      evidenceUrl: `${BASE_URL}/defect-ledger.json`,
      evidenceSha256: supportDigests[`${BASE_URL}/defect-ledger.json`]
    },
    review: {
      reviewedBy: clone(identities.reviewer),
      reviewedAt: '2026-07-26T11:00:00.000Z',
      independentOfEvidenceProduction: true
    }
  }
  const manifestUrl = `${BASE_URL}/release-approval.json`
  const manifestBytes = jsonBytes(manifest)
  const bodies = new Map([
    [manifestUrl, manifestBytes],
    ...Object.entries(supportRecords).map(([url, record]) => [url, jsonBytes(record)])
  ])
  return {
    manifest,
    manifestUrl,
    manifestSha256: digest(manifestBytes),
    supportRecords,
    bodies
  }
}

function buildAssistiveTechnologyRecord({
  evidenceType,
  operator,
  operatingSystem,
  assistiveTechnologyVersion,
  browserName,
  browserVersion,
  locale,
  startedAt,
  testedAt,
  scenarioIds
}) {
  return {
    schemaVersion: 1,
    evidenceType,
    candidateSha: CANDIDATE_SHA,
    artifactSha256: ARTIFACT_SHA256,
    passed: true,
    operator,
    operatingSystem,
    assistiveTechnologyVersion,
    browserName,
    browserVersion,
    locale,
    startedAt,
    testedAt,
    scenarios: scenarioIds.map((id) => ({
      id,
      passed: true,
      findings:
        locale === 'ar'
          ? `اكتمل اختبار ${id} مع إعلان الحالة ووضوح التركيز وعدم وجود عناصر محجوبة.`
          : `${id} completed with announced state, visible focus, and no inaccessible controls.`
    })),
    findings:
      locale === 'ar'
        ? 'أكمل المشغل جميع المهام المطلوبة ووثق الإعلانات المسموعة ونتائج التفاعل باللغة العربية.'
        : 'The operator completed every required task and documented the observed announcements and interaction results.'
  }
}

function buildAssistiveTechnologySummary(record, evidenceUrl, evidenceSha256) {
  return {
    passed: true,
    operator: record.operator,
    operatingSystem: record.operatingSystem,
    assistiveTechnologyVersion: record.assistiveTechnologyVersion,
    browserName: record.browserName,
    browserVersion: record.browserVersion,
    locale: record.locale,
    startedAt: record.startedAt,
    testedAt: record.testedAt,
    evidenceUrl,
    evidenceSha256
  }
}

function responseFor(url, bytes, { declaredLength = bytes.byteLength } = {}) {
  const headers = new Headers()
  if (declaredLength !== undefined) headers.set('content-length', String(declaredLength))
  const response = new Response(bytes, { status: 200, headers })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function makeFetch(bodies, calls = []) {
  return async (url, options) => {
    calls.push({ url, options })
    const bytes = bodies.get(url)
    if (!bytes) return responseFor(url, Buffer.from('not found'), { declaredLength: 9 })
    return responseFor(url, bytes)
  }
}

function rebuildManifest(fixture) {
  const manifestBytes = jsonBytes(fixture.manifest)
  fixture.manifestSha256 = digest(manifestBytes)
  fixture.bodies.set(fixture.manifestUrl, manifestBytes)
}

function replaceSupportRecord(fixture, url, record) {
  const recordBytes = jsonBytes(record)
  fixture.supportRecords[url] = record
  fixture.bodies.set(url, recordBytes)
  const recordSha256 = digest(recordBytes)
  if (url.endsWith('/soak.json')) fixture.manifest.soak.evidenceSha256 = recordSha256
  if (url.endsWith('/nvda-windows.json')) {
    fixture.manifest.assistiveTechnology.nvdaWindows.evidenceSha256 = recordSha256
  }
  if (url.endsWith('/voiceover-macos.json')) {
    fixture.manifest.assistiveTechnology.voiceOverMacos.evidenceSha256 = recordSha256
  }
  if (url.endsWith('/arabic-screen-reader.json')) {
    fixture.manifest.assistiveTechnology.arabicScreenReader.evidenceSha256 = recordSha256
  }
  if (url.endsWith('/defect-ledger.json')) {
    fixture.manifest.defects.evidenceSha256 = recordSha256
  }
  rebuildManifest(fixture)
}

async function verifyFixture(fixture, overrides = {}) {
  return verifyReleaseEvidence({
    candidateSha: CANDIDATE_SHA,
    candidateReadyAt: CANDIDATE_READY_AT,
    artifactSha256: ARTIFACT_SHA256,
    sourceUrl: fixture.manifestUrl,
    sourceSha256: fixture.manifestSha256,
    fetchImpl: makeFetch(fixture.bodies),
    resolveHostname: resolvePublicHostname,
    now: NOW,
    ...overrides
  })
}

test('verifies and aggregates every SHA-pinned supporting evidence record', async () => {
  const fixture = buildHappyFixture()
  const calls = []
  const verification = await verifyReleaseEvidence({
    candidateSha: CANDIDATE_SHA,
    candidateReadyAt: CANDIDATE_READY_AT,
    artifactSha256: ARTIFACT_SHA256,
    sourceUrl: fixture.manifestUrl,
    sourceSha256: fixture.manifestSha256,
    fetchImpl: makeFetch(fixture.bodies, calls),
    resolveHostname: resolvePublicHostname,
    now: NOW
  })

  assert.equal(verification.status, 'passed')
  assert.equal(verification.schemaVersion, 2)
  assert.equal(verification.candidateSha, CANDIDATE_SHA)
  assert.equal(verification.candidateReadyAt, CANDIDATE_READY_AT)
  assert.equal(verification.artifactSha256, ARTIFACT_SHA256)
  assert.deepEqual(
    verification.supportingEvidence.map(({ key }) => key),
    ['soak', 'nvdaWindows', 'voiceOverMacos', 'arabicScreenReader', 'defectLedger']
  )
  assert.equal(calls.length, 6)
  for (const call of calls) {
    assert.equal(call.options.credentials, 'omit')
    assert.equal(call.options.redirect, 'error')
    assert.ok(call.options.signal instanceof AbortSignal)
  }
  assert.equal(
    digest(Buffer.from(verification.source.bodyBase64, 'base64')),
    fixture.manifestSha256
  )
  for (const support of verification.supportingEvidence) {
    assert.equal(support.record.candidateSha, CANDIDATE_SHA)
    assert.equal(support.record.artifactSha256, ARTIFACT_SHA256)
    assert.equal(digest(Buffer.from(support.bodyBase64, 'base64')), support.sha256)
  }
})

test('preserves the exact non-canonical manifest bytes in the verified aggregate', async () => {
  const fixture = buildHappyFixture()
  const manifestBytes = Buffer.from(`${JSON.stringify(fixture.manifest, null, 2)}\n`)
  fixture.bodies.set(fixture.manifestUrl, manifestBytes)
  fixture.manifestSha256 = digest(manifestBytes)

  const verification = await verifyFixture(fixture)
  assert.deepEqual(Buffer.from(verification.source.bodyBase64, 'base64'), manifestBytes)
  assert.equal(
    digest(Buffer.from(verification.source.bodyBase64, 'base64')),
    fixture.manifestSha256
  )
})

test('CLI writes the complete verified aggregate and requires exact artifact bytes', async () => {
  const fixture = buildHappyFixture()
  const directory = await mkdtemp(join(tmpdir(), 'orbitpm-evidence-'))
  const artifactPath = join(directory, 'OrbitPM-Process-Studio-Lite-0.4.5.html')
  const outputPath = join(directory, 'verified.json')
  try {
    await writeFile(artifactPath, ARTIFACT_BYTES)
    await main({
      argv: [
        `--candidate-sha=${CANDIDATE_SHA}`,
        `--candidate-ready-at=${CANDIDATE_READY_AT}`,
        `--artifact=${artifactPath}`,
        `--url=${fixture.manifestUrl}`,
        `--sha256=${fixture.manifestSha256}`,
        `--output=${outputPath}`
      ],
      env: {},
      fetchImpl: makeFetch(fixture.bodies),
      resolveHostname: resolvePublicHostname,
      now: NOW
    })
    const output = JSON.parse(await readFile(outputPath, 'utf8'))
    assert.equal(output.source.sha256, fixture.manifestSha256)
    assert.equal(output.supportingEvidence.length, 5)
    assert.equal(output.supportingEvidence[0].record.evidenceType, 'orbitpm-lite-soak')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('rejects the fabricated 2099/example.invalid/zero-hash/same-reviewer evidence case', async (t) => {
  await t.test('future 2099 chronology', async () => {
    const fixture = buildHappyFixture()
    fixture.manifest.assembledAt = '2099-01-01T00:00:00.000Z'
    rebuildManifest(fixture)
    await assert.rejects(() => verifyFixture(fixture), /must not be in the future/)
  })

  await t.test('example.invalid support URL', async () => {
    const fixture = buildHappyFixture()
    fixture.manifest.soak.evidenceUrl = 'https://example.invalid/soak.json'
    rebuildManifest(fixture)
    await assert.rejects(
      () => verifyFixture(fixture),
      /must identify a public, non-placeholder HTTPS host/
    )
  })

  await t.test('all-zero evidence hash', async () => {
    const fixture = buildHappyFixture()
    fixture.manifest.soak.evidenceSha256 = '0'.repeat(64)
    rebuildManifest(fixture)
    await assert.rejects(
      () => verifyFixture(fixture),
      /must not be the all-zero placeholder digest/
    )
  })

  await t.test('same defect signatory and final reviewer', async () => {
    const fixture = buildHappyFixture()
    fixture.manifest.review.reviewedBy = {
      ...clone(identities.signatory),
      name: 'Priya  Nair',
      organization: 'Different Claimed Organization',
      role: 'Independent evidence assessor'
    }
    rebuildManifest(fixture)
    await assert.rejects(
      () => verifyFixture(fixture),
      /reviewer must be independent of the defect signatory and test operators/
    )
  })
})

test('rejects secret-bearing or fragment-bearing evidence URLs', async (t) => {
  await t.test('query string', async () => {
    const fixture = buildHappyFixture()
    fixture.manifest.assistiveTechnology.nvdaWindows.evidenceUrl = `${BASE_URL}/nvda-windows.json?token=secret`
    rebuildManifest(fixture)
    await assert.rejects(() => verifyFixture(fixture), /without a query string or fragment/)
  })

  await t.test('fragment', async () => {
    const fixture = buildHappyFixture()
    await assert.rejects(
      () =>
        verifyFixture(fixture, {
          sourceUrl: `${fixture.manifestUrl}#credential`
        }),
      /without a query string or fragment/
    )
  })

  await t.test('empty query delimiter', async () => {
    const fixture = buildHappyFixture()
    await assert.rejects(
      () =>
        verifyFixture(fixture, {
          sourceUrl: `${fixture.manifestUrl}?`
        }),
      /without a query string or fragment/
    )
  })
})

test('rejects private DNS resolution and redirects before accepting evidence', async (t) => {
  await t.test('private DNS address', async () => {
    const fixture = buildHappyFixture()
    await assert.rejects(
      () =>
        verifyFixture(fixture, {
          resolveHostname: async () => [{ address: '127.0.0.1', family: 4 }]
        }),
      /resolve exclusively to public IP addresses/
    )
  })

  await t.test('deprecated site-local IPv6 address', async () => {
    const fixture = buildHappyFixture()
    await assert.rejects(
      () =>
        verifyFixture(fixture, {
          resolveHostname: async () => [{ address: 'fec0::1', family: 6 }]
        }),
      /resolve exclusively to public IP addresses/
    )
  })

  await t.test('unexpected redirect destination', async () => {
    const fixture = buildHappyFixture()
    const fetchImpl = async (url) => {
      const response = responseFor(`${BASE_URL}/redirected.json`, fixture.bodies.get(url))
      return response
    }
    await assert.rejects(
      () => verifyFixture(fixture, { fetchImpl }),
      /must not redirect; publish the exact final HTTPS URL/
    )
  })
})

test('rejects stale evidence outside the 30-day window', async () => {
  const fixture = buildHappyFixture()
  await assert.rejects(
    () => verifyFixture(fixture, { now: Date.parse('2026-09-01T12:00:00.000Z') }),
    /older than the 30-day release-evidence window/
  )
})

test('binds every manual session to the trusted candidate-ready instant', async (t) => {
  await t.test('pre-candidate soak', async () => {
    const fixture = buildHappyFixture()
    const candidateReadyAt = '2026-07-24T06:00:01.000Z'
    fixture.manifest.candidateReadyAt = candidateReadyAt
    rebuildManifest(fixture)
    await assert.rejects(
      () => verifyFixture(fixture, { candidateReadyAt }),
      /soak.startedAt must not predate the trusted candidate-ready instant/
    )
  })

  await t.test('pre-candidate assistive-technology session', async () => {
    const fixture = buildHappyFixture()
    fixture.manifest.assistiveTechnology.nvdaWindows.startedAt = '2026-07-24T04:59:00.000Z'
    fixture.manifest.assistiveTechnology.nvdaWindows.testedAt = '2026-07-24T05:30:00.000Z'
    rebuildManifest(fixture)
    await assert.rejects(
      () => verifyFixture(fixture),
      /session must not predate the trusted candidate-ready instant/
    )
  })

  await t.test('non-canonical trusted timestamp', async () => {
    const fixture = buildHappyFixture()
    await assert.rejects(
      () =>
        verifyFixture(fixture, {
          candidateReadyAt: '2026-07-24T05:00:00Z'
        }),
      /must be a canonical UTC ISO-8601 timestamp with milliseconds/
    )
  })

  await t.test('manifest cannot substitute the trusted instant', async () => {
    const fixture = buildHappyFixture()
    fixture.manifest.candidateReadyAt = '2026-07-24T05:01:00.000Z'
    rebuildManifest(fixture)
    await assert.rejects(
      () => verifyFixture(fixture),
      /not bound to the trusted candidate-ready instant/
    )
  })
})

test('rejects nested candidate or artifact substitutions even when re-hashed', async (t) => {
  await t.test('candidate substitution', async () => {
    const fixture = buildHappyFixture()
    const url = `${BASE_URL}/nvda-windows.json`
    const record = clone(fixture.supportRecords[url])
    record.candidateSha = 'abcdef1234567890abcdef1234567890abcdef12'
    replaceSupportRecord(fixture, url, record)
    await assert.rejects(() => verifyFixture(fixture), /is not bound to the exact candidate SHA/)
  })

  await t.test('artifact substitution', async () => {
    const fixture = buildHappyFixture()
    const url = `${BASE_URL}/defect-ledger.json`
    const record = clone(fixture.supportRecords[url])
    record.artifactSha256 = digest('different artifact')
    replaceSupportRecord(fixture, url, record)
    await assert.rejects(() => verifyFixture(fixture), /is not bound to the exact artifact SHA-256/)
  })
})

test('enforces the streaming cap before aggregating a nested response', async () => {
  const fixture = buildHappyFixture()
  const url = `${BASE_URL}/soak.json`
  const oversizedBytes = Buffer.alloc(256 * 1024 + 1, 0x20)
  fixture.bodies.set(url, oversizedBytes)
  fixture.manifest.soak.evidenceSha256 = digest(oversizedBytes)
  rebuildManifest(fixture)

  const fetchImpl = async (requestedUrl, options) => {
    const bytes = fixture.bodies.get(requestedUrl)
    if (requestedUrl !== url) return makeFetch(fixture.bodies)(requestedUrl, options)
    const response = responseFor(requestedUrl, bytes, { declaredLength: undefined })
    response.headers.delete('content-length')
    return response
  }
  await assert.rejects(
    () =>
      verifyReleaseEvidence({
        candidateSha: CANDIDATE_SHA,
        candidateReadyAt: CANDIDATE_READY_AT,
        artifactSha256: ARTIFACT_SHA256,
        sourceUrl: fixture.manifestUrl,
        sourceSha256: fixture.manifestSha256,
        fetchImpl,
        resolveHostname: resolvePublicHostname,
        now: NOW
      }),
    /exceeds the 262144-byte verification limit/
  )
})

test('enforces the timeout while a nested response body is stalled', async () => {
  const fixture = buildHappyFixture()
  const stalledUrl = `${BASE_URL}/soak.json`
  const fetchImpl = async (url, options) => {
    if (url !== stalledUrl) return makeFetch(fixture.bodies)(url, options)
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([0x7b]))
        }
      }),
      { status: 200 }
    )
    Object.defineProperty(response, 'url', { value: url })
    return response
  }
  await assert.rejects(
    () =>
      verifyFixture(fixture, {
        fetchImpl,
        timeoutMs: 10
      }),
    /exceeded the evidence-fetch timeout/
  )
})

test('rejects non-substantive findings and incomplete soak sampling', async (t) => {
  await t.test('assistive-technology findings', async () => {
    const fixture = buildHappyFixture()
    const url = `${BASE_URL}/arabic-screen-reader.json`
    const record = clone(fixture.supportRecords[url])
    record.scenarios[0].findings = 'ok'
    replaceSupportRecord(fixture, url, record)
    await assert.rejects(
      () => verifyFixture(fixture),
      /must be a trimmed string between 20 and 2000 characters/
    )
  })

  await t.test('missing hourly soak samples', async () => {
    const fixture = buildHappyFixture()
    const url = `${BASE_URL}/soak.json`
    const record = clone(fixture.supportRecords[url])
    record.samples.splice(20, 1)
    replaceSupportRecord(fixture, url, record)
    await assert.rejects(
      () => verifyFixture(fixture),
      /must be an array containing at least 49 item/
    )
  })

  await t.test('underscore-delimited placeholder identity', async () => {
    const fixture = buildHappyFixture()
    fixture.manifest.review.reviewedBy.name = 'REPLACE_WITH_HUMAN NAME'
    rebuildManifest(fixture)
    await assert.rejects(
      () => verifyFixture(fixture),
      /must identify a non-placeholder human by full name/
    )
  })

  await t.test('English-only Arabic findings', async () => {
    const fixture = buildHappyFixture()
    const url = `${BASE_URL}/arabic-screen-reader.json`
    const record = clone(fixture.supportRecords[url])
    record.scenarios[0].findings =
      'The operator recorded detailed language switching behavior without any Arabic script.'
    replaceSupportRecord(fixture, url, record)
    await assert.rejects(
      () => verifyFixture(fixture),
      /must contain substantive Arabic-script detail/
    )
  })

  await t.test('non-Arabic combining marks cannot impersonate Arabic findings', async () => {
    const fixture = buildHappyFixture()
    const url = `${BASE_URL}/arabic-screen-reader.json`
    const record = clone(fixture.supportRecords[url])
    record.scenarios[0].findings =
      'Detailed observations remained entirely English a\u0301\u0301 e\u0301\u0301 i\u0301\u0301 o\u0301\u0301.'
    replaceSupportRecord(fixture, url, record)
    await assert.rejects(
      () => verifyFixture(fixture),
      /must contain substantive Arabic-script detail/
    )
  })
})

test('rejects mislabeled AT platforms and stale defect-ledger record bindings', async (t) => {
  await t.test('NVDA Windows entry carrying Linux and Orca', async () => {
    const fixture = buildHappyFixture()
    fixture.manifest.assistiveTechnology.nvdaWindows.operatingSystem = 'Linux 6.10'
    fixture.manifest.assistiveTechnology.nvdaWindows.assistiveTechnologyVersion = 'Orca 47.1'
    rebuildManifest(fixture)
    await assert.rejects(
      () => verifyFixture(fixture),
      /platform, assistive technology, or browser is mislabeled/
    )
  })

  await t.test('Arabic entry carrying an impossible macOS and NVDA tuple', async () => {
    const fixture = buildHappyFixture()
    const entry = fixture.manifest.assistiveTechnology.arabicScreenReader
    entry.operatingSystem = 'macOS 15.5'
    entry.assistiveTechnologyVersion = 'NVDA 2026.1'
    entry.browserName = 'Safari'
    entry.browserVersion = '18.5'
    rebuildManifest(fixture)
    await assert.rejects(
      () => verifyFixture(fixture),
      /must record a supported OS, screen-reader, and browser tuple/
    )
  })

  await t.test('defect sign-off does not bind a re-hashed AT record', async () => {
    const fixture = buildHappyFixture()
    const url = `${BASE_URL}/nvda-windows.json`
    const record = clone(fixture.supportRecords[url])
    record.findings =
      'The operator completed every required task twice and recorded the confirmed announcement sequence.'
    replaceSupportRecord(fixture, url, record)
    await assert.rejects(
      () => verifyFixture(fixture),
      /is not bound to the exact supporting-record SHA-256/
    )
  })
})

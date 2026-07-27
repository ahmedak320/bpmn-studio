import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  main,
  verifyBrowserCompatibilityEvidence
} from './verify-browser-compatibility-evidence.mjs'

const candidateSha = '0123456789abcdef0123456789abcdef01234567'
const candidateReadyAt = '2026-07-27T10:00:00.000Z'
const pagesGeneratedAt = '2026-07-27T11:00:00.000Z'
const now = Date.parse('2026-07-27T18:00:00.000Z')
const pagesUrl = 'https://ahmedak320.github.io/bpmn-studio/'
const evidenceCommit = 'abcdef1234567890abcdef1234567890abcdef12'
const evidenceBaseUrl = `https://raw.githubusercontent.com/ahmedak320/bpmn-studio/${evidenceCommit}/release-evidence/v0.4.5`
const matrixUrl = `${evidenceBaseUrl}/browser-matrix.json`
const versionBaselineUrl = `${evidenceBaseUrl}/browser-version-baseline.json`
const artifactBytes = Buffer.from('<!doctype html><title>OrbitPM 0.4.5</title>', 'utf8')
const artifactSha256 = sha256(artifactBytes)
const sourceRetrievedAt = '2026-07-27T12:30:00.000Z'
const baselineGeneratedAt = '2026-07-27T12:45:00.000Z'
const officialSourceUrls = {
  chrome:
    'https://versionhistory.googleapis.com/v1/chrome/platforms/win64/channels/stable/versions/all/releases?page_size=10000',
  edge: 'https://learn.microsoft.com/en-us/deployedge/microsoft-edge-relnote-stable-channel',
  firefox: 'https://product-details.mozilla.org/1.0/firefox.json',
  safari: 'https://support.apple.com/en-us/100100'
}

const browserCatalog = {
  chrome: {
    name: 'Google Chrome',
    identifier: 'com.google.Chrome',
    versions: { current: '140.0.7339.10', previous: '139.0.7258.20' },
    operatingSystem: 'Windows',
    operatingSystemVersion: '11.0.26100'
  },
  edge: {
    name: 'Microsoft Edge',
    identifier: 'com.microsoft.Edge',
    versions: { current: '140.0.3485.54', previous: '139.0.3405.125' },
    operatingSystem: 'Windows',
    operatingSystemVersion: '11.0.26100'
  },
  firefox: {
    name: 'Mozilla Firefox',
    identifier: 'org.mozilla.firefox',
    versions: { current: '142.0.1', previous: '141.0.3' },
    operatingSystem: 'Windows',
    operatingSystemVersion: '11.0.26100'
  },
  safari: {
    name: 'Safari',
    identifier: 'com.apple.Safari',
    versions: { current: '26.5.2', previous: '18.6.2' },
    operatingSystem: 'macOS',
    operatingSystemVersion: '16.0.1'
  }
}

const operator = {
  name: 'Alice Mercer',
  organization: 'OrbitPM Quality',
  role: 'Browser compatibility specialist',
  accountId: 'github:alice-mercer'
}
const defectSignatory = {
  name: 'Basil Rahman',
  organization: 'OrbitPM Quality',
  role: 'Release defect manager',
  accountId: 'github:basil-rahman'
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function pagesEvidenceFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    gate: 'orbitpm-lite-browser-environment',
    result: 'passed',
    generatedAt: pagesGeneratedAt,
    candidateSha,
    artifact: {
      path: '/home/runner/work/bpmn-studio/pages-dist/index.html',
      sha256: artifactSha256
    },
    testedUrl: pagesUrl,
    servedFinalUrl: pagesUrl,
    servedSha256: artifactSha256,
    ...overrides
  }
}

function officialSourceFixtures() {
  return {
    chrome: Buffer.from(
      JSON.stringify({
        releases: [
          {
            name: 'chrome/platforms/win64/channels/stable/versions/140.0.7339.10/releases/2',
            serving: { startTime: '2026-07-01T00:00:00.000Z' },
            fraction: 1,
            version: '140.0.7339.10'
          },
          {
            name: 'chrome/platforms/win64/channels/stable/versions/139.0.7258.20/releases/1',
            serving: {
              startTime: '2026-06-01T00:00:00.000Z',
              endTime: '2026-07-20T00:00:00.000Z'
            },
            fraction: 1,
            version: '139.0.7258.20'
          }
        ]
      }),
      'utf8'
    ),
    edge: Buffer.from(
      [
        '<!doctype html><title>Microsoft Edge release notes for Stable Channel</title>',
        '<h2>Version 140.0.3485.54: July 1, 2026 (Stable)</h2>',
        '<h2>Version 139.0.3405.125: June 1, 2026 (Stable)</h2>'
      ].join(''),
      'utf8'
    ),
    firefox: Buffer.from(
      JSON.stringify({
        releases: {
          'firefox-141.0.3': {
            category: 'stability',
            date: '2026-06-15',
            product: 'firefox',
            version: '141.0.3'
          },
          'firefox-142.0.1': {
            category: 'stability',
            date: '2026-07-01',
            product: 'firefox',
            version: '142.0.1'
          }
        }
      }),
      'utf8'
    ),
    safari: Buffer.from(
      [
        '<!doctype html><title lang="en">Apple security releases - Apple Support</title><table>',
        '<tr><td><p><a href="/en-us/127685">Safari 26.5.2</a></p></td><td><p>macOS Sonoma and macOS Sequoia</p></td><td><p>29 Jun 2026</p></td></tr>',
        '<tr><td><p><a href="/en-us/124152">Safari 18.6.2</a></p></td><td><p>macOS Sonoma and macOS Sequoia</p></td><td><p>20 May 2025</p></td></tr>',
        '</table>'
      ].join(''),
      'utf8'
    )
  }
}

function versionBaselineFixture(sourceBodies = officialSourceFixtures()) {
  const sources = Object.keys(browserCatalog).map((browser) => {
    const requirements = {
      chrome: ['Google', 'chrome-version-history-v1', 'application/json'],
      edge: ['Microsoft', 'edge-stable-release-notes-v1', 'text/html'],
      firefox: ['Mozilla', 'mozilla-firefox-releases-v1', 'application/json'],
      safari: ['Apple', 'apple-security-releases-v1', 'text/html']
    }[browser]
    return {
      id: `${browser}-stable`,
      browser,
      vendor: requirements[0],
      adapter: requirements[1],
      officialUrl: officialSourceUrls[browser],
      retrievedAt: sourceRetrievedAt,
      mediaType: requirements[2],
      sha256: sha256(sourceBodies[browser]),
      sizeBytes: sourceBodies[browser].byteLength
    }
  })
  return {
    schemaVersion: 1,
    gate: 'orbitpm-lite-browser-vendor-version-baseline',
    result: 'passed',
    candidateSha,
    artifactSha256,
    pagesUrl,
    generatedAt: baselineGeneratedAt,
    versions: Object.entries(browserCatalog).flatMap(([browser, descriptor]) =>
      ['current', 'previous'].map((release) => ({
        browser,
        release,
        browserName: descriptor.name,
        browserIdentifier: descriptor.identifier,
        browserVersion: descriptor.versions[release],
        operatingSystem: descriptor.operatingSystem,
        operatingSystemVersion: descriptor.operatingSystemVersion,
        channel: 'stable',
        sourceId: `${browser}-stable`
      }))
    ),
    sources
  }
}

function matrixFixture(baseline = versionBaselineFixture()) {
  let sequence = 0
  const rows = []
  for (const [browser, descriptor] of Object.entries(browserCatalog)) {
    for (const release of ['current', 'previous']) {
      for (const locale of ['en', 'ar']) {
        rows.push({
          browser,
          release,
          locale,
          result: 'passed',
          operator: structuredClone(operator),
          operatingSystem: descriptor.operatingSystem,
          operatingSystemVersion: descriptor.operatingSystemVersion,
          browserName: descriptor.name,
          browserIdentifier: descriptor.identifier,
          browserVersion: descriptor.versions[release],
          automationEngine: 'none',
          operationMode: 'human-operated',
          testedAt: `2026-07-27T12:00:${String(sequence).padStart(2, '0')}.000Z`,
          findings:
            locale === 'ar'
              ? 'اكتملت جميع خطوات التأليف والحفظ والاستيراد بنجاح واضح دون أخطاء وظيفية.'
              : 'All authoring, save, import, and recovery flows completed successfully without functional errors.'
        })
        sequence += 1
      }
    }
  }
  return {
    schemaVersion: 2,
    gate: 'orbitpm-lite-browser-compatibility',
    result: 'passed',
    candidateSha,
    artifactSha256,
    pagesUrl,
    versionBaseline: {
      url: versionBaselineUrl,
      sha256: sha256(Buffer.from(JSON.stringify(baseline), 'utf8'))
    },
    completedAt: '2026-07-27T14:01:00.000Z',
    rows,
    defects: {
      unresolvedP0: 0,
      unresolvedP1: 0,
      signedOffBy: structuredClone(defectSignatory),
      signedOffAt: '2026-07-27T13:00:00.000Z',
      findings:
        'Every browser result was reviewed and no priority zero or priority one defects remain unresolved.'
    },
    review: {
      approved: true,
      independentOfEvidenceProduction: true,
      reviewedBy: structuredClone(defectSignatory),
      reviewedAt: '2026-07-27T14:00:00.000Z',
      findings:
        'Independent review confirmed complete browser coverage, authentic environments, and valid chronology.'
    }
  }
}

function matrixFixtureFromBaseline(baseline) {
  const matrix = matrixFixture(baseline)
  for (const row of matrix.rows) {
    const entry = baseline.versions.find(
      (candidate) => candidate.browser === row.browser && candidate.release === row.release
    )
    Object.assign(row, {
      browserName: entry.browserName,
      browserIdentifier: entry.browserIdentifier,
      browserVersion: entry.browserVersion,
      operatingSystem: entry.operatingSystem,
      operatingSystemVersion: entry.operatingSystemVersion
    })
  }
  return matrix
}

function responseFor(bytes, url = matrixUrl, contentType = 'application/json') {
  const response = new Response(bytes, {
    status: 200,
    headers: { 'Content-Type': contentType }
  })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function makeFetch({
  matrixBytes,
  baselineBytes,
  sourceBodies = officialSourceFixtures(),
  beforeResponse
}) {
  const bodies = new Map([
    [matrixUrl, { bytes: matrixBytes, contentType: 'application/json' }],
    [versionBaselineUrl, { bytes: baselineBytes, contentType: 'application/json' }],
    ...Object.entries(officialSourceUrls).map(([browser, url]) => [
      url,
      {
        bytes: sourceBodies[browser],
        contentType:
          browser === 'chrome' || browser === 'firefox' ? 'application/json' : 'text/html'
      }
    ])
  ])
  return async (url) => {
    beforeResponse?.(url)
    const response = bodies.get(url)
    if (!response) throw new Error(`Unexpected fixture URL ${url}`)
    return responseFor(response.bytes, url, response.contentType)
  }
}

async function verifyFixture(
  matrix,
  pagesEvidence = pagesEvidenceFixture(),
  baseline = versionBaselineFixture(),
  sourceBodies = officialSourceFixtures(),
  fetchImpl
) {
  const resolvedMatrix = matrix ?? matrixFixture(baseline)
  const matrixBytes = Buffer.from(JSON.stringify(resolvedMatrix), 'utf8')
  const baselineBytes = Buffer.from(JSON.stringify(baseline), 'utf8')
  const pagesBytes = Buffer.from(JSON.stringify(pagesEvidence), 'utf8')
  return verifyBrowserCompatibilityEvidence({
    candidateSha,
    candidateReadyAt,
    artifactSha256,
    pagesUrl,
    pagesDeploymentEvidenceBytes: pagesBytes,
    pagesDeploymentEvidencePath: '/trusted/pages-browser-environment.json',
    sourceUrl: matrixUrl,
    sourceSha256: sha256(matrixBytes),
    versionBaselineUrl,
    versionBaselineSha256: sha256(baselineBytes),
    fetchImpl: fetchImpl ?? makeFetch({ matrixBytes, baselineBytes, sourceBodies }),
    now
  })
}

test('accepts exactly 16 post-Pages human browser rows and retains exact evidence bytes', async () => {
  const sourceBodies = officialSourceFixtures()
  const baseline = versionBaselineFixture(sourceBodies)
  const matrix = matrixFixture(baseline)
  const pagesEvidence = pagesEvidenceFixture()
  const verification = await verifyFixture(matrix, pagesEvidence, baseline, sourceBodies)

  assert.equal(verification.status, 'passed')
  assert.equal(verification.policy.requiredRows, 16)
  assert.equal(verification.evidence.rows.length, 16)
  assert.equal(
    verification.evidence.review.reviewedBy.accountId,
    verification.evidence.defects.signedOffBy.accountId
  )
  assert.deepEqual(verification.pagesDeploymentEvidence.record, pagesEvidence)
  assert.deepEqual(
    Buffer.from(verification.pagesDeploymentEvidence.bodyBase64, 'base64'),
    Buffer.from(JSON.stringify(pagesEvidence), 'utf8')
  )
  assert.deepEqual(
    Buffer.from(verification.source.bodyBase64, 'base64'),
    Buffer.from(JSON.stringify(matrix), 'utf8')
  )
  assert.deepEqual(
    Buffer.from(verification.versionBaseline.source.bodyBase64, 'base64'),
    Buffer.from(JSON.stringify(baseline), 'utf8')
  )
  assert.deepEqual(
    Object.fromEntries(
      verification.versionBaseline.officialSources.map((source) => [
        source.browser,
        Buffer.from(source.bodyBase64, 'base64')
      ])
    ),
    sourceBodies
  )
  assert.equal(
    verification.evidence.rows.find((row) => row.browser === 'safari' && row.release === 'current')
      .browserVersion,
    '26.5.2'
  )
})

test('rejects an omitted browser matrix row', async () => {
  const matrix = matrixFixture()
  matrix.rows.pop()
  await assert.rejects(() => verifyFixture(matrix), /must contain exactly 16 rows/)
})

test('rejects duplicate browser/release/locale coverage', async () => {
  const matrix = matrixFixture()
  matrix.rows[15] = structuredClone(matrix.rows[0])
  await assert.rejects(() => verifyFixture(matrix), /duplicates chrome:current:en/)
})

test('rejects a matrix version detached from its authoritative baseline', async () => {
  const matrix = matrixFixture()
  for (const row of matrix.rows.filter(
    (candidate) => candidate.browser === 'chrome' && candidate.release === 'current'
  )) {
    row.browserVersion = '141.0.7390.1'
  }
  await assert.rejects(
    () => verifyFixture(matrix),
    /must exactly match its SHA-pinned vendor-version baseline entry/
  )
})

test('rejects mismatched exact versions across the English and Arabic pair', async () => {
  const matrix = matrixFixture()
  matrix.rows.find(
    (row) => row.browser === 'edge' && row.release === 'current' && row.locale === 'ar'
  ).browserVersion = '140.0.3485.55'
  await assert.rejects(
    () => verifyFixture(matrix),
    /must exactly match its SHA-pinned vendor-version baseline entry/
  )
})

test('binds versions to a separate authoritative baseline and stable vendor sources', async (t) => {
  await t.test('matrix baseline digest substitution', async () => {
    const matrix = matrixFixture()
    matrix.versionBaseline.sha256 = 'a'.repeat(64)
    await assert.rejects(
      () => verifyFixture(matrix),
      /not bound to the exact vendor-version baseline/
    )
  })

  await t.test(
    'fabricated adjacent major pair even when matrix and baseline are re-hashed',
    async () => {
      const baseline = versionBaselineFixture()
      baseline.versions.find(
        (entry) => entry.browser === 'chrome' && entry.release === 'current'
      ).browserVersion = '999.0.0.1'
      baseline.versions.find(
        (entry) => entry.browser === 'chrome' && entry.release === 'previous'
      ).browserVersion = '998.0.0.1'
      const matrix = matrixFixtureFromBaseline(baseline)
      await assert.rejects(
        () => verifyFixture(matrix, pagesEvidenceFixture(), baseline),
        /not the vendor-authoritative current stable major at testedAt/
      )
    }
  )

  await t.test('same-major wrong patch even when matrix and baseline are re-hashed', async () => {
    const baseline = versionBaselineFixture()
    baseline.versions.find(
      (entry) => entry.browser === 'firefox' && entry.release === 'current'
    ).browserVersion = '142.0.0'
    const matrix = matrixFixtureFromBaseline(baseline)
    await assert.rejects(
      () => verifyFixture(matrix, pagesEvidenceFixture(), baseline),
      /absent from its authoritative stable source/
    )
  })

  await t.test('beta endpoint substitution', async () => {
    const baseline = versionBaselineFixture()
    baseline.sources.find((source) => source.browser === 'chrome').officialUrl =
      'https://versionhistory.googleapis.com/v1/chrome/platforms/win64/channels/beta/versions/all/releases?page_size=10000'
    const matrix = matrixFixture(baseline)
    await assert.rejects(
      () => verifyFixture(matrix, pagesEvidenceFixture(), baseline),
      /not the code-allowlisted chrome stable-release source/
    )
  })

  await t.test('Chrome source missing the complete-page parameter', async () => {
    const baseline = versionBaselineFixture()
    baseline.sources.find((source) => source.browser === 'chrome').officialUrl =
      'https://versionhistory.googleapis.com/v1/chrome/platforms/win64/channels/stable/versions/all/releases'
    const matrix = matrixFixture(baseline)
    await assert.rejects(
      () => verifyFixture(matrix, pagesEvidenceFixture(), baseline),
      /must request exactly page_size=10000/
    )
  })

  await t.test('Chrome source with alternate or extra parameters', async () => {
    const baseline = versionBaselineFixture()
    baseline.sources.find((source) => source.browser === 'chrome').officialUrl =
      'https://versionhistory.googleapis.com/v1/chrome/platforms/win64/channels/stable/versions/all/releases?page_size=10000&filter=fraction%3D1'
    const matrix = matrixFixture(baseline)
    await assert.rejects(
      () => verifyFixture(matrix, pagesEvidenceFixture(), baseline),
      /must request exactly page_size=10000/
    )
  })

  await t.test('official-host suffix trick', async () => {
    const baseline = versionBaselineFixture()
    baseline.sources.find((source) => source.browser === 'firefox').officialUrl =
      'https://product-details.mozilla.org.attacker.net/1.0/firefox.json'
    const matrix = matrixFixture(baseline)
    await assert.rejects(
      () => verifyFixture(matrix, pagesEvidenceFixture(), baseline),
      /not the code-allowlisted firefox stable-release source/
    )
  })

  await t.test('vendor response digest mismatch', async () => {
    const baseline = versionBaselineFixture()
    baseline.sources.find((source) => source.browser === 'safari').sha256 = 'b'.repeat(64)
    const matrix = matrixFixture(baseline)
    await assert.rejects(
      () => verifyFixture(matrix, pagesEvidenceFixture(), baseline),
      /Official safari stable-release source SHA-256 .* does not match/
    )
  })

  await t.test('official source final-URL substitution', async () => {
    const sourceBodies = officialSourceFixtures()
    const baseline = versionBaselineFixture(sourceBodies)
    const matrix = matrixFixture(baseline)
    const matrixBytes = Buffer.from(JSON.stringify(matrix), 'utf8')
    const baselineBytes = Buffer.from(JSON.stringify(baseline), 'utf8')
    const normalFetch = makeFetch({ matrixBytes, baselineBytes, sourceBodies })
    const fetchImpl = async (url) => {
      if (url === officialSourceUrls.chrome) {
        return responseFor(
          sourceBodies.chrome,
          'https://versionhistory.googleapis.com.attacker.net/v1/chrome/releases?page_size=10000',
          'application/json'
        )
      }
      return normalFetch(url)
    }
    await assert.rejects(
      () => verifyFixture(matrix, pagesEvidenceFixture(), baseline, sourceBodies, fetchImpl),
      /not the code-allowlisted chrome stable-release source/
    )
  })

  await t.test('version text only in an unrelated Edge channel', async () => {
    const sourceBodies = officialSourceFixtures()
    sourceBodies.edge = Buffer.from(
      [
        '<!doctype html><title>Microsoft Edge release notes for Stable Channel</title>',
        '<h2>Version 140.0.3485.54: July 1, 2026 (Extended Stable)</h2>',
        '<h2>Version 139.0.3405.125: June 1, 2026 (Beta)</h2>'
      ].join(''),
      'utf8'
    )
    const baseline = versionBaselineFixture(sourceBodies)
    const matrix = matrixFixture(baseline)
    await assert.rejects(
      () => verifyFixture(matrix, pagesEvidenceFixture(), baseline, sourceBodies),
      /must expose at least two stable browser release majors/
    )
  })

  await t.test('source retrieval that does not postdate its browser row', async () => {
    const baseline = versionBaselineFixture()
    baseline.sources.find((source) => source.browser === 'chrome').retrievedAt =
      '2026-07-27T12:00:00.000Z'
    const matrix = matrixFixture(baseline)
    await assert.rejects(
      () => verifyFixture(matrix, pagesEvidenceFixture(), baseline),
      /testedAt must strictly predate its authoritative source retrieval/
    )
  })

  await t.test('baseline generation after defect sign-off', async () => {
    const baseline = versionBaselineFixture()
    baseline.generatedAt = '2026-07-27T13:30:00.000Z'
    const matrix = matrixFixture(baseline)
    await assert.rejects(
      () => verifyFixture(matrix, pagesEvidenceFixture(), baseline),
      /signedOffAt must postdate the vendor-version baseline generation/
    )
  })

  await t.test('duplicate browser source', async () => {
    const baseline = versionBaselineFixture()
    baseline.sources[3].browser = 'chrome'
    const matrix = matrixFixture(baseline)
    await assert.rejects(
      () => verifyFixture(matrix, pagesEvidenceFixture(), baseline),
      /exactly one source per browser/
    )
  })
})

test('rejects vague or nonnumeric OS and browser versions', async (context) => {
  const cases = [
    [
      'browser version',
      (matrix) => {
        matrix.rows[0].browserVersion = 'latest'
      }
    ],
    [
      'OS version',
      (matrix) => {
        matrix.rows[0].operatingSystemVersion = 'Windows 11 current'
      }
    ]
  ]
  for (const [name, mutate] of cases) {
    await context.test(name, async () => {
      const matrix = matrixFixture()
      mutate(matrix)
      await assert.rejects(() => verifyFixture(matrix), /exact dotted numeric version/)
    })
  }
})

test('requires every row to strictly postdate candidate readiness and Pages evidence', async (t) => {
  await t.test('equal to candidate readiness', async () => {
    const matrix = matrixFixture()
    matrix.rows[0].testedAt = candidateReadyAt
    await assert.rejects(() => verifyFixture(matrix), /must strictly postdate candidate readiness/)
  })

  await t.test('equal to trusted Pages generation', async () => {
    const matrix = matrixFixture()
    matrix.rows[0].testedAt = pagesGeneratedAt
    await assert.rejects(
      () => verifyFixture(matrix),
      /must strictly postdate the trusted Pages deployment evidence/
    )
  })

  await t.test('earlier than trusted Pages generation', async () => {
    const matrix = matrixFixture()
    matrix.rows[0].testedAt = '2026-07-27T10:59:59.999Z'
    await assert.rejects(
      () => verifyFixture(matrix),
      /must strictly postdate the trusted Pages deployment evidence/
    )
  })
})

test('rejects WebKit substituted for genuine Safari', async () => {
  const matrix = matrixFixture()
  matrix.rows.find((row) => row.browser === 'safari').browserIdentifier = 'org.webkit.WebKit'
  await assert.rejects(() => verifyFixture(matrix), /browserIdentifier must be com\.apple\.Safari/)
})

test('rejects Playwright automation substituted for a human browser session', async () => {
  const matrix = matrixFixture()
  const safariRow = matrix.rows.find((row) => row.browser === 'safari')
  safariRow.automationEngine = 'playwright'
  await assert.rejects(
    () => verifyFixture(matrix),
    /automationEngine=none and operationMode=human-operated/
  )
})

test('rejects Safari evidence recorded on a non-macOS platform', async () => {
  const matrix = matrixFixture()
  const safariRows = matrix.rows.filter((row) => row.browser === 'safari')
  for (const row of safariRows) row.operatingSystem = 'Linux'
  await assert.rejects(() => verifyFixture(matrix), /must record genuine Safari on macOS/)
})

test('rejects an independent reviewer who is also a browser operator', async () => {
  const matrix = matrixFixture()
  matrix.review.reviewedBy = structuredClone(operator)
  await assert.rejects(() => verifyFixture(matrix), /must be distinct from every browser operator/)
})

test('rejects inconsistent profiles for one stable operator identity', async () => {
  const matrix = matrixFixture()
  matrix.rows[1].operator.role = 'Alternate browser specialist'
  await assert.rejects(() => verifyFixture(matrix), /one stable account and profile/)
})

test('rejects placeholder human identities', async () => {
  const matrix = matrixFixture()
  matrix.rows[0].operator = {
    name: 'Test User',
    organization: 'Example Organization',
    role: 'Browser operator',
    accountId: 'github:test-user'
  }
  await assert.rejects(() => verifyFixture(matrix), /non-placeholder human by full name/)
})

test('rejects any unresolved P0 or P1 browser defect', async () => {
  const matrix = matrixFixture()
  matrix.defects.unresolvedP1 = 1
  await assert.rejects(() => verifyFixture(matrix), /zero unresolved P0 and P1 defects/)
})

test('rejects defect sign-off that does not postdate all rows', async () => {
  const matrix = matrixFixture()
  matrix.defects.signedOffAt = '2026-07-27T12:00:15.000Z'
  await assert.rejects(() => verifyFixture(matrix), /must postdate every browser row/)
})

test('requires matrix completion to strictly postdate final review', async () => {
  const matrix = matrixFixture()
  matrix.completedAt = matrix.review.reviewedAt
  await assert.rejects(() => verifyFixture(matrix), /must strictly predate matrix completion/)
})

test('rejects Arabic rows without substantive Arabic-script findings', async () => {
  const matrix = matrixFixture()
  matrix.rows.find((row) => row.locale === 'ar').findings =
    'All authoring, save, import, and recovery flows completed successfully.'
  await assert.rejects(() => verifyFixture(matrix), /substantive Arabic-script detail/)
})

test('rejects matrix candidate, artifact, and Pages URL binding mismatches', async (context) => {
  const cases = [
    ['candidate', (matrix) => (matrix.candidateSha = '1'.repeat(40)), /exact candidate SHA/],
    ['artifact', (matrix) => (matrix.artifactSha256 = '2'.repeat(64)), /exact artifact SHA-256/],
    [
      'Pages URL',
      (matrix) => (matrix.pagesUrl = 'https://ahmedak320.github.io/other/'),
      /exact Pages URL/
    ]
  ]
  for (const [name, mutate, expected] of cases) {
    await context.test(name, async () => {
      const matrix = matrixFixture()
      mutate(matrix)
      await assert.rejects(() => verifyFixture(matrix), expected)
    })
  }
})

test('rejects untrusted Pages evidence bindings and chronology', async (context) => {
  const cases = [
    ['schema', { schemaVersion: 2 }, /schemaVersion must be 1/],
    ['gate', { gate: 'other-gate' }, /gate must be orbitpm-lite-browser-environment/],
    ['result', { result: 'failed' }, /result must be passed/],
    ['candidate', { candidateSha: '3'.repeat(40) }, /exact candidate SHA/],
    [
      'artifact',
      { artifact: { path: '/tmp/index.html', sha256: '4'.repeat(64) } },
      /exact release artifact/
    ],
    [
      'relative artifact path',
      { artifact: { path: 'pages-dist/index.html', sha256: artifactSha256 } },
      /absolute HTML path/
    ],
    ['tested URL', { testedUrl: 'https://ahmedak320.github.io/other/' }, /exact Pages URL/],
    ['served URL', { servedFinalUrl: 'https://ahmedak320.github.io/other/' }, /exact Pages URL/],
    ['served digest', { servedSha256: '5'.repeat(64) }, /exact release artifact SHA-256/],
    [
      'old generation',
      { generatedAt: '2026-07-27T09:59:59.999Z' },
      /must not predate candidate readiness/
    ]
  ]
  for (const [name, overrides, expected] of cases) {
    await context.test(name, async () => {
      await assert.rejects(
        () => verifyFixture(matrixFixture(), pagesEvidenceFixture(overrides)),
        expected
      )
    })
  }
})

test('rejects a source whose fetched bytes do not match the trusted SHA-256', async () => {
  const baseline = versionBaselineFixture()
  const baselineBytes = Buffer.from(JSON.stringify(baseline), 'utf8')
  const matrixBytes = Buffer.from(JSON.stringify(matrixFixture(baseline)), 'utf8')
  const pagesBytes = Buffer.from(JSON.stringify(pagesEvidenceFixture()), 'utf8')
  await assert.rejects(
    () =>
      verifyBrowserCompatibilityEvidence({
        candidateSha,
        candidateReadyAt,
        artifactSha256,
        pagesUrl,
        pagesDeploymentEvidenceBytes: pagesBytes,
        sourceUrl: matrixUrl,
        sourceSha256: 'a'.repeat(64),
        versionBaselineUrl,
        versionBaselineSha256: sha256(baselineBytes),
        fetchImpl: makeFetch({ matrixBytes, baselineBytes }),
        now
      }),
    /does not match/
  )
})

test('main writes an exclusive aggregate from the frozen CLI arguments', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orbitpm-browser-matrix-'))
  try {
    const artifactPath = join(directory, 'OrbitPM-Process-Studio-Lite-0.4.5.html')
    const pagesEvidencePath = join(directory, 'pages-browser-environment.json')
    const outputPath = join(directory, 'verified-browser-matrix.json')
    const baseline = versionBaselineFixture()
    const baselineBytes = Buffer.from(JSON.stringify(baseline), 'utf8')
    const matrixBytes = Buffer.from(JSON.stringify(matrixFixture(baseline)), 'utf8')
    writeFileSync(artifactPath, artifactBytes)
    writeFileSync(pagesEvidencePath, JSON.stringify(pagesEvidenceFixture()))

    await main({
      argv: [
        `--candidate-sha=${candidateSha}`,
        `--candidate-ready-at=${candidateReadyAt}`,
        `--artifact=${artifactPath}`,
        `--pages-url=${pagesUrl}`,
        `--pages-deployment-evidence=${pagesEvidencePath}`,
        `--url=${matrixUrl}`,
        `--sha256=${sha256(matrixBytes)}`,
        `--version-baseline-url=${versionBaselineUrl}`,
        `--version-baseline-sha256=${sha256(baselineBytes)}`,
        `--output=${outputPath}`
      ],
      env: {},
      fetchImpl: makeFetch({ matrixBytes, baselineBytes }),
      now
    })

    const aggregate = JSON.parse(readFileSync(outputPath, 'utf8'))
    assert.equal(aggregate.status, 'passed')
    assert.equal(aggregate.candidateSha, candidateSha)
    assert.equal(aggregate.artifactSha256, artifactSha256)
    await assert.rejects(
      () =>
        main({
          argv: [
            `--candidate-sha=${candidateSha}`,
            `--candidate-ready-at=${candidateReadyAt}`,
            `--artifact=${artifactPath}`,
            `--pages-url=${pagesUrl}`,
            `--pages-deployment-evidence=${pagesEvidencePath}`,
            `--url=${matrixUrl}`,
            `--sha256=${sha256(matrixBytes)}`,
            `--version-baseline-url=${versionBaselineUrl}`,
            `--version-baseline-sha256=${sha256(baselineBytes)}`,
            `--output=${outputPath}`
          ],
          env: {},
          fetchImpl: makeFetch({ matrixBytes, baselineBytes }),
          now
        }),
      /EEXIST/
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('main rejects artifact or Pages-evidence replacement during remote verification', async (context) => {
  const cases = [
    ['artifact', 'The exact release artifact'],
    ['Pages evidence', 'The trusted Pages deployment evidence']
  ]
  for (const [name, expectedMessage] of cases) {
    await context.test(name, async () => {
      const directory = mkdtempSync(join(tmpdir(), 'orbitpm-browser-matrix-race-'))
      try {
        const artifactPath = join(directory, 'OrbitPM-Process-Studio-Lite-0.4.5.html')
        const pagesEvidencePath = join(directory, 'pages-browser-environment.json')
        const outputPath = join(directory, 'verified-browser-matrix.json')
        const baseline = versionBaselineFixture()
        const baselineBytes = Buffer.from(JSON.stringify(baseline), 'utf8')
        const matrixBytes = Buffer.from(JSON.stringify(matrixFixture(baseline)), 'utf8')
        writeFileSync(artifactPath, artifactBytes)
        writeFileSync(pagesEvidencePath, JSON.stringify(pagesEvidenceFixture()))

        await assert.rejects(
          () =>
            main({
              argv: [
                `--candidate-sha=${candidateSha}`,
                `--candidate-ready-at=${candidateReadyAt}`,
                `--artifact=${artifactPath}`,
                `--pages-url=${pagesUrl}`,
                `--pages-deployment-evidence=${pagesEvidencePath}`,
                `--url=${matrixUrl}`,
                `--sha256=${sha256(matrixBytes)}`,
                `--version-baseline-url=${versionBaselineUrl}`,
                `--version-baseline-sha256=${sha256(baselineBytes)}`,
                `--output=${outputPath}`
              ],
              env: {},
              fetchImpl: makeFetch({
                matrixBytes,
                baselineBytes,
                beforeResponse: () => {
                  if (name === 'artifact') {
                    writeFileSync(artifactPath, Buffer.from('changed artifact'))
                  } else {
                    writeFileSync(pagesEvidencePath, JSON.stringify({ changed: true }))
                  }
                }
              }),
              now
            }),
          new RegExp(`${expectedMessage} changed`)
        )
        assert.throws(() => readFileSync(outputPath), /ENOENT/)
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    })
  }
})

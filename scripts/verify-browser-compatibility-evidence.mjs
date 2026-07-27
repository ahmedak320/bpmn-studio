import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, dirname, extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  containsArabicDetail,
  fetchVerifiedJson,
  readBodyWithLimit,
  requiredCandidateSha,
  requiredHumanIdentity,
  requiredHttpsUrl,
  requiredImmutableEvidenceUrl,
  requiredSha256,
  requiredString,
  requiredTimestamp,
  sameIdentity,
  substantiveString
} from './verify-external-release-evidence.mjs'

const MATRIX_SCHEMA_VERSION = 2
const VERSION_BASELINE_SCHEMA_VERSION = 1
const PAGES_EVIDENCE_SCHEMA_VERSION = 1
const MAX_MATRIX_BYTES = 1024 * 1024
const MAX_VERSION_BASELINE_BYTES = 1024 * 1024
const MAX_OFFICIAL_SOURCE_BYTES = 2 * 1024 * 1024
const MAX_PAGES_EVIDENCE_BYTES = 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000
const BROWSERS = {
  chrome: {
    name: 'Google Chrome',
    identifier: 'com.google.Chrome'
  },
  edge: {
    name: 'Microsoft Edge',
    identifier: 'com.microsoft.Edge'
  },
  firefox: {
    name: 'Mozilla Firefox',
    identifier: 'org.mozilla.firefox'
  },
  safari: {
    name: 'Safari',
    identifier: 'com.apple.Safari'
  }
}
const RELEASE_LINES = ['current', 'previous']
const LOCALES = ['en', 'ar']
const OPERATING_SYSTEMS = ['Windows', 'macOS', 'Linux']
const VERSION_PATTERN = /^\d+(?:\.\d+){1,3}$/
const OFFICIAL_SOURCE_REQUIREMENTS = {
  chrome: {
    vendor: 'Google',
    adapter: 'chrome-version-history-v1',
    mediaType: 'application/json',
    urlPattern:
      /^https:\/\/versionhistory\.googleapis\.com\/v1\/chrome\/platforms\/(win|win64|mac|mac_arm64|linux)\/channels\/stable\/versions\/all\/releases\?page_size=10000$/
  },
  edge: {
    vendor: 'Microsoft',
    adapter: 'edge-stable-release-notes-v1',
    mediaType: 'text/html',
    officialUrl:
      'https://learn.microsoft.com/en-us/deployedge/microsoft-edge-relnote-stable-channel'
  },
  firefox: {
    vendor: 'Mozilla',
    adapter: 'mozilla-firefox-releases-v1',
    mediaType: 'application/json',
    officialUrl: 'https://product-details.mozilla.org/1.0/firefox.json'
  },
  safari: {
    vendor: 'Apple',
    adapter: 'apple-security-releases-v1',
    mediaType: 'text/html',
    officialUrl: 'https://support.apple.com/en-us/100100'
  }
}

function option(name, fallback, argv = process.argv.slice(2)) {
  const prefix = `${name}=`
  const argument = argv.find((candidate) => candidate.startsWith(prefix))
  return argument?.slice(prefix.length) ?? fallback
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`)
  }
  return value
}

function assertExactKeys(value, expectedKeys, label) {
  requireObject(value, label)
  const actualKeys = Object.keys(value).sort()
  const requiredKeys = [...expectedKeys].sort()
  if (
    actualKeys.length !== requiredKeys.length ||
    actualKeys.some((key, index) => key !== requiredKeys[index])
  ) {
    throw new Error(`${label} must contain exactly these fields: ${requiredKeys.join(', ')}.`)
  }
}

function requireCanonicalCandidateSha(value, label) {
  const candidateSha = requiredCandidateSha(value, label)
  if (value !== candidateSha) {
    throw new Error(`${label} must use canonical lowercase hexadecimal.`)
  }
  return candidateSha
}

function requireCanonicalSha256(value, label) {
  const sha256 = requiredSha256(value, label)
  if (value !== sha256) {
    throw new Error(`${label} must use canonical lowercase hexadecimal.`)
  }
  return sha256
}

function requireCanonicalHttpsUrl(value, label) {
  const canonicalUrl = requiredHttpsUrl(value, label)
  if (value !== canonicalUrl) {
    throw new Error(`${label} must be a canonical HTTPS URL.`)
  }
  return canonicalUrl
}

function requireExactVersion(value, label) {
  const version = requiredString(value, label, { minLength: 3, maxLength: 80 })
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`${label} must be an exact dotted numeric version.`)
  }
  const components = version.split('.').map(Number)
  if (components.some((component) => !Number.isSafeInteger(component))) {
    throw new Error(`${label} contains an out-of-range numeric component.`)
  }
  return { version, major: components[0] }
}

function requirePositiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} must be an integer from 1 through ${maximum}.`)
  }
  return value
}

function requireCanonicalImmutableUrl(value, label) {
  const canonicalUrl = requiredImmutableEvidenceUrl(value, label)
  if (value !== canonicalUrl) {
    throw new Error(`${label} must be a canonical immutable evidence URL.`)
  }
  return canonicalUrl
}

function requireOfficialSourceUrl(value, browser, label) {
  let canonicalUrl
  if (browser === 'chrome') {
    let parsed
    try {
      parsed = new URL(value)
    } catch {
      throw new Error(`${label} must be the canonical Chrome stable-release API URL.`)
    }
    requiredHttpsUrl(`${parsed.origin}${parsed.pathname}`, label)
    canonicalUrl = parsed.toString()
    if (parsed.username || parsed.password || parsed.hash || parsed.search !== '?page_size=10000') {
      throw new Error(`${label} must request exactly page_size=10000 without credentials.`)
    }
  } else {
    canonicalUrl = requiredHttpsUrl(value, label)
  }
  if (value !== canonicalUrl) {
    throw new Error(`${label} must be a canonical official vendor URL.`)
  }
  const requirement = OFFICIAL_SOURCE_REQUIREMENTS[browser]
  if (
    !requirement ||
    (requirement.officialUrl
      ? canonicalUrl !== requirement.officialUrl
      : !requirement.urlPattern.test(canonicalUrl))
  ) {
    throw new Error(`${label} is not the code-allowlisted ${browser} stable-release source.`)
  }
  return canonicalUrl
}

function requireSourceId(value, label) {
  const id = requiredString(value, label, { minLength: 3, maxLength: 80 })
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new Error(`${label} must be a lowercase stable source identifier.`)
  }
  return id
}

function requireCanonicalDay(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be a canonical YYYY-MM-DD date.`)
  }
  const parsed = Date.parse(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a real canonical calendar date.`)
  }
  return parsed + 24 * 60 * 60 * 1000
}

function requirePublishedDay(value, label) {
  const parsed = Date.parse(`${value} UTC`)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} contains an invalid vendor publication date.`)
  }
  return parsed + 24 * 60 * 60 * 1000
}

function parseJsonSource(bytes, label) {
  let json
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`${label} must contain valid UTF-8.`)
  }
  try {
    return JSON.parse(json)
  } catch {
    throw new Error(`${label} must contain valid JSON.`)
  }
}

function decodeUtf8Source(bytes, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`${label} must contain valid UTF-8.`)
  }
}

function normalizeReleaseEvents(events, label) {
  const byVersion = new Map()
  for (const event of events) {
    const { version, major } = requireExactVersion(event.version, `${label}.version`)
    if (!Number.isFinite(event.releasedAt)) {
      throw new Error(`${label} contains an invalid release instant.`)
    }
    if (
      event.endedAt !== undefined &&
      (!Number.isFinite(event.endedAt) || event.endedAt <= event.releasedAt)
    ) {
      throw new Error(`${label} contains an invalid release end instant.`)
    }
    const existing = byVersion.get(version)
    if (!existing || event.releasedAt < existing.releasedAt) {
      byVersion.set(version, { version, major, ...event })
    } else if (
      existing &&
      event.endedAt !== undefined &&
      (existing.endedAt === undefined || event.endedAt > existing.endedAt)
    ) {
      existing.endedAt = event.endedAt
    }
  }
  const normalized = [...byVersion.values()]
  if (normalized.length < 2 || new Set(normalized.map(({ major }) => major)).size < 2) {
    throw new Error(`${label} must expose at least two stable browser release majors.`)
  }
  return normalized
}

function parseChromeReleases(bytes, label) {
  const source = parseJsonSource(bytes, label)
  if (!source || typeof source !== 'object' || !Array.isArray(source.releases)) {
    throw new Error(`${label} must contain the Chrome VersionHistory releases array.`)
  }
  if (source.nextPageToken !== undefined && source.nextPageToken !== '') {
    throw new Error(`${label} must be a complete, unpaginated Chrome release response.`)
  }
  const events = []
  for (const [index, release] of source.releases.entries()) {
    if (!release || typeof release !== 'object' || Array.isArray(release)) continue
    const releasedAt = Date.parse(release.serving?.startTime)
    const endedAt =
      release.serving?.endTime === undefined ? undefined : Date.parse(release.serving.endTime)
    if (
      typeof release.name !== 'string' ||
      !release.name.includes('/channels/stable/') ||
      !Number.isFinite(releasedAt)
    ) {
      continue
    }
    events.push({
      version: release.version,
      releasedAt,
      endedAt,
      sourceIndex: index,
      activeServingInterval: true
    })
  }
  return normalizeReleaseEvents(events, label)
}

function parseEdgeReleases(bytes, label) {
  const html = decodeUtf8Source(bytes, label)
  if (
    !/<title\b[^>]*>[^<]*Microsoft Edge release notes for Stable Channel[^<]*<\/title>/i.test(html)
  ) {
    throw new Error(`${label} is not the Microsoft Edge Stable Channel release-notes page.`)
  }
  const events = []
  const releasePattern =
    /<h2[^>]*>\s*Version (\d+(?:\.\d+){1,3}): ([A-Z][a-z]+ \d{1,2}, \d{4}) \(Stable\)(?: macOS)?\s*<\/h2>/g
  for (const [sourceIndex, match] of [...html.matchAll(releasePattern)].entries()) {
    events.push({
      version: match[1],
      releasedAt: requirePublishedDay(match[2], `${label}.release[${sourceIndex}]`),
      sourceIndex,
      activeServingInterval: false
    })
  }
  return normalizeReleaseEvents(events, label)
}

function parseFirefoxReleases(bytes, label) {
  const source = parseJsonSource(bytes, label)
  if (
    !source ||
    typeof source !== 'object' ||
    !source.releases ||
    typeof source.releases !== 'object' ||
    Array.isArray(source.releases)
  ) {
    throw new Error(`${label} must contain the Mozilla Firefox releases object.`)
  }
  const events = []
  for (const [sourceIndex, release] of Object.values(source.releases).entries()) {
    if (
      !release ||
      typeof release !== 'object' ||
      release.product !== 'firefox' ||
      !['major', 'stability'].includes(release.category) ||
      typeof release.version !== 'string' ||
      /(?:a|b|esr|rc)/i.test(release.version)
    ) {
      continue
    }
    events.push({
      version: release.version,
      releasedAt: requireCanonicalDay(release.date, `${label}.release[${sourceIndex}].date`),
      sourceIndex,
      activeServingInterval: false
    })
  }
  return normalizeReleaseEvents(events, label)
}

function parseSafariReleases(bytes, label) {
  const html = decodeUtf8Source(bytes, label)
  if (!/<title\b[^>]*>[^<]*Apple security releases[^<]*<\/title>/i.test(html)) {
    throw new Error(`${label} is not the Apple security releases page.`)
  }
  const events = []
  for (const row of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const version = row[1].match(/\bSafari (\d+(?:\.\d+){1,3})\b/)?.[1]
    const publishedDay = row[1].match(/\b(\d{2} [A-Z][a-z]{2} \d{4})\b/)?.[1]
    if (!version || !publishedDay || /Technology Preview/i.test(row[1])) continue
    events.push({
      version,
      releasedAt: requirePublishedDay(publishedDay, `${label}.Safari ${version}`),
      sourceIndex: events.length,
      activeServingInterval: false
    })
  }
  return normalizeReleaseEvents(events, label)
}

function parseOfficialReleaseEvents(browser, bytes, label) {
  switch (browser) {
    case 'chrome':
      return parseChromeReleases(bytes, label)
    case 'edge':
      return parseEdgeReleases(bytes, label)
    case 'firefox':
      return parseFirefoxReleases(bytes, label)
    case 'safari':
      return parseSafariReleases(bytes, label)
    default:
      throw new Error(`${label} has no code-defined vendor adapter.`)
  }
}

async function fetchVerifiedOfficialSource({ descriptor, fetchImpl, timeoutMs, label }) {
  const requestedUrl = requireOfficialSourceUrl(
    descriptor.officialUrl,
    descriptor.browser,
    `${label}.url`
  )
  const expectedSha256 = requireCanonicalSha256(descriptor.sha256, `${label}.sha256`)
  const expectedSizeBytes = requirePositiveInteger(
    descriptor.sizeBytes,
    `${label}.sizeBytes`,
    MAX_OFFICIAL_SOURCE_BYTES
  )
  const signal = AbortSignal.timeout(timeoutMs)
  const response = await fetchImpl(requestedUrl, {
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    headers: { Accept: descriptor.mediaType },
    signal
  })
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}.`)
  }
  const finalUrl = requireOfficialSourceUrl(response.url, descriptor.browser, `${label}.finalUrl`)
  if (finalUrl !== requestedUrl) {
    throw new Error(`${label} must not redirect.`)
  }
  const contentType = response.headers?.get?.('content-type')?.split(';', 1)[0]?.trim()
  if (contentType !== descriptor.mediaType) {
    throw new Error(`${label} must return Content-Type ${descriptor.mediaType}.`)
  }
  const bytes = await readBodyWithLimit(response, MAX_OFFICIAL_SOURCE_BYTES, label, signal)
  if (bytes.byteLength !== expectedSizeBytes) {
    throw new Error(
      `${label} size ${bytes.byteLength} does not match the pinned ${expectedSizeBytes} bytes.`
    )
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== expectedSha256) {
    throw new Error(`${label} SHA-256 ${sha256} does not match ${expectedSha256}.`)
  }
  return {
    id: descriptor.id,
    browser: descriptor.browser,
    url: requestedUrl,
    finalUrl,
    sha256,
    sizeBytes: bytes.byteLength,
    bodyBase64: bytes.toString('base64'),
    releaseEvents: parseOfficialReleaseEvents(descriptor.browser, bytes, label)
  }
}

function requireExactIdentity(value, label) {
  assertExactKeys(value, ['name', 'organization', 'role', 'accountId'], label)
  return requiredHumanIdentity(value, label)
}

function identitiesMatchExactly(left, right) {
  return (
    left.name === right.name &&
    left.organization === right.organization &&
    left.role === right.role &&
    left.accountId === right.accountId
  )
}

function registerStableIdentity(identity, label, registry) {
  const existing = registry.find(({ identity: candidate }) => sameIdentity(candidate, identity))
  if (existing && !identitiesMatchExactly(existing.identity, identity)) {
    throw new Error(
      `${label} conflicts with ${existing.label}; one human identity must use one stable account and profile.`
    )
  }
  if (!existing) registry.push({ identity, label })
}

function decodeJsonBytes(bytes, label, maxBytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw new Error(`${label} must be supplied as bytes.`)
  }
  const buffer = Buffer.from(bytes)
  if (buffer.byteLength === 0 || buffer.byteLength > maxBytes) {
    throw new Error(`${label} must contain from 1 through ${maxBytes} bytes.`)
  }
  let json
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw new Error(`${label} must contain valid UTF-8 JSON.`)
  }
  try {
    return { buffer, record: JSON.parse(json) }
  } catch {
    throw new Error(`${label} must contain valid JSON.`)
  }
}

function assertFileSnapshotStable(path, expectedBytes, label) {
  const currentBytes = readFileSync(path)
  if (!currentBytes.equals(expectedBytes)) {
    throw new Error(`${label} changed while browser compatibility evidence was verified.`)
  }
}

function validatePagesDeploymentEvidence({
  record,
  candidateSha,
  artifactSha256,
  pagesUrl,
  candidateReadyAt,
  now
}) {
  const label = 'Trusted Pages deployment evidence'
  requireObject(record, label)
  if (record.schemaVersion !== PAGES_EVIDENCE_SCHEMA_VERSION) {
    throw new Error(`${label}.schemaVersion must be ${PAGES_EVIDENCE_SCHEMA_VERSION}.`)
  }
  if (record.gate !== 'orbitpm-lite-browser-environment') {
    throw new Error(`${label}.gate must be orbitpm-lite-browser-environment.`)
  }
  if (record.result !== 'passed') {
    throw new Error(`${label}.result must be passed.`)
  }
  const generatedAt = requiredTimestamp(record.generatedAt, `${label}.generatedAt`, now)
  if (generatedAt < candidateReadyAt) {
    throw new Error(`${label}.generatedAt must not predate candidate readiness.`)
  }
  if (requireCanonicalCandidateSha(record.candidateSha, `${label}.candidateSha`) !== candidateSha) {
    throw new Error(`${label} is not bound to the exact candidate SHA.`)
  }

  assertExactKeys(record.artifact, ['path', 'sha256'], `${label}.artifact`)
  const artifactPath = requiredString(record.artifact.path, `${label}.artifact.path`, {
    minLength: 2,
    maxLength: 4_096
  })
  if (!isAbsolute(artifactPath) || extname(artifactPath).toLocaleLowerCase('en-US') !== '.html') {
    throw new Error(`${label}.artifact.path must be an absolute HTML path.`)
  }
  if (
    requireCanonicalSha256(record.artifact.sha256, `${label}.artifact.sha256`) !== artifactSha256
  ) {
    throw new Error(`${label}.artifact is not bound to the exact release artifact.`)
  }
  if (
    requireCanonicalHttpsUrl(record.testedUrl, `${label}.testedUrl`) !== pagesUrl ||
    requireCanonicalHttpsUrl(record.servedFinalUrl, `${label}.servedFinalUrl`) !== pagesUrl
  ) {
    throw new Error(`${label} testedUrl and servedFinalUrl must equal the exact Pages URL.`)
  }
  if (requireCanonicalSha256(record.servedSha256, `${label}.servedSha256`) !== artifactSha256) {
    throw new Error(`${label}.servedSha256 must equal the exact release artifact SHA-256.`)
  }
  return generatedAt
}

function validateVersionBaseline({
  record,
  candidateSha,
  artifactSha256,
  pagesUrl,
  candidateReadyAt,
  pagesGeneratedAt,
  now
}) {
  const label = 'Browser vendor-version baseline'
  assertExactKeys(
    record,
    [
      'schemaVersion',
      'gate',
      'result',
      'candidateSha',
      'artifactSha256',
      'pagesUrl',
      'generatedAt',
      'versions',
      'sources'
    ],
    label
  )
  if (record.schemaVersion !== VERSION_BASELINE_SCHEMA_VERSION) {
    throw new Error(`${label}.schemaVersion must be ${VERSION_BASELINE_SCHEMA_VERSION}.`)
  }
  if (record.gate !== 'orbitpm-lite-browser-vendor-version-baseline') {
    throw new Error(`${label}.gate must be orbitpm-lite-browser-vendor-version-baseline.`)
  }
  if (record.result !== 'passed') {
    throw new Error(`${label}.result must be passed.`)
  }
  if (requireCanonicalCandidateSha(record.candidateSha, `${label}.candidateSha`) !== candidateSha) {
    throw new Error(`${label} is not bound to the exact candidate SHA.`)
  }
  if (requireCanonicalSha256(record.artifactSha256, `${label}.artifactSha256`) !== artifactSha256) {
    throw new Error(`${label} is not bound to the exact artifact SHA-256.`)
  }
  if (requireCanonicalHttpsUrl(record.pagesUrl, `${label}.pagesUrl`) !== pagesUrl) {
    throw new Error(`${label} is not bound to the exact Pages URL.`)
  }
  const generatedAt = requiredTimestamp(record.generatedAt, `${label}.generatedAt`, now)
  if (generatedAt <= candidateReadyAt || generatedAt <= pagesGeneratedAt) {
    throw new Error(`${label}.generatedAt must strictly postdate candidate readiness and Pages.`)
  }

  if (!Array.isArray(record.sources) || record.sources.length !== Object.keys(BROWSERS).length) {
    throw new Error(`${label}.sources must contain exactly one source for each browser.`)
  }
  const sourceIds = new Set()
  const sourceBrowsers = new Set()
  const sources = []
  for (const [index, source] of record.sources.entries()) {
    const sourceLabel = `${label}.sources[${index}]`
    assertExactKeys(
      source,
      [
        'id',
        'browser',
        'vendor',
        'adapter',
        'officialUrl',
        'retrievedAt',
        'mediaType',
        'sha256',
        'sizeBytes'
      ],
      sourceLabel
    )
    const requirement = OFFICIAL_SOURCE_REQUIREMENTS[source.browser]
    if (!requirement) {
      throw new Error(`${sourceLabel}.browser must be chrome, edge, firefox, or safari.`)
    }
    const id = requireSourceId(source.id, `${sourceLabel}.id`)
    if (sourceIds.has(id)) {
      throw new Error(`${label}.sources must use unique source IDs.`)
    }
    if (sourceBrowsers.has(source.browser)) {
      throw new Error(`${label}.sources must contain exactly one source per browser.`)
    }
    sourceIds.add(id)
    sourceBrowsers.add(source.browser)
    if (
      source.vendor !== requirement.vendor ||
      source.adapter !== requirement.adapter ||
      source.mediaType !== requirement.mediaType
    ) {
      throw new Error(
        `${sourceLabel} must use the code-defined ${source.browser} vendor, adapter, and media type.`
      )
    }
    const officialUrl = requireOfficialSourceUrl(
      source.officialUrl,
      source.browser,
      `${sourceLabel}.officialUrl`
    )
    const retrievedAt = requiredTimestamp(source.retrievedAt, `${sourceLabel}.retrievedAt`, now)
    if (retrievedAt < pagesGeneratedAt) {
      throw new Error(`${sourceLabel}.retrievedAt must not predate trusted Pages evidence.`)
    }
    if (retrievedAt > generatedAt) {
      throw new Error(`${sourceLabel}.retrievedAt must not postdate baseline generation.`)
    }
    sources.push({
      ...source,
      id,
      officialUrl,
      retrievedAt,
      sha256: requireCanonicalSha256(source.sha256, `${sourceLabel}.sha256`),
      sizeBytes: requirePositiveInteger(
        source.sizeBytes,
        `${sourceLabel}.sizeBytes`,
        MAX_OFFICIAL_SOURCE_BYTES
      )
    })
  }

  const requiredVersionCount = Object.keys(BROWSERS).length * RELEASE_LINES.length
  if (!Array.isArray(record.versions) || record.versions.length !== requiredVersionCount) {
    throw new Error(`${label}.versions must contain exactly ${requiredVersionCount} entries.`)
  }
  const versions = new Map()
  for (const [index, entry] of record.versions.entries()) {
    const entryLabel = `${label}.versions[${index}]`
    assertExactKeys(
      entry,
      [
        'browser',
        'release',
        'browserName',
        'browserIdentifier',
        'browserVersion',
        'operatingSystem',
        'operatingSystemVersion',
        'channel',
        'sourceId'
      ],
      entryLabel
    )
    const browserRequirement = BROWSERS[entry.browser]
    if (!browserRequirement) {
      throw new Error(`${entryLabel}.browser must be chrome, edge, firefox, or safari.`)
    }
    if (!RELEASE_LINES.includes(entry.release)) {
      throw new Error(`${entryLabel}.release must be current or previous.`)
    }
    const key = `${entry.browser}:${entry.release}`
    if (versions.has(key)) {
      throw new Error(`${label}.versions duplicates ${key}.`)
    }
    if (
      entry.browserName !== browserRequirement.name ||
      entry.browserIdentifier !== browserRequirement.identifier
    ) {
      throw new Error(`${entryLabel} must use the code-defined browser name and identifier.`)
    }
    const { version: browserVersion } = requireExactVersion(
      entry.browserVersion,
      `${entryLabel}.browserVersion`
    )
    if (!OPERATING_SYSTEMS.includes(entry.operatingSystem)) {
      throw new Error(`${entryLabel}.operatingSystem must be Windows, macOS, or Linux.`)
    }
    requireExactVersion(entry.operatingSystemVersion, `${entryLabel}.operatingSystemVersion`)
    if (entry.browser === 'safari' && entry.operatingSystem !== 'macOS') {
      throw new Error(`${entryLabel} must record genuine Safari on macOS.`)
    }
    if (entry.channel !== 'stable') {
      throw new Error(`${entryLabel}.channel must be stable.`)
    }
    const sourceId = requireSourceId(entry.sourceId, `${entryLabel}.sourceId`)
    const source = sources.find((candidate) => candidate.id === sourceId)
    if (!source || source.browser !== entry.browser) {
      throw new Error(`${entryLabel}.sourceId must reference this browser's official source.`)
    }
    versions.set(key, { ...entry, browserVersion, sourceId })
  }
  for (const browser of Object.keys(BROWSERS)) {
    const current = versions.get(`${browser}:current`)
    const previous = versions.get(`${browser}:previous`)
    if (!current || !previous) {
      throw new Error(`${label}.versions must cover ${browser} current and previous.`)
    }
    if (
      current.operatingSystem !== previous.operatingSystem ||
      current.operatingSystemVersion !== previous.operatingSystemVersion
    ) {
      throw new Error(
        `${label} ${browser} current and previous entries must use the same exact OS version.`
      )
    }
    if (browser === 'chrome') {
      const platform = new URL(
        sources.find((source) => source.browser === browser).officialUrl
      ).pathname.split('/')[4]
      const compatible =
        (current.operatingSystem === 'Windows' && ['win', 'win64'].includes(platform)) ||
        (current.operatingSystem === 'macOS' && ['mac', 'mac_arm64'].includes(platform)) ||
        (current.operatingSystem === 'Linux' && platform === 'linux')
      if (!compatible) {
        throw new Error(`${label} Chrome source platform must match the tested operating system.`)
      }
    }
  }
  if (new Set([...versions.values()].map(({ sourceId }) => sourceId)).size !== sources.length) {
    throw new Error(`${label}.sources must all be referenced by version entries.`)
  }
  return { generatedAt, sources, versions }
}

function compareDottedVersions(left, right) {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function validateVendorClassification({ row, entry, source, label }) {
  const availableEvents = source.releaseEvents.filter(
    ({ releasedAt }) => releasedAt <= row.testedAt
  )
  const majorFirstRelease = new Map()
  for (const event of availableEvents) {
    const firstRelease = majorFirstRelease.get(event.major)
    if (firstRelease === undefined || event.releasedAt < firstRelease) {
      majorFirstRelease.set(event.major, event.releasedAt)
    }
  }
  const orderedMajors = [...majorFirstRelease.entries()]
    .sort((left, right) => left[1] - right[1] || left[0] - right[0])
    .map(([major]) => major)
  if (orderedMajors.length < 2) {
    throw new Error(`${label} has no authoritative current/previous stable-major pair at testedAt.`)
  }
  const expectedMajor = row.release === 'current' ? orderedMajors.at(-1) : orderedMajors.at(-2)
  if (row.browserMajor !== expectedMajor) {
    throw new Error(
      `${label}.browserVersion is not the vendor-authoritative ${row.release} stable major at testedAt.`
    )
  }
  const matchingEvents = availableEvents.filter(
    ({ version, major }) => version === entry.browserVersion && major === expectedMajor
  )
  if (matchingEvents.length === 0) {
    throw new Error(`${label}.browserVersion is absent from its authoritative stable source.`)
  }
  const majorEvents = availableEvents.filter(({ major }) => major === expectedMajor)
  const latestEvent = majorEvents
    .sort(
      (left, right) =>
        left.releasedAt - right.releasedAt || compareDottedVersions(left.version, right.version)
    )
    .at(-1)
  const activelyServed = matchingEvents.some(
    ({ releasedAt, endedAt, activeServingInterval }) =>
      activeServingInterval &&
      releasedAt <= row.testedAt &&
      (endedAt === undefined || row.testedAt < endedAt)
  )
  if (!activelyServed && latestEvent.version !== entry.browserVersion) {
    throw new Error(
      `${label}.browserVersion is not the latest authoritative patch for its stable major at testedAt.`
    )
  }
}

function rowCoverageKey(browser, release, locale) {
  return `${browser}:${release}:${locale}`
}

function validateMatrix({
  matrix,
  candidateSha,
  artifactSha256,
  pagesUrl,
  candidateReadyAt,
  pagesGeneratedAt,
  versionBaseline,
  versionBaselineUrl,
  versionBaselineSha256,
  officialSources,
  now
}) {
  assertExactKeys(
    matrix,
    [
      'schemaVersion',
      'gate',
      'result',
      'candidateSha',
      'artifactSha256',
      'pagesUrl',
      'versionBaseline',
      'completedAt',
      'rows',
      'defects',
      'review'
    ],
    'Browser compatibility matrix'
  )
  if (matrix.schemaVersion !== MATRIX_SCHEMA_VERSION) {
    throw new Error(`Browser compatibility matrix.schemaVersion must be ${MATRIX_SCHEMA_VERSION}.`)
  }
  if (matrix.gate !== 'orbitpm-lite-browser-compatibility') {
    throw new Error('Browser compatibility matrix.gate must be orbitpm-lite-browser-compatibility.')
  }
  if (matrix.result !== 'passed') {
    throw new Error('Browser compatibility matrix.result must be passed.')
  }
  if (
    requireCanonicalCandidateSha(
      matrix.candidateSha,
      'Browser compatibility matrix.candidateSha'
    ) !== candidateSha
  ) {
    throw new Error('Browser compatibility matrix is not bound to the exact candidate SHA.')
  }
  if (
    requireCanonicalSha256(matrix.artifactSha256, 'Browser compatibility matrix.artifactSha256') !==
    artifactSha256
  ) {
    throw new Error('Browser compatibility matrix is not bound to the exact artifact SHA-256.')
  }
  if (
    requireCanonicalHttpsUrl(matrix.pagesUrl, 'Browser compatibility matrix.pagesUrl') !== pagesUrl
  ) {
    throw new Error('Browser compatibility matrix is not bound to the exact Pages URL.')
  }
  assertExactKeys(
    matrix.versionBaseline,
    ['url', 'sha256'],
    'Browser compatibility matrix.versionBaseline'
  )
  if (
    requireCanonicalImmutableUrl(
      matrix.versionBaseline.url,
      'Browser compatibility matrix.versionBaseline.url'
    ) !== versionBaselineUrl ||
    requireCanonicalSha256(
      matrix.versionBaseline.sha256,
      'Browser compatibility matrix.versionBaseline.sha256'
    ) !== versionBaselineSha256
  ) {
    throw new Error(
      'Browser compatibility matrix is not bound to the exact vendor-version baseline.'
    )
  }
  const completedAt = requiredTimestamp(
    matrix.completedAt,
    'Browser compatibility matrix.completedAt',
    now
  )

  const expectedCoverage = Object.keys(BROWSERS).flatMap((browser) =>
    RELEASE_LINES.flatMap((release) =>
      LOCALES.map((locale) => rowCoverageKey(browser, release, locale))
    )
  )
  if (!Array.isArray(matrix.rows) || matrix.rows.length !== expectedCoverage.length) {
    throw new Error(
      `Browser compatibility matrix.rows must contain exactly ${expectedCoverage.length} rows.`
    )
  }
  const rows = matrix.rows

  const observedCoverage = new Set()
  const operatorRegistry = []
  const normalizedRows = []
  let latestTestedAt = 0
  for (const [index, row] of rows.entries()) {
    const label = `Browser compatibility matrix.rows[${index}]`
    assertExactKeys(
      row,
      [
        'browser',
        'release',
        'locale',
        'result',
        'operator',
        'operatingSystem',
        'operatingSystemVersion',
        'browserName',
        'browserIdentifier',
        'browserVersion',
        'automationEngine',
        'operationMode',
        'testedAt',
        'findings'
      ],
      label
    )
    const browserRequirement = BROWSERS[row.browser]
    if (!browserRequirement) {
      throw new Error(`${label}.browser must be chrome, edge, firefox, or safari.`)
    }
    if (!RELEASE_LINES.includes(row.release)) {
      throw new Error(`${label}.release must be current or previous.`)
    }
    if (!LOCALES.includes(row.locale)) {
      throw new Error(`${label}.locale must be en or ar.`)
    }
    const coverageKey = rowCoverageKey(row.browser, row.release, row.locale)
    if (observedCoverage.has(coverageKey)) {
      throw new Error(`Browser compatibility matrix.rows duplicates ${coverageKey}.`)
    }
    observedCoverage.add(coverageKey)
    if (row.result !== 'passed') {
      throw new Error(`${label}.result must be passed.`)
    }

    const operator = requireExactIdentity(row.operator, `${label}.operator`)
    registerStableIdentity(operator, `${label}.operator`, operatorRegistry)
    if (!OPERATING_SYSTEMS.includes(row.operatingSystem)) {
      throw new Error(`${label}.operatingSystem must be Windows, macOS, or Linux.`)
    }
    requireExactVersion(row.operatingSystemVersion, `${label}.operatingSystemVersion`)
    if (row.browserName !== browserRequirement.name) {
      throw new Error(`${label}.browserName must be ${browserRequirement.name}.`)
    }
    if (row.browserIdentifier !== browserRequirement.identifier) {
      throw new Error(`${label}.browserIdentifier must be ${browserRequirement.identifier}.`)
    }
    if (
      row.browser === 'safari' &&
      (row.operatingSystem !== 'macOS' ||
        row.browserName !== 'Safari' ||
        row.browserIdentifier !== 'com.apple.Safari')
    ) {
      throw new Error(`${label} must record genuine Safari on macOS.`)
    }
    if (row.automationEngine !== 'none' || row.operationMode !== 'human-operated') {
      throw new Error(
        `${label} must record automationEngine=none and operationMode=human-operated.`
      )
    }
    const { version: browserVersion, major: browserMajor } = requireExactVersion(
      row.browserVersion,
      `${label}.browserVersion`
    )
    const testedAt = requiredTimestamp(row.testedAt, `${label}.testedAt`, now)
    if (testedAt <= candidateReadyAt) {
      throw new Error(`${label}.testedAt must strictly postdate candidate readiness.`)
    }
    if (testedAt <= pagesGeneratedAt) {
      throw new Error(
        `${label}.testedAt must strictly postdate the trusted Pages deployment evidence.`
      )
    }
    if (testedAt > completedAt) {
      throw new Error(`${label}.testedAt must not postdate matrix completion.`)
    }
    latestTestedAt = Math.max(latestTestedAt, testedAt)

    const baselineEntry = versionBaseline.versions.get(`${row.browser}:${row.release}`)
    if (
      !baselineEntry ||
      baselineEntry.browserName !== row.browserName ||
      baselineEntry.browserIdentifier !== row.browserIdentifier ||
      baselineEntry.browserVersion !== browserVersion ||
      baselineEntry.operatingSystem !== row.operatingSystem ||
      baselineEntry.operatingSystemVersion !== row.operatingSystemVersion
    ) {
      throw new Error(`${label} must exactly match its SHA-pinned vendor-version baseline entry.`)
    }
    const sourceDescriptor = versionBaseline.sources.find(({ id }) => id === baselineEntry.sourceId)
    const officialSource = officialSources.get(baselineEntry.sourceId)
    if (!sourceDescriptor || !officialSource) {
      throw new Error(`${label} has no verified authoritative vendor source.`)
    }
    if (sourceDescriptor.retrievedAt <= testedAt) {
      throw new Error(`${label}.testedAt must strictly predate its authoritative source retrieval.`)
    }
    validateVendorClassification({
      row: { ...row, browserVersion, browserMajor, testedAt },
      entry: baselineEntry,
      source: officialSource,
      label
    })

    const findings = substantiveString(row.findings, `${label}.findings`, {
      minLength: 30,
      maxLength: 2_000,
      minWords: 5
    })
    if (row.locale === 'ar' && !containsArabicDetail(findings)) {
      throw new Error(`${label}.findings must contain substantive Arabic-script detail.`)
    }
    normalizedRows.push({
      ...row,
      operator,
      browserVersion,
      browserMajor,
      testedAt
    })
  }

  if (
    observedCoverage.size !== expectedCoverage.length ||
    expectedCoverage.some((coverageKey) => !observedCoverage.has(coverageKey))
  ) {
    throw new Error(
      'Browser compatibility matrix.rows must cover every browser/release/locale combination.'
    )
  }

  for (const browser of Object.keys(BROWSERS)) {
    for (const release of RELEASE_LINES) {
      const pairedRows = normalizedRows.filter(
        (row) => row.browser === browser && row.release === release
      )
      const [first, second] = pairedRows
      if (
        first.browserVersion !== second.browserVersion ||
        first.operatingSystem !== second.operatingSystem ||
        first.operatingSystemVersion !== second.operatingSystemVersion
      ) {
        throw new Error(
          `Browser compatibility matrix ${browser}:${release} English and Arabic rows must use the same exact browser and OS versions.`
        )
      }
    }
  }

  const defectLabel = 'Browser compatibility matrix.defects'
  assertExactKeys(
    matrix.defects,
    ['unresolvedP0', 'unresolvedP1', 'signedOffBy', 'signedOffAt', 'findings'],
    defectLabel
  )
  if (matrix.defects.unresolvedP0 !== 0 || matrix.defects.unresolvedP1 !== 0) {
    throw new Error(`${defectLabel} must record zero unresolved P0 and P1 defects.`)
  }
  const defectSignatory = requireExactIdentity(
    matrix.defects.signedOffBy,
    `${defectLabel}.signedOffBy`
  )
  if (operatorRegistry.some(({ identity }) => sameIdentity(identity, defectSignatory))) {
    throw new Error(`${defectLabel}.signedOffBy must be independent of all browser operators.`)
  }
  const defectSignedOffAt = requiredTimestamp(
    matrix.defects.signedOffAt,
    `${defectLabel}.signedOffAt`,
    now
  )
  if (defectSignedOffAt <= latestTestedAt) {
    throw new Error(`${defectLabel}.signedOffAt must postdate every browser row.`)
  }
  if (versionBaseline.generatedAt <= latestTestedAt) {
    throw new Error('Browser vendor-version baseline.generatedAt must postdate every browser row.')
  }
  if (defectSignedOffAt <= versionBaseline.generatedAt) {
    throw new Error(
      `${defectLabel}.signedOffAt must postdate the vendor-version baseline generation.`
    )
  }
  if (defectSignedOffAt > completedAt) {
    throw new Error(`${defectLabel}.signedOffAt must not postdate matrix completion.`)
  }
  substantiveString(matrix.defects.findings, `${defectLabel}.findings`, {
    minLength: 40
  })

  const reviewLabel = 'Browser compatibility matrix.review'
  assertExactKeys(
    matrix.review,
    ['approved', 'independentOfEvidenceProduction', 'reviewedBy', 'reviewedAt', 'findings'],
    reviewLabel
  )
  if (matrix.review.approved !== true || matrix.review.independentOfEvidenceProduction !== true) {
    throw new Error(`${reviewLabel} must record approved independent human review.`)
  }
  const reviewer = requireExactIdentity(matrix.review.reviewedBy, `${reviewLabel}.reviewedBy`)
  if (operatorRegistry.some(({ identity }) => sameIdentity(identity, reviewer))) {
    throw new Error(`${reviewLabel}.reviewedBy must be distinct from every browser operator.`)
  }
  const reviewedAt = requiredTimestamp(matrix.review.reviewedAt, `${reviewLabel}.reviewedAt`, now)
  if (reviewedAt <= defectSignedOffAt) {
    throw new Error(`${reviewLabel}.reviewedAt must postdate the browser defect sign-off.`)
  }
  if (reviewedAt >= completedAt) {
    throw new Error(`${reviewLabel}.reviewedAt must strictly predate matrix completion.`)
  }
  substantiveString(matrix.review.findings, `${reviewLabel}.findings`, { minLength: 40 })
}

export async function verifyBrowserCompatibilityEvidence({
  candidateSha: candidateShaInput,
  candidateReadyAt: candidateReadyAtInput,
  artifactSha256: artifactSha256Input,
  pagesUrl: pagesUrlInput,
  pagesDeploymentEvidenceBytes,
  pagesDeploymentEvidencePath = 'trusted-pages-deployment-evidence.json',
  sourceUrl,
  sourceSha256,
  versionBaselineUrl,
  versionBaselineSha256,
  fetchImpl = fetch,
  now = Date.now(),
  timeoutMs = FETCH_TIMEOUT_MS
}) {
  if (!Number.isFinite(now)) {
    throw new Error('Verification time must be finite.')
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > FETCH_TIMEOUT_MS) {
    throw new Error(`Fetch timeout must be an integer from 1 through ${FETCH_TIMEOUT_MS} ms.`)
  }
  const candidateSha = requiredCandidateSha(candidateShaInput, '--candidate-sha')
  const candidateReadyAt = requiredTimestamp(candidateReadyAtInput, '--candidate-ready-at', now)
  const artifactSha256 = requiredSha256(artifactSha256Input, 'artifact SHA-256')
  const pagesUrl = requireCanonicalHttpsUrl(pagesUrlInput, '--pages-url')
  const pagesEvidence = decodeJsonBytes(
    pagesDeploymentEvidenceBytes,
    'Trusted Pages deployment evidence',
    MAX_PAGES_EVIDENCE_BYTES
  )
  const pagesGeneratedAt = validatePagesDeploymentEvidence({
    record: pagesEvidence.record,
    candidateSha,
    artifactSha256,
    pagesUrl,
    candidateReadyAt,
    now
  })

  if (
    requireCanonicalImmutableUrl(sourceUrl, 'External browser compatibility matrix.url') ===
    requireCanonicalImmutableUrl(versionBaselineUrl, 'Browser vendor-version baseline.url')
  ) {
    throw new Error(
      'Browser compatibility matrix and vendor-version baseline must use distinct immutable URLs.'
    )
  }
  const [source, baselineSource] = await Promise.all([
    fetchVerifiedJson({
      url: sourceUrl,
      expectedSha256: sourceSha256,
      label: 'External browser compatibility matrix',
      maxBytes: MAX_MATRIX_BYTES,
      fetchImpl,
      timeoutMs
    }),
    fetchVerifiedJson({
      url: versionBaselineUrl,
      expectedSha256: versionBaselineSha256,
      label: 'Browser vendor-version baseline',
      maxBytes: MAX_VERSION_BASELINE_BYTES,
      fetchImpl,
      timeoutMs
    })
  ])
  const versionBaseline = validateVersionBaseline({
    record: baselineSource.record,
    candidateSha,
    artifactSha256,
    pagesUrl,
    candidateReadyAt,
    pagesGeneratedAt,
    now
  })
  const fetchedOfficialSources = await Promise.all(
    versionBaseline.sources.map((descriptor) =>
      fetchVerifiedOfficialSource({
        descriptor,
        fetchImpl,
        timeoutMs,
        label: `Official ${descriptor.browser} stable-release source`
      })
    )
  )
  const officialSources = new Map(
    fetchedOfficialSources.map((officialSource) => [officialSource.id, officialSource])
  )
  validateMatrix({
    matrix: source.record,
    candidateSha,
    artifactSha256,
    pagesUrl,
    candidateReadyAt,
    pagesGeneratedAt,
    versionBaseline,
    versionBaselineUrl: baselineSource.requestedUrl,
    versionBaselineSha256: baselineSource.sha256,
    officialSources,
    now
  })

  return {
    schemaVersion: 2,
    gate: 'orbitpm-lite-browser-compatibility-evidence',
    status: 'passed',
    verifiedAt: new Date(now).toISOString(),
    candidateSha,
    candidateReadyAt: new Date(candidateReadyAt).toISOString(),
    artifactSha256,
    pagesUrl,
    policy: {
      matrixSchemaVersion: MATRIX_SCHEMA_VERSION,
      versionBaselineSchemaVersion: VERSION_BASELINE_SCHEMA_VERSION,
      pagesEvidenceSchemaVersion: PAGES_EVIDENCE_SCHEMA_VERSION,
      requiredRows: Object.keys(BROWSERS).length * RELEASE_LINES.length * LOCALES.length,
      fetchTimeoutMs: timeoutMs,
      matrixMaxBytes: MAX_MATRIX_BYTES,
      versionBaselineMaxBytes: MAX_VERSION_BASELINE_BYTES,
      officialSourceMaxBytes: MAX_OFFICIAL_SOURCE_BYTES,
      pagesEvidenceMaxBytes: MAX_PAGES_EVIDENCE_BYTES
    },
    pagesDeploymentEvidence: {
      path: resolve(pagesDeploymentEvidencePath),
      sha256: createHash('sha256').update(pagesEvidence.buffer).digest('hex'),
      sizeBytes: pagesEvidence.buffer.byteLength,
      bodyBase64: pagesEvidence.buffer.toString('base64'),
      record: pagesEvidence.record
    },
    source: {
      url: source.requestedUrl,
      finalUrl: source.finalUrl,
      sha256: source.sha256,
      sizeBytes: source.sizeBytes,
      bodyBase64: source.bodyBase64
    },
    versionBaseline: {
      source: {
        url: baselineSource.requestedUrl,
        finalUrl: baselineSource.finalUrl,
        sha256: baselineSource.sha256,
        sizeBytes: baselineSource.sizeBytes,
        bodyBase64: baselineSource.bodyBase64
      },
      evidence: baselineSource.record,
      officialSources: fetchedOfficialSources.map(
        ({ id, browser, url, finalUrl, sha256, sizeBytes, bodyBase64 }) => ({
          id,
          browser,
          url,
          finalUrl,
          sha256,
          sizeBytes,
          bodyBase64
        })
      )
    },
    evidence: source.record
  }
}

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  now = Date.now()
} = {}) {
  const candidateSha = option('--candidate-sha', env.GITHUB_SHA, argv)
  const candidateReadyAt = option('--candidate-ready-at', undefined, argv)
  const artifactArgument = option('--artifact', undefined, argv)
  const pagesUrl = option('--pages-url', undefined, argv)
  const pagesEvidenceArgument = option('--pages-deployment-evidence', undefined, argv)
  const sourceUrl = option('--url', undefined, argv)
  const sourceSha256 = option('--sha256', undefined, argv)
  const versionBaselineUrl = option('--version-baseline-url', undefined, argv)
  const versionBaselineSha256 = option('--version-baseline-sha256', undefined, argv)
  if (!artifactArgument) {
    throw new Error('--artifact is required for exact release-artifact binding.')
  }
  if (!pagesEvidenceArgument) {
    throw new Error('--pages-deployment-evidence is required.')
  }

  const artifactPath = resolve(artifactArgument)
  const artifactBytes = readFileSync(artifactPath)
  const artifactSha256 = createHash('sha256').update(artifactBytes).digest('hex')
  const pagesDeploymentEvidencePath = resolve(pagesEvidenceArgument)
  const pagesDeploymentEvidenceBytes = readFileSync(pagesDeploymentEvidencePath)
  const outputPath = resolve(
    option('--output', 'verified-browser-compatibility-evidence.json', argv)
  )

  const verification = await verifyBrowserCompatibilityEvidence({
    candidateSha,
    candidateReadyAt,
    artifactSha256,
    pagesUrl,
    pagesDeploymentEvidenceBytes,
    pagesDeploymentEvidencePath,
    sourceUrl,
    sourceSha256,
    versionBaselineUrl,
    versionBaselineSha256,
    fetchImpl,
    now
  })
  assertFileSnapshotStable(artifactPath, artifactBytes, 'The exact release artifact')
  assertFileSnapshotStable(
    pagesDeploymentEvidencePath,
    pagesDeploymentEvidenceBytes,
    'The trusted Pages deployment evidence'
  )
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(verification, null, 2)}\n`, { flag: 'wx' })
  console.log(
    `Verified 16 post-Pages vendor-current/previous Chrome, Edge, Firefox, and genuine Safari human compatibility rows at matrix SHA-256 ${verification.source.sha256} and baseline SHA-256 ${verification.versionBaseline.source.sha256}.`
  )
  return verification
}

const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedAsScript) {
  await main()
}

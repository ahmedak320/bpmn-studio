# Post-Pages browser compatibility evidence

Browser compatibility is a separate, mandatory post-Pages gate. It is not a
sixth entry in the pre-tag external approval manifest. The release sequence is:

1. verify the five-record external approval manifest;
2. create the annotated tag and draft release;
3. deploy the exact draft artifact to the canonical Pages URL;
4. execute the human browser matrix;
5. retrieve and pin the four official stable-release sources, publish the
   separate vendor-version baseline, then publish the matrix that binds it; and
6. run release finalization with both immutable records' URLs and SHA-256
   digests.

[`BROWSER_COMPATIBILITY_EVIDENCE.example.json`](BROWSER_COMPATIBILITY_EVIDENCE.example.json)
and
[`BROWSER_VERSION_BASELINE.example.json`](BROWSER_VERSION_BASELINE.example.json)
are intentionally invalid templates. Every `REPLACE ...` value must be
replaced with observed evidence before publication.

## Immutable publication and invocation

The matrix, baseline, pre-tag manifest, and every nested release-evidence
record must use this exact namespace:

```text
https://raw.githubusercontent.com/ahmedak320/bpmn-studio/<non-zero-lowercase-40-character-commit>/release-evidence/v0.4.5/<record>.json
```

No other owner, repository, host, branch, tag, path prefix, query, fragment,
credential, port, IP literal, encoded path, or redirect is accepted. A
commit-pinned record in an attacker-controlled repository is not trusted. The
verifier disables redirects, revalidates the final URL, streams under a fixed
deadline and byte cap, and hashes the exact response before parsing. This
single immutable TLS host allowlist replaces the unsafe pattern of resolving a
hostname, checking its IP, and then reconnecting by hostname.

Use staged commits on a dedicated evidence branch or detached evidence history;
do not move protected `main` away from the candidate. Publish the baseline
commit first. Its now-known commit SHA and byte digest go into the matrix, which
is published in a later evidence commit. A matrix cannot safely guess the SHA
of the same commit that contains it.

Release finalization invokes:

```text
node scripts/verify-browser-compatibility-evidence.mjs \
  --candidate-sha=<exact-40-character-candidate-SHA> \
  --candidate-ready-at=<trusted-canonical-UTC-instant> \
  --artifact=<exact-release-HTML> \
  --pages-url=<canonical-Pages-URL> \
  --pages-deployment-evidence=<trusted-pages-browser-environment.json> \
  --url=<commit-pinned-browser-matrix-URL> \
  --sha256=<SHA-256-of-exact-matrix-bytes> \
  --version-baseline-url=<commit-pinned-vendor-baseline-URL> \
  --version-baseline-sha256=<SHA-256-of-exact-baseline-bytes> \
  --output=<retained-verified-aggregate.json>
```

The protected workflow exposes four required dispatch inputs:
`browser_compatibility_evidence_url`,
`browser_compatibility_evidence_sha256`, `browser_version_baseline_url`, and
`browser_version_baseline_sha256`. It verifies the chain before protected
publication and again after environment approval.

The aggregate retains the exact matrix, baseline, and trusted Pages evidence
bytes in Base64 form. It also retains the exact four vendor responses fetched
during finalization. Historical cleanup consumes this retained aggregate; it
does not refetch mutable vendor catalogs after their content legitimately
changes.

## Common binding and chronology

The matrix has `schemaVersion: 2`,
`gate: "orbitpm-lite-browser-compatibility"`, and `result: "passed"`. Its
`candidateSha`, `artifactSha256`, and canonical `pagesUrl` exactly match the
trusted candidate, local release HTML, and trusted Pages deployment record. Its
exact `versionBaseline.url` and `versionBaseline.sha256` match the separately
supplied baseline inputs.

Every timestamp is canonical UTC ISO-8601 with milliseconds and within the
30-day evidence window. The enforced order is:

```text
candidate ready <= trusted Pages generation
                 < every browser testedAt
                 < that browser's official-source retrievedAt
                 <= baseline generatedAt
                 < browser defect signedOffAt
                 < independent reviewedAt
                 < matrix completedAt
```

The post-test source retrieval confirms the stable-release history that
covered the test instant. Finalization should begin immediately after the
matrix and baseline are published: each mutable official response must still
match the exact digest recorded in the baseline. Once verified, its bytes live
in the aggregate and are never reconstructed from a later response.

## Authoritative vendor-version baseline

The baseline has `schemaVersion: 1`,
`gate: "orbitpm-lite-browser-vendor-version-baseline"`, and `result: "passed"`.
It repeats and exactly binds `candidateSha`, `artifactSha256`, and `pagesUrl`.

`versions` contains exactly eight unique browser/release entries: Chrome,
Edge, Firefox, and Safari × `current` and `previous`. Each entry fixes the
native browser name and identifier, exact dotted browser and OS versions,
tested OS, `channel: "stable"`, and its source ID. Current and previous entries
for one browser use the same OS version.

`sources` contains exactly one referenced source per browser. Every descriptor
pins `vendor`, `adapter`, exact official URL, post-test `retrievedAt`,
`mediaType`, SHA-256, and byte count. The code-defined sources are:

| Browser | Adapter                        | Only accepted official source                                                                                                           |
| ------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome  | `chrome-version-history-v1`    | `https://versionhistory.googleapis.com/v1/chrome/platforms/<compatible-platform>/channels/stable/versions/all/releases?page_size=10000` |
| Edge    | `edge-stable-release-notes-v1` | `https://learn.microsoft.com/en-us/deployedge/microsoft-edge-relnote-stable-channel`                                                    |
| Firefox | `mozilla-firefox-releases-v1`  | `https://product-details.mozilla.org/1.0/firefox.json`                                                                                  |
| Safari  | `apple-security-releases-v1`   | `https://support.apple.com/en-us/100100`                                                                                                |

Chrome requires exactly `page_size=10000`; a bare, alternate, reordered, or
extra query is rejected, and the returned `nextPageToken` must be empty.
Official-source fetches reject redirects, alternate hosts or paths, wrong
content types, digest or size mismatches, and responses over 2 MiB.

Each fixed adapter parses only stable release structures. It excludes Chrome
Beta/Dev/Canary/Extended Stable, Edge Beta or Extended Stable headings, Firefox
pre-release and ESR versions, and Safari Technology Preview. For the exact
`testedAt`, the verifier derives the vendor current major and the immediately
preceding stable major from release chronology, verifies the exact patch was
released, and requires the matrix row to equal its baseline entry.

There is deliberately no universal `currentMajor = previousMajor + 1` rule.
Apple moved from Safari 18 to Safari 26, so arithmetic adjacency would reject a
genuine supported pair and is not evidence of vendor chronology.

## Exact 16-row matrix

`rows` contains exactly one passed row for every Cartesian-product entry:

| Browser key | Required browser name | Required native identifier | Release line          | Locales    |
| ----------- | --------------------- | -------------------------- | --------------------- | ---------- |
| `chrome`    | `Google Chrome`       | `com.google.Chrome`        | `current`, `previous` | `en`, `ar` |
| `edge`      | `Microsoft Edge`      | `com.microsoft.Edge`       | `current`, `previous` | `en`, `ar` |
| `firefox`   | `Mozilla Firefox`     | `org.mozilla.firefox`      | `current`, `previous` | `en`, `ar` |
| `safari`    | `Safari`              | `com.apple.Safari`         | `current`, `previous` | `en`, `ar` |

For each release line, the English and Arabic rows use the same exact browser
and OS versions. Every row exactly equals the matching SHA-pinned baseline
entry, records `automationEngine: "none"` and
`operationMode: "human-operated"`, names a structured stable human operator,
and contains substantive findings. Arabic findings contain substantive Arabic
script. Safari is genuine Safari on macOS; Playwright WebKit, a WebKit build,
or a Safari user-agent string is not Safari evidence.

## Defect sign-off and independent review

The SHA-pinned matrix contains its own `defects` and `review` objects:

- `defects.unresolvedP0` and `defects.unresolvedP1` are exactly zero;
- the defect signatory is independent of every browser operator and signs
  after baseline generation;
- the final reviewer is independent of every operator and reviews after
  defect sign-off; the same independent human may do both later actions; and
- both records contain substantive findings.

The verifier establishes exact byte, source, version, chronology, identity,
and artifact bindings. Repository environment protection remains responsible
for authenticating the humans and approving the final retained aggregate.

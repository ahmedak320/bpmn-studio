# External release approval evidence

The protected release and Pages workflows accept only schema version 2 external
evidence. The top-level manifest is an index: each soak, assistive-technology,
and defect-ledger claim must point to a separate immutable JSON record and bind
that record by SHA-256.

[`RELEASE_APPROVAL_EVIDENCE.example.json`](RELEASE_APPROVAL_EVIDENCE.example.json)
shows the top-level shape. Its `REPLACE ...` values are intentionally invalid
and must not be published as release evidence.

## Publication and hashing

1. Run `scripts/soak-gate.ts` with explicit `--output` and `--support-output`
   paths in one real directory outside both the Git worktree and Git directory.
   Both targets must be new, non-symlink paths. Publish the exact diagnostic
   record and its compact automated support record together.
2. Produce the five human-reviewed supporting JSON records described below.
   The human soak wrapper SHA-pins the automated record from step 1.
3. Commit every record under `release-evidence/v0.4.5/` in
   `ahmedak320/bpmn-studio` and publish it through the exact commit-pinned raw
   GitHub namespace below.
4. Hash the exact five human supporting records and put those digests in the
   top-level manifest.
5. Publish the manifest, hash its exact bytes, and provide its URL and SHA-256
   to the protected workflow.

The workflow independently derives the candidate's trusted ready time and
passes it as `--candidate-ready-at=<canonical UTC timestamp>`. The manifest's
`candidateReadyAt` must match that value exactly. It is not trusted merely
because the evidence submitter placed it in the manifest.

Every manifest, human-record, and compact automated-record fetch URL must have
exactly this form:

```text
https://raw.githubusercontent.com/ahmedak320/bpmn-studio/<non-zero-lowercase-40-character-commit>/release-evidence/v0.4.5/<record>.json
```

Other owners, repositories, hosts, branches, tags, path prefixes, query
strings, fragments, credentials, ports, encoded paths, and redirects are
rejected. This includes a commit-pinned record owned by an attacker. The exact
TLS host/repository/path allowlist avoids DNS-check/use races: the verifier
does not resolve a hostname for a preflight decision and later reconnect by
name. The sole relative-URL exception is the compact automated record's
`diagnosticEvidenceUrl`: it must be one literal safe `./<file>.json` sibling
that resolves inside the exact same immutable commit directory.

Use staged commits on a dedicated evidence branch or detached evidence history
without changing protected `main` from the release candidate: publish the
diagnostic and compact automated record together in the first evidence commit,
then their human wrapper and the other supports, then the manifest that
contains those already-known commit URLs and digests.

The verifier streams every response with a 15-second timeout. It rejects a
manifest above 1 MiB, any primary supporting record above 256 KiB, the compact
automated soak record above 16 MiB, or its bound diagnostic record above
16 MiB before aggregating the response body. It verifies a response's SHA-256
before parsing or trusting its JSON.

## Common binding

Every supporting record is a JSON object with this envelope:

```json
{
  "schemaVersion": 1,
  "evidenceType": "RECORD_TYPE_FROM_THE_SECTIONS_BELOW",
  "candidateSha": "EXACT_NON_ZERO_40_CHARACTER_GIT_SHA",
  "artifactSha256": "EXACT_NON_ZERO_64_CHARACTER_HTML_SHA256"
}
```

The candidate and artifact values must exactly match both the top-level
manifest and the local HTML bytes passed to the verifier. All-zero placeholder
digests are rejected.

Every timestamp, including `candidateReadyAt`, must be a canonical UTC value
with milliseconds, for example
`2026-07-26T11:00:00.000Z`. Evidence cannot be more than 30 days old or in the
future at verification time.

## Soak record

The soak record uses `evidenceType: "orbitpm-lite-soak"` and repeats the
top-level start, completion, duration, locales, scenarios, and sampling
interval. It must contain:

- `passed: true`, `uninterrupted: true`, `restarts: 0`, and an exact duration of
  at least 172,800,000 milliseconds;
- exact locales `["en", "ar"]`;
- exact scenarios `edits`, `recovery`, `workspace-switching`, `imports`,
  `translation-cancellation`, and `history-cleanup`;
- `sampleIntervalMinutes` from 1 through 60;
- `samples` covering the exact start and completion with no gap larger than the
  declared interval plus five minutes. Every sample records canonical
  `capturedAt`, positive integer `residentMemoryBytes`, non-negative integer
  `storageBytes`, locale `en` or `ar`, a required `scenario`, `healthy: true`,
  its zero-based `sequence`, and cumulative integer `completedOperations`.
  Sequence zero records exactly zero operations; every later sample strictly
  increases;
- at least one quarter of all heartbeat samples for each locale, with every
  locale/scenario pair represented;
- integer `maxResidentMemoryGrowthBytes` and `maxStorageGrowthBytes` caps from
  zero through 512 MiB that the samples do not exceed;
- one passed `scenarioResults` item with substantive `findings` for every
  locale/scenario pair. Arabic results contain substantive Arabic-script
  findings;
- one passed `retentionResults` item with substantive `findings` for each of
  `draft-recovery`, `history-retention`, and `workspace-state`; and
- `automatedGateEvidenceUrl` and `automatedGateEvidenceSha256`, binding the
  exact standalone `orbitpm-lite-soak-automation` bytes generated by
  `soak-gate.ts --support-output`;
- exactly one structured stable human `operators` entry for `en` and one for
  `ar`, each with an in-interval `observedAt` and substantive findings. One
  bilingual operator may cover both locales, but a reused account must keep one
  exact stable profile;
- an `attestation` signed after soak completion by a stable human account
  independent of every unique operator account, with
  `independentOfOperators: true` and substantive findings; and
- substantive overall `findings`.

A scenario result has this shape:

```json
{
  "locale": "ar",
  "scenario": "translation-cancellation",
  "passed": true,
  "findings": "اكتمل إلغاء الترجمة مع الاحتفاظ بالحالة الصحيحة دون فقدان التعديلات."
}
```

The human observation and attestation fields have this shape:

```json
{
  "operators": [
    {
      "locale": "en",
      "operator": {
        "name": "Human Full Name",
        "organization": "Review Organization",
        "role": "English soak observation role",
        "accountId": "github:stable-human-account"
      },
      "observedAt": "2026-07-26T05:30:00.000Z",
      "findings": "Substantive findings from the observed English endurance scenarios."
    }
  ],
  "attestation": {
    "attestedBy": {
      "name": "Independent Human Name",
      "organization": "Independent Review Organization",
      "role": "Soak evidence attestor",
      "accountId": "github:independent-stable-account"
    },
    "attestedAt": "2026-07-26T06:15:00.000Z",
    "independentOfOperators": true,
    "findings": "Substantive findings from reviewing the complete immutable soak evidence."
  }
}
```

The example shows only one operator entry for readability; a valid record has
both `en` and `ar` entries. Those entries may repeat one bilingual operator's
exact identity profile.

### Automated soak-gate record

The nested automated record is not a human assertion and contains no operator
or reviewer identities. It uses `schemaVersion: 2` and
`evidenceType: "orbitpm-lite-soak-automation"`. The verifier requires:

- exact candidate and artifact digests at the top level and at clean,
  unchanged start/end endpoint snapshots;
- `status: "passed"`, `harnessPassed: true`, `passed: true`,
  `releaseEligible: true`, `smoke: false`, `uninterrupted: true`, and
  `restarts: 0`;
- chronology exactly matching the human wrapper, an exact
  `durationRequirementMs` of 172,800,000, and both wall-clock and monotonic
  sample coverage for at least 48 hours;
- the exact locale, scenario, retention-check, and sampling declarations from
  the wrapper;
- healthy chronological samples whose timestamps equal
  `startedAt + elapsedMs`, with truthful zero start operations, strictly
  increasing cumulative operations, exact objective memory/storage growth,
  balanced locale coverage, and every locale/scenario pair;
- an exact SHA-256 hash-chain journal containing checkpoints for every sample
  and production-UI operation receipts for all 12 English/Arabic workload
  tuples. A receipt names the persistent localized browser context, exact HTML
  SHA-256 and size, production selectors and interactions, before/after state
  digests, and objective assertions;
- all 12 locale/scenario results exactly matching their UI receipt counts and
  first/last journal sequence numbers. Source-module or in-memory-adapter
  stress is supplemental and cannot create an eligible UI receipt;
- exact retention metrics for two localized draft restorations, the 20-entry
  per-locale history limit and pruning result, workspace-picker cancellation,
  workspace preservation, and localized UI spreadsheet imports;
- `diagnosticEvidenceUrl` as one safe `./<file>.json` sibling plus the exact
  `diagnosticEvidenceSha256` and `diagnosticEvidenceSizeBytes`. The diagnostic
  candidate/artifact snapshot and full operation journal must be byte-bound
  and canonically identical to the compact record; and
- the clock declaration emitted by the harness:
  `UTC`, `performance.now`, and `startedAt-plus-monotonic-elapsed`.

The verifier fetches and retains the exact automated support bytes under
`supportingEvidence` key `automatedSoakGate` and the exact diagnostic bytes
under `automatedSoakDiagnostic`. It independently recomputes the diagnostic
digest and size, every journal entry hash, the terminal root, checkpoint
parity, UI scenario counts, retention metrics, and locally hashed artifact
size. The diagnostic must be a distinct non-redirecting immutable sibling in
the same commit directory.

The top manifest still has exactly five human supporting-record references:
its `soak` digest binds the human wrapper, and that wrapper binds the automated
record. A standalone hand-written soak claim, a smoke waiver, a dirty
candidate, a changed artifact, or a re-hashed short/failed record does not
satisfy the gate. Software-generated timestamps and journal entries do not
independently prove that a physical 48-hour run occurred, so the separate
stable human observation and independent attestation remain mandatory.

## Assistive-technology records

The manifest and each assistive-technology record use a structured `operator`:

```json
{
  "name": "Human Full Name",
  "organization": "Review Organization",
  "role": "Specific test role",
  "accountId": "github:stable-human-account"
}
```

Names must identify a human by at least two name components. Placeholder,
automation, bot, and service-account identities are rejected, including
underscore-delimited placeholders. `accountId` supplies a stable provider and
account identifier used to detect identity aliases.

Each record repeats the manifest's operator, exact operating-system,
assistive-technology, browser, locale, session `startedAt`, and completion
`testedAt` fields. It records `passed: true`, an array of passed scenario
objects with substantive findings, and substantive overall `findings`.

| Manifest key         | `evidenceType`                      | Locale | Required scenario IDs                                                  |
| -------------------- | ----------------------------------- | ------ | ---------------------------------------------------------------------- |
| `nvdaWindows`        | `orbitpm-lite-nvda-windows`         | `en`   | `keyboard-authoring`, `focus-announcements`, `modal-dialog-navigation` |
| `voiceOverMacos`     | `orbitpm-lite-voiceover-macos`      | `en`   | `keyboard-authoring`, `focus-announcements`, `modal-dialog-navigation` |
| `arabicScreenReader` | `orbitpm-lite-arabic-screen-reader` | `ar`   | `language-change`, `mixed-language-pronunciation`, `rtl-navigation`    |

The Arabic record additionally requires `textDirection: "rtl"` and
`documentLanguage: "ar"`, plus substantive Arabic-script detail in every
scenario and in its overall findings. NVDA requires Windows and NVDA with
numeric OS/AT/browser versions. VoiceOver requires macOS, VoiceOver, and Safari
with numeric versions. The Arabic record requires a named supported screen
reader and a Windows or macOS platform rather than a relabeled arbitrary tool.

A scenario object has this shape:

```json
{
  "id": "mixed-language-pronunciation",
  "passed": true,
  "findings": "نطق القارئ العبارات العربية والمختلطة بوضوح مع الحفاظ على ترتيب الكلمات."
}
```

Automated accessibility results do not satisfy these human-operated records.

## Defect-ledger record

The defect ledger uses `evidenceType: "orbitpm-lite-defect-ledger"`. It repeats
the manifest's structured `signedOffBy`, exact `signedOffAt`, and zero
`unresolvedP0` and `unresolvedP1` counts. It also contains:

- `automatedGatesCandidateSha` equal to the release candidate;
- exact `reviewedEvidence` objects for `soak`, `nvdaWindows`,
  `voiceOverMacos`, and `arabicScreenReader`, each binding the exact SHA-256
  that the signatory reviewed;
- `severitySummary` entries for P0 and P1, each with `unresolved: 0` and
  substantive findings;
- an `entries` array, including when it is empty. Each entry has a unique `id`,
  severity P0 through P3, status `resolved` or `accepted`, and substantive
  `summary` and `disposition`; and
- substantive overall `findings`.

The defect sign-off postdates the independent soak attestation as well as soak
completion and all assistive-technology sessions. Its exact `soak` digest
therefore binds both the human wrapper and, transitively, the automated
soak-gate bytes referenced by that wrapper.

An accepted P0 or P1 entry contradicts the zero-unresolved release gate and is
rejected.

The exact-record binding is shaped as follows:

```json
{
  "automatedGatesCandidateSha": "EXACT_NON_ZERO_40_CHARACTER_GIT_SHA",
  "reviewedEvidence": [
    {
      "key": "soak",
      "sha256": "EXACT_SHA256_FROM_THE_TOP_LEVEL_MANIFEST"
    },
    {
      "key": "nvdaWindows",
      "sha256": "EXACT_SHA256_FROM_THE_TOP_LEVEL_MANIFEST"
    },
    {
      "key": "voiceOverMacos",
      "sha256": "EXACT_SHA256_FROM_THE_TOP_LEVEL_MANIFEST"
    },
    {
      "key": "arabicScreenReader",
      "sha256": "EXACT_SHA256_FROM_THE_TOP_LEVEL_MANIFEST"
    }
  ]
}
```

## Independent final review and chronology

`defects.signedOffBy`, every assistive-technology operator, and
`review.reviewedBy` use the structured identity format. The defect signatory
and final reviewer must each be independent of all test operators, and the
manifest must record `review.independentOfEvidenceProduction: true`. The same
independent human may sign the defect ledger and then perform the later final
review. The independent soak attestor is not an evidence operator and may also
perform that later review.

Chronology is strict:

1. The soak and every assistive-technology session start at or after the
   workflow's trusted `candidateReadyAt`.
2. The uninterrupted soak and all three assistive-technology tests complete.
3. The P0/P1 defect signatory signs off after all of those records.
4. The independent reviewer reviews after defect sign-off.
5. `assembledAt` is at or after the independent review.

## Verified aggregate

The verifier writes one machine-readable JSON artifact with `status: "passed"`.
It includes the candidate SHA, trusted `candidateReadyAt`, validated manifest,
source URL/final URL/digest/size, verifier policy limits, the five parsed
primary supporting records, the compact automated soak record, and its bound
diagnostic. All seven supporting records include URL/final URL/digest/size,
and the aggregate covers eight network records when the manifest is included.
Each source and supporting record also includes the exact verified response
bytes as `bodyBase64`, so an auditor can recompute every retained SHA-256
without relying on JSON reserialization. Protected workflows retain that
aggregate as their approval artifact.

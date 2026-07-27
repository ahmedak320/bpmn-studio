# External release approval evidence

The protected release and Pages workflows accept only schema version 2 external
evidence. The top-level manifest is an index: each soak, assistive-technology,
and defect-ledger claim must point to a separate immutable JSON record and bind
that record by SHA-256.

[`RELEASE_APPROVAL_EVIDENCE.example.json`](RELEASE_APPROVAL_EVIDENCE.example.json)
shows the top-level shape. Its `REPLACE ...` values are intentionally invalid
and must not be published as release evidence.

## Publication and hashing

1. Produce the five supporting JSON records described below.
2. Publish each record at a distinct, public, credential-free HTTPS URL.
3. Hash the exact published bytes with SHA-256 and put those digests in the
   top-level manifest.
4. Publish the manifest, hash its exact bytes, and provide its URL and SHA-256
   to the protected workflow.

The workflow independently derives the candidate's trusted ready time and
passes it as `--candidate-ready-at=<canonical UTC timestamp>`. The manifest's
`candidateReadyAt` must match that value exactly. It is not trusted merely
because the evidence submitter placed it in the manifest.

URLs must not contain credentials, query strings, or fragments. Placeholder and
non-public hosts, including `example.invalid`, localhost, IP-address literals,
and `.local` names, are rejected. DNS must resolve exclusively to public
addresses. Redirects are rejected; publish each record's exact final URL.

The verifier streams every response with a 15-second timeout. It rejects a
manifest above 1 MiB or any supporting record above 256 KiB before aggregating
the response body. It verifies a response's SHA-256 before parsing or trusting
its JSON.

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
  its zero-based `sequence`, and positive integer `completedOperations`;
- at least one quarter of all heartbeat samples for each locale, with every
  locale/scenario pair represented;
- integer `maxResidentMemoryGrowthBytes` and `maxStorageGrowthBytes` caps from
  zero through 512 MiB that the samples do not exceed;
- one passed `scenarioResults` item with substantive `findings` for every
  locale/scenario pair. Arabic results contain substantive Arabic-script
  findings;
- one passed `retentionResults` item with substantive `findings` for each of
  `draft-recovery`, `history-retention`, and `workspace-state`; and
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
`review.reviewedBy` use the structured identity format. The final reviewer must
be a different human from the defect signatory and all test operators, and the
manifest must record `review.independentOfEvidenceProduction: true`.

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
source URL/final URL/digest/size, verifier policy limits, and all five parsed
supporting records with their
URL/final URL/digest/size. Each source and supporting record also includes the
exact verified response bytes as `bodyBase64`, so an auditor can recompute every
retained SHA-256 without relying on JSON reserialization. Protected workflows
retain that aggregate as their approval artifact.

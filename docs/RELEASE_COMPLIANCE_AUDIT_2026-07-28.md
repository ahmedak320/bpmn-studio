# OrbitPM Process Studio Lite 0.4.5 — release compliance audit as of Tuesday, July 28, 2026

This document records the current live release state observed on Tuesday,
July 28, 2026 and compares it to the stricter completion requirements in
`goal.md`, `fix_plan.md`, and the repository release-evidence contracts.

It is an audit record, not a release certificate.

## Scope and evidence boundary

This audit is based on current local repository state plus live GitHub state
queried on Tuesday, July 28, 2026.

The release repository under audit is:

- `/home/ahmed/Desktop/bpmn_tool/desktop`
- `https://github.com/ahmedak320/bpmn-studio.git`

## Current live GitHub state

### Published identities

- `origin/main`:
  `0c7cd4b523077913841c9a03c0b40dee5b8e9e7d`
- `v0.4.5^{}`:
  `0c7cd4b523077913841c9a03c0b40dee5b8e9e7d`
- Published stable release:
  `https://github.com/ahmedak320/bpmn-studio/releases/tag/v0.4.5`
- Release published at:
  `2026-07-28T04:47:12Z`

### Published release assets

The live `v0.4.5` release currently contains exactly these seven assets:

1. `LICENSE`
2. `OrbitPM-Excel-Example-0.4.5.xlsx`
3. `OrbitPM-Excel-Template-0.4.5.xlsx`
4. `OrbitPM-Process-Studio-Lite-0.4.5.cyclonedx.json`
5. `OrbitPM-Process-Studio-Lite-0.4.5.html`
6. `SHA256SUMS.txt`
7. `THIRD_PARTY_NOTICES.md`

### Published HTML byte identity

The published `SHA256SUMS.txt` records:

- `OrbitPM-Process-Studio-Lite-0.4.5.html`
  = `3299cff36a594cdac536668713e930bfb927285a7fe6e9f271ac0d9ae863ed51`

The locally verified release candidate HTML and the currently served Pages HTML
also match that same SHA-256:

- expected artifact SHA-256:
  `3299cff36a594cdac536668713e930bfb927285a7fe6e9f271ac0d9ae863ed51`
- current Pages URL:
  `https://ahmedak320.github.io/bpmn-studio/`

## Current live workflow state

### Finalization workflow

Successful finalization run:

- run ID: `30329668557`
- URL:
  `https://github.com/ahmedak320/bpmn-studio/actions/runs/30329668557`
- started:
  `2026-07-28T04:46:13Z`
- completed:
  `2026-07-28T04:47:42Z`

Downloaded retained artifacts from that run are locally inspectable under:

- `finalize-artifacts-30329668557/`

The retained file inventory currently present there is:

- `orbitpm-immutable-stable-release-0c7cd4b523077913841c9a03c0b40dee5b8e9e7d/finalize-evidence/finalization-chain.json`
- `orbitpm-immutable-stable-release-0c7cd4b523077913841c9a03c0b40dee5b8e9e7d/finalize-evidence/pages/pages-browser-environment.json`
- `orbitpm-immutable-stable-release-0c7cd4b523077913841c9a03c0b40dee5b8e9e7d/publication-authority/publication-authority.json`
- `orbitpm-immutable-stable-release-0c7cd4b523077913841c9a03c0b40dee5b8e9e7d/stable-release.json`
- `orbitpm-immutable-stable-release-0c7cd4b523077913841c9a03c0b40dee5b8e9e7d/latest-release.json`

Notably absent from the retained immutable finalization artifact are:

- `finalize-evidence/trusted-release-external-evidence-verification.json`
- `finalize-evidence/browser-compatibility-evidence-verification.json`
- `finalize-evidence/pages/trusted-release-external-evidence-verification.json`

### Historical cleanup workflow

As of Tuesday, July 28, 2026, there is no recorded
`historical-release-cleanup.yml` run.

## Verified compliance failure in the retained finalization evidence

The retained finalization chain from run `30329668557` is:

- [finalization-chain.json](/home/ahmed/Desktop/bpmn_tool/desktop/finalize-artifacts-30329668557/orbitpm-immutable-stable-release-0c7cd4b523077913841c9a03c0b40dee5b8e9e7d/finalize-evidence/finalization-chain.json)

That file reports:

- `"status": "passed"`

But it also contains blank values for evidence that the original release goal
requires to be present:

- `"candidateReadyAt": ""`
- `"releaseEvidenceSha256": ""`
- `"browserCompatibilityEvidence.url": ""`
- `"browserCompatibilityEvidence.sourceSha256": ""`
- `"browserCompatibilityEvidence.aggregateSha256": ""`
- `"browserVersionBaseline.url": ""`
- `"browserVersionBaseline.sha256": ""`
- `"browserVersionBaseline.sourceSha256": ""`
- `"externalEvidence.url": ""`
- `"externalEvidence.sha256": ""`

The retained publication authority shows the same gap:

- [publication-authority.json](/home/ahmed/Desktop/bpmn_tool/desktop/finalize-artifacts-30329668557/orbitpm-immutable-stable-release-0c7cd4b523077913841c9a03c0b40dee5b8e9e7d/publication-authority/publication-authority.json)

Its browser and external evidence sections are also empty.

## Current live state versus the original goal

### Facts that are currently true

- `main` and `v0.4.5^{}` resolve to the same commit.
- `v0.4.5` is published and is not draft or prerelease.
- The live release contains the exact seven expected asset names.
- GitHub Pages serves HTML bytes matching the published release HTML hash.
- Historical cleanup has not yet run.

### Facts that are not proven and therefore do not satisfy the goal

The original goal requires objective evidence for all of the following:

- candidate-bound external human evidence
- post-Pages current/previous browser matrix evidence
- vendor-version baseline evidence
- current/previous Chrome, Edge, Firefox, and genuine Safari human coverage
- NVDA evidence
- VoiceOver evidence
- Arabic screen-reader / pronunciation evidence
- uninterrupted 48-hour soak evidence
- zero-unresolved P0/P1 sign-off bound to that evidence
- protected finalization based on those records

The current retained finalization chain does not prove those requirements.

## Historical cleanup status

The original goal permits historical title and asset cleanup only after:

1. successful strict publication of `v0.4.5`;
2. exact Pages verification; and
3. evidence-backed finalization under the required gates.

Because the current retained finalization chain is missing the required
external and browser evidence bindings, the strict completion claim is not
established.

Additionally, historical executable/updater assets remain present in older
releases as of Tuesday, July 28, 2026.

## Local repository hardening performed after observing the live gap

The current local branch contains stricter workflow changes that are not yet
reflected in the published live release state:

- release candidate once again requires at least one trusted independent PR
  approval;
- release and Pages once again require external evidence inputs;
- finalization once again requires external evidence plus browser compatibility
  and vendor-version baseline inputs;
- finalization now self-verifies the retained finalization chain against the
  exact retained release, Pages, browser, and publication-authority files
  before uploading the immutable stable artifact;
- finalization now stages the immutable stable artifact into one exact
  directory and verifies the retained file inventory before upload; cleanup now
  verifies that same artifact layout immediately after download;
- cleanup now rejects finalization chains with blank evidence bindings.

These local changes improve the repository state, but they do not retroactively
repair the already-published live `v0.4.5` evidence chain.

## Conclusion

As of Tuesday, July 28, 2026:

- the published 0.4.5 bytes and Pages deployment are internally consistent;
- the live published release does **not** satisfy the original strict
  completion criteria from `goal.md`;
- the missing proof is specifically the human, browser-compatibility, vendor
  baseline, and soak evidence chain that the retained finalization artifact
  leaves blank;
- historical cleanup has not executed and must not be treated as authorized by
  the waived finalization record.

# Security policy

## Supported product

OrbitPM Process Studio Lite is the only active product. The 0.4.5 branch is a
release candidate until it is tagged and published. The archived Desktop,
Electron, Docker, bridge, and other historical variants do not receive security
updates.

After 0.4.5 publication, security fixes target the latest stable Lite release.
Users should confirm the visible version and verify release checksums before
reporting an issue.

## Reporting a vulnerability

Use the repository's
[private vulnerability report](https://github.com/ahmedak320/bpmn-studio/security/advisories/new)
when available. If private reporting is unavailable, open a minimal repository
issue asking the maintainer for a private contact method.

Do not put API keys, passphrases, confidential BPMN files, provider responses,
or personal data in a public issue. Include the affected version, browser,
storage mode, reproduction steps using synthetic data, and the security impact.

## Security and privacy boundaries

- The application is a self-contained browser document. It has no backend,
  telemetry, account system, cloud synchronization, or collaboration service.
- Ordinary editing, validation, BPMN export, and spreadsheet generation are
  local operations.
- API keys are in memory by default. Optional persistence stores AES-256-GCM
  ciphertext in browser storage using a PBKDF2-SHA-256 key derivation with
  310,000 iterations, a random 16-byte salt, a random 12-byte IV, and
  provider-bound additional data. The passphrase is not stored.
- Encryption protects a persisted key at rest; it does not protect the key
  after the user unlocks it in the running page. Browser extensions, developer
  tools, a compromised device, or injected code in the page's origin remain
  outside that protection boundary.
- Process-content AI and translation calls require a visible review and
  consent. Provider terms, retention, billing, and account security still
  apply.
- OpenRouter calls request zero-data-retention routes and deny data collection.
  Direct Anthropic and Gemini calls cannot impose an equivalent provider-wide
  policy from the client.
- The CSP permits outbound connections only to Anthropic, Gemini, OpenRouter,
  Google Translate, and MyMemory. `data:` is also allowed for embedded WASM; it
  is not an external host.
- Workspace backups include public workspace files and portable history.
  Browser-private credentials and preferences are not included.

See [docs/PRIVACY.md](docs/PRIVACY.md) for the complete data-flow disclosure.

## Untrusted files and limits

Imported files are untrusted. Current parser boundaries include:

| Input            | Principal limits                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Library ZIP      | 64 MiB compressed, 2,500 entries, 5 MiB per entry, 50 MiB total uncompressed, ratio 250         |
| DOCX             | 20 MiB compressed, 2,048 entries, 12 MiB per entry, 64 MiB total uncompressed, ratio 250        |
| XLSX             | 20 MiB compressed, 10,000 ZIP entries, 100 MiB declared uncompressed, 25 sheets                 |
| CSV/XLSX data    | 50,000 rows, 256 columns, 500,000 non-empty cells, 32,767 characters per cell                   |
| Workspace backup | 120 MiB compressed, 25,000 entries, 100 MiB per entry, 250 MiB declared uncompressed, ratio 200 |

Encrypted, multi-disk, ZIP64, unsafe-path, duplicate-entry, and unsupported
compression archives are rejected. XLSX macro, ActiveX, embedded executable,
and legacy encrypted content is rejected. Spreadsheet external links and data
connections are ignored with warnings; formulas are never executed.

Known residual limitation: browser file selection currently obtains the whole
compressed file with `File.arrayBuffer()` before the parser applies its
compressed-size gate. A very large local file can therefore allocate memory
before preflight rejects it. Do not open untrusted oversized inputs.

## Release security evidence

Security claims for a release come from the exact tagged commit, not from this
document. The required scans, audits, CSP checks, malformed-input tests,
license report, SBOM, checksums, and pending human checks are indexed in
[docs/RELEASE_EVIDENCE.md](docs/RELEASE_EVIDENCE.md).

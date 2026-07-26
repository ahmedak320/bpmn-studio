# Contributing

OrbitPM Process Studio Lite is the only active product in this repository.
Changes must not add a native shell, installer, updater, server, bridge, or
alternate executable program.

## Before opening a pull request

```bash
npm ci
npm run check:lite-only
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Tests must run from a fresh build. Release tests may not be skipped, retried,
quarantined, or satisfied by stale artifacts. Reliability, bilingual, import,
accessibility, and security behavior require both focused tests and complete
workflow coverage.

Preserve unknown BPMN extension content and user data. Any operation that
overwrites, moves, renames, deletes, imports, or restores files must use the
shared transaction/session layer and include failure and rollback tests.

English and Arabic changes receive equal implementation and testing depth.
External AI or translation requests require an explicit reviewed disclosure and
consent flow.

Use focused, reviewable commits. Do not rewrite an existing version tag.

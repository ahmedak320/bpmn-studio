import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const vitest = resolve('node_modules/.bin/vitest')
const profiles = [
  {
    name: 'overall',
    tests: [],
    include: 'src/**/*.{ts,tsx}',
    thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 }
  },
  {
    name: 'session-safety',
    tests: ['src/sessions'],
    include: 'src/sessions/**/*.{ts,tsx}',
    thresholds: { branches: 90 }
  },
  {
    name: 'translation-validation',
    tests: ['src/localization'],
    include: 'src/localization/**/*.{ts,tsx}',
    thresholds: { branches: 90 }
  },
  {
    name: 'excel-mapping',
    tests: [
      'src/spreadsheet/mapping.test.ts',
      'src/spreadsheet/modelBuilder.test.ts',
      'src/spreadsheet/inference.test.ts',
      'src/spreadsheet/template.test.ts',
      'src/spreadsheet/wizardMapping.test.ts'
    ],
    include:
      'src/spreadsheet/{aliases,mapping,mappingPreset,modelBuilder,inference,officialTemplate,template,wizardMapping}.{ts,tsx}',
    thresholds: { branches: 90 }
  },
  {
    name: 'import-transactions',
    tests: [
      'src/spreadsheet/transaction.test.ts',
      'src/workspace/importTransaction.test.ts',
      'src/workspace/adapters'
    ],
    include:
      'src/{spreadsheet/transaction,workspace/importTransaction,workspace/adapters/**/*}.{ts,tsx}',
    thresholds: { branches: 90 }
  }
]

const failedProfiles = []
for (const profile of profiles) {
  const args = [
    'run',
    ...profile.tests,
    '--retry=0',
    '--reporter=default',
    '--reporter=./scripts/vitest-release-reporter.mjs',
    '--coverage.enabled=true',
    '--coverage.provider=v8',
    `--coverage.reportsDirectory=coverage/${profile.name}`,
    '--coverage.reporter=text',
    '--coverage.reporter=json-summary',
    '--coverage.reporter=lcov',
    `--coverage.include=${profile.include}`,
    '--coverage.exclude=**/*.test.{ts,tsx}',
    '--coverage.exclude=**/__tests__/**',
    '--coverage.exclude=**/__fixtures__/**',
    '--coverage.exclude=**/*Fixtures.{ts,tsx}',
    '--coverage.exclude=**/*.d.ts',
    '--coverage.clean=true',
    '--coverage.thresholds.autoUpdate=false',
    ...Object.entries(profile.thresholds).map(
      ([metric, threshold]) => `--coverage.thresholds.${metric}=${threshold}`
    )
  ]
  console.log(`\n=== Coverage profile: ${profile.name} ===`)
  const result = spawnSync(vitest, args, { stdio: 'inherit', env: process.env })
  if (result.status !== 0) {
    console.error(`Coverage profile failed: ${profile.name}`)
    failedProfiles.push(profile.name)
  }
}

if (failedProfiles.length) {
  console.error(`Coverage release gate failed: ${failedProfiles.join(', ')}`)
  process.exit(1)
}

console.log(`All ${profiles.length} coverage profiles passed their release thresholds.`)

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(new URL('..', import.meta.url).pathname)

// Plan §4.4 requires the English/Arabic dialog behaviour to stay pinned. The
// spec that used to pin it — tests/e2e/lite-i18n-rtl.spec.ts — drove the BPMN
// canvas ("New process" dialog -> `.djs-container` -> `bpmn:Task`) that plan
// §5.3 removed, so it was deleted with the rest of the BPMN UI. The ARIS shell
// replacement below does not exist yet; until it is written this step fails
// loudly rather than letting Phase 1 report a pass it has not earned.
const ARIS_I18N_SPEC = 'tests/e2e/aris-i18n-rtl.spec.ts'

const steps = [
  {
    label: 'build single-file artifact',
    cmd: 'npm',
    args: ['run', 'build']
  },
  {
    label: 'vitest retained-infrastructure characterization set',
    cmd: 'npx',
    args: [
      'vitest',
      'run',
      '--maxWorkers=4',
      '--retry=0',
      'src/assist/__tests__/answerLocal.test.ts',
      'src/ai/__tests__/requestPrivacy.test.ts',
      'src/assist/__tests__/requestReview.test.ts',
      'src/assist/__tests__/AssistantDrawer.interviewCancellation.test.tsx',
      'src/ai/__tests__/providerSelection.test.ts',
      'src/ai/__tests__/keys.test.ts',
      'src/ai/__tests__/keys.crossTab.test.ts',
      'src/ai/__tests__/docx.test.ts',
      'src/ai/__tests__/pdf.test.ts',
      'src/spreadsheet/xlsxPreflight.test.ts',
      'src/workspace/adapters/__tests__/directory.test.ts',
      'src/workspace/adapters/__tests__/portableModes.test.ts'
    ]
  },
  {
    label: 'chromium English/Arabic dialog characterization (ARIS shell)',
    cmd: 'npx',
    args: ['playwright', 'test', ARIS_I18N_SPEC, '--project=chromium', '--retries=0'],
    requires: {
      path: ARIS_I18N_SPEC,
      message: [
        `NOT YET RETARGETED: ${ARIS_I18N_SPEC} does not exist.`,
        '',
        'The former English/Arabic dialog characterization spec',
        '(tests/e2e/lite-i18n-rtl.spec.ts) drove the BPMN canvas removed by plan',
        '§5.3 and was deleted with it. Phase 1 cannot be characterized as passing',
        'until an equivalent spec is written against the ARIS shell and placed at',
        `${ARIS_I18N_SPEC}. This step deliberately fails instead of being skipped.`
      ].join('\n')
    }
  },
  {
    label: 'chromium provider UI and no-key PDF gate characterization',
    cmd: 'npx',
    args: [
      'playwright',
      'test',
      'tests/e2e/lite-providers.spec.ts',
      '--project=chromium',
      '--retries=0',
      '--grep',
      'Settings lists only the three supported browser providers|AI panel documents the updated browser-capable provider set|PDF flow: pick a PDF \\+ Arabic hint, hit the no-key provider gate'
    ]
  },
  {
    label: 'single-file file:// smoke',
    cmd: 'node',
    args: ['scripts/file-smoke.mjs', 'dist/index.html']
  }
]

function runStep(step) {
  return new Promise((resolveStep, reject) => {
    console.log(`\n=== ${step.label} ===`)
    if (step.requires && !existsSync(resolve(ROOT, step.requires.path))) {
      reject(new Error(`${step.label} cannot run.\n${step.requires.message}`))
      return
    }
    const child = spawn(step.cmd, step.args, {
      stdio: 'inherit',
      shell: false
    })
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolveStep()
        return
      }
      reject(new Error(`${step.label} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`))
    })
    child.on('error', reject)
  })
}

for (const step of steps) {
  await runStep(step)
}

console.log('\nARIS Phase 1 characterization suite passed.')

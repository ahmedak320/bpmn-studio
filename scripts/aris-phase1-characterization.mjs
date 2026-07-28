import { spawn } from 'node:child_process'

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
    label: 'chromium English/Arabic dialog characterization',
    cmd: 'npx',
    args: [
      'playwright',
      'test',
      'tests/e2e/lite-i18n-rtl.spec.ts',
      '--project=chromium',
      '--retries=0'
    ]
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
  return new Promise((resolve, reject) => {
    console.log(`\n=== ${step.label} ===`)
    const child = spawn(step.cmd, step.args, {
      stdio: 'inherit',
      shell: false
    })
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve()
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

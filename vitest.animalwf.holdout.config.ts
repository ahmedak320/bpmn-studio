import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Dedicated, opt-in project for the `*.holdout.animalwf.test.ts` suites — the two held-out
// AnimalWF fidelity models (plan §20, R4 items 3-4) that are hand-authored against the private,
// uncommitted reference export at ../reference/AnimalWF/ARISAMLExport.xml but deliberately never
// tuned against the render pipeline before Wave 5. Keeping them on their own config (rather than
// folding them into vitest.animalwf.config.ts's `*.animalwf.test.ts` glob, which they also match)
// means the ordinary Wave-1..4 gate loop never runs them, so nothing downstream can even
// accidentally ratchet the render pipeline against a holdout ahead of its one deliberate Wave-5
// re-verification. Run via `npx vitest run --config vitest.animalwf.holdout.config.ts`. Each suite
// throws at module load if the fixture is absent, so running this config without the fixture fails
// loudly rather than silently passing or skipping.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.holdout.animalwf.test.ts'],
    testTimeout: 60_000
  }
})

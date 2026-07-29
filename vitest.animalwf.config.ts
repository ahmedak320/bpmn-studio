import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Dedicated, opt-in project for the `*.animalwf.test.ts` suites, which require the private,
// uncommitted AnimalWF reference export at ../reference/AnimalWF/ARISAMLExport.xml. These files
// are excluded from the default project (see vitest.config.ts) so a clean checkout or CI run
// never needs the fixture. Run via `npm run test:aris:animalwf`. Each suite throws at module
// load if the fixture is absent, so running this config without the fixture fails loudly rather
// than silently passing or skipping.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.animalwf.test.ts'],
    testTimeout: 60_000
  }
})

import { resolve } from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'

// Unit tests run against the repository-root Lite application.
export default defineConfig({
  // Use the automatic JSX runtime (react/jsx-runtime) so presentational
  // components can be rendered to a string with react-dom/server in a plain
  // node environment — no React import, no jsdom — matching tsconfig's
  // "jsx": "react-jsx".
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/vitest.setup.ts'],
    testTimeout: 30_000,
    // `*.animalwf.test.ts` suites depend on the private, uncommitted AnimalWF reference export
    // (never present in CI or a clean checkout) and must never be silently skipped by a
    // `.skipIf`/`.runIf` guard. They are excluded from the default project here and run only
    // through the dedicated, unconditional `npm run test:aris:animalwf` entry point
    // (vitest.animalwf.config.ts), which fails loudly if the fixture is absent.
    exclude: [...configDefaults.exclude, 'src/**/*.animalwf.test.ts']
  }
})

import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Lite's own unit tests (the FS-adapter glue, exercised with in-memory mock
// File System Access handles). Runs from within lite/ via `npm test` here;
// the PARENT app's vitest run excludes lite/** so the two suites stay separate.
export default defineConfig({
  resolve: {
    alias: {
      '@app': resolve(__dirname, '../src')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})

import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

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
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx']
  }
})

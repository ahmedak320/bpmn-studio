import { resolve } from 'node:path'
import { defineConfig } from 'vite'
export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, 'src') }, dedupe: ['zod'] },
  build: {
    target: 'es2022',
    outDir: 'packages/epc-engine/dist',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: {
        index: resolve(__dirname, 'src/aris/headless/index.ts'),
        canonical: resolve(__dirname, 'src/aris/canonical/index.ts')
      },
      formats: ['es']
    },
    rollupOptions: { external: ['jsdom', /^node:/] }
  }
})

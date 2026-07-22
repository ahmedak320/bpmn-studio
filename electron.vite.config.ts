import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        },
        // The renderer runs with `sandbox: true` (security requirement), and a
        // sandboxed renderer can ONLY load a CommonJS preload — an ESM (.mjs)
        // preload fails at runtime with "Cannot use import statement outside a
        // module", leaving window.orbitpm undefined. Because package.json is
        // `"type": "module"`, the default preload output would be ESM `.mjs`;
        // force CJS + a `.cjs` extension so Electron parses it as CommonJS.
        // (index.ts loads `../preload/index.cjs` to match.)
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    },
    plugins: [react()]
  }
})

import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// OrbitPM Process Studio Lite — builds ONE self-contained dist/index.html.
//
// Everything (JS, CSS, and fonts) is inlined so the page makes ZERO external
// requests at runtime except the user's own AI calls (Anthropic / Gemini).
// The app reuses the desktop app's pure generation pipeline and browser-safe
// React components by importing straight from the parent `src` tree via the
// `@app/*` alias — see `paths` in tsconfig.json for the type-side mirror.
//
// `dedupe` forces the packages that are imported from BOTH this project's
// sources AND the reused ../src files (React) — or ONLY from ../src (the gen
// pipeline's zod + bpmn-auto-layout) — to resolve to THIS project's
// node_modules. That keeps a single React instance (no "invalid hook call")
// and makes the build work in CI, where the parent app's node_modules isn't
// installed. It deliberately does NOT include the bpmn.io internals
// (bpmn-moddle, min-dash, …): those have several legitimately-nested versions
// (bpmn-js needs bpmn-moddle@10's named export; bpmn-auto-layout needs @8's
// default export), and forcing one copy breaks the other. bpmn-js and its
// ecosystem are imported only from lite/src, so they resolve to lite's
// node_modules with the correct nested versions without any dedupe.
const DEDUPE = ['react', 'react-dom', 'zod', 'bpmn-auto-layout']

export default defineConfig({
  base: './',
  plugins: [
    react(),
    viteSingleFile()
  ],
  resolve: {
    alias: {
      '@app': resolve(__dirname, '../src'),
      '@resources': resolve(__dirname, '../resources')
    },
    dedupe: DEDUPE
  },
  build: {
    target: 'es2022',
    // Inline every asset (fonts included) as a data: URI so nothing is fetched
    // over the network at runtime. viteSingleFile already raises this, but we
    // pin it explicitly as a guarantee against a regression.
    assetsInlineLimit: () => true,
    chunkSizeWarningLimit: 8000,
    cssCodeSplit: false
  }
})

import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// OrbitPM Process Studio Lite — builds ONE self-contained dist/index.html.
//
// Everything (JS, CSS, and fonts) is inlined so the page makes ZERO external
// requests at runtime except the user's own AI calls (Anthropic / Gemini).
// Generation, validation, and editor helpers are owned by this browser
// application under `src/`; no active code reaches into an archived product
// tree. `dedupe` keeps a single instance of shared runtime packages. It
// deliberately does NOT include the bpmn.io internals
// (bpmn-moddle, min-dash, …): those have several legitimately-nested versions
// (bpmn-js needs bpmn-moddle@10's named export; bpmn-auto-layout needs @8's
// default export), and forcing one copy breaks the other. bpmn-js and its
// ecosystem resolve from this package with their correct nested versions.
const DEDUPE = ['react', 'react-dom', 'zod', 'bpmn-auto-layout']
const APP_VERSION = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string
  }
).version

/**
 * Vite 6 intentionally externalizes SVG URLs that contain a fragment. The
 * embedded BPMN icon stylesheet has one obsolete SVG-font fallback of that
 * form in addition to its already embedded TrueType font. Removing only that
 * legacy source keeps the modern embedded font and preserves Lite's strict
 * one-file distribution.
 */
function stripLegacyBpmnSvgFont(): Plugin {
  return {
    name: 'orbitpm-strip-legacy-bpmn-svg-font',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('/bpmn-font/css/bpmn-embedded.css')) return null
      return code.replace(
        /,\s*url\(['"]?\.\.\/font\/bpmn\.svg[^)]*\)\s*format\(['"]svg['"]\)/g,
        ''
      )
    }
  }
}

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION)
  },
  plugins: [
    stripLegacyBpmnSvgFont(),
    react(),
    viteSingleFile()
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
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

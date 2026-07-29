/**
 * Node-only file loading for `scanAmlForOle` — test-only.
 *
 * This module is deliberately **not** re-exported from `src/aris/details/index.ts`.
 * It imports `node:fs` at module scope, which is fine in a Vitest/Node test run
 * but is not something a browser-targeted module may do: importing it from the
 * `details` barrel would ship (or at minimum have Vite warn about) a Node
 * builtin to the production bundle. See `xmlScan.ts` for the browser-safe
 * scanning logic this module wraps.
 *
 * Tests that need to scan a real AML fixture from disk should import
 * `loadXmlScan` directly from this file, e.g.
 * `import { loadXmlScan } from './xmlScanLoader'`.
 */

import { decodeXmlEntities, scanAmlForOle, type ArisXmlScanResult } from './xmlScan'

export async function loadXmlScan(filePath: string): Promise<ArisXmlScanResult> {
  const fs = await import('node:fs')
  const text = fs.readFileSync(filePath, 'utf-8')
  return scanAmlForOle(decodeXmlEntities(text))
}

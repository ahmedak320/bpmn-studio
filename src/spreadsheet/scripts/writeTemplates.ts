/**
 * Release-asset materializer.
 *
 * Run from the Lite repository root:
 *   npx vite-node src/spreadsheet/scripts/writeTemplates.ts <output-directory>
 *
 * The application imports the same generator, so embedded downloads and
 * release assets are byte-identical.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createOfficialWorkbookTemplates } from '../template'

const outputDirectory = resolve(process.argv[2] ?? 'dist/release-assets')
await mkdir(outputDirectory, { recursive: true })

for (const { fileName, bytes } of Object.values(createOfficialWorkbookTemplates())) {
  await writeFile(resolve(outputDirectory, fileName), bytes)
}


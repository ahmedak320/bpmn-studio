import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, type PathLike } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'orbitpm-license-policy-'))
const noticesPath = join(temporaryDirectory, 'THIRD_PARTY_NOTICES.md')
const sbomPath = join(temporaryDirectory, 'OrbitPM.cyclonedx.json')

function runScript(script: string, args: string[] = []) {
  return spawnSync(process.execPath, [resolve(repositoryRoot, script), ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  })
}

function normalize(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trimEnd()
}

function indentedFile(path: PathLike): string {
  return normalize(readFileSync(path, 'utf8'))
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
}

beforeAll(() => {
  const notices = runScript('scripts/license-policy.mjs', ['--report', noticesPath])
  expect(notices.stderr).toBe('')
  expect(notices.status).toBe(0)

  const sbom = runScript('scripts/generate-sbom.mjs', ['--output', sbomPath])
  expect(sbom.stderr).toBe('')
  expect(sbom.status).toBe(0)
})

afterAll(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('release dependency compliance evidence', () => {
  it('preserves exact shipped license texts and correctly excludes bpmn-js', () => {
    const notices = readFileSync(noticesPath, 'utf8')

    // diagram-js is a real, currently-shipped `dependencies` entry (the native ARIS canvas is
    // built directly on diagram-js) — its verbatim LICENSE text must survive byte-for-byte.
    expect(notices).toContain('| diagram-js | 15.22.0 | MIT |')
    expect(notices).toContain('Sources: node_modules/diagram-js/LICENSE')
    expect(notices).toContain(
      indentedFile(resolve(repositoryRoot, 'node_modules/diagram-js/LICENSE'))
    )

    // bpmn-js, bpmn-moddle, bpmnlint and bpmn-auto-layout are devDependencies only: the ARIS-only
    // Lite runtime graph reachable from src/main.tsx never imports them (enforced by
    // check:aris-runtime-boundary, which bans bpmn-js et al. from that graph outright), and the
    // built release artifact does not bundle them. license-policy.mjs walks only non-dev lock
    // entries, so none of them — nor colors, a transitive dependency of bpmnlint's cli-table via
    // devDependencies only — are shipped, and none should appear in the production notices table.
    expect(notices).not.toContain('| bpmn-js |')
    expect(notices).not.toContain('| bpmnlint |')
    expect(notices).not.toContain('| colors |')
  })

  it('excludes bpmn-js from the CycloneDX SBOM since it is not part of the shipped ARIS runtime', () => {
    const sbom = JSON.parse(readFileSync(sbomPath, 'utf8')) as {
      components: Array<{
        name: string
        version: string
        licenses?: Array<
          | { expression: string }
          | { license: { name?: string; text?: { content?: string; contentType?: string } } }
        >
      }>
    }

    // Mirrors the notices assertion above: bpmn-js is a devDependency excluded from the ARIS
    // production runtime graph, so generate-sbom.mjs (which walks only non-dev lock entries)
    // correctly omits it. Its reviewed LicenseRef-bpmn-io classification and full watermark
    // license text (see scripts/license-policy-data.mjs's BPMN_JS_LICENSE) stay dormant in the
    // generator, ready to be enforced again the moment bpmn-js is ever promoted back to a real
    // `dependencies` entry — see the conditional check in scripts/generate-sbom.mjs.
    const bpmnComponent = sbom.components.find(({ name }) => name === 'bpmn-js')
    expect(bpmnComponent).toBeUndefined()

    // A real shipped component is still correctly present and license-tagged.
    const diagramJs = sbom.components.find(
      ({ name, version }) => name === 'diagram-js' && version === '15.22.0'
    )
    expect(diagramJs?.licenses?.[0]).toEqual({ expression: 'MIT' })
  })

  it('rejects a built artifact that statically hides the required attribution', () => {
    const visibleArtifact = join(temporaryDirectory, 'visible.html')
    writeFileSync(
      visibleArtifact,
      '<a href="http://bpmn.io" target="_blank" class="bjs-powered-by">bpmn.io</a>\n'
    )
    const visible = runScript('scripts/check-bpmn-attribution.mjs', [visibleArtifact])
    expect(visible.stderr).toBe('')
    expect(visible.status).toBe(0)

    const hiddenArtifact = join(temporaryDirectory, 'hidden.html')
    writeFileSync(
      hiddenArtifact,
      '<style>.bjs-powered-by { display: none }</style>' +
        '<a href="http://bpmn.io" class="bjs-powered-by">bpmn.io</a>\n'
    )
    const hidden = runScript('scripts/check-bpmn-attribution.mjs', [hiddenArtifact])
    expect(hidden.status).toBe(1)
    expect(hidden.stderr).toContain('statically hidden')
  })
})

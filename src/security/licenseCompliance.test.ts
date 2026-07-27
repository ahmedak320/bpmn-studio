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
  it('preserves exact shipped colors and bpmn-js license texts', () => {
    const notices = readFileSync(noticesPath, 'utf8')
    expect(notices).toContain('| bpmn-js | 18.21.0 | LicenseRef-bpmn-io |')
    expect(notices).toContain('Sources: node_modules/bpmn-js/LICENSE')
    expect(notices).toContain(indentedFile(resolve(repositoryRoot, 'node_modules/bpmn-js/LICENSE')))

    expect(notices).toContain('Sources: node_modules/colors/MIT-LICENSE.txt')
    expect(notices).toContain(
      indentedFile(resolve(repositoryRoot, 'node_modules/colors/MIT-LICENSE.txt'))
    )
    expect(notices).toContain(
      'Additional Functionality\n     - Copyright (c) Sindre Sorhus <sindresorhus@gmail.com>'
    )
  })

  it('embeds the reviewed bpmn-js LicenseRef and full text in CycloneDX', () => {
    const sbom = JSON.parse(readFileSync(sbomPath, 'utf8')) as {
      components: Array<{
        name: string
        version: string
        licenses?: Array<{
          license?: { name?: string; text?: { content?: string; contentType?: string } }
        }>
      }>
    }
    const component = sbom.components.find(
      ({ name, version }) => name === 'bpmn-js' && version === '18.21.0'
    )
    expect(component?.licenses?.[0]?.license).toEqual({
      name: 'LicenseRef-bpmn-io',
      text: {
        contentType: 'text/plain',
        content: normalize(
          readFileSync(resolve(repositoryRoot, 'node_modules/bpmn-js/LICENSE'), 'utf8')
        )
      }
    })
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

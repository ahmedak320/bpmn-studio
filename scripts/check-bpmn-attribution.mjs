import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BPMN_JS_LICENSE,
  containsBpmnAttributionMarkup,
  containsHiddenBpmnAttributionRule
} from './license-policy-data.mjs'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const failures = []
const bpmnPackageRoot = resolve(repositoryRoot, 'node_modules/bpmn-js')
const licensePath = resolve(bpmnPackageRoot, BPMN_JS_LICENSE.noticeFile)
const viewerPath = resolve(bpmnPackageRoot, 'lib/BaseViewer.js')

if (!existsSync(licensePath)) {
  failures.push(`missing reviewed bpmn-js license: ${licensePath}`)
} else {
  const license = readFileSync(licensePath, 'utf8')
  if (!license.includes(BPMN_JS_LICENSE.requiredLicenseText)) {
    failures.push('bpmn-js LICENSE no longer contains the reviewed watermark requirement')
  }
}

if (!existsSync(viewerPath)) {
  failures.push(`missing bpmn-js attribution source: ${viewerPath}`)
} else {
  const viewer = readFileSync(viewerPath, 'utf8')
  if (!containsBpmnAttributionMarkup(viewer)) {
    failures.push('bpmn-js source no longer emits the required linked powered-by attribution')
  }
}

const productionExtensions = new Set(['.css', '.html', '.js', '.jsx', '.ts', '.tsx'])
function scanProductionSource(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      scanProductionSource(path)
      continue
    }
    if (
      !productionExtensions.has(extname(entry.name)) ||
      /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)
    ) {
      continue
    }
    const source = readFileSync(path, 'utf8')
    if (containsHiddenBpmnAttributionRule(source)) {
      failures.push(`${path}: hides the required bpmn.io powered-by attribution`)
    }
  }
}
scanProductionSource(resolve(repositoryRoot, 'src'))

const sourceHtml = readFileSync(resolve(repositoryRoot, 'index.html'), 'utf8')
if (containsHiddenBpmnAttributionRule(sourceHtml)) {
  failures.push('index.html hides the required bpmn.io powered-by attribution')
}

const artifactArgument = process.argv[2]
if (artifactArgument) {
  const artifactPath = resolve(repositoryRoot, artifactArgument)
  if (!existsSync(artifactPath)) {
    failures.push(`built attribution artifact does not exist: ${artifactPath}`)
  } else {
    const artifact = readFileSync(artifactPath, 'utf8')
    if (!containsBpmnAttributionMarkup(artifact)) {
      failures.push(`${artifactPath}: required linked bpmn.io powered-by attribution is absent`)
    }
    if (containsHiddenBpmnAttributionRule(artifact)) {
      failures.push(`${artifactPath}: required bpmn.io powered-by attribution is statically hidden`)
    }
  }
}

if (failures.length) {
  console.error('bpmn.io attribution policy failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `bpmn.io attribution policy passed (${BPMN_JS_LICENSE.classification}; source${
    artifactArgument ? ' and built artifact' : ''
  }).`
)

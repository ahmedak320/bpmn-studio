export const BPMN_JS_LICENSE = Object.freeze({
  packageKey: 'bpmn-js@18.21.0',
  classification: 'LicenseRef-bpmn-io',
  noticeFile: 'LICENSE',
  attributionClass: 'bjs-powered-by',
  // Exact upstream value emitted by bpmn-js 18.21.0; changing it requires
  // reviewing the pinned dependency source and all release attribution gates.
  attributionHref: 'http://bpmn.io',
  requiredLicenseText: 'The source code responsible for displaying the bpmn.io project watermark'
})

export const reviewedLicenseOverrides = new Map([
  [BPMN_JS_LICENSE.packageKey, BPMN_JS_LICENSE.classification],
  ['cli-table@0.3.11', 'MIT'],
  ['rgbcolor@1.0.1', 'MIT']
])

export const requiredShippedNoticeFiles = new Map([
  [BPMN_JS_LICENSE.packageKey, BPMN_JS_LICENSE.noticeFile],
  ['colors@1.0.3', 'MIT-LICENSE.txt']
])

export const noticeFilePattern =
  /(?:^|[._-])licen[cs]e(?:$|[._-])|^(?:copying|notice|copyright|authors)(?:$|[._-])/i

export function lockedPackageKey(name, version) {
  return `${name}@${version}`
}

export function normalizeNoticeText(text) {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trimEnd()
}

export function containsBpmnAttributionMarkup(source) {
  const escapedClass = BPMN_JS_LICENSE.attributionClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedHref = BPMN_JS_LICENSE.attributionHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    `<a\\s+href=["']${escapedHref}/?["'][^>]*\\bclass=["'][^"']*\\b${escapedClass}\\b[^"']*["']`,
    'i'
  ).test(source)
}

export function containsHiddenBpmnAttributionRule(source) {
  return /\.bjs-powered-by\b[^{}]*\{[^}]*\b(?:display\s*:\s*none(?:\s*!important)?|visibility\s*:\s*hidden(?:\s*!important)?|opacity\s*:\s*0(?:\.0+)?(?:\s*!important)?\s*(?:[;}]))/is.test(
    source
  )
}

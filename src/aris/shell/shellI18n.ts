/**
 * Message lookup for the mounted ARIS shell.
 *
 * `src/i18n/dictionaries.ts` is owned by a different lane, so the keys this
 * wave introduces are not registered there yet. `t()` is typed
 * `(key: keyof typeof en)`, which means a literal for an unregistered key would
 * not type-check at all — and silently rendering the raw key string in the UI
 * would be worse than useless.
 *
 * `tk()` therefore does exactly one thing: it asks the real dictionary first
 * and, only when the dictionary has no entry (which `t()` signals by echoing
 * the key back), falls back to the English source string declared at the call
 * site. The moment the orchestrator registers a key in `dictionaries.ts` the
 * fallback stops being reachable for that key in both languages — no call site
 * changes, no second dictionary to keep in sync.
 *
 * Every key introduced this way is listed in `ARIS_SHELL_MESSAGE_KEYS` below so
 * registration is a mechanical copy rather than a grep.
 */

import { t, type Key } from '../../i18n'

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/gu, (_match, name: string) =>
    String(vars[name] ?? `{${name}}`)
  )
}

/**
 * Look up `key`; fall back to `sourceText` while the key is unregistered.
 *
 * @param key i18n message key, in the `aris.*` namespace.
 * @param sourceText the English source string for that key.
 */
export function tk(
  key: string,
  sourceText: string,
  vars?: Record<string, string | number>
): string {
  const resolved = t(key as Key, vars)
  // `t()` returns the key itself when neither the active language nor the
  // English dictionary has an entry.
  if (resolved !== key) return resolved
  return interpolate(sourceText, vars)
}

/** Every key `tk()` is called with, with its English source text. */
export const ARIS_SHELL_MESSAGE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  'aris.canvas.aria': 'ARIS canvas for {model}',
  'aris.canvas.noModels':
    'This source carries no ARIS model records, so there is nothing to draw. The source, accounting and details rails still describe every imported record.',
  'aris.canvas.unsupportedModelType':
    'Model type {type} is outside the supported canvas scope, so it is listed but not drawn.',
  'aris.canvas.bootFailed': 'The ARIS canvas could not be opened: {error}',
  'aris.explorer.models': 'Models',
  'aris.explorer.modelSummary': '{objects} objects · {connections} connections',
  'aris.explorer.modelListAria': 'ARIS models in {source}',
  'aris.toolbar.aria': 'ARIS canvas controls',
  'aris.toolbar.undo': 'Undo',
  'aris.toolbar.redo': 'Redo',
  'aris.toolbar.cleanLayout': 'Clean Layout',
  'aris.toolbar.resetLayout': 'Reset to Source Layout',
  'aris.toolbar.layoutMode.source': 'Source Layout',
  'aris.toolbar.layoutMode.clean': 'Clean Layout',
  'aris.toolbar.importPackage': 'Import into workspace…',
  'aris.layout.cleanApplied': 'Clean Layout applied as one undoable step.',
  'aris.layout.resetApplied': 'Reset to the imported source layout.',
  'aris.layout.rejected': 'Clean Layout was rejected: {reason}',
  'aris.layout.failed': 'Clean Layout failed: {error}',
  'aris.rail.details': 'Details',
  'aris.rail.metadata': 'Metadata',
  'aris.details.attachment.download': 'Download {name}',
  'aris.rail.accounting': 'Accounting',
  'aris.rail.fidelity': 'Fidelity',
  'aris.rail.aria': 'ARIS details and accounting rails',
  'aris.details.noSelection': 'Select an element on the canvas to inspect it.',
  'aris.details.selectionAria': 'Details for {element}',
  'aris.details.emptyTab': 'No values for this tab.',
  'aris.details.missing': 'Not set',
  'aris.accounting.summary':
    '{accounted} of {total} source records accounted for; {unaccounted} unaccounted.',
  'aris.accounting.filter': 'Filter accounting rows',
  'aris.accounting.showing': 'Showing {shown} of {matched} matching rows.',
  'aris.accounting.showMore': 'Show more rows',
  'aris.accounting.rowAria': 'Select {id} on the canvas',
  'aris.accounting.notOnCanvas': 'That record has no element on the current model.',
  'aris.accounting.column.path': 'Source path',
  'aris.accounting.column.kind': 'Kind',
  'aris.accounting.column.disposition': 'Disposition',
  'aris.accounting.column.id': 'Source id',
  'aris.accounting.issues': 'Issues',
  'aris.accounting.noIssues': 'No reconciliation issues.',
  'aris.fidelity.none': 'No visual fallbacks were reported for this source.',
  'aris.fidelity.count': '{count} findings',
  'aris.import.review.title': 'Review this import',
  'aris.import.review.source': 'Source',
  'aris.import.review.digest': 'Review digest',
  'aris.import.review.duplicate':
    'An identical source digest is already stored; committing will deduplicate.',
  'aris.import.review.counts':
    '{models} models · {writes} package members · {bytes} bytes · {attachments} attachments',
  'aris.import.review.fidelity':
    '{accounted} of {total} records accounted for, {unaccounted} unaccounted.',
  'aris.import.review.writes': 'Package members to be written',
  'aris.import.review.confirm': 'Commit import',
  'aris.import.review.cancel': 'Cancel',
  'aris.import.committed': 'Imported {name} into the workspace package store.',
  'aris.import.downloaded':
    'Imported {name}; the portable workspace container was downloaded rather than written in place.',
  'aris.import.deduplicated': 'That exact source is already stored; nothing was written.',
  'aris.import.rolledBack': 'The import failed and was rolled back: {error}',
  'aris.import.flushFailed': 'The workspace package was written but the file save failed: {error}',
  'aris.import.failed': 'The import could not be prepared: {error}',
  'aris.ai.cancelled': 'The request was cancelled; nothing was created.',
  'aris.ai.created':
    'Created {models} models, {objects} objects, {relations} relations; {uncertainties} uncertainties reported.',
  'aris.ai.failed': 'The request failed: {error}',
  'aris.ai.notJson': 'The provider did not return strict JSON: {error}',
  'aris.ai.rejected': 'The draft was rejected and nothing was created.',
  'aris.assistant.ask.body':
    'Answered locally from the indexed models. No provider and no API key are used.',
  'aris.assistant.ask.heading': 'Ask the process library',
  'aris.assistant.ask.indexed': '{count} indexed models',
  'aris.assistant.ask.label': 'Question',
  'aris.assistant.ask.submit': 'Ask',
  'aris.assistant.chip.unavailable': 'That element is not open on a renderable canvas.',
  'aris.assistant.suggest.missing': 'Which information is missing?',
  'aris.assistant.suggest.processes': 'Which processes are available?',
  'aris.chat.apply': 'Apply answers',
  'aris.chat.commitFailed': 'The canvas rejected the change; nothing was applied.',
  'aris.chat.confirmApply': 'Apply selected changes',
  'aris.chat.confirmHeading': 'These changes need confirmation',
  'aris.chat.finished': 'Interview finished: {status}',
  'aris.chat.gapCount': '{count} gaps found',
  'aris.chat.noProposal':
    'Those answers do not map to a change this build can make deterministically.',
  'aris.chat.nothingSelected': 'Select at least one change to apply.',
  'aris.chat.preview.after': 'After',
  'aris.chat.preview.before': 'Before',
  'aris.chat.proposeRemoval': 'Propose removing it',
  'aris.chat.provenanceRejected': 'A change receipt was withheld from history.',
  'aris.chat.rejected': 'The patch was rejected: {error}',
  'aris.chat.round': 'Round {round} of 5 · {status}',
  'aris.chat.start': 'Start completion interview',
  'aris.chat.undo': 'Undo last applied change',
  'aris.create.consent': 'I reviewed the request above and consent to sending it',
  'aris.create.modelType': 'Model type',
  'aris.create.noKey': 'No API key is stored for this provider. Open Settings to add one.',
  'aris.create.preview': 'Exact outbound request',
  'aris.create.provider': 'Provider',
  'aris.create.redactNames': 'Redact names in workspace context',
  'aris.create.requestEstimate': 'Up to {count} requests',
  'aris.create.sensitivity': 'Names detected: {names} · Sensitive metadata: {meta}',
  'aris.create.tab.description': 'Description',
  'aris.create.tab.excel': 'Excel',
  'aris.create.tabsAria': 'Create input source',
  'aris.epc.findingAria': 'Select {id} on the canvas',
  'aris.epc.none': 'No EPC rule violations were found in this source.',
  'aris.epc.notOnCanvas': 'That finding has no element on a renderable model.',
  'aris.epc.severity.error': 'Error',
  'aris.epc.severity.warning': 'Warning',
  'aris.epc.showMore': 'Show more findings',
  'aris.epc.summary': '{errors} errors · {warnings} warnings',
  'aris.excel.body':
    'Fill in the official ARIS template and create native models with no AI at all.',
  'aris.excel.create': 'Create from workbook…',
  'aris.excel.created': 'Created {models} models, {objects} objects, {connections} connections.',
  'aris.excel.downloadBlank': 'Download blank template',
  'aris.excel.downloadExample': 'Download example template',
  'aris.excel.failed': 'The workbook could not be read: {error}',
  'aris.excel.legacy':
    'That is the retired BPMN 0.4.5 workbook. Download the ARIS template below and re-enter the process there.',
  'aris.excel.rejected': 'The workbook was rejected: {errors} errors, {warnings} warnings.',
  'aris.export.done': 'Derived AML exported: {edits} edits, {bytes} bytes.',
  'aris.export.refused': 'The derived export was refused: {error}',
  'aris.export.unmapped':
    '{count} edits could not be addressed against the original bytes and were left out.',
  'aris.rail.epc': 'EPC validation',
  'aris.rail.improve': 'Improve this process'
})

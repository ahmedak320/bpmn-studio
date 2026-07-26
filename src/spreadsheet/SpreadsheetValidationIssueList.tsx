import { useId, type AriaAttributes } from 'react'

import { t, type Key } from '../i18n'
import type { SpreadsheetValidationIssue, ValidationSeverity } from './contracts'
import './SpreadsheetValidationIssueList.css'

const DEFAULT_VALUE_LENGTH = 300
const MAX_VALUE_LENGTH = 2_000
const UNAVAILABLE_VALUE = '<unavailable>'

type TranslationVariables = Record<string, string | number>

const LABEL_FALLBACKS = Object.freeze({
  worksheet: 'Worksheet',
  cell: 'Cell',
  rawValue: 'Raw value',
  normalizedValue: 'Normalized value',
  guidance: 'Repair guidance'
})

const SEVERITY_FALLBACKS: Readonly<Record<ValidationSeverity, string>> = Object.freeze({
  error: 'Error',
  review: 'Review',
  warning: 'Warning',
  info: 'Information'
})

function translationVariables(
  details: SpreadsheetValidationIssue['details']
): TranslationVariables | undefined {
  if (!details) return undefined
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      typeof value === 'boolean' ? String(value) : value
    ])
  )
}

function humanizeKey(key: string): string {
  const leaf = key.split('.').at(-1)?.trim() ?? ''
  const words = leaf
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .trim()
  if (!words) return key
  return `${words.charAt(0).toLocaleUpperCase()}${words.slice(1)}`
}

function translate(
  key: string,
  variables?: TranslationVariables,
  fallback = humanizeKey(key)
): string {
  const translated = t(key as Key, variables)
  return translated && translated !== key ? translated : fallback
}

function translateIssueMessage(key: string, variables: TranslationVariables | undefined): string {
  const fallback = translate('spreadsheet.validation.issueFallback', undefined, humanizeKey(key))
  return translate(key, variables, fallback)
}

function translateIssueGuidance(key: string, variables: TranslationVariables | undefined): string {
  const fallback = translate('spreadsheet.validation.guidanceFallback', undefined, humanizeKey(key))
  return translate(key, variables, fallback)
}

function metadataLabel(name: keyof typeof LABEL_FALLBACKS, fallbackKey?: string): string {
  const key = `spreadsheet.validation.${name}`
  const translated = t(key as Key)
  if (translated && translated !== key) return translated
  if (fallbackKey) {
    const fallbackTranslation = t(fallbackKey as Key)
    if (fallbackTranslation && fallbackTranslation !== fallbackKey) return fallbackTranslation
  }
  return LABEL_FALLBACKS[name]
}

function severityLabel(severity: ValidationSeverity): string {
  return translate(`validation.severity.${severity}`, undefined, SEVERITY_FALLBACKS[severity])
}

function boundedLength(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_VALUE_LENGTH
  return Math.min(MAX_VALUE_LENGTH, Math.max(1, Math.floor(value)))
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    typeof value === 'symbol'
  ) {
    try {
      return String(value)
    } catch {
      return UNAVAILABLE_VALUE
    }
  }
  try {
    if (value instanceof Date) {
      return value.toISOString()
    }
    return Object.prototype.toString.call(value)
  } catch {
    return UNAVAILABLE_VALUE
  }
}

function truncateValue(
  value: unknown,
  maximumLength: number
): {
  readonly text: string
  readonly truncated: boolean
} {
  const text = displayValue(value)
  if (text.length <= maximumLength) return { text, truncated: false }

  let end = maximumLength
  const finalCodeUnit = text.charCodeAt(end - 1)
  const nextCodeUnit = text.charCodeAt(end)
  if (
    finalCodeUnit >= 0xd800 &&
    finalCodeUnit <= 0xdbff &&
    nextCodeUnit >= 0xdc00 &&
    nextCodeUnit <= 0xdfff
  ) {
    end -= 1
  }
  return { text: `${text.slice(0, end)}…`, truncated: true }
}

function safeIdPrefix(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9_.:-]+/g, '-')
  return normalized || 'spreadsheet-validation'
}

function issueKey(issue: SpreadsheetValidationIssue, index: number): string {
  return [
    issue.code,
    issue.processId ?? '',
    issue.elementId ?? '',
    issue.worksheet ?? '',
    issue.cellAddress ?? '',
    index
  ].join(':')
}

interface MetadataRowProps {
  readonly id: string
  readonly label: string
  readonly value: unknown
  readonly maximumLength: number
  readonly code?: boolean
}

function MetadataRow({
  id,
  label,
  value,
  maximumLength,
  code = false
}: MetadataRowProps): JSX.Element {
  const display = truncateValue(value, maximumLength)
  const content = code ? (
    <code
      className="orbitpm-spreadsheet-validation__value"
      dir="auto"
      aria-label={`${label}: ${display.text}`}
      data-truncated={display.truncated ? 'true' : 'false'}
    >
      {display.text}
    </code>
  ) : (
    <span
      className="orbitpm-spreadsheet-validation__value"
      dir="auto"
      aria-label={`${label}: ${display.text}`}
      data-truncated={display.truncated ? 'true' : 'false'}
    >
      {display.text}
    </span>
  )

  return (
    <div id={id} className="orbitpm-spreadsheet-validation__metadata-row">
      <dt>{label}</dt>
      <dd>{content}</dd>
    </div>
  )
}

export interface SpreadsheetValidationIssueListProps {
  readonly issues: readonly SpreadsheetValidationIssue[]
  /** Exact DOM id for the ordered list. */
  readonly listId?: string
  /** Stable prefix for generated item and description ids. */
  readonly idPrefix?: string
  readonly ariaLabel?: string
  readonly ariaLive?: AriaAttributes['aria-live']
  readonly busy?: boolean
  readonly maxValueLength?: number
  readonly className?: string
}

export function SpreadsheetValidationIssueList({
  issues,
  listId,
  idPrefix,
  ariaLabel,
  ariaLive = 'polite',
  busy = false,
  maxValueLength,
  className
}: SpreadsheetValidationIssueListProps): JSX.Element {
  const generatedId = useId()
  const prefix = safeIdPrefix(idPrefix ?? listId ?? `spreadsheet-validation-${generatedId}`)
  const resolvedListId = listId ?? `${prefix}-list`
  const emptyId = `${prefix}-empty`
  const maximumLength = boundedLength(maxValueLength)
  const rootClassName = [
    'orbitpm-spreadsheet-validation',
    className?.trim() ? className.trim() : undefined
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={rootClassName}
      aria-live={ariaLive}
      aria-atomic="false"
      aria-relevant="additions text"
      aria-busy={busy}
    >
      {issues.length === 0 ? (
        <p id={emptyId} className="orbitpm-spreadsheet-validation__empty">
          {t('spreadsheet.validation.noIssues')}
        </p>
      ) : null}
      <ol
        id={resolvedListId}
        className="orbitpm-spreadsheet-validation__issues"
        aria-label={ariaLabel ?? t('spreadsheet.validation.title')}
        aria-describedby={issues.length === 0 ? emptyId : undefined}
      >
        {issues.map((issue, index) => {
          const itemPrefix = `${prefix}-issue-${index}`
          const severityId = `${itemPrefix}-severity`
          const messageId = `${itemPrefix}-message`
          const descriptionIds: string[] = []
          const variables = translationVariables(issue.details)
          const message = translateIssueMessage(issue.messageKey, variables)

          if (issue.worksheet !== undefined) descriptionIds.push(`${itemPrefix}-worksheet`)
          if (issue.cellAddress !== undefined) descriptionIds.push(`${itemPrefix}-cell`)
          if (issue.rawValue !== undefined) descriptionIds.push(`${itemPrefix}-raw-value`)
          if (issue.normalizedValue !== undefined) {
            descriptionIds.push(`${itemPrefix}-normalized-value`)
          }
          if (issue.guidanceKey) descriptionIds.push(`${itemPrefix}-guidance`)

          return (
            <li
              key={issueKey(issue, index)}
              id={itemPrefix}
              className={`orbitpm-spreadsheet-validation__issue orbitpm-spreadsheet-validation__issue--${issue.severity}`}
              data-severity={issue.severity}
              aria-labelledby={`${severityId} ${messageId}`}
              aria-describedby={descriptionIds.length > 0 ? descriptionIds.join(' ') : undefined}
            >
              <div className="orbitpm-spreadsheet-validation__heading">
                <span
                  id={severityId}
                  className="orbitpm-spreadsheet-validation__severity"
                  data-severity={issue.severity}
                >
                  {severityLabel(issue.severity)}
                </span>
                <code dir="auto">{issue.code}</code>
              </div>
              <p id={messageId} className="orbitpm-spreadsheet-validation__message" dir="auto">
                {message}
              </p>
              {descriptionIds.some((id) => id !== `${itemPrefix}-guidance`) ? (
                <dl className="orbitpm-spreadsheet-validation__metadata">
                  {issue.worksheet !== undefined ? (
                    <MetadataRow
                      id={`${itemPrefix}-worksheet`}
                      label={metadataLabel('worksheet', 'spreadsheet.mapping.sheet')}
                      value={issue.worksheet}
                      maximumLength={maximumLength}
                    />
                  ) : null}
                  {issue.cellAddress !== undefined ? (
                    <MetadataRow
                      id={`${itemPrefix}-cell`}
                      label={metadataLabel('cell', 'validation.location')}
                      value={issue.cellAddress}
                      maximumLength={maximumLength}
                    />
                  ) : null}
                  {issue.rawValue !== undefined ? (
                    <MetadataRow
                      id={`${itemPrefix}-raw-value`}
                      label={metadataLabel('rawValue')}
                      value={issue.rawValue}
                      maximumLength={maximumLength}
                      code
                    />
                  ) : null}
                  {issue.normalizedValue !== undefined ? (
                    <MetadataRow
                      id={`${itemPrefix}-normalized-value`}
                      label={metadataLabel('normalizedValue')}
                      value={issue.normalizedValue}
                      maximumLength={maximumLength}
                      code
                    />
                  ) : null}
                </dl>
              ) : null}
              {issue.guidanceKey ? (
                <p
                  id={`${itemPrefix}-guidance`}
                  className="orbitpm-spreadsheet-validation__guidance"
                  dir="auto"
                >
                  <strong>{metadataLabel('guidance', 'validation.repair')}: </strong>
                  {translateIssueGuidance(issue.guidanceKey, variables)}
                </p>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

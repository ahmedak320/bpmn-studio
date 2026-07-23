// CSV export for the owners index. Excel-friendly: UTF-8 BOM prefix and
// CRLF line endings, RFC-4180 field quoting.

import type { OwnerEntry } from './ownersIndex'

const BOM = '﻿'
const CRLF = '\r\n'

function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * Render owner entries as a CSV string: header `name,type,usage_count`,
 * RFC-4180 quoting, prefixed with a UTF-8 BOM and CRLF line endings.
 */
export function ownersToCsv(entries: OwnerEntry[]): string {
  const lines: string[] = ['name,type,usage_count']
  for (const entry of entries) {
    lines.push(
      [csvField(entry.name), csvField(entry.type ?? ''), String(entry.count)].join(',')
    )
  }
  return BOM + lines.join(CRLF) + CRLF
}

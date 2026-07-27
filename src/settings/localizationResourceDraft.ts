import { normalizeLocalizationLookup } from '../localization/glossary'
import { validateTargetScript } from '../localization/script'
import {
  createWorkspaceGlossaryDocument,
  createWorkspaceTranslationMemoryDocument
} from '../localization/workspaceStore'
import type { GlossaryEntry, TranslationMemoryEntry } from '../localization/types'

export type LocalizationResourceDraftField =
  'en' | 'ar' | 'neutral' | 'accepted' | 'acceptedAt' | 'document'

export type LocalizationResourceDraftIssueCode =
  | 'english-required'
  | 'arabic-required'
  | 'english-script'
  | 'arabic-script'
  | 'neutral-mismatch'
  | 'accepted-only'
  | 'schema'

export interface LocalizationResourceDraftIssue {
  readonly row: number
  readonly field: LocalizationResourceDraftField
  readonly code: LocalizationResourceDraftIssueCode
}

function normalized(value: string): string {
  return normalizeLocalizationLookup(value)
}

function bilingualIssues(
  entry: Pick<GlossaryEntry, 'en' | 'ar'>,
  row: number,
  neutral: boolean
): LocalizationResourceDraftIssue[] {
  const issues: LocalizationResourceDraftIssue[] = []
  const en = normalized(entry.en)
  const ar = normalized(entry.ar)
  if (!en) issues.push({ row, field: 'en', code: 'english-required' })
  if (!ar) issues.push({ row, field: 'ar', code: 'arabic-required' })
  if (!en || !ar) return issues

  if (neutral) {
    if (en !== ar) {
      issues.push({ row, field: 'neutral', code: 'neutral-mismatch' })
    }
    return issues
  }

  const classifierOptions = { approvedNeutralTerms: [] }
  const english = validateTargetScript(en, 'en', classifierOptions)
  const arabic = validateTargetScript(ar, 'ar', classifierOptions)
  if (!english.valid || english.script !== 'english') {
    issues.push({ row, field: 'en', code: 'english-script' })
  }
  if (!arabic.valid || arabic.script !== 'arabic') {
    issues.push({ row, field: 'ar', code: 'arabic-script' })
  }
  return issues
}

export function validateGlossaryDraft(
  entries: readonly GlossaryEntry[]
): LocalizationResourceDraftIssue[] {
  const issues = entries.flatMap((entry, row) =>
    bilingualIssues(entry, row, entry.neutral === true)
  )
  if (issues.length > 0) return issues
  try {
    createWorkspaceGlossaryDocument(entries)
    return []
  } catch {
    return [{ row: -1, field: 'document', code: 'schema' }]
  }
}

export function validateTranslationMemoryDraft(
  entries: readonly TranslationMemoryEntry[]
): LocalizationResourceDraftIssue[] {
  const issues = entries.flatMap((entry, row) => {
    const current = bilingualIssues(entry, row, false)
    if (entry.accepted !== true) {
      current.push({ row, field: 'accepted', code: 'accepted-only' })
    }
    return current
  })
  if (issues.length > 0) return issues
  try {
    createWorkspaceTranslationMemoryDocument(entries)
    return []
  } catch {
    return [{ row: -1, field: 'document', code: 'schema' }]
  }
}

export function issueForField(
  issues: readonly LocalizationResourceDraftIssue[],
  row: number,
  ...fields: readonly LocalizationResourceDraftField[]
): LocalizationResourceDraftIssue | undefined {
  return issues.find((issue) => issue.row === row && fields.includes(issue.field))
}

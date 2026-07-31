import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

import { buildConventionFindings } from '../conventions/validate'
import { buildFromSource } from '../model/buildFromSource'
import type { ArisWorkingDocument } from '../model/types'
import { buildArisEpcFindings } from '../shell/arisEpcFindings'
import { buildArisValidationFindings } from '../shell/arisValidationFindings'
import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import { scanArisChatGaps } from './gapScanner'

const ANIMAL_WF_PATH = fileURLToPath(
  new URL('../../../../reference/AnimalWF/ARISAMLExport.xml', import.meta.url)
)
if (!existsSync(ANIMAL_WF_PATH)) {
  throw new Error(
    `AnimalWF fixture not found at ${ANIMAL_WF_PATH}. This suite only runs via ` +
      '`npm run test:aris:animalwf` with the private reference export present locally; it is ' +
      'never run as part of the default test suite and never skips.'
  )
}

let workingDocument: ArisWorkingDocument

beforeAll(() => {
  const xml = readFileSync(ANIMAL_WF_PATH, 'utf8')
  workingDocument = buildFromSource(buildSemanticArisDocument(tokenizeXmlDocument(xml)).index)
}, 60_000)

function englishModelName(modelId: string): string {
  const model = workingDocument.models.get(modelId)
  if (!model) return ''
  return model.names.values.en ?? model.names.values['en-US'] ?? model.names.fallback ?? ''
}

function findModel(pattern: RegExp) {
  const model = [...workingDocument.models.values()].find((candidate) =>
    pattern.test(englishModelName(candidate.id))
  )
  expect(model).toBeDefined()
  return model!
}

/**
 * DMT-awareness regression pins for the validation rail (W6 gap lane). Before the fix the
 * clean AnimalWF import reported ~410 errors document-wide: 226 missing Arabic names, 92
 * missing owners, 92 missing process codes, plus VACD-manufactured EPC findings. All of
 * them were DMT-unaware false positives or advisory items mislabeled as errors.
 */
describe('AnimalWF DMT-aware gap scanning', () => {
  it('reports zero error-severity gaps document-wide on the clean DMT import', () => {
    const gaps = scanArisChatGaps(workingDocument)
    expect(gaps.filter((gap) => gap.severity === 'error')).toEqual([])
  })

  it('does not invent process-code/owner attribute gaps the DMT convention does not define', () => {
    // The DMT manual defines no process-code or owner ATTRIBUTE on functions (ownership is
    // the RACI executor connection; the mandatory code is the AT_ID Identifier), and the
    // export uses neither attribute type on any OT_FUNC — so both checks stay silent.
    const gaps = scanArisChatGaps(workingDocument)
    expect(gaps.some((gap) => gap.kind === 'missingProcessCode')).toBe(false)
    expect(gaps.some((gap) => gap.kind === 'missingOwner')).toBe(false)
  })

  it('exempts the VACD from EPC rule findings and IO/satellite completeness', () => {
    const gaps = scanArisChatGaps(workingDocument)
    // The seven EEPCs are clean and the VACD is exempt, so no re-exposed EPC rule
    // findings survive at all (formerly 2 missing-start/end errors + 13 orphan warnings,
    // all manufactured by running the EPC rule table on the value-added chain).
    expect(gaps.filter((gap) => gap.messageKey.startsWith('aris.epc.finding.'))).toEqual([])

    // Only EEPC functions are checked for IO/system wiring: the 14 VACD chain elements
    // are exempt, leaving the 6 genuine EEPC occurrences.
    const vacd = [...workingDocument.models.values()].find(
      (model) => model.type === 'MT_VAL_ADD_CHN_DGM'
    )!
    const vacdOccurrenceIds = new Set(vacd.occurrences.map((occurrence) => occurrence.id))
    const ioGaps = gaps.filter((gap) => gap.kind === 'missingInputsOutputsSystems')
    expect(ioGaps).toHaveLength(6)
    expect(ioGaps.every((gap) => gap.targetIds.every((id) => !vacdOccurrenceIds.has(id)))).toBe(
      true
    )
  })

  it('keeps the genuine missing-Arabic-name findings, down-ranked to advisory warnings', () => {
    const arabicNameGaps = scanArisChatGaps(workingDocument).filter(
      (gap) => gap.kind === 'missingArabicName'
    )
    expect(arabicNameGaps).toHaveLength(226)
    expect(arabicNameGaps.every((gap) => gap.severity === 'warning')).toBe(true)
  })

  it('leaves the register-owner model clean: 0 errors, its 25 convention warnings intact', () => {
    const registerOwner = findModel(/register or renew animal owner profile/i)

    expect(
      buildArisEpcFindings(workingDocument, new Set([registerOwner.id])).filter(
        (finding) => finding.severity === 'error'
      )
    ).toEqual([])

    const convention = buildConventionFindings(workingDocument, new Set([registerOwner.id]))
    expect(
      convention.filter((finding) => finding.ruleId === 'conv.function.noExecutor')
    ).toHaveLength(9)
    expect(convention.filter((finding) => finding.ruleId === 'conv.naming.hint')).toHaveLength(16)
    expect(convention.filter((finding) => finding.severity === 'error')).toEqual([])
  })

  it('scopes conv.function.noExecutor to EEPCs, keeping the VACD’s genuine warnings', () => {
    const vacd = [...workingDocument.models.values()].find(
      (model) => model.type === 'MT_VAL_ADD_CHN_DGM'
    )!
    const findings = buildConventionFindings(workingDocument, new Set([vacd.id]))
    // Executor R/A/C/I wiring is an EPC-only relationship in the DMT manual.
    expect(findings.filter((finding) => finding.ruleId === 'conv.function.noExecutor')).toEqual([])
    // Genuine per the manual: Identifier is mandatory for VACD elements; naming is advisory.
    expect(
      findings.filter((finding) => finding.ruleId === 'conv.function.missingIdentifier')
    ).toHaveLength(2)
    expect(findings.filter((finding) => finding.ruleId === 'conv.naming.hint')).toHaveLength(1)
  })

  it('drives the unified validation rail to zero errors while retaining legitimate warnings', () => {
    const epcFindings = [
      ...buildArisEpcFindings(workingDocument),
      ...buildConventionFindings(workingDocument)
    ]
    const findings = buildArisValidationFindings(
      workingDocument,
      epcFindings,
      scanArisChatGaps(workingDocument)
    )
    expect(findings.filter((finding) => finding.severity === 'error')).toEqual([])
    expect(findings.filter((finding) => finding.severity === 'warning').length).toBeGreaterThan(0)
  })
})

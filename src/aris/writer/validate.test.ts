import { describe, expect, it } from 'vitest'
import { declaredIds, readWriterSourceView } from './sourceView'
import { FIXTURE_IDS, SAMPLE_AML } from './testFixture'
import {
  ARIS_EXPORT_CHECKS,
  validateDerivedAml,
  type ArisExportCheck,
  type ArisExportValidationOptions
} from './validate'

const ORIGINAL_IDS = declaredIds(readWriterSourceView(SAMPLE_AML))
const ORIGINAL_DOCTYPE = readWriterSourceView(SAMPLE_AML).doctypeExternalId

function options(
  overrides: Partial<ArisExportValidationOptions> = {}
): ArisExportValidationOptions {
  return {
    accounting: { originalIds: ORIGINAL_IDS, removedIds: [], addedIds: [] },
    originalDoctypeExternalId: ORIGINAL_DOCTYPE,
    ...overrides
  }
}

/**
 * Assert that a fixture fails EXACTLY the named check. Every section 9.3 check gets one of
 * these, so a fixture that trips two checks at once (a sign the checks are not independent)
 * fails the test rather than passing it by accident.
 */
function expectOnlyFailure(
  derived: string,
  check: ArisExportCheck,
  validationOptions: ArisExportValidationOptions = options()
): void {
  const report = validateDerivedAml(derived, validationOptions)
  const failed = report.checks.filter((entry) => !entry.passed).map((entry) => entry.check)
  expect(failed).toEqual([check])
  expect(report.ok).toBe(false)
  expect(report.issues.length).toBeGreaterThan(0)
  expect(report.issues.every((issue) => issue.check === check)).toBe(true)
}

describe('validateDerivedAml — the unedited fixture', () => {
  it('passes every plan section 9.3 check', () => {
    const report = validateDerivedAml(SAMPLE_AML, options())
    expect(report.issues).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.checks.map((check) => check.check)).toEqual(ARIS_EXPORT_CHECKS)
  })
})

describe('9.3 — XML is well formed', () => {
  it('fails when the derived document does not parse', () => {
    expectOnlyFailure(SAMPLE_AML.replace('</AML>\n', ''), 'xml-well-formed')
  })

  it('fails on malformed nesting', () => {
    expectOnlyFailure(SAMPLE_AML.replace('<Flag/>', '<Flag></Wrong>'), 'xml-well-formed')
  })
})

describe('9.3 — IDs are unique', () => {
  it('fails when two records declare the same id', () => {
    // A second lane re-using the first lane's id. Nothing references lane ids, and the set of
    // ids present is unchanged, so uniqueness is the only check this can violate.
    const duplicated = SAMPLE_AML.replace(
      '\t\t\t\t</Lane>\n',
      `\t\t\t\t</Lane>\n\t\t\t\t<Lane Lane.ID="${FIXTURE_IDS.lane}" Orientation="VERTICAL"/>\n`
    )
    expect(duplicated).not.toBe(SAMPLE_AML)
    expectOnlyFailure(duplicated, 'unique-ids')
  })
})

describe('9.3 — all definition references resolve', () => {
  it('fails when an occurrence points at a definition that does not exist', () => {
    // The negative lookbehind keeps this away from `ToObjDef.IdRef`, which is the connection
    // endpoint attribute and has its own check.
    expectOnlyFailure(
      SAMPLE_AML.replace(/(?<!To)ObjDef\.IdRef="[^"]*"/, 'ObjDef.IdRef="ObjDef.MISSINGMISS-p-L"'),
      'definition-references-resolve'
    )
  })

  it('fails when a font style sheet reference dangles', () => {
    expectOnlyFailure(
      SAMPLE_AML.replace(
        `FontSS.IdRef="${FIXTURE_IDS.fontStyleSheet}"\n`,
        'FontSS.IdRef="FontSS.MISSINGMISS-c-L"\n'
      ),
      'definition-references-resolve'
    )
  })
})

describe('9.3 — every occurrence belongs to an existing model', () => {
  it('fails when an occurrence sits outside any Model element', () => {
    const strayOccurrence = `\t<ObjOcc ObjOcc.ID="ObjOcc.AAAAAAAAAAA-u-L-STRAYSTRAYS-x-L-33-c" ObjDef.IdRef="${FIXTURE_IDS.activity}">\n\t\t<Position Pos.X="0" Pos.Y="0"/>\n\t\t<Size Size.dX="1" Size.dY="1"/>\n\t</ObjOcc>\n`
    expectOnlyFailure(
      SAMPLE_AML.replace('</AML>', `${strayOccurrence}</AML>`),
      'occurrences-belong-to-a-model',
      options({
        accounting: {
          originalIds: ORIGINAL_IDS,
          addedIds: ['ObjOcc.AAAAAAAAAAA-u-L-STRAYSTRAYS-x-L-33-c']
        }
      })
    )
  })
})

describe('9.3 — every connection endpoint exists', () => {
  it('fails when a connection occurrence is not nested under a source occurrence', () => {
    const source = readWriterSourceView(SAMPLE_AML)
    const connection = source.byId.get(FIXTURE_IDS.connectionOccurrence)!
    const block = SAMPLE_AML.slice(connection.span.start, connection.span.end)
    // Move the connection occurrence out of its source ObjOcc but keep it inside the Model, so
    // the occurrence-in-a-model check still passes and only the endpoint check fails.
    const moved = SAMPLE_AML.replace(block, '<Placeholder/>').replace(
      '\t\t\t</Model>',
      `\t\t\t\t${block}\n\t\t\t</Model>`
    )
    expectOnlyFailure(moved, 'connection-endpoints-exist')
  })

  it('fails when a connection definition targets a definition that does not exist', () => {
    const broken = SAMPLE_AML.replace(
      `ToObjDef.IdRef="${FIXTURE_IDS.activity}"`,
      'ToObjDef.IdRef="ObjDef.MISSINGMISS-p-L"'
    )
    const report = validateDerivedAml(broken, options())
    const failed = report.checks.filter((entry) => !entry.passed).map((entry) => entry.check)
    // A missing target is both an unresolved reference and a missing endpoint; both checks are
    // expected to report it.
    expect(failed).toEqual(['definition-references-resolve', 'connection-endpoints-exist'])
  })
})

describe('9.3 — linked models resolve or are explicitly marked missing', () => {
  const broken = SAMPLE_AML.replace(
    `LinkedModels.IdRefs="${FIXTURE_IDS.model}"`,
    `LinkedModels.IdRefs="${FIXTURE_IDS.linkedModel}"`
  )

  it('fails when a linked model neither resolves nor is marked missing', () => {
    expectOnlyFailure(broken, 'linked-models-resolve')
  })

  it('passes when the same unresolved link is explicitly marked missing', () => {
    const report = validateDerivedAml(
      broken,
      options({ knownMissingLinkedModelIds: [FIXTURE_IDS.linkedModel] })
    )
    expect(report.ok).toBe(true)
  })
})

describe('9.3 — attachment references resolve', () => {
  it('fails when an OLE occurrence points at a missing attachment definition', () => {
    expectOnlyFailure(
      SAMPLE_AML.replace(
        `OLEDef.IdRef="${FIXTURE_IDS.attachment}"`,
        'OLEDef.IdRef="OLEDef.MISSINGMISS-r-L"'
      ),
      'attachment-references-resolve'
    )
  })
})

describe('9.3 — source accounting is complete', () => {
  it('fails when an original record disappeared without being recorded as removed', () => {
    const source = readWriterSourceView(SAMPLE_AML)
    const lane = source.byId.get(FIXTURE_IDS.lane)!
    const withoutLane = SAMPLE_AML.replace(SAMPLE_AML.slice(lane.span.start, lane.span.end), '')
    expectOnlyFailure(withoutLane, 'source-accounting-complete')
  })

  it('passes when the same removal is recorded', () => {
    const source = readWriterSourceView(SAMPLE_AML)
    const lane = source.byId.get(FIXTURE_IDS.lane)!
    const withoutLane = SAMPLE_AML.replace(SAMPLE_AML.slice(lane.span.start, lane.span.end), '')
    const report = validateDerivedAml(
      withoutLane,
      options({ accounting: { originalIds: ORIGINAL_IDS, removedIds: [FIXTURE_IDS.lane] } })
    )
    expect(report.ok).toBe(true)
  })

  it('fails when a new record appeared without being recorded as added', () => {
    const added = SAMPLE_AML.replace(
      '\t\t\t</Model>',
      '\t\t\t\t<Lane Lane.ID="Lane.AAAAAAAAAAA-u-L-XXXXXXXXXXX-E-L-40-c"/>\n\t\t\t</Model>'
    )
    expectOnlyFailure(added, 'source-accounting-complete')
  })

  it('fails when a record recorded as removed is still present', () => {
    expectOnlyFailure(
      SAMPLE_AML,
      'source-accounting-complete',
      options({ accounting: { originalIds: ORIGINAL_IDS, removedIds: [FIXTURE_IDS.lane] } })
    )
  })
})

describe('9.3 — no unsafe external entity or executable content was introduced', () => {
  it('fails when an external DOCTYPE identifier is introduced', () => {
    expectOnlyFailure(
      SAMPLE_AML.replace('ARIS-Export.dtd', 'http://attacker.example/evil.dtd'),
      'no-unsafe-content'
    )
  })

  it('fails when an external entity declaration is introduced', () => {
    const attacked = SAMPLE_AML.replace(
      '\t<!ENTITY LocaleId.AEar "14337">',
      '\t<!ENTITY LocaleId.AEar "14337">\n\t<!ENTITY xxe SYSTEM "file:///etc/passwd">'
    )
    expectOnlyFailure(attacked, 'no-unsafe-content')
  })

  it('fails when an internal entity is made to expand to markup', () => {
    expectOnlyFailure(
      SAMPLE_AML.replace('<!ENTITY Codepage.AEar "1256">', '<!ENTITY Codepage.AEar "<Evil/>">'),
      'no-unsafe-content'
    )
  })

  it('fails when a script element is introduced', () => {
    expectOnlyFailure(
      SAMPLE_AML.replace('<Flag/>', '<Flag/>\n\t\t\t\t<script>alert(1)</script>'),
      'no-unsafe-content'
    )
  })

  it('fails when an attribute carries an executable URL scheme', () => {
    expectOnlyFailure(
      SAMPLE_AML.replace(
        'Creator="fixture"\n>\n\t\t\t<GUID>',
        'Creator="javascript:alert(1)"\n>\n\t\t\t<GUID>'
      ),
      'no-unsafe-content'
    )
  })

  it('fails when an event-handler attribute is introduced', () => {
    expectOnlyFailure(
      SAMPLE_AML.replace('<Flag/>', '<Flag onload="alert(1)"/>'),
      'no-unsafe-content'
    )
  })

  it('accepts the original DOCTYPE that the source itself declared', () => {
    expect(validateDerivedAml(SAMPLE_AML, options()).ok).toBe(true)
  })
})

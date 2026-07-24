import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StepDetailsDialog, type StepDetailsValues } from '../StepDetailsDialog'
import type { OwnerEntry } from '../../owner/ownersIndex'
import { t } from '../../i18n'

const noop = (): void => {}
const entries: OwnerEntry[] = [{ name: 'Operations', type: 'department', count: 3 }]

const baseInitial: StepDetailsValues = {
  owner: '',
  ownerType: '',
  ownerRole: '',
  note: '',
  channel: '',
  channelDetail: '',
  cc: false,
  ccTo: '',
  trigger: '',
  triggerService: '',
  triggerDetail: '',
  nameEn: '',
  nameAr: '',
  inputs: '',
  outputs: '',
  system: '',
  respList: '',
  ccList: '',
  decisionBasis: ''
}

function render(props: Partial<Parameters<typeof StepDetailsDialog>[0]>): string {
  return renderToStaticMarkup(
    <StepDetailsDialog
      mode="element"
      initial={baseInitial}
      ownerEntries={entries}
      onApply={noop}
      onCancel={noop}
      {...props}
    />
  )
}

describe('StepDetailsDialog (static render)', () => {
  it('always renders the Owner and Note sections', () => {
    const html = render({ mode: 'element', elementType: 'bpmn:Task' })
    expect(html).toContain(t('org.section.owner'))
    expect(html).toContain(t('org.section.note'))
  })

  it('element mode with a task type shows the CC and Channel sections', () => {
    const html = render({ mode: 'element', elementType: 'bpmn:Task' })
    expect(html).toContain(t('org.section.channel'))
    expect(html).toContain(t('org.section.cc'))
    // A plain task is neither a start event nor process → no Trigger section.
    expect(html).not.toContain(t('org.section.trigger'))
  })

  it('start-event element mode shows the Trigger section but not Channel/CC', () => {
    const html = render({ mode: 'element', elementType: 'bpmn:StartEvent' })
    expect(html).toContain(t('org.section.trigger'))
    expect(html).not.toContain(t('org.section.channel'))
    expect(html).not.toContain(t('org.section.cc'))
  })

  it('process mode hides Channel and CC but shows the Trigger section', () => {
    const html = render({ mode: 'process', elementType: undefined })
    expect(html).toContain(t('org.section.trigger'))
    expect(html).not.toContain(t('org.section.channel'))
    expect(html).not.toContain(t('org.section.cc'))
  })

  it('disables Apply when a dmthub trigger has no service name', () => {
    const html = render({
      mode: 'process',
      initial: { ...baseInitial, trigger: 'dmthub', triggerService: '' }
    })
    // The only disabled control in process mode is the Apply button; the inline
    // "service required" error is also present.
    expect(html).toContain('disabled')
    expect(html).toContain(t('org.trigger.serviceRequired'))
  })

  it('enables Apply once the dmthub trigger has a service name', () => {
    const html = render({
      mode: 'process',
      initial: { ...baseInitial, trigger: 'dmthub', triggerService: 'ClaimsHub' }
    })
    expect(html).not.toContain('disabled')
    expect(html).not.toContain(t('org.trigger.serviceRequired'))
  })

  it('renders the Export owners button only when the callback is provided', () => {
    expect(render({ elementType: 'bpmn:Task' })).not.toContain(t('org.export.owners'))
    expect(render({ elementType: 'bpmn:Task', onExportOwners: noop })).toContain(
      t('org.export.owners')
    )
  })

  it('always renders the bilingual name fields (element AND process mode)', () => {
    for (const html of [
      render({ mode: 'element', elementType: 'bpmn:Task' }),
      render({ mode: 'process', elementType: undefined })
    ]) {
      expect(html).toContain(t('org.nameEn.label'))
      expect(html).toContain(t('org.nameAr.label'))
    }
  })

  it('element mode shows the step-data fields for every element type', () => {
    for (const elementType of ['bpmn:Task', 'bpmn:ExclusiveGateway', 'bpmn:StartEvent']) {
      const html = render({ mode: 'element', elementType })
      expect(html).toContain(t('org.inputs.label'))
      expect(html).toContain(t('org.outputs.label'))
      expect(html).toContain(t('org.system.label'))
      expect(html).toContain(t('org.ccList.label'))
      expect(html).toContain(t('org.respList.label'))
    }
  })

  it('process mode shows names but hides the step-data fields', () => {
    const html = render({ mode: 'process', elementType: undefined })
    expect(html).not.toContain(t('org.inputs.label'))
    expect(html).not.toContain(t('org.outputs.label'))
    expect(html).not.toContain(t('org.ccList.label'))
    expect(html).not.toContain(t('org.respList.label'))
    expect(html).not.toContain(t('org.decisionBasis.label'))
  })

  it('shows decision basis ONLY for gateways and business-rule tasks', () => {
    for (const elementType of [
      'bpmn:ExclusiveGateway',
      'bpmn:InclusiveGateway',
      'bpmn:ParallelGateway',
      'bpmn:EventBasedGateway',
      'bpmn:ComplexGateway',
      'bpmn:BusinessRuleTask'
    ]) {
      expect(render({ mode: 'element', elementType })).toContain(t('org.decisionBasis.label'))
    }
    for (const elementType of ['bpmn:Task', 'bpmn:UserTask', 'bpmn:StartEvent']) {
      expect(render({ mode: 'element', elementType })).not.toContain(t('org.decisionBasis.label'))
    }
  })

  it('textareas hold the \\n-joined list values verbatim', () => {
    const html = render({
      mode: 'element',
      elementType: 'bpmn:Task',
      initial: {
        ...baseInitial,
        inputs: 'Form A\nCustomer file',
        ccList: 'Legal\nFinance',
        respList: 'Sara — Approver',
        nameEn: 'Review request',
        nameAr: 'مراجعة الطلب'
      }
    })
    expect(html).toContain('Form A\nCustomer file')
    expect(html).toContain('Legal\nFinance')
    expect(html).toContain('Sara — Approver')
    expect(html).toContain('Review request')
    expect(html).toContain('مراجعة الطلب')
  })

  it('passes the browse/empty labels through to the owner picker', () => {
    const html = render({ mode: 'element', elementType: 'bpmn:Task' })
    expect(html).toContain(t('owner.browse.aria'))
  })
})

describe('StepDetailsDialog highlightFields', () => {
  it('renders the amber hint for highlighted, visible categories', () => {
    const html = render({
      mode: 'element',
      elementType: 'bpmn:Task',
      highlightFields: ['owner', 'inputs', 'outputs']
    })
    expect(html).toContain(t('missing.highlight.hint'))
    // One hint per highlighted block: owner section + inputs + outputs.
    expect(html.split(t('missing.highlight.hint'))).toHaveLength(4)
  })

  it('renders no hint without highlightFields (or with an empty list)', () => {
    expect(render({ mode: 'element', elementType: 'bpmn:Task' })).not.toContain(
      t('missing.highlight.hint')
    )
    expect(
      render({ mode: 'element', elementType: 'bpmn:Task', highlightFields: [] })
    ).not.toContain(t('missing.highlight.hint'))
  })

  it('ignores highlights whose section is hidden for the current type', () => {
    // A plain task renders neither the trigger section nor the basis textarea.
    const html = render({
      mode: 'element',
      elementType: 'bpmn:Task',
      highlightFields: ['trigger', 'basis']
    })
    expect(html).not.toContain(t('missing.highlight.hint'))
  })

  it("highlights the decision-basis textarea on gateways ('basis' category)", () => {
    const html = render({
      mode: 'element',
      elementType: 'bpmn:ExclusiveGateway',
      highlightFields: ['basis']
    })
    expect(html).toContain(t('missing.highlight.hint'))
  })

  it('highlights the trigger control in process mode and on start events', () => {
    expect(render({ mode: 'process', highlightFields: ['trigger'] })).toContain(
      t('missing.highlight.hint')
    )
    expect(
      render({ mode: 'element', elementType: 'bpmn:StartEvent', highlightFields: ['trigger'] })
    ).toContain(t('missing.highlight.hint'))
  })

  it('unknown categories are ignored', () => {
    expect(
      render({ mode: 'element', elementType: 'bpmn:Task', highlightFields: ['bogus'] })
    ).not.toContain(t('missing.highlight.hint'))
  })
})

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
  triggerDetail: ''
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
})

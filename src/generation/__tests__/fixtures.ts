import type { BpmnElement } from '../ir/schema'

export function bilingualLinearIr(): BpmnElement[] {
  return [
    {
      type: 'startEvent',
      id: 'Start',
      label: 'Start',
      labelEn: 'Start',
      labelAr: 'بداية'
    },
    {
      type: 'userTask',
      id: 'Review',
      label: 'Review request',
      labelEn: 'Review request',
      labelAr: 'مراجعة الطلب'
    },
    {
      type: 'endEvent',
      id: 'End',
      label: 'End',
      labelEn: 'End',
      labelAr: 'نهاية'
    }
  ]
}

export function bilingualGatewayIr(): BpmnElement[] {
  return [
    {
      type: 'startEvent',
      id: 'Start',
      label: 'Start',
      labelEn: 'Start',
      labelAr: 'بداية'
    },
    {
      type: 'exclusiveGateway',
      id: 'Decision',
      label: 'Approved?',
      labelEn: 'Approved?',
      labelAr: 'هل تمت الموافقة؟',
      has_join: true,
      branches: [
        {
          condition: 'Approved',
          conditionEn: 'Approved',
          conditionAr: 'تمت الموافقة',
          path: [
            {
              type: 'userTask',
              id: 'Approve',
              label: 'Approve',
              labelEn: 'Approve',
              labelAr: 'موافقة'
            }
          ]
        },
        {
          is_default: true,
          path: [
            {
              type: 'userTask',
              id: 'Reject',
              label: 'Reject',
              labelEn: 'Reject',
              labelAr: 'رفض'
            }
          ]
        }
      ]
    },
    {
      type: 'endEvent',
      id: 'End',
      label: 'End',
      labelEn: 'End',
      labelAr: 'نهاية'
    }
  ]
}

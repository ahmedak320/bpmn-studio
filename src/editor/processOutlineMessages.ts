import type {
  ProcessOutlineError,
  ProcessOutlineIssue,
  ProcessOutlineItem,
  ProcessOutlineNodeType
} from './processOutline'

export interface ProcessOutlineMessages {
  title: string
  unavailable: string
  listLabel: string
  empty: string
  nodeKind: string
  flowKind: string
  selected: (id: string) => string
  keyboardHelp: string
  addHeading: string
  nodeTypeLabel: string
  newNodeLabel: string
  connectFromLabel: string
  noAutomaticConnection: string
  addNode: string
  connectHeading: string
  sourceLabel: string
  targetLabel: string
  itemNameLabel: string
  flowLabel: string
  conditionLabel: string
  conditionHint: string
  defaultFlowLabel: string
  connectNodes: string
  detailsHeading: string
  noSelection: string
  editItem: string
  saveChanges: string
  cancel: string
  documentationLabel: string
  calledElementLabel: string
  moveUp: string
  moveDown: string
  deleteItem: string
  deleteConfirmation: (item: ProcessOutlineItem) => string
  validationHeading: string
  validationEmpty: string
  formatNumber: (value: number) => string
  validationSummary: (errors: number, warnings: number) => string
  addedStatus: (id: string) => string
  updatedStatus: (id: string) => string
  connectedStatus: (id: string) => string
  movedStatus: (id: string) => string
  deletedStatus: (id: string) => string
  nodeType: (type: string) => string
  itemLabel: (item: ProcessOutlineItem) => string
  issue: (issue: ProcessOutlineIssue) => string
  error: (error: ProcessOutlineError) => string
}

const EN_NODE_TYPES: Readonly<Record<ProcessOutlineNodeType, string>> = {
  'bpmn:StartEvent': 'Start event',
  'bpmn:IntermediateCatchEvent': 'Intermediate catch event',
  'bpmn:IntermediateThrowEvent': 'Intermediate throw event',
  'bpmn:EndEvent': 'End event',
  'bpmn:Task': 'Task',
  'bpmn:UserTask': 'User task',
  'bpmn:ServiceTask': 'Service task',
  'bpmn:ManualTask': 'Manual task',
  'bpmn:SendTask': 'Send task',
  'bpmn:ReceiveTask': 'Receive task',
  'bpmn:BusinessRuleTask': 'Business-rule task',
  'bpmn:ScriptTask': 'Script task',
  'bpmn:CallActivity': 'Call activity',
  'bpmn:SubProcess': 'Sub-process',
  'bpmn:ExclusiveGateway': 'Exclusive gateway',
  'bpmn:InclusiveGateway': 'Inclusive gateway',
  'bpmn:ParallelGateway': 'Parallel gateway'
}

const AR_NODE_TYPES: Readonly<Record<ProcessOutlineNodeType, string>> = {
  'bpmn:StartEvent': 'حدث بداية',
  'bpmn:IntermediateCatchEvent': 'حدث التقاط وسيط',
  'bpmn:IntermediateThrowEvent': 'حدث إرسال وسيط',
  'bpmn:EndEvent': 'حدث نهاية',
  'bpmn:Task': 'مهمة',
  'bpmn:UserTask': 'مهمة مستخدم',
  'bpmn:ServiceTask': 'مهمة خدمة',
  'bpmn:ManualTask': 'مهمة يدوية',
  'bpmn:SendTask': 'مهمة إرسال',
  'bpmn:ReceiveTask': 'مهمة استلام',
  'bpmn:BusinessRuleTask': 'مهمة قاعدة أعمال',
  'bpmn:ScriptTask': 'مهمة برنامج نصي',
  'bpmn:CallActivity': 'نشاط استدعاء',
  'bpmn:SubProcess': 'عملية فرعية',
  'bpmn:ExclusiveGateway': 'بوابة حصرية',
  'bpmn:InclusiveGateway': 'بوابة شاملة',
  'bpmn:ParallelGateway': 'بوابة متوازية'
}

function fallbackType(type: string): string {
  return type.replace(/^bpmn:/, '').replace(/([a-z])([A-Z])/g, '$1 $2')
}

function itemName(item: ProcessOutlineItem): string {
  return item.name || item.id
}

const EN_NUMBER_FORMATTER = new Intl.NumberFormat('en')
const AR_NUMBER_FORMATTER = new Intl.NumberFormat('ar-AE-u-nu-arab')

function englishIssue(issue: ProcessOutlineIssue): string {
  switch (issue.code) {
    case 'outline.empty':
      return 'The process has no navigable flow nodes.'
    case 'outline.duplicate-id':
      return `The identifier ${issue.itemId ?? ''} is duplicated.`
    case 'outline.flow-endpoint-missing':
      return `Flow ${issue.itemId ?? ''} has a missing source or target.`
    case 'outline.flow-self-reference':
      return `Flow ${issue.itemId ?? ''} connects a node to itself.`
    case 'outline.flow-duplicate':
      return 'More than one sequence flow connects the same source and target.'
    case 'outline.start-has-incoming':
      return `Start event ${issue.itemId ?? ''} has an incoming sequence flow.`
    case 'outline.end-has-outgoing':
      return `End event ${issue.itemId ?? ''} has an outgoing sequence flow.`
    case 'outline.default-has-condition':
      return `Default flow ${issue.itemId ?? ''} must not have a condition.`
    case 'outline.gateway-condition-missing':
      return `Gateway flow ${issue.itemId ?? ''} needs a condition or must be the default.`
    case 'outline.gateway-default-multiple':
      return `Gateway ${issue.itemId ?? ''} has more than one default flow.`
    case 'outline.node-disconnected':
      return `Node ${issue.itemId ?? ''} is disconnected.`
  }
}

function arabicIssue(issue: ProcessOutlineIssue): string {
  switch (issue.code) {
    case 'outline.empty':
      return 'لا تحتوي العملية على عقد تدفق قابلة للتنقل.'
    case 'outline.duplicate-id':
      return `المعرّف ${issue.itemId ?? ''} مكرر.`
    case 'outline.flow-endpoint-missing':
      return `التدفق ${issue.itemId ?? ''} يفتقد المصدر أو الهدف.`
    case 'outline.flow-self-reference':
      return `التدفق ${issue.itemId ?? ''} يربط العقدة بنفسها.`
    case 'outline.flow-duplicate':
      return 'يوجد أكثر من تدفق تسلسلي بين المصدر والهدف نفسيهما.'
    case 'outline.start-has-incoming':
      return `حدث البداية ${issue.itemId ?? ''} لديه تدفق تسلسلي وارد.`
    case 'outline.end-has-outgoing':
      return `حدث النهاية ${issue.itemId ?? ''} لديه تدفق تسلسلي صادر.`
    case 'outline.default-has-condition':
      return `يجب ألا يحتوي التدفق الافتراضي ${issue.itemId ?? ''} على شرط.`
    case 'outline.gateway-condition-missing':
      return `يحتاج تدفق البوابة ${issue.itemId ?? ''} إلى شرط أو يجب تعيينه افتراضياً.`
    case 'outline.gateway-default-multiple':
      return `للبوابة ${issue.itemId ?? ''} أكثر من تدفق افتراضي.`
    case 'outline.node-disconnected':
      return `العقدة ${issue.itemId ?? ''} غير متصلة.`
  }
}

function englishError(error: ProcessOutlineError): string {
  switch (error.code) {
    case 'item-not-found':
    case 'node-not-found':
    case 'flow-not-found':
      return 'The selected outline item is no longer present in the diagram.'
    case 'unsupported-node-type':
      return 'That node type cannot be added from the outline.'
    case 'flow-edit-not-supported':
      return 'Only the label can be edited for this connection type.'
    case 'invalid-connection':
      return 'Choose two different source and target nodes.'
    case 'default-flow-has-condition':
      return 'A default flow cannot also have a condition.'
    case 'default-flow-source-invalid':
      return 'Default flows can be set only from exclusive or inclusive gateways.'
    case 'connection-rejected':
      return 'BPMN rules rejected this connection.'
    case 'reorder-not-linear':
      return 'Only adjacent, unconditional steps in a single linear path can be reordered.'
    case 'service-unavailable':
      return 'The diagram editor is not ready for that outline command.'
  }
}

function arabicError(error: ProcessOutlineError): string {
  switch (error.code) {
    case 'item-not-found':
    case 'node-not-found':
    case 'flow-not-found':
      return 'عنصر المخطط التفصيلي المحدد لم يعد موجوداً في الرسم.'
    case 'unsupported-node-type':
      return 'لا يمكن إضافة هذا النوع من العقد من المخطط التفصيلي.'
    case 'flow-edit-not-supported':
      return 'يمكن تحرير التسمية فقط لهذا النوع من الاتصالات.'
    case 'invalid-connection':
      return 'اختر عقدتي مصدر وهدف مختلفتين.'
    case 'default-flow-has-condition':
      return 'لا يمكن أن يحتوي التدفق الافتراضي على شرط أيضاً.'
    case 'default-flow-source-invalid':
      return 'يمكن تعيين التدفقات الافتراضية من البوابات الحصرية أو الشاملة فقط.'
    case 'connection-rejected':
      return 'رفضت قواعد BPMN هذا الاتصال.'
    case 'reorder-not-linear':
      return 'يمكن إعادة ترتيب الخطوات المتجاورة غير المشروطة في مسار خطي واحد فقط.'
    case 'service-unavailable':
      return 'محرر الرسم غير جاهز لتنفيذ أمر المخطط التفصيلي.'
  }
}

export const EN_PROCESS_OUTLINE_MESSAGES: ProcessOutlineMessages = {
  title: 'Process outline',
  unavailable: 'Open a BPMN diagram to use the process outline.',
  listLabel: 'Process nodes and flows',
  empty: 'No process nodes are available.',
  nodeKind: 'Node',
  flowKind: 'Flow',
  selected: (id) => `${id} selected on the canvas.`,
  keyboardHelp:
    'Use Arrow keys, Home, and End to navigate. Enter selects on the canvas. F2 edits. Delete removes after confirmation. Control plus Arrow reorders a linear step.',
  addHeading: 'Add node',
  nodeTypeLabel: 'Node type',
  newNodeLabel: 'Node label',
  connectFromLabel: 'Connect after',
  noAutomaticConnection: 'Do not connect automatically',
  addNode: 'Add node',
  connectHeading: 'Connect nodes',
  sourceLabel: 'Source node',
  targetLabel: 'Target node',
  itemNameLabel: 'Name or label',
  flowLabel: 'Flow label',
  conditionLabel: 'Condition',
  conditionHint: 'Required for non-default branches from exclusive and inclusive gateways.',
  defaultFlowLabel: 'Set as the source node’s default flow',
  connectNodes: 'Connect nodes',
  detailsHeading: 'Selected item',
  noSelection: 'Select a node or flow in the outline.',
  editItem: 'Edit selected item',
  saveChanges: 'Save changes',
  cancel: 'Cancel',
  documentationLabel: 'Documentation',
  calledElementLabel: 'Called process ID',
  moveUp: 'Move earlier',
  moveDown: 'Move later',
  deleteItem: 'Delete selected item',
  deleteConfirmation: (item) => `Delete ${itemName(item)}? This can be undone from the canvas.`,
  validationHeading: 'Outline validation',
  validationEmpty: 'No outline validation findings.',
  formatNumber: (value) => EN_NUMBER_FORMATTER.format(value),
  validationSummary: (errors, warnings) =>
    `${EN_PROCESS_OUTLINE_MESSAGES.formatNumber(errors)} errors, ${EN_PROCESS_OUTLINE_MESSAGES.formatNumber(warnings)} warnings`,
  addedStatus: (id) => `${id} added.`,
  updatedStatus: (id) => `${id} updated.`,
  connectedStatus: (id) => `${id} connected.`,
  movedStatus: (id) => `${id} reordered.`,
  deletedStatus: (id) => `${id} deleted.`,
  nodeType: (type) => EN_NODE_TYPES[type as ProcessOutlineNodeType] ?? fallbackType(type),
  itemLabel: (item) =>
    item.kind === 'node'
      ? `${EN_PROCESS_OUTLINE_MESSAGES.nodeType(item.type)}: ${itemName(item)}`
      : `Flow ${itemName(item)} from ${item.sourceId} to ${item.targetId}`,
  issue: englishIssue,
  error: englishError
}

export const AR_PROCESS_OUTLINE_MESSAGES: ProcessOutlineMessages = {
  title: 'المخطط التفصيلي للعملية',
  unavailable: 'افتح رسم BPMN لاستخدام المخطط التفصيلي للعملية.',
  listLabel: 'عقد العملية وتدفقاتها',
  empty: 'لا توجد عقد عملية متاحة.',
  nodeKind: 'عقدة',
  flowKind: 'تدفق',
  selected: (id) => `تم تحديد ${id} على لوحة الرسم.`,
  keyboardHelp:
    'استخدم مفاتيح الأسهم وHome وEnd للتنقل. يحدد Enter العنصر على اللوحة، ويبدأ F2 التحرير، ويحذف Delete بعد التأكيد، ويعيد Control مع سهم ترتيب خطوة خطية.',
  addHeading: 'إضافة عقدة',
  nodeTypeLabel: 'نوع العقدة',
  newNodeLabel: 'تسمية العقدة',
  connectFromLabel: 'الاتصال بعد',
  noAutomaticConnection: 'عدم الاتصال تلقائياً',
  addNode: 'إضافة عقدة',
  connectHeading: 'ربط العقد',
  sourceLabel: 'عقدة المصدر',
  targetLabel: 'عقدة الهدف',
  itemNameLabel: 'الاسم أو التسمية',
  flowLabel: 'تسمية التدفق',
  conditionLabel: 'الشرط',
  conditionHint: 'مطلوب للفروع غير الافتراضية من البوابات الحصرية والشاملة.',
  defaultFlowLabel: 'تعيين كتدفق افتراضي لعقدة المصدر',
  connectNodes: 'ربط العقد',
  detailsHeading: 'العنصر المحدد',
  noSelection: 'حدد عقدة أو تدفقاً في المخطط التفصيلي.',
  editItem: 'تحرير العنصر المحدد',
  saveChanges: 'حفظ التغييرات',
  cancel: 'إلغاء',
  documentationLabel: 'التوثيق',
  calledElementLabel: 'معرّف العملية المستدعاة',
  moveUp: 'نقل إلى موضع أسبق',
  moveDown: 'نقل إلى موضع لاحق',
  deleteItem: 'حذف العنصر المحدد',
  deleteConfirmation: (item) => `حذف ${itemName(item)}؟ يمكن التراجع عن ذلك من لوحة الرسم.`,
  validationHeading: 'التحقق من المخطط التفصيلي',
  validationEmpty: 'لا توجد ملاحظات تحقق في المخطط التفصيلي.',
  formatNumber: (value) => AR_NUMBER_FORMATTER.format(value),
  validationSummary: (errors, warnings) =>
    `${AR_PROCESS_OUTLINE_MESSAGES.formatNumber(errors)} أخطاء، ${AR_PROCESS_OUTLINE_MESSAGES.formatNumber(warnings)} تحذيرات`,
  addedStatus: (id) => `تمت إضافة ${id}.`,
  updatedStatus: (id) => `تم تحديث ${id}.`,
  connectedStatus: (id) => `تم ربط ${id}.`,
  movedStatus: (id) => `تمت إعادة ترتيب ${id}.`,
  deletedStatus: (id) => `تم حذف ${id}.`,
  nodeType: (type) => AR_NODE_TYPES[type as ProcessOutlineNodeType] ?? fallbackType(type),
  itemLabel: (item) =>
    item.kind === 'node'
      ? `${AR_PROCESS_OUTLINE_MESSAGES.nodeType(item.type)}: ${itemName(item)}`
      : `التدفق ${itemName(item)} من ${item.sourceId} إلى ${item.targetId}`,
  issue: arabicIssue,
  error: arabicError
}

export function processOutlineMessages(language: 'en' | 'ar'): ProcessOutlineMessages {
  return language === 'ar' ? AR_PROCESS_OUTLINE_MESSAGES : EN_PROCESS_OUTLINE_MESSAGES
}

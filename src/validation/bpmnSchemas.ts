import bpmn20Schema from 'bpmn-moddle/resources/bpmn/xsd/BPMN20.xsd?raw'
import bpmnDiSchema from 'bpmn-moddle/resources/bpmn/xsd/BPMNDI.xsd?raw'
import dcSchema from 'bpmn-moddle/resources/bpmn/xsd/DC.xsd?raw'
import diSchema from 'bpmn-moddle/resources/bpmn/xsd/DI.xsd?raw'
import semanticSchema from 'bpmn-moddle/resources/bpmn/xsd/Semantic.xsd?raw'

/**
 * The canonical OMG BPMN 2.0 schema graph shipped by the pinned bpmn-moddle
 * release. The file names deliberately match the relative schemaLocation
 * values inside BPMN20.xsd/BPMNDI.xsd so libxml2 never needs the network.
 */
export const BPMN_20_XSD = Object.freeze({
  root: Object.freeze({
    fileName: 'BPMN20.xsd',
    contents: bpmn20Schema
  }),
  dependencies: Object.freeze([
    Object.freeze({ fileName: 'Semantic.xsd', contents: semanticSchema }),
    Object.freeze({ fileName: 'BPMNDI.xsd', contents: bpmnDiSchema }),
    Object.freeze({ fileName: 'DI.xsd', contents: diSchema }),
    Object.freeze({ fileName: 'DC.xsd', contents: dcSchema })
  ])
})

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { validateXML } from 'xmllint-wasm'

const validBpmn = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="Definitions_release_gate"
  targetNamespace="https://orbitpm.ae/bpmn/release-gate">
  <bpmn:process id="Process_release_gate" name="Release gate" isExecutable="false">
    <bpmn:startEvent id="Start_release_gate" name="Start">
      <bpmn:outgoing>Flow_start_task</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_release_gate" name="Review">
      <bpmn:incoming>Flow_start_task</bpmn:incoming>
      <bpmn:outgoing>Flow_task_end</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="End_release_gate" name="End">
      <bpmn:incoming>Flow_task_end</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_start_task" sourceRef="Start_release_gate" targetRef="Task_release_gate"/>
    <bpmn:sequenceFlow id="Flow_task_end" sourceRef="Task_release_gate" targetRef="End_release_gate"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_release_gate">
    <bpmndi:BPMNPlane id="Plane_release_gate" bpmnElement="Process_release_gate">
      <bpmndi:BPMNShape id="Shape_start" bpmnElement="Start_release_gate">
        <dc:Bounds x="120" y="120" width="36" height="36"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Shape_task" bpmnElement="Task_release_gate">
        <dc:Bounds x="220" y="98" width="100" height="80"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Shape_end" bpmnElement="End_release_gate">
        <dc:Bounds x="390" y="120" width="36" height="36"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Edge_start_task" bpmnElement="Flow_start_task">
        <di:waypoint x="156" y="138"/>
        <di:waypoint x="220" y="138"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Edge_task_end" bpmnElement="Flow_task_end">
        <di:waypoint x="320" y="138"/>
        <di:waypoint x="390" y="138"/>
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`

const invalidXsd = validBpmn.replace('  targetNamespace="https://orbitpm.ae/bpmn/release-gate"', '')
const invalidLint = validBpmn
  .replace(/ {4}<bpmn:endEvent[\s\S]*?<\/bpmn:endEvent>\n/, '')
  .replace(/ {4}<bpmn:sequenceFlow id="Flow_task_end"[\s\S]*?\/>\n/, '')
  .replace(/ {6}<bpmndi:BPMNShape id="Shape_end"[\s\S]*?<\/bpmndi:BPMNShape>\n/, '')
  .replace(/ {6}<bpmndi:BPMNEdge id="Edge_task_end"[\s\S]*?<\/bpmndi:BPMNEdge>\n/, '')
  .replace('      <bpmn:outgoing>Flow_task_end</bpmn:outgoing>\n', '')

const schemaDirectory = resolve('node_modules/bpmn-moddle/resources/bpmn/xsd')
const schemaNames = ['BPMN20.xsd', 'BPMNDI.xsd', 'DC.xsd', 'DI.xsd', 'Semantic.xsd']
const schemas = schemaNames.map((fileName) => ({
  fileName,
  contents: readFileSync(resolve(schemaDirectory, fileName), 'utf8')
}))

const validXsdResult = await validateXML({
  xml: [{ fileName: 'valid.bpmn', contents: validBpmn }],
  schema: [schemas[0]],
  preload: schemas.slice(1)
})
if (!validXsdResult.valid) {
  console.error(validXsdResult.rawOutput)
  throw new Error('Known-valid BPMN fixture failed the official BPMN 2.0 XSD set')
}

const invalidXsdResult = await validateXML({
  xml: [{ fileName: 'invalid-xsd.bpmn', contents: invalidXsd }],
  schema: [schemas[0]],
  preload: schemas.slice(1)
})
if (invalidXsdResult.valid) {
  throw new Error('Known-invalid BPMN fixture unexpectedly passed the BPMN 2.0 XSD set')
}

const temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'orbitpm-bpmnlint-'))
try {
  const validPath = resolve(temporaryDirectory, 'valid.bpmn')
  const invalidPath = resolve(temporaryDirectory, 'invalid-lint.bpmn')
  const config = resolve(temporaryDirectory, '.bpmnlintrc')
  const require = createRequire(import.meta.url)
  const recommended = require(resolve('node_modules/bpmnlint/config/recommended.js'))
  writeFileSync(validPath, validBpmn)
  writeFileSync(invalidPath, invalidLint)
  writeFileSync(config, JSON.stringify(recommended))

  const executable = resolve('node_modules/.bin/bpmnlint')
  const validLint = spawnSync(executable, ['--config', config, '--max-warnings=0', validPath], {
    encoding: 'utf8'
  })
  if (validLint.status !== 0) {
    console.error(validLint.stdout)
    console.error(validLint.stderr)
    throw new Error('Known-valid BPMN fixture failed bpmnlint recommended rules')
  }

  const invalidLintResult = spawnSync(
    executable,
    ['--config', config, '--max-warnings=0', invalidPath],
    { encoding: 'utf8' }
  )
  if (invalidLintResult.status === 0) {
    throw new Error('Known-invalid BPMN fixture unexpectedly passed bpmnlint')
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true })
}

console.log(
  'BPMN fixture gate passed: official XSD accepts valid/rejects invalid, and bpmnlint accepts valid/rejects invalid.'
)

/**
 * Golden parity: the TS emitter's output must equal the vendored Python
 * (ElementTree) output for every fixture EXCEPT the dedup demonstrator (which is
 * a documented, sanctioned divergence — see dedup.test.ts). Goldens are produced
 * by running the real vendored transformer + xml generator (scratchpad/gen_goldens.py).
 */
import { describe, it, expect } from 'vitest'
import { generateBpmnXml } from '../../src/gen/xml'
import { loadIr, loadGolden, canonicalXml } from './helpers'

const PARITY_FIXTURES = [
  'ex1_professor',
  'ex2_parallel',
  'ex3_exam_loop',
  'ex4_nested_exclusive',
  'ex5_task_types',
  'ex6_events',
  'ex7_order_two_ends',
  'inclusive_default',
  'loopback_next',
  'nasty_labels'
]

describe('golden parity: TS emitter == vendored Python (ElementTree)', () => {
  for (const name of PARITY_FIXTURES) {
    it(`${name} matches the Python golden`, () => {
      const ir = loadIr(name)
      const ts = generateBpmnXml(ir.process)
      expect(canonicalXml(ts)).toBe(canonicalXml(loadGolden(name)))
    })
  }
})

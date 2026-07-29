import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { config, z } from 'zod'

import { configureZodForStrictCsp } from './zodJitless'

const MAIN_TSX = fileURLToPath(new URL('../main.tsx', import.meta.url))

describe('zod runs jitless under the shipped CSP (plan §2.5)', () => {
  it('is configured jitless by importing the module', () => {
    // The import above already ran the side effect; the explicit call proves it
    // is idempotent rather than one-shot.
    configureZodForStrictCsp()
    expect(config().jitless).toBe(true)
  })

  it('still parses and still rejects, because jitless only picks the interpreter', () => {
    const schema = z.object({ name: z.string(), count: z.number().int() })
    expect(schema.parse({ name: 'ok', count: 2 })).toEqual({ name: 'ok', count: 2 })
    const failure = schema.safeParse({ name: 'ok', count: 'two' })
    expect(failure.success).toBe(false)
  })

  it('never asks the host whether it may compile a function', () => {
    // zod's probe is `new Function('')`. With `jitless` set, the probe is
    // short-circuited before it is reached, which is the whole point: the CSP
    // stays exactly as narrow as it is and no violation is reported.
    const originalFunction = globalThis.Function
    let probed = false
    const probe = new Proxy(originalFunction, {
      construct(target, args) {
        probed = true
        return Reflect.construct(target, args as never[])
      }
    })
    Object.defineProperty(globalThis, 'Function', { configurable: true, value: probe })
    try {
      z.object({ a: z.string(), b: z.string() }).parse({ a: '1', b: '2' })
    } finally {
      Object.defineProperty(globalThis, 'Function', {
        configurable: true,
        value: originalFunction
      })
    }
    expect(probed).toBe(false)
  })

  it('is the first import in the application entry point', () => {
    const source = readFileSync(MAIN_TSX, 'utf8')
    const firstImport = source.match(/^import .*$/mu)?.[0]
    expect(firstImport).toBe("import './security/zodJitless'")
  })
})

import { describe, expect, it, vi } from 'vitest'
import { generateFromDescription } from '../generate'
import { deriveGenerationIdentity } from '../xml'
import { bilingualLinearIr } from './fixtures'

describe('end-to-end generation validation', () => {
  it('returns normalized pre/post-layout evidence', async () => {
    const call = vi.fn(async () => ({ process: bilingualLinearIr() }))
    const result = await generateFromDescription(call, 'Review a request', undefined, {
      identity: { processId: 'Process_review_request' }
    })
    expect(call).toHaveBeenCalledTimes(1)
    expect(result.semanticXml).toContain('<process id="Process_review_request"')
    expect(result.preLayoutValidation.valid).toBe(true)
    expect(result.postLayoutValidation.valid).toBe(true)
    expect(result.postLayoutValidation.stats.diagrams).toBe(1)
  })

  it('feeds generation-validation failures into the repair loop', async () => {
    const invalid = bilingualLinearIr()
    const review = invalid[1]
    if (review.type !== 'userTask') throw new Error('fixture')
    review.labelAr = 'Review request'
    const call = vi
      .fn()
      .mockResolvedValueOnce({ process: invalid })
      .mockResolvedValueOnce({ process: bilingualLinearIr() })

    const result = await generateFromDescription(call, 'Review a request')
    expect(call).toHaveBeenCalledTimes(2)
    const secondMessages = call.mock.calls[1][0] as Array<{ role: string; content: string }>
    expect(secondMessages.at(-1)?.content).toContain('orbitpm.bilingual-wrong-script-ar')
    expect(result.postLayoutValidation.valid).toBe(true)
  })

  it('does not reuse a derived process link target already in the workspace', async () => {
    const description = 'Review a request'
    const base = deriveGenerationIdentity(bilingualLinearIr(), {
      identitySeed: description
    }).processId
    const result = await generateFromDescription(
      async () => ({ process: bilingualLinearIr() }),
      description,
      undefined,
      { processCatalog: [{ id: base, name: 'Existing review' }] }
    )
    expect(result.semanticXml).toContain(`<process id="${base}_2"`)
  })

  it('does not waste model retries on caller-owned identity collisions', async () => {
    const call = vi.fn(async () => ({ process: bilingualLinearIr() }))
    await expect(
      generateFromDescription(call, 'Review a request', undefined, {
        identity: {
          processId: 'Process_existing',
          existingProcessIds: ['Process_existing']
        }
      })
    ).rejects.toMatchObject({ name: 'BpmnGenerationIdentityError' })
    expect(call).toHaveBeenCalledTimes(1)
  })
})

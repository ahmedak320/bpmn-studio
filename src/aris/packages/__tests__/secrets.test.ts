import { describe, expect, it } from 'vitest'
import {
  ArisSecretMaterialError,
  assertNoSecretMaterial,
  containsSecretLikeText,
  findSecretLikeMatches
} from '../secrets'

describe('credential detection', () => {
  it('detects the credential shapes an ARIS package must never contain', () => {
    const cases: Array<[string, string]> = [
      ['anthropic-style-key', 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA'],
      ['openai-style-key', 'sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
      ['aws-access-key-id', 'AKIAIOSFODNN7EXAMPLE'],
      ['github-token', 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
      ['slack-token', 'xoxb-123456789012-abcdefghij'],
      ['google-api-key', 'AIzaSyA-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
      ['json-web-token', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NX0.dBjftJeZ4CVP'],
      ['private-key-block', '-----BEGIN RSA PRIVATE KEY-----'],
      ['bearer-credential', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz'],
      ['credential-assignment', '"api_key": "abcd1234efgh"']
    ]
    for (const [code, text] of cases) {
      const findings = findSecretLikeMatches(text)
      expect(
        findings.map((finding) => finding.code),
        text
      ).toContain(code)
      expect(containsSecretLikeText(text)).toBe(true)
    }
  })

  it('never echoes the matched credential back to the caller', () => {
    const secret = 'sk-ant-api03-SUPERSECRETVALUE123456'
    const findings = findSecretLikeMatches(`token=${secret}`)
    expect(JSON.stringify(findings)).not.toContain('SUPERSECRET')
    try {
      assertNoSecretMaterial('manifest.json', secret)
      throw new Error('expected a rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(ArisSecretMaterialError)
      expect((error as Error).message).not.toContain('SUPERSECRET')
    }
  })

  it('does not flag ordinary package content', () => {
    const benign = [
      '{"sha256":"' + 'a'.repeat(64) + '","accountingSha256":"' + 'b'.repeat(64) + '"}',
      '{"provider":"anthropic","model":"claude-opus-5","requestSha256":"' + 'c'.repeat(64) + '"}',
      '<AML><ObjDef ObjDef.ID="ObjDef.1" TypeNum="OT_FUNC"/></AML>',
      'r000012-0123456789abcdef01234567',
      'attachments/ObjDef.7/plan.pdf'
    ]
    for (const text of benign) {
      expect(findSecretLikeMatches(text), text).toEqual([])
    }
  })

  it('reports findings in document order', () => {
    const findings = findSecretLikeMatches(
      'first AKIAIOSFODNN7EXAMPLE then sk-ant-api03-AAAAAAAAAAAAAAAAAAAA'
    )
    expect(findings.map((finding) => finding.code)).toEqual([
      'aws-access-key-id',
      'anthropic-style-key'
    ])
    expect(findings[0]?.index).toBeLessThan(findings[1]?.index ?? 0)
  })
})

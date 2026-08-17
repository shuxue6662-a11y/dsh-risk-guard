import { describe, expect, it } from 'vitest'
import { digestOf, redactText, redactValue } from '../src/redact.js'

describe('redactText', () => {
  it('masks GitHub tokens', () => {
    expect(redactText('token ghp_1234567890abcdefghijklmnopqrstuvwxyz end')).toContain('gh[REDACTED]')
    expect(redactText('ghp_1234567890abcdefghijklmnopqrstuvwxyz')).not.toMatch(/ghp_[A-Za-z0-9]{20,}/)
  })

  it('masks API keys and bearer tokens', () => {
    expect(redactText('key sk-abcdefghijklmnopqrstuvwxyz123456')).not.toMatch(/sk-[A-Za-z0-9_-]{16,}/)
    expect(redactText('Authorization: Bearer abcDEF123-_~./xyz')).not.toMatch(/Bearer\s+[A-Za-z0-9._~+/-]{8,}/)
  })

  it('masks private key blocks', () => {
    const block = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpA==\n-----END RSA PRIVATE KEY-----'
    expect(redactText(block)).not.toContain('MIIEpA==')
    expect(redactText(block)).toContain('[REDACTED]')
  })

  it('masks password and secret assignments', () => {
    expect(redactText('password=hunter2')).toBe('password=[REDACTED]')
    expect(redactText('"api_key": "abc123"')).toContain('api_key')
    expect(redactText('"api_key": "abc123"')).not.toContain('abc123')
  })

  it('masks .env style lines', () => {
    const env = 'DEEPSEEK_API_KEY=sk-secretvalue123\nPORT=8080'
    const redacted = redactText(env)
    expect(redacted).not.toContain('sk-secretvalue123')
    expect(redacted).toContain('DEEPSEEK_API_KEY=[REDACTED]')
  })

  it('redacts nested values recursively', () => {
    const value = { command: 'curl -H "Authorization: Bearer abcdefgh12345678" https://x', env: ['A=1', 'TOKEN=topsecret'] }
    const redacted = redactValue(value) as Record<string, unknown>
    expect(JSON.stringify(redacted)).not.toContain('topsecret')
    expect(JSON.stringify(redacted)).not.toMatch(/Bearer\s+[A-Za-z0-9._~+/-]{8,}/)
  })
})

describe('digestOf', () => {
  it('is stable for equal values', () => {
    expect(digestOf({ a: 1 })).toBe(digestOf({ a: 1 }))
  })

  it('does not leak the secret: digests of different secrets are equal after redaction', () => {
    expect(digestOf({ key: 'sk-abcdefghijklmnopqrstuvwxyz123456' }))
      .toBe(digestOf({ key: 'sk-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz999999' }))
  })
})

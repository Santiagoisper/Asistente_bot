process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test?sslmode=disable'
process.env.ORG_LLM_KEYS_ENCRYPTION_SECRET =
  process.env.ORG_LLM_KEYS_ENCRYPTION_SECRET ?? 'test-secret-for-vitest-only'

import { describe, expect, it } from 'vitest'
import { encryptJson, decryptJson } from '../org-llm-crypto'
import {
  buildOrgLlmKeyStatuses,
  maskApiKey,
  resolveLlmApiKey,
} from '../org-llm-keys'

describe('org-llm-crypto', () => {
  it('roundtrips encrypted JSON', () => {
    const payload = { openai: 'sk-test-key-12345678', groq: 'gsk_test1234567890' }
    const encrypted = encryptJson(payload)
    expect(encrypted).not.toContain('sk-test')
    expect(decryptJson<typeof payload>(encrypted)).toEqual(payload)
  })
})

describe('org-llm-keys helpers', () => {
  it('masks api keys', () => {
    expect(maskApiKey('sk-abcdefghijklmnop')).toMatch(/^••••/)
    expect(maskApiKey('short')).toBe('••••••••')
  })

  it('resolves org key before env', () => {
    const prev = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'sk-env-key-12345678'
    expect(resolveLlmApiKey('openai', { openai: 'sk-org-key-12345678' })).toBe('sk-org-key-12345678')
    expect(resolveLlmApiKey('openai', {})).toBe('sk-env-key-12345678')
    process.env.OPENAI_API_KEY = prev
  })

  it('builds key statuses with source', () => {
    const statuses = buildOrgLlmKeyStatuses({ openai: 'sk-org-key-12345678' })
    const openai = statuses.find((s) => s.provider === 'openai')
    expect(openai?.source).toBe('org')
    expect(openai?.configured).toBe(true)
    expect(openai?.hint).toMatch(/^••••/)
  })
})

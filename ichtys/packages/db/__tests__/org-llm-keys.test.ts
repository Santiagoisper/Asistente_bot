process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test?sslmode=disable'
process.env.ORG_LLM_KEYS_ENCRYPTION_SECRET =
  process.env.ORG_LLM_KEYS_ENCRYPTION_SECRET ?? 'test-secret-for-vitest-only'

import { describe, expect, it } from 'vitest'
import { encryptJson, decryptJson } from '../org-llm-crypto'
import {
  buildOrgLlmKeyStatuses,
  getOrgLlmKeySource,
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

  it('uses the preview-only GLM key only in Vercel Preview', () => {
    const previous = {
      VERCEL_ENV: process.env.VERCEL_ENV,
      GLM_API_KEY_PREVIEW: process.env.GLM_API_KEY_PREVIEW,
      GLM_API_KEY: process.env.GLM_API_KEY,
      ZAI_API_KEY: process.env.ZAI_API_KEY,
    }

    try {
      process.env.VERCEL_ENV = 'preview'
      process.env.GLM_API_KEY_PREVIEW = 'glm-preview-key-12345678'
      delete process.env.GLM_API_KEY
      delete process.env.ZAI_API_KEY
      expect(resolveLlmApiKey('glm')).toBe('glm-preview-key-12345678')

      process.env.VERCEL_ENV = 'production'
      expect(resolveLlmApiKey('glm')).toBeUndefined()
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  it('prefers the platform GLM key over an organization key when both exist', () => {
    const previous = {
      VERCEL_ENV: process.env.VERCEL_ENV,
      GLM_API_KEY_PREVIEW: process.env.GLM_API_KEY_PREVIEW,
      GLM_API_KEY: process.env.GLM_API_KEY,
      ZAI_API_KEY: process.env.ZAI_API_KEY,
    }
    try {
      process.env.VERCEL_ENV = 'production'
      process.env.GLM_API_KEY = 'glm-platform-key-12345678'
      delete process.env.GLM_API_KEY_PREVIEW
      delete process.env.ZAI_API_KEY

      const orgKeys = { glm: 'glm-org-key-12345678' }
      expect(resolveLlmApiKey('glm', orgKeys)).toBe('glm-platform-key-12345678')
      expect(getOrgLlmKeySource('glm', orgKeys)).toBe('platform')
      expect(buildOrgLlmKeyStatuses(orgKeys).find((item) => item.provider === 'glm')?.source)
        .toBe('platform')
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  it('builds key statuses with source', () => {
    const statuses = buildOrgLlmKeyStatuses({ openai: 'sk-org-key-12345678' })
    const openai = statuses.find((s) => s.provider === 'openai')
    expect(openai?.source).toBe('org')
    expect(openai?.configured).toBe(true)
    expect(openai?.hint).toMatch(/^••••/)
  })
})

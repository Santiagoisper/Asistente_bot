import { describe, expect, it } from 'vitest'
import { AUTO_PROVIDER_CHAIN } from '../types'
import { isOpenAiConfigured } from '../provider'

describe('LLM provider chain', () => {
  it('AUTO_PROVIDER_CHAIN has 5 providers in expected order', () => {
    expect(AUTO_PROVIDER_CHAIN).toEqual(['glm', 'anthropic', 'openai', 'google', 'groq'])
  })

  it('isProviderConfigured respects org keys over env', () => {
    const prev = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    expect(isOpenAiConfigured({ openai: 'sk-org-only-12345678' })).toBe(true)
    expect(isOpenAiConfigured({})).toBe(false)
    process.env.OPENAI_API_KEY = prev
  })
})

describe('resolveKeyForProvider', () => {
  it('prefers org openai key', async () => {
    const { resolveKeyForProvider } = await import('../keys')
    const prev = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'sk-env-12345678'
    expect(resolveKeyForProvider('openai', { openai: 'sk-org-12345678' })).toBe('sk-org-12345678')
    process.env.OPENAI_API_KEY = prev
  })

  it('uses the preview-only GLM key only in Vercel Preview', async () => {
    const { resolveKeyForProvider } = await import('../keys')
    const previous = {
      VERCEL_ENV: process.env.VERCEL_ENV,
      GLM_API_KEY_PREVIEW: process.env.GLM_API_KEY_PREVIEW,
      GLM_API_KEY: process.env.GLM_API_KEY,
      ZAI_API_KEY: process.env.ZAI_API_KEY,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    }

    try {
      process.env.VERCEL_ENV = 'preview'
      process.env.GLM_API_KEY_PREVIEW = 'glm-preview-key-12345678'
      delete process.env.GLM_API_KEY
      delete process.env.ZAI_API_KEY
      delete process.env.OPENROUTER_API_KEY
      expect(resolveKeyForProvider('glm')).toBe('glm-preview-key-12345678')

      process.env.VERCEL_ENV = 'production'
      expect(resolveKeyForProvider('glm')).toBeUndefined()
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})

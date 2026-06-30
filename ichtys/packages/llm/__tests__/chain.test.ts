import { describe, expect, it } from 'vitest'
import { AUTO_PROVIDER_CHAIN } from '../types'
import { isOpenAiConfigured } from '../provider'

describe('LLM provider chain', () => {
  it('AUTO_PROVIDER_CHAIN has 5 providers in expected order', () => {
    expect(AUTO_PROVIDER_CHAIN).toEqual(['anthropic', 'openai', 'google', 'groq', 'glm'])
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
})

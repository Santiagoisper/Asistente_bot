import { describe, expect, it } from 'vitest'
import { AUTO_PROVIDER_CHAIN } from '../types'
import { getDefaultProviderPreference, isOpenAiConfigured, resolveProviderChain } from '../provider'

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

describe('resolveProviderChain — Anthropic primario, GLM nunca único (anti-cuelle de 300 s)', () => {
  it('preferencia explícita anthropic queda como cadena de 1', () => {
    expect(resolveProviderChain('anthropic')).toEqual(['anthropic'])
  })

  it('glm explícito queda como cadena de 1 (decisión de datos: sin respaldo cruzado)', () => {
    expect(resolveProviderChain('glm')).toEqual(['glm'])
  })

  it('toda preferencia explícita no-auto es cadena de 1 sin respaldo', () => {
    for (const pref of ['anthropic', 'openai', 'google', 'groq', 'glm'] as const) {
      expect(resolveProviderChain(pref)).toEqual([pref])
    }
  })

  it("'auto' es la única cadena multi-proveedor con el orden de AUTO_PROVIDER_CHAIN", () => {
    expect(resolveProviderChain('auto')).toEqual(['anthropic', 'openai', 'google', 'groq', 'glm'])
  })

  it('sin preferencia, default auto (cadena completa con anthropic primero)', () => {
    const prev = process.env.LLM_PROVIDER
    delete process.env.LLM_PROVIDER
    expect(getDefaultProviderPreference()).toBe('auto')
    process.env.LLM_PROVIDER = prev
  })
})

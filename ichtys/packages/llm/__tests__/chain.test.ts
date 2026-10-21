import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTO_PROVIDER_CHAIN } from '../types'
import { getDefaultProviderPreference, getModelId, isOpenAiConfigured, resolveProviderChain } from '../provider'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('LLM provider chain', () => {
  it('usa por defecto el modo automático con respaldo: Claude, Gemini, Groq y GLM al final', () => {
    expect(AUTO_PROVIDER_CHAIN).toEqual(['anthropic', 'google', 'groq', 'glm'])
    expect(getDefaultProviderPreference()).toBe('auto')
    expect(resolveProviderChain('auto')).toEqual(['anthropic', 'google', 'groq', 'glm'])
    expect(resolveProviderChain()).toEqual(['anthropic', 'google', 'groq', 'glm'])
  })

  it('una preferencia concreta usa solo ese proveedor', () => {
    expect(resolveProviderChain('groq')).toEqual(['groq'])
    expect(resolveProviderChain('glm')).toEqual(['glm'])
  })

  it('LLM_PROVIDER_CHAIN reordena la cadena sin redeploy', () => {
    vi.stubEnv('LLM_PROVIDER_CHAIN', 'groq, google ,anthropic')
    expect(resolveProviderChain('auto')).toEqual(['groq', 'google', 'anthropic'])
  })

  it('LLM_PROVIDER_CHAIN descarta nombres desconocidos y repetidos', () => {
    vi.stubEnv('LLM_PROVIDER_CHAIN', 'groq,inventado,groq,GLM')
    expect(resolveProviderChain('auto')).toEqual(['groq', 'glm'])
  })

  it('un LLM_PROVIDER_CHAIN sin nombres válidos cae a la cadena por defecto', () => {
    vi.stubEnv('LLM_PROVIDER_CHAIN', 'nada,otra-cosa')
    expect(resolveProviderChain('auto')).toEqual(['anthropic', 'google', 'groq', 'glm'])
  })

  it('el modelo de Anthropic por defecto es Haiku para chat/títulos y Sonnet para el protocolo', () => {
    expect(getModelId('anthropic', 'answer')).toBe('claude-haiku-5-5')
    expect(getModelId('anthropic', 'title')).toBe('claude-haiku-5-5')
    expect(getModelId('anthropic', 'spec')).toBe('claude-sonnet-5-5')
  })

  it('ANSWER_MODEL permite subir el chat a otro modelo sin tocar código', () => {
    vi.stubEnv('ANSWER_MODEL', 'claude-sonnet-5-5')
    expect(getModelId('anthropic', 'answer')).toBe('claude-sonnet-5-5')
  })

  it('Gemini usa el alias vigente y no el modelo retirado', () => {
    expect(getModelId('google', 'answer')).toBe('gemini-flash-latest')
  })

  it('detecta si OpenAI está configurado', () => {
    expect(typeof isOpenAiConfigured()).toBe('boolean')
  })
})
